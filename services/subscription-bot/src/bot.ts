import TelegramBot from 'node-telegram-bot-api';
import crypto from 'crypto';
import { config, getAllPlans, getPlan, type SubscriptionPlan } from './config.js';
import { supabase } from './lib/supabase.js';
import { createLogger } from './lib/logger.js';
import { buildPaymentPageUrl } from './lib/robokassa.js';
import { createInviteLink } from './lib/telegram.js';
import type { BotSubscription, UserAccount } from './types.js';

const logger = createLogger({ module: 'bot' });

let botInstance: TelegramBot | null = null;

export function getBotInstance(): TelegramBot | null {
  return botInstance;
}

export function initBot(): TelegramBot {
  const bot = new TelegramBot(config.telegramBotToken, { polling: true });
  botInstance = bot;

  bot.onText(/\/start/, handleStart);
  bot.onText(/\/plans/, handlePlans);
  bot.onText(/\/renew/, handlePlans);
  bot.onText(/\/status/, handleStatus);
  bot.on('callback_query', handleCallbackQuery);

  logger.info('Telegram bot initialized (polling)');
  return bot;
}

async function handleStart(msg: TelegramBot.Message) {
  const bot = botInstance!;
  const telegramId = msg.from!.id;
  const firstName = msg.from!.first_name || '';

  try {
    const sub = await getSubscription(telegramId);

    if (!sub) {
      await bot.sendMessage(msg.chat.id,
        `Привет${firstName ? `, ${firstName}` : ''}! 👋\n\n` +
        `Добро пожаловать! Здесь вы можете оформить подписку и получить доступ в закрытый канал комьюнити.\n\n` +
        `Выберите тариф:`,
        { reply_markup: buildPlansKeyboard() }
      );
      return;
    }

    const user = await getUserAccount(sub.user_account_id);
    const isActive = user && user.tarif_expires && user.tarif_expires >= todayString();

    if (isActive) {
      await bot.sendMessage(msg.chat.id,
        `${firstName ? `${firstName}, в` : 'В'}аша подписка активна ✅\n\n` +
        `📋 Тариф: ${sub.current_plan_slug || '—'}\n` +
        `📅 Активна до: ${user!.tarif_expires}\n` +
        `📺 Канал: ${sub.channel_status === 'active' ? 'доступ есть' : sub.channel_status === 'invited' ? 'приглашение отправлено' : 'нет доступа'}\n\n` +
        `Используйте /status для проверки статуса или /renew для продления.`
      );
    } else {
      await bot.sendMessage(msg.chat.id,
        `${firstName ? `${firstName}, в` : 'В'}аша подписка истекла ⏰\n\n` +
        `Продлите подписку, чтобы вернуть доступ в канал:`,
        { reply_markup: buildPlansKeyboard() }
      );
    }
  } catch (err: any) {
    logger.error({ telegramId, error: err.message }, 'Error in /start');
    await bot.sendMessage(msg.chat.id, 'Произошла ошибка. Попробуйте позже.');
  }
}

async function handlePlans(msg: TelegramBot.Message) {
  const bot = botInstance!;
  try {
    await bot.sendMessage(msg.chat.id,
      'Выберите тариф подписки:',
      { reply_markup: buildPlansKeyboard() }
    );
  } catch (err: any) {
    logger.error({ error: err.message }, 'Error in /plans');
    await bot.sendMessage(msg.chat.id, 'Произошла ошибка. Попробуйте позже.');
  }
}

async function handleStatus(msg: TelegramBot.Message) {
  const bot = botInstance!;
  const telegramId = msg.from!.id;

  try {
    const sub = await getSubscription(telegramId);

    if (!sub) {
      await bot.sendMessage(msg.chat.id,
        'У вас пока нет подписки.\n\nИспользуйте /plans чтобы выбрать тариф.'
      );
      return;
    }

    const user = await getUserAccount(sub.user_account_id);
    const isActive = user && user.tarif_expires && user.tarif_expires >= todayString();

    const statusEmoji = isActive ? '✅' : '❌';
    const channelStatus = {
      none: 'нет доступа',
      invited: 'приглашение отправлено',
      active: 'доступ есть',
      kicked: 'доступ отозван',
    }[sub.channel_status] || sub.channel_status;

    await bot.sendMessage(msg.chat.id,
      `📊 Статус подписки ${statusEmoji}\n\n` +
      `📋 Тариф: ${sub.current_plan_slug || '—'}\n` +
      `📅 Действует до: ${user?.tarif_expires || '—'}\n` +
      `📺 Канал: ${channelStatus}\n\n` +
      (isActive ? '' : 'Подписка неактивна. Используйте /renew для продления.')
    );
  } catch (err: any) {
    logger.error({ telegramId, error: err.message }, 'Error in /status');
    await bot.sendMessage(msg.chat.id, 'Произошла ошибка. Попробуйте позже.');
  }
}

