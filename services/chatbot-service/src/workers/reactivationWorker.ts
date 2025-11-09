import { redis } from '../lib/redis.js';
import { supabase } from '../lib/supabase.js';
import { generateReactivationMessage } from '../lib/reactivationEngine.js';
import { sendWhatsAppMessage } from '../lib/chatbotEngine.js';
import { FastifyInstance } from 'fastify';

/**
 * Воркер для отправки реанимационных сообщений
 * Проверяет очередь каждую минуту и отправляет сообщения по расписанию
 */
export function startReactivationWorker(app: FastifyInstance) {
  // Запускать каждую минуту
  setInterval(async () => {
    try {
      const now = Date.now();
      
      // Получить сообщения, которые пора отправить (score <= now)
      const items = await redis.zrangebyscore(
        'reactivation_queue',
        0,
        now,
        'LIMIT', 0, 10 // Максимум 10 за раз
      );
      
      if (items.length === 0) {
        return; // Нечего отправлять
      }
      
      app.log.info({ count: items.length }, 'Processing reactivation messages');
      
      for (const item of items) {
        try {
          const { leadId, scheduledAt } = JSON.parse(item);
          
          // Получить информацию о лиде
          const { data: lead, error: leadError } = await supabase
            .from('dialog_analysis')
            .select('*')
            .eq('id', leadId)
            .single();
          
          if (leadError || !lead) {
            app.log.error({ leadId, error: leadError }, 'Lead not found');
            await redis.zrem('reactivation_queue', item);
            continue;
          }
          
          // Проверить, что бот может отправить сообщение
          if (lead.assigned_to_human || lead.bot_paused) {
            app.log.debug({ leadId }, 'Lead assigned to human or bot paused, skipping');
            await redis.zrem('reactivation_queue', item);
            continue;
          }
          
          // Сгенерировать персонализированное сообщение
          const message = await generateReactivationMessage(leadId, app);
          
          // Отправить сообщение
          await sendWhatsAppMessage(
            lead.instance_name,
            lead.contact_phone,
            message,
            app
          );
          
          // Обновить лида
          await supabase
            .from('dialog_analysis')
            .update({
              last_bot_message_at: new Date().toISOString(),
              last_reactivation_at: new Date().toISOString(),
              reactivation_attempts: (lead.reactivation_attempts || 0) + 1
            })
            .eq('id', leadId);
          
          // Удалить из очереди
          await redis.zrem('reactivation_queue', item);
          
          app.log.info({ 
            leadId, 
            contactPhone: lead.contact_phone,
            attempt: (lead.reactivation_attempts || 0) + 1
          }, 'Reactivation message sent');
          
        } catch (itemError: any) {
          app.log.error({ 
            error: itemError.message,
            item 
          }, 'Error processing reactivation item');
          
          // Удалить проблемный item из очереди
          await redis.zrem('reactivation_queue', item);
        }
      }
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Error in reactivation worker');
    }
  }, 60000); // Каждую минуту
  
  app.log.info('Reactivation worker started (every 1 minute)');
}

