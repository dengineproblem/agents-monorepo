/**
 * Обработка фото из Telegram во время онбординга
 *
 * - Скачивание фото через Telegram API
 * - Анализ содержимого через GPT-4o vision
 * - Извлечение текста релевантного текущему вопросу
 */

import { OpenAI } from 'openai';
import { createLogger } from '../logger.js';
import type { OnboardingStep } from './steps.js';

const log = createLogger({ module: 'telegramPhotoHandler' });

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const TELEGRAM_FILE_URL = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}`;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export interface PhotoAnalysisResult {
  success: boolean;
  text?: string;
  error?: string;
}

/**
 * Получает URL файла через Telegram API
 */
async function getFileUrl(fileId: string): Promise<string | null> {
  try {
    const response = await fetch(`${TELEGRAM_API_URL}/getFile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId }),
    });

    const result = (await response.json()) as { ok: boolean; result?: { file_path?: string } };

    if (result.ok && result.result?.file_path) {
      return `${TELEGRAM_FILE_URL}/${result.result.file_path}`;
    }

    log.error({ result }, 'Failed to get file info from Telegram');
    return null;
  } catch (error) {
    log.error({ error: String(error) }, 'Error calling Telegram getFile');
    return null;
  }
}

/**
 * Формирует системный промпт для анализа фото в контексте текущего вопроса
 */
function buildVisionPrompt(step: OnboardingStep): string {
  const fieldPrompts: Record<string, string> = {
    business_name: 'Пользователь прислал фото чтобы показать название своего бизнеса. Извлеки название бизнеса из фото (логотип, вывеска, брендинг). Верни только название, без пояснений.',
    business_niche: 'Пользователь прислал фото своего бизнеса. Определи нишу по изображению. Верни краткое описание ниши (1-2 слова), без пояснений.',
    instagram_url: 'Пользователь прислал скриншот Instagram профиля. Найди и верни ссылку или @username аккаунта. Только ссылку, без пояснений.',
    website_url: 'Пользователь прислал скриншот сайта. Найди и верни URL сайта. Только URL, без пояснений.',
    target_audience: 'Пользователь прислал фото, описывающее целевую аудиторию его бизнеса. Извлеки или опиши целевую аудиторию на основе изображения. Ответ в 1-2 предложениях.',
    main_pains: 'Пользователь прислал фото, связанное с болями или проблемами его клиентов. Опиши проблемы клиентов, которые видны на фото. Ответ в 1-2 предложениях.',
    main_services: 'Пользователь прислал фото своих услуг или продуктов. Перечисли основные услуги или продукты, которые видны на фото. Список через запятую.',
    competitive_advantages: 'Пользователь прислал фото своих конкурентных преимуществ (награды, сертификаты, команда, оборудование и т.д.). Опиши преимущества, которые видны на фото. Ответ в 1-2 предложениях.',
    social_proof: 'Пользователь прислал фото с социальными доказательствами (отзывы, скриншоты, сертификаты, награды, статистика). Извлеки ключевые данные: цифры, рейтинги, цитаты из отзывов, названия наград. Ответ в 2-3 предложениях.',
    main_promises: 'Пользователь прислал фото, связанное с обещаниями или результатами для клиентов. Опиши обещания или результаты, которые видны на фото. Ответ в 1-2 предложениях.',
    guarantees: 'Пользователь прислал фото с информацией о гарантиях. Извлеки условия гарантий. Ответ в 1-2 предложениях.',
    tone_of_voice: 'Пользователь прислал фото своего бренда. Опиши тон коммуникации на основе визуального стиля. Одно слово или короткая фраза.',
    competitor_instagrams: 'Пользователь прислал скриншот Instagram с конкурентами. Найди и верни @username аккаунтов конкурентов через запятую.',
  };

  const defaultPrompt = `Пользователь прислал фото отвечая на вопрос анкеты: "${step.question}". Извлеки из фото информацию, релевантную этому вопросу. Ответ давай коротко и по делу, без вводных фраз типа "На фото видно..." — сразу суть.`;

  return fieldPrompts[step.field] || defaultPrompt;
}

/**
 * Анализирует фото из Telegram через GPT-4o vision
 */
export async function analyzePhoto(
  fileId: string,
  step: OnboardingStep
): Promise<PhotoAnalysisResult> {
  log.info({ fileId, stepField: step.field }, 'Analyzing photo for onboarding');

  // Получаем URL файла
  const fileUrl = await getFileUrl(fileId);
  if (!fileUrl) {
    return {
      success: false,
      error: 'Не удалось загрузить фото. Попробуйте ещё раз или ответьте текстом.',
    };
  }

  try {
    const prompt = buildVisionPrompt(step);

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: prompt,
            },
            {
              type: 'image_url',
              image_url: { url: fileUrl, detail: 'low' },
            },
          ],
        },
      ],
    });

    const text = response.choices[0]?.message?.content?.trim();

    if (!text) {
      return {
        success: false,
        error: 'Не удалось извлечь информацию из фото. Пожалуйста, ответьте текстом.',
      };
    }

    log.info({ stepField: step.field, textLength: text.length }, 'Photo analyzed successfully');

    return { success: true, text };
  } catch (error: any) {
    log.error({ error: error.message, stepField: step.field }, 'GPT-4o vision failed');
    return {
      success: false,
      error: 'Ошибка при анализе фото. Пожалуйста, ответьте текстом или отправьте /skip.',
    };
  }
}
