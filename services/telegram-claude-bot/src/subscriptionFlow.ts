/**
 * Subscription & Onboarding flows для Telegram-бота
 *
 * Handles:
 * - Subscription plan selection & payment for new users
 * - Subscription status display & renewal for existing users
 * - Ad account onboarding (business info + Facebook IDs + partner access)
 */

import axios from 'axios';
import TelegramBot from 'node-telegram-bot-api';
import { BRAIN_SERVICE_URL, BRAIN_SERVICE_SECRET, PAYMENT_BASE_URL, PARTNER_BUSINESS_ID } from './config.js';
import { PendingFlowState } from './types.js';
import { logger } from './logger.js';
import { storeMessage } from './db.js';

// ======================================================================
// Pending flows storage (for users without a session yet)
// ======================================================================

const pendingFlows = new Map<number, PendingFlowState>();
const PENDING_FLOW_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Cleanup expired pending flows every 30 min
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [id, flow] of pendingFlows) {
    if (now - flow.startedAt > PENDING_FLOW_TTL_MS) {
      pendingFlows.delete(id);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    logger.debug({ cleaned, remaining: pendingFlows.size }, 'Pending flow cleanup');
  }
}, 30 * 60 * 1000);

export function getPendingFlow(telegramId: number): PendingFlowState | undefined {
  const flow = pendingFlows.get(telegramId);
  if (flow && Date.now() - flow.startedAt > PENDING_FLOW_TTL_MS) {
    pendingFlows.delete(telegramId);
    return undefined;
  }
  return flow;
}

export function clearPendingFlow(telegramId: number): void {
  pendingFlows.delete(telegramId);
}

// ======================================================================
// HTTP helper for agent-brain calls
// ======================================================================

