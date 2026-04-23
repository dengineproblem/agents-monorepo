/**
 * Mirror исходящих сообщений меню в admin_user_chats,
 * чтобы админ в веб-чате видел что показало меню пользователю.
 *
 * Используем source='bot' (в отличие от AI-ответов с source='ai'),
 * direction='to_user'.
 *
 * Промежуточные "⏳ Загружаю..." НЕ мирорим — они потом перезаписываются
 * через editMessageText и в admin_user_chats имеют смысл только как
 * финальный итог. Мирорим только конечные тексты ответов.
 */

import { supabase } from '../supabase.js';
import { createLogger } from '../logger.js';

const log = createLogger({ module: 'telegramMenuMirror' });

export async function mirrorMenuReply(
  userAccountId: string,
  telegramChatId: number | string,
  content: string,
): Promise<void> {
  if (!content || !content.trim()) return;

  try {
    const { error } = await supabase.from('admin_user_chats').insert({
      user_account_id: userAccountId,
      telegram_id: String(telegramChatId),
      direction: 'to_user',
      source: 'bot',
      message: content,
      delivered: true,
    });

    if (error) {
      log.warn({ error: error.message, userAccountId }, 'mirrorMenuReply: insert failed');
    }
  } catch (err: any) {
    log.warn({ error: String(err), userAccountId }, 'mirrorMenuReply: threw');
  }
}
