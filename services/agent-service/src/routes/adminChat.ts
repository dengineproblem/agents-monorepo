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
   */
  app.get('/admin/chats/:userId', async (req, res) => {
    try {
      const { userId } = req.params as { userId: string };
      const { limit = '50', offset = '0' } = req.query as { limit?: string; offset?: string };

      const { data: messages, error } = await supabase
        .from('admin_user_chats')
        .select('*')
        .eq('user_account_id', userId)
        .order('created_at', { ascending: true })
        .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

      if (error) {
        log.error({ error: error.message, userId }, 'Failed to fetch chat messages');
        return res.status(500).send({ error: 'Failed to fetch messages' });
      }

      // Также получаем информацию о пользователе
      const { data: user } = await supabase
        .from('user_accounts')
        .select('id, username, telegram_id')
        .eq('id', userId)
        .single();

      return res.send({
        messages: messages || [],
        user: user || null,
        hasTelegram: !!user?.telegram_id
      });
    } catch (err) {
      log.error({ error: String(err) }, 'Error fetching chat messages');
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

      // Отправляем в Telegram
      const sent = await sendTelegramNotification(user.telegram_id, message);

      if (!sent) {
        log.error({ userId, username: user.username }, 'Failed to send message to Telegram');
        return res.status(500).send({ error: 'Failed to send message to Telegram' });
      }

      // Сохраняем сообщение в БД
      const { data: chatMessage, error: insertError } = await supabase
        .from('admin_user_chats')
        .insert({
          user_account_id: userId,
          direction: 'to_user',
          message: message.trim(),
          admin_id: adminId || null,
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
    } catch (err) {
      log.error({ error: String(err) }, 'Error sending chat message');
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
        .eq('direction', 'from_user')
        .is('read_at', null);

      if (error) {
        log.error({ error: error.message, userId }, 'Failed to mark messages as read');
        return res.status(500).send({ error: 'Failed to mark messages as read' });
      }

      return res.send({ success: true });
    } catch (err) {
      log.error({ error: String(err) }, 'Error marking messages as read');
      return res.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /admin/chats/unread-count
   * Получает количество непрочитанных сообщений по всем пользователям
   */
  app.get('/admin/chats/unread-count', async (_req, res) => {
    try {
      // Общее количество непрочитанных
      const { count: totalUnread } = await supabase
        .from('admin_user_chats')
        .select('*', { count: 'exact', head: true })
        .eq('direction', 'from_user')
        .is('read_at', null);

      // Количество пользователей с непрочитанными сообщениями
      const { data: usersWithUnread } = await supabase
        .from('admin_user_chats')
        .select('user_account_id')
        .eq('direction', 'from_user')
        .is('read_at', null);

      const uniqueUsers = new Set(usersWithUnread?.map(m => m.user_account_id) || []);

      return res.send({
        count: totalUnread || 0,  // Для совместимости с frontend
        totalUnread: totalUnread || 0,
        usersWithUnread: uniqueUsers.size
      });
    } catch (err) {
      log.error({ error: String(err) }, 'Error getting unread count');
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
        .eq('direction', 'from_user')
        .is('read_at', null);

      return res.send({ unreadCount: count || 0 });
    } catch (err) {
      log.error({ error: String(err) }, 'Error getting user unread count');
      return res.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /admin/chats/users-with-messages
   * Получает список пользователей, с которыми есть переписка
   */
  app.get('/admin/chats/users-with-messages', async (req, res) => {
    try {
      const { limit = '20' } = req.query as { limit?: string };

      // Получаем последние сообщения (без FK join)
      const { data: chats, error } = await supabase
        .from('admin_user_chats')
        .select(`
          user_account_id,
          message,
          direction,
          created_at,
          read_at
        `)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) {
        log.error({ error: error.message }, 'Failed to fetch users with messages');
        return res.status(500).send({ error: 'Failed to fetch data' });
      }

      // Загружаем usernames отдельно
      const userIds = [...new Set(chats?.map(c => c.user_account_id).filter(Boolean) || [])];
      let usersData: Record<string, { username: string; telegram_id: string | null }> = {};
      if (userIds.length > 0) {
        const { data: users } = await supabase
          .from('user_accounts')
          .select('id, username, telegram_id')
          .in('id', userIds);
        usersData = Object.fromEntries(users?.map(u => [u.id, { username: u.username, telegram_id: u.telegram_id }]) || []);
      }

      // Группируем по пользователям и берём последнее сообщение
      const userMap = new Map<string, any>();

      for (const chat of chats || []) {
        const userId = chat.user_account_id;
        if (!userMap.has(userId)) {
          const unreadCount = (chats || []).filter(
            c => c.user_account_id === userId && c.direction === 'from_user' && !c.read_at
          ).length;

          const userData = usersData[userId];
          userMap.set(userId, {
            userId,
            username: userData?.username || 'Unknown',
            hasTelegram: !!userData?.telegram_id,
            lastMessage: chat.message,
            lastMessageDirection: chat.direction,
            lastMessageAt: chat.created_at,
            unreadCount
          });
        }
      }

      const users = Array.from(userMap.values())
        .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())
        .slice(0, parseInt(limit));

      return res.send({ users });
    } catch (err) {
      log.error({ error: err instanceof Error ? err.message : JSON.stringify(err) }, 'Error fetching users with messages');
      return res.status(500).send({ error: 'Internal server error' });
    }
  });
}
