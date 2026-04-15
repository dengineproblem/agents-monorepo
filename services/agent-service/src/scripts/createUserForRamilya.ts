#!/usr/bin/env tsx
/**
 * Одноразовый скрипт: создать аккаунт для Рамили Пономарёвой
 * Telegram: @Ramilya3108 (id: 500812810)
 * Ответила на 13/15 вопросов, сессия сбросилась из-за бага с фото
 *
 * Запуск: cd services/agent-service && npx tsx src/scripts/createUserForRamilya.ts
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const serviceDir = resolve(__dirname, '../..');

dotenv.config({ path: resolve(serviceDir, '.env.local') });
dotenv.config({ path: resolve(serviceDir, '.env') });

import { createUserFromOnboarding, buildFacebookOAuthUrl, formatCompletionMessage } from '../lib/telegramOnboarding/credentialsGenerator.js';
import { supabase } from '../lib/supabase.js';
import { sendTelegramNotification } from '../lib/telegramNotifier.js';

const TELEGRAM_ID = '500812810';

const answers = {
  business_name: 'Туры в Алматы. По Казахстану. Центральная Азия и Байконур',
  business_niche: 'Туризм',
  instagram_url: 'https://www.instagram.com/rocket_go_travel',
  website_url: 'https://rg-travel.kz',
  target_audience: 'Женщины от 25-60',
  geography: 'Алматы, Астана, Актобе, Атырау, Актау, Уральск, Петропавловск, Усть-Каменогорск, Караганда. Международные направления: Турция, Франция, Германия, Марокко, Бразилия, Саудовская Аравия, Великобритания, Япония, Латвия, ОАЭ, Италия, Испания',
  main_pains: 'Дорого / неудобно / страх',
  main_services: 'Авторские туры, групповые поездки, индивидуальный подбор путешествий, туры на Байконур, экскурсионные программы, бронирование отелей и авиабилетов, визовая поддержка, трансферы и сопровождение',
  competitive_advantages: 'Местная компания в Казахстане, давно на рынке, сильный бренд',
  price_segment: 'средний',
  tone_of_voice: 'Дружелюбный',
  main_promises: 'Гарантия получения качественной услуги',
  // вопросы 13-15 не были заполнены
  social_proof: undefined,
  guarantees: undefined,
  competitor_instagrams: [],
};

async function run() {
  console.log('Создаём аккаунт для Рамили Пономарёвой (@Ramilya3108)...\n');

  // Проверяем, нет ли уже аккаунта
  const { data: existing } = await supabase
    .from('user_accounts')
    .select('id, username')
    .eq('telegram_id', TELEGRAM_ID)
    .single();

  if (existing) {
    console.log(`⚠️  Аккаунт уже существует: ${existing.username} (${existing.id})`);
    process.exit(0);
  }

  const result = await createUserFromOnboarding(TELEGRAM_ID, answers as any);

  if (!result.success) {
    console.error('❌ Ошибка создания:', result.error);
    process.exit(1);
  }

  console.log('✅ Аккаунт создан!\n');
  console.log(`   Логин:    ${result.username}`);
  console.log(`   Пароль:   ${result.password}`);
  console.log(`   User ID:  ${result.userId}`);

  // Помечаем onboarding сессию как завершённую
  const { error: sessionError } = await supabase
    .from('telegram_onboarding_sessions')
    .update({
      is_completed: true,
      user_account_id: result.userId,
      completed_at: new Date().toISOString(),
    })
    .eq('telegram_id', TELEGRAM_ID);

  if (sessionError) {
    console.warn('⚠️  Не удалось обновить сессию:', sessionError.message);
  } else {
    console.log('\n   Сессия онбординга помечена как завершённая.');
  }

  // Отправляем credentials в Telegram — как в обычном онбординге
  const fbOAuthUrl = buildFacebookOAuthUrl(result.userId);
  const completionMessage = formatCompletionMessage(result.username!, result.password!, fbOAuthUrl);

  await sendTelegramNotification(TELEGRAM_ID, '🎊 Отлично! Вы ответили на все вопросы!', { source: 'onboarding' });
  await sendTelegramNotification(TELEGRAM_ID, completionMessage, { source: 'onboarding' });

  console.log('\n✅ Сообщение с credentials отправлено в Telegram.');
  console.log(`   Логин: ${result.username}`);
  console.log(`   Пароль: ${result.password}`);
}

run().catch(console.error);
