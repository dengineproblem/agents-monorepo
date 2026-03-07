/**
 * Генерация учётных данных для новых пользователей
 *
 * - Генерация уникального username
 * - Генерация безопасного пароля
 */

import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { supabase } from '../supabase.js';
import { createLogger } from '../logger.js';

const log = createLogger({ module: 'credentialsGenerator' });

/**
 * Генерирует случайный username в формате user_xxxxxxxx
 */
export function generateUsername(): string {
  const randomPart = randomBytes(4).toString('hex'); // 8 символов
  return `user_${randomPart}`;
}

/**
 * Генерирует безопасный пароль
 *
 * - 8 символов
 * - Содержит заглавные + строчные + цифры
 * - Исключены путающие символы: I, l, O, 0, 1
 */
export function generatePassword(length: number = 8): string {
  // Символы без путающих (l/1, O/0, I)
  const uppercase = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lowercase = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const allChars = uppercase + lowercase + digits;

  const bytes = randomBytes(length);
  let password = '';

  // Гарантируем наличие каждого типа символов
  password += uppercase[bytes[0] % uppercase.length];
  password += lowercase[bytes[1] % lowercase.length];
  password += digits[bytes[2] % digits.length];

  // Остальные символы - случайные
  for (let i = 3; i < length; i++) {
    password += allChars[bytes[i] % allChars.length];
  }

  // Перемешиваем пароль
  return password
    .split('')
    .sort(() => Math.random() - 0.5)
    .join('');
}

/**
 * Генерирует уникальный username с проверкой в БД
 */
export async function generateUniqueUsername(maxAttempts: number = 5): Promise<string> {
  let username: string;
  let attempts = 0;

  do {
    username = generateUsername();

    const { data } = await supabase
      .from('user_accounts')
      .select('id')
      .eq('username', username)
      .single();

    // Если не найден - значит уникален
    if (!data) {
      log.debug({ username, attempts }, 'Generated unique username');
      return username;
    }

    attempts++;
  } while (attempts < maxAttempts);

  // Если не удалось за N попыток - добавляем timestamp
  const timestamp = Date.now().toString(36);
  username = `user_${timestamp}`;
  log.warn({ username, attempts }, 'Used timestamp fallback for username');

  return username;
}

/**
 * Результат создания пользователя
 */
export interface CreateUserResult {
  success: boolean;
  userId?: string;
  username?: string;
  password?: string;
  error?: string;
}

/**
 * Ответы онбординга для создания пользователя
 */
export interface OnboardingAnswers {
  business_name: string;
  business_niche: string;
  instagram_url?: string;
  website_url?: string;
  target_audience?: string;
  geography?: string;
  main_pains?: string;
  main_services?: string;
  competitive_advantages?: string;
  price_segment?: string;
  tone_of_voice?: string;
  main_promises?: string;
  social_proof?: string;
  guarantees?: string;
  competitor_instagrams?: string[];
}

/**
 * Создаёт нового пользователя на основе данных онбординга
 */
export async function createUserFromOnboarding(
  telegramId: string,
  answers: OnboardingAnswers
): Promise<CreateUserResult> {
  try {
    // 1. Проверяем, не существует ли уже пользователь с таким telegram_id
    const { data: existingUser } = await supabase
      .from('user_accounts')
      .select('id, username')
      .eq('telegram_id', telegramId)
      .single();

    if (existingUser) {
      log.warn({ telegramId, existingUser: existingUser.username }, 'User already exists');
      return {
        success: false,
        error: 'Пользователь с этим Telegram уже зарегистрирован',
        userId: existingUser.id,
        username: existingUser.username,
      };
    }

    // 2. Генерируем credentials
    const username = await generateUniqueUsername();
    const password = generatePassword();
    const hashedPassword = await bcrypt.hash(password, 10);

    // 3. Создаём user_accounts
    const { data: newUser, error: userError } = await supabase
      .from('user_accounts')
      .insert({
        telegram_id: telegramId,
        username,
        password: hashedPassword,
        onboarding_stage: 'registered',
        is_active: true,
        // FB поля пустые - будут заполнены после OAuth
        access_token: '',
        ad_account_id: '',
        page_id: '',
      })
      .select('id')
      .single();

    if (userError || !newUser) {
      log.error({ error: userError, telegramId }, 'Failed to create user_accounts');
      return {
        success: false,
        error: 'Ошибка создания пользователя',
      };
    }

    const userId = newUser.id;

    // 4. Сохраняем ответы в user_briefing_responses
    const { error: briefingError } = await supabase.from('user_briefing_responses').insert({
      user_id: userId,
      business_name: answers.business_name,
      business_niche: answers.business_niche,
      instagram_url: answers.instagram_url || null,
      website_url: answers.website_url || null,
      target_audience: answers.target_audience || null,
      geography: answers.geography || null,
      main_pains: answers.main_pains || null,
      main_services: answers.main_services || null,
      competitive_advantages: answers.competitive_advantages || null,
      price_segment: answers.price_segment || null,
      tone_of_voice: answers.tone_of_voice || null,
      main_promises: answers.main_promises || null,
      social_proof: answers.social_proof || null,
      guarantees: answers.guarantees || null,
      competitor_instagrams: answers.competitor_instagrams || [],
    });

    if (briefingError) {
      log.error({ error: briefingError, userId }, 'Failed to save briefing responses');
      // Не критично - пользователь создан, продолжаем
    }

    log.info({ userId, username, telegramId }, 'User created successfully from onboarding');

    return {
      success: true,
      userId,
      username,
      password,
    };
  } catch (error) {
    log.error({ error: String(error), telegramId }, 'Unexpected error creating user');
    return {
      success: false,
      error: 'Внутренняя ошибка сервера',
    };
  }
}

/**
 * Формирует URL для Facebook OAuth
 */
export function buildFacebookOAuthUrl(userId?: string): string {
  const FB_APP_ID = process.env.FB_APP_ID || '690472653668355';
  const FB_REDIRECT_URI = 'https://app.performanteaiagency.com/profile';
  const FB_SCOPE =
    'ads_read,ads_management,business_management,pages_show_list,pages_manage_ads,pages_read_engagement';

  // State для CSRF защиты
  const state = userId ? `user_${userId}_${Date.now()}` : String(Date.now());

  return (
    `https://www.facebook.com/v21.0/dialog/oauth?` +
    `client_id=${FB_APP_ID}&` +
    `redirect_uri=${encodeURIComponent(FB_REDIRECT_URI)}&` +
    `scope=${FB_SCOPE}&` +
    `response_type=code&` +
    `state=${state}`
  );
}

/**
 * Форматирует финальное сообщение с credentials
 */
export function formatCompletionMessage(
  username: string,
  password: string,
  fbOAuthUrl?: string
): string {
  const appUrl = 'https://app.performanteaiagency.com';

  let message = `🎉 <b>Регистрация завершена!</b>

Ваши данные для входа:
👤 <b>Логин:</b> <code>${username}</code>
🔑 <b>Пароль:</b> <code>${password}</code>

📱 <b>Войти:</b> ${appUrl}`;

  if (fbOAuthUrl) {
    message += `

После входа подключите Facebook:
🔗 <a href="${fbOAuthUrl}">Подключить Facebook</a>`;
  }

  message += `

⚠️ <i>Сохраните эти данные — они понадобятся для входа!</i>

❓ Нужна помощь? <a href="https://t.me/Moltbot_prfmnt_bot">Техподдержка</a>`;

  return message;
}
