#!/usr/bin/env node

/**
 * Скрипт для получения истории сообщений WhatsApp через GreenAPI
 * и анализа Facebook Ad source ID
 */

const fs = require('fs');
const https = require('https');

// Ваши данные GreenAPI
const ID_INSTANCE = '7105366498';
const API_TOKEN = '65ba9804825f4a3891b244d06cf786deb438734842884daba3';
const WHATSAPP_NUMBER = '+77074094375';

// 260000 минут = ~180 дней (6 месяцев)
const MINUTES = 260000;

console.log('🚀 Получение истории WhatsApp сообщений через GreenAPI\n');
console.log(`📱 WhatsApp номер: ${WHATSAPP_NUMBER}`);
console.log(`⏱️  Период: ${MINUTES} минут (~${Math.round(MINUTES / 1440)} дней)\n`);

// URL для запроса
const url = `https://api.green-api.com/waInstance${ID_INSTANCE}/lastIncomingMessages/${API_TOKEN}?minutes=${MINUTES}`;

console.log(`🔗 Запрос: ${url}\n`);
console.log('⏳ Загрузка истории сообщений...\n');

// Выполняем запрос
https.get(url, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    try {
      // Сохраняем полный ответ
      const rawFilename = 'greenapi_raw_response.json';
      fs.writeFileSync(rawFilename, data);
      console.log(`✅ Сырой ответ сохранен: ${rawFilename}\n`);

      // Парсим JSON
      const messages = JSON.parse(data);
      
      if (!Array.isArray(messages)) {
        console.error('❌ Ответ не является массивом сообщений');
        console.log('Полученный ответ:', messages);
        process.exit(1);
      }

      console.log(`📬 Получено сообщений: ${messages.length}\n`);

      // Анализируем сообщения
      analyzeMessages(messages);

    } catch (error) {
      console.error('❌ Ошибка обработки данных:', error.message);
      console.log('\nПопробуйте проверить файл greenapi_raw_response.json');
      process.exit(1);
    }
  });

}).on('error', (error) => {
  console.error('❌ Ошибка запроса:', error.message);
  process.exit(1);
});

/**
 * Анализ сообщений и извлечение source ID
 */
function analyzeMessages(messages) {
  const results = [];
  const phoneToAds = new Map();
  let totalWithSourceId = 0;

  console.log('🔍 Анализ сообщений на наличие Facebook Ad metadata...\n');

  messages.forEach((msg, index) => {
    try {
      // Извлекаем телефон клиента
      const clientPhone = extractPhoneNumber(msg);
      if (!clientPhone) return;

      // Ищем Facebook Ad metadata
      const adData = extractAdMetadata(msg);
      
      if (adData.sourceId) {
        totalWithSourceId++;
        
        const record = {
          phone: clientPhone,
          sourceId: adData.sourceId,
          sourceType: adData.sourceType,
          sourceUrl: adData.sourceUrl,
          conversionSource: adData.conversionSource,
          timestamp: msg.timestamp ? new Date(msg.timestamp * 1000).toISOString() : 'N/A',
          messagePreview: extractMessageText(msg)?.slice(0, 100) || ''
        };
        
        results.push(record);
        
        // Группируем по телефону
        if (!phoneToAds.has(clientPhone)) {
          phoneToAds.set(clientPhone, new Set());
        }
        phoneToAds.get(clientPhone).add(adData.sourceId);
        
        console.log(`✅ [${totalWithSourceId}] Телефон: ${clientPhone} → Ad ID: ${adData.sourceId}`);
      }
    } catch (error) {
      console.error(`⚠️  Ошибка обработки сообщения ${index}:`, error.message);
    }
  });

  // Сохраняем результаты
  saveResults(results, phoneToAds);
  
  // Выводим статистику
  printStatistics(messages.length, totalWithSourceId, phoneToAds);
}

/**
 * Извлечение телефона из сообщения
 */
function extractPhoneNumber(msg) {
  const chatId = msg.chatId || msg.senderData?.chatId || msg.instanceData?.wid;
  if (!chatId) return null;
  
  // Убираем @c.us, @g.us и форматируем
  let phone = chatId.replace('@c.us', '').replace('@g.us', '').replace('@s.whatsapp.net', '');
  
  // Добавляем + если нет
  if (!phone.startsWith('+')) {
    phone = '+' + phone;
  }
  
  return phone;
}

/**
 * Извлечение текста сообщения
 */
