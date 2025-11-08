/**
 * AmoCRM Leads Sync Cron Job
 * 
 * Автоматически синхронизирует статусы лидов из AmoCRM каждый час
 * для всех пользователей с подключенным AmoCRM
 * 
 * @module amocrmLeadsSyncCron
 */

import cron from 'node-cron';
import fetch from 'node-fetch';
import { createLogger } from './lib/logger.js';
import { supabase } from './lib/supabaseClient.js';

const log = createLogger('amocrmLeadsSyncCron');

const AGENT_SERVICE_URL = process.env.AGENT_SERVICE_URL || 'http://agent-service:8082';
const CRON_SCHEDULE = '0 * * * *'; // Every hour at minute 0

/**
 * Синхронизирует лиды для всех пользователей с подключенным AmoCRM
 */
async function syncAllUsersLeads() {
  try {
    log.info('Starting AmoCRM leads sync for all users');

    // Get all user accounts with AmoCRM connected
    const { data: users, error } = await supabase
      .from('user_accounts')
      .select('id, amocrm_subdomain')
      .not('amocrm_subdomain', 'is', null)
      .not('amocrm_access_token', 'is', null)
      .not('amocrm_refresh_token', 'is', null);

    if (error) {
      log.error({ error: error.message }, 'Failed to fetch users with AmoCRM');
      return;
    }

    if (!users || users.length === 0) {
      log.info('No users with AmoCRM connected found');
      return;
    }

    log.info({ userCount: users.length }, 'Found users with AmoCRM connected');

    let successCount = 0;
    let errorCount = 0;

    // Sync leads for each user
    for (const user of users) {
      try {
        log.info({ 
          userAccountId: user.id, 
          subdomain: user.amocrm_subdomain 
        }, 'Syncing leads for user');

        const response = await fetch(
          `${AGENT_SERVICE_URL}/amocrm/sync-leads?userAccountId=${user.id}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        const result = await response.json();

        log.info({
          userAccountId: user.id,
          total: result.total,
          updated: result.updated,
          errors: result.errors
        }, 'User leads sync completed');

        if (result.success) {
          successCount++;
        } else {
          errorCount++;
        }

      } catch (error) {
        log.error({
          error: error.message,
          userAccountId: user.id
        }, 'Failed to sync leads for user');
        errorCount++;
      }
    }

    log.info({
      totalUsers: users.length,
      successCount,
      errorCount
    }, 'AmoCRM leads sync completed for all users');

  } catch (error) {
    log.error({ error: error.message }, 'AmoCRM leads sync cron failed');
  }
}

/**
 * Запускает cron задачу для синхронизации лидов
 */
export function startAmoCRMLeadsSyncCron() {
  log.info({ schedule: CRON_SCHEDULE }, 'Starting AmoCRM leads sync cron job');

  cron.schedule(CRON_SCHEDULE, async () => {
    log.info('AmoCRM leads sync cron triggered');
    await syncAllUsersLeads();
  });

  log.info('AmoCRM leads sync cron job started successfully');
}

/**
 * Ручной запуск синхронизации (для тестирования)
 */
export async function runAmoCRMLeadsSyncNow() {
  log.info('Manual AmoCRM leads sync triggered');
  await syncAllUsersLeads();
}

