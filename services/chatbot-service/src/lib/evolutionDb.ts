import pg from 'pg';
import { createLogger } from './logger.js';

const { Pool } = pg;
const log = createLogger({ module: 'evolutionDb' });

// Evolution PostgreSQL connection configuration
const EVOLUTION_DB_CONFIG = {
  host: process.env.EVOLUTION_DB_HOST || 'evolution-postgres',
  port: parseInt(process.env.EVOLUTION_DB_PORT || '5432', 10),
  user: process.env.EVOLUTION_DB_USER || 'evolution',
  password: process.env.EVOLUTION_DB_PASSWORD,
  database: process.env.EVOLUTION_DB_NAME || 'evolution',
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
};

let evolutionPool: pg.Pool | null = null;

/**
 * Get or create Evolution PostgreSQL connection pool (lazy initialization)
 */
function getPool(): pg.Pool {
  if (!evolutionPool) {
    if (!EVOLUTION_DB_CONFIG.password) {
      log.warn('EVOLUTION_DB_PASSWORD not set - Evolution DB features will be disabled');
      throw new Error('EVOLUTION_DB_PASSWORD is required for Evolution PostgreSQL connection');
    }
    evolutionPool = new Pool(EVOLUTION_DB_CONFIG);

    evolutionPool.on('connect', () => {
      log.info({ host: EVOLUTION_DB_CONFIG.host }, 'Connected to Evolution PostgreSQL');
    });

    evolutionPool.on('error', (err: Error) => {
      log.error({ error: err.message }, 'Evolution PostgreSQL pool error');
    });
  }
  return evolutionPool;
}

/**
 * Message format returned by getContactMessages
 */
export interface EvolutionMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

/**
 * Get messages for a specific contact from Evolution PostgreSQL
 * Used as fallback when dialog_analysis.messages is empty (no AI bot)
 *
 * @param instanceName Evolution API instance name
 * @param contactPhone Contact phone number (with or without @s.whatsapp.net)
 * @returns Array of messages sorted by timestamp
 */
export async function getContactMessages(
  instanceName: string,
  contactPhone: string
): Promise<EvolutionMessage[]> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    // Format remoteJid from phone number
    const remoteJid = contactPhone.includes('@')
      ? contactPhone
      : `${contactPhone.replace(/\D/g, '')}@s.whatsapp.net`;

    log.debug({ instanceName, remoteJid }, 'Fetching messages from Evolution DB');

    const query = `
      SELECT
        "key"->>'fromMe' as from_me,
        "message" as message_data,
        "messageTimestamp" as timestamp
      FROM "Message"
      WHERE "instanceId" = (SELECT id FROM "Instance" WHERE name = $1)
        AND "key"->>'remoteJid' = $2
      ORDER BY "messageTimestamp" ASC
      LIMIT 50
    `;

    const result = await client.query(query, [instanceName, remoteJid]);

    const messages = result.rows.map(row => {
      // Extract text from message_data (JSONB)
      let content = '';
      const msgData = row.message_data;

      if (msgData?.conversation) {
        content = msgData.conversation;
      } else if (msgData?.extendedTextMessage?.text) {
        content = msgData.extendedTextMessage.text;
      } else if (msgData?.imageMessage?.caption) {
        content = `[Фото] ${msgData.imageMessage.caption}`;
      } else if (msgData?.imageMessage) {
        content = '[Фото]';
      } else if (msgData?.documentMessage?.caption) {
        content = `[Документ] ${msgData.documentMessage.caption}`;
      } else if (msgData?.documentMessage) {
        content = '[Документ]';
      } else if (msgData?.audioMessage) {
        content = '[Голосовое сообщение]';
      } else if (msgData?.videoMessage) {
        content = '[Видео]';
      } else if (msgData?.stickerMessage) {
        content = '[Стикер]';
      } else if (msgData?.contactMessage) {
        content = '[Контакт]';
      } else if (msgData?.locationMessage) {
        content = '[Локация]';
      } else {
        content = '[Медиа сообщение]';
      }

      return {
        role: row.from_me === 'true' ? 'assistant' : 'user',
        content,
        timestamp: parseInt(row.timestamp, 10),
      } as EvolutionMessage;
    });

    log.info({
      instanceName,
      contactPhone,
      messageCount: messages.length,
    }, 'Fetched messages from Evolution DB');

    return messages;
  } catch (error: any) {
    log.error({
      error: error.message,
      instanceName,
      contactPhone,
    }, 'Failed to fetch messages from Evolution DB');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Check if Evolution DB connection is available
 */
export function isEvolutionDbAvailable(): boolean {
  return !!process.env.EVOLUTION_DB_PASSWORD;
}

/**
 * Close Evolution PostgreSQL connection pool (for graceful shutdown)
 */
export async function closeEvolutionPool(): Promise<void> {
  if (evolutionPool) {
    await evolutionPool.end();
    evolutionPool = null;
    log.info('Evolution PostgreSQL pool closed');
  }
}
