import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { notifyAdminGroup, APP_BASE_URL } from '../lib/notificationService.js';

const log = createLogger({ module: 'supportEscalations' });

const REASON_LABELS: Record<string, string> = {
  refund_request: 'Запрос возврата / отказ от подписки',
  password_reset: 'Сброс пароля',
  fb_account_auth: 'Вход в учётки FB/IG (2FA/коды)',
  whatsapp_code: 'Привязка WhatsApp (коды подтверждения)',
  legal_invoice: 'Счёт на ТОО/ИП',
  cabinet_blocked: 'Блокировка / ограничения кабинета',
  bitrix_box: 'Bitrix24 Коробка',
  voice_message: 'Голосовое сообщение',
  multiple_retries_failed: 'Юзер 3+ раз переспросил, бот не продвинулся',
  card_number_detected: 'Обнаружен номер карты',
  manual_request: 'Юзер явно попросил человека',
  other: 'Прочее',
};

export default async function supportEscalationsRoutes(app: FastifyInstance) {
  app.post('/internal/support-escalations', async (req, res) => {
    const body = req.body as {
      user_account_id: string;
      conversation_id?: string;
      reason: string;
      category?: string;
      summary: string;
      business_name?: string;
      context_messages?: Array<{ role: string; content: string }>;
    };

    const {
      user_account_id,
      conversation_id,
      reason,
      category,
      summary,
      business_name,
      context_messages,
    } = body;

    if (!user_account_id || !reason || !summary) {
      return res.status(400).send({ error: 'user_account_id, reason, summary are required' });
    }

    const { data: row, error: insErr } = await supabase
      .from('support_escalations')
      .insert({
        user_account_id,
        conversation_id: conversation_id ?? null,
        reason,
        category: category ?? null,
        summary,
        context_messages: context_messages ?? null,
      })
      .select()
      .single();

    if (insErr) {
      log.error({ error: insErr.message, user_account_id }, 'Failed to insert support escalation');
      return res.status(500).send({ error: 'db_insert_failed' });
    }

    const reasonLabel = REASON_LABELS[reason] ?? reason;
    const ctxLines = (context_messages ?? [])
      .slice(-3)
      .map(m => `> ${m.role === 'user' ? '👤' : '🤖'} ${m.content.slice(0, 300)}`)
      .join('\n');

    const message = [
      '🆘 *Эскалация в тех.поддержке*',
      '',
      `Юзер: ${business_name ?? '(без имени)'} (id: \`${user_account_id}\`)`,
      `Причина: ${reasonLabel}`,
      category ? `Категория: ${category}` : null,
      '',
      `*Суть:* ${summary}`,
      '',
      ctxLines ? `*Последние сообщения:*\n${ctxLines}` : null,
      '',
      `[Открыть чат](${APP_BASE_URL}/admin/chats?user=${user_account_id})`,
    ].filter(Boolean).join('\n');

    const sent = await notifyAdminGroup(message);

    if (sent) {
      await supabase
        .from('support_escalations')
        .update({ notified_at: new Date().toISOString() })
        .eq('id', row.id);
    } else {
      log.warn({ escalation_id: row.id }, 'notifyAdminGroup returned false');
    }

    return res.send({ success: true, escalation_id: row.id, notified: sent });
  });
}
