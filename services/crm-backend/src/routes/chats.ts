import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { evolutionQuery } from '../lib/evolutionDb.js';
import { sendWhatsAppMessage } from '../lib/evolutionApi.js';
import {
  generateCorrelationId,
  shortCorrelationId,
  maskPhone,
  classifyError,
  createErrorLog,
  getElapsedMs,
  LogTag
} from '../lib/logUtils.js';

// ==================== VALIDATION SCHEMAS ====================

const GetChatsQuerySchema = z.object({
  instanceName: z.string().min(1, 'instanceName is required'),
});

const GetMessagesQuerySchema = z.object({
  instanceName: z.string().min(1, 'instanceName is required'),
  limit: z.string().optional().transform(val => Math.min(parseInt(val || '50') || 50, 200)),
  offset: z.string().optional().transform(val => parseInt(val || '0') || 0),
});

const SendMessageBodySchema = z.object({
  instanceName: z.string().min(1, 'instanceName is required'),
  text: z.string().min(1, 'text is required').max(10000, 'text too long'),
});

const SearchChatsQuerySchema = z.object({
  instanceName: z.string().min(1, 'instanceName is required'),
  query: z.string().min(2, 'query must be at least 2 characters').max(100, 'query too long'),
});

// ==================== INTERFACES ====================

interface ChatListItem {
  remoteJid: string;
  contactName: string | null;
  lastMessage: string | null;
  lastMessageTime: number;
  unreadCount: number;
  isFromMe: boolean;
}