async function callBrain(endpoint: string, body: object): Promise<any> {
  const url = `${BRAIN_SERVICE_URL}${endpoint}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (BRAIN_SERVICE_SECRET) {
    headers['X-Service-Auth'] = BRAIN_SERVICE_SECRET;
  }
  try {
    const response = await axios.post(url, body, { headers, timeout: 15_000 });
    return response.data;
  } catch (error: any) {
    logger.error({ endpoint, error: error.response?.data?.error || error.message }, 'callBrain failed');
    return { success: false, error: error.response?.data?.error || error.message };
  }
}

// ======================================================================
// SUBSCRIPTION — plan selection for new users
// ======================================================================

const SUBSCRIPTION_PLANS = [
  { slug: '1m-29k', label: '📦 Базовый — 29 000 ₸/мес (до 5 кабинетов)', amount: 29000 },
  { slug: '1m-49k', label: '⭐ Премиум — 49 000 ₸/мес (до 20 кабинетов)', amount: 49000 },
];

export async function showSubscriptionPlans(
  bot: TelegramBot,
  chatId: number,
  telegramId: number,
): Promise<void> {
  // Check if user was already pre-registered (pending payment)
  const existing = getPendingFlow(telegramId);
  if (existing?.flow === 'subscription' && existing.step === 'awaiting_payment' && existing.data.paymentUrl) {
    await bot.sendMessage(chatId,
      'Оплата ещё не получена. Нажмите кнопку ниже для оплаты или выберите план заново.',
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '💳 Оплатить', url: existing.data.paymentUrl }],
            [{ text: '🔄 Выбрать другой план', callback_data: 'sub:reselect' }],
          ],
        },
      },
    );
    return;
  }

  // Step 1: Choose payment method
  await bot.sendMessage(chatId,
    '👋 Добро пожаловать!\n\n' +
    'Выберите способ оплаты:',
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🇰🇿 Оплата картой Казахстана', callback_data: 'pay:kz' }],
          [{ text: '🌍 Другой способ оплаты', callback_data: 'pay:other' }],
        ],
      },
    },
  );

  pendingFlows.set(telegramId, {
    flow: 'subscription',
    step: 'select_payment_method',
    data: {},
    startedAt: Date.now(),
  });
}

function showTariffButtons(
  bot: TelegramBot,
  chatId: number,
  messageId?: number,
): Promise<any> {
  const keyboard = SUBSCRIPTION_PLANS.map(plan => [
    { text: plan.label, callback_data: `plan:${plan.slug}` },
  ]);
  keyboard.push([{ text: '⬅️ Назад', callback_data: 'pay:back' }]);

  const text = 'Выберите тарифный план:';

  if (messageId) {
    return bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: keyboard },
    }).catch(() =>
      bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } }),
    );
  }
  return bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } });
}

export async function handleSubscriptionCallback(
  data: string,
  bot: TelegramBot,
  query: TelegramBot.CallbackQuery,
): Promise<boolean> {
  const chatId = query.message?.chat.id;
  const telegramId = query.from.id;
  if (!chatId) return false;

  // sub:reselect — show plans again
  if (data === 'sub:reselect') {
    clearPendingFlow(telegramId);
    await showSubscriptionPlans(bot, chatId, telegramId);
    return true;
  }

  // pay:kz — карта Казахстана → показать тарифы
  if (data === 'pay:kz') {
    pendingFlows.set(telegramId, {
      flow: 'subscription',
      step: 'select_plan',
      data: {},
      startedAt: Date.now(),
    });
    await showTariffButtons(bot, chatId, query.message?.message_id);
    return true;
  }

  // pay:other — альтернативный способ оплаты
  if (data === 'pay:other') {
    const text = 'Для подбора альтернативного способа оплаты обратитесь в техподдержку:\n\n' +
      '👉 [Написать в техподдержку](https://t.me/anatoliymarketolog)';
    if (query.message?.message_id) {
      try {
        await bot.editMessageText(text, {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: [
              [{ text: '⬅️ Назад', callback_data: 'pay:back' }],
            ],
          },
        });
      } catch {
        await bot.sendMessage(chatId, text, {
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: [
              [{ text: '⬅️ Назад', callback_data: 'pay:back' }],
            ],
          },
        });
      }
    }
    return true;
  }

  // pay:back — вернуться к выбору способа оплаты
  if (data === 'pay:back') {
    clearPendingFlow(telegramId);
    if (query.message?.message_id) {
      try {
        await bot.editMessageText(
          '👋 Добро пожаловать!\n\n' +
          'Выберите способ оплаты:',
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: {
              inline_keyboard: [
                [{ text: '🇰🇿 Оплата картой Казахстана', callback_data: 'pay:kz' }],
                [{ text: '🌍 Другой способ оплаты', callback_data: 'pay:other' }],
              ],
            },
          },
        );
      } catch {
        await showSubscriptionPlans(bot, chatId, telegramId);
      }
    } else {
      await showSubscriptionPlans(bot, chatId, telegramId);
    }
    pendingFlows.set(telegramId, {
      flow: 'subscription',
      step: 'select_payment_method',
      data: {},
      startedAt: Date.now(),
    });
    return true;
  }

  // sub:renew:{slug} — renewal for existing users
  if (data.startsWith('sub:renew:')) {
    const slug = data.replace('sub:renew:', '');
    const status = await callBrain('/brain/subscription-status', { telegram_id: telegramId });
    if (!status.success || !status.userAccountId) {
      await bot.sendMessage(chatId, 'Не удалось получить данные аккаунта.');
      return true;
    }
    const paymentUrl = `${PAYMENT_BASE_URL}/robokassa/redirect?plan=${slug}&user_id=${status.userAccountId}`;
    await bot.sendMessage(chatId,
      'Нажмите кнопку ниже для оплаты продления:',
      { reply_markup: { inline_keyboard: [[{ text: '💳 Оплатить', url: paymentUrl }]] } },
    );
    return true;
  }

  // plan:{slug} — new user selects a plan
  if (data.startsWith('plan:')) {
    const slug = data.replace('plan:', '');
    const plan = SUBSCRIPTION_PLANS.find(p => p.slug === slug);
    if (!plan) {
      await bot.sendMessage(chatId, 'Неизвестный тарифный план.');
      return true;
    }

    // Build payment URL with telegram_id (account created at redirect, not here)
    const paymentUrl = `${PAYMENT_BASE_URL}/robokassa/redirect?plan=${slug}&telegram_id=${telegramId}`;

    // Edit original message or send new
    if (query.message?.message_id) {
      try {
        await bot.editMessageText(
          `Нажмите кнопку ниже для оплаты подписки (${plan.amount.toLocaleString('ru')} ₸):`,
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: {
              inline_keyboard: [
                [{ text: `💳 Оплатить ${plan.amount.toLocaleString('ru')} ₸`, url: paymentUrl }],
                [{ text: '⬅️ Назад', callback_data: 'pay:kz' }],
              ],
            },
          },
        );
      } catch {
        await bot.sendMessage(chatId,
          `Нажмите кнопку ниже для оплаты подписки (${plan.amount.toLocaleString('ru')} ₸):`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: `💳 Оплатить ${plan.amount.toLocaleString('ru')} ₸`, url: paymentUrl }],
                [{ text: '⬅️ Назад', callback_data: 'pay:kz' }],
              ],
            },
          },
        );
      }
    }

    pendingFlows.set(telegramId, {
      flow: 'subscription',
      step: 'awaiting_payment',
      data: { slug, paymentUrl },
      startedAt: Date.now(),
    });

    logger.info({ telegramId, slug }, 'Subscription: payment URL sent');
    return true;
  }

  return false;
}

// ======================================================================
// SUBSCRIPTION STATUS — for /subscription command
// ======================================================================

export async function showSubscriptionStatus(
  bot: TelegramBot,
  chatId: number,
  telegramId: number,
): Promise<void> {
  const result = await callBrain('/brain/subscription-status', { telegram_id: telegramId });

  if (!result.success && result.status !== 'no_account') {
    await bot.sendMessage(chatId, 'Не удалось получить статус подписки.');
    return;
  }

  if (result.status === 'no_account' || result.status === 'no_subscription') {
    await bot.sendMessage(chatId, 'У вас нет активной подписки.');
    return;
  }

  const tarifLabel = result.tarif?.replace('subscription_', '').replace('m', ' мес.') || result.tarif || 'Неизвестный';
  const expiresFormatted = result.tarifExpires
    ? result.tarifExpires.split('-').reverse().join('.')
    : '—';

  let statusEmoji = '✅';
  if (result.status === 'expiring_soon') statusEmoji = '⚠️';
  if (result.status === 'expired') statusEmoji = '❌';

  let text = `${statusEmoji} *Подписка*\n\n`;
  text += `📋 Тариф: ${tarifLabel}\n`;
  text += `📅 Активна до: ${expiresFormatted}\n`;
  if (result.daysLeft !== null) {
    text += `⏳ Осталось: ${result.daysLeft} дн.\n`;
  }

  const keyboard: TelegramBot.InlineKeyboardButton[][] = [];
  if (result.userAccountId) {
    // Determine renewal plan slug
    const renewSlug = (result.tarifRenewalCost >= 49000) ? '1m-49k' : '1m-29k';
    keyboard.push([{ text: '🔄 Продлить подписку', callback_data: `sub:renew:${renewSlug}` }]);
  }

  try {
    await bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard.length > 0 ? { inline_keyboard: keyboard } : undefined,
    });
  } catch {
    await bot.sendMessage(chatId, text.replace(/[*_`]/g, ''));
  }
}

