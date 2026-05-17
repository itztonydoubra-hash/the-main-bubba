import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import path from 'path';
import fs from 'fs';
import readline from 'readline';

const logger = pino({ level: 'silent' });

const AUTH_DIR = path.resolve('auth_info');

// Set to true to use pairing code (type code on phone) instead of QR scan
const USE_PAIRING_CODE = process.env.USE_PAIRING_CODE === 'true';
// The phone number to pair with (required if USE_PAIRING_CODE=true)
// Format: country code + number, no + or spaces. e.g. "2348012345678"
const PAIRING_PHONE = process.env.PAIRING_PHONE || '';

let sock = null;
let messageHandler = null;
let pairingRequested = false;

/**
 * Set the handler that processes incoming messages
 */
export function onMessage(handler) {
  messageHandler = handler;
}

/**
 * Send a text message to a phone number
 */
export async function sendMessage(jid, text) {
  if (!sock) throw new Error('WhatsApp not connected');
  await sock.sendMessage(jid, { text });
}

/**
 * Prompt user for input in terminal
 */
function askQuestion(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Start the WhatsApp connection using Baileys
 */
export async function startWhatsApp() {
  // Clear corrupted auth on fresh start
  if (USE_PAIRING_CODE && fs.existsSync(AUTH_DIR)) {
    const files = fs.readdirSync(AUTH_DIR);
    if (files.length === 0) {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    }
  }

  console.log('   Loading auth state...');
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  console.log('   Auth state loaded.');
  console.log(`   USE_PAIRING_CODE: ${USE_PAIRING_CODE}`);
  console.log(`   PAIRING_PHONE: ${PAIRING_PHONE || '(not set)'}`);
  console.log(`   Already registered: ${state.creds.registered || false}`);
  console.log('   Creating socket...');

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: !USE_PAIRING_CODE,
    logger,
    browser: USE_PAIRING_CODE ? ['Chrome (Linux)', '', ''] : ['Bubba', 'Chrome', '1.0.0'],
  });

  console.log('   Socket created.');

  // Handle connection updates
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // QR display (only if not using pairing code)
    if (qr && !USE_PAIRING_CODE) {
      console.log('\n📱 Scan this QR code with WhatsApp:\n');
      qrcode.generate(qr, { small: true });
      console.log('\n   Open WhatsApp → Linked Devices → Link a Device → Scan QR\n');
    }

    // Request pairing code when we get the first connection update
    if (USE_PAIRING_CODE && !pairingRequested && !state.creds.registered) {
      pairingRequested = true;

      let phoneNumber = PAIRING_PHONE;
      if (!phoneNumber) {
        phoneNumber = await askQuestion('\n📱 Enter your WhatsApp phone number (with country code, no + or spaces):\n> ');
      }

      console.log(`\n⏳ Requesting pairing code for ${phoneNumber}...`);

      // Wait a moment for WebSocket to be ready
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(phoneNumber);
          console.log(`\n╔══════════════════════════════════╗`);
          console.log(`║  🔑 PAIRING CODE: ${code}     ║`);
          console.log(`╚══════════════════════════════════╝\n`);
          console.log('   On your phone:');
          console.log('   1. Open WhatsApp');
          console.log('   2. Go to Settings → Linked Devices');
          console.log('   3. Tap "Link a Device"');
          console.log('   4. Tap "Link with phone number instead"');
          console.log('   5. Enter the code above\n');
        } catch (err) {
          console.error('❌ Failed to get pairing code:', err.message);
          console.log('\n   Possible fixes:');
          console.log('   1. Make sure the phone number is correct (country code + number, no +)');
          console.log('   2. Delete auth_info/ folder and try again');
          console.log('   3. Make sure WhatsApp is installed on that number\n');
          pairingRequested = false; // Allow retry
        }
      }, 5000);
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      console.log(`⚠️  Connection closed (status: ${statusCode})`);

      if (statusCode === DisconnectReason.loggedOut) {
        console.log('❌ Logged out. Clearing auth and restarting...');
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        pairingRequested = false;
        setTimeout(() => startWhatsApp(), 3000);
      } else if (statusCode === 405 && state.creds.registered) {
        // Only auto-retry 405 if we were previously registered (session expired)
        console.log('❌ 405 — Session expired. Clearing auth and restarting...');
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        pairingRequested = false;
        setTimeout(() => startWhatsApp(), 3000);
      } else if (statusCode === 405 && !state.creds.registered) {
        // Fresh connection got 405 — this is normal during pairing, ignore it
        console.log('   (405 during fresh pairing — waiting for code entry on phone...)');
      } else {
        console.log(`   Reconnecting in 5s...`);
        setTimeout(() => startWhatsApp(), 5000);
      }
    }

    if (connection === 'open') {
      console.log('✅ Bubba is connected to WhatsApp and ready.\n');
      pairingRequested = false;
    }
  });

  // Save credentials on update
  sock.ev.on('creds.update', saveCreds);

  // Listen for incoming messages
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      if (msg.key.remoteJid === 'status@broadcast') continue;

      const text = msg.message?.conversation
        || msg.message?.extendedTextMessage?.text
        || null;

      if (!text) continue;

      const phoneJid = msg.key.remoteJid;
      const phoneNumber = phoneJid.replace('@s.whatsapp.net', '');
      const pushName = msg.pushName || null;

      if (messageHandler) {
        try {
          await messageHandler({ phoneNumber, phoneJid, text, pushName });
        } catch (err) {
          console.error(`❌ Error handling message from ${phoneNumber}:`, err);
        }
      }
    }
  });

  return sock;
}

export function getSocket() {
  return sock;
}
