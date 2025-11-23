#!/usr/bin/env ts-node

import { createClient } from '@supabase/supabase-js';
import { generatePrompt1 } from '../services/agent-service/src/lib/openaiPromptGenerator.js';
import 'dotenv/config';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  throw new Error('Supabase credentials not configured');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function regeneratePrompt1ForUser(userId: string) {
  console.log(`\n🔄 Регенерация PROMPT1 для пользователя: ${userId}\n`);

  // 1. Получаем данные онбординга
  console.log('📋 Получение данных онбординга...');
  const { data: briefingData, error: briefingError } = await supabase
    .from('user_briefing_responses')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (briefingError) {
    throw new Error(`Ошибка получения данных онбординга: ${briefingError.message}`);
  }

  if (!briefingData) {
    throw new Error(`Данные онбординга не найдены для пользователя ${userId}`);
  }

  console.log('✅ Данные онбординга получены:');
  console.log(`   Бизнес: ${briefingData.business_name}`);
  console.log(`   Ниша: ${briefingData.business_niche}`);
  console.log('');

  // 2. Генерируем новый PROMPT1
  console.log('🤖 Генерация нового PROMPT1 через OpenAI...');
  const newPrompt1 = await generatePrompt1({
    business_name: briefingData.business_name,
    business_niche: briefingData.business_niche,
    instagram_url: briefingData.instagram_url,
    website_url: briefingData.website_url,
    target_audience: briefingData.target_audience,
    geography: briefingData.geography,
    main_services: briefingData.main_services,
    competitive_advantages: briefingData.competitive_advantages,
    price_segment: briefingData.price_segment,
    main_pains: briefingData.main_pains,
    main_promises: briefingData.main_promises,
    social_proof: briefingData.social_proof,
    guarantees: briefingData.guarantees,
    tone_of_voice: briefingData.tone_of_voice,
  });

  console.log(`✅ PROMPT1 успешно сгенерирован (длина: ${newPrompt1.length} символов)`);
  console.log('');

  // 3. Сохраняем в базу данных
  console.log('💾 Сохранение PROMPT1 в базу данных...');
  const { error: updateError } = await supabase
    .from('user_accounts')
    .update({
      prompt1: newPrompt1,
      updated_at: new Date().toISOString()
    })
    .eq('id', userId);

  if (updateError) {
    throw new Error(`Ошибка сохранения PROMPT1: ${updateError.message}`);
  }

  console.log('✅ PROMPT1 успешно сохранён в базу данных');
  console.log('');
  console.log('🎉 Готово! PROMPT1 для пользователя успешно обновлён');
  console.log('');
  console.log('📄 Превью нового PROMPT1:');
  console.log('━'.repeat(80));
  console.log(newPrompt1.substring(0, 500) + '...');
  console.log('━'.repeat(80));
}

// Запуск
const userId = process.argv[2] || 'feb9ae84-7365-4d88-bfcf-486a2a2870ed';

regeneratePrompt1ForUser(userId)
  .then(() => {
    console.log('\n✅ Скрипт успешно завершён\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Ошибка:', error.message);
    console.error(error);
    process.exit(1);
  });
