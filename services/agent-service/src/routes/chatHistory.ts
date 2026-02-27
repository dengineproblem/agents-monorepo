/**
 * Chat History API Routes
 *
 * Provides API endpoints for chat history (n8n_chat_histories) and follow-up management.
 * Replaces direct Supabase queries from the frontend for RLS security.
 *
 * Real table schemas:
 *   n8n_chat_histories: id (int), session_id (text), message (jsonb {type, content, ...})
 *   follow_up_simple: chat_id (text, PK), funnel_stage, funnel_updated_at, status,
 *     is_enabled, source_id, conversion_source, creative_url, sale_amount, ...
 *
 * @module routes/chatHistory
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger({ module: 'chatHistoryRoutes' });

export default async function chatHistoryRoutes(app: FastifyInstance) {

  /**
   * GET /chat-history
   *
   * Получить все чаты (группировка по session_id на бэкенде).
   * Дополняем метаданными из follow_up_simple.
   *
   * NB: n8n_chat_histories не содержит user_account_id —
   * старый фронтенд тоже грузил все чаты без фильтра по пользователю.
   */
  app.get('/chat-history', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.headers['x-user-id'] as string;
    if (!userId) {
      return reply.code(401).send({ error: 'User ID required' });
    }

    try {
      // Загружаем все сообщения (без фильтра по user — колонки нет)
      const { data, error } = await supabase
        .from('n8n_chat_histories')
        .select('*')
        .order('id', { ascending: false });

      if (error) {
        log.error({ error: error.message, userId }, 'Failed to fetch chat histories');
        return reply.code(500).send({ error: error.message });
      }

      if (!data || data.length === 0) {
        return reply.send({ chats: [] });
      }

      // Собираем уникальные session_id для подтяжки метаданных из follow_up_simple
      const sessionIds = [...new Set(data.map((m: any) => m.session_id))];

      // Подтягиваем follow_up_simple для всех session_id
      const { data: followUps } = await supabase
        .from('follow_up_simple')
        .select('*')
        .in('chat_id', sessionIds);

      const followUpMap: Record<string, any> = {};
      if (followUps) {
        followUps.forEach((fu: any) => {
          followUpMap[fu.chat_id] = fu;
        });
      }

      // Группируем сообщения по session_id
      const chatGroups: Record<string, any[]> = {};
      data.forEach((message: any) => {
        const sid = message.session_id;
        if (!chatGroups[sid]) {
          chatGroups[sid] = [];
        }
        chatGroups[sid].push(message);
      });

      // Создаем чаты из групп
      const chats = Object.entries(chatGroups).map(([sessionId, messages]) => {
        const lastMessage = messages[0]; // уже отсортированы по убыванию id
        const messageJson = lastMessage.message as any;
        const fu = followUpMap[sessionId];

        return {
          session_id: sessionId,
          client_name: `Клиент ${sessionId}`,
          phone: sessionId,
          last_message: messageJson?.content || 'Нет сообщений',
          last_message_time: null, // n8n_chat_histories не содержит created_at
          funnel_stage: fu?.funnel_stage || 'неопределен',
          source: 'неизвестно',
          unread_count: 0,
          priority: null,
          conversion_source: fu?.conversion_source || undefined,
          creative_url: fu?.creative_url || undefined,
        };
      });

      log.info({ userId, count: chats.length }, 'Chat histories fetched');
      return reply.send({ chats });
    } catch (err: any) {
      log.error({ error: String(err), userId }, 'Exception in GET /chat-history');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /chat-history/:chatId/messages
   *
   * Получить сообщения для конкретного чата.
   * chatId = session_id в n8n_chat_histories.
   */
  app.get('/chat-history/:chatId/messages', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.headers['x-user-id'] as string;
    if (!userId) {
      return reply.code(401).send({ error: 'User ID required' });
    }

    const { chatId } = request.params as { chatId: string };

    try {
      const { data: messagesData, error } = await supabase
        .from('n8n_chat_histories')
        .select('*')
        .eq('session_id', chatId)
        .order('id', { ascending: true });

      if (error) {
        log.error({ error: error.message, userId, chatId }, 'Failed to fetch chat messages');
        return reply.code(500).send({ error: error.message });
      }

      if (!messagesData || messagesData.length === 0) {
        return reply.send({ messages: [] });
      }

      // Преобразуем данные в нужный формат
      const messages = messagesData.map((msg: any) => {
        const messageJson = msg.message as any;

        let sender: 'client' | 'bot' | 'manager' = 'client';
        if (messageJson?.type === 'ai') {
          sender = 'bot';
        } else if (messageJson?.type === 'manager') {
          sender = 'manager';
        } else if (messageJson?.type === 'human') {
          sender = 'client';
        }

        return {
          id: msg.id.toString(),
          sender,
          message: messageJson?.content || 'Сообщение без содержимого',
          timestamp: null, // n8n_chat_histories не содержит created_at
        };
      });

      log.info({ userId, chatId, count: messages.length }, 'Chat messages fetched');
      return reply.send({ messages });
    } catch (err: any) {
      log.error({ error: String(err), userId, chatId: (request.params as any).chatId }, 'Exception in GET /chat-history/:chatId/messages');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /chat-history/:chatId/last-message
   *
   * Получить последнее сообщение для чата
   */
  app.get('/chat-history/:chatId/last-message', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.headers['x-user-id'] as string;
    if (!userId) {
      return reply.code(401).send({ error: 'User ID required' });
    }

    const { chatId } = request.params as { chatId: string };

    try {
      const { data: messagesData, error } = await supabase
        .from('n8n_chat_histories')
        .select('message')
        .eq('session_id', chatId)
        .order('id', { ascending: false })
        .limit(1);

      if (error) {
        log.error({ error: error.message, userId, chatId }, 'Failed to fetch last message');
        return reply.code(500).send({ error: error.message });
      }

      if (!messagesData || messagesData.length === 0) {
        return reply.send({ content: null });
      }

      const messageJson = messagesData[0].message as any;
      return reply.send({ content: messageJson?.content || null });
    } catch (err: any) {
      log.error({ error: String(err), userId, chatId: (request.params as any).chatId }, 'Exception in GET /chat-history/:chatId/last-message');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /chat-history/:chatId/follow-up
   *
   * Получить запись follow_up_simple для чата.
   * Проверяем что chat_id существует в n8n_chat_histories (по session_id).
   */
  app.get('/chat-history/:chatId/follow-up', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.headers['x-user-id'] as string;
    if (!userId) {
      return reply.code(401).send({ error: 'User ID required' });
    }

    const { chatId } = request.params as { chatId: string };

    try {
      // Проверяем, что chatId существует в n8n_chat_histories
      const { data: chatExists, error: existsError } = await supabase
        .from('n8n_chat_histories')
        .select('id')
        .eq('session_id', chatId)
        .limit(1);

      if (existsError || !chatExists || chatExists.length === 0) {
        return reply.code(404).send({ error: 'Chat not found' });
      }

      const { data, error } = await supabase
        .from('follow_up_simple')
        .select('*')
        .eq('chat_id', chatId)
        .maybeSingle();

      if (error) {
        log.error({ error: error.message, userId, chatId }, 'Failed to fetch follow-up');
        return reply.code(500).send({ error: error.message });
      }

      return reply.send({ followUp: data || null });
    } catch (err: any) {
      log.error({ error: String(err), userId, chatId: (request.params as any).chatId }, 'Exception in GET /chat-history/:chatId/follow-up');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * PUT /chat-history/:chatId/follow-up
   *
   * Обновить / создать запись follow_up_simple для чата (funnel stage).
   * Frontend отправляет { message: funnelStage } — маппим на funnel_stage колонку.
   *
   * follow_up_simple не имеет колонки id и message.
   * Реальные колонки: chat_id (PK), funnel_stage, funnel_updated_at, status, ...
   */
  app.put('/chat-history/:chatId/follow-up', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.headers['x-user-id'] as string;
    if (!userId) {
      return reply.code(401).send({ error: 'User ID required' });
    }

    const { chatId } = request.params as { chatId: string };
    const { message } = request.body as { message: string };

    if (!message) {
      return reply.code(400).send({ error: 'message is required' });
    }

    try {
      // Проверяем, что chatId существует в n8n_chat_histories
      const { data: chatExists, error: existsError } = await supabase
        .from('n8n_chat_histories')
        .select('id')
        .eq('session_id', chatId)
        .limit(1);

      if (existsError || !chatExists || chatExists.length === 0) {
        return reply.code(404).send({ error: 'Chat not found' });
      }

      // Проверяем, есть ли уже запись (используем chat_id — это PK, нет колонки id)
      const { data: existingRecord, error: selectError } = await supabase
        .from('follow_up_simple')
        .select('chat_id')
        .eq('chat_id', chatId)
        .maybeSingle();

      if (selectError) {
        log.error({ error: selectError.message, userId, chatId }, 'Failed to check existing follow-up');
        return reply.code(500).send({ error: selectError.message });
      }

      if (existingRecord) {
        // Обновляем существующую запись — funnel_stage вместо message
        const { error: updateError } = await supabase
          .from('follow_up_simple')
          .update({
            funnel_stage: message,
            funnel_updated_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('chat_id', chatId);

        if (updateError) {
          log.error({ error: updateError.message, userId, chatId }, 'Failed to update follow-up');
          return reply.code(500).send({ error: updateError.message });
        }
      } else {
        // Создаем новую запись
        const { error: insertError } = await supabase
          .from('follow_up_simple')
          .insert({
            chat_id: chatId,
            funnel_stage: message,
            funnel_updated_at: new Date().toISOString(),
            status: 'waiting',
            is_enabled: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });

        if (insertError) {
          log.error({ error: insertError.message, userId, chatId }, 'Failed to insert follow-up');
          return reply.code(500).send({ error: insertError.message });
        }
      }

      log.info({ userId, chatId, funnel_stage: message }, 'Follow-up updated');
      return reply.send({ success: true });
    } catch (err: any) {
      log.error({ error: String(err), userId, chatId: (request.params as any).chatId }, 'Exception in PUT /chat-history/:chatId/follow-up');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
