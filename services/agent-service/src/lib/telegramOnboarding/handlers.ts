/**
 * Обработчики сообщений для Telegram онбординга
 *
 * Роутинг команд и сообщений к соответствующим функциям state machine
 */

import { createLogger } from '../logger.js';
import { sendTelegramNotification } from '../telegramNotifier.js';
import { supabase } from '../supabase.js';
import { transcribeVoiceMessage, type TelegramVoice } from './voiceHandler.js';
import { analyzePhoto } from './photoHandler.js';
import { getStep } from './steps.js';
import {
  getSession,
  startOnboarding,
  processAnswer,
  skipStep,
  goBack,
  showStatus,
  resetSession,
  type TelegramUser,
  type BotResponse,
} from './stateMachine.js';

const log = createLogger({ module: 'telegramOnboardingHandlers' });

/**
 * Проверяет, прошёл ли пользователь онбординг (есть prompt1)
 * Если telegram_id привязан к нескольким аккаунтам - берём любой с prompt1
 */
async function hasCompletedOnboarding(telegramId: string): Promise<boolean> {
  const { data: users, error } = await supabase
    .from('user_accounts')
    .select('id, prompt1')
    .eq('telegram_id', telegramId);

  // Ищем хотя бы одного пользователя с prompt1
  const userWithPrompt = users?.find(u => u.prompt1);

  log.info({
    telegramId,
    foundUsers: users?.length || 0,
    hasUserWithPrompt1: !!userWithPrompt,
    error: error?.message
  }, 'hasCompletedOnboarding check');

  // Есть хотя бы один пользователь с prompt1 - значит онбординг пройден
  return !!userWithPrompt;
}

// =====================================================
// Типы
// =====================================================

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser & { id: number };
  date: number;
  text?: string;
  voice?: TelegramVoice;
  photo?: { file_id: string; width: number; height: number }[];
  caption?: string;
  chat: {
    id: number;
    type: string;
  };
}

export interface HandleResult {
  handled: boolean;
  error?: string;
}

// =====================================================
// Главный обработчик
// =====================================================

/**
 * Главный обработчик сообщений онбординга
 *
 * Возвращает:
 * - { handled: true } если сообщение обработано как онбординг
 * - { handled: false } если сообщение должно обрабатываться стандартной логикой
 */