interface ChatMessage {
  id: string;
  text: string | null;
  timestamp: number;
  fromMe: boolean;
  pushName: string | null;
  messageType: string;
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Extract phone from remoteJid for masking in logs
 */
function extractPhoneFromJid(remoteJid: string): string {
  return remoteJid.split('@')[0];
}

/**
 * Sanitize search query to prevent SQL injection
 */
function sanitizeSearchQuery(query: string): string {
  // Escape special LIKE/ILIKE characters
  return query
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

/**
 * Extract text from Evolution message data
 */
function extractMessageText(messageData: any): string | null {
  if (!messageData) return null;

  // Text message
  if (messageData.conversation) return messageData.conversation;
  if (messageData.extendedTextMessage?.text) return messageData.extendedTextMessage.text;

  // Media messages
  if (messageData.imageMessage?.caption) return `[Изображение] ${messageData.imageMessage.caption}`;
  if (messageData.imageMessage) return '[Изображение]';

  if (messageData.videoMessage?.caption) return `[Видео] ${messageData.videoMessage.caption}`;
  if (messageData.videoMessage) return '[Видео]';

  if (messageData.audioMessage) return '[Голосовое сообщение]';
  if (messageData.documentMessage?.fileName) return `[Документ: ${messageData.documentMessage.fileName}]`;
  if (messageData.documentMessage) return '[Документ]';

  if (messageData.stickerMessage) return '[Стикер]';
  if (messageData.contactMessage) return '[Контакт]';
  if (messageData.locationMessage) return '[Геолокация]';
  if (messageData.reactionMessage) return '[Реакция]';
  if (messageData.pollCreationMessage) return '[Опрос]';

  return null;
}

/**
 * Get message type from message data
 */
function getMessageType(messageData: any): string {
  if (!messageData) return 'unknown';

  if (messageData.conversation || messageData.extendedTextMessage) return 'text';
  if (messageData.imageMessage) return 'image';
  if (messageData.videoMessage) return 'video';
  if (messageData.audioMessage) return 'audio';
  if (messageData.documentMessage) return 'document';
  if (messageData.stickerMessage) return 'sticker';
  if (messageData.contactMessage) return 'contact';
  if (messageData.locationMessage) return 'location';
  if (messageData.reactionMessage) return 'reaction';
  if (messageData.pollCreationMessage) return 'poll';

  return 'unknown';
}

// ==================== ROUTES ====================

export async function chatsRoutes(app: FastifyInstance) {

  /**
   * GET /chats
   * Get list of all chats (contacts) from Evolution DB
   */
  app.get('/chats', async (request, reply) => {
    const startTime = Date.now();
    const cid = generateCorrelationId();
    const tags: LogTag[] = ['api', 'db', 'message'];

    app.log.info({
      cid: shortCorrelationId(cid),
      query: request.query,
      tags
    }, '[GET /chats] Request received');

    try {
      // Validate query params
      const validationResult = GetChatsQuerySchema.safeParse(request.query);
      if (!validationResult.success) {
        app.log.warn({
          cid: shortCorrelationId(cid),
          errorType: 'validation_error',
          errors: validationResult.error.errors
        }, '[GET /chats] Validation failed');
        return reply.status(400).send({
          error: 'Validation error',
          details: validationResult.error.errors
        });
      }

      const { instanceName } = validationResult.data;

      app.log.debug({
        cid: shortCorrelationId(cid),
        instanceName,
        tags: ['db']
      }, '[GET /chats] Querying Evolution DB for chats');

      // Get all messages grouped by contact with latest message info
      const query = `
        WITH instance_data AS (
          SELECT id FROM "Instance" WHERE name = $1
        ),
        chat_summary AS (
          SELECT
            "key"->>'remoteJid' as remote_jid,
            MAX("pushName") as contact_name,
            MAX("messageTimestamp") as last_message_time,
            COUNT(*) as message_count
          FROM "Message"
          WHERE "instanceId" IN (SELECT id FROM instance_data)
            AND "key"->>'remoteJid' NOT LIKE '%@g.us'
            AND "key"->>'remoteJid' NOT LIKE '%@broadcast'
            AND "key"->>'remoteJid' NOT LIKE 'status@%'
          GROUP BY "key"->>'remoteJid'
          ORDER BY last_message_time DESC
          LIMIT 100
        ),
        latest_messages AS (
          SELECT DISTINCT ON (m."key"->>'remoteJid')
            m."key"->>'remoteJid' as remote_jid,
            m."message" as message_data,
            m."key"->>'fromMe' as from_me
          FROM "Message" m
          WHERE m."instanceId" IN (SELECT id FROM instance_data)
            AND m."key"->>'remoteJid' IN (SELECT remote_jid FROM chat_summary)
          ORDER BY m."key"->>'remoteJid', m."messageTimestamp" DESC
        )
        SELECT
          cs.remote_jid,
          cs.contact_name,
          cs.last_message_time,
          cs.message_count,
          lm.message_data,
          lm.from_me
        FROM chat_summary cs
        LEFT JOIN latest_messages lm ON cs.remote_jid = lm.remote_jid
        ORDER BY cs.last_message_time DESC
      `;

      const result = await evolutionQuery(query, [instanceName]);

      const chats: ChatListItem[] = result.rows.map(row => ({
        remoteJid: row.remote_jid,
        contactName: row.contact_name,
        lastMessage: extractMessageText(row.message_data),
        lastMessageTime: parseInt(row.last_message_time) || 0,
        unreadCount: 0,
        isFromMe: row.from_me === 'true'
      }));

      app.log.info({
        cid: shortCorrelationId(cid),
        instanceName,
        chatsCount: chats.length,
        elapsedMs: getElapsedMs(startTime),
        tags
      }, '[GET /chats] Successfully fetched chats');

      return reply.send({
        success: true,
        chats
      });

    } catch (error: any) {
      const errorInfo = classifyError(error);
      const errorLog = createErrorLog(error, {
        correlationId: cid,
        method: 'GET',
        path: '/chats'
      });

      app.log.error({
        ...errorLog,
        errorType: errorInfo.type,
        isRetryable: errorInfo.isRetryable,
        elapsedMs: getElapsedMs(startTime),
        tags: ['api', 'db', 'error']
      }, '[GET /chats] Failed to fetch chats');

      return reply.status(500).send({
        error: 'Failed to fetch chats',
        message: error.message
      });
    }
  });

  /**
   * GET /chats/:remoteJid/messages
   * Get message history for a specific chat
   */
  app.get('/chats/:remoteJid/messages', async (request, reply) => {
    const startTime = Date.now();
    const cid = generateCorrelationId();
    const { remoteJid } = request.params as { remoteJid: string };
    const tags: LogTag[] = ['api', 'db', 'message'];

    const maskedPhone = maskPhone(extractPhoneFromJid(remoteJid));

    app.log.info({
      cid: shortCorrelationId(cid),
      phone: maskedPhone,
      tags
    }, '[GET /chats/:remoteJid/messages] Request received');

    try {
      // Validate query params
      const validationResult = GetMessagesQuerySchema.safeParse(request.query);
      if (!validationResult.success) {
        app.log.warn({
          cid: shortCorrelationId(cid),
          errorType: 'validation_error',
          errors: validationResult.error.errors
        }, '[GET /chats/:remoteJid/messages] Validation failed');
        return reply.status(400).send({
          error: 'Validation error',
          details: validationResult.error.errors
        });
      }

      const { instanceName, limit, offset } = validationResult.data;

      app.log.debug({
        cid: shortCorrelationId(cid),
        instanceName,
        phone: maskedPhone,
        limit,
        offset,
        tags: ['db']
      }, '[GET /chats/:remoteJid/messages] Querying messages');

      // Get messages for this contact
      const query = `
        SELECT
          m."key"->>'id' as message_id,
          m."key"->>'fromMe' as from_me,
          m."message" as message_data,
          m."messageTimestamp" as timestamp,
          m."pushName" as push_name
        FROM "Message" m
        WHERE m."instanceId" = (
          SELECT id FROM "Instance" WHERE name = $1
        )
        AND m."key"->>'remoteJid' = $2
        ORDER BY m."messageTimestamp" DESC
        LIMIT $3 OFFSET $4
      `;

      const result = await evolutionQuery(query, [instanceName, remoteJid, limit, offset]);

      // Reverse to get chronological order (oldest first)
      const messages: ChatMessage[] = result.rows.reverse().map(row => ({
        id: row.message_id || `msg_${row.timestamp}`,
        text: extractMessageText(row.message_data),
        timestamp: parseInt(row.timestamp) || 0,
        fromMe: row.from_me === 'true',
        pushName: row.push_name,
        messageType: getMessageType(row.message_data)
      }));

      // Get contact name from first incoming message
      let contactName: string | null = null;
      const incomingMsg = result.rows.find(r => r.from_me === 'false' && r.push_name);
      if (incomingMsg) {
        contactName = incomingMsg.push_name;
      }

      app.log.info({
        cid: shortCorrelationId(cid),
        instanceName,
        phone: maskedPhone,
        messagesCount: messages.length,
        contactName,
        hasMore: result.rows.length === limit,
        elapsedMs: getElapsedMs(startTime),
        tags
      }, '[GET /chats/:remoteJid/messages] Successfully fetched messages');

      return reply.send({
        success: true,
        remoteJid,
        contactName,
        messages,
        hasMore: result.rows.length === limit
      });

    } catch (error: any) {
      const errorInfo = classifyError(error);
      const errorLog = createErrorLog(error, {
        correlationId: cid,
        method: 'GET',
        path: '/chats/:remoteJid/messages',
        remoteJid: maskedPhone
      });

      app.log.error({
        ...errorLog,
        errorType: errorInfo.type,
        isRetryable: errorInfo.isRetryable,
        elapsedMs: getElapsedMs(startTime),
        tags: ['api', 'db', 'error']
      }, '[GET /chats/:remoteJid/messages] Failed to fetch messages');

      return reply.status(500).send({
        error: 'Failed to fetch messages',
        message: error.message
      });
    }
  });

  /**
   * POST /chats/:remoteJid/send
   * Send a message to a chat
   */
  app.post('/chats/:remoteJid/send', async (request, reply) => {
    const startTime = Date.now();
    const cid = generateCorrelationId();
    const { remoteJid } = request.params as { remoteJid: string };
    const tags: LogTag[] = ['api', 'message', 'webhook'];

    const phone = extractPhoneFromJid(remoteJid);
    const maskedPhone = maskPhone(phone);

    app.log.info({
      cid: shortCorrelationId(cid),
      phone: maskedPhone,
      tags
    }, '[POST /chats/:remoteJid/send] Request received');

    try {
      // Validate body
      const validationResult = SendMessageBodySchema.safeParse(request.body);
      if (!validationResult.success) {
        app.log.warn({
          cid: shortCorrelationId(cid),
          errorType: 'validation_error',
          errors: validationResult.error.errors
        }, '[POST /chats/:remoteJid/send] Validation failed');
        return reply.status(400).send({
          error: 'Validation error',
          details: validationResult.error.errors
        });
      }

      const { instanceName, text } = validationResult.data;

      app.log.debug({
        cid: shortCorrelationId(cid),
        instanceName,
        phone: maskedPhone,
        textLength: text.length,
        tags: ['webhook']
      }, '[POST /chats/:remoteJid/send] Sending message via Evolution API');

      const result = await sendWhatsAppMessage({
        instanceName,
        phone,
        message: text.trim()
      });

      if (!result.success) {
        app.log.error({
          cid: shortCorrelationId(cid),
          instanceName,
          phone: maskedPhone,
          error: result.error,
          elapsedMs: getElapsedMs(startTime),
          tags: ['api', 'webhook', 'error']
        }, '[POST /chats/:remoteJid/send] Evolution API returned error');

        return reply.status(500).send({
          error: 'Failed to send message',
          message: result.error
        });
      }

      app.log.info({
        cid: shortCorrelationId(cid),
        instanceName,
        phone: maskedPhone,
        messageId: result.key?.id,
        elapsedMs: getElapsedMs(startTime),
        tags
      }, '[POST /chats/:remoteJid/send] Message sent successfully');

      return reply.send({
        success: true,
        messageId: result.key?.id,
        key: result.key
      });

    } catch (error: any) {
      const errorInfo = classifyError(error);
      const errorLog = createErrorLog(error, {
        correlationId: cid,
        method: 'POST',
        path: '/chats/:remoteJid/send',
        remoteJid: maskedPhone
      });

      app.log.error({
        ...errorLog,
        errorType: errorInfo.type,
        isRetryable: errorInfo.isRetryable,
        elapsedMs: getElapsedMs(startTime),
        tags: ['api', 'webhook', 'error']
      }, '[POST /chats/:remoteJid/send] Failed to send message');

      return reply.status(500).send({
        error: 'Failed to send message',
        message: error.message
      });
    }
  });

  /**
   * GET /chats/search
   * Search chats by contact name or phone number
   */
  app.get('/chats/search', async (request, reply) => {
    const startTime = Date.now();
    const cid = generateCorrelationId();
    const tags: LogTag[] = ['api', 'db', 'message'];

    app.log.info({
      cid: shortCorrelationId(cid),
      tags
    }, '[GET /chats/search] Request received');

    try {
      // Validate query params
      const validationResult = SearchChatsQuerySchema.safeParse(request.query);
      if (!validationResult.success) {
        app.log.warn({
          cid: shortCorrelationId(cid),
          errorType: 'validation_error',
          errors: validationResult.error.errors
        }, '[GET /chats/search] Validation failed');
        return reply.status(400).send({
          error: 'Validation error',
          details: validationResult.error.errors
        });
      }

      const { instanceName, query: searchQuery } = validationResult.data;

      // Sanitize search query to prevent SQL injection
      const sanitizedQuery = sanitizeSearchQuery(searchQuery);
      const searchPattern = `%${sanitizedQuery}%`;

      app.log.debug({
        cid: shortCorrelationId(cid),
        instanceName,
        searchQueryLength: searchQuery.length,
        tags: ['db']
      }, '[GET /chats/search] Searching chats');

      const query = `
        WITH instance_data AS (
          SELECT id FROM "Instance" WHERE name = $1
        ),
        matching_chats AS (
          SELECT DISTINCT
            "key"->>'remoteJid' as remote_jid,
            MAX("pushName") as contact_name,
            MAX("messageTimestamp") as last_message_time
          FROM "Message"
          WHERE "instanceId" IN (SELECT id FROM instance_data)
            AND "key"->>'remoteJid' NOT LIKE '%@g.us'
            AND "key"->>'remoteJid' NOT LIKE '%@broadcast'
            AND (
              "pushName" ILIKE $2 ESCAPE '\\'
              OR "key"->>'remoteJid' LIKE $2 ESCAPE '\\'
            )
          GROUP BY "key"->>'remoteJid'
          ORDER BY last_message_time DESC
          LIMIT 20
        )
        SELECT * FROM matching_chats
      `;

      const result = await evolutionQuery(query, [instanceName, searchPattern]);

      const chats = result.rows.map(row => ({
        remoteJid: row.remote_jid,
        contactName: row.contact_name,
        lastMessageTime: parseInt(row.last_message_time) || 0
      }));

      app.log.info({
        cid: shortCorrelationId(cid),
        instanceName,
        resultsCount: chats.length,
        elapsedMs: getElapsedMs(startTime),
        tags
      }, '[GET /chats/search] Search completed');

      return reply.send({
        success: true,
        chats
      });

    } catch (error: any) {
      const errorInfo = classifyError(error);
      const errorLog = createErrorLog(error, {
        correlationId: cid,
        method: 'GET',
        path: '/chats/search'
      });

      app.log.error({
        ...errorLog,
        errorType: errorInfo.type,
        isRetryable: errorInfo.isRetryable,
        elapsedMs: getElapsedMs(startTime),
        tags: ['api', 'db', 'error']
      }, '[GET /chats/search] Search failed');

      return reply.status(500).send({
        error: 'Search failed',
        message: error.message
      });
    }
  });
}
