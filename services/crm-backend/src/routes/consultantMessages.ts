import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { sendWhatsAppMessage } from '../lib/evolutionApi.js';
import { consultantAuthMiddleware, ConsultantAuthRequest } from '../middleware/consultantAuth.js';
import { getInstanceName } from '../lib/consultantNotifications.js';

/**
 * Routes для отправки сообщений консультантами
 */
export async function consultantMessagesRoutes(app: FastifyInstance) {
  // Применяем middleware ко всем роутам
  app.addHook('preHandler', consultantAuthMiddleware);

  /**
   * POST /consultant/send-message
   * Отправить сообщение лиду от имени консультанта
   */
  app.post('/consultant/send-message', async (request: ConsultantAuthRequest, reply) => {
    try {
      const consultantId = request.consultant?.id;
      const isAdmin = request.userRole === 'admin';
      const userAccountId = request.userAccountId;

      if (!consultantId && !isAdmin) {
        return reply.status(403).send({ error: 'Consultant only' });
      }

      const { leadId, message } = request.body as {
        leadId: string;
        message: string;
      };

      if (!leadId || !message) {
        return reply.status(400).send({ error: 'leadId and message are required' });
      }

      // Получаем информацию о лиде
      const { data: lead, error: leadError } = await supabase
        .from('dialog_analysis')
        .select('*')
        .eq('id', leadId)
        .single();

      if (leadError || !lead) {
        return reply.status(404).send({ error: 'Lead not found' });
      }

      // Проверяем доступ
      // Консультант может отправлять только своим лидам
      if (!isAdmin && consultantId !== lead.assigned_consultant_id) {
        return reply.status(403).send({
          error: 'Access denied',
          details: 'Вы можете отправлять сообщения только своим лидам'
        });
      }

      if (!lead.contact_phone) {
        return reply.status(400).send({
          error: 'Lead has no phone number',
          details: 'У лида нет телефона для отправки сообщения'
        });
      }

      // Получаем parent_user_account_id для поиска WhatsApp instance
      let parentUserAccountId: string | null = null;

      if (consultantId) {
        // Для консультанта - берём из request.consultant
        parentUserAccountId = request.consultant?.parent_user_account_id || null;
      } else if (isAdmin && lead.assigned_consultant_id) {
        // Для админа - получаем из assigned_consultant_id лида
        const { data: assignedConsultant } = await supabase
          .from('consultants')
          .select('parent_user_account_id')
          .eq('id', lead.assigned_consultant_id)
          .single();

        parentUserAccountId = assignedConsultant?.parent_user_account_id || null;
      }

      if (!parentUserAccountId) {
        return reply.status(500).send({
          error: 'Cannot determine user account',
          details: 'Не удалось определить аккаунт для отправки сообщения'
        });
      }

      // Получаем WhatsApp instance
      // Приоритет: instance из dialog_analysis → первый connected instance пользователя
      const instanceName = await getInstanceName(parentUserAccountId, leadId);

      if (!instanceName) {
        return reply.status(500).send({
          error: 'Evolution instance not configured',
          details: 'WhatsApp инстанс не настроен или не подключён'
        });
      }

      // Отправляем сообщение через Evolution API
      const result = await sendWhatsAppMessage({
        instanceName,
        phone: lead.contact_phone,
        message
      });

      if (!result.success) {
        app.log.error({
          leadId,
          consultantId,
          error: result.error
        }, 'Failed to send message via Evolution API');

        return reply.status(500).send({
          error: 'Failed to send message',
          details: result.error
        });
      }

      // Создаем объект сообщения
      const newMessage = {
        text: message,
        timestamp: new Date().toISOString(),
        from_me: true,
        is_system: false,
        sent_by_consultant: true,
        consultant_id: consultantId || null
      };

      // Обновляем историю сообщений в dialog_analysis
      const updatedMessages = [...(lead.messages || []), newMessage];

      const { error: updateError } = await supabase
        .from('dialog_analysis')
        .update({
          messages: updatedMessages,
          last_message: new Date().toISOString(),
          outgoing_count: (lead.outgoing_count || 0) + 1,
          assigned_to_human: true, // Устанавливаем флаг вмешательства консультанта
          updated_at: new Date().toISOString()
        })
        .eq('id', leadId);

      if (updateError) {
        app.log.error({
          leadId,
          consultantId,
          error: updateError
        }, 'Failed to update dialog_analysis');

        return reply.status(500).send({
          error: 'Failed to update message history',
          details: updateError.message
        });
      }

      app.log.info({
        leadId,
        consultantId,
        phone: lead.contact_phone,
        messageId: result.key?.id
      }, 'Consultant sent message to lead');

      return reply.status(200).send({
        success: true,
        message: 'Message sent successfully',
        messageId: result.key?.id,
        assigned_to_human: true
      });

    } catch (error: any) {
      app.log.error({ error }, 'Error sending consultant message');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /consultant/messages/:leadId
   * Получить историю сообщений с лидом
   */
  app.get('/consultant/messages/:leadId', async (request: ConsultantAuthRequest, reply) => {
    try {
      const { leadId } = request.params as { leadId: string };
      const consultantId = request.consultant?.id;
      const isAdmin = request.userRole === 'admin';

      // Получаем лида
      const { data: lead, error: leadError } = await supabase
        .from('dialog_analysis')
        .select('id, assigned_consultant_id, messages, contact_name, contact_phone')
        .eq('id', leadId)
        .single();

      if (leadError || !lead) {
        return reply.status(404).send({ error: 'Lead not found' });
      }

      // Проверяем доступ
      if (!isAdmin && consultantId !== lead.assigned_consultant_id) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      // Трансформируем структуру сообщений для frontend
      const transformedMessages = (lead.messages || []).map((msg: any) => {
        // Если сообщение от бота (новый формат с sender/content)
        if (msg.sender && !msg.text) {
          return {
            text: msg.content || '',
            from_me: msg.sender === 'bot',
            timestamp: msg.timestamp,
            is_system: msg.is_system || false
          };
        }
        // Если сообщение от консультанта (формат с text/from_me) или уже трансформированное
        return {
          text: msg.text || msg.content || '',
          from_me: msg.from_me !== undefined ? msg.from_me : (msg.sender === 'bot'),
          timestamp: msg.timestamp,
          is_system: msg.is_system || false
        };
      });

      return reply.send({
        leadId: lead.id,
        contactName: lead.contact_name,
        contactPhone: lead.contact_phone,
        messages: transformedMessages
      });

    } catch (error: any) {
      app.log.error({ error }, 'Error fetching messages');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /consultant/release-lead/:leadId
   * Вернуть лида боту (сбросить assigned_to_human)
   */
  app.post('/consultant/release-lead/:leadId', async (request: ConsultantAuthRequest, reply) => {
    try {
      const { leadId } = request.params as { leadId: string };
      const consultantId = request.consultant?.id;
      const isAdmin = request.userRole === 'admin';

      // Получаем лида
      const { data: lead, error: leadError } = await supabase
        .from('dialog_analysis')
        .select('id, assigned_consultant_id')
        .eq('id', leadId)
        .single();

      if (leadError || !lead) {
        return reply.status(404).send({ error: 'Lead not found' });
      }

      // Проверяем доступ
      if (!isAdmin && consultantId !== lead.assigned_consultant_id) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      // Сбрасываем флаг вмешательства
      const { error: updateError } = await supabase
        .from('dialog_analysis')
        .update({
          assigned_to_human: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', leadId);

      if (updateError) {
        app.log.error({ leadId, error: updateError }, 'Failed to release lead');
        return reply.status(500).send({ error: updateError.message });
      }

      app.log.info({ leadId, consultantId }, 'Lead released back to bot');

      return reply.send({
        success: true,
        message: 'Lead released back to bot'
      });

    } catch (error: any) {
      app.log.error({ error }, 'Error releasing lead');
      return reply.status(500).send({ error: error.message });
    }
  });
}
