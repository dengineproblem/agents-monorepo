/**
 * Саммаризация диалога для примечаний к консультации
 * Использует OpenAI для создания краткого резюме разговора
 *
 * Features:
 * - AI-powered саммаризация диалогов
 * - Извлечение информации о клиенте
 * - Структурированное логирование
 */

import OpenAI from 'openai';
import { supabase } from './supabase.js';
import { createLogger } from './logger.js';

const log = createLogger({ module: 'dialogSummarizer' });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Получает историю диалога из dialog_analysis
 */
async function getDialogHistory(dialogAnalysisId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('dialog_analysis')
    .select('dialog_history')
    .eq('id', dialogAnalysisId)
    .single();

  if (error || !data?.dialog_history) {
    return [];
  }

  // dialog_history может быть массивом объектов {role, content} или строкой
  const history = data.dialog_history;

  if (Array.isArray(history)) {
    return history.map((msg: any) => {
      if (typeof msg === 'string') return msg;
      if (msg.role && msg.content) {
        const role = msg.role === 'assistant' ? 'Бот' : 'Клиент';
        return `${role}: ${msg.content}`;
      }
      return JSON.stringify(msg);
    });
  }

  if (typeof history === 'string') {
    return [history];
  }

  return [];
}

/**
 * Саммаризирует диалог с клиентом
 * @param dialogAnalysisId - ID записи в dialog_analysis
 * @param maxLength - максимальная длина саммари (по умолчанию 500 символов)
 * @returns краткое резюме диалога
 */
export async function summarizeDialog(
  dialogAnalysisId: string,
  maxLength: number = 500
): Promise<string> {
  const startTime = Date.now();

  log.info({
    dialogAnalysisId,
    maxLength
  }, '[summarizeDialog] Starting dialog summarization');

  try {
    const messages = await getDialogHistory(dialogAnalysisId);

    if (messages.length === 0) {
      log.warn({ dialogAnalysisId }, '[summarizeDialog] No dialog history found');
      return 'История диалога недоступна';
    }

    // Берём последние 20 сообщений для контекста
    const recentMessages = messages.slice(-20);
    const dialogText = recentMessages.join('\n');

    log.debug({
      totalMessages: messages.length,
      usedMessages: recentMessages.length,
      dialogTextLength: dialogText.length
    }, '[summarizeDialog] Dialog history loaded');

    // Если диалог короткий, возвращаем как есть
    if (dialogText.length <= maxLength) {
      log.info({
        dialogAnalysisId,
        elapsedMs: Date.now() - startTime,
        action: 'returned_as_is'
      }, '[summarizeDialog] Dialog is short, returning as is');
      return dialogText;
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Ты помощник, который создаёт краткие резюме диалогов для менеджеров.

Твоя задача: создать краткое резюме диалога между ботом и клиентом.

Формат резюме:
- Суть запроса клиента
- Ключевые моменты разговора
- Текущий статус/результат

Максимальная длина: ${maxLength} символов.
Пиши кратко, по делу, без воды.`
        },
        {
          role: 'user',
          content: `Создай краткое резюме этого диалога:\n\n${dialogText}`
        }
      ],
      temperature: 0.3,
      max_tokens: Math.ceil(maxLength / 2)
    });

    const summary = response.choices[0]?.message?.content?.trim();

    if (!summary) {
      log.warn({
        dialogAnalysisId,
        hasResponse: !!response.choices[0],
        elapsedMs: Date.now() - startTime
      }, '[summarizeDialog] OpenAI returned empty summary');
      return 'Не удалось создать резюме';
    }

    log.info({
      dialogAnalysisId,
      summaryLength: summary.length,
      truncated: summary.length > maxLength,
      promptTokens: response.usage?.prompt_tokens,
      completionTokens: response.usage?.completion_tokens,
      elapsedMs: Date.now() - startTime
    }, '[summarizeDialog] Dialog summarized successfully');

    // Обрезаем если превышает лимит
    if (summary.length > maxLength) {
      return summary.substring(0, maxLength - 3) + '...';
    }

    return summary;
  } catch (error: any) {
    log.error({
      error: error?.message || error,
      dialogAnalysisId,
      maxLength
    }, '[summarizeDialog] Error summarizing dialog');
    return 'Ошибка при создании резюме';
  }
}

/**
 * Получает информацию о клиенте из dialog_analysis
 */
export async function getClientInfo(dialogAnalysisId: string): Promise<{
  name: string | null;
  phone: string | null;
  chatId: string | null;
  instanceName: string | null;
  userAccountId: string | null;
}> {
  const { data, error } = await supabase
    .from('dialog_analysis')
    .select('contact_name, contact_phone, instance_name, user_account_id')
    .eq('id', dialogAnalysisId)
    .single();

  if (error || !data) {
    log.warn({
      dialogAnalysisId,
      error: error?.message || 'No data returned'
    }, '[getClientInfo] Failed to get client info');
    return {
      name: null,
      phone: null,
      chatId: null,
      instanceName: null,
      userAccountId: null
    };
  }

  return {
    name: data.contact_name || null,
    phone: data.contact_phone || null,
    chatId: null, // chat_id not in dialog_analysis table
    instanceName: data.instance_name || null,
    userAccountId: data.user_account_id || null
  };
}