// ======================================================================
// PROMPT GENERATION — call agent-service to generate AI prompts
// ======================================================================

async function generatePromptsForAccount(
  userId: string,
  adAccountId: string,
  data: Record<string, any>,
): Promise<void> {
  const url = `${PAYMENT_BASE_URL}/briefing/update-prompts`;
  try {
    const response = await axios.post(url, {
      user_id: userId,
      ad_account_id: adAccountId,
      business_name: data.business_name || '',
      business_niche: data.business_niche || '',
      target_audience: data.target_audience || '',
      geography: data.geography || '',
      main_services: data.main_services || '',
      competitive_advantages: data.competitive_advantages || '',
    }, { timeout: 120_000 });
    if (response.data?.success) {
      logger.info({ userId, adAccountId }, 'Prompts generated successfully');
    } else {
      logger.warn({ userId, adAccountId, error: response.data?.error }, 'Prompt generation returned error');
    }
  } catch (error: any) {
    logger.error({ userId, adAccountId, error: error.message }, 'Prompt generation HTTP call failed');
  }
}

// ======================================================================
// ONBOARDING — ad account setup (10 steps)
// ======================================================================

const ONBOARDING_STEPS = [
  'business_name',
  'business_niche',
  'target_audience',
  'geography',
  'main_services',
  'competitive_advantages',
  'ad_account_id',
  'page_id',
  'instagram_id',
  'partner_access',
] as const;

const TOTAL_STEPS = ONBOARDING_STEPS.length; // 10

