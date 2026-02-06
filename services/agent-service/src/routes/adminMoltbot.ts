/**
 * Admin Moltbot Chat Routes
 *
 * API для чата между админами и Moltbot AI агентом
 * - Отправка сообщений в Moltbot
 * - Получение ответов от Moltbot
 *
 * @module routes/adminMoltbot
 */

import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { logErrorToAdmin } from '../lib/errorLogger.js';

const log = createLogger({ module: 'adminMoltbot' });

// =====================================================
// Типы
// =====================================================

interface SendMessageBody {
  message: string;
  specialist?: string;
}

interface MoltbotResponse {
  response: string;
  specialist?: string;
  sessionId?: string;
}

// =====================================================
// Routes
// =====================================================

export default async function adminMoltbotRoutes(app: FastifyInstance) {

  /**
   * POST /admin/moltbot/chat
   * Отправляет сообщение в Moltbot и получает ответ
   */
  app.post('/admin/moltbot/chat', async (req, res) => {
    try {
      const { message, specialist = 'facebook-ads' } = req.body as SendMessageBody;
      const adminId = req.headers['x-user-id'] as string;

      if (!message || message.trim().length === 0) {
        return res.status(400).send({ error: 'Message is required' });
      }

      log.info({
        adminId,
        specialist,
        messageLength: message.length
      }, 'Admin sending message to Moltbot');

      // Используем admin ID как telegram chat ID для Moltbot
      const telegramChatId = `admin-${adminId}`;

      // Вызываем agent-brain который проксирует к Moltbot
      const agentBrainUrl = process.env.AGENT_BRAIN_URL || 'http://agent-brain:7080';

      const response = await fetch(`${agentBrainUrl}/api/moltbot/route`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          specialist,
          message,
          telegramChatId
        }),
        signal: AbortSignal.timeout(120000) // 2 минуты
      });

      if (!response.ok) {
        const errorText = await response.text();
        log.error({
          status: response.status,
          errorText,
          adminId
        }, 'Moltbot request failed');

        return res.status(response.status).send({
          error: `Moltbot error: ${errorText}`
        });
      }

      const result = await response.json() as MoltbotResponse;

      log.info({
        adminId,
        specialist,
        responseLength: result.response?.length || 0
      }, 'Received response from Moltbot');

      return res.send({
        success: true,
        response: result.response,
        specialist: result.specialist,
        sessionId: result.sessionId
      });

    } catch (err: any) {
      log.error({ error: String(err) }, 'Error sending message to Moltbot');

      logErrorToAdmin({
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'admin_moltbot_chat',
        endpoint: '/admin/moltbot/chat',
        severity: 'warning'
      }).catch(() => {});

      return res.status(500).send({
        error: err.message || 'Internal server error'
      });
    }
  });

  /**
   * GET /admin/moltbot/specialists
   * Получает список доступных specialist агентов
   */
  app.get('/admin/moltbot/specialists', async (_req, res) => {
    try {
      const specialists = [
        { id: 'facebook-ads', name: 'Facebook Ads', description: 'Управление Facebook/Instagram рекламой' },
        { id: 'creatives', name: 'Креативы', description: 'Генерация и анализ креативов' },
        { id: 'crm', name: 'CRM', description: 'Работа с лидами и воронкой' },
        { id: 'tiktok', name: 'TikTok', description: 'Управление TikTok рекламой' },
        { id: 'onboarding', name: 'Онбординг', description: 'Помощь в настройке аккаунта' }
      ];

      return res.send({ specialists });
    } catch (err: any) {
      log.error({ error: String(err) }, 'Error getting specialists list');
      return res.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /admin/moltbot/users-with-messages
   * Получает список пользователей из чатов техподдержки (support bot)
   */
  app.get('/admin/moltbot/users-with-messages', async (req, res) => {
    try {
      const { limit = '20' } = req.query as { limit?: string };
      const limitNum = parseInt(limit);

      // Получаем последние сообщения от support бота
      const { data: chats, error } = await supabase
        .from('admin_user_chats')
        .select(`
          user_account_id,
          message,
          direction,
          created_at,
          read_at
        `)
        .eq('source', 'support')
        .order('created_at', { ascending: false })
        .limit(500);

      if (error) {
        log.error({ error: error.message }, 'Failed to fetch support chat users');
        return res.status(500).send({ error: 'Failed to fetch data' });
      }

      if (!chats || chats.length === 0) {
        return res.send({ users: [] });
      }

      // Группируем по пользователям
      const userMap = new Map<string, {
        lastMessage: string;
        lastMessageTime: string;
        unreadCount: number;
      }>();

      for (const chat of chats) {
        const userId = chat.user_account_id;
        if (!userId) continue;

        const existing = userMap.get(userId);
        if (!existing) {
          userMap.set(userId, {
            lastMessage: chat.message,
            lastMessageTime: chat.created_at,
            unreadCount: chat.direction === 'from_user' && !chat.read_at ? 1 : 0
          });
        } else {
          if (chat.direction === 'from_user' && !chat.read_at) {
            existing.unreadCount++;
          }
        }
      }

      // Загружаем данные пользователей
      const userIds = Array.from(userMap.keys()).filter((id): id is string => id != null);
      const { data: usersData } = await supabase
        .from('user_accounts')
        .select('id, username, telegram_id')
        .in('id', userIds);

      const usersMap = new Map(usersData?.map(u => [u.id, u]) || []);

      // Собираем результат
      const users = Array.from(userMap.entries())
        .map(([userId, data]) => {
          const userData = usersMap.get(userId);
          return {
            id: userId,
            username: userData?.username || 'Unknown',
            telegram_id: userData?.telegram_id || null,
            last_message: data.lastMessage,
            last_message_time: data.lastMessageTime,
            unread_count: data.unreadCount,
            is_online: false
          };
        })
        .sort((a, b) => new Date(b.last_message_time).getTime() - new Date(a.last_message_time).getTime())
        .slice(0, limitNum);

      return res.send({ users });
    } catch (err: any) {
      log.error({ error: String(err) }, 'Error fetching support chat users');
      return res.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /admin/moltbot/chats/:userId
   * Получает историю сообщений с пользователем из support бота
   */
  app.get('/admin/moltbot/chats/:userId', async (req, res) => {
    try {
      const { userId } = req.params as { userId: string };
      const { limit = '100', offset = '0' } = req.query as { limit?: string; offset?: string };

      const { data: messages, error } = await supabase
        .from('admin_user_chats')
        .select('*')
        .eq('user_account_id', userId)
        .eq('source', 'support')
        .order('created_at', { ascending: true })
        .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

      if (error) {
        log.error({ error: error.message, userId }, 'Failed to fetch support chat messages');
        return res.status(500).send({ error: 'Failed to fetch messages' });
      }

      return res.send({ messages: messages || [] });
    } catch (err: any) {
      log.error({ error: String(err) }, 'Error fetching support chat messages');
      return res.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /admin/moltbot/chats/:userId
   * Отправляет сообщение пользователю через support бота
   */
  app.post('/admin/moltbot/chats/:userId', async (req, res) => {
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

      // Отправляем через support бота
      const botToken = process.env.SUPPORT_BOT_TELEGRAM_TOKEN;
      if (!botToken) {
        log.error('SUPPORT_BOT_TELEGRAM_TOKEN not configured');
        return res.status(500).send({ error: 'Support bot not configured' });
      }

      const telegramApiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const response = await fetch(telegramApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: user.telegram_id,
          text: message.trim(),
          parse_mode: 'HTML'
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        log.error({ error: errorText, userId }, 'Failed to send message via support bot');
        return res.status(500).send({ error: 'Failed to send message' });
      }

      // Сохраняем в БД
      const { data: chatMessage, error: insertError } = await supabase
        .from('admin_user_chats')
        .insert({
          user_account_id: userId,
          direction: 'to_user',
          message: message.trim(),
          admin_id: adminId || null,
          source: 'support',
          delivered: true
        })
        .select()
        .single();

      if (insertError) {
        log.error({ error: insertError.message, userId }, 'Failed to save support chat message');
      }

      log.info({ userId, username: user.username, adminId }, 'Support message sent');

      return res.send({
        success: true,
        message: chatMessage || { message, direction: 'to_user', created_at: new Date().toISOString() }
      });
    } catch (err: any) {
      log.error({ error: String(err) }, 'Error sending support chat message');
      return res.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /admin/moltbot/chats/:userId/mark-read
   * Отмечает все сообщения от пользователя в support боте как прочитанные
   */
  app.post('/admin/moltbot/chats/:userId/mark-read', async (req, res) => {
    try {
      const { userId } = req.params as { userId: string };

      const { error } = await supabase
        .from('admin_user_chats')
        .update({ read_at: new Date().toISOString() })
        .eq('user_account_id', userId)
        .eq('source', 'support')
        .eq('direction', 'from_user')
        .is('read_at', null);

      if (error) {
        log.error({ error: error.message, userId }, 'Failed to mark support messages as read');
        return res.status(500).send({ error: 'Failed to mark messages as read' });
      }

      return res.send({ success: true });
    } catch (err: any) {
      log.error({ error: String(err) }, 'Error marking support messages as read');
      return res.status(500).send({ error: 'Internal server error' });
    }
  });
}
