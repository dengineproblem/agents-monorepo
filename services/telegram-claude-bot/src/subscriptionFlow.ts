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
  { slug: 'test-500', label: '💳 Оформить подписку — 500 ₸ (тест)', amount: 500 },
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

  const keyboard = SUBSCRIPTION_PLANS.map(plan => [
    { text: plan.label, callback_data: `plan:${plan.slug}` },
  ]);

  await bot.sendMessage(chatId,
    '👋 Добро пожаловать в Performante AI!\n\n' +
    'Для начала работы оформите подписку:',
    { reply_markup: { inline_keyboard: keyboard } },
  );

  pendingFlows.set(telegramId, {
    flow: 'subscription',
    step: 'select_plan',
    data: {},
    startedAt: Date.now(),
  });
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

    // Self-register (create user_accounts with is_active=false)
    await bot.sendMessage(chatId, '⏳ Создаём аккаунт...');

    const registerResult = await callBrain('/brain/self-register', {
      telegram_id: telegramId,
      first_name: query.from.first_name,
      last_name: query.from.last_name,
    });

    let userId: string;
    if (registerResult.success) {
      userId = registerResult.userAccountId;
    } else if (registerResult.error === 'telegram_id_already_registered') {
      userId = registerResult.userAccountId;
    } else {
      await bot.sendMessage(chatId, `Ошибка регистрации: ${registerResult.error || 'unknown'}`);
      return true;
    }

    // Build payment URL
    const paymentUrl = `${PAYMENT_BASE_URL}/robokassa/redirect?plan=${slug}&user_id=${userId}`;

    // Edit original message or send new
    if (query.message?.message_id) {
      try {
        await bot.editMessageText(
          `Аккаунт создан. Нажмите кнопку ниже для оплаты подписки (${plan.amount} ₸):`,
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: {
              inline_keyboard: [
                [{ text: `💳 Оплатить ${plan.amount} ₸`, url: paymentUrl }],
              ],
            },
          },
        );
      } catch {
        await bot.sendMessage(chatId,
          `Нажмите кнопку ниже для оплаты подписки (${plan.amount} ₸):`,
          { reply_markup: { inline_keyboard: [[{ text: `💳 Оплатить ${plan.amount} ₸`, url: paymentUrl }]] } },
        );
      }
    }

    pendingFlows.set(telegramId, {
      flow: 'subscription',
      step: 'awaiting_payment',
      data: { slug, paymentUrl, userId },
      startedAt: Date.now(),
    });

    logger.info({ telegramId, slug, userId }, 'Subscription: payment URL sent');
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
    const renewSlug = 'test-500'; // TODO: resolve from current tarif
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
// ONBOARDING — ad account setup (7 steps)
// ======================================================================

const ONBOARDING_STEPS = [
  'business_name',
  'business_niche',
  'instagram_url',
  'ad_account_id',
  'page_id',
  'instagram_id',
  'partner_access',
] as const;

const STEP_PROMPTS: Record<string, string> = {
  business_name: '📝 *Шаг 1/7.* Как называется ваш бизнес?',
  business_niche: '📝 *Шаг 2/7.* Какая у вас ниша? (напр. стоматология, фитнес, образование)',
  instagram_url: '📝 *Шаг 3/7.* Instagram вашего бизнеса?\n\n_Отправьте ссылку или @username. Отправьте `-` чтобы пропустить._',
  ad_account_id: '📝 *Шаг 4/7.* Facebook Ad Account ID\n\nФормат: `act_123456789`\n\n_Найти можно в Facebook Ads Manager → Настройки рекламного аккаунта._',
  page_id: '📝 *Шаг 5/7.* Facebook Page ID (числовой)\n\n_Найти: откройте вашу страницу Facebook → О странице → ID страницы._',
  instagram_id: '📝 *Шаг 6/7.* Instagram Account ID (числовой, напр. 17841...)\n\n_Это технический ID. Если не знаете — отправьте `-`, администратор настроит._',
};

function getPartnerAccessMessage(): string {
  return `📋 *Шаг 7/7. Партнёрский доступ*

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
    await bot.sendMessage(chatId, prompt, { parse_mode: 'Markdown' });
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
    case 'instagram_url': {
      if (trimmed === '-') {
        flow.data.instagram_url = null;
      } else {
        // Normalize: extract handle from URL or @username
        let handle = trimmed;
        handle = handle.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '');
        handle = handle.replace(/^@/, '');
        handle = handle.replace(/[/?].*$/, ''); // remove query/trailing
        flow.data.instagram_url = handle ? `https://instagram.com/${handle}` : null;
      }
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
    });

    if (!result.success) {
      await bot.sendMessage(chatId, `❌ Ошибка создания аккаунта: ${result.message || result.error}`);
      return true;
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
      'После активации вы сможете пользоваться всеми функциями бота.\n\n' +
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
