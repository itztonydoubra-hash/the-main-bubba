import dotenv from 'dotenv';
dotenv.config();
import makeWASocket, { useMultiFileAuthState } from 'baileys';
import pino from 'pino';
import fs from 'fs';

if (fs.existsSync('auth_info_test3')) {
  fs.rmSync('auth_info_test3', { recursive: true, force: true });
}

const { state, saveCreds } = await useMultiFileAuthState('auth_info_test3');
const sock = makeWASocket({
  auth: state,
  printQRInTerminal: false,
  logger: pino({ level: 'silent' }),
  browser: ['Chrome (Linux)', '', ''],
});

console.log('Socket created. Waiting...');

sock.ev.on('connection.update', async (update) => {
  console.log('UPDATE:', JSON.stringify(update, null, 2));

  if (update.qr) {
    console.log('QR received! Requesting pairing code...');
    try {
      const code = await sock.requestPairingCode('2347051186987');
      console.log('');
      console.log('============================');
      console.log('  PAIRING CODE:', code);
      console.log('============================');
    } catch (e) {
      console.log('ERROR:', e.message);
    }
  }

  if (update.connection === 'open') {
    console.log('CONNECTED!');
  }
});

sock.ev.on('creds.update', saveCreds);
