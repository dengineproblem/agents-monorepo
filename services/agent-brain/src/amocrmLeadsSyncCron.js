/**
 * AmoCRM Leads Sync Cron Job
 * 
 * Автоматически синхронизирует статусы лидов из AmoCRM каждые 6 часов
 * для всех пользователей с подключенным AmoCRM.
 * 
 * Служит fallback вариантом на случай проблем с вебхуками.
 * Основной способ синхронизации - через AmoCRM webhooks в реальном времени.
 * 
 * @module amocrmLeadsSyncCron
 */

import cron from 'node-cron';
import fetch from 'node-fetch';
import { logger } from './lib/logger.js';
import { supabase } from './lib/supabaseClient.js';
import { logErrorToAdmin } from './lib/errorLogger.js';

const log = logger.child({ module: 'amocrmLeadsSyncCron' });

const AGENT_SERVICE_URL = process.env.AGENT_SERVICE_URL || 'http://agent-service:8082';
// Каждые 6 часов (00:00, 06:00, 12:00, 18:00)
// Можно настроить через переменную окружения AMOCRM_LEADS_SYNC_CRON_SCHEDULE
const CRON_SCHEDULE = process.env.AMOCRM_LEADS_SYNC_CRON_SCHEDULE || '0 */6 * * *';

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
            method: 'POST'
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

        logErrorToAdmin({
          user_account_id: user.id,
          error_type: 'cron',
          raw_error: error.message || String(error),
          stack_trace: error.stack,
          action: 'amocrm_leads_sync_user',
          severity: 'warning'
        }).catch(() => {});

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

    logErrorToAdmin({
      error_type: 'cron',
      raw_error: error.message || String(error),
      stack_trace: error.stack,
      action: 'amocrm_leads_sync_cron',
      severity: 'critical'
    }).catch(() => {});
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

