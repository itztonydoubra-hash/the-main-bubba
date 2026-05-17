import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import path from 'path';

const logger = pino({ level: 'silent' }); // Keep Baileys quiet

const AUTH_DIR = path.resolve('auth_info');

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
 * Start the WhatsApp connection using Baileys
 */
export async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    printQRInTerminal: true,
    logger,
    browser: ['Bubba', 'Chrome', '1.0.0'],
  });

  // Handle connection updates
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Also generate QR manually in case printQRInTerminal doesn't work
    if (qr) {
      console.log('\n📱 Scan this QR code with WhatsApp:\n');
      qrcode.generate(qr, { small: true });
      console.log('\nWaiting for scan...\n');
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;

      if (statusCode === DisconnectReason.loggedOut) {
        console.log('❌ Logged out. Delete auth_info/ and restart to re-authenticate.');
      } else {
        console.log(`⚠️  Connection closed (reason: ${statusCode}). Reconnecting in 3s...`);
        setTimeout(() => startWhatsApp(), 3000);
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
      // Skip messages from self, status broadcasts, and non-text
      if (msg.key.fromMe) continue;
      if (msg.key.remoteJid === 'status@broadcast') continue;

      const text = msg.message?.conversation
        || msg.message?.extendedTextMessage?.text
        || null;

      if (!text) continue; // Only handle text messages for now

      const phoneJid = msg.key.remoteJid; // e.g. "2348012345678@s.whatsapp.net"
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
