/**
 * TikTok Leads Collector
 *
 * Собирает лиды из TikTok Instant Forms через Lead API (polling)
 * TikTok Developer Portal НЕ поддерживает webhook для лидов,
 * поэтому используем pull-модель: создаём задачу → скачиваем лиды
 *
 * Используется в batch процессах (processUserTikTok / processAccountTikTok)
 *
 * Features:
 * - Task-based API: POST page/lead/task/ → GET page/lead/task/download/
 * - Дедупликация по leadgen_id (unique index)
 * - Привязка к креативам через ad_creative_mapping
 * - Retry logic с exponential backoff
 * - Подробное логирование с correlation ID
 */

import { createTikTokLeadTask, downloadTikTokLeadTask } from './chatAssistant/shared/tikTokGraph.js';
import { createClient } from '@supabase/supabase-js';
import { logger } from './lib/logger.js';
import crypto from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Configuration
const MAX_RETRIES = 3;
const RETRY_DELAYS = [2000, 5000, 10000];
const TASK_POLL_INTERVAL_MS = 3000;   // Интервал проверки статуса задачи
const TASK_POLL_MAX_ATTEMPTS = 20;    // Макс. ожидание = 60 секунд
const LEAD_COLLECTION_DAYS = 2;       // Глубина polling: 2 дня

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false }
});

/**
 * Retry wrapper with exponential backoff
 */
async function retryWithBackoff(fn, context, maxRetries = MAX_RETRIES) {
  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === maxRetries - 1;

      if (isLastAttempt) {
        logger.error({
          where: 'tiktokLeadsCollector',
          ...context,
          attempt: attempt + 1,
          maxRetries,
          error: error.message
        }, 'Retry failed - max attempts reached');
        throw error;
      }

      const delay = RETRY_DELAYS[attempt] || RETRY_DELAYS[RETRY_DELAYS.length - 1];

      logger.warn({
        where: 'tiktokLeadsCollector',
        ...context,
        attempt: attempt + 1,
        maxRetries,
        error: error.message,
        nextRetryInMs: delay
      }, 'Retry attempt failed, retrying...');

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError || new Error('Retry failed');
}

/**
 * Валидация параметров
 */
function validateParams(advertiserId, accessToken, userAccountId, correlationId) {
  const errors = [];

  if (!advertiserId || typeof advertiserId !== 'string') {
    errors.push('advertiserId must be a non-empty string');
  }
  if (!accessToken || typeof accessToken !== 'string') {
    errors.push('accessToken must be a non-empty string');
  }
  if (!userAccountId || typeof userAccountId !== 'string') {
    errors.push('userAccountId must be a non-empty string');
  }

  if (errors.length > 0) {
    logger.error({
      where: 'tiktokLeadsCollector',
      correlationId,
      validationErrors: errors,
      advertiserId,
      userAccountId
    }, 'Validation failed');
    throw new Error(`Validation failed: ${errors.join('; ')}`);
  }
}

/**
 * Получить направления с lead_generation и tiktok_instant_page_id
 */
