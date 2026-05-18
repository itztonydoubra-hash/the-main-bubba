import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
} from 'baileys';
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
  // Clear empty auth folder
  if (fs.existsSync(AUTH_DIR)) {
    const files = fs.readdirSync(AUTH_DIR);
    if (files.length === 0) {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    }
  }

  console.log('   Loading auth state...');
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const isRegistered = state.creds.registered;
  console.log('   Auth state loaded.');
  console.log(`   USE_PAIRING_CODE: ${USE_PAIRING_CODE}`);
  console.log(`   PAIRING_PHONE: ${PAIRING_PHONE || '(not set)'}`);
  console.log(`   Already registered: ${isRegistered || false}`);
  console.log('   Creating socket...');

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: !USE_PAIRING_CODE,
    logger,
    browser: USE_PAIRING_CODE ? ['Chrome (Linux)', '', ''] : ['Bubba', 'Chrome', '1.0.0'],
  });

  console.log('   Socket created.');

  // REQUEST PAIRING CODE IMMEDIATELY (before connection.update fires)
  // This must happen right after socket creation, before the 405 kills the connection
  if (USE_PAIRING_CODE && !isRegistered) {
    let phoneNumber = PAIRING_PHONE;
    if (!phoneNumber) {
      phoneNumber = await askQuestion('\n📱 Enter your WhatsApp phone number (with country code, no + or spaces):\n> ');
    }

    console.log(`\n⏳ Requesting pairing code for ${phoneNumber}...`);
    console.log('   (Please wait a few seconds...)\n');

    // Request pairing code immediately — don't wait
    try {
      const code = await sock.requestPairingCode(phoneNumber);
      console.log('');
      console.log('╔══════════════════════════════════════╗');
      console.log(`║   🔑 PAIRING CODE:  ${code}        ║`);
      console.log('╚══════════════════════════════════════╝');
      console.log('');
      console.log('   On your phone:');
      console.log('   1. Open WhatsApp');
      console.log('   2. Go to Settings → Linked Devices');
      console.log('   3. Tap "Link a Device"');
      console.log('   4. Tap "Link with phone number instead"');
      console.log('   5. Enter the code above');
      console.log('');
      console.log('   Waiting for you to enter the code on your phone...');
      console.log('');
    } catch (err) {
      console.error('❌ Failed to get pairing code:', err.message);
      console.log('');
      console.log('   Possible fixes:');
      console.log('   1. Make sure the phone number is correct (country code + number, no +)');
      console.log('   2. Delete auth_info/ folder and try again');
      console.log('   3. Make sure WhatsApp is installed on that number');
      console.log('   4. Wait 60 seconds and try again (rate limit)');
      console.log('');
    }
  }

  // Handle connection updates
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // QR display (only if not using pairing code)
    if (qr && !USE_PAIRING_CODE) {
      console.log('\n📱 Scan this QR code with WhatsApp:\n');
      qrcode.generate(qr, { small: true });
      console.log('\n   Open WhatsApp → Linked Devices → Link a Device → Scan QR\n');
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      console.log(`⚠️  Connection closed (status: ${statusCode})`);

      if (statusCode === DisconnectReason.loggedOut) {
        console.log('❌ Logged out. Clearing auth and restarting...');
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        setTimeout(() => startWhatsApp(), 3000);
      } else if (statusCode === 405 && isRegistered) {
        // Session expired — clear and retry
        console.log('❌ 405 — Session expired. Clearing auth and restarting...');
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        setTimeout(() => startWhatsApp(), 3000);
      } else if (statusCode === 405 && !isRegistered) {
        // Normal during pairing — don't loop, just wait
        console.log('   (This is normal during pairing. Enter the code on your phone.)');
      } else {
        console.log('   Reconnecting in 5s...');
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

      const remoteJid = msg.key.remoteJid;
      const isGroup = remoteJid.endsWith('@g.us');
      const pushName = msg.pushName || null;

      // Get text content from various message types
      let text = msg.message?.conversation
        || msg.message?.extendedTextMessage?.text
        || null;

      // Check for voice/audio messages
      const audioMessage = msg.message?.audioMessage;
      const isVoiceNote = audioMessage && (audioMessage.ptt === true || audioMessage.mimetype?.includes('audio'));

      // For group messages: only respond if Bubba is mentioned/tagged
      if (isGroup) {
        const mentionedJids = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant;
        const isMentioned = mentionedJids.some(jid => jid === sock.user?.id || jid === sock.user?.lid);
        const isQuotedReply = quotedParticipant === sock.user?.id || quotedParticipant === sock.user?.lid;
        const textLower = (text || '').toLowerCase();
        const isNameMentioned = textLower.includes('bubba') || textLower.includes('@bubba');

        // Only respond in groups if mentioned, quoted, or name is said
        if (!isMentioned && !isQuotedReply && !isNameMentioned && !isVoiceNote) {
          continue;
        }

        // Strip the @mention from the text for cleaner processing
        if (text) {
          text = text.replace(/@\d+/g, '').trim();
        }
      }

      // Handle voice notes
      if (isVoiceNote && !text) {
        if (messageHandler) {
          try {
            // Get sender info
            const senderJid = isGroup ? (msg.key.participant || remoteJid) : remoteJid;
            const phoneNumber = senderJid.replace('@s.whatsapp.net', '').replace('@lid', '');
            const replyJid = remoteJid; // Reply to same chat (group or DM)

            await messageHandler({
              phoneNumber,
              phoneJid: replyJid,
              text: null,
              pushName,
              isGroup,
              isVoiceNote: true,
              audioMessage,
              msg, // Pass full message for downloading
            });
          } catch (err) {
            console.error(`❌ Error handling voice note:`, err);
          }
        }
        continue;
      }

      if (!text) continue;

      // Get sender info
      const senderJid = isGroup ? (msg.key.participant || remoteJid) : remoteJid;
      const phoneNumber = senderJid.replace('@s.whatsapp.net', '').replace('@lid', '');
      const replyJid = remoteJid; // Reply to same chat (group or DM)

      if (messageHandler) {
        try {
          await messageHandler({ phoneNumber, phoneJid: replyJid, text, pushName, isGroup });
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

/**
 * Download media from a message (for voice notes, images, etc.)
 */
export async function downloadMedia(msg) {
  if (!sock) throw new Error('WhatsApp not connected');
  const { downloadMediaMessage } = await import('baileys');
  const buffer = await downloadMediaMessage(msg, 'buffer', {});
  return buffer;
}
