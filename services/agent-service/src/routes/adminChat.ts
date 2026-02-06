/**
 * Admin Chat Routes
 *
 * API для чата между админами и пользователями через Telegram
 * - Получение истории сообщений
 * - Отправка сообщений пользователям
 * - Подсчёт непрочитанных
 *
 * @module routes/adminChat
 */

import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { sendTelegramNotification } from '../lib/telegramNotifier.js';
import { logErrorToAdmin } from '../lib/errorLogger.js';

const log = createLogger({ module: 'adminChat' });

// =====================================================
// Типы
// =====================================================

interface ChatMessage {
  id: string;
  user_account_id: string;
  direction: 'to_user' | 'from_user';
  message: string;
  admin_id: string | null;
  telegram_message_id: number | null;
  delivered: boolean;
  read_at: string | null;
  created_at: string;
}

interface SendMessageBody {
  message: string;
}

// =====================================================
// Routes
// =====================================================

export default async function adminChatRoutes(app: FastifyInstance) {

  /**
   * GET /admin/chats/:userId
   * Получает историю сообщений с пользователем
   * Ищет по user_account_id и telegram_id (для полной истории включая онбординг)
   */
  app.get('/admin/chats/:userId', async (req, res) => {
    try {
      const { userId } = req.params as { userId: string };
      const { limit = '1000', offset = '0' } = req.query as { limit?: string; offset?: string };

      // Получаем информацию о пользователе (включая telegram_id)
      const { data: user } = await supabase
        .from('user_accounts')
        .select('id, username, telegram_id')
        .eq('id', userId)
        .single();

      // Ищем сообщения по user_account_id ИЛИ telegram_id (только source='bot' или 'admin')
      let query = supabase
        .from('admin_user_chats')
        .select('*')
        .in('source', ['bot', 'admin'])
        .order('created_at', { ascending: true });

      if (user?.telegram_id) {
        // Если есть telegram_id - ищем по обоим полям
        query = query.or(`user_account_id.eq.${userId},telegram_id.eq.${user.telegram_id}`);
      } else {
        // Если нет telegram_id - только по user_account_id
        query = query.eq('user_account_id', userId);
      }

      const { data: messages, error } = await query
        .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

      if (error) {
        log.error({ error: error.message, userId }, 'Failed to fetch chat messages');
        return res.status(500).send({ error: 'Failed to fetch messages' });
      }

      return res.send({
        messages: messages || [],
        user: user || null,
        hasTelegram: !!user?.telegram_id
      });
    } catch (err: any) {
      log.error({ error: String(err) }, 'Error fetching chat messages');

      logErrorToAdmin({
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'admin_get_chat_messages',
        endpoint: '/admin/chats/:userId',
        severity: 'warning'
      }).catch(() => {});

      return res.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /admin/chats/:userId
   * Отправляет сообщение пользователю через Telegram
   */
  app.post('/admin/chats/:userId', async (req, res) => {
    try {
      const { userId } = req.params as { userId: string };
      const { message } = req.body as SendMessageBody;
      const adminId = req.headers['x-user-id'] as string;

      if (!message || message.trim().length === 0) {
        return res.status(400).send({ error: 'Message is required' });
      }

      // Получаем telegram_id пользователя
      const { data: user, error: userError } = await supabase
        .from('user_accounts')
        .select('telegram_id, username')
        .eq('id', userId)
        .single();

      if (userError || !user) {
        log.error({ error: userError?.message, userId }, 'User not found');
        return res.status(404).send({ error: 'User not found' });
      }

      if (!user.telegram_id) {
        return res.status(400).send({ error: 'User has no Telegram ID' });
      }

      // Отправляем в Telegram (с логированием и source='admin')
      const sent = await sendTelegramNotification(user.telegram_id, message, {
        userAccountId: userId,
        source: 'admin',
        skipLog: true // Логируем вручную ниже с admin_id
      });

      if (!sent) {
        log.error({ userId, username: user.username }, 'Failed to send message to Telegram');
        return res.status(500).send({ error: 'Failed to send message to Telegram' });
      }

      // Сохраняем сообщение в БД (с admin_id)
      const { data: chatMessage, error: insertError } = await supabase
        .from('admin_user_chats')
        .insert({
          user_account_id: userId,
          direction: 'to_user',
          message: message.trim(),
          admin_id: adminId || null,
          source: 'admin',
          delivered: true
        })
        .select()
        .single();

      if (insertError) {
        log.error({ error: insertError.message, userId }, 'Failed to save chat message');
        // Сообщение отправлено, но не сохранено - не критично
      }

      log.info({
        userId,
        username: user.username,
        adminId,
        messageLength: message.length
      }, 'Message sent to user');

      return res.send({
        success: true,
        message: chatMessage || { message, direction: 'to_user', created_at: new Date().toISOString() }
      });
    } catch (err: any) {
      log.error({ error: String(err) }, 'Error sending chat message');

      logErrorToAdmin({
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'admin_send_chat_message',
        endpoint: '/admin/chats/:userId',
        severity: 'warning'
      }).catch(() => {});

      return res.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /admin/chats/:userId/mark-read
   * Отмечает все сообщения от пользователя как прочитанные
   */
  app.post('/admin/chats/:userId/mark-read', async (req, res) => {
    try {
      const { userId } = req.params as { userId: string };

      const { error } = await supabase
        .from('admin_user_chats')
        .update({ read_at: new Date().toISOString() })
        .eq('user_account_id', userId)
        .in('source', ['bot', 'admin'])
        .eq('direction', 'from_user')
        .is('read_at', null);

      if (error) {
        log.error({ error: error.message, userId }, 'Failed to mark messages as read');
        return res.status(500).send({ error: 'Failed to mark messages as read' });
      }

      return res.send({ success: true });
    } catch (err: any) {
      log.error({ error: String(err) }, 'Error marking messages as read');

      logErrorToAdmin({
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'admin_mark_chat_read',
        endpoint: '/admin/chats/:userId/mark-read',
        severity: 'warning'
      }).catch(() => {});

      return res.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /admin/chats/unread-count
   * Получает количество непрочитанных сообщений по всем пользователям
   */
  app.get('/admin/chats/unread-count', async (_req, res) => {
    try {
      // Общее количество непрочитанных (только source='bot' или 'admin')
      const { count: totalUnread } = await supabase
        .from('admin_user_chats')
        .select('*', { count: 'exact', head: true })
        .in('source', ['bot', 'admin'])
        .eq('direction', 'from_user')
        .is('read_at', null);

      // Количество пользователей с непрочитанными сообщениями
      const { data: usersWithUnread } = await supabase
        .from('admin_user_chats')
        .select('user_account_id')
        .in('source', ['bot', 'admin'])
        .eq('direction', 'from_user')
        .is('read_at', null);

      const uniqueUsers = new Set(usersWithUnread?.map(m => m.user_account_id) || []);

      return res.send({
        count: totalUnread || 0,  // Для совместимости с frontend
        totalUnread: totalUnread || 0,
        usersWithUnread: uniqueUsers.size
      });
    } catch (err: any) {
      log.error({ error: String(err) }, 'Error getting unread count');

      logErrorToAdmin({
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'admin_get_unread_count',
        endpoint: '/admin/chats/unread-count',
        severity: 'warning'
      }).catch(() => {});

      return res.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /admin/chats/unread/:userId
   * Получает количество непрочитанных сообщений от конкретного пользователя
   */
  app.get('/admin/chats/unread/:userId', async (req, res) => {
    try {
      const { userId } = req.params as { userId: string };

      const { count } = await supabase
        .from('admin_user_chats')
        .select('*', { count: 'exact', head: true })
        .eq('user_account_id', userId)
        .in('source', ['bot', 'admin'])
        .eq('direction', 'from_user')
        .is('read_at', null);

      return res.send({ unreadCount: count || 0 });
    } catch (err: any) {
      log.error({ error: String(err) }, 'Error getting user unread count');

      logErrorToAdmin({
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'admin_get_user_unread_count',
        endpoint: '/admin/chats/unread/:userId',
        severity: 'warning'
      }).catch(() => {});

      return res.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /admin/chats/users-with-messages
   * Получает список пользователей, с которыми есть переписка
   * ОПТИМИЗИРОВАНО: Один проход по данным вместо O(n²)
   */
  app.get('/admin/chats/users-with-messages', async (req, res) => {
    try {
      const { limit = '20', offset = '0', search = '' } = req.query as {
        limit?: string;
        offset?: string;
        search?: string;
      };

      const { data, error } = await supabase.rpc('get_chat_users_with_last_message', {
        p_source_filter: ['bot', 'admin'],
        p_search: search.trim() || null,
        p_limit: parseInt(limit),
        p_offset: parseInt(offset),
      });

      if (error) {
        log.error({ error: error.message }, 'Failed to fetch users with messages');
        return res.status(500).send({ error: 'Failed to fetch data' });
      }

      const totalUsers = (data as any)?.[0]?.total_users || 0;

      const users = ((data as any[]) || []).map((row) => ({
        id: row.user_id,
        username: row.username || 'Unknown',
        telegram_id: row.telegram_id || null,
        last_message: row.last_message,
        last_message_time: row.last_message_time,
        unread_count: Number(row.unread_count),
        is_online: false,
      }));

      return res.send({
        users,
        totalUsers: Number(totalUsers),
        hasMore: parseInt(offset) + users.length < Number(totalUsers),
      });
    } catch (err: any) {
      log.error({ error: err instanceof Error ? err.message : JSON.stringify(err) }, 'Error fetching users with messages');

      logErrorToAdmin({
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'admin_get_users_with_messages',
        endpoint: '/admin/chats/users-with-messages',
        severity: 'warning'
      }).catch(() => {});

      return res.status(500).send({ error: 'Internal server error' });
    }
  });
}