async function getLeadGenerationDirections(userAccountId, accountId) {
  let query = supabase
    .from('account_directions')
    .select('id, user_account_id, account_id, name, tiktok_instant_page_id, tiktok_campaign_id')
    .eq('platform', 'tiktok')
    .eq('tiktok_objective', 'lead_generation')
    .not('tiktok_instant_page_id', 'is', null);

  if (accountId) {
    query = query.eq('account_id', accountId);
  } else {
    query = query.eq('user_account_id', userAccountId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to query account_directions: ${error.message}`);
  }

  return data || [];
}

/**
 * Поллинг задачи до завершения
 */
async function pollTaskCompletion(advertiserId, accessToken, taskId, correlationId) {
  for (let attempt = 0; attempt < TASK_POLL_MAX_ATTEMPTS; attempt++) {
    await new Promise(resolve => setTimeout(resolve, TASK_POLL_INTERVAL_MS));

    try {
      const data = await downloadTikTokLeadTask(advertiserId, accessToken, taskId);

      // Если API вернул данные — задача выполнена
      if (data) {
        return data;
      }
    } catch (err) {
      // Задача ещё не готова — TikTok может вернуть ошибку
      const tikTokCode = err.tikTokError?.code;

      // Коды ошибок, означающие "задача не готова" — нужно продолжить поллинг
      if (tikTokCode === 40002 || tikTokCode === 40105 || tikTokCode === 50000) {
        logger.debug({
          where: 'tiktokLeadsCollector',
          correlationId,
          taskId,
          attempt: attempt + 1,
          tikTokCode,
          tikTokMessage: err.tikTokError?.message
        }, 'Task not ready yet, polling...');
        continue;
      }

      // Другая ошибка — пробрасываем
      throw err;
    }
  }

  throw new Error(`Task ${taskId} polling timed out after ${TASK_POLL_MAX_ATTEMPTS * TASK_POLL_INTERVAL_MS / 1000}s`);
}

/**
 * Парсинг полей лида (аналог из tiktokWebhooks.ts)
 */
function parseLeadFields(fieldData) {
  const result = {};
  if (!fieldData || !Array.isArray(fieldData)) return result;

  for (const field of fieldData) {
    const fieldName = (field.field_name || field.name || '').toLowerCase();
    const value = field.field_value || field.value || '';

    if (fieldName.includes('name') || fieldName === 'full_name') {
      result.name = value;
    } else if (fieldName.includes('phone') || fieldName === 'phone_number') {
      result.phone = value;
    } else if (fieldName.includes('email')) {
      result.email = value;
    }
  }

  return result;
}

/**
 * Обработать лиды для одного направления
 */
async function processLeadsForDirection(direction, leads, correlationId) {
  const dirStartTime = Date.now();
  let newLeads = 0;
  let duplicates = 0;
  let skipped = 0;
  const errors = [];

  for (const lead of leads) {
    try {
      const leadId = lead.lead_id || lead.id;
      if (!leadId) {
        skipped++;
        logger.debug({
          where: 'tiktokLeadsCollector',
          correlationId,
          directionId: direction.id,
          leadKeys: Object.keys(lead)
        }, 'Skipping lead without lead_id');
        continue;
      }

      // Дедупликация по leadgen_id (unique index в БД)
      const { data: existing, error: dedupeError } = await supabase
        .from('leads')
        .select('id')
        .eq('leadgen_id', String(leadId))
        .maybeSingle();

      if (dedupeError) {
        logger.warn({
          where: 'tiktokLeadsCollector',
          correlationId,
          lead_id: leadId,
          error: dedupeError.message
        }, 'Deduplication query failed, attempting insert anyway');
      }

      if (existing) {
        duplicates++;
        continue;
      }

      // Парсинг полей
      const fields = parseLeadFields(lead.field_data || lead.fields);

      // INSERT в leads — используем реальные колонки таблицы
      const { data: insertedLead, error: insertError } = await supabase
        .from('leads')
        .insert({
          user_account_id: direction.user_account_id,
          account_id: direction.account_id || null,
          direction_id: direction.id,
          conversion_source: 'tiktok_instant_form',
          source_type: 'lead_form',
          leadgen_id: String(leadId),
          name: fields.name || null,
          phone: fields.phone || null,
          email: fields.email || null
        })
        .select()
        .single();

      if (insertError) {
        // Дубликат через DB constraint (23505)
        if (insertError.code === '23505') {
          duplicates++;
          continue;
        }
        errors.push(`lead_id=${leadId}: ${insertError.message}`);
        continue;
      }

      newLeads++;

      logger.info({
        where: 'tiktokLeadsCollector',
        correlationId,
        lead_db_id: insertedLead?.id,
        lead_id: leadId,
        ad_id: lead.ad_id || null,
        direction_id: direction.id,
        has_phone: !!fields.phone,
        has_name: !!fields.name
      }, 'New lead saved');

      // Привязка к креативу через ad_creative_mapping (для ROI аналитики)
      const adId = lead.ad_id;
      if (insertedLead?.id && adId) {
        try {
          const { data: mapping, error: mappingError } = await supabase
            .from('ad_creative_mapping')
            .select('user_creative_id')
            .eq('ad_id', String(adId))
            .maybeSingle();

          if (mappingError) {
            logger.warn({
              where: 'tiktokLeadsCollector',
              correlationId,
              error: mappingError.message,
              ad_id: adId
            }, 'Error querying ad_creative_mapping');
          } else if (mapping?.user_creative_id) {
            const { error: updateError } = await supabase
              .from('leads')
              .update({ creative_id: mapping.user_creative_id })
              .eq('id', insertedLead.id);

            if (updateError) {
              logger.warn({
                where: 'tiktokLeadsCollector',
                correlationId,
                error: updateError.message,
                lead_id: leadId,
                creative_id: mapping.user_creative_id
              }, 'Failed to update lead with creative_id');
            } else {
              logger.debug({
                where: 'tiktokLeadsCollector',
                correlationId,
                lead_id: leadId,
                ad_id: adId,
                creative_id: mapping.user_creative_id
              }, 'Lead linked to creative');
            }
          } else {
            logger.warn({
              where: 'tiktokLeadsCollector',
              correlationId,
              ad_id: adId,
              lead_id: leadId
            }, 'No creative mapping found for ad_id');
          }
        } catch (mappingErr) {
          logger.warn({
            where: 'tiktokLeadsCollector',
            correlationId,
            error: mappingErr.message,
            ad_id: adId
          }, 'Exception linking lead to creative');
        }
      }
    } catch (leadErr) {
      errors.push(leadErr.message);
    }
  }

  const dirDurationMs = Date.now() - dirStartTime;

  logger.debug({
    where: 'tiktokLeadsCollector',
    correlationId,
    directionId: direction.id,
    totalProcessed: leads.length,
    newLeads,
    duplicates,
    skipped,
    errorsCount: errors.length,
    processingDurationMs: dirDurationMs
  }, 'Direction leads processing stats');

  return { newLeads, duplicates, errors };
}

/**
 * Собрать лиды TikTok из Instant Forms через Lead API
 *
 * @param {string} advertiserId - TikTok Advertiser ID
 * @param {string} accessToken - TikTok Access Token
 * @param {string} userAccountId - UUID пользователя в системе
 * @param {string|null} accountId - UUID рекламного аккаунта
 * @param {object} options
 * @param {number} options.days - Количество дней для polling (по умолчанию 2)
 * @param {string} options.correlationId - Correlation ID
 * @returns {Promise<{success: boolean, newLeads: number, duplicates: number, errors: string[], correlationId: string}>}
 */
export async function collectTikTokLeads(advertiserId, accessToken, userAccountId, accountId = null, options = {}) {
  const startTime = Date.now();
  const correlationId = options.correlationId || `tiktok_leads_${crypto.randomUUID()}`;
  const days = options.days || LEAD_COLLECTION_DAYS;
  let totalNewLeads = 0;
  let totalDuplicates = 0;
  const errors = [];

  // Вычисляем даты
  const endDate = new Date();
  endDate.setDate(endDate.getDate() - 1);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days + 1);
  const beginDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];

  logger.info({
    where: 'tiktokLeadsCollector',
    correlationId,
    advertiserId,
    userAccountId,
    accountId,
    beginDate: beginDateStr,
    endDate: endDateStr,
    days,
    action: 'collection_started'
  }, 'Starting TikTok leads collection');

  try {
    validateParams(advertiserId, accessToken, userAccountId, correlationId);

    // Step 1: Получить направления с lead_generation
    const directions = await getLeadGenerationDirections(userAccountId, accountId);

    if (directions.length === 0) {
      logger.info({
        where: 'tiktokLeadsCollector',
        correlationId,
        advertiserId,
        action: 'no_lead_gen_directions'
      }, 'No lead_generation directions found, skipping');
      return { success: true, newLeads: 0, duplicates: 0, errors: [], correlationId };
    }

    logger.info({
      where: 'tiktokLeadsCollector',
      correlationId,
      directionsCount: directions.length,
      directionNames: directions.map(d => d.name),
      action: 'directions_found'
    }, `Found ${directions.length} lead_generation directions`);

    // Step 2: Для каждого направления — создать задачу и скачать лиды
    for (const direction of directions) {
      const pageId = direction.tiktok_instant_page_id;
      if (!pageId) continue;

      try {
        // 2a: Создать задачу на скачивание лидов
        logger.info({
          where: 'tiktokLeadsCollector',
          correlationId,
          pageId,
          directionId: direction.id,
          directionName: direction.name,
          beginDate: beginDateStr,
          endDate: endDateStr,
          action: 'creating_task'
        }, 'Creating lead download task');

        const taskId = await retryWithBackoff(
          () => createTikTokLeadTask(advertiserId, accessToken, {
            pageId,
            beginDate: beginDateStr,
            endDate: endDateStr
          }),
          { correlationId, advertiserId, pageId, operation: 'createLeadTask' }
        );

        if (!taskId) {
          logger.warn({
            where: 'tiktokLeadsCollector',
            correlationId,
            pageId,
            directionId: direction.id,
            action: 'no_task_id'
          }, 'No task_id returned from TikTok API');
          errors.push(`page_id=${pageId}: no task_id returned`);
          continue;
        }

        const pollStartTime = Date.now();
        logger.info({
          where: 'tiktokLeadsCollector',
          correlationId,
          taskId,
          pageId,
          action: 'task_created'
        }, 'Lead download task created, polling for completion...');

        // 2b: Поллинг до завершения задачи
        const taskData = await pollTaskCompletion(advertiserId, accessToken, taskId, correlationId);
        const pollDurationMs = Date.now() - pollStartTime;

        logger.info({
          where: 'tiktokLeadsCollector',
          correlationId,
          taskId,
          pollDurationMs,
          action: 'task_completed'
        }, `Task completed in ${Math.round(pollDurationMs / 1000)}s`);

        // 2c: Извлечь лиды из результата
        // Логируем структуру ответа для диагностики формата API
        logger.debug({
          where: 'tiktokLeadsCollector',
          correlationId,
          taskId,
          taskDataKeys: Object.keys(taskData || {}),
          hasListField: !!taskData?.list,
          hasLeadsField: !!taskData?.leads,
          listLength: taskData?.list?.length,
          leadsLength: taskData?.leads?.length,
          firstLeadSample: taskData?.list?.[0] || taskData?.leads?.[0]
            ? Object.keys(taskData?.list?.[0] || taskData?.leads?.[0])
            : null
        }, 'Task download response structure');

        // TikTok может вернуть данные в разных форматах
        const leads = taskData?.list || taskData?.leads || [];

        if (leads.length === 0) {
          logger.info({
            where: 'tiktokLeadsCollector',
            correlationId,
            taskId,
            pageId,
            taskDataKeys: Object.keys(taskData || {}),
            action: 'no_leads_in_task'
          }, 'No leads in task result');
          continue;
        }

        logger.info({
          where: 'tiktokLeadsCollector',
          correlationId,
          taskId,
          pageId,
          leadsCount: leads.length,
          action: 'leads_downloaded'
        }, `Downloaded ${leads.length} leads from task`);

        // 2d: Обработка лидов
        const result = await processLeadsForDirection(direction, leads, correlationId);
        totalNewLeads += result.newLeads;
        totalDuplicates += result.duplicates;
        errors.push(...result.errors);

        logger.info({
          where: 'tiktokLeadsCollector',
          correlationId,
          directionId: direction.id,
          directionName: direction.name,
          pageId,
          newLeads: result.newLeads,
          duplicates: result.duplicates,
          errorsInDirection: result.errors.length,
          action: 'direction_processed'
        }, `Direction "${direction.name}": ${result.newLeads} new, ${result.duplicates} duplicates`);

      } catch (dirErr) {
        logger.warn({
          where: 'tiktokLeadsCollector',
          correlationId,
          directionId: direction.id,
          directionName: direction.name,
          pageId,
          error: dirErr.message,
          tikTokCode: dirErr.tikTokError?.code,
          action: 'direction_failed'
        }, `Failed to process direction "${direction.name}": ${dirErr.message}`);
        errors.push(`direction=${direction.name}: ${dirErr.message}`);
      }
    }

    const duration = Date.now() - startTime;

    logger.info({
      where: 'tiktokLeadsCollector',
      correlationId,
      advertiserId,
      totalNewLeads,
      totalDuplicates,
      errorsCount: errors.length,
      totalDurationMs: duration,
      action: 'collection_completed'
    }, `TikTok leads collection completed: ${totalNewLeads} new, ${totalDuplicates} duplicates`);

    return {
      success: errors.length === 0,
      newLeads: totalNewLeads,
      duplicates: totalDuplicates,
      errors,
      correlationId
    };

  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error({
      where: 'tiktokLeadsCollector',
      correlationId,
      advertiserId,
      userAccountId,
      accountId,
      error: error.message,
      errorStack: error.stack,
      totalDurationMs: duration,
      action: 'collection_failed'
    }, `TikTok leads collection failed: ${error.message}`);

    return {
      success: false,
      newLeads: totalNewLeads,
      duplicates: totalDuplicates,
      errors: [error.message],
      correlationId
    };
  }
}

export default { collectTikTokLeads };
