import pg from 'pg';
import dotenv from 'dotenv';
import { createLogger } from './logger.js';

// Load environment variables
dotenv.config();

const { Pool } = pg;
const log = createLogger({ module: 'evolutionDb' });

// Evolution PostgreSQL connection configuration
const EVOLUTION_DB_CONFIG = {
  host: process.env.EVOLUTION_DB_HOST || 'evolution-postgres',
  port: parseInt(process.env.EVOLUTION_DB_PORT || '5432', 10),
  user: process.env.EVOLUTION_DB_USER || 'evolution',
  password: process.env.EVOLUTION_DB_PASSWORD,
  database: process.env.EVOLUTION_DB_NAME || 'evolution',
  max: 10, // Maximum number of connections in pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
};

// Validate configuration
if (!EVOLUTION_DB_CONFIG.password) {
  log.error('EVOLUTION_DB_PASSWORD is not set in environment variables');
  throw new Error('EVOLUTION_DB_PASSWORD is required for Evolution PostgreSQL connection');
}

// Create connection pool
export const evolutionPool = new Pool(EVOLUTION_DB_CONFIG);

// Test connection on startup
evolutionPool.on('connect', () => {
  log.info({ host: EVOLUTION_DB_CONFIG.host }, 'Connected to Evolution PostgreSQL');
});

evolutionPool.on('error', (err: Error) => {
  log.error({ error: err.message }, 'Evolution PostgreSQL pool error');
});

/**
 * Execute a query against Evolution PostgreSQL
 * @param query SQL query string
 * @param params Query parameters
 * @returns Query result
 */
export async function evolutionQuery(
  query: string,
  params: any[] = []
): Promise<pg.QueryResult<any>> {
  const client = await evolutionPool.connect();
  
  try {
    log.debug({ query: query.substring(0, 100), paramsCount: params.length }, 'Executing Evolution query');
    const result = await client.query(query, params);
    log.debug({ rowCount: result.rowCount }, 'Evolution query completed');
    return result;
  } catch (error: any) {
    log.error({ 
      error: error.message, 
      query: query.substring(0, 200),
      paramsCount: params.length 
    }, 'Evolution query failed');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get messages for a specific Evolution API instance
 * @param instanceName Evolution API instance name
 * @param maxContacts Optional limit on number of contacts to fetch (most active first)
 * @returns Messages grouped by contact
 */
export async function getInstanceMessages(instanceName: string, maxContacts?: number) {
  let query: string;
  
  if (maxContacts && maxContacts > 0) {
    // Get messages only for top N most active contacts
    query = `
      WITH instance_data AS (
        SELECT id FROM "Instance" WHERE name = $1
      ),
      top_contacts AS (
        SELECT 
          "key"->>'remoteJid' as remote_jid,
          COUNT(*) as message_count
        FROM "Message"
        WHERE "instanceId" IN (SELECT id FROM instance_data)
        GROUP BY "key"->>'remoteJid'
        ORDER BY message_count DESC
        LIMIT $2
      )
      SELECT 
        "key"->>'remoteJid' as remote_jid,
        "pushName" as contact_name,
        "key"->>'fromMe' as from_me,
        "message" as message_data,
        "messageTimestamp" as timestamp,
        "key" as key_data
      FROM "Message"
      WHERE "instanceId" IN (SELECT id FROM instance_data)
        AND "key"->>'remoteJid' IN (SELECT remote_jid FROM top_contacts)
      ORDER BY "messageTimestamp" ASC
    `;
    
    log.info({ maxContacts }, 'Fetching messages for top N most active contacts');
    const result = await evolutionQuery(query, [instanceName, maxContacts]);
    return result.rows;
  } else {
    // Get all messages (original behavior)
    query = `
      SELECT 
        "key"->>'remoteJid' as remote_jid,
        "pushName" as contact_name,
        "key"->>'fromMe' as from_me,
        "message" as message_data,
        "messageTimestamp" as timestamp,
        "key" as key_data
      FROM "Message"
      WHERE "instanceId" = (
        SELECT id FROM "Instance" WHERE name = $1
      )
      ORDER BY "messageTimestamp" ASC
    `;
    
    const result = await evolutionQuery(query, [instanceName]);
    return result.rows;
  }
}

/**
 * Close the Evolution PostgreSQL connection pool
 * (Should be called on application shutdown)
 */
export async function closeEvolutionPool() {
  await evolutionPool.end();
  log.info('Evolution PostgreSQL pool closed');
}

