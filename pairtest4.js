import makeWASocket, { useMultiFileAuthState, DisconnectReason } from 'baileys';
import pino from 'pino';

async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
  });

  sock.ev.on('connection.update', (update) => {
    if (update.qr) {
      console.log('');
      console.log('OPEN THIS LINK AND SCAN:');
      console.log('https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(update.qr));
      console.log('');
    }
    if (update.connection === 'open') {
      console.log('');
      console.log('=== CONNECTED! BUBBA IS ALIVE! ===');
      console.log('');
    }
    if (update.connection === 'close') {
      const status = update.lastDisconnect?.error?.output?.statusCode;
      console.log('Connection closed. Status:', status);
      if (status !== DisconnectReason.loggedOut) {
        console.log('Reconnecting...');
        setTimeout(connect, 2000);
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);
}

connect();