export async function handleOnboardingMessage(message: TelegramMessage): Promise<HandleResult> {
  if (!message.from?.id) {
    return { handled: false };
  }

  const telegramId = String(message.from.id);
  const chatId = message.chat.id;

  // Флаг: пользователь точно в процессе онбординга (прошёл проверки сессии)
  // Используется в catch чтобы не показывать sendStartHint активным пользователям
  let userInOnboarding = false;

  try {
    // ===================================================
    // Проверяем, прошёл ли пользователь онбординг (есть prompt1)
    // Если да - не обрабатываем как онбординг, пусть идёт в обычный чат
    // ===================================================
    const alreadyOnboarded = await hasCompletedOnboarding(telegramId);

    log.info({ telegramId, alreadyOnboarded }, 'Checking onboarding status');

    if (alreadyOnboarded) {
      log.info({ telegramId }, 'User already completed onboarding, skipping to regular chat');
      // Не обрабатываем - пусть сообщение уйдёт в обычный чат с поддержкой
      return { handled: false };
    }

    // Проверяем, есть ли активная сессия онбординга
    const session = await getSession(telegramId);

    // Обработка команды /start
    if (message.text === '/start') {
      const response = await startOnboarding(telegramId, {
        id: message.from.id,
        first_name: message.from.first_name,
        last_name: message.from.last_name,
        username: message.from.username,
        language_code: message.from.language_code,
      });

      await sendBotResponse(chatId, response);
      return { handled: true };
    }

    // Если нет сессии или сессия завершена - не обрабатываем
    if (!session || session.is_completed) {
      return { handled: false };
    }

    // С этой точки пользователь точно в активном онбординге
    userInOnboarding = true;

    // Обработка команд
    if (message.text) {
      const text = message.text.trim();

      // /skip - пропустить вопрос
      if (text === '/skip') {
        const response = await skipStep(telegramId);
        await sendBotResponse(chatId, response);
        return { handled: true };
      }

      // /back - вернуться назад
      if (text === '/back') {
        const response = await goBack(telegramId);
        await sendBotResponse(chatId, response);
        return { handled: true };
      }

      // /status - показать прогресс
      if (text === '/status') {
        const response = await showStatus(telegramId);
        await sendBotResponse(chatId, response);
        return { handled: true };
      }

      // /restart - начать заново
      if (text === '/restart') {
        await resetSession(telegramId);
        const response = await startOnboarding(telegramId, {
          id: message.from.id,
          first_name: message.from.first_name,
          last_name: message.from.last_name,
          username: message.from.username,
          language_code: message.from.language_code,
        });
        await sendBotResponse(chatId, response);
        return { handled: true };
      }

      // /help - показать справку
      if (text === '/help') {
        await sendTelegramNotification(
          chatId,
          `<b>Команды бота:</b>

/start - начать регистрацию
/skip - пропустить вопрос (только необязательные)
/back - вернуться к предыдущему вопросу
/status - показать прогресс
/restart - начать заново
/help - показать эту справку

🎤 Вы можете отвечать текстом или голосовыми сообщениями!`,
          { source: 'onboarding' }
        );
        return { handled: true };
      }

      // Обычный текст - обрабатываем как ответ
      const response = await processAnswer(telegramId, text);
      await sendBotResponse(chatId, response);
      return { handled: true };
    }

    // Обработка фото
    if (message.photo) {
      try {
        await sendTypingAction(chatId);

        const largestPhoto = message.photo[message.photo.length - 1];
        const currentStep = getStep(session.current_step);

        if (!currentStep) {
          await sendTelegramNotification(
            chatId,
            `📷 Не удалось определить текущий вопрос. Пожалуйста, ответьте текстом или голосом.`,
            { source: 'onboarding' }
          );
          return { handled: true };
        }

        const analysis = await analyzePhoto(largestPhoto.file_id, currentStep);

        if (!analysis.success || !analysis.text) {
          await sendTelegramNotification(
            chatId,
            `⚠️ ${analysis.error || 'Не удалось обработать фото.'} Пожалуйста, ответьте текстом или голосом.`,
            { source: 'onboarding' }
          );
          return { handled: true };
        }

        // Показываем что распознали и принимаем как ответ
        await sendTelegramNotification(
          chatId,
          `📷 <i>Распознано из фото:</i> "${analysis.text}"`,
          { source: 'onboarding' }
        );

        const response = await processAnswer(telegramId, analysis.text);
        await sendBotResponse(chatId, response);
      } catch (photoError) {
        log.error({ error: String(photoError), telegramId }, 'Unexpected error processing photo');
        try {
          await sendTelegramNotification(
            chatId,
            `⚠️ Не удалось обработать фото. Пожалуйста, ответьте текстом или голосом — прогресс анкеты сохранён.`,
            { source: 'onboarding' }
          );
        } catch {}
      }
      return { handled: true };
    }

    // Обработка голосовых сообщений
    if (message.voice) {
      log.info(
        { telegramId, duration: message.voice.duration },
        'Processing voice message for onboarding'
      );

      // Отправляем "печатает..."
      await sendTypingAction(chatId);

      // Транскрибируем
      const transcription = await transcribeVoiceMessage(message.voice);

      if (!transcription.success || !transcription.text) {
        await sendTelegramNotification(
          chatId,
          `⚠️ ${transcription.error || 'Не удалось распознать речь. Попробуйте ещё раз или отправьте текстом.'}`,
          { source: 'onboarding' }
        );
        return { handled: true };
      }

      // Показываем что распознали
      await sendTelegramNotification(
        chatId,
        `🎤 <i>Распознано:</i> "${transcription.text}"`,
        { source: 'onboarding' }
      );

      // Обрабатываем как текстовый ответ
      const response = await processAnswer(telegramId, transcription.text);
      await sendBotResponse(chatId, response);
      return { handled: true };
    }

    return { handled: false };
  } catch (error) {
    log.error({ error: String(error), telegramId }, 'Error handling onboarding message');
    // Если пользователь был в активном онбординге — сообщаем об ошибке и НЕ отдаём
    // handled: false (иначе telegramWebhook вызовет sendStartHint и /start сбросит сессию)
    if (userInOnboarding) {
      try {
        await sendTelegramNotification(
          String(chatId),
          `⚠️ Произошла ошибка при обработке сообщения. Попробуйте ещё раз — прогресс анкеты сохранён.`,
          { source: 'onboarding' }
        );
      } catch {}
      return { handled: true };
    }
    return { handled: false, error: String(error) };
  }
}

// =====================================================
// Вспомогательные функции
// =====================================================

/**
 * Отправить ответ бота (может быть несколько сообщений)
 */
async function sendBotResponse(chatId: number | string, response: BotResponse): Promise<void> {
  for (const message of response.messages) {
    await sendTelegramNotification(String(chatId), message, { source: 'onboarding' });
    // Небольшая задержка между сообщениями
    if (response.messages.length > 1) {
      await sleep(300);
    }
  }
}

/**
 * Отправить "печатает..." в чат
 */
async function sendTypingAction(chatId: number | string): Promise<void> {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

  try {
    await fetch(`${TELEGRAM_API_URL}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        action: 'typing',
      }),
    });
  } catch (error) {
    // Игнорируем ошибки - это не критично
  }
}

/**
 * Задержка
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Проверить, находится ли пользователь в процессе онбординга
 */
export async function isInOnboarding(telegramId: string): Promise<boolean> {
  const session = await getSession(telegramId);
  return session !== null && !session.is_completed;
}
