import dotenv from 'dotenv';
dotenv.config();
import makeWASocket, { useMultiFileAuthState } from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';

// Clean start
if (fs.existsSync('auth_info_test2')) {
  fs.rmSync('auth_info_test2', { recursive: true, force: true });
}

const { state, saveCreds } = await useMultiFileAuthState('auth_info_test2');
const sock = makeWASocket({
  auth: state,
  printQRInTerminal: false,
  logger: pino({ level: 'silent' }),
  browser: ['Chrome (Linux)', '', ''],
});

console.log('Socket created. Waiting for WebSocket to be ready...');

sock.ev.on('connection.update', async (update) => {
  const { qr, connection, lastDisconnect } = update;
  console.log('connection.update:', JSON.stringify({ connection, qr: qr ? 'YES' : undefined }));

  // When we get a QR, the WebSocket is alive — NOW request pairing code
  if (qr) {
    console.log('WebSocket ready! Requesting pairing code...');
    try {
      const code = await sock.requestPairingCode('2347051186987');
      console.log('');
      console.log('=============================');
      console.log('  PAIRING CODE:', code);
      console.log('=============================');
      console.log('');
    } catch (e) {
      console.log('ERROR requesting code:', e.message);
    }
  }

  if (connection === 'close') {
    console.log('Connection closed. Status:', lastDisconnect?.error?.output?.statusCode);
  }

  if (connection === 'open') {
    console.log('CONNECTED!');
  }
});

sock.ev.on('creds.update', saveCreds);