function extractMessageText(msg) {
  const messageData = msg.messageData || msg;
  
  // Проверяем разные варианты полей
  return messageData.textMessage ||
         messageData.textMessageData?.textMessage ||
         messageData.extendedTextMessage?.text ||
         messageData.extendedTextMessageData?.text ||
         messageData.text ||
         null;
}

/**
 * Извлечение Facebook Ad metadata из сообщения GreenAPI
 */
function extractAdMetadata(msg) {
  const messageData = msg.messageData || msg;
  
  // Проверяем extendedTextMessageData и extendedTextMessage
  const extendedData = messageData.extendedTextMessageData || messageData.extendedTextMessage;
  
  if (extendedData && extendedData.sourceId) {
    return {
      sourceId: extendedData.sourceId || null,
      sourceType: extendedData.sourceType || null,
      sourceUrl: extendedData.sourceUrl || null,
      conversionSource: extendedData.conversionSource || null,
    };
  }

  // Проверяем другие типы сообщений
  const messageTypes = [
    'textMessageData',
    'textMessage',
    'imageMessageData',
    'imageMessage',
    'videoMessageData',
    'videoMessage',
    'documentMessageData',
    'documentMessage',
  ];

  for (const type of messageTypes) {
    const msgData = messageData[type];
    if (msgData && msgData.sourceId) {
      return {
        sourceId: msgData.sourceId || null,
        sourceType: msgData.sourceType || null,
        sourceUrl: msgData.sourceUrl || null,
        conversionSource: msgData.conversionSource || null,
      };
    }
  }

  return {
    sourceId: null,
    sourceType: null,
    sourceUrl: null,
    conversionSource: null,
  };
}

/**
 * Сохранение результатов
 */
function saveResults(results, phoneToAds) {
  // Сохраняем полный JSON
  const jsonFilename = 'greenapi_analysis_results.json';
  fs.writeFileSync(jsonFilename, JSON.stringify(results, null, 2));
  console.log(`\n✅ Результаты сохранены: ${jsonFilename}`);

  // Создаем CSV
  const csvFilename = 'greenapi_phone_to_ads.csv';
  let csvContent = 'Телефон,Source ID (Facebook Ad ID),Тип,URL,Дата,Превью сообщения\n';
  
  results.forEach(record => {
    csvContent += `"${record.phone}","${record.sourceId}","${record.sourceType || ''}","${record.sourceUrl || ''}","${record.timestamp}","${record.messagePreview.replace(/"/g, '""')}"\n`;
  });
  
  fs.writeFileSync(csvFilename, csvContent);
  console.log(`✅ CSV файл создан: ${csvFilename}`);

  // Создаем сводку по телефонам
  const summaryFilename = 'greenapi_phones_summary.json';
  const summary = [];
  
  phoneToAds.forEach((adIds, phone) => {
    summary.push({
      phone: phone,
      totalAds: adIds.size,
      adIds: Array.from(adIds)
    });
  });
  
  summary.sort((a, b) => b.totalAds - a.totalAds);
  
  fs.writeFileSync(summaryFilename, JSON.stringify(summary, null, 2));
  console.log(`✅ Сводка по телефонам: ${summaryFilename}`);
}

/**
 * Вывод статистики
 */
function printStatistics(totalMessages, messagesWithAds, phoneToAds) {
  console.log('\n' + '='.repeat(60));
  console.log('📊 СТАТИСТИКА');
  console.log('='.repeat(60));
  console.log(`📬 Всего сообщений получено:           ${totalMessages}`);
  console.log(`📢 Сообщений с Facebook Ad metadata:   ${messagesWithAds}`);
  console.log(`📱 Уникальных телефонов:               ${phoneToAds.size}`);
  console.log(`🎯 Процент с рекламой:                 ${((messagesWithAds / totalMessages) * 100).toFixed(2)}%`);
  
  console.log('\n📋 ТОП-10 телефонов по количеству объявлений:');
  console.log('-'.repeat(60));
  
  const sortedPhones = Array.from(phoneToAds.entries())
    .map(([phone, adIds]) => ({ phone, count: adIds.size, ads: Array.from(adIds) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  
  sortedPhones.forEach((item, index) => {
    console.log(`${index + 1}. ${item.phone} → ${item.count} объявлений`);
    console.log(`   Ad IDs: ${item.ads.slice(0, 3).join(', ')}${item.ads.length > 3 ? '...' : ''}`);
  });
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ АНАЛИЗ ЗАВЕРШЕН!');
  console.log('='.repeat(60));
}








