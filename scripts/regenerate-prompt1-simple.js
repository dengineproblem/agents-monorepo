#!/usr/bin/env node

const https = require('https');

const SUPABASE_URL = 'https://ikywuvtavpnjlrjtalqi.supabase.co';
const SUPABASE_SERVICE_ROLE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlreXd1dnRhdnBuamxyanRhbHFpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NTE0NDc1MywiZXhwIjoyMDYwNzIwNzUzfQ.CAJx7J-CCzbU14EFrZhFcv1qzOLr35dT1-Oh33elOYo';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

const userId = process.argv[2] || 'feb9ae84-7365-4d88-bfcf-486a2a2870ed';

console.log(`\n🔄 Регенерация PROMPT1 для пользователя: ${userId}\n`);

// 1. Получаем данные онбординга из Supabase
console.log('📋 Получение данных онбординга из Supabase...');

const supabaseRequest = https.request({
  hostname: 'ikywuvtavpnjlrjtalqi.supabase.co',
  path: `/rest/v1/user_briefing_responses?user_id=eq.${userId}&select=*`,
  method: 'GET',
  headers: {
    'apikey': SUPABASE_SERVICE_ROLE,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE}`,
    'Content-Type': 'application/json'
  }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const briefingArray = JSON.parse(data);

    if (!briefingArray || briefingArray.length === 0) {
      console.error(`❌ Данные онбординга не найдены для пользователя ${userId}`);
      process.exit(1);
    }

    const briefingData = briefingArray[0];
    console.log('✅ Данные онбординга получены:');
    console.log(`   Бизнес: ${briefingData.business_name}`);
    console.log(`   Ниша: ${briefingData.business_niche}\n`);

    // Выводим все данные онбординга для просмотра
    console.log('📝 Полные данные онбординга:');
    console.log('━'.repeat(80));
    console.log(JSON.stringify(briefingData, null, 2));
    console.log('━'.repeat(80));
    console.log('\n✅ Данные успешно получены!\n');
    console.log('ℹ️  Для регенерации PROMPT1 через OpenAI запустите agent-service');
    console.log('   и используйте API endpoint: POST /briefing/generate-prompt');
  });
});

supabaseRequest.on('error', (error) => {
  console.error('❌ Ошибка при получении данных:', error.message);
  process.exit(1);
});

supabaseRequest.end();
