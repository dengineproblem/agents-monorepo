import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.agent' });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

console.log('🧪 Тестируем OpenAI API...\n');

if (!process.env.OPENAI_API_KEY) {
  console.log('❌ OPENAI_API_KEY не найден в .env.agent');
  process.exit(1);
}

console.log('✅ API Key найден:', process.env.OPENAI_API_KEY.substring(0, 20) + '...\n');

console.log('📡 Отправляем тестовый запрос в OpenAI...\n');

try {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: 'Скажи "Привет! LLM работает отлично!" и оцени креатив по 100-балльной шкале: показы 1200, клики 45, лиды 3, потрачено $20. Ответь в формате JSON: {"message": "...", "score": число, "verdict": "good"}'
      }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.7,
  });

  const result = JSON.parse(response.choices[0].message.content);
  
  console.log('✅ ОТВЕТ ОТ LLM:\n');
  console.log(JSON.stringify(result, null, 2));
  console.log('\n🎉 LLM РАБОТАЕТ! Все ок!');
  
} catch (error) {
  console.log('❌ ОШИБКА:', error.message);
  if (error.response) {
    console.log('Детали:', error.response.data);
  }
  process.exit(1);
}

