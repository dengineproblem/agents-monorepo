/**
 * Диагностический скрипт: проверяет rawData сообщений wwebjs для конкретного контакта.
 *
 * Использование:
 *   CONTACT_PHONE=77078357243 USER_ACCOUNT_ID=<id> npx tsx scripts/debug-rawdata.ts
 *
 * Для локальной разработки с Chrome:
 *   PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *   CONTACT_PHONE=77078357243 USER_ACCOUNT_ID=<id> npx tsx scripts/debug-rawdata.ts
 */

import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;

const CONTACT_PHONE = process.env.CONTACT_PHONE || '77078357243';
const USER_ACCOUNT_ID = process.env.USER_ACCOUNT_ID;
const CHAT_ID = `${CONTACT_PHONE}@c.us`;

if (!USER_ACCOUNT_ID) {
  console.error('USER_ACCOUNT_ID is required');
  process.exit(1);
}

console.log(`Initializing wwebjs session for account ${USER_ACCOUNT_ID}...`);
console.log(`Will check chat: ${CHAT_ID}`);

const client = new Client({
  authStrategy: new LocalAuth({ clientId: USER_ACCOUNT_ID }),
  puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
    ],
  },
});

client.on('qr', (qr) => {
  console.log('QR code received. Session not authenticated — need to scan QR first.');
  console.log('Use the /qr endpoint in the service to authenticate.');
  process.exit(1);
});

client.on('ready', async () => {
  console.log('Client ready!\n');

  try {
    const chat = await client.getChatById(CHAT_ID);
    console.log(`Chat found: ${chat.name || CHAT_ID}`);

    // Загружаем больше сообщений, чтобы дойти до нужной даты
    const limit = parseInt(process.env.MSG_LIMIT || '500');
    const messages = await chat.fetchMessages({ limit });
    console.log(`Fetched ${messages.length} messages\n`);

    // Фильтр по дате если задан TARGET_DATE (формат: 2026-02-26)
    const targetDate = process.env.TARGET_DATE;
    const targetHour = process.env.TARGET_HOUR ? parseInt(process.env.TARGET_HOUR) : null;

    for (const msg of messages) {
      const m = msg as any;
      const rawData = m.rawData || m._data;

      const contextInfo = rawData?.contextInfo ||
                          rawData?.message?.contextInfo ||
                          rawData?.message?.extendedTextMessage?.contextInfo;

      const msgDate = new Date(m.timestamp * 1000);
      const msgDateStr = msgDate.toISOString().split('T')[0]; // YYYY-MM-DD
      const msgHour = msgDate.getUTCHours();

      // Если задана целевая дата — показываем только сообщения этой даты
      if (targetDate && msgDateStr !== targetDate) continue;
      // Если задан час — фильтруем ещё по часу (UTC)
      if (targetHour !== null && msgHour !== targetHour) continue;

      console.log('═══════════════════════════════════════');
      console.log(`From: ${m.fromMe ? 'ME' : 'CLIENT'}`);
      console.log(`Type: ${m.type}`);
      console.log(`Timestamp: ${msgDate.toISOString()}`);
      console.log(`Body: ${(m.body || '').substring(0, 150)}`);
      console.log(`Links: ${JSON.stringify(m.links || [])}`);
      console.log('');
      console.log('--- rawData analysis ---');
      console.log(`hasRawData: ${!!rawData}`);
      console.log(`rawDataKeys: ${rawData ? Object.keys(rawData).join(', ') : 'none'}`);
      console.log(`hasContextInfo: ${!!contextInfo}`);
      console.log(`hasExternalAdReply: ${!!contextInfo?.externalAdReply}`);

      if (contextInfo?.externalAdReply) {
        console.log('\n*** FOUND externalAdReply! ***');
        console.log(JSON.stringify(contextInfo.externalAdReply, null, 2));
      }

      if (contextInfo?.referral) {
        console.log('\n*** FOUND referral! ***');
        console.log(JSON.stringify(contextInfo.referral, null, 2));
      }

      if (rawData?.conversationContext) {
        console.log('\n*** FOUND conversationContext! ***');
        console.log(JSON.stringify(rawData.conversationContext, null, 2));
      }

      if (rawData?.message) {
        console.log(`\nmessageKeys: ${Object.keys(rawData.message).join(', ')}`);
        const extCtx = rawData.message?.extendedTextMessage?.contextInfo;
        if (extCtx?.externalAdReply) {
          console.log('\n*** FOUND extendedTextMessage.contextInfo.externalAdReply! ***');
          console.log(JSON.stringify(extCtx.externalAdReply, null, 2));
        }
      }

      // Dump full rawData for first incoming message
      if (!m.fromMe) {
        console.log('\n--- FULL rawData dump (incoming) ---');
        console.log(JSON.stringify(rawData, null, 2));
      }

      console.log('');
    }
  } catch (err: any) {
    console.error('Error:', err.message);
  }

  console.log('\nDestroying session...');
  await client.destroy();
  process.exit(0);
});

client.on('auth_failure', (msg) => {
  console.error('Auth failure:', msg);
  process.exit(1);
});

client.initialize();

// Таймаут 2 минуты
setTimeout(() => {
  console.error('Timeout: client did not become ready in 2 minutes');
  client.destroy().then(() => process.exit(1));
}, 120000);