const STEP_PROMPTS: Record<string, string> = {
  business_name: `📝 *Шаг 1/${TOTAL_STEPS}.* Как называется бизнес, который вы продвигаете?`,
  business_niche: `📝 *Шаг 2/${TOTAL_STEPS}.* Какая ниша у этого бизнеса?\n\n_Например: стоматология, фитнес, образование, автосервис_`,
  target_audience: `📝 *Шаг 3/${TOTAL_STEPS}.* Кто ваши клиенты?\n\n_Опишите целевую аудиторию: возраст, пол, интересы, потребности._`,
  geography: `📝 *Шаг 4/${TOTAL_STEPS}.* География работы?\n\n_Город, регион или страна, где вы работаете._`,
  main_services: `📝 *Шаг 5/${TOTAL_STEPS}.* Основные услуги или продукты?\n\n_Перечислите основные направления, которые продвигаете._`,
  competitive_advantages: `📝 *Шаг 6/${TOTAL_STEPS}.* Конкурентные преимущества?\n\n_Чем вы отличаетесь от конкурентов? Что делает вас особенными?_`,
  ad_account_id: `📝 *Шаг 7/${TOTAL_STEPS}.* Facebook Ad Account ID\n\nФормат: \`act_123456789\`\n\n_Найти: [business.facebook.com](https://business.facebook.com) → Настройки → Рекламные аккаунты._\n\n_Нужна помощь? [Написать в техподдержку](https://t.me/anatoliymarketolog)_`,
  page_id: `📝 *Шаг 8/${TOTAL_STEPS}.* Facebook Page ID (числовой)\n\n_Найти: [business.facebook.com](https://business.facebook.com) → Аккаунты → Страницы → выберите страницу → ID._\n\n_Нужна помощь? [Написать в техподдержку](https://t.me/anatoliymarketolog)_`,
  instagram_id: `📝 *Шаг 9/${TOTAL_STEPS}.* Instagram Account ID (числовой, напр. 17841...)\n\n_Это технический ID. Если не знаете — отправьте \`-\`, администратор настроит._\n\n_Нужна помощь? [Написать в техподдержку](https://t.me/anatoliymarketolog)_`,
};

function getPartnerAccessMessage(): string {
  return `📋 *Шаг ${TOTAL_STEPS}/${TOTAL_STEPS}. Партнёрский доступ*

Последний шаг — выдайте нам партнёрский доступ к рекламному кабинету:

1️⃣ Откройте [business.facebook.com](https://business.facebook.com) → Настройки
2️⃣ Аккаунты → *Страницы* → выберите страницу → "Назначить партнёра"
3️⃣ Выберите *ID компании* и введите: \`${PARTNER_BUSINESS_ID}\`
4️⃣ Выберите *Полный доступ* → "Назначить"
5️⃣ Повторите для *Рекламного аккаунта* и *Instagram*

После выдачи доступа нажмите кнопку ниже:`;
}

function nextStep(currentStep: string): string | null {
  const idx = ONBOARDING_STEPS.indexOf(currentStep as any);
  if (idx === -1 || idx >= ONBOARDING_STEPS.length - 1) return null;
  return ONBOARDING_STEPS[idx + 1];
}

