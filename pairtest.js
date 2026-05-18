import dotenv from 'dotenv';
dotenv.config();
import makeWASocket, { useMultiFileAuthState } from '@whiskeysockets/baileys';
import pino from 'pino';

const { state } = await useMultiFileAuthState('auth_info_test');
const sock = makeWASocket({ auth: state, printQRInTerminal: false, logger: pino({ level: 'silent' }), browser: ['Chrome (Linux)', '', ''] });
console.log('Socket created, requesting code...');
try {
  const code = await sock.requestPairingCode('2347051186987');
  console.log('CODE:', code);
} catch (e) {
  console.log('ERROR:', e.message);
}