async function handleCallbackQuery(query: TelegramBot.CallbackQuery) {
  const bot = botInstance!;
  const data = query.data;
  const chatId = query.message!.chat.id;
  const telegramId = query.from.id;

  if (!data?.startsWith('plan:')) {
    await bot.answerCallbackQuery(query.id);
    return;
  }

  const slug = data.slice(5);
  const plan = getPlan(slug);

  if (!plan) {
    await bot.answerCallbackQuery(query.id, { text: 'Тариф не найден' });
    return;
  }

  try {
    await bot.answerCallbackQuery(query.id);

    const paymentId = crypto.randomUUID();
    const paymentUrl = buildPaymentPageUrl({
      plan,
      telegramId,
      paymentId,
    });

    await bot.sendMessage(chatId,
      `💳 Оплата: ${plan.title}\n` +
      `💰 Сумма: ${plan.amount.toLocaleString('ru-KZ')} KZT\n` +
      `📅 Период: ${plan.months} мес.\n\n` +
      `Нажмите кнопку ниже для оплаты:`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: `Оплатить ${plan.amount.toLocaleString('ru-KZ')} KZT`, url: paymentUrl },
          ]],
        },
      }
    );

    logger.info({ telegramId, plan: slug, paymentId }, 'Payment link sent');
  } catch (err: any) {
    logger.error({ telegramId, plan: slug, error: err.message }, 'Error creating payment link');
    await bot.sendMessage(chatId, 'Ошибка при создании ссылки на оплату. Попробуйте позже.');
  }
}

function buildPlansKeyboard(): TelegramBot.InlineKeyboardMarkup {
  const plans = getAllPlans();
  return {
    inline_keyboard: plans.map(plan => ([{
      text: `${plan.title} — ${plan.amount.toLocaleString('ru-KZ')} KZT`,
      callback_data: `plan:${plan.slug}`,
    }])),
  };
}

async function getSubscription(telegramId: number): Promise<BotSubscription | null> {
  const { data, error } = await supabase
    .from('bot_subscriptions')
    .select('*')
    .eq('telegram_id', telegramId)
    .maybeSingle<BotSubscription>();

  if (error) {
    logger.error({ telegramId, error: error.message }, 'Failed to get subscription');
    return null;
  }
  return data;
}

async function getUserAccount(userAccountId: string): Promise<UserAccount | null> {
  const { data, error } = await supabase
    .from('user_accounts')
    .select('id, telegram_id, tarif, tarif_expires, tarif_renewal_cost, is_active, multi_account_enabled, created_at')
    .eq('id', userAccountId)
    .maybeSingle<UserAccount>();

  if (error) {
    logger.error({ userAccountId, error: error.message }, 'Failed to get user account');
    return null;
  }
  return data;
}

export async function notifyPaymentSuccess(
  telegramId: number,
  plan: SubscriptionPlan,
  tarifExpires: string
): Promise<void> {
  const bot = botInstance;
  if (!bot) {
    logger.error('Bot not initialized, cannot notify');
    return;
  }

  try {
    const inviteLink = await createInviteLink(bot);

    // Update subscription with invite info
    await supabase
      .from('bot_subscriptions')
      .update({
        channel_status: 'invited',
        last_invite_link: inviteLink,
        last_invite_at: new Date().toISOString(),
      })
      .eq('telegram_id', telegramId);

    await bot.sendMessage(telegramId,
      `✅ Оплата получена!\n\n` +
      `📋 Тариф: ${plan.title}\n` +
      `📅 Активна до: ${tarifExpires}\n\n` +
      `🔗 Ваша ссылка для входа в канал (одноразовая):`,
    );

    await bot.sendMessage(telegramId, inviteLink);

    logger.info({ telegramId, plan: plan.slug, tarifExpires }, 'Payment notification sent with invite link');
  } catch (err: any) {
    logger.error({ telegramId, error: err.message }, 'Failed to send payment notification');
  }
}

function todayString(): string {
  const now = new Date();
  // Almaty offset UTC+5
  const shifted = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}