async function sendStepPrompt(bot: TelegramBot, chatId: number, step: string): Promise<void> {
  const prompt = STEP_PROMPTS[step];
  if (!prompt) return;
  try {
    await bot.sendMessage(chatId, prompt, { parse_mode: 'Markdown', disable_web_page_preview: true });
  } catch {
    await bot.sendMessage(chatId, prompt.replace(/[*_`[\]()]/g, ''));
  }
}

export async function startOnboardingFlow(
  bot: TelegramBot,
  chatId: number,
  telegramId: number,
  userAccountId: string,
): Promise<void> {
  // Check if already in onboarding
  const existing = getPendingFlow(telegramId);
  if (existing?.flow === 'onboarding' && existing.data.userAccountId === userAccountId) {
    // Resume from current step
    const step = existing.step;
    if (step === 'partner_access') {
      await sendPartnerAccessStep(bot, chatId);
    } else {
      await sendStepPrompt(bot, chatId, step);
    }
    return;
  }

  await bot.sendMessage(chatId, '🚀 Давайте настроим ваш первый рекламный аккаунт!');

  pendingFlows.set(telegramId, {
    flow: 'onboarding',
    step: 'business_name',
    data: { userAccountId },
    startedAt: Date.now(),
  });

  await sendStepPrompt(bot, chatId, 'business_name');
}

export async function handleOnboardingInput(
  bot: TelegramBot,
  chatId: number,
  telegramId: number,
  text: string,
): Promise<boolean> {
  const flow = getPendingFlow(telegramId);
  if (!flow || flow.flow !== 'onboarding') return false;

  const step = flow.step;
  const trimmed = text.trim();

  // Validate and store based on current step
  switch (step) {
    case 'business_name': {
      if (trimmed.length < 2) {
        await bot.sendMessage(chatId, 'Название должно содержать минимум 2 символа. Попробуйте ещё раз:');
        return true;
      }
      flow.data.business_name = trimmed;
      break;
    }
    case 'business_niche': {
      if (trimmed.length < 2) {
        await bot.sendMessage(chatId, 'Укажите нишу (минимум 2 символа):');
        return true;
      }
      flow.data.business_niche = trimmed;
      break;
    }
    case 'target_audience': {
      if (trimmed.length < 3) {
        await bot.sendMessage(chatId, 'Опишите целевую аудиторию подробнее (минимум 3 символа):');
        return true;
      }
      flow.data.target_audience = trimmed;
      break;
    }
    case 'geography': {
      if (trimmed.length < 2) {
        await bot.sendMessage(chatId, 'Укажите географию (минимум 2 символа):');
        return true;
      }
      flow.data.geography = trimmed;
      break;
    }
    case 'main_services': {
      if (trimmed.length < 3) {
        await bot.sendMessage(chatId, 'Перечислите услуги/продукты (минимум 3 символа):');
        return true;
      }
      flow.data.main_services = trimmed;
      break;
    }
    case 'competitive_advantages': {
      if (trimmed.length < 3) {
        await bot.sendMessage(chatId, 'Опишите преимущества (минимум 3 символа):');
        return true;
      }
      flow.data.competitive_advantages = trimmed;
      break;
    }
    case 'ad_account_id': {
      if (!/^act_\d+$/.test(trimmed)) {
        await bot.sendMessage(chatId, '❌ Неверный формат. ID должен начинаться с `act_` и содержать только цифры.\n\nПример: `act_123456789`', { parse_mode: 'Markdown' });
        return true;
      }
      flow.data.fb_ad_account_id = trimmed;
      break;
    }
    case 'page_id': {
      if (!/^\d+$/.test(trimmed)) {
        await bot.sendMessage(chatId, '❌ Page ID должен содержать только цифры. Попробуйте ещё раз:');
        return true;
      }
      flow.data.fb_page_id = trimmed;
      break;
    }
    case 'instagram_id': {
      if (trimmed === '-') {
        flow.data.fb_instagram_id = null;
      } else if (!/^\d+$/.test(trimmed)) {
        await bot.sendMessage(chatId, '❌ Instagram ID должен содержать только цифры. Отправьте `-` чтобы пропустить.');
        return true;
      } else {
        flow.data.fb_instagram_id = trimmed;
      }
      break;
    }
    default:
      return false;
  }

  // Move to next step
  const next = nextStep(step);
  if (!next) {
    // Should not happen — partner_access is handled via callback
    return true;
  }

  flow.step = next;
  pendingFlows.set(telegramId, flow);

  if (next === 'partner_access') {
    await sendPartnerAccessStep(bot, chatId);
  } else {
    await sendStepPrompt(bot, chatId, next);
  }

  return true;
}

async function sendPartnerAccessStep(bot: TelegramBot, chatId: number): Promise<void> {
  const msg = getPartnerAccessMessage();
  try {
    await bot.sendMessage(chatId, msg, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Доступ выдан, продолжить', callback_data: 'onboard:done' }],
          [{ text: '❓ Нужна помощь', callback_data: 'onboard:help' }],
        ],
      },
    });
  } catch {
    await bot.sendMessage(chatId, msg.replace(/[*_`[\]()]/g, ''), {
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Доступ выдан, продолжить', callback_data: 'onboard:done' }],
          [{ text: '❓ Нужна помощь', callback_data: 'onboard:help' }],
        ],
      },
    });
  }
}

