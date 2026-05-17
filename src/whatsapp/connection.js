import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import path from 'path';
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

/**
 * Set the handler that processes incoming messages
 */
export function onMessage(handler) {
  messageHandler = handler;
}

/**
 * Send a text message to a phone number
 * @param {string} jid - WhatsApp JID (phone@s.whatsapp.net)
 * @param {string} text - Message text
 */
export async function sendMessage(jid, text) {
  if (!sock) throw new Error('WhatsApp not connected');
  await sock.sendMessage(jid, { text });
}

/**
 * Prompt user for input in terminal (for pairing code phone number)
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
 * 
 * Two auth methods:
 * 1. QR Code (default) — scan with your phone
 * 2. Pairing Code — type a code on your phone (better for servers/headless)
 */
export async function startWhatsApp() {
  console.log('   Loading auth state...');
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  console.log('   Auth state loaded. Creating socket...');

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: !USE_PAIRING_CODE,
    logger,
    browser: USE_PAIRING_CODE ? ['Chrome (Linux)', '', ''] : ['Bubba', 'Chrome', '1.0.0'],
  });

  console.log('   Socket created. Waiting for connection...');

  // If using pairing code and not already registered
  if (USE_PAIRING_CODE && !sock.authState.creds.registered) {
    let phoneNumber = PAIRING_PHONE;

    if (!phoneNumber) {
      phoneNumber = await askQuestion('\n📱 Enter your WhatsApp phone number (with country code, no + or spaces):\n> ');
    }

    console.log(`\n⏳ Requesting pairing code for ${phoneNumber}...`);

    // Small delay to let the socket connect before requesting code
    await new Promise((resolve) => setTimeout(resolve, 3000));

    try {
      const code = await sock.requestPairingCode(phoneNumber);
      console.log(`\n🔑 YOUR PAIRING CODE: ${code}\n`);
      console.log('   Go to WhatsApp on your phone → Linked Devices → Link a Device');
      console.log('   Tap "Link with phone number instead" and enter the code above.\n');
    } catch (err) {
      console.error('❌ Failed to get pairing code:', err.message);
      console.log('   Try deleting auth_info/ folder and restarting.');
    }
  }

  // Handle connection updates
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Manual QR display as backup (only if not using pairing code)
    if (qr && !USE_PAIRING_CODE) {
      console.log('\n📱 Scan this QR code with WhatsApp:\n');
      qrcode.generate(qr, { small: true });
      console.log('\n   Open WhatsApp → Linked Devices → Link a Device → Scan QR\n');
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      console.log(`⚠️  Connection closed (status: ${statusCode})`);

      if (statusCode === DisconnectReason.loggedOut) {
        console.log('❌ Logged out. Delete auth_info/ folder and restart.');
      } else if (statusCode === 405) {
        console.log('❌ 405 error — WhatsApp rejected connection. Deleting auth and retrying...');
        // Delete auth and restart fresh
        import('fs').then(fs => {
          fs.rmSync(AUTH_DIR, { recursive: true, force: true });
          console.log('   auth_info/ deleted. Restarting in 3s...');
          setTimeout(() => startWhatsApp(), 3000);
        });
      } else {
        console.log(`   Reconnecting in 5s...`);
        setTimeout(() => startWhatsApp(), 5000);
      }
    }

    if (connection === 'open') {
      console.log('✅ Bubba is connected to WhatsApp and ready.\n');
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
