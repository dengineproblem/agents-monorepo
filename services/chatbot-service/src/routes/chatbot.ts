import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { sendWhatsAppMessage } from '../lib/chatbotEngine.js';

export default async function chatbotRoutes(app: FastifyInstance) {
  
  /**
   * POST /chatbot/pause
   * Остановить бота для лида
   */
  app.post('/chatbot/pause', async (request, reply) => {
    try {
      const { leadId, duration } = request.body as { 
        leadId: string; 
        duration?: number; // В часах
      };

      if (!leadId) {
        return reply.status(400).send({ error: 'leadId is required' });
      }

      const update: any = { bot_paused: true };
      
      if (duration) {
        const pausedUntil = new Date();
        pausedUntil.setHours(pausedUntil.getHours() + duration);
        update.bot_paused_until = pausedUntil.toISOString();
      }

      const { error } = await supabase
        .from('dialog_analysis')
        .update(update)
        .eq('id', leadId);

      if (error) throw error;

      app.log.info({ leadId, duration }, 'Bot paused for lead');

      return reply.send({ 
        success: true, 
        message: duration ? `Bot paused for ${duration} hours` : 'Bot paused indefinitely'
      });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Error pausing bot');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /chatbot/resume
   * Возобновить бота для лида
   */
  app.post('/chatbot/resume', async (request, reply) => {
    try {
      const { leadId } = request.body as { leadId: string };

      if (!leadId) {
        return reply.status(400).send({ error: 'leadId is required' });
      }

      const { error } = await supabase
        .from('dialog_analysis')
        .update({
          bot_paused: false,
          bot_paused_until: null
        })
        .eq('id', leadId);

      if (error) throw error;

      app.log.info({ leadId }, 'Bot resumed for lead');

      return reply.send({ success: true, message: 'Bot resumed' });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Error resuming bot');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /chatbot/take-over
   * Менеджер берёт лида в работу (бот останавливается)
   */
  app.post('/chatbot/take-over', async (request, reply) => {
    try {
      const { leadId } = request.body as { leadId: string };

      if (!leadId) {
        return reply.status(400).send({ error: 'leadId is required' });
      }

      const { error } = await supabase
        .from('dialog_analysis')
        .update({
          assigned_to_human: true,
          bot_paused: true
        })
        .eq('id', leadId);

      if (error) throw error;

      app.log.info({ leadId }, 'Lead taken over by human manager');

      return reply.send({ success: true, message: 'Lead assigned to human' });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Error taking over lead');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /chatbot/return-to-bot
   * Вернуть лида боту (менеджер освобождает)
   */
  app.post('/chatbot/return-to-bot', async (request, reply) => {
    try {
      const { leadId } = request.body as { leadId: string };

      if (!leadId) {
        return reply.status(400).send({ error: 'leadId is required' });
      }

      const { error } = await supabase
        .from('dialog_analysis')
        .update({
          assigned_to_human: false,
          bot_paused: false,
          bot_paused_until: null,
          has_unread: false, // Сбрасываем непрочитанные при возврате боту
          last_consultant_message_at: null // Очищаем время последнего сообщения консультанта
        })
        .eq('id', leadId);

      if (error) throw error;

      app.log.info({
        leadId: leadId.substring(0, 8) + '...',
        hasUnreadReset: true,
        lastConsultantMessageAtCleared: true
      }, 'Lead returned to bot - reset unread flags and consultant message timestamp');

      return reply.send({ success: true, message: 'Lead returned to bot' });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Error returning lead to bot');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /chatbot/send-follow-up
   * Отправить догоняющее сообщение вручную
   */
  app.post('/chatbot/send-follow-up', async (request, reply) => {
    try {
      const { leadId, message } = request.body as { 
        leadId: string; 
        message?: string;
      };

      if (!leadId) {
        return reply.status(400).send({ error: 'leadId is required' });
      }

      // Получить информацию о лиде
      const { data: lead, error: leadError } = await supabase
        .from('dialog_analysis')
        .select('instance_name, contact_phone, contact_name')
        .eq('id', leadId)
        .single();

      if (leadError || !lead) {
        return reply.status(404).send({ error: 'Lead not found' });
      }

      const followUpMessage = message || `${lead.contact_name || 'Здравствуйте'}, есть ещё вопросы? С радостью помогу! 😊`;

      await sendWhatsAppMessage(
        lead.instance_name,
        lead.contact_phone,
        followUpMessage,
        app
      );

      // Обновить время последнего сообщения
      await supabase
        .from('dialog_analysis')
        .update({ last_bot_message_at: new Date().toISOString() })
        .eq('id', leadId);

      app.log.info({ leadId }, 'Follow-up message sent');

      return reply.send({ success: true, message: 'Follow-up sent' });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Error sending follow-up');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /chatbot/status/:leadId
   * Получить статус бота для лида
   */
  app.get('/chatbot/status/:leadId', async (request, reply) => {
    try {
      const { leadId } = request.params as { leadId: string };

      const { data: lead, error } = await supabase
        .from('dialog_analysis')
        .select('assigned_to_human, bot_paused, bot_paused_until, last_bot_message_at')
        .eq('id', leadId)
        .single();

      if (error || !lead) {
        return reply.status(404).send({ error: 'Lead not found' });
      }

      let status = 'active';
      if (lead.assigned_to_human) {
        status = 'human_assigned';
      } else if (lead.bot_paused) {
        status = 'paused';
      } else if (lead.bot_paused_until && new Date(lead.bot_paused_until) > new Date()) {
        status = 'paused_temporarily';
      }

      return reply.send({
        status,
        assigned_to_human: lead.assigned_to_human,
        bot_paused: lead.bot_paused,
        bot_paused_until: lead.bot_paused_until,
        last_bot_message_at: lead.last_bot_message_at
      });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Error getting bot status');
      return reply.status(500).send({ error: error.message });
    }
  });
}