export async function handleOnboardingCallback(
  data: string,
  bot: TelegramBot,
  query: TelegramBot.CallbackQuery,
): Promise<boolean> {
  const chatId = query.message?.chat.id;
  const telegramId = query.from.id;
  if (!chatId) return false;

  if (data === 'onboard:start') {
    // Кнопка «Начать настройку» из уведомления об оплате (agent-service → community bot)
    const resolveResult = await callBrain('/brain/resolve-user', { telegram_id: telegramId });
    if (!resolveResult?.success || !resolveResult.userAccountId) {
      await bot.sendMessage(chatId, 'Не удалось найти ваш аккаунт. Отправьте любое сообщение чтобы начать.');
      return true;
    }
    await startOnboardingFlow(bot, chatId, telegramId, resolveResult.userAccountId);
    return true;
  }

  if (data === 'onboard:help') {
    const helpMsg = `📖 *Инструкция по выдаче партнёрского доступа*

1. Перейдите на [business.facebook.com](https://business.facebook.com)
2. Нажмите ⚙️ *Настройки* (внизу слева)
3. В меню слева: *Аккаунты* → *Страницы*
4. Выберите нужную страницу
5. Нажмите *"Назначить партнёра"*
6. Выберите *"ID компании"*
7. Введите ID: \`${PARTNER_BUSINESS_ID}\`
8. Поставьте *"Полный доступ (Всё, кроме ответственных действий)"*
9. Нажмите *"Назначить"*

Повторите те же шаги для:
• *Рекламного аккаунта* (Аккаунты → Рекламные аккаунты)
• *Instagram* (Аккаунты → Аккаунты Instagram)

Если возникли сложности — напишите нам, поможем! 🤝`;

    try {
      await bot.sendMessage(chatId, helpMsg, { parse_mode: 'Markdown', disable_web_page_preview: true });
    } catch {
      await bot.sendMessage(chatId, helpMsg.replace(/[*_`[\]()]/g, ''));
    }
    return true;
  }

  if (data === 'onboard:done') {
    const flow = getPendingFlow(telegramId);
    if (!flow || flow.flow !== 'onboarding') {
      await bot.sendMessage(chatId, 'Сессия онбординга истекла. Отправьте любое сообщение чтобы начать заново.');
      return true;
    }

    // Create ad_account
    await bot.sendMessage(chatId, '⏳ Создаём рекламный аккаунт...');

    const result = await callBrain('/brain/add-ad-account', {
      user_account_id: flow.data.userAccountId,
      name: flow.data.business_name || 'Мой аккаунт',
      fb_ad_account_id: flow.data.fb_ad_account_id || null,
      fb_page_id: flow.data.fb_page_id || null,
      fb_instagram_id: flow.data.fb_instagram_id || null,
      business_niche: flow.data.business_niche || null,
      target_audience: flow.data.target_audience || null,
      geography: flow.data.geography || null,
      main_services: flow.data.main_services || null,
      competitive_advantages: flow.data.competitive_advantages || null,
    });

    if (!result.success) {
      await bot.sendMessage(chatId, `❌ Ошибка создания аккаунта: ${result.message || result.error}`);
      return true;
    }

    // Generate AI prompts in background (don't block the user)
    if (result.accountId && flow.data.business_name) {
      generatePromptsForAccount(flow.data.userAccountId, result.accountId, flow.data).catch(err => {
        logger.warn({ error: err.message, accountId: result.accountId }, 'Prompt generation failed (non-critical)');
      });
    }

    clearPendingFlow(telegramId);

    // Edit the partner access message to remove buttons
    if (query.message?.message_id) {
      try {
        await bot.editMessageReplyMarkup(
          { inline_keyboard: [] },
          { chat_id: chatId, message_id: query.message.message_id },
        );
      } catch { /* ignore */ }
    }

    const successMsg = '🎉 *Рекламный аккаунт создан!*\n\n' +
      `📋 Название: ${flow.data.business_name}\n` +
      (flow.data.fb_ad_account_id ? `🔗 Ad Account: \`${flow.data.fb_ad_account_id}\`\n` : '') +
      '\nАдминистратор проверит партнёрский доступ и активирует аккаунт.\n' +
      'AI-промпты генерируются автоматически на основе ваших данных.\n\n' +
      'Отправьте любое сообщение чтобы продолжить.';

    try {
      await bot.sendMessage(chatId, successMsg, { parse_mode: 'Markdown' });
    } catch {
      await bot.sendMessage(chatId, successMsg.replace(/[*_`]/g, ''));
    }

    // Store in message history for context
    storeMessage({
      id: `onboard-${Date.now()}`,
      chat_id: String(chatId),
      sender: 'Claude',
      text: `Аккаунт "${flow.data.business_name}" создан. Ожидает активации.`,
      timestamp: new Date().toISOString(),
      is_from_me: true,
    });

    logger.info({
      telegramId,
      userId: flow.data.userAccountId,
      accountId: result.accountId,
      businessName: flow.data.business_name,
    }, 'Onboarding: ad account created');

    return true;
  }

  return false;
}
