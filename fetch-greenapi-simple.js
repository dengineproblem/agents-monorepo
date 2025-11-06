const https = require('https');
const fs = require('fs');

const ID_INSTANCE = '7105366498';
const API_TOKEN = '65ba9804825f4a3891b244d06cf786deb438734842884daba3';
const MINUTES = 10000; // ~неделя

const url = `https://api.green-api.com/waInstance${ID_INSTANCE}/lastIncomingMessages/${API_TOKEN}?minutes=${MINUTES}`;

console.log(`🔄 Запрос к GreenAPI (${MINUTES} минут)...`);

https.get(url, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    const filename = `greenapi_${MINUTES}min.json`;
    fs.writeFileSync(filename, data);
    
    try {
      const messages = JSON.parse(data);
      console.log(`✅ Получено сообщений: ${messages.length}`);
      console.log(`📁 Файл: ${filename}`);
    } catch (e) {
      console.log('❌ Ошибка парсинга:', e.message);
      console.log('Ответ сохранен в файл');
    }
  });
  
}).on('error', (e) => {
  console.error('❌ Ошибка запроса:', e.message);
});

