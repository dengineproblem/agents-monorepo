import Fastify from 'fastify';
import cors from '@fastify/cors';
import 'dotenv/config';
import OpenAI from 'openai';
import cron from 'node-cron';
import { randomUUID, randomBytes } from 'node:crypto';
import { logger as baseLogger } from './lib/logger.js';
import { runScoringAgent } from './scoring.js';
import { startLogAlertsWorker } from './lib/logAlerts.js';
import { supabase, supabaseQuery } from './lib/supabaseClient.js';
import { startAmoCRMLeadsSyncCron } from './amocrmLeadsSyncCron.js';
import { updateCurrencyRates } from './currencyRateCron.js';
import { analyzeCreativeTest } from './creativeAnalyzer.js';
import { registerChatRoutes } from './chatAssistant/index.js';
import { logErrorToAdmin, logFacebookError } from './lib/errorLogger.js';
import { startMoltbotUsageTracking } from './moltbot/usageTracker.js';
import { routeToSpecialist } from './moltbot/router.js';
import { registerMCPRoutes, MCP_CONFIG } from './mcp/index.js';
import { getTikTokAdvertiserInfo, getTikTokReport, getTikTokCampaigns, getTikTokAdGroups } from './chatAssistant/shared/tikTokGraph.js';
import { getUsdToKzt, convertUsdToKzt } from './chatAssistant/shared/currencyRate.js';
import { collectTikTokMetricsForDays } from './tiktokMetricsCollector.js';
import { uploadVideoToFacebook } from './lib/videoUpload.js';

// Основной бот для отправки отчётов клиентам и в мониторинг
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MONITORING_CHAT_IDS = (process.env.MONITORING_CHAT_ID || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

const fastify = Fastify({
  logger: baseLogger,
  genReqId: () => randomUUID()
});

// SECURITY: CORS whitelist - разрешаем только известные домены
const ALLOWED_ORIGINS = [
  // Production
  'https://app.performanteaiagency.com',
  'https://performanteaiagency.com',
  'https://www.performanteaiagency.com',
  'https://agents.performanteaiagency.com',
  'https://crm.performanteaiagency.com',
  'https://brain2.performanteaiagency.com',
  // Development
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3003',
  'http://localhost:8081',
  'http://localhost:8082',
  'http://localhost:8087',
  'http://localhost:7080'
];

await fastify.register(cors, {
  origin: (origin, cb) => {
    // Разрешаем запросы без origin (server-to-server, curl, etc)
    if (!origin) {
      cb(null, true);
      return;
    }
    if (ALLOWED_ORIGINS.includes(origin)) {
      // Возвращаем конкретный origin, а не true
      cb(null, origin);
    } else {
      fastify.log.warn({ origin }, 'CORS: blocked request from unknown origin');
      cb(new Error('CORS: origin not allowed'), false);
    }
  },
  credentials: true,
  preflight: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-user-id']
});

fastify.addHook('onRequest', (request, _reply, done) => {
  request.log = baseLogger.child({ requestId: request.id });
  done();
});

// ОТКЛЮЧЕНО: ошибки теперь отправляются через errorLogger в agent-service
// startLogAlertsWorker(fastify.log).catch((err) => fastify.log.error({ err }, 'Log alerts worker crashed'));

async function responsesCreate(payload) {
  // Строго фильтруем параметры, чтобы не уехать с max_tokens/max_output_tokens
  const { model, input, reasoning, temperature, top_p, metadata } = payload || {};
  const safeBody = {
    ...(model ? { model } : {}),
    ...(input ? { input } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(typeof temperature === 'number' ? { temperature } : {}),
    ...(typeof top_p === 'number' ? { top_p } : {}),
    ...(metadata ? { metadata } : {})
  };
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify(safeBody)
  });
  const text = await res.text();
  
  // Логируем полный ответ для диагностики
  try { 
    fastify.log.info({ 
      where:'responsesCreate', 
      status: res.status, 
      bodyPreview: text.slice(0, 500),
      bodyLength: text.length,
      fullBody: text  // ПОЛНЫЙ ответ
    }); 
  } catch {}
  
  if (!res.ok) {
    const err = new Error(`${res.status} ${text}`);
    err._requestBody = safeBody;
    err._responseText = text;
    err.status = res.status; // Сохраняем HTTP статус для retry-логики
    throw err;
  }
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

/**
 * Wrapper для responsesCreate с retry-логикой
 * Ретраит только на временные ошибки: 429, 500, 502, 503
 */
async function responsesCreateWithRetry(payload, maxRetries = Number(process.env.OPENAI_MAX_RETRIES || 3)) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await responsesCreate(payload);
      
      // Успех! Если это была не первая попытка - логируем
      if (attempt > 1) {
        fastify.log.info({ 
          where: 'responsesCreateWithRetry', 
          attempt, 
          status: 'success_after_retry' 
        });
      }
      
      return result;
      
    } catch (error) {
      lastError = error;
      const status = error.status || parseInt(error.message?.match(/^\d+/)?.[0]);
      
      // Определяем, нужно ли ретраить
      const shouldRetry = 
        status === 429 ||  // Rate limit
        status === 500 ||  // Internal server error
        status === 502 ||  // Bad gateway
        status === 503 ||  // Service unavailable
        !status;           // Network error (нет статуса)
      
      // Если ошибка не подлежит retry (400, 401, 403, 404 и т.д.) - сразу падаем
      if (!shouldRetry) {
        fastify.log.error({ 
          where: 'responsesCreateWithRetry', 
          attempt,
          status,
          reason: 'non_retryable_error',
          error: String(error)
        });
        throw error;
      }
      
      // Если последняя попытка - бросаем ошибку
      if (attempt === maxRetries) {
        fastify.log.error({ 
          where: 'responsesCreateWithRetry', 
          attempts: maxRetries, 
          status: 'failed_all_retries',
          httpStatus: status,
          error: String(error)
        });
        throw error;
      }
      
      // Exponential backoff: 2s, 4s, 8s...
      const delayMs = Math.pow(2, attempt) * 1000;
      
      fastify.log.warn({ 
        where: 'responsesCreateWithRetry', 
        attempt, 
        maxRetries,
        httpStatus: status,
        delayMs,
        nextAttemptIn: `${delayMs / 1000}s`,
        error: String(error).slice(0, 200)
      });
      
      // Ждём перед следующей попыткой
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  throw lastError;
}

// Test endpoint: fetch raw adsets from Facebook API
fastify.get('/api/brain/test-fb-adsets', async (request, reply) => {
  try {
    const userAccountId = request.query.userAccountId;
    if (!userAccountId) return reply.code(400).send({ error: 'userAccountId required' });
    const ua = await getUserAccount(userAccountId);
    const adsets = await fetchAdsets(ua.ad_account_id, ua.access_token);
    return reply.send({ raw: adsets, formatted: (adsets?.data || []).map(a => ({
      id: a.id,
      name: a.name,
      daily_budget_raw: a.daily_budget,
      daily_budget_type: typeof a.daily_budget,
      daily_budget_parsed: toInt(a.daily_budget)
    })) });
  } catch (e) {
    logErrorToAdmin({
      user_account_id: request.query.userAccountId,
      error_type: 'facebook',
      raw_error: e.message || String(e),
      stack_trace: e.stack,
      action: 'test_fb_adsets',
      endpoint: '/api/brain/test-fb-adsets',
      severity: 'warning'
    }).catch(() => {});

    return reply.code(500).send({ error: String(e) });
  }
});

// Health-check LLM endpoint: sends a tiny prompt and returns raw result
fastify.get('/api/brain/llm-ping', async (request, reply) => {
  try {
    const resp = await responsesCreate({
      model: MODEL,
      input: [
        { role: 'system', content: [ { type: 'input_text', text: 'Ты ассистент. Ответь одним словом: ok' } ] },
        { role: 'user', content: [ { type: 'input_text', text: 'ping' } ] }
      ]
    });
    // Extract text from output array
    let txt = '';
    if (Array.isArray(resp.output)) {
      // Find message object in output
      const message = resp.output.find(o => o.type === 'message');
      if (message && Array.isArray(message.content)) {
        // Find output_text in message content
        const textContent = message.content.find(c => c.type === 'output_text');
        txt = textContent?.text || '';
      }
    }
    return reply.send({ ok: true, model: MODEL, raw: txt });
  } catch (e) {
    logErrorToAdmin({
      error_type: 'api',
      raw_error: e.message || String(e),
      stack_trace: e.stack,
      action: 'llm_ping',
      endpoint: '/api/brain/llm-ping',
      severity: 'warning'
    }).catch(() => {});

    return reply.code(500).send({ ok: false, error: String(e), request: e?._requestBody, response: e?._responseText });
  }
});

// Test endpoint: run ONLY scoring agent (without main brain)
fastify.post('/api/brain/test-scoring', async (request, reply) => {
  try {
    const { userAccountId } = request.body;
    if (!userAccountId) {
      return reply.code(400).send({ error: 'userAccountId required' });
    }
    
    fastify.log.info({ where: 'test_scoring', userAccountId });
    
    // Get user account
    const { data: ua, error: uaError } = await supabase
      .from('user_accounts')
      .select('*')
      .eq('id', userAccountId)
      .single();
    
    if (uaError || !ua) {
      return reply.code(404).send({ error: 'User account not found' });
    }

    // Получаем UUID рекламного аккаунта для мультиаккаунтного режима
    const accountUUID = await getAccountUUID(userAccountId, ua);

    // Run scoring agent
    const scoringOutput = await runScoringAgent(ua, {
      supabase,
      logger: fastify.log,
      useLLM: true,
      responsesCreate: responsesCreateWithRetry,
      minImpressions: SCORING_MIN_IMPRESSIONS,
      predictionDays: SCORING_PREDICTION_DAYS,
      accountUUID: accountUUID
    });
    
    return reply.send({
      success: true,
      userAccountId,
      model: MODEL,
      scoring: scoringOutput
    });
    
  } catch (e) {
    fastify.log.error({ where: 'test_scoring', error: String(e), stack: e.stack });

    logErrorToAdmin({
      user_account_id: request.body?.userAccountId,
      error_type: 'scoring',
      raw_error: e.message || String(e),
      stack_trace: e.stack,
      action: 'test_scoring',
      endpoint: '/api/brain/test-scoring',
      severity: 'warning'
    }).catch(() => {});

    return reply.code(500).send({
      error: String(e),
      stack: e.stack
    });
  }
});

// Test endpoint: test Smart Merger (Health Score + Scoring data)
fastify.post('/api/brain/test-merger', async (request, reply) => {
  try {
    const { userAccountId } = request.body;
    if (!userAccountId) {
      return reply.code(400).send({ error: 'userAccountId required' });
    }
    
    fastify.log.info({ where: 'test_merger', userAccountId });

    const ua = await getUserAccount(userAccountId);

    // Получаем UUID рекламного аккаунта для мультиаккаунтного режима
    const accountUUID = await getAccountUUID(userAccountId, ua);

    // 1. Run Scoring Agent
    const scoringData = await runScoringAgent(ua, {
      supabase,
      logger: fastify.log,
      responsesCreate: responsesCreateWithRetry,
      saveExecution: false,
      accountUUID: accountUUID
    });
    
    // 2. Fetch FB data and calculate Health Score
    const [adsets, yRows, d3Rows, d7Rows, d30Rows, todayRows] = await Promise.all([
      fetchAdsets(ua.ad_account_id, ua.access_token).catch(e => ({ error: String(e) })),
      fetchInsightsPreset(ua.ad_account_id, ua.access_token, 'yesterday').then(r => r.data || []).catch(() => []),
      fetchInsightsPreset(ua.ad_account_id, ua.access_token, 'last_3d').then(r => r.data || []).catch(() => []),
      fetchInsightsPreset(ua.ad_account_id, ua.access_token, 'last_7d').then(r => r.data || []).catch(() => []),
      fetchInsightsPreset(ua.ad_account_id, ua.access_token, 'last_30d').then(r => r.data || []).catch(() => []),
      fetchInsightsPreset(ua.ad_account_id, ua.access_token, 'today').then(r => r.data || []).catch(() => [])
    ]);
    
    const byY = indexByAdset(yRows);
    const by3 = indexByAdset(d3Rows);
    const by7 = indexByAdset(d7Rows);
    const by30 = indexByAdset(d30Rows);
    const byToday = indexByAdset(todayRows);
    
    // Calculate peers
    const allCpm = yRows.map(r => parseFloat(r.cpm || 0)).filter(x => x > 0);
    const peers = { cpm: allCpm };
    
    // Weights & classes & targets (from config)
    const weights = { cpl_gap: 15, trend: 10, ctr_penalty: 5, cpm_penalty: 5, freq_penalty: 5 };
    const classes = { very_good: 20, good: 10, neutral_low: -10, bad: -20 };
    const targets = { cpl_cents: 200 };
    
    // 3. Calculate Health Score + apply Smart Merger for each adset
    const unifiedAssessments = [];
    const adsetList = Array.isArray(adsets?.data) ? adsets.data : [];
    const activeAdsets = adsetList.filter(as => as.effective_status === 'ACTIVE');
    
    for (const as of activeAdsets) {
      const id = as.id;
      const windows = {
        y: byY.get(id) || {},
        d3: by3.get(id) || {},
        d7: by7.get(id) || {},
        d30: by30.get(id) || {},
        today: byToday.get(id) || {}
      };
      
      const hs = computeHealthScoreForAdset({ weights, classes, targets, windows, peers });
      
      // Smart Merger!
      const unified = mergeHealthAndScoring({
        healthScore: hs,
        scoringData: scoringData,
        adsetId: id
      });
      
      unifiedAssessments.push({
        adset_id: id,
        adset_name: as.name,
        health_score: {
          score: hs.score,
          cls: hs.cls,
          eCplY: hs.eCplY,
          ctr: hs.ctr,
          cpm: hs.cpm,
          freq: hs.freq
        },
        scoring_data: scoringData.adsets.find(s => s.adset_id === id),
        unified: unified
      });
    }
    
    return reply.send({
      success: true,
      userAccountId,
      stats: {
        total_adsets: adsetList.length,
        active_adsets: activeAdsets.length,
        ready_creatives: scoringData.ready_creatives?.length || 0
      },
      unified_assessments: unifiedAssessments
    });
    
  } catch (e) {
    fastify.log.error({ where: 'test_merger', error: String(e), stack: e.stack });

    logErrorToAdmin({
      user_account_id: request.body?.userAccountId,
      error_type: 'scoring',
      raw_error: e.message || String(e),
      stack_trace: e.stack,
      action: 'test_merger',
      endpoint: '/api/brain/test-merger',
      severity: 'warning'
    }).catch(() => {});

    return reply.code(500).send({
      error: String(e),
      stack: e.stack
    });
  }
});

// Test endpoint: save metrics only (no actions, no telegram report)
fastify.post('/api/brain/test-save-metrics', async (request, reply) => {
  try {
    const { userAccountId, accountId } = request.body;
    if (!userAccountId && !accountId) {
      return reply.code(400).send({ error: 'userAccountId or accountId required' });
    }

    fastify.log.info({
      where: 'test_save_metrics',
      userAccountId,
      accountId,
      status: 'started'
    });

    let user_account_id = userAccountId;
    let account_uuid = accountId;
    let adAccountId = null;
    let accessToken = null;

    // Если передан accountId (multi-account), загружаем из ad_accounts
    if (accountId) {
      const { data: account, error: accountError } = await supabase
        .from('ad_accounts')
        .select('user_account_id, ad_account_id, fb_ad_account_id, access_token, user_accounts(access_token)')
        .eq('id', accountId)
        .single();

      if (accountError || !account) {
        return reply.code(404).send({ error: 'Account not found' });
      }

      user_account_id = account.user_account_id;
      adAccountId = account.fb_ad_account_id || account.ad_account_id;
      accessToken = account.access_token || account.user_accounts?.access_token;
    } else {
      // Legacy: загружаем из user_accounts
      const { data: userAccount, error: userError } = await supabase
        .from('user_accounts')
        .select('ad_account_id, access_token')
        .eq('id', userAccountId)
        .single();

      if (userError || !userAccount) {
        return reply.code(404).send({ error: 'User account not found' });
      }

      adAccountId = userAccount.ad_account_id;
      accessToken = userAccount.access_token;

      // Получаем account_uuid для legacy
      const { data: legacyAccount } = await supabase
        .from('ad_accounts')
        .select('id')
        .eq('user_account_id', userAccountId)
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .single();

      account_uuid = legacyAccount?.id || null;
    }

    if (!adAccountId || !accessToken) {
      return reply.code(400).send({ error: 'Missing ad_account_id or access_token' });
    }

    // Вызываем saveMetricsIfNotSavedToday
    const result = await saveMetricsIfNotSavedToday(
      user_account_id,
      account_uuid,
      adAccountId,
      accessToken
    );

    fastify.log.info({
      where: 'test_save_metrics',
      userAccountId: user_account_id,
      accountId: account_uuid,
      result,
      status: 'completed'
    });

    return reply.send({
      success: true,
      userAccountId: user_account_id,
      accountId: account_uuid,
      adAccountId,
      ...result
    });

  } catch (e) {
    fastify.log.error({
      where: 'test_save_metrics',
      error: String(e),
      stack: e.stack
    });

    return reply.code(500).send({
      error: String(e),
      stack: e.stack
    });
  }
});

// Test endpoint: restore metrics for date range (historical backfill)
fastify.post('/api/brain/test-restore-metrics', async (request, reply) => {
  try {
    const { userAccountId, accountId, dateFrom, dateTo } = request.body;

    if (!userAccountId && !accountId) {
      return reply.code(400).send({ error: 'userAccountId or accountId required' });
    }

    if (!dateFrom || !dateTo) {
      return reply.code(400).send({ error: 'dateFrom and dateTo required (YYYY-MM-DD)' });
    }

    fastify.log.info({
      where: 'test_restore_metrics',
      userAccountId,
      accountId,
      dateFrom,
      dateTo,
      status: 'started'
    });

    let user_account_id = userAccountId;
    let account_uuid = accountId;
    let adAccountId = null;
    let accessToken = null;

    // Если передан accountId (multi-account), загружаем из ad_accounts
    if (accountId) {
      const { data: account, error: accountError } = await supabase
        .from('ad_accounts')
        .select('user_account_id, ad_account_id, fb_ad_account_id, access_token, user_accounts(access_token)')
        .eq('id', accountId)
        .single();

      if (accountError || !account) {
        return reply.code(404).send({ error: 'Account not found' });
      }

      user_account_id = account.user_account_id;
      adAccountId = account.fb_ad_account_id || account.ad_account_id;
      accessToken = account.access_token || account.user_accounts?.access_token;
    } else {
      // Legacy: загружаем из user_accounts
      const { data: userAccount, error: userError } = await supabase
        .from('user_accounts')
        .select('ad_account_id, access_token')
        .eq('id', userAccountId)
        .single();

      if (userError || !userAccount) {
        return reply.code(404).send({ error: 'User account not found' });
      }

      adAccountId = userAccount.ad_account_id;
      accessToken = userAccount.access_token;

      // Получаем account_uuid для legacy
      const { data: legacyAccount } = await supabase
        .from('ad_accounts')
        .select('id')
        .eq('user_account_id', userAccountId)
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .single();

      account_uuid = legacyAccount?.id || null;
    }

    if (!adAccountId || !accessToken) {
      return reply.code(400).send({ error: 'Missing ad_account_id or access_token' });
    }

    // Вызываем восстановление метрик за диапазон дат
    const result = await restoreMetricsForDateRange(
      user_account_id,
      account_uuid,
      adAccountId,
      accessToken,
      dateFrom,
      dateTo
    );

    fastify.log.info({
      where: 'test_restore_metrics',
      userAccountId: user_account_id,
      accountId: account_uuid,
      result,
      status: 'completed'
    });

    return reply.send({
      success: result.success,
      userAccountId: user_account_id,
      accountId: account_uuid,
      adAccountId,
      dateFrom,
      dateTo,
      ...result
    });

  } catch (e) {
    fastify.log.error({
      where: 'test_restore_metrics',
      error: String(e),
      stack: e.stack
    });

    return reply.code(500).send({
      error: String(e),
      stack: e.stack
    });
  }
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const FB_API_VERSION = 'v20.0';
const MODEL = process.env.BRAIN_MODEL || 'gpt-5';
const USE_LLM = String(process.env.BRAIN_USE_LLM || 'true').toLowerCase() === 'true';
const CAN_USE_LLM = USE_LLM && Boolean(process.env.OPENAI_API_KEY);
// ВАЖНО: БЕЗ /api/ потому что agent-brain обращается к agent-service НАПРЯМУЮ (минуя nginx)
// Nginx убирает /api/ только для внешних запросов, но внутри Docker сети роуты БЕЗ /api/
const AGENT_URL = (process.env.AGENT_SERVICE_URL || '').replace(/\/+$/,'') + '/agent/actions';
const BRAIN_DRY_RUN = String(process.env.BRAIN_DRY_RUN || 'false').toLowerCase() === 'true';
const BRAIN_MAX_ACTIONS_PER_RUN = Number(process.env.BRAIN_MAX_ACTIONS_PER_RUN || '5');
const BRAIN_DEBUG_LLM = String(process.env.BRAIN_DEBUG_LLM || 'false').toLowerCase() === 'true';

// Scoring Agent configuration
const SCORING_ENABLED = String(process.env.SCORING_ENABLED || 'true').toLowerCase() === 'true';
const SCORING_MIN_IMPRESSIONS = Number(process.env.SCORING_MIN_IMPRESSIONS || '1000');
const SCORING_PREDICTION_DAYS = Number(process.env.SCORING_PREDICTION_DAYS || '3');

// Helper function to normalize ad account ID (ensures 'act_' prefix)
function normalizeAdAccountId(adAccountId) {
  if (!adAccountId) return '';
  const id = String(adAccountId).trim();
  return id.startsWith('act_') ? id : `act_${id}`;
}

const ALLOWED_TYPES = new Set([
  'GetCampaignStatus',
  'PauseCampaign',
  'UpdateAdSetDailyBudget',
  'PauseAd',
  'PauseAdset',
  // Workflows (executor manual handlers)
  'Workflow.DuplicateAndPauseOriginal',
  'Workflow.DuplicateKeepOriginalActive',
  // Audience tools
  'Audience.DuplicateAdSetWithAudience',
  // Direction-based adset creation (use existing campaign from direction)
  // Brain Agent работает ТОЛЬКО на уровне adsets, НЕ создает новые кампании!
  'Direction.CreateAdSetWithCreatives',
  // Use existing pre-created ad sets (for use_existing mode)
  'Direction.UseExistingAdSetWithCreatives'
]);

const TIKTOK_ALLOWED_TYPES = new Set([
  'TikTok.GetCampaignStatus',
  'TikTok.PauseCampaign',
  'TikTok.ResumeCampaign',
  'TikTok.PauseAdGroup',
  'TikTok.ResumeAdGroup',
  'TikTok.UpdateAdGroupBudget',
  'TikTok.PauseAd',
  'TikTok.ResumeAd',
  'TikTok.Direction.CreateAdGroupWithCreatives'
]);

const TIKTOK_MIN_DAILY_BUDGET_KZT = Number(process.env.TIKTOK_MIN_DAILY_BUDGET_KZT || 2500);
const TIKTOK_MIN_DAILY_BUDGET_USD = process.env.TIKTOK_MIN_DAILY_BUDGET_USD
  ? Number(process.env.TIKTOK_MIN_DAILY_BUDGET_USD)
  : null;
const TIKTOK_MAX_DAILY_BUDGET_KZT = Number(process.env.TIKTOK_MAX_DAILY_BUDGET_KZT || 100000000);
const TIKTOK_DEFAULT_CPL_KZT = Number(process.env.TIKTOK_DEFAULT_CPL_KZT || 5000);

function genIdem() {
  const d = new Date();
  const p = (n)=>String(n).padStart(2,'0');
  return `think-${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}-${Math.random().toString(36).slice(2,8)}`;
}
const toInt = (v) => Number.isFinite(+v) ? Math.round(+v) : null;

async function getUserAccount(userAccountId) {
  return await supabaseQuery('user_accounts',
    async () => await supabase
      .from('user_accounts')
      .select('id, access_token, ad_account_id, page_id, telegram_id, telegram_id_2, telegram_id_3, telegram_id_4, telegram_bot_token, username, prompt3, plan_daily_budget_cents, default_cpl_target_cents, whatsapp_phone_number, ig_seed_audience_id, default_adset_mode, multi_account_enabled, account_timezone, tiktok_access_token, tiktok_business_id, tiktok_account_id, autopilot_tiktok')
      .eq('id', userAccountId)
      .single(),
    { userAccountId }
  );
}

/**
 * Получает UUID рекламного аккаунта (ad_accounts.id) для мультиаккаунтного режима.
 * Возвращает null для legacy режима (multi_account_enabled = false).
 *
 * @param {string} userAccountId - UUID пользователя из user_accounts
 * @param {object} ua - объект пользователя с multi_account_enabled и ad_account_id
 * @returns {Promise<string|null>} UUID из ad_accounts.id или null
 */
async function getAccountUUID(userAccountId, ua) {
  if (!ua?.multi_account_enabled) {
    return null; // Legacy режим - account_id не используется
  }

  if (!ua.ad_account_id) {
    fastify.log.warn({
      msg: 'getAccountUUID: multi_account_enabled but no ad_account_id',
      userAccountId
    });
    return null;
  }

  try {
    const { data: adAccount, error } = await supabase
      .from('ad_accounts')
      .select('id')
      .eq('user_account_id', userAccountId)
      .eq('ad_account_id', ua.ad_account_id)
      .single();

    if (error || !adAccount) {
      fastify.log.warn({
        msg: 'getAccountUUID: ad_account not found',
        userAccountId,
        fbAdAccountId: ua.ad_account_id,
        error: error?.message
      });
      return null;
    }

    return adAccount.id;
  } catch (e) {
    fastify.log.warn({
      msg: 'getAccountUUID: error',
      userAccountId,
      error: String(e)
    });
    return null;
  }
}

async function getLastReports(telegramId) {
  if (!supabase || !telegramId) return [];
  const { data, error } = await supabase
    .from('campaign_reports')
    .select('report_data, created_at')
    .eq('telegram_id', String(telegramId))
    .order('created_at', { ascending: false })
    .limit(3);
  if (error) {
    fastify.log.warn({ msg: 'load_last_reports_failed', error });
    return [];
  }
  return data || [];
}

// ========================================
// DIRECTIONS (Направления бизнеса)
// ========================================

/**
 * Получить направления пользователя
 * @param {string} userAccountId - UUID пользователя
 * @param {string|null} accountId - UUID из ad_accounts.id для мультиаккаунтного режима (null для legacy)
 *
 * ВАЖНО: В мультиаккаунтном режиме фильтруем ТОЛЬКО по account_id (без legacy fallback)
 * Это предотвращает смешивание направлений разных аккаунтов
 */
async function getUserDirections(userAccountId, accountId = null) {
  const startTime = Date.now();
  const mode = accountId ? 'multi_account' : 'legacy';

  fastify.log.info({
    where: 'getUserDirections',
    phase: 'start',
    userAccountId,
    accountId: accountId || null,
    mode,
    filter: accountId ? `account_id = '${accountId}'` : 'account_id IS NULL'
  });

  try {
    let query = supabase
      .from('account_directions')
      .select('*')
      .eq('user_account_id', userAccountId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    // В мультиаккаунтном режиме фильтруем ТОЛЬКО по account_id
    if (accountId) {
      query = query.eq('account_id', accountId);
    }
    // Для legacy режима (accountId = null) — загружаем направления без account_id
    else {
      query = query.is('account_id', null);
    }

    const data = await supabaseQuery('account_directions', async () => query, { userAccountId, accountId });
    const duration = Date.now() - startTime;

    fastify.log.info({
      where: 'getUserDirections',
      phase: 'complete',
      userAccountId,
      accountId: accountId || null,
      mode,
      count: data?.length || 0,
      directionNames: (data || []).slice(0, 5).map(d => d.name),
      durationMs: duration
    });

    return data || [];
  } catch (error) {
    const duration = Date.now() - startTime;
    fastify.log.error({
      where: 'getUserDirections',
      phase: 'error',
      userAccountId,
      accountId: accountId || null,
      mode,
      error: String(error),
      stack: error?.stack,
      durationMs: duration
    });
    return [];
  }
}

async function getDirectionByCampaignId(campaignId) {
  if (!supabase || !campaignId) return null;
  const { data, error } = await supabase
    .from('account_directions')
    .select('*')
    .eq('fb_campaign_id', campaignId)
    .single();
  
  if (error) {
    return null; // Кампания может не иметь направления (legacy)
  }
  return data;
}

async function fbGet(url) {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`FB ${res.status}: ${text}`);
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function fetchAccountStatus(adAccountId, accessToken) {
  const url = new URL(`https://graph.facebook.com/${FB_API_VERSION}/${adAccountId}`);
  url.searchParams.set('fields','account_status,disable_reason');
  url.searchParams.set('access_token', accessToken);
  return fbGet(url.toString());
}
async function fetchAdsets(adAccountId, accessToken) {
  const url = new URL(`https://graph.facebook.com/${FB_API_VERSION}/${adAccountId}/adsets`);
  url.searchParams.set('fields','id,name,campaign_id,daily_budget,lifetime_budget,status,effective_status');
  url.searchParams.set('limit', '500'); // Get all adsets, not just first 25
  url.searchParams.set('access_token', accessToken);
  return fbGet(url.toString());
}
async function fetchYesterdayInsights(adAccountId, accessToken) {
  const url = new URL(`https://graph.facebook.com/${FB_API_VERSION}/${adAccountId}/insights`);
  url.searchParams.set('fields','campaign_name,campaign_id,adset_name,adset_id,ad_name,ad_id,spend,actions,cpm,ctr,video_thruplay_watched_actions');
  url.searchParams.set('date_preset','yesterday');
  url.searchParams.set('level','adset');
  url.searchParams.set('action_breakdowns','action_type');
  url.searchParams.set('limit', '500'); // Get all adsets, not just first 25
  url.searchParams.set('access_token', accessToken);
  return fbGet(url.toString());
}

async function fetchInsightsPreset(adAccountId, accessToken, datePreset) {
  const url = new URL(`https://graph.facebook.com/${FB_API_VERSION}/${adAccountId}/insights`);
  url.searchParams.set('fields','campaign_name,campaign_id,adset_name,adset_id,spend,actions,cpm,ctr,impressions,frequency');
  url.searchParams.set('date_preset', datePreset);
  url.searchParams.set('level','adset');
  url.searchParams.set('action_breakdowns','action_type');
  url.searchParams.set('limit', '500'); // Ensure we get all adsets
  url.searchParams.set('access_token', accessToken);
  return fbGet(url.toString());
}

async function fetchAdLevelInsightsPreset(adAccountId, accessToken, datePreset) {
  const url = new URL(`https://graph.facebook.com/${FB_API_VERSION}/${adAccountId}/insights`);
  url.searchParams.set('fields','ad_name,ad_id,adset_id,spend,actions,impressions');
  url.searchParams.set('date_preset', datePreset);
  url.searchParams.set('level','ad');
  url.searchParams.set('action_breakdowns','action_type');
  url.searchParams.set('limit', '500'); // Ensure we get all ads
  url.searchParams.set('access_token', accessToken);
  return fbGet(url.toString());
}

async function fetchCampaignInsightsPreset(adAccountId, accessToken, datePreset) {
  const url = new URL(`https://graph.facebook.com/${FB_API_VERSION}/${adAccountId}/insights`);
  url.searchParams.set('fields','campaign_name,campaign_id,spend,actions,cpm,ctr,impressions,frequency');
  url.searchParams.set('date_preset', datePreset);
  url.searchParams.set('level','campaign');
  url.searchParams.set('action_breakdowns','action_type');
  url.searchParams.set('limit', '500'); // Ensure we get all campaigns
  url.searchParams.set('access_token', accessToken);
  return fbGet(url.toString());
}

async function fetchCampaigns(adAccountId, accessToken) {
  const url = new URL(`https://graph.facebook.com/${FB_API_VERSION}/${adAccountId}/campaigns`);
  url.searchParams.set('fields','id,name,status,effective_status,daily_budget,lifetime_budget');
  url.searchParams.set('limit', '500'); // Ensure we get all campaigns
  url.searchParams.set('access_token', accessToken);
  return fbGet(url.toString());
}

function sumInt(a, b) { return (Number.isFinite(a)?a:0) + (Number.isFinite(b)?b:0); }

function computeLeadsFromActions(stat) {
  let messagingLeads = 0;
  let qualityLeads = 0;
  let siteLeads = 0;
  let formLeads = 0;
  let hasPixelLead = false;
  const actions = Array.isArray(stat?.actions) ? stat.actions : [];
  for (const action of actions) {
    const t = action?.action_type;
    const v = parseInt(action?.value || '0', 10) || 0;
    if (t === 'onsite_conversion.total_messaging_connection') {
      messagingLeads = v;
    } else if (t === 'onsite_conversion.messaging_user_depth_2_message_send') {
      qualityLeads = v;
    }
    // Лиды с сайта - fb_pixel_lead имеет приоритет
    // чтобы избежать дублирования с агрегатами/onsite_web_lead
    else if (t === 'offsite_conversion.fb_pixel_lead') {
      siteLeads = v;
      hasPixelLead = true;
    }
    // Кастомные конверсии пикселя - только если нет fb_pixel_lead
    else if (!hasPixelLead && typeof t === 'string' && t.startsWith('offsite_conversion.custom')) {
      siteLeads = v;
    }
    // Facebook Lead Forms - только onsite_conversion.lead_grouped
    else if (t === 'onsite_conversion.lead_grouped') {
      formLeads = v;
    }
  }
  // Считаем все типы лидов:
  // - messagingLeads: WhatsApp/Instagram conversations
  // - siteLeads: offsite_conversion.fb_pixel_lead (пиксельные лиды; custom* только если нет fb_pixel_lead)
  // - formLeads: action_type 'onsite_conversion.lead_grouped' (Facebook Lead Forms / Instant Forms)
  // Они НЕ дублируются если objective правильно настроен:
  // - site_leads кампании: только siteLeads
  // - lead_forms кампании: только formLeads
  const leads = messagingLeads + siteLeads + formLeads;
  return { messagingLeads, qualityLeads, siteLeads, formLeads, leads };
}

function formatDateInTimeZone(date, timeZone) {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    return formatter.format(date);
  } catch (err) {
    return new Date(date).toISOString().split('T')[0];
  }
}

function getDateRangePreset(preset, timeZone) {
  const now = new Date();
  const todayStr = formatDateInTimeZone(now, timeZone);
  const [year, month, day] = todayStr.split('-').map(Number);
  const base = new Date(Date.UTC(year, month - 1, day, 12));
  const shift = (days) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + days);
    return formatDateInTimeZone(d, timeZone);
  };

  switch (preset) {
    case 'today':
      return { startDate: todayStr, endDate: todayStr };
    case 'yesterday': {
      const y = shift(-1);
      return { startDate: y, endDate: y };
    }
    case 'last_3d':
      return { startDate: shift(-3), endDate: todayStr };
    case 'last_7d':
      return { startDate: shift(-7), endDate: todayStr };
    case 'last_30d':
      return { startDate: shift(-30), endDate: todayStr };
    default:
      return { startDate: todayStr, endDate: todayStr };
  }
}

function parseTikTokMetrics(metrics = {}) {
  return {
    spend: Number(metrics.spend) || 0,
    impressions: Number(metrics.impressions) || 0,
    clicks: Number(metrics.clicks) || 0,
    conversions: Number(metrics.conversions) || 0
  };
}

function mergeTikTokMetrics(target, incoming) {
  target.spend += incoming.spend;
  target.impressions += incoming.impressions;
  target.clicks += incoming.clicks;
  target.conversions += incoming.conversions;
  return target;
}

function finalizeTikTokMetrics(metrics) {
  const spend = Number(metrics.spend) || 0;
  const impressions = Number(metrics.impressions) || 0;
  const clicks = Number(metrics.clicks) || 0;
  const conversions = Number(metrics.conversions) || 0;
  return {
    spend,
    impressions,
    clicks,
    conversions,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    cpc: clicks > 0 ? (spend / clicks) : 0
  };
}

function indexTikTokReportBy(rows, dimensionKey) {
  const map = new Map();
  for (const row of rows || []) {
    const id = row?.dimensions?.[dimensionKey];
    if (!id) continue;
    const metrics = parseTikTokMetrics(row?.metrics || {});
    const prev = map.get(id) || { spend: 0, impressions: 0, clicks: 0, conversions: 0 };
    map.set(id, mergeTikTokMetrics(prev, metrics));
  }
  for (const [id, metrics] of map.entries()) {
    map.set(id, finalizeTikTokMetrics(metrics));
  }
  return map;
}

function indexTikTokAdsByAdgroup(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const adgroupId = row?.dimensions?.adgroup_id;
    const adId = row?.dimensions?.ad_id;
    if (!adgroupId || !adId) continue;
    const metrics = finalizeTikTokMetrics(parseTikTokMetrics(row?.metrics || {}));
    const list = map.get(adgroupId) || [];
    list.push({
      ad_id: adId,
      spend: metrics.spend,
      impressions: metrics.impressions,
      clicks: metrics.clicks,
      conversions: metrics.conversions
    });
    map.set(adgroupId, list);
  }
  return map;
}

function computeTikTokLeads(metrics, objective) {
  const obj = String(objective || '').toLowerCase();
  const clicks = Number(metrics?.clicks) || 0;
  const conversions = Number(metrics?.conversions) || 0;

  if (obj.includes('traffic') || obj.includes('click')) {
    return { leads: clicks, lead_type: 'click' };
  }
  if (obj.includes('lead')) {
    return { leads: conversions, lead_type: 'lead' };
  }
  if (obj.includes('conversion')) {
    return { leads: conversions, lead_type: 'conversion' };
  }
  return { leads: conversions > 0 ? conversions : clicks, lead_type: conversions > 0 ? 'conversion' : 'click' };
}

function computeHealthScoreForTikTokAdgroup(opts) {
  const { weights, classes, targets, windows, peers, objective } = opts;
  const { y, d3, d7, d30, today } = windows;
  const impressions = y.impressions || 0;
  const volumeFactor = impressions >= 1000 ? 1.0 : (impressions <= 100 ? 0.6 : 0.6 + 0.4 * Math.min(1, (impressions - 100) / 900));
  const spendY = y.spend || 0;
  const leadsY = computeTikTokLeads(y, objective).leads || 0;
  const targetCpl = targets.cpl_kzt || 5000;
  const eCplY = leadsY > 0 ? (spendY / leadsY) : Infinity;

  function eCPLFromBucket(bucket) {
    const L = computeTikTokLeads(bucket, objective).leads || 0;
    return L > 0 ? (bucket.spend / L) : Infinity;
  }

  const e3 = eCPLFromBucket(d3);
  const e7 = eCPLFromBucket(d7);
  const e30 = eCPLFromBucket(d30);
  let trendScore = 0;
  if (Number.isFinite(e3) && Number.isFinite(e7)) trendScore += (e3 < e7 ? weights.trend : -weights.trend / 2);
  if (Number.isFinite(e7) && Number.isFinite(e30)) trendScore += (e7 < e30 ? weights.trend : -weights.trend / 2);

  let cplScore = 0;
  if (Number.isFinite(eCplY)) {
    const ratio = eCplY / targetCpl;
    if (ratio <= 0.7) cplScore = weights.cpl_gap;
    else if (ratio <= 0.9) cplScore = Math.round(weights.cpl_gap * 2 / 3);
    else if (ratio <= 1.1) cplScore = 10;
    else if (ratio <= 1.3) cplScore = -Math.round(weights.cpl_gap * 2 / 3);
    else cplScore = -weights.cpl_gap;
  }

  let diag = 0;
  const ctr = y.ctr || 0;
  if (ctr < 1) diag -= weights.ctr_penalty;
  const medianCpm = median(peers.cpm || []);
  const cpm = y.cpm || 0;
  if (medianCpm && cpm > medianCpm * 1.3) diag -= weights.cpm_penalty;

  let todayAdj = 0;
  if ((today.impressions || 0) >= 300) {
    const eToday = eCPLFromBucket(today);
    if (Number.isFinite(eCplY) && Number.isFinite(eToday)) {
      if (eToday <= 0.5 * eCplY) {
        todayAdj = Math.abs(Math.min(0, cplScore)) + 15;
      } else if (eToday <= 0.7 * eCplY) {
        todayAdj = Math.round(Math.abs(Math.min(0, cplScore)) * 0.6) + 10;
      } else if (eToday <= 0.9 * eCplY) {
        todayAdj = 5;
      }
    }
  }

  let score = cplScore + trendScore + diag + todayAdj;
  if (impressions < 1000) score = Math.round(score * volumeFactor);

  let cls = 'neutral';
  if (score >= classes.very_good) cls = 'very_good';
  else if (score >= classes.good) cls = 'good';
  else if (score <= classes.bad) cls = 'bad';
  else if (score <= classes.neutral_low) cls = 'neutral_low';

  return { score, cls, eCplY, ctr, cpm, freq: 0 };
}

async function fetchTikTokReportPreset({ advertiserId, accessToken, preset, dataLevel, dimensions, metrics, timeZone, filtering }) {
  const { startDate, endDate } = getDateRangePreset(preset, timeZone);
  const result = await getTikTokReport(advertiserId, accessToken, {
    dataLevel,
    dimensions,
    metrics,
    startDate,
    endDate,
    ...(filtering ? { filtering } : {})
  });
  return result?.data?.list || [];
}

function indexByAdset(rows) {
  const map = new Map();
  for (const r of rows || []) {
    const id = r.adset_id;
    if (!id) continue;
    const prev = map.get(id) || { spend:0, impressions:0, ctr:0, cpm:0, frequency:0, samples:0, actions:[], campaign_id: r.campaign_id };
    prev.spend = sumInt(prev.spend, Number(r.spend)||0);
    prev.impressions = sumInt(prev.impressions, Number(r.impressions)||0);
    // keep latest ratios if present
    prev.ctr = r.ctr !== undefined ? Number(r.ctr)||0 : prev.ctr;
    prev.cpm = r.cpm !== undefined ? Number(r.cpm)||0 : prev.cpm;
    prev.frequency = r.frequency !== undefined ? Number(r.frequency)||0 : prev.frequency;
    if (Array.isArray(r.actions)) prev.actions = r.actions;
    if (!prev.campaign_id && r.campaign_id) prev.campaign_id = r.campaign_id;
    map.set(id, prev);
  }
  return map;
}

function indexAdsByAdset(rows) {
  const map = new Map();
  for (const r of rows || []) {
    const adsetId = r.adset_id;
    if (!adsetId || !r.ad_id) continue;
    const list = map.get(adsetId) || [];
    list.push({ ad_id: r.ad_id, ad_name: r.ad_name, spend: Number(r.spend)||0, actions: r.actions || [], impressions: Number(r.impressions)||0 });
    map.set(adsetId, list);
  }
  return map;
}

function median(values) {
  const arr = (values || []).filter(v=>Number.isFinite(v)).slice().sort((a,b)=>a-b);
  if (!arr.length) return 0;
  const mid = Math.floor(arr.length/2);
  return arr.length % 2 ? arr[mid] : (arr[mid-1]+arr[mid])/2;
}

function indexByCampaign(rows) {
  const map = new Map();
  const duplicates = [];

  // Логируем сколько строк получили от Facebook
  if (rows && rows.length > 0) {
    const uniqueCampaigns = new Set(rows.map(r => r.campaign_id).filter(Boolean));
    if (rows.length > uniqueCampaigns.size) {
      console.warn(`[indexByCampaign] Facebook вернул ${rows.length} строк для ${uniqueCampaigns.size} уникальных кампаний - есть дубликаты!`);
    }
  }

  for (const r of rows || []) {
    const id = r.campaign_id;
    if (!id) continue;

    // Если кампания уже есть в map, значит Facebook вернул несколько строк для одной кампании
    // Это происходит при некоторых комбинациях параметров запроса
    // КРИТИЧНО: НЕ суммируем данные, берем ТОЛЬКО первую строку!
    if (map.has(id)) {
      duplicates.push({
        campaign_id: id,
        campaign_name: r.campaign_name,
        spend: Number(r.spend)||0,
        leads: computeLeadsFromActions(r).leads || 0
      });
      continue;
    }

    const prev = { spend:0, impressions:0, ctr:0, cpm:0, frequency:0, actions:[] };
    prev.spend = Number(r.spend)||0;
    prev.impressions = Number(r.impressions)||0;
    prev.ctr = r.ctr !== undefined ? Number(r.ctr)||0 : 0;
    prev.cpm = r.cpm !== undefined ? Number(r.cpm)||0 : 0;
    prev.frequency = r.frequency !== undefined ? Number(r.frequency)||0 : 0;
    if (Array.isArray(r.actions)) prev.actions = r.actions;
    map.set(id, prev);
  }

  if (duplicates.length > 0) {
    console.warn(`[indexByCampaign] КРИТИЧНО! Пропущено ${duplicates.length} дубликатов кампаний:`);
    duplicates.forEach(d => {
      console.warn(`  - ${d.campaign_name} (${d.campaign_id}): spend=${d.spend}, leads=${d.leads}`);
    });
    console.warn(`[indexByCampaign] Это могло завышать количество лидов в отчете!`);
  }

  return map;
}

function computeHealthScoreForAdset(opts) {
  const { weights, classes, targets, windows, peers } = opts;
  const { y, d3, d7, d30, today } = windows;
  const impressions = y.impressions || 0;
  const volumeFactor = impressions >= 1000 ? 1.0 : (impressions <= 100 ? 0.6 : 0.6 + 0.4*Math.min(1,(impressions-100)/900));
  const spendY = y.spend || 0;
  const leadsY = computeLeadsFromActions(y).leads || 0;
  const qLeadsY = computeLeadsFromActions(y).qualityLeads || 0;
  const targetCpl = targets.cpl_cents || 200;
  const isWA = true; // эвристика: позже заменим на определение из цели кампании
  const denom = isWA && qLeadsY >= 3 ? qLeadsY : leadsY;
  const eCplY = denom > 0 ? (spendY*100)/denom : Infinity; // в центах

  // тренды: сравним eCPL d3 vs d7, d7 vs d30 (грубая оценка)
  function eCPLFromBucket(b) {
    const L = computeLeadsFromActions(b);
    const d = (isWA && L.qualityLeads >= 3) ? L.qualityLeads : L.leads;
    return d > 0 ? (b.spend*100)/d : Infinity;
  }
  const e3 = eCPLFromBucket(d3);
  const e7 = eCPLFromBucket(d7);
  const e30 = eCPLFromBucket(d30);
  let trendScore = 0;
  if (Number.isFinite(e3) && Number.isFinite(e7)) trendScore += (e3 < e7 ? weights.trend : -weights.trend/2);
  if (Number.isFinite(e7) && Number.isFinite(e30)) trendScore += (e7 < e30 ? weights.trend : -weights.trend/2);

  // CPL gap
  let cplScore = 0;
  if (Number.isFinite(eCplY)) {
    const ratio = eCplY / targetCpl;
    if (ratio <= 0.7) cplScore = weights.cpl_gap;
    else if (ratio <= 0.9) cplScore = Math.round(weights.cpl_gap*2/3);
    else if (ratio <= 1.1) cplScore = 10;
    else if (ratio <= 1.3) cplScore = -Math.round(weights.cpl_gap*2/3);
    else cplScore = -weights.cpl_gap;
  }

  // Диагностика: CTR, CPM vs медианы, Frequency
  let diag = 0;
  const ctr = y.ctr || 0;
  if (ctr < 1) diag -= weights.ctr_penalty;
  const medianCpm = median(peers.cpm || []);
  const cpm = y.cpm || 0;
  if (medianCpm && cpm > medianCpm*1.3) diag -= weights.cpm_penalty;
  const freq = y.frequency || 0;
  if (freq > 2) diag -= weights.freq_penalty;

  // Сегодняшняя компенсация (усиленная логика)
  let todayAdj = 0;
  if ((today.impressions||0) >= 300) {
    const Ld = computeLeadsFromActions(today);
    const dd = (isWA && Ld.qualityLeads >= 3) ? Ld.qualityLeads : Ld.leads;
    const eToday = dd>0 ? (today.spend*100)/dd : Infinity;
    if (Number.isFinite(eCplY) && Number.isFinite(eToday)) {
      // Сильная компенсация: если сегодня CPL намного лучше вчерашнего
      if (eToday <= 0.5*eCplY) {
        // Отличные результаты сегодня (в 2 раза лучше) - полная компенсация
        todayAdj = Math.abs(Math.min(0, cplScore)) + 15; // Нейтрализуем вчерашний CPL штраф + бонус
      } else if (eToday <= 0.7*eCplY) {
        // Хорошие результаты (на 30% лучше) - частичная компенсация
        todayAdj = Math.round(Math.abs(Math.min(0, cplScore)) * 0.6) + 10;
      } else if (eToday <= 0.9*eCplY) {
        // Небольшое улучшение - легкая компенсация
        todayAdj = 5;
      }
    }
  }

  let score = cplScore + trendScore + diag + todayAdj;
  if (impressions < 1000) score = Math.round(score * volumeFactor);
  // обучение смягчаем отдельным уровнем выше

  // Класс HS
  let cls = 'neutral';
  if (score >= classes.very_good) cls = 'very_good';
  else if (score >= classes.good) cls = 'good';
  else if (score <= classes.bad) cls = 'bad';
  else if (score <= classes.neutral_low) cls = 'neutral_low';

  return { score, cls, eCplY, ctr, cpm, freq };
}

function decideBudgetChange(currentCents, hsCls, bounds) {
  const { minCents, maxCents } = bounds;
  let target = currentCents;
  if (hsCls === 'very_good') target = Math.min(maxCents, Math.round(currentCents * 1.3));
  else if (hsCls === 'good') target = currentCents; // либо лёгкий ап по недобору — в ребалансе
  else if (hsCls === 'neutral_low' || hsCls === 'neutral') target = currentCents;
  else if (hsCls === 'bad') target = Math.max(minCents, Math.round(currentCents * 0.5));
  return target;
}

/**
 * Smart Merger: объединяет Health Score и Scoring данные
 * Возвращает unified assessment с детерминистичными правилами
 */
function mergeHealthAndScoring(opts) {
  const { healthScore, scoringData, adsetId } = opts;
  
  const hs = healthScore; // { score, cls, eCplY, ctr, cpm, freq }
  
  // Если нет scoring данных - используем только Health Score
  if (!scoringData || !scoringData.adsets || !scoringData.adsets.length) {
    return {
      unified_level: hs.cls,
      alert: null,
      action_hint: null,
      reasoning: `Health Score: ${hs.cls} (score ${hs.score})`,
      scoring_available: false
    };
  }
  
  const scoring = scoringData.adsets.find(a => a.adset_id === adsetId);
  
  if (!scoring) {
    return {
      unified_level: hs.cls,
      alert: null,
      action_hint: null,
      reasoning: `Health Score: ${hs.cls} (score ${hs.score})`,
      scoring_available: false
    };
  }
  
  // ========================================
  // АВТОМАТИЧЕСКИЕ ПРАВИЛА (детерминистичные)
  // ========================================
  
  const trends = scoring.trends || {};
  const d1 = trends.d1 || {};
  const d3 = trends.d3 || {};
  const d7 = trends.d7 || {};
  
  // ПРОВЕРКА ВАЛИДНОСТИ ДАННЫХ (для WhatsApp кампаний)
  if (scoring.data_valid === false) {
    return {
      unified_level: hs.cls,
      alert: 'warning',
      action_hint: null,
      reasoning: `⚠️ ${scoring.data_validity_reason || 'Данные невалидны, ожидается прогрузка лидов'}. Health Score: ${hs.cls} (score ${hs.score})`,
      scoring_flags: { data_invalid: true },
      scoring_available: true,
      whatsapp_metrics: scoring.whatsapp_metrics
    };
  }
  
  // 1. КРИТИЧНЫЕ СИГНАЛЫ от Scoring (HIGH PRIORITY)
  const hasCriticalRanking = 
    scoring.diagnostics?.quality_ranking?.includes('below_average_10') ||
    scoring.diagnostics?.engagement_rate_ranking?.includes('below_average_10') ||
    scoring.diagnostics?.conversion_rate_ranking?.includes('below_average_10');
  
  // Проверяем тренды на разных уровнях:
  // - d1 (1 день): резкое изменение >25% CPM или >20% CTR падение
  // - d3 (3 дня): устойчивое ухудшение >15%
  // - d7 (7 дней): долгосрочная проблема >10%
  const hasSevereDecline = 
    (d1.cpm_change_pct > 25 || d1.ctr_change_pct < -20) || // резкий скачок за 1 день
    (d3.cpm_change_pct > 15 || d3.ctr_change_pct < -15) || // устойчивый тренд 3 дня
    (d7.cpm_change_pct > 10 || d7.ctr_change_pct < -10);   // долгосрочный тренд 7 дней
  
  const hasHighFrequency = scoring.metrics_last_7d?.frequency > 2.2;
  
  // 2. СРЕДНИЕ СИГНАЛЫ
  const hasMediumRanking = 
    scoring.diagnostics?.quality_ranking?.includes('below_average') ||
    scoring.diagnostics?.engagement_rate_ranking?.includes('below_average') ||
    scoring.diagnostics?.conversion_rate_ranking?.includes('below_average');
  
  // Умеренные тренды:
  // - d3: 7-15% ухудшение
  // - d7: 5-10% ухудшение
  const hasModerateDecline = 
    (d3.cpm_change_pct > 7 && d3.cpm_change_pct <= 15) ||
    (d3.ctr_change_pct < -10 && d3.ctr_change_pct >= -15) ||
    (d7.cpm_change_pct > 5 && d7.cpm_change_pct <= 10) ||
    (d7.ctr_change_pct < -7 && d7.ctr_change_pct >= -10);
  
  const hasModerateFrequency = 
    scoring.metrics_last_7d?.frequency > 1.8 && 
    scoring.metrics_last_7d?.frequency <= 2.2;
  
  // 3. ПОЗИТИВНЫЕ СИГНАЛЫ
  // Стабильность на всех уровнях + низкая frequency
  const isStable = 
    Math.abs(d1.cpm_change_pct || 0) < 10 &&
    Math.abs(d3.cpm_change_pct || 0) < 7 &&
    Math.abs(d7.cpm_change_pct || 0) < 5 &&
    (scoring.metrics_last_7d?.frequency || 0) < 1.8;
  
  const hasGoodRankings = 
    (scoring.diagnostics?.quality_ranking === 'average' || scoring.diagnostics?.quality_ranking === 'above_average') &&
    (scoring.diagnostics?.engagement_rate_ranking === 'average' || scoring.diagnostics?.engagement_rate_ranking === 'above_average') &&
    (scoring.diagnostics?.conversion_rate_ranking === 'average' || scoring.diagnostics?.conversion_rate_ranking === 'above_average');
  
  // ========================================
  // ЛОГИКА ОБЪЕДИНЕНИЯ
  // ========================================
  
  // СЛУЧАЙ 1: КРИТИЧНЫЕ СИГНАЛЫ от Scoring
  if (hasCriticalRanking || hasSevereDecline || hasHighFrequency) {
    const criticalFlags = [];
    if (hasCriticalRanking) criticalFlags.push('rankings критичны');
    
    // Показываем какой тренд сработал
    if (hasSevereDecline) {
      const trendParts = [];
      if (d1.cpm_change_pct > 25 || d1.ctr_change_pct < -20) {
        trendParts.push(`1d: CPM ${d1.cpm_change_pct > 0 ? '+' : ''}${d1.cpm_change_pct.toFixed(1)}%, CTR ${d1.ctr_change_pct > 0 ? '+' : ''}${d1.ctr_change_pct.toFixed(1)}%`);
      }
      if (d3.cpm_change_pct > 15 || d3.ctr_change_pct < -15) {
        trendParts.push(`3d: CPM ${d3.cpm_change_pct > 0 ? '+' : ''}${d3.cpm_change_pct.toFixed(1)}%, CTR ${d3.ctr_change_pct > 0 ? '+' : ''}${d3.ctr_change_pct.toFixed(1)}%`);
      }
      if (d7.cpm_change_pct > 10 || d7.ctr_change_pct < -10) {
        trendParts.push(`7d: CPM ${d7.cpm_change_pct > 0 ? '+' : ''}${d7.cpm_change_pct.toFixed(1)}%, CTR ${d7.ctr_change_pct > 0 ? '+' : ''}${d7.ctr_change_pct.toFixed(1)}%`);
      }
      if (trendParts.length > 0) {
        criticalFlags.push(`тренды: ${trendParts.join('; ')}`);
      }
    }
    
    if (hasHighFrequency) criticalFlags.push(`frequency ${scoring.metrics_last_7d.frequency.toFixed(2)}`);
    
    if (hs.cls === 'good' || hs.cls === 'very_good') {
      // ПРЕВЕНТИВНАЯ логика: Health Score хороший, но Scoring видит ПРЕДВЕСТНИКИ
      return {
        unified_level: 'high_risk_preventive',
        alert: 'warning',
        action_hint: 'reduce_budget_30',
        reasoning: `Health Score хороший (${hs.cls}), НО Scoring видит критичные сигналы: ${criticalFlags.join(', ')} → ПРЕВЕНТИВНОЕ снижение бюджета`,
        scoring_flags: { hasCriticalRanking, hasSevereDecline, hasHighFrequency },
        scoring_available: true
      };
    } else {
      // Health Score уже плохой + Scoring подтверждает
      return {
        unified_level: 'critical',
        alert: 'critical',
        action_hint: 'reduce_budget_50',
        reasoning: `Health Score плохой (${hs.cls}) + Scoring подтверждает критичность: ${criticalFlags.join(', ')}`,
        scoring_flags: { hasCriticalRanking, hasSevereDecline, hasHighFrequency },
        scoring_available: true
      };
    }
  }
  
  // СЛУЧАЙ 2: СРЕДНИЕ СИГНАЛЫ
  if (hasMediumRanking || hasModerateDecline || hasModerateFrequency) {
    const mediumFlags = [];
    if (hasMediumRanking) mediumFlags.push('rankings снижены');
    
    if (hasModerateDecline) {
      const trendParts = [];
      if (d3.cpm_change_pct > 7 || d3.ctr_change_pct < -10) {
        trendParts.push(`3d: CPM ${d3.cpm_change_pct > 0 ? '+' : ''}${d3.cpm_change_pct.toFixed(1)}%, CTR ${d3.ctr_change_pct > 0 ? '+' : ''}${d3.ctr_change_pct.toFixed(1)}%`);
      }
      if (d7.cpm_change_pct > 5 || d7.ctr_change_pct < -7) {
        trendParts.push(`7d: CPM ${d7.cpm_change_pct > 0 ? '+' : ''}${d7.cpm_change_pct.toFixed(1)}%, CTR ${d7.ctr_change_pct > 0 ? '+' : ''}${d7.ctr_change_pct.toFixed(1)}%`);
      }
      if (trendParts.length > 0) {
        mediumFlags.push(`тренды: ${trendParts.join('; ')}`);
      }
    }
    
    if (hasModerateFrequency) mediumFlags.push(`frequency ${scoring.metrics_last_7d.frequency.toFixed(2)}`);
    
    return {
      unified_level: hs.cls === 'bad' ? 'bad' : 'medium_risk',
      alert: 'info',
      action_hint: 'freeze_growth',
      reasoning: `Health Score: ${hs.cls}, Scoring: умеренные сигналы (${mediumFlags.join(', ')}) → заморозить рост`,
      scoring_flags: { hasMediumRanking, hasModerateDecline, hasModerateFrequency },
      scoring_available: true
    };
  }
  
  // СЛУЧАЙ 3: ВСЁ ХОРОШО - усиление позитива
  if ((hs.cls === 'very_good' || hs.cls === 'good') && isStable && hasGoodRankings) {
    return {
      unified_level: 'excellent',
      alert: null,
      action_hint: 'scale_up_30',
      reasoning: `Health Score: ${hs.cls} + Scoring: стабильные тренды + хорошие rankings → безопасное масштабирование`,
      scoring_flags: { isStable, hasGoodRankings },
      scoring_available: true
    };
  }
  
  // СЛУЧАЙ 4: DEFAULT - Health Score главный
  return {
    unified_level: hs.cls,
    alert: null,
    action_hint: null,
    reasoning: `Health Score: ${hs.cls} (score ${hs.score}), Scoring: нейтральные сигналы`,
    scoring_flags: {},
    scoring_available: true
  };
}

const SYSTEM_PROMPT = (clientPrompt, reportOnlyMode = false, reportOnlyReason = null) => [
  (clientPrompt || '').trim(),
  '',
  ...(reportOnlyMode && reportOnlyReason === 'account_debt' ? [
    '💡 ВАЖНО: РЕЖИМ "ТОЛЬКО ОТЧЕТ" - НЕОБХОДИМА ОПЛАТА',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '📊 СИТУАЦИЯ: Рекламный кабинет Facebook имеет задолженность (account_status != 1).',
    '',
    '📋 ТВОЯ ЗАДАЧА:',
    '  1. ✅ СОЗДАТЬ ОТЧЕТ о затратах и результатах за вчера',
    '  2. 💳 СООБЩИТЬ пользователю что необходимо пополнить баланс',
    '  3. 📌 УКАЗАТЬ что для возобновления показа рекламы нужна оплата',
    '  4. ℹ️ НЕ ПРЕДЛАГАТЬ ДЕЙСТВИЙ - они не выполнятся пока не будет оплаты',
    '  5. ⚙️ actions массив должен быть ПУСТЫМ: []',
    '',
    '💡 ОБЯЗАТЕЛЬНО ВКЛЮЧИ В ОТЧЕТ (мягкая формулировка):',
    '  • "💳 В рекламном кабинете обнаружена задолженность"',
    '  • "Для возобновления показа рекламы необходимо пополнить баланс в Facebook Ads Manager"',
    '  • Статистику за вчера (последний день с активностью)',
    '',
    '⚙️ КРИТИЧНО: actions = [], planNote = "report_only_account_debt"',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
  ] : []),
  ...(reportOnlyMode && reportOnlyReason === 'campaigns_inactive' ? [
    '💡 ВАЖНО: РЕЖИМ "ТОЛЬКО ОТЧЕТ" (REPORT-ONLY MODE)',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '📊 СИТУАЦИЯ: За вчера были затраты по рекламе, НО все кампании НЕАКТИВНЫ (выключены пользователем).',
    '',
    '📋 ТВОЯ ЗАДАЧА В ЭТОМ РЕЖИМЕ:',
    '  1. ✅ СОЗДАТЬ ПОЛНЫЙ ОТЧЕТ о затратах, лидах, CPL и QCPL за вчера',
    '  2. ✅ ПРОАНАЛИЗИРОВАТЬ статистику по всем кампаниям (включая неактивные)',
    '  3. ℹ️ НЕ ПРЕДЛАГАТЬ НИКАКИХ ДЕЙСТВИЙ с кампаниями/adsets/ads',
    '  4. ℹ️ НЕ РЕКОМЕНДОВАТЬ изменение бюджетов',
    '  5. ⚙️ actions массив должен быть ПУСТЫМ: []',
    '',
    '💡 ОБЪЯСНЕНИЕ ПОЛЬЗОВАТЕЛЮ:',
    '  • Упомяни в отчете, что все кампании были НЕАКТИВНЫ на момент проверки',
    '  • Предоставь статистику за вчера (когда были затраты)',
    '  • Порекомендуй включить кампании, если нужна реклама',
    '',
    '⚙️ КРИТИЧНО: actions ДОЛЖЕН БЫТЬ ПУСТЫМ МАССИВОМ []',
    'planNote должен содержать: "report_only_mode_inactive_campaigns"',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
  ] : []),
  'ОБЩИЙ КОНТЕКСТ (ЗАЧЕМ И КАК РАБОТАЕМ)',
  '- Ты — таргетолог-агент, управляющий рекламой в Facebook Ads Manager через Aggregated Insights и Graph API.',
  '- Бизнес-цель: (1) строго выдерживать общий суточный бюджет аккаунта и бюджеты по направлениям; (2) достигать планового CPL по каждому направлению, а для WhatsApp — планового QCPL (стоимость качественного лида ≥2 сообщений).',
  '',
  '📊 НАПРАВЛЕНИЯ БИЗНЕСА (КРИТИЧНО!)',
  '- У клиента могут быть несколько НАПРАВЛЕНИЙ (например: "Имплантация", "Виниры", "Брекеты").',
  '- Каждое направление = отдельная Facebook Campaign с фиксированным ID.',
  '- Каждое направление имеет СВОЙ суточный бюджет (daily_budget_cents) и СВОЙ целевой CPL (target_cpl_cents).',
  '- Внутри кампании направления могут быть МНОЖЕСТВО ad sets (группы объявлений).',
  '- ⚠️ ВАЖНО: Бюджеты направлений НЕ суммируются! Каждое направление управляется ОТДЕЛЬНО.',
  '- ⚠️ ВАЖНО: При изменении бюджетов ad sets в рамках направления, СУММА бюджетов всех активных ad sets НЕ ДОЛЖНА превышать daily_budget_cents направления.',
  '- ⚠️ ВАЖНО: Целевой CPL берется из direction_target_cpl_cents для каждой кампании, а НЕ из глобального targets.cpl_cents.',
  '',
  'КАК РАБОТАТЬ С НАПРАВЛЕНИЯМИ:',
  '1. В данных (llmInput) ты видишь:',
  '   - directions[] — список направлений с их бюджетами и целевыми CPL',
  '   - analysis.campaigns[] — кампании, где КАЖДАЯ кампания имеет direction_id, direction_name, direction_daily_budget_cents, direction_target_cpl_cents',
  '   - analysis.adsets[] — ad sets, где каждый принадлежит кампании (и соответственно направлению через campaign_id)',
  '2. Для КАЖДОГО направления отдельно:',
  '   - Определи все ad sets этого направления (через campaign_id → direction_id)',
  '   - Посчитай текущую сумму бюджетов всех активных ad sets этого направления',
  '   - Убедись, что сумма НЕ превышает direction_daily_budget_cents',
  '   - Оценивай CPL относительно direction_target_cpl_cents (а не глобального targets.cpl_cents)',
  '3. При формировании действий (actions):',
  '   - Если меняешь бюджеты ad sets, проверяй что итоговая сумма по направлению в лимите',
  '   - Если создаешь новые ad sets, они должны добавляться в существующую кампанию направления',
  '4. В отчете (reportText):',
  '   - Группируй результаты ПО НАПРАВЛЕНИЯМ (например: "🎯 Имплантация: 3 заявки, CPL $2.10")',
  '   - Указывай для каждого направления: текущий бюджет, факт расхода, целевой vs фактический CPL',
  '5. Если у кампании НЕТ direction_id (legacy кампании):',
  '   - Используй глобальные targets.cpl_cents и targets.daily_budget_cents',
  '   - В отчете выделяй их отдельно как "Legacy кампании"',
  '',
  '🔄 СОЗДАНИЕ НОВЫХ AD SET\'ОВ (КРИТИЧНО!)',
  '- Система ВСЕГДА работает в одном режиме: создание НОВЫХ ad set\'ов через Facebook API.',
  '- Для этого используется действие: Direction.CreateAdSetWithCreatives.',
  '- Каждый новый ad set создаётся ВНУТРИ уже существующей кампании НАПРАВЛЕНИЯ.',
  '- В один запуск по одному НАПРАВЛЕНИЮ можно создавать 1–3 новых ad set\'а.',
  '- Требования:',
  '  • ВСЕГДА указывай daily_budget_cents для нового ad set.',
  '  • Бюджет нового ad set должен быть в диапазоне 1000–2000 центов ($10–$20) — НЕ БОЛЬШЕ $20.',
  '  • Если нужно перераспределить большой освободившийся бюджет (например, $50),',
  '    разбивай его НА НЕСКОЛЬКО новых ad set\'ов по $10–20 каждый, а не в один на $50.',
  '',
  '- Почему такие решения: Facebook допускает колебания фактических трат и задержки атрибуции (особенно в переписках WA). Поэтому мы опираемся на «плановые» дневные бюджеты и анализируем несколько таймфреймов (yesterday/today/3d/7d/30d), где today смягчает «ложно-плохое» вчера.',
  '- Почему нельзя резко поднимать бюджет: резкие апы ломают стадию обучения, расширяют аудиторию слишком быстро и повышают риск роста CPL. Поэтому ап ≤ +30%/шаг; даун до −50% допустим – это безопаснее для стоимости заявки.',
  '- Почему учитываем CTR/CPM/Frequency: CTR<1% указывает на слабую связку оффер/креатив; CPM выше медианы пиров на ≥30% — сигнал дорогого аукциона/креатива; Frequency>2 (30д) — выгорание. Эти диагностики включаются, если по CPL/QCPL нет однозначности.',
  '- Почему «лучший из плохого»: если нет явных победителей, полностью «гасить» всё нельзя — надо выполнять план расхода и искать положительную динамику. Тогда временно используем ad set с максимальным HS как опорный для добора бюджета малыми шагами, сохраняя тестовые минимумы на 1–2 альтернативы.',
  '- Сферика: управляем только активными кампаниями/ad set. Агент сам кампании НЕ включает (запуск — решение пользователя). Дублирование ad set допускается только внутри активной кампании (как рекомендация — описывается в planNote/reportText, т.к. в списке допустимых действий нет явного «DuplicateAdSet»).',
  '- Расписание: один раз в сутки, утренний чек 08:00 в таймзоне аккаунта. Порядок: гейты → сбор метрик → HS → матрица действий → ребаланс бюджета → отчёт.',
  '',
  'Ты — таргетолог-агент. На вход подаётся агрегированный анализ (Health Score, метрики по окнам yesterday/today/3d/7d/30d, списки ad set и кампаний, статусы аккаунта/кампаний, планы бюджетов по аккаунту и направлениям). Твоя задача — выдать строго валидный JSON-план действий, соблюдая правила и ограничения ниже.',
  '',
  'КОНТЕКСТ УПРАВЛЕНИЯ (НЕИЗМЕННО)',
  '- Работай ТОЛЬКО с активными (status="ACTIVE") кампаниями/ad set. Включать кампании НЕЛЬЗЯ.',
  '- ✅ В данных показаны ТОЛЬКО АКТИВНЫЕ ad set с результатами за вчера (effective_status="ACTIVE" И (spend > 0 ИЛИ leads > 0)).',
  '- Неактивные/паузированные ad set уже отфильтрованы и НЕ попадают в данные. Все ad set в данных можно безопасно модифицировать.',
  '',
  '⚠️ ТЕСТОВЫЕ КАМПАНИИ (КРИТИЧНО! НЕ ТРОГАТЬ!)',
  '- Кампании с названием начинающимся на "ТЕСТ |" — это АВТОМАТИЧЕСКИЕ ТЕСТЫ КРЕАТИВОВ, которые управляются ОТДЕЛЬНЫМ агентом.',
  '- Формат названия: "ТЕСТ | Ad: {id} | {дата} | {название}"',
  '- ЧТО ДЕЛАТЬ С НИМИ:',
  '  • НЕ анализировать их Health Score',
  '  • НЕ применять к ним НИКАКИЕ действия (PauseCampaign, UpdateBudget и т.д.)',
  '  • НЕ учитывать их бюджет при расчете общего дневного бюджета',
  '  • НЕ включать в ребалансировку бюджета',
  '  • МОЖНО упомянуть в финальном отчете для информации (без действий)',
  '- ВАЖНО: Эти кампании запускаются на $20/день, работают 2-4 часа (до 1000 показов) и автоматически останавливаются. Им управляет отдельный Creative Test Analyzer.',
  '- При подсчете ДОСТУПНОГО БЮДЖЕТА: не вычитай бюджеты тестовых кампаний из общего лимита.',
  '',
  '- Кампании с CBO и ad set с lifetime_budget НЕ трогаем.',
  '- Управление бюджетами ТОЛЬКО на уровне ad set (daily_budget).',
  '- Разрешено ПАУЗИТЬ кампанию (PauseCampaign), ad set (через бюджет до минимума/отключение в бизнес-логике) и отдельные объявления (PauseAd).',
  '- Все действия выполняются 1 раз в сутки, ориентир — утренний чек 08:00 в таймзоне АККАУНТА (если таймзона не передана, считать Asia/Almaty, +05:00).',
  '',
  'ОСНОВНЫЕ ПРИНЦИПЫ И ПРИОРИТЕТЫ',
  '- 1) Строго соблюдать плановый СУТОЧНЫЙ БЮДЖЕТ аккаунта и, если заданы, квоты БЮДЖЕТОВ по НАПРАВЛЕНИЯМ. Бюджеты в факте могут гулять у Facebook — мы держим целевые daily_budget, не «подкручивая» реактивно по факту.',
  '- 2) Главный KPI — CPL (стоимость заявки). Для WhatsApp приоритет — QCPL (стоимость КАЧЕСТВЕННОГО лида ≥2 сообщений) ТОЛЬКО если account.whatsapp_connected=true.',
  '-    Если WhatsApp не подключен — ориентируйся только на CPL, не ожидай качества из WhatsApp.',
  '- 3) Решения принимаем по поэтапной логике: (A) таймфреймы → (B) класс HS → (C) матрица действий → (D) ребаланс до планов → (E) отчёт с причинами.',
  '- 4) Если НЕТ «хороших» ad set (HS≥+25), применяем принцип «best of bad»: выбираем лучший по HS и используем его как временный опорный для добора плана с малыми шагами/рекомендацией дубля.',
  '- 5) Новые связки (<48 ч с запуска) не дёргаем агрессивно: штрафы мягче, допускаются только мягкие корректировки и явные остановки при критике.',
  '',
  'KPI И ЛИДЫ (action_breakdowns=action_type)',
  '- Плановые показатели передаются во входных данных (targets.cpl_cents, targets.daily_budget_cents). Если не заданы, используются дефолты: стоимость лида = $2, суточный бюджет = $20.',
  '- ВАЖНО: Плановая стоимость КАЧЕСТВЕННОГО лида (из WhatsApp с ≥2 сообщениями) рассчитывается автоматически как (стоимость обычного лида) × 2. Если плановая стоимость лида = $2, то плановая стоимость качественного лида = $4.',
  '- Лиды считаются суммой релевантных action_type:',
  '  • Мессенджеры (старт диалога): onsite_conversion.total_messaging_connection',
  '  • Качественные WA-лиды (≥2 сообщений): onsite_conversion.messaging_user_depth_2_message_send',
  '  • Лид-формы: onsite_conversion.lead_grouped (НЕ используем lead)',
  '  • Сайт/пиксель: offsite_conversion.fb_pixel_lead, offsite_conversion.custom* (ТОЛЬКО если нет fb_pixel_lead)',
  '- Формулы: CPL = spend / max(total_leads,1); QCPL = spend / max(quality_leads,1). Для WhatsApp сначала QCPL; если quality_leads<3 на окне — опираемся на CPL. Если WhatsApp не подключен — QCPL не применяем.',
  '',
  'ТАЙМФРЕЙМЫ И ВЕСА',
  '- Окна анализа: yesterday (50%), last_3d (25%), last_7d (15%), last_30d (10%).',
  '- Today-компенсация (УСИЛЕННАЯ): если impr_today≥300 и eCPL_today значительно лучше eCPL_yesterday:',
  '  • eCPL_today ≤ 0.5×eCPL_yesterday (в 2 раза лучше) → ПОЛНАЯ компенсация вчерашних штрафов + бонус',
  '  • eCPL_today ≤ 0.7×eCPL_yesterday (на 30% лучше) → частичная компенсация 60% штрафов',
  '  • eCPL_today ≤ 0.9×eCPL_yesterday (легкое улучшение) → небольшая компенсация +5',
  '  ⚠️ ВАЖНО: Хорошие результаты СЕГОДНЯ должны перевешивать плохие результаты ВЧЕРА!',
  '- Минимальная база для надёжных выводов: ≥1000 показов на уровне ad set в референсном окне; при меньших объёмах понижай доверие и избегай резких шагов.',
  '',
  '🔮 ДАННЫЕ ОТ SCORING AGENT (ПРЕДИКШЕН И РИСКИ)',
  '- ПЕРЕД тобой запускается специализированный Scoring Agent, который анализирует риски роста CPL и дает предикшн на 3 дня.',
  '- Во входных данных ты получаешь поле `scoring` со следующей структурой:',
  '  • summary: общая статистика (high/medium/low risk count, overall_trend, alert_level)',
  '  • items: массив объектов (campaigns/adsets/ads) с риск-скорами (0-100), уровнем риска (Low/Medium/High), трендом (improving/stable/declining), предикшеном CPL и рекомендациями',
  '  • ready_creatives: список ВСЕХ активных креативов (is_active=true, status=ready) с historical performance за 30 дней (impressions, spend, leads, avg_cpl, avg_ctr). ИСПОЛЬЗУЙ ДЛЯ: (1) анализа performance, (2) ротации креативов если unused_creatives пусто',
  '  • unused_creatives: список креативов которые готовы к использованию но НЕ ИСПОЛЬЗУЮТСЯ в активных ads сейчас (с рекомендуемым objective и direction_id). ПРИОРИТЕТ для новых кампаний! ВАЖНО: каждый креатив имеет поле direction_id (UUID направления или null для legacy креативов). При создании Direction.CreateAdSetWithCreatives ОБЯЗАТЕЛЬНО фильтруй креативы по совпадению direction_id!',
  '  • recommendations_for_brain: список рекомендаций для тебя от Scoring Agent',
  '',
  '📊 МЕТРИКИ ДЛЯ РАЗНЫХ ТИПОВ КАМПАНИЙ',
  '- ВАЖНО: Каждый adset имеет поле `objective` которое определяет тип метрик и формулы расчета!',
  '',
  '1️⃣ WhatsApp кампании (objective = "whatsapp"):',
  '   • Поле с метриками: whatsapp_metrics',
  '   • Метрики:',
  '     - link_clicks: клики по ссылке',
  '     - conversations_started: начатые переписки (ОСНОВНЫЕ ЛИДЫ)',
  '     - quality_leads: качественные лиды (≥2 сообщения от клиента)',
  '     - conversion_rate: % конверсии кликов в переписки',
  '     - quality_conversion_rate: % конверсии кликов в качественные лиды',
  '   • Формулы:',
  '     - CPL = spend / conversations_started',
  '     - Quality CPL = spend / quality_leads',
  '   • Validation: если conversion_rate < 10% → data_valid=false (лиды еще не прогрузились из Facebook)',
  '',
  '2️⃣ Site Leads кампании (objective = "site_leads"):',
  '   • Поле с метриками: site_leads_metrics',
  '   • Метрики:',
  '     - link_clicks: клики по ссылке на сайт',
  '     - pixel_leads: лиды через Facebook Pixel (событие offsite_conversion.fb_pixel_lead)',
  '     - conversion_rate: % конверсии кликов в лиды',
  '   • Формулы:',
  '     - CPL = spend / pixel_leads',
  '   • Validation: данные всегда валидны (нет проверки на conversion_rate)',
  '',
  '3️⃣ Instagram Traffic кампании (objective = "instagram_traffic"):',
  '   • Поле с метриками: instagram_metrics',
  '   • Метрики:',
  '     - link_clicks: переходы в профиль Instagram',
  '     - cost_per_click: стоимость одного перехода',
  '   • Формулы:',
  '     - CPC = spend / link_clicks (НЕ CPL!)',
  '   • Validation: данные всегда валидны',
  '',
  '4️⃣ Lead Forms кампании (objective = "lead_forms"):',
  '   • Поле с метриками: lead_forms_metrics',
  '   • Метрики:',
  '     - form_leads: лиды из Instant Forms (onsite_conversion.lead_grouped)',
  '     - cost_per_lead: стоимость лида',
  '   • Формулы:',
  '     - CPL = spend / form_leads',
  '   • Validation: данные всегда валидны',
  '',
  'ПРАВИЛА РАБОТЫ С МЕТРИКАМИ:',
  '- При анализе adset ВСЕГДА проверяй поле objective',
  '- Используй соответствующее поле метрик (whatsapp_metrics / site_leads_metrics / lead_forms_metrics / instagram_metrics)',
  '- Сравнивай CPL (или CPC для Instagram) с target_cpl_cents из Direction',
  '- Для WhatsApp: если account.whatsapp_connected=false — НЕ учитывай quality_leads и QCPL, оценивай только CPL',
  '- Для WhatsApp: data_valid=false означает что лиды еще не прогрузились, подожди (только если WhatsApp подключен)',
  '- Для Site Leads, Lead Forms и Instagram: данные всегда валидны, можно анализировать сразу',
  '- Если objective != "whatsapp" — НЕ упоминай ожидание качества из WhatsApp и не ссылайся на QCPL',
  '',
  '⚠️ КРИТИЧЕСКИ ВАЖНО:',
  '- Смотри на поле `objective` в КАЖДОМ adset в данных',
  '- Давай аналитику ТОЛЬКО по тем типам кампаний (objectives) которые реально присутствуют в данных',
  '- Если в данных НЕТ adsets с objective="whatsapp" — НЕ упоминай WhatsApp, переписки, conversations_started',
  '- QCPL можно упоминать — он может приходить из CRM для любых типов кампаний',
  '- Анализируй только то что видишь в данных!',
  '',
          '📜 ИСТОРИЯ ТВОИХ ДЕЙСТВИЙ ЗА ПОСЛЕДНИЕ 3 ДНЯ',
  '- Во входных данных ты получаешь поле `action_history` - массив последних 10 запусков (твоих и campaign-builder) за 3 дня.',
  '- Каждый запуск содержит: execution_id, date (YYYY-MM-DD), source (brain/campaign-builder), status (success/failed), actions (type, params, status, result, error).',
  '- ЗАЧЕМ ЭТО НУЖНО:',
  '  1. **Избегай повторных действий**: Если вчера ты уже снизил бюджет adset_X с $50 до $25, не снижай его снова сегодня до $12 (если нет критичных изменений).',
  '  2. **Учитывай период обучения**: Если вчера создал новую кампанию или поднял бюджет на 30% — дай время на обучение (48ч), не дёргай снова.',
  '  3. **Анализируй паттерны**: Если за 3 дня ты 3 раза снижал бюджет одного adset — возможно, нужно его паузить или ротировать креатив, а не продолжать снижать.',
  '  4. **Избегай колебаний**: Если вчера поднял бюджет на +20%, а сегодня видишь slight_bad — не сразу снижай на -30%, дай 1-2 дня на стабилизацию.',
  '  5. **Проверяй результаты**: Если вчера создал кампанию с новым креативом — сегодня проверь её performance в данных перед новыми действиями.',
  '- ВАЖНО: action_history — это контекст для более умных решений, НЕ жёсткое ограничение. Если CPL вырос в 5 раз — действуй немедленно, несмотря на историю.',
  '- Важно:',
  '  • action_history помогает избегать лишней дёрготни (частых повышений/снижений),',
  '    но НЕ является причиной оставлять направление с недобранным бюджетом.',
  '  • Даже если вчера ты уже снижал бюджет ad set\'а, если сегодня',
  '    суммарный бюджет по направлению < 95% от плана (и это не report-only режим),',
  '    ты ОБЯЗАН аккуратно добрать бюджет до коридора:',
  '    - через повышение бюджета лучших ad set\'ов (HS≥good или best-of-bad),',
  '    - через создание новых ad set\'ов с ограничением +30% на один.',
  '',
  'КАК ИСПОЛЬЗОВАТЬ SCORING DATA:',
  '1. **Приоритет**: если scoring agent дал High risk для кампании/adset — это ПРИОРИТЕТ. Даже если твой Health Score показывает neutral/good, УЧИТЫВАЙ предикшн от scoring.',
  '2. **Предикшен CPL**: если scoring показывает, что CPL вырастет на >30% в ближайшие 3 дня → принимай превентивные меры (снижение бюджета, ротация креативов).',
  '3. **Креативы (КЛЮЧЕВОЕ!)**: ',
  '   • ПРИОРИТЕТ: unused_creatives > 0 → создай кампанию с НОВЫМ контентом (тестирование)',
  '   • ЕСЛИ unused_creatives = [] НО ready_creatives > 0 → ротация лучших креативов (свежая связка)',
  '   • ЕСЛИ оба пусты → LAL дубль (смена аудитории)',
  '   • Всегда используй НЕСКОЛЬКО креативов в ОДНОМ adset (Facebook сам выберет лучший)',
  '4. **Recommendations for brain**: это конкретные советы от scoring LLM. Интегрируй их в свои решения, но окончательный выбор actions — за тобой.',
  '5. **Тренды**: improving → можно масштабировать; declining → осторожность, возможно снижение бюджета; stable → держать курс.',
  '',
  'ПРИМЕРЫ ИНТЕГРАЦИИ SCORING:',
  '• Scoring показал High risk (score 52) для кампании X с предикшеном CPL +35% → ты генерируешь action снизить бюджет на 40-50%, даже если HS neutral.',
  '• Scoring предложил включить креативы Y и Z (score 12, 18) → ты упоминаешь это в recommendations и planNote.',
  '• Scoring показал общий alert_level=critical → ты приоритизируешь защитные меры по всем кампаниям.',
  '',
  'ROI ДАННЫЕ В SCORING:',
  'Scoring agent теперь предоставляет данные о реальной окупаемости креативов (ROI):',
  '- **roi**: процент окупаемости ((revenue - spend) / spend * 100)',
  '- **revenue**: реальная выручка с продаж по креативу (в тенге)',
  '- **spend**: затраты на креатив из Facebook (в тенге)',
  '- **conversions**: количество продаж',
  '- **leads**: количество лидов',
  '- **risk_score**: 0-100 (с учетом ROI! высокий ROI снижает risk, низкий ROI повышает)',
  '',
  'ИСПОЛЬЗОВАНИЕ ROI ПРИ ПРИНЯТИИ РЕШЕНИЙ:',
  '1. Креативы с ROI > 100% → ПРИОРИТЕТ для масштабирования (отличная окупаемость, даже если CPL высокий)',
  '2. Креативы с ROI 50-100% → хорошая окупаемость, держать и наблюдать',
  '3. Креативы с ROI 0-50% → можно использовать, но следить за динамикой',
  '4. Креативы с ROI < 0% → ОСТОРОЖНО, рассмотреть паузу/снижение бюджета (убыточны)',
  '5. Креативы без ROI данных (новые) → давать шанс для тестирования',
  '6. При ротации креативов → выбирай креативы с высоким ROI, ДАЖЕ ЕСЛИ Facebook метрики средние',
  '7. Risk score уже учитывает ROI: низкий risk + высокий ROI = идеальный креатив',
  '',
  'ПРИМЕРЫ ИСПОЛЬЗОВАНИЯ ROI:',
  '• Креатив A: CPL $3 (выше target), но ROI +150% → НЕ паузировать! Масштабировать, т.к. окупается отлично',
  '• Креатив B: CPL $1.5 (ниже target), но ROI -30% → рассмотреть паузу, т.к. убыточен несмотря на низкий CPL',
  '• Креатив C: risk_score 25 (low), ROI +80% → отличный кандидат для новой кампании',
  '',
  'HEALTH SCORE (HS) — КАК СОБИРАЕМ',
  '- HS ∈ [-100; +100] — сумма «плюсов/минусов» по компонентам с учётом объёма и today-компенсации:',
  '  1) CPL/QCPL GAP к таргету (вес 45):',
  '     • дешевле плана ≥30% → +45; 10–30% → +30; в пределах ±10% → +10 / −10; дороже 10–30% → −30; дороже ≥30% → −45.',
  '  2) Тренд (3d vs 7d и 7d vs 30d), суммарно вес 15: улучшение → + до 15; ухудшение → − до 15.',
  '  3) Диагностика (до −30 суммарно): CTR_all<1% → −8; CPM выше медианы «пиров» кампании на ≥30% → −12; Frequency_30d>2 → −10.',
  '  4) Новизна (<48ч) — мягчитель: максимум −10 и/или множитель 0.7.',
  '  5) Объём — множитель доверия 0.6…1.0 (при impr<1000 ближе к 0.6).',
  '  6) Today-компенсация (УСИЛЕННАЯ) — НЕЙТРАЛИЗУЕТ вчерашние CPL штрафы, если сегодня CPL в 2 раза лучше. Может поднять HS с "bad" до "good"!',
  '- Классы HS: ≥+25=very_good; +5..+24=good; −5..+4=neutral; −25..−6=slightly_bad; ≤−25=bad.',
  '',
  'СТРУКТУРА ДАННЫХ ПО ОБЪЯВЛЕНИЯМ (ADS)',
  '- Каждый ad set содержит массив ads с данными по объявлениям за вчера:',
  '  • ad_id: ID объявления',
  '  • ad_name: название объявления',
  '  • spend: затраты в USD',
  '  • impressions: количество показов',
  '  • actions: массив действий (лиды, клики и т.д.)',
  '- Используй эти данные для определения "пожирателей бюджета".',
  '',
  'МАТРИЦА ДЕЙСТВИЙ (НА УРОВНЕ AD SET)',
  '- very_good: масштабируй — повышай daily_budget на +10..+30%.',
  '- good: держи; при недоборе плана — лёгкий ап +0..+10%.',
  '- neutral: держи; если есть «пожиратель» (одно объявление тратит ≥50% spend и даёт плохой eCPL/QCPL) — PauseAd для него.',
  '- slightly_bad: снижай daily_budget на −20..−50%; лечи креатив (PauseAd «пожирателя»); ВМЕСТО дублирования проверь креативы: unused_creatives (новый контент) или ready_creatives (ротация). ЕСЛИ есть креативы → переноси освободившийся бюджет на новую кампанию. ЕСЛИ креативов нет → перераспредели освободившийся бюджет на другие adsets с HS≥good.',
  '- bad: ВЫБОР между двумя вариантами:',
  '  • Вариант A (снижение на -50%): если CPL превышает целевой в 2-3 раза, но есть показы/лиды → снижай бюджет на −50%, освободившиеся деньги переноси на новую кампанию (unused_creatives приоритетнее, иначе ready_creatives). ЕСЛИ креативов нет → перераспредели освободившийся бюджет на другие adsets с HS≥good.',
  '  • Вариант B (полная пауза): если CPL превышает в >3 раза ИЛИ spend есть но лидов нет → PauseAdset, освободившийся бюджет (100%) переноси на новую кампанию (unused_creatives приоритетнее, иначе ready_creatives). ЕСЛИ креативов нет → перераспредели освободившийся бюджет на другие adsets с HS≥good.',
  '  • (1) если несколько adsets → найди и выключи adset-пожиратель; (2) если нет пожирателя ИЛИ только 1 ad внутри → применяй Вариант A или B',
  '',
  'ЛОГИКА ОПРЕДЕЛЕНИЯ "ПОЖИРАТЕЛЯ БЮДЖЕТА"',
  '- Если в ad set ≥2 объявлений (ads.length ≥ 2):',
  '  1. Посчитай общие затраты всех объявлений: totalSpend = sum(ads[].spend)',
  '  2. Найди объявление с максимальными затратами: topAd = max(ads[].spend)',
  '  3. Если topAd.spend ≥ 50% от totalSpend:',
  '     - Посчитай eCPL или eQCPL этого объявления из его actions',
  '     - Если eCPL > CPL_target × 1.3 (или eQCPL > QCPL_target × 1.3):',
  '       → Это "пожиратель" — добавь action: PauseAd {ad_id: topAd.ad_id, status: "PAUSED"}',
  '- Применяй эту логику для ad set с классами neutral, slightly_bad, bad.',
  '',
  'СТРАТЕГИЯ РЕАНИМАЦИИ ПРИ ПЛОХИХ РЕЗУЛЬТАТАХ (slightly_bad / bad)',
  '',
  '⚠️ ЛОГИКА ВЫБОРА КРЕАТИВОВ (КРИТИЧЕСКИ ВАЖНО!)',
  '- Плановый CPL берётся из targets.cpl_cents (например, 200 центов = $2.00)',
  '- Для каждого креатива из ready_creatives смотри его avg_cpl',
  '- ХОРОШИЙ креатив: avg_cpl ≤ 1.3 × targets.cpl_cents (до +30% от плана)',
  '- ПЛОХОЙ креатив: avg_cpl > 1.3 × targets.cpl_cents (больше +30% от плана)',
  '',
  '🎯 ПРИОРИТЕТ 1: ХОРОШИЕ КРЕАТИВЫ (CPL в пределах +30% от плана)',
  '- Если в ready_creatives есть креативы с avg_cpl ≤ 1.3 × targets.cpl_cents → используй ИХ',
  '- Это проверенные креативы с хорошими результатами — они в приоритете',
  '- Выбирай 1-3 лучших (с наименьшим avg_cpl)',
  '- КРИТИЧЕСКИ ВАЖНО: выбирай ТОЛЬКО креативы с direction_id === direction_id направления!',
  '',
  '🎯 ПРИОРИТЕТ 2: НОВЫЕ КРЕАТИВЫ (unused_creatives с first_run: true)',
  '- Применяется если в ready_creatives НЕТ хороших креативов (все avg_cpl > 1.3 × targets.cpl_cents)',
  '- Новый креатив без данных ЛУЧШЕ чем креатив с плохими результатами!',
  '- Логика: лучше рискнуть с новым контентом, чем повторять неэффективный',
  '- Если unused_creatives.length ≥ 1: создай ОДНУ кампанию с ВСЕМИ новыми креативами в ОДНОМ adset!',
  '- ВАЖНО: Передавай ВСЕ user_creative_ids ОДНИМ вызовом в МАССИВЕ: user_creative_ids: ["uuid-1", "uuid-2", "uuid-3"]',
  '- Результат: 1 Campaign → 1 AdSet → N Ads (по одному на каждый креатив)',
  '- Facebook сам выберет лучший креатив через machine learning!',
  '- Параметры:',
  '  • objective: используй recommended_objective из unused_creatives (обычно "WhatsApp")',
  '  • daily_budget_cents для НОВЫХ ad set\'ов с unused_creatives:',
  '    - минимально 1000 центов ($10) — меньше не даём, Facebook не успеет обучиться;',
  '    - максимально 2000 центов ($20) — НИКОГДА не ставь больше $20 на один НОВЫЙ ad set;',
  '    - если freed_budget_cents большого размера (например, $50), то лучше создать несколько',
  '      НОВЫХ ad set\'ов с бюджетами по $10–20 каждый, чем один на весь бюджет;',
  '    - за один запуск по одному направлению — не более 3 новых ad set\'ов.',
  '  • use_default_settings: true (авто таргетинг)',
  '  • auto_activate: true (ВАЖНО! Сразу запуск для продакшена)',
  '  • campaign_name: "<Название> — Креатив 1" (уникальное название для каждой кампании!)',
  '',
  '🎯 ПРИОРИТЕТ 3: РОТАЦИЯ ПЛОХИХ КРЕАТИВОВ (крайний случай)',
  '- Применяется ТОЛЬКО если unused_creatives = [] И все ready_creatives плохие',
  '- Это последний вариант — выбираем лучший из плохих для ротации',
  '- Выбирай креативы с наименьшим avg_cpl (даже если он выше плана)',
  '- КРИТИЧЕСКИ ВАЖНО: выбирай ТОЛЬКО креативы с direction_id === direction_id направления!',
  '- Используй Direction.CreateAdSetWithCreatives с user_creative_ids из ready_creatives',
  '- Параметры: direction_id (UUID направления), user_creative_ids (массив), daily_budget_cents, adset_name, auto_activate',
  '',
  '🎯 ПРИОРИТЕТ 4: LAL ДУБЛЬ (если нет креативов вообще)',
  '- Применяется ТОЛЬКО если unused_creatives = [] И ready_creatives = []',
  '- ⚠️ КРИТИЧЕСКИ ВАЖНО: ДОСТУПНО ТОЛЬКО если account.has_lal_audience === true!',
  '- ⚠️ Если account.has_lal_audience === false - НЕ ИСПОЛЬЗУЙ это действие! Вместо этого упомяни в planNote что нужно настроить LAL аудиторию в Ads Manager и добавить её ID в настройки.',
  '- Назначение: смена аудитории на LAL 3% IG Engagers 365d (когда нет креативов для ротации)',
  '- Условия:',
  '  • account.has_lal_audience === true (ОБЯЗАТЕЛЬНО! Проверяй ПЕРВЫМ делом)',
  '  • HS ≤ -6 (slightly_bad или bad)',
  '  • CPL_ratio ≥ 2.0 на yesterday ИЛИ last_3d',
  '  • impr_yesterday ≥ 1000 ИЛИ impr_last_3d ≥ 1500',
  '- Бюджет дубля: min(original_daily_budget, $10), в пределах [300..10000] центов',
  '- Экшен: Audience.DuplicateAdSetWithAudience {"source_adset_id","audience_id":"use_lal_from_settings","daily_budget"<=1000,"name_suffix":"LAL3"}',
  '',
  'РЕБАЛАНС БЮДЖЕТА (СНАЧАЛА НАПРАВЛЕНИЯ → ПОТОМ АККАУНТ)',
  '- ШАГ 1. Для КАЖДОГО направления приведи сумму дневных бюджетов всех АКТИВНЫХ ad set\'ов',
  '  к его плану direction_daily_budget_cents (с учётом допустимого коридора).',
  '- ШАГ 2. После этого проверь суммарный бюджет по аккаунту (targets.daily_budget_cents)',
  '  и при необходимости корректируй уже на уровне переноса между направлениями / legacy-кампаниями',
  '  (если это разрешено настройками).',
  '- ⚠️ КРИТИЧЕСКИ ВАЖНО: При снижении/паузе любого adset ВСЕГДА перераспределяй освободившийся бюджет!',
  '- ПРАВИЛО СОХРАНЕНИЯ БЮДЖЕТА:',
  '  • Если снижаешь daily_budget adset_A с $50 до $25 (освобождается $25):',
  '    1. ЕСЛИ есть unused_creatives или ready_creatives → создай новую кампанию с бюджетом $25',
  '    2. ЕСЛИ креативов нет → увеличь бюджет других adsets (с HS≥good) на суммарно $25',
  '  • Если паузишь adset_B с бюджетом $50 (освобождается $50):',
  '    1. ЕСЛИ есть креативы → создай новую кампанию с бюджетом $50',
  '    2. ЕСЛИ креативов нет → перераспредели $50 на другие adsets (пропорционально HS)',
  '- При НЕДОБОРЕ расхода:',
  '  • сначала добавляй тем, у кого HS≥+25 (в рамках лимитов);',
  '  • если таких нет — применяй «best of bad»: выбери максимум HS как опорный и мягко добавь (до +30%); при необходимости отрази в planNote рекомендацию дубля (реальные actions ограничены списком ниже);',
  '  • ограничь долю одного ad set внутри направления cap=40% от планового бюджета направления.',
  '- При ПЕРЕБОРЕ — режь у худших HS на −20..−50% до выполнения планов.',
  '- Перераспределение МЕЖДУ направлениями разрешено, только если квоты не жёсткие; при жёстких квотах перенос запрещён.',
  '',
  '🚨 ЖЁСТКИЙ КОНТРОЛЬ БЮДЖЕТОВ НАПРАВЛЕНИЙ (ОБЯЗАТЕЛЬНО)',
  '- Для КАЖДОГО направления после расчёта ВСЕХ действий в этом запуске:',
  '  1. Посчитай:',
  '     current_direction_budget_cents = сумма daily_budget всех АКТИВНЫХ ad set\'ов',
  '     этого направления (с учётом всех UpdateAdSetDailyBudget / PauseAdset из твоих actions).',
  '  2. Сравни с планом:',
  '     target = direction_daily_budget_cents.',
  '  3. Если current_direction_budget_cents > target:',
  '     - ОБЯЗАТЕЛЬНО срежь лишний бюджет у наиболее слабых ad set\'ов (с худшим HS),',
  '       соблюдая правило: снижение за шаг не более −50% для одного ad set.',
  '     - Продолжай, пока сумма не войдёт в коридор.',
  '  4. Если current_direction_budget_cents < target:',
  '     - Это недобор бюджета по направлению.',
  '     - Если reportOnlyMode=true → можно оставить недобор, но ОБЯЗАТЕЛЬНО упомяни это в отчёте.',
  '     - Если reportOnlyMode=false → ОБЯЗАТЕЛЬНО добери бюджет до коридора:',
  '       • сначала увеличивай бюджеты ad set\'ов с HS≥good (не более +30% за шаг на один ad set),',
  '       • если таких нет — используй принцип «best of bad»: выбери ad set с максимальным HS',
  '         и мягко подними бюджет (например, +10–20%, но не больше +30%),',
  '       • если есть unused_creatives → часть недостающего бюджета можно направить на новые ad set\'ы.',
  '     - ДОПУСТИМЫЙ КОРИДОР:',
  '       • нижняя граница: 0.95 * direction_daily_budget_cents,',
  '       • верхняя граница: 1.05 * direction_daily_budget_cents (если небольшой перебор допустим).',
  '       • Недобор ниже 95% плана при reportOnlyMode=false считается ошибкой:',
  '         такой план недопустим, нужно ДОБАВИТЬ действия.',
  '- Итог: при обычном режиме (не report-only) направление НЕ ДОЛЖНО оставаться с бюджетом',
  '  сильно ниже плана. Агент обязан добрать его до коридора.',
  '',
  '🧮 РАЗБИЕНИЕ ОСВОБОЖДЁННОГО БЮДЖЕТА НА НЕСКОЛЬКО НОВЫХ AD SET\'ОВ',
  '- Для каждого НАПРАВЛЕНИЯ сначала посчитай:',
  '  freed_budget_cents = сумма бюджета, которая освободилась в этом запуске',
  '  за счёт снижения и паузы ad set\'ов в этом направлении.',
  '- Если freed_budget_cents < 1000 (менее $10):',
  '  • новый ad set НЕ создаём,',
  '  • эту сумму лучше ДОБАВИТЬ к существующим лучшим ad set\'ам (HS≥good или best-of-bad),',
  '    чтобы приблизиться к плану по направлению.',
  '- Если freed_budget_cents ≥ 1000:',
  '  • цель — создать несколько НОВЫХ ad set\'ов с бюджетом от 1000 до 2000 центов ($10–20) каждый,',
  '    вместо одного ad set\'а с большим бюджетом.',
  '- Ограничения:',
  '  • за один запуск по одному НАПРАВЛЕНИЮ создавай 1–3 новых ad set\'а;',
  '  • daily_budget_cents каждого нового ad set\'а ∈ [1000; 2000] (не более $20);',
  '  • стремись распределить freed_budget_cents равномерно между новыми ad set\'ами.',
  '- Примеры:',
  '  • freed_budget_cents = 1500 ($15) → 1 новый ad set ~1500 центов.',
  '  • freed_budget_cents = 2500–3200 ($25–32) → 2 новых ad set\'а по ~1200–1600 центов.',
  '  • freed_budget_cents ≥ 3500 ($35+) → 3 новых ad set\'а по ~1200–1800 центов.',
  '- Если после создания новых ad set\'ов всё равно остаётся небольшой «хвост» бюджета',
  '  (несколько долларов), его можно:',
  '  • добавить к лучшим существующим ad set\'ам,',
  '  • или слегка увеличить бюджеты новых ad set\'ов, но НЕ превышая 2000 центов на каждый.',
  '',
  'ЖЁСТКИЕ ОГРАНИЧЕНИЯ ДЛЯ ДЕЙСТВИЙ',
  '- Бюджеты в центах; допустимый дневной диапазон: 300..10000 (т.е. $3..$100).',
  '- Повышение за шаг ≤ +30%; снижение за шаг до −50%.',
  '- ✅ ВСЕ ad set в данных уже АКТИВНЫЕ (effective_status="ACTIVE") - неактивные отфильтрованы автоматически. Можешь безопасно генерировать actions для любого ad set из списка.',
  '- Перед любым Update*/Pause* по объектам внутри кампании ДОБАВЬ GetCampaignStatus этой кампании (первым действием для данного блока изменений).',
  '- Никогда не добавляй неразрешённые типы действий. Если по логике нужен «дубль» — опиши в planNote/reportText как рекомендацию, но не включай несуществующий action.',
  '',
  'ДОСТУПНЫЕ ДЕЙСТВИЯ (РОВНО ЭТИ)',
  '- GetCampaignStatus {"campaign_id"}',
  '- PauseCampaign {"campaign_id","status":"PAUSED"}',
  '- UpdateAdSetDailyBudget {"adset_id","daily_budget"} — снижение/повышение бюджета adset (−50% максимум)',
  '- PauseAdset {"adsetId"} — ПОЛНАЯ ПАУЗА adset (освобождает 100% бюджета). В режиме use_existing также автоматически останавливает все ads.',
  '- PauseAd {"ad_id","status":"PAUSED"}',
  '- Workflow.DuplicateAndPauseOriginal {"campaign_id","name?"} — дублирует кампанию и паузит оригинал (используется для реанимации)',
  '- Workflow.DuplicateKeepOriginalActive {"campaign_id","name?"} — дублирует кампанию, оригинал оставляет активным (масштабирование)',
  '- Audience.DuplicateAdSetWithAudience {"source_adset_id","audience_id","daily_budget?","name_suffix?"} — дубль ad set c заданной аудиторией (LAL3 IG Engagers 365d) без отключения Advantage+. ⚠️ ДОСТУПНО ТОЛЬКО если account.has_lal_audience === true! При audience_id="use_lal_from_settings" использует готовую LAL аудиторию из настроек пользователя.',
  '- Direction.CreateAdSetWithCreatives {"direction_id","user_creative_ids":["uuid1","uuid2"],"daily_budget_cents?","adset_name?","auto_activate?"} — СОЗДАЕТ НОВЫЙ AD SET через Facebook API внутри УЖЕ СУЩЕСТВУЮЩЕЙ кампании НАПРАВЛЕНИЯ. КРИТИЧЕСКИ ВАЖНО: (1) используй ТОЛЬКО креативы с direction_id === указанному direction_id! (2) Креативы из scoring.unused_creatives имеют поле direction_id - фильтруй их перед использованием. (3) Следи за суммой бюджетов ad sets в пределах direction_daily_budget_cents направления (см. жёсткий контроль). (4) Бюджет НОВОГО ad set: 1000–2000 центов ($10–20). НЕ ставь выше 2000 центов. (5) За один запуск по одному направлению создавай не более 3 новых ad set\'ов. ПАРАМЕТР user_creative_ids — МАССИВ! Передавай несколько креативов (1–3 штуки) ОДНИМ вызовом — они автоматически создадутся как отдельные ads в одном ad set.',
  '',
  'ТРЕБОВАНИЯ К ВЫВОДУ (СТРОГО)',
  '- Выведи ОДИН JSON-объект: { "planNote": string, "actions": Action[], "reportText": string } — и больше НИЧЕГО.',
  '- planNote должна быть краткой служебной заметкой (для внутреннего лога), можно использовать технические термины.',
  '- reportText должен быть написан ПРОСТЫМ ЯЗЫКОМ для обычного пользователя без технического жаргона и англицизмов.',
  '- Action: { "type": string, "params": object }. Тип — только из списка выше. Параметры обязательны и валидны.',
  '- Для UpdateAdSetDailyBudget: daily_budget — целое число в центах ∈ [300..10000].',
  '- Для PauseAd: обязателен ad_id; status="PAUSED".',
  '- Для PauseCampaign: обязателен campaign_id; status="PAUSED".',
  '- Для GetCampaignStatus: обязателен campaign_id.',
  '- Перед любыми Update*/Pause* для конкретной кампании — один GetCampaignStatus именно этой кампании (повтор по другим кампаниям допускается).',
  '',
  'ПРАВИЛА ФОРМИРОВАНИЯ reportText',
  '- Везде используй окно yesterday для агрегатов и кампаний; деньги в USD с 2 знаками после запятой.',
  '- Лиды ЗАВИСЯТ ОТ ТИПА КАМПАНИИ:',
  '  • WhatsApp (objective=whatsapp): лиды = conversations_started из whatsapp_metrics',
  '  • Site Leads (objective=site_leads): лиды = pixel_leads из site_leads_metrics',
  '  • Lead Forms (objective=lead_forms): лиды = form_leads из lead_forms_metrics',
  '  • Instagram Traffic (objective=instagram_traffic): метрика = link_clicks (НЕ лиды!)',
  '- CPL формулы:',
  '  • WhatsApp: CPL = spend / conversations_started, Quality CPL = spend / quality_leads',
  '  • Site Leads: CPL = spend / pixel_leads',
  '  • Lead Forms: CPL = spend / form_leads',
  '  • Instagram: CPC = spend / link_clicks (НЕ CPL!)',
  '- Если objective != "whatsapp" — не упоминай ожидание качества из WhatsApp и не ссылайся на QCPL.',
  '- При делении на 0 — выводи "н/д".',
  '- Таймзона отчёта = таймзона аккаунта; дата отчёта — вчерашняя дата этой таймзоны.',
  '- Раздел "Сводка по отдельным кампаниям" формируй ТОЛЬКО по АКТИВНЫМ кампаниям с результатом за yesterday (spend>0 или leads>0). Неактивные/безрезультатные — не включать.',
  '- ВАЖНО: Если в кампании только 1 активный ad set — показывай только итоги по кампании. Если в кампании ≥2 активных ad sets — дополнительно раскрывай детализацию по каждому ad set внутри этой кампании (название, затраты, лиды, CPL, QCPL).',
  '- Раздел "Качество лидов": если в кампании 1 ad set — процент по кампании; если ≥2 ad sets — процент по кампании + детализация по каждому ad set.',
  '- В "✅ Выполненные действия" перечисли КАЖДОЕ действие простым языком без англицизмов и технических терминов:',
  '  • Вместо "HS=bad" → "показатели ниже плановых" или "эффективность снизилась"',
  '  • Вместо "QCPL" → "стоимость качественного лида"',
  '  • Вместо "CPL" → "стоимость лида"',
  '  • Вместо "ребаланс" → "перераспределение бюджета"',
  '  • Вместо "ad set" → "группа объявлений"',
  '  • Объясняй причину простым языком: "снизили бюджет, так как стоимость лидов выше плановой" вместо "снижение из-за HS=bad"',
  '  • Для UpdateAdSetDailyBudget укажи изменение бюджета X→Y в USD и простую причину.',
  '  • Если dispatch=false — добавь пометку "(запланировано)".',
  '',
  'СТРОГИЙ ШАБЛОН reportText (должен совпадать):',
  '📅 Дата отчета: <YYYY-MM-DD>\n\n🏢 Статус рекламного кабинета: <Активен|Неактивен>\n\n📈 Общая сводка:\n- Общие затраты по всем кампаниям: <amount> USD\n- Общее количество полученных лидов: <int>\n- Общий CPL (стоимость за лид): <amount> USD\n- Общее количество качественных лидов: <int>\n- Общий CPL качественного лида: <amount> USD\n\n📊 Сводка по отдельным кампаниям:\n<n>. Кампания "<name>" (ID: <id>)\n   - Статус: <Активна|Неактивна>\n   - Затраты: <amount> USD\n   - Лидов: <int>\n   - CPL: <amount> USD\n   - Качественных лидов: <int>\n   - CPL качественного лида: <amount> USD\n\n📊 Качество лидов:\n- "<name>": <percent>% качественных лидов\n\n✅ Выполненные действия:\n1. Кампания "<name>":\n   - <краткая причина/действие>\n\n📊 Аналитика в динамике:\n- <наблюдение 1>\n- <наблюдение 2>\n\nДля дальнейшей оптимизации обращаем внимание на:\n- <рекомендация 1>\n- <рекомендация 2>',
  '',
  'ПРИМЕР ОТЧЁТА (вставляй в prompt как образец):',
  '📅 Дата отчета: 2025-09-27',
  '',
  '🏢 Статус рекламного кабинета: Активен',
  '',
  '📈 Общая сводка:',
  '- Общие затраты по всем кампаниям: 20.34 USD',
  '- Общее количество полученных лидов: 13',
  '- Общий CPL (стоимость за лид): 1.56 USD',
  '- Общий количество качественных лидов: 10',
  '- Общий CPL качественного лида: 2.03 USD',
  '',
  '📊 Сводка по отдельным кампаниям:',
  '1. Кампания "Про вечерка 2" (ID: 120231837879690372)',
  '   - Статус: Активна',
  '   - Затраты: 6.10 USD',
  '   - Лидов: 4',
  '   - CPL: 1.525 USD',
  '   - Качественных лидов: 3',
  '   - CPL качественного лида: 2.03 USD',
  '   ',
  '2. Кампания "Березовая рошша" (ID: 120232793164110372)',
  '   - Статус: Активна',
  '   - Затраты: 7.14 USD',
  '   - Лидов: 4',
  '   - CPL: 1.785 USD',
  '   - Качественных лидов: 2',
  '   - CPL качественного лида: 3.57 USD',
  '',
  '3. Кампания "Ущелье бутаковка" (ID: 120232793466520372)',
  '   - Статус: Активна',
  '   - Затраты: 7.10 USD',
  '   - Лидов: 5',
  '   - CPL: 1.42 USD',
  '   - Качественных лидов: 5',
  '   - CPL качественного лида: 1.42 USD',
  '',
  '📊 Качество лидов:',
  '- "Про вечерка 2": 75% качественных лидов',
  '- "Березовая рошша": 50% качественных лидов',
  '- "Ущелье бутаковка": 100% качественных лидов',
  '',
  '✅ Выполненные действия:',
  '1. Кампания "Про вечерка 2":',
  '   - Плановая стоимость качественного лида превышена.',
  '   - Кампания показывает высокое качество лидов (75%), но CPL качественного лида выше целевого.',
  '   - Бюджет близок к расходу, увеличений бюджета не требуется на данный момент.',
  '   ',
  '2. Кампания "Березовая рошша":',
  '   - Превышена плановая стоимость качественного лида.',
  '   - Показатель качества лидов ниже (50%), рекомендуется оценить и оптимизировать креативы.',
  '   - Возможное снижение эффективности: необходимо проведение A/B тестирования креативов и текстов.',
  '',
  '3. Кампания "Ущелье бутаковка":',
  '   - Кампания показывает отличный результат по качеству лидов (100%) и CPL ниже целевого.',
  '   - Бюджет используется эффективно и близок к расходу.',
  '   - При отсутствии ограничения бюджета следует рассмотреть возможность повторного увеличения для увеличения лидов.',
  '',
  '📊 Аналитика в динамике:',
  '- Кампания "Про вечерка 2" продолжает поддерживать высокое качество при повышенных CPL, требуется работа с креативами.',
  '- Кампания "Березовая рошша" показывает вариабельное качество и нуждается в оптимизации.',
  '- "Ущелье бутаковка" стабильно продолжает показывать высокие результаты по качеству лидов.',
  '',
  'Для дальнейшей оптимизации обращаем внимание на:',
  '- Проведение тестирования креативов и текстов для кампании "Березовая рошша".',
  '- Возможное увеличение бюджета на "Ущелье бутаковка" при снижении стоимости лидов в других кампаниях.',
  '',
  'Действия по оптимизации не требуются на данный момент, контекстное улучшение креативов и стратегий может улучшить рентабельность.',
  '',
  'ПРИМЕРЫ JSON-ДЕЙСТВИЙ',
  'ПРИМЕР 1 (масштабирование сильного ad set)',
  'Example JSON:\n{\n  "planNote": "HS very_good → scale +30%",\n  "actions": [\n    { "type": "GetCampaignStatus", "params": { "campaign_id": "<CAMP_ID>" } },\n    { "type": "UpdateAdSetDailyBudget", "params": { "adset_id": "<ADSET_ID>", "daily_budget": 2600 } }\n  ],\n  "reportText": "<здесь итоговый отчёт по шаблону>"\n}',
  '',
  'ПРИМЕР 2 (снижение бюджета и пауза «пожирателя»)',
  'Example JSON:\n{\n  "planNote": "HS bad → down -50%, pause top-spend ad; дублирование рекомендовано (см. reportText), но не включено в actions",\n  "actions": [\n    { "type": "GetCampaignStatus", "params": { "campaign_id": "<CAMP_ID>" } },\n    { "type": "UpdateAdSetDailyBudget", "params": { "adset_id": "<ADSET_ID>", "daily_budget": 1000 } },\n    { "type": "PauseAd", "params": { "ad_id": "<AD_ID>", "status": "PAUSED" } }\n  ],\n  "reportText": "<здесь итоговый отчёт по шаблону>"\n}',
  '',
  'ПРИМЕР 3A (реанимация: снижение -50%, переносим часть бюджета, НЕСКОЛЬКО креативов)',
  'Example JSON:\n{\n  "planNote": "HS bad (adset_123, бюджет 5000 центов = $50/день, CPL x2.5). Снижаем плохой adset на -50% (до $25/день), unused_creatives=3 с direction_id = abc-123. Создаем НОВЫЙ AD SET с ТРЕМЯ креативами внутри существующей кампании направления, переносим освободившийся бюджет $25 на него.",\n  "actions": [\n    { "type": "GetCampaignStatus", "params": { "campaign_id": "<DIRECTION_CAMPAIGN_ID>" } },\n    { "type": "UpdateAdSetDailyBudget", "params": { "adset_id": "adset_123", "daily_budget": 2500 } },\n    { "type": "Direction.CreateAdSetWithCreatives", "params": { "direction_id": "abc-123", "user_creative_ids": ["uuid-1", "uuid-2", "uuid-3"], "daily_budget_cents": 2500, "adset_name": "Тест 3 креативов #1", "auto_activate": true } }\n  ],\n  "reportText": "📊 Отчет\\n\\nОбнаружены плохие результаты (adset_123, CPL превышает целевой в 2.5 раза). Снижаем бюджет плохого adset на 50% (с $50 до $25/день). Запускаем новую группу объявлений с 3 свежими креативами — Facebook сам выберет лучший. Переносим освободившуюся половину бюджета ($25/день) на новую группу объявлений."\n}',
  '',
  'ПРИМЕР 3B (реанимация: полная пауза, переносим весь бюджет, ДВА креатива)',
  'Example JSON:\n{\n  "planNote": "HS bad (adset_456, бюджет 5000 центов = $50/день, CPL x4, траты есть но лидов почти нет). ПАУЗИМ adset полностью, unused_creatives=2 с direction_id = abc-123. Создаем НОВЫЙ AD SET с ДВУМЯ креативами внутри существующей кампании направления, переносим весь освободившийся бюджет $50 на него.",\n  "actions": [\n    { "type": "GetCampaignStatus", "params": { "campaign_id": "<DIRECTION_CAMPAIGN_ID>" } },\n    { "type": "PauseAdset", "params": { "adsetId": "adset_456" } },\n    { "type": "Direction.CreateAdSetWithCreatives", "params": { "direction_id": "abc-123", "user_creative_ids": ["uuid-2", "uuid-5"], "daily_budget_cents": 5000, "adset_name": "Тест 2 креативов #1", "auto_activate": true } }\n  ],\n  "reportText": "📊 Отчет\\n\\nОбнаружены критические результаты (adset_456, CPL превышает целевой в 4 раза, траты без лидов). ПОЛНОСТЬЮ паузим неэффективный adset. Запускаем новую группу объявлений с 2 свежими креативами — Facebook сам выберет лучший. Переносим весь освободившийся бюджет ($50/день) на новую группу объявлений для свежего старта."\n}',
  '',
  'ПРИМЕР 4 (ротация существующих креативов, unused пусто)',
  'Example JSON:\n{\n  "planNote": "HS bad, unused_creatives=[] но ready_creatives=[2] с direction_id = abc-123. Ротация лучших креативов в новом adset внутри существующей кампании направления.",\n  "actions": [\n    { "type": "GetCampaignStatus", "params": { "campaign_id": "<DIRECTION_CAMPAIGN_ID>" } },\n    { "type": "UpdateAdSetDailyBudget", "params": { "adset_id": "<ADSET_ID>", "daily_budget": 2500 } },\n    { "type": "Direction.CreateAdSetWithCreatives", "params": { "direction_id": "abc-123", "user_creative_ids": ["uuid-5", "uuid-7"], "daily_budget_cents": 2500, "adset_name": "Ротация — Лучшие креативы", "auto_activate": true } }\n  ],\n  "reportText": "📊 Отчет\\n\\nТекущая кампания показывает плохие результаты. Новых креативов нет, но есть проверенные креативы с хорошей historical performance (CPL $3.20 и $4.10). Снижаем бюджет плохого adset на 50% и запускаем ротацию 2 лучших креативов в новой группе объявлений — новый adset даст шанс на улучшение результатов."\n}',
  '',
  'ПРИМЕР 5 (ребаланс бюджета: снижение плохого + увеличение хороших)',
  'Example JSON:\n{\n  "planNote": "AdSet_A (slightly_bad, бюджет $30) → снижаем на -40% до $18 (освобождается $12). AdSet_B (good) и AdSet_C (very_good) получают по $6 каждый. unused_creatives=[], ready_creatives=[].",\n  "actions": [\n    { "type": "GetCampaignStatus", "params": { "campaign_id": "<CAMP_A>" } },\n    { "type": "UpdateAdSetDailyBudget", "params": { "adset_id": "adset_A", "daily_budget": 1800 } },\n    { "type": "GetCampaignStatus", "params": { "campaign_id": "<CAMP_B>" } },\n    { "type": "UpdateAdSetDailyBudget", "params": { "adset_id": "adset_B", "daily_budget": 2600 } },\n    { "type": "GetCampaignStatus", "params": { "campaign_id": "<CAMP_C>" } },\n    { "type": "UpdateAdSetDailyBudget", "params": { "adset_id": "adset_C", "daily_budget": 3600 } }\n  ],\n  "reportText": "📊 Отчет\\n\\nПроизведен ребаланс бюджета для соблюдения планового расхода. AdSet_A показывает slightly_bad результаты (CPL выше целевого на 40%) — снижен бюджет на $12/день. Освободившиеся средства перераспределены на эффективные adsets: AdSet_B (good, +$6) и AdSet_C (very_good, +$6). Общий суточный бюджет сохранен. Новых креативов для тестирования нет."\n}',
  '',
  'ПРИМЕР 6 (фолбэк на LAL дубль если нет креативов вообще)',
  'Example JSON:\n{\n  "planNote": "HS bad, unused_creatives=[], ready_creatives=[]. Фолбэк: LAL дубль т.к. нет креативов для ротации.",\n  "actions": [\n    { "type": "GetCampaignStatus", "params": { "campaign_id": "<CAMP_ID>" } },\n    { "type": "Audience.DuplicateAdSetWithAudience", "params": { "source_adset_id": "<ADSET_ID>", "audience_id": "use_lal_from_settings", "daily_budget": 1000, "name_suffix": "LAL3" } }\n  ],\n  "reportText": "📊 Отчет\\n\\nТекущая кампания показывает плохие результаты. Креативов для ротации нет, поэтому создаем дубль с LAL аудиторией из настроек. Бюджет $10/день."\n}',
  '',
  'ПРИМЕР 7 (направление: добавить ad set в СУЩЕСТВУЮЩУЮ кампанию направления)',
  'Example JSON:\n{\n  "planNote": "Направление \"Имплантация\" (direction_id: abc-123): из unused_creatives выбрал ТОЛЬКО креативы с direction_id === abc-123 (uuid-1, uuid-2). Добавляем новый ad set внутри существующей кампании направления.",\n  "actions": [\n    { "type": "GetCampaignStatus", "params": { "campaign_id": "<FB_CAMPAIGN_ID_ИЗ_НАПРАВЛЕНИЯ>" } },\n    { "type": "Direction.CreateAdSetWithCreatives", "params": { "direction_id": "abc-123", "user_creative_ids": ["uuid-1","uuid-2"], "daily_budget_cents": 2000, "adset_name": "Тест креативов #1", "auto_activate": false } }\n  ],\n  "reportText": "📊 Отчет\\n\\nПо направлению \"Имплантация\" запускаем тест двух креативов в новой группе объявлений внутри существующей кампании. Бюджет $20/день, статус — на паузе для проверки."\n}',
  '',
  'Тул: SendActions',
  `- POST ${AGENT_URL}`,
  '- Headers: Content-Type: application/json',
  '- BODY: { "idempotencyKey":"<uniq>", "source":"brain", "account":{"userAccountId":"<UUID>"}, "actions":[Action...] }',
  '',
  'САМОПРОВЕРКА ПЕРЕД ВЫВОДОМ (ОБЯЗАТЕЛЬНО):',
  '- Вывод строго один JSON-объект без пояснений/текста вне JSON.',
  '- reportText строго следует шаблону и НАЧИНАЕТСЯ с "📅 Дата отчета:".',
  '- Если передан report.header_first_lines — начни reportText РОВНО с этого блока, без изменений.',
  '- Если во входных данных передан раздел report (report_date, timezone, yesterday_totals, campaigns_yesterday, dispatch), используй эти значения напрямую.',
  '- Если передан report_template — СКОПИРУЙ его как каркас и ЗАПОЛНИ значениями без изменения структуры.',
  '- ⚠️ КРИТИЧЕСКИ ВАЖНО: Если используешь Direction.CreateAdSetWithCreatives, убедись что ВСЕ user_creative_ids имеют direction_id === params.direction_id! Никогда не используй креативы из другого направления!',
  '- reportText содержит ВСЕ разделы в указанном порядке и точных заголовках:',
  '  • "🏢 Статус рекламного кабинета:"',
  '  • "📈 Общая сводка:" (ровно 5 строк показателей)',
  '  • "📊 Сводка по отдельным кампаниям:" (нумерованный список с подпунктами)',
  '  • "📊 Качество лидов:"',
  '  • "✅ Выполненные действия:"',
  '  • "📊 Аналитика в динамике:"',
  '  • "Для дальнейшей оптимизации обращаем внимание на:"',
  '- Не оставляй плейсхолдеры <...>; подставляй реальные значения или "н/д".',
  '- Деньги: формат с двумя знаками после запятой, валюта USD.',
  '- Везде используй окно yesterday для агрегатов и кампаний.',
  '- Если нет действий — раздел остаётся, но с содержанием без фиктивных данных.',
  '- Язык ответа — русский; никаких пояснений вне JSON.',
  '- Для каждого направления из directions[]:',
  '  • пересчитай сумму дневных бюджетов всех активных ad set\'ов с учётом твоих действий',
  '    (UpdateAdSetDailyBudget, PauseAdset, Direction.CreateAdSetWithCreatives);',
  '  • убедись, что при обычном режиме (не report-only) эта сумма находится',
  '    в допустимом коридоре по направлению:',
  '      - >= 0.95 * direction_daily_budget_cents',
  '      - и, если это важно, <= 1.05 * direction_daily_budget_cents;',
  '  • если недобор по направлению >5% и reportOnlyMode=false — вернись и ДОБАВЬ действия',
  '    (увеличение бюджета / создание новых ad set\'ов) до попадания в коридор.'
].join('\n');

const TIKTOK_SYSTEM_PROMPT = (clientPrompt, reportOnlyMode = false, reportOnlyReason = null, minBudgetKzt = null) => [
  (clientPrompt || '').trim(),
  '',
  ...(reportOnlyMode && reportOnlyReason === 'account_inactive' ? [
    '💡 ВАЖНО: РЕЖИМ "ТОЛЬКО ОТЧЕТ" - АККАУНТ НЕАКТИВЕН',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '📊 СИТУАЦИЯ: TikTok рекламный кабинет неактивен (status != STATUS_ENABLE).',
    '',
    '📋 ТВОЯ ЗАДАЧА:',
    '  1. ✅ СОЗДАТЬ ОТЧЕТ о затратах и результатах за вчера',
    '  2. ℹ️ Указать, что аккаунт TikTok сейчас неактивен',
    '  3. ⚙️ actions массив должен быть ПУСТЫМ: []',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
  ] : []),
  ...(reportOnlyMode && reportOnlyReason === 'campaigns_inactive' ? [
    '💡 ВАЖНО: РЕЖИМ "ТОЛЬКО ОТЧЕТ"',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '📊 СИТУАЦИЯ: За вчера были затраты, НО все кампании TikTok неактивны.',
    '',
    '📋 ТВОЯ ЗАДАЧА:',
    '  1. ✅ СОЗДАТЬ ОТЧЕТ о затратах и результатах за вчера',
    '  2. ℹ️ Упомяни, что кампании выключены пользователем',
    '  3. ⚙️ actions массив должен быть ПУСТЫМ: []',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
  ] : []),
  'ОБЩИЙ КОНТЕКСТ',
  '- Ты — таргетолог-агент, управляющий рекламой в TikTok Ads.',
  '- Бюджеты и CPL считаем в тенге (KZT).',
  minBudgetKzt ? `- Минимальный дневной бюджет TikTok: ${minBudgetKzt} ₸` : `- Минимальный дневной бюджет TikTok: ${TIKTOK_MIN_DAILY_BUDGET_KZT} ₸.`,
  '',
  '📊 НАПРАВЛЕНИЯ (КРИТИЧНО!)',
  '- Каждое направление = отдельная TikTok Campaign (tiktok_campaign_id).',
  '- У каждого направления свой дневной бюджет и целевой CPL.',
  '- Внутри кампании несколько AdGroups (adgroup_id).',
  '- Сумма бюджетов активных AdGroups не должна превышать дневной бюджет направления.',
  '',
  'ЦЕЛИ И ЛИДЫ:',
  '- lead_generation / conversions (Leadform / Website Conversions) → лиды считаем по conversions.',
  '- traffic (Traffic Clicky) → лиды считаем по clicks (стоимость действия = CPC).',
  '- Качество лидов для TikTok пока не рассчитывается — укажи это текстом, без числовых значений.',
  '',
  'РАЗРЕШЕННЫЕ ДЕЙСТВИЯ:',
  '- TikTok.GetCampaignStatus',
  '- TikTok.PauseCampaign / TikTok.ResumeCampaign',
  '- TikTok.PauseAdGroup / TikTok.ResumeAdGroup',
  '- TikTok.UpdateAdGroupBudget',
  '- TikTok.PauseAd / TikTok.ResumeAd',
  '- TikTok.Direction.CreateAdGroupWithCreatives (создает новый AdGroup + объявления)',
  '',
  'ФОРМАТ ОТВЕТА:',
  '- Выведи ОДИН JSON: { "planNote": string, "actions": Action[], "reportText": string }',
  '- Если reportOnlyMode=true → actions обязательно пустой массив.',
  '- reportText использует шаблон из входных данных report.report_template или report.header_first_lines.'
].join('\n');

function validateAndNormalizeActions(actions) {
  if (!Array.isArray(actions)) throw new Error('actions must be array');
  const cleaned = [];
  for (const a of actions) {
    if (!a || typeof a !== 'object') continue;
    const type = String(a.type || '');
    if (!ALLOWED_TYPES.has(type)) continue;
    const params = a.params && typeof a.params === 'object' ? { ...a.params } : {};
    if (type === 'GetCampaignStatus') {
      if (!params.campaign_id) throw new Error('GetCampaignStatus: campaign_id required');
    }
    if (type === 'PauseCampaign') {
      if (!params.campaign_id) throw new Error('PauseCampaign: campaign_id required');
      params.status = 'PAUSED';
    }
    if (type === 'UpdateAdSetDailyBudget') {
      if (!params.adset_id) throw new Error('UpdateAdSetDailyBudget: adset_id required');
      const nb = toInt(params.daily_budget);
      if (nb === null) throw new Error('UpdateAdSetDailyBudget: daily_budget int cents required');
      if (nb > 10000) throw new Error('daily_budget > 10000 not allowed');
      // enforce minimum $3 (300 cents)
      params.daily_budget = Math.max(300, nb);
    }
    if (type === 'PauseAd') {
      if (!params.ad_id) throw new Error('PauseAd: ad_id required');
      params.status = 'PAUSED';
    }
    if (type === 'Audience.DuplicateAdSetWithAudience') {
      if (!params.source_adset_id) throw new Error('Audience.DuplicateAdSetWithAudience: source_adset_id required');
      if (!params.audience_id) throw new Error('Audience.DuplicateAdSetWithAudience: audience_id required');
      if (params.daily_budget !== undefined) {
        const nb = toInt(params.daily_budget);
        if (nb === null) throw new Error('Audience.DuplicateAdSetWithAudience: daily_budget int cents required');
        params.daily_budget = Math.max(300, Math.min(10000, nb));
      }
    }
    if (type === 'Workflow.DuplicateAndPauseOriginal' || type === 'Workflow.DuplicateKeepOriginalActive') {
      if (!params.campaign_id) throw new Error(`${type}: campaign_id required`);
      if (params.name !== undefined && typeof params.name !== 'string') {
        throw new Error(`${type}: name must be string if provided`);
      }
    }
    if (type === 'Direction.CreateAdSetWithCreatives') {
      if (!params.direction_id) throw new Error('Direction.CreateAdSetWithCreatives: direction_id required');
      const creativeIds = params.user_creative_ids;
      if (!creativeIds || !Array.isArray(creativeIds) || creativeIds.length === 0) {
        throw new Error('Direction.CreateAdSetWithCreatives: user_creative_ids array required');
      }
      if (params.daily_budget_cents !== undefined) {
        const nb = toInt(params.daily_budget_cents);
        if (nb === null) throw new Error('Direction.CreateAdSetWithCreatives: daily_budget_cents must be int');
        params.daily_budget_cents = Math.max(300, Math.min(10000, nb));
      }
    }
    if (type === 'Direction.UseExistingAdSetWithCreatives') {
      if (!params.direction_id) throw new Error('Direction.UseExistingAdSetWithCreatives: direction_id required');
      const creativeIds = params.user_creative_ids;
      if (!creativeIds || !Array.isArray(creativeIds) || creativeIds.length === 0) {
        throw new Error('Direction.UseExistingAdSetWithCreatives: user_creative_ids array required');
      }
      // daily_budget_cents опциональный - если указан, ad set будет обновлен перед активацией
      if (params.daily_budget_cents !== undefined) {
        const nb = toInt(params.daily_budget_cents);
        if (nb === null) throw new Error('Direction.UseExistingAdSetWithCreatives: daily_budget_cents must be int');
        params.daily_budget_cents = Math.max(300, Math.min(10000, nb));
      }
    }
    if (type === 'PauseAdset') {
      if (!params.adsetId) throw new Error('PauseAdset: adsetId required');
    }
    cleaned.push({ type, params });
  }
  // В режиме reportOnlyMode пустой массив actions допустим
  // if (!cleaned.length) throw new Error('No valid actions');
  return cleaned;
}

function normalizeTikTokBudget(value, bounds) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return null;
  const minBudget = bounds?.minBudget ?? raw;
  const maxBudget = bounds?.maxBudget ?? raw;
  const rounded = Math.round(raw);
  return Math.max(minBudget, Math.min(maxBudget, rounded));
}

function validateAndNormalizeTikTokActions(actions, bounds) {
  if (!Array.isArray(actions)) throw new Error('actions must be array');
  const cleaned = [];
  for (const a of actions) {
    if (!a || typeof a !== 'object') continue;
    const type = String(a.type || '');
    if (!TIKTOK_ALLOWED_TYPES.has(type)) continue;
    const params = a.params && typeof a.params === 'object' ? { ...a.params } : {};

    if (type === 'TikTok.GetCampaignStatus') {
      if (!params.campaign_id) throw new Error('TikTok.GetCampaignStatus: campaign_id required');
    }
    if (type === 'TikTok.PauseCampaign' || type === 'TikTok.ResumeCampaign') {
      if (!params.campaign_id) throw new Error(`${type}: campaign_id required`);
    }
    if (type === 'TikTok.PauseAdGroup' || type === 'TikTok.ResumeAdGroup') {
      if (!params.adgroup_id) throw new Error(`${type}: adgroup_id required`);
    }
    if (type === 'TikTok.UpdateAdGroupBudget') {
      if (!params.adgroup_id) throw new Error('TikTok.UpdateAdGroupBudget: adgroup_id required');
      const nb = normalizeTikTokBudget(params.new_budget, bounds);
      if (nb === null) throw new Error('TikTok.UpdateAdGroupBudget: new_budget number required');
      params.new_budget = nb;
    }
    if (type === 'TikTok.PauseAd' || type === 'TikTok.ResumeAd') {
      if (!params.ad_id) throw new Error(`${type}: ad_id required`);
    }
    if (type === 'TikTok.Direction.CreateAdGroupWithCreatives') {
      if (!params.direction_id) throw new Error('TikTok.Direction.CreateAdGroupWithCreatives: direction_id required');
      if (!params.user_creative_ids || !Array.isArray(params.user_creative_ids) || params.user_creative_ids.length === 0) {
        throw new Error('TikTok.Direction.CreateAdGroupWithCreatives: user_creative_ids array required');
      }
      if (params.daily_budget !== undefined) {
        const nb = normalizeTikTokBudget(params.daily_budget, bounds);
        if (nb === null) throw new Error('TikTok.Direction.CreateAdGroupWithCreatives: daily_budget must be number');
        params.daily_budget = nb;
      }
    }

    cleaned.push({ type, params });
  }
  return cleaned;
}

async function sendActionsBatch(idem, userAccountId, actions, whatsappPhoneNumber, accountId) {
  const res = await fetch(AGENT_URL, {
    method: 'POST',
    headers: { 'content-type':'application/json' },
    body: JSON.stringify({
      idempotencyKey: idem,
      source: 'brain',
      account: {
        userAccountId,
        ...(whatsappPhoneNumber && { whatsappPhoneNumber }),
        ...(accountId && { accountId })  // UUID из ad_accounts для мультиаккаунтов
      },
      actions
    })
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`executor ${res.status}: ${text}`);
  return data;
}

async function sendTelegram(chatId, text, token) {
  if (!chatId) {
    fastify.log.warn({ where: 'sendTelegram', error: 'no_chat_id' });
    return false;
  }
  const bot = token || process.env.TELEGRAM_FALLBACK_BOT_TOKEN;
  if (!bot) {
    fastify.log.warn({ where: 'sendTelegram', error: 'no_bot_token' });
    return false;
  }

  const MAX_PART = 3800; // запас по лимиту 4096
  const parts = [];
  let remaining = String(text || '');
  while (remaining.length > MAX_PART) {
    parts.push(remaining.slice(0, MAX_PART));
    remaining = remaining.slice(MAX_PART);
  }
  parts.push(remaining);

  const telegramUrl = `https://api.telegram.org/bot${bot.slice(0, 10)}***/sendMessage`;
  
  fastify.log.info({ 
    where: 'sendTelegram', 
    chatId, 
    textLength: text?.length || 0, 
    parts: parts.length,
    url: telegramUrl
  });

  try {
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      fastify.log.info({ where: 'sendTelegram', part: i + 1, of: parts.length, length: part.length });
      
      const fullUrl = `https://api.telegram.org/bot${bot}/sendMessage`;
      
      // Создаём AbortController для таймаута
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 секунд таймаут
      
      try {
        const r = await fetch(fullUrl, {
          method: 'POST',
          headers: { 'content-type':'application/json' },
          // без parse_mode для надёжности (Markdown может ломаться)
          body: JSON.stringify({ chat_id: String(chatId), text: part, disable_web_page_preview: true }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (!r.ok) {
          const errText = await r.text().catch(()=> '');
          fastify.log.error({ 
            where: 'sendTelegram', 
            part: i + 1, 
            status: r.status, 
            errText,
            textPreview: part.slice(0, 100)
          });
          return false;
        }
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        // Логируем fetch ошибку с деталями
        fastify.log.error({
          where: 'sendTelegram',
          phase: 'fetch_failed',
          part: i + 1,
          error: String(fetchErr?.message || fetchErr),
          name: fetchErr?.name,
          code: fetchErr?.code,
          isAbortError: fetchErr?.name === 'AbortError'
        });
        throw fetchErr; // пробрасываем для обработки в основном catch
      }
    }
    return true;
  } catch (err) {
    // Рекурсивно извлекаем все вложенные причины
    const causes = [];
    let currentErr = err;
    while (currentErr) {
      if (currentErr.cause) {
        causes.push({
          message: String(currentErr.cause?.message || currentErr.cause),
          code: currentErr.cause?.code,
          errno: currentErr.cause?.errno,
          syscall: currentErr.cause?.syscall
        });
        currentErr = currentErr.cause;
      } else {
        break;
      }
    }
    
    fastify.log.error({ 
      where: 'sendTelegram', 
      error: String(err?.message || err),
      code: err?.code,
      errno: err?.errno,
      syscall: err?.syscall,
      causes: causes,
      stack: err?.stack
    });
    throw err; // пробрасываем ошибку наверх
  }
}

/**
 * Отправить сообщение на все telegram_id пользователя
 * Возвращает массив результатов для каждого ID
 */
async function sendToMultipleTelegramIds(userAccount, reportText) {
  const telegramIds = [
    userAccount.telegram_id,
    userAccount.telegram_id_2,
    userAccount.telegram_id_3,
    userAccount.telegram_id_4
  ].filter(id => id); // Убираем null/undefined

  if (telegramIds.length === 0) {
    fastify.log.warn({ where: 'sendToMultipleTelegramIds', error: 'no_telegram_ids' });
    return { success: false, results: [] };
  }

  const results = [];
  for (const chatId of telegramIds) {
    try {
      const sent = await sendTelegram(chatId, reportText, TELEGRAM_BOT_TOKEN);
      results.push({ chatId, success: sent });
    } catch (err) {
      fastify.log.error({ where: 'sendToMultipleTelegramIds', chatId, error: String(err) });
      results.push({ chatId, success: false, error: String(err) });
    }
  }

  const successCount = results.filter(r => r.success).length;
  fastify.log.info({ 
    where: 'sendToMultipleTelegramIds', 
    total: telegramIds.length, 
    success: successCount, 
    failed: telegramIds.length - successCount 
  });

  return { success: successCount > 0, results };
}

/**
 * Отправить отчёт в мониторинговый бот администратора
 * Добавляет префикс с информацией о пользователе
 */
async function sendToMonitoringBot(userAccount, reportText, dispatchFailed = false) {
  if (!TELEGRAM_BOT_TOKEN || !MONITORING_CHAT_IDS || MONITORING_CHAT_IDS.length === 0) {
    fastify.log.warn({ where: 'sendToMonitoringBot', error: 'monitoring_not_configured' });
    return false;
  }

  const errorPrefix = dispatchFailed ? '❌ ОШИБКА ВЫПОЛНЕНИЯ\n' : '';
  const displayName = userAccount.accountName || userAccount.username || 'N/A';
  const accountIdLine = userAccount.ad_account_id
    ? `🏷️ Ad Account ID: ${userAccount.ad_account_id}\n`
    : '';
  const prefix = `${errorPrefix}📊 ОТЧЁТ КЛИЕНТА
👤 User: ${displayName}
🆔 ID: ${userAccount.id}
${accountIdLine}━━━━━━━━━━━━━━━━

`;

  const fullReport = prefix + reportText;

  // Детальное логирование перед отправкой
  fastify.log.info({
    where: 'sendToMonitoringBot',
    phase: 'before_send',
    userId: userAccount.id,
    username: userAccount.username,
    chatIds: MONITORING_CHAT_IDS,
    dispatchFailed,
    botToken: TELEGRAM_BOT_TOKEN.slice(0, 10) + '***',
    reportLength: fullReport.length,
    environment: process.env.NODE_ENV || 'unknown',
    hostname: process.env.HOSTNAME || 'unknown'
  });

  let anySuccess = false;
  const results = [];

  for (const chatId of MONITORING_CHAT_IDS) {
    try {
      const sent = await sendTelegram(chatId, fullReport, TELEGRAM_BOT_TOKEN);
      anySuccess = anySuccess || sent;
      results.push({ chatId, success: sent });

      fastify.log.info({
        where: 'sendToMonitoringBot',
        phase: 'after_send',
        chatId,
        success: sent,
        userId: userAccount.id,
        username: userAccount.username
      });
    } catch (err) {
      results.push({ chatId, success: false, error: String(err) });
      fastify.log.error({
        where: 'sendToMonitoringBot',
        phase: 'send_failed',
        chatId,
        userId: userAccount.id,
        username: userAccount.username,
        error: String(err),
        stack: err?.stack
      });
    }
  }

  fastify.log.info({
    where: 'sendToMonitoringBot',
    phase: 'completed',
    userId: userAccount.id,
    username: userAccount.username,
    anySuccess,
    results
  });

  return anySuccess;
}

/**
 * Расшифровка ошибки на человеческий язык
 */
function explainError(errorMessage) {
  const explanations = {
    'Invalid OAuth access token': {
      emoji: '🔑',
      title: 'Невалидный токен Facebook',
      explanation: 'Токен доступа к Facebook API истёк или был отозван',
      solution: 'Пользователю нужно переподключить Facebook аккаунт в настройках'
    },
    'rate limit': {
      emoji: '⏱️',
      title: 'Превышен лимит запросов',
      explanation: 'Facebook временно заблокировал запросы из-за слишком частых обращений',
      solution: 'Подождать 15-30 минут, лимит восстановится автоматически'
    },
    'error_subcode: 1870188': {
      emoji: '⚙️',
      title: 'Ошибка параметров объявления',
      explanation: 'Facebook отклонил создание adset из-за неверных параметров promoted_object',
      solution: 'Проверить настройки направления и привязку WhatsApp/страницы'
    },
    'permission': {
      emoji: '🚫',
      title: 'Нет доступа',
      explanation: 'Недостаточно прав для выполнения операции в рекламном кабинете',
      solution: 'Проверить роль пользователя в Business Manager'
    },
    'telegram': {
      emoji: '📱',
      title: 'Ошибка отправки в Telegram',
      explanation: 'Не удалось отправить отчёт пользователю в Telegram',
      solution: 'Проверить telegram_id пользователя и доступность бота'
    },
    'account_disabled': {
      emoji: '⛔',
      title: 'Аккаунт отключён',
      explanation: 'Рекламный кабинет заблокирован или отключён Facebook',
      solution: 'Пользователю нужно разблокировать аккаунт через Facebook'
    },
    'no_active_users': {
      emoji: '👥',
      title: 'Нет активных пользователей',
      explanation: 'Не найдено пользователей для обработки',
      solution: 'Проверить настройки autopilot и optimization у пользователей'
    },
    'supabase': {
      emoji: '🗄️',
      title: 'Ошибка базы данных',
      explanation: 'Проблема при обращении к Supabase',
      solution: 'Проверить доступность Supabase и корректность credentials'
    }
  };

  for (const [pattern, info] of Object.entries(explanations)) {
    if (errorMessage.toLowerCase().includes(pattern.toLowerCase())) {
      return info;
    }
  }

  return {
    emoji: '❓',
    title: 'Неизвестная ошибка',
    explanation: errorMessage.slice(0, 200),
    solution: 'Требуется ручной анализ логов'
  };
}

/**
 * Генерация отчёта по утреннему batch
 */
async function generateBatchReport() {
  const today = new Date().toISOString().split('T')[0];

  const { data: batchResult, error } = await supabase
    .from('batch_execution_results')
    .select('*')
    .eq('execution_date', today)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !batchResult) {
    fastify.log.warn({
      where: 'generateBatchReport',
      error: error?.message || 'no_data',
      date: today
    });

    return {
      success: false,
      report: `⚠️ Отчёт по утреннему batch за ${today}\n\nДанные о выполнении batch не найдены. Возможно, batch ещё не запускался или произошла ошибка.`
    };
  }

  const results = Array.isArray(batchResult.results)
    ? batchResult.results
    : (typeof batchResult.results === 'string' ? JSON.parse(batchResult.results) : []);

  const failures = results.filter(r => !r.success);
  const durationMin = Math.round((batchResult.total_duration_ms || 0) / 60000);

  let report = `📊 Отчёт по утреннему batch за ${today}\n`;
  report += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  report += `✅ Успешно: ${batchResult.success_count}\n`;
  report += `❌ С ошибками: ${batchResult.failure_count}\n`;
  report += `📈 Всего обработано: ${batchResult.total_users}\n`;
  report += `⏱️ Время выполнения: ${durationMin} мин\n\n`;

  if (failures.length === 0) {
    report += `🎉 Все пользователи обработаны успешно!`;
  } else {
    report += `⚠️ Пользователи с ошибками:\n`;
    report += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    for (const fail of failures) {
      const explained = explainError(fail.error || 'Unknown error');
      report += `👤 ${fail.username || 'Unknown'}\n`;
      report += `${explained.emoji} ${explained.title}\n`;
      report += `📝 ${explained.explanation}\n`;
      report += `💡 ${explained.solution}\n\n`;
    }
  }

  fastify.log.info({
    where: 'generateBatchReport',
    date: today,
    totalUsers: batchResult.total_users,
    successCount: batchResult.success_count,
    failureCount: batchResult.failure_count
  });

  return { success: true, report };
}

function finalizeReportText(raw, { adAccountId, dateStr }) {
  let text = String(raw || '').trim();
  const startIdx = text.indexOf('📅 Дата отчета:');
  if (startIdx >= 0) {
    text = text.slice(startIdx);
  }
  // Обрезаем, если LLM добавила последующие отчёты (например, "Отчёт 2:")
  const cutMarkers = [/\nОтч[её]т\s*\d+\s*:/i, /\n=+\n/g];
  for (const re of cutMarkers) {
    const m = text.match(re);
    if (m && m.index > 0) {
      text = text.slice(0, m.index);
    }
  }
  // Нормализуем строку статуса с корректным ID аккаунта
  if (adAccountId) {
    text = text.replace(
      /(^|\n)🏢\s*Статус рекламного кабинета:[^\n]*/,
      `\n🏢 Статус рекламного кабинета: Активен (ID: ${String(adAccountId)})`
    );
  }
  // Простой лимит безопасности
  const MAX_LEN = 3500;
  if (text.length > MAX_LEN) text = text.slice(0, MAX_LEN - 3) + '...';
  return text;
}

function getAccountStatusText(accountStatus) {
  if (!accountStatus || accountStatus.error) {
    return '⚠️ Не удалось получить статус';
  }
  const status = Number(accountStatus.account_status);
  switch(status) {
    case 1:
      return '✅ Активен';
    case 2:
      return '⚠️ Отключен (DISABLED)';
    case 3:
      return '💳 Задолженность (UNSETTLED - необходима оплата)';
    default:
      return `⚠️ Неизвестный статус (${status})`;
  }
}

function getTikTokAccountStatusText(accountInfo) {
  if (!accountInfo || accountInfo.error) {
    return '⚠️ Не удалось получить статус';
  }
  const status = accountInfo.status || accountInfo.account_status || '';
  if (status === 'STATUS_ENABLE' || status === 'ENABLE') {
    return '✅ Активен';
  }
  if (status === 'STATUS_DISABLE' || status === 'DISABLE') {
    return '⚠️ Отключен';
  }
  return status ? `⚠️ Статус: ${status}` : '⚠️ Неизвестный статус';
}

function buildReport({ date, accountStatus, insights, actions, lastReports }) {
  // Проверяем, были ли ошибки при получении данных из Facebook
  let statusLine;
  if (accountStatus?.error) {
    statusLine = `⚠️ Не удалось получить данные из Facebook (${accountStatus.error})`;
  } else if (accountStatus?.account_status === 1) {
    statusLine = `Аккаунт активен (ID: ${accountStatus?.id || '—'})`;
  } else if (accountStatus?.account_status === 2) {
    statusLine = `Аккаунт неактивен (причина: ${accountStatus?.disable_reason ?? '—'})`;
  } else {
    statusLine = `⚠️ Статус аккаунта не определён`;
  }

  const executed = actions?.length
    ? actions.map((a,i)=>`${i+1}. ${a.type} — ${JSON.stringify(a.params)}`).join('\n')
    : 'Действия по оптимизации не требовались';

  const text = [
    `*Отчёт за ${date}*`,
    ``,
    `Статус кабинета: ${statusLine}`,
    ``,
    `Выполненные действия:`,
    executed,
    ``
  ].join('\n');

  return text;
}

function formatKztAmount(amount) {
  const value = Number(amount) || 0;
  return `${Math.round(value).toLocaleString('ru-RU')} ₸`;
}

function buildTikTokReport({ date, accountStatusText, campaigns, actions, totalSpend, totalLeads }) {
  const avgCpl = totalLeads > 0 ? (totalSpend / totalLeads) : null;

  const campaignLines = campaigns.length > 0
    ? campaigns.map((c, i) => {
      const cpl = c.leads > 0 ? (c.spend / c.leads) : null;
      return [
        `${i + 1}. Кампания "${c.name}" (ID: ${c.id})`,
        `   - Статус: ${c.status || 'н/д'}`,
        `   - Затраты: ${formatKztAmount(c.spend)}`,
        `   - Лидов/кликов: ${c.leads}`,
        `   - CPL/СРА: ${cpl !== null ? formatKztAmount(cpl) : 'н/д'}`
      ].join('\n');
    }).join('\n')
    : 'Нет кампаний с результатами';

  const executed = actions?.length
    ? actions.map((a, i) => `${i + 1}. ${a.type} — ${JSON.stringify(a.params)}`).join('\n')
    : 'Действия не выполнялись';

  const reportLines = [
    `📅 Дата отчета: ${date}`,
    '',
    `🏢 Статус рекламного кабинета: ${accountStatusText || 'н/д'}`,
    '',
    '📈 Общая сводка:',
    `- Общие затраты по всем кампаниям: ${formatKztAmount(totalSpend)}`,
    `- Общее количество полученных лидов/кликов: ${totalLeads}`,
    `- Средняя стоимость действия: ${avgCpl !== null ? formatKztAmount(avgCpl) : 'н/д'}`,
    '',
    '📊 Сводка по отдельным кампаниям:',
    campaignLines,
    '',
    '📊 Качество лидов:',
    '- Качество лидов для TikTok пока не рассчитывается.',
    '',
    '✅ Выполненные действия:',
    executed,
    '',
    '📊 Аналитика в динамике:',
    '- н/д',
    '',
    'Для дальнейшей оптимизации обращаем внимание на:',
    '- Проверьте креативы и ставки для удержания CPL.'
  ];

  return reportLines.join('\n');
}

// ТЕСТОВЫЙ ПРОМТ для проверки инструментов дублирования
const TEST_SYSTEM_PROMPT = `
Ты — тестовый AI-агент. Твоя задача: сгенерировать JSON с действиями дублирования для проверки системы.

ДОСТУПНЫЕ ДЕЙСТВИЯ:
- GetCampaignStatus {"campaign_id"}
- Workflow.DuplicateAndPauseOriginal {"campaign_id","name?"}
- Workflow.DuplicateKeepOriginalActive {"campaign_id","name?"}
- Audience.DuplicateAdSetWithAudience {"source_adset_id","audience_id","daily_budget?","name_suffix?"}

ПРАВИЛА:
1. Найди ПЕРВУЮ активную кампанию из входных данных (campaigns)
2. Найди ПЕРВЫЙ активный ad set из входных данных (adsets)
3. Сгенерируй следующие actions:
   - GetCampaignStatus для найденной кампании
   - Audience.DuplicateAdSetWithAudience для найденного ad set с параметрами:
     * source_adset_id: ID найденного ad set
     * audience_id: "use_lal_from_settings" (использует готовую LAL аудиторию из настроек юзера)
     * daily_budget: 1000 (в центах, т.е. $10)
     * name_suffix: "TEST DUP"

ФОРМАТ ОТВЕТА (ТОЛЬКО JSON, БЕЗ ПОЯСНЕНИЙ):
{
  "planNote": "TEST: проверка Audience.DuplicateAdSetWithAudience",
  "actions": [
    { "type": "GetCampaignStatus", "params": { "campaign_id": "..." } },
    { "type": "Audience.DuplicateAdSetWithAudience", "params": { "source_adset_id": "...", "audience_id": "use_lal_from_settings", "daily_budget": 1000, "name_suffix": "TEST DUP" } }
  ],
  "reportText": "📅 Тестовый отчёт\\n\\nВыполнена проверка инструментов дублирования.\\nСоздан дубль ad set с LAL аудиторией."
}

Замени "..." на реальные ID из входных данных.
`;

async function llmPlan(systemPrompt, userPayload) {
  const resp = await responsesCreateWithRetry({
    model: MODEL,
    input: [
      { role: 'system', content: [ { type: 'input_text', text: systemPrompt } ] },
      { role: 'user', content: [ { type: 'input_text', text: JSON.stringify(userPayload) } ] }
    ]
  });
  // Extract text from output array
  let txt = '';
  if (Array.isArray(resp.output)) {
    // Find message object in output
    const message = resp.output.find(o => o.type === 'message');
    if (message && Array.isArray(message.content)) {
      // Find output_text in message content
      const textContent = message.content.find(c => c.type === 'output_text');
      txt = textContent?.text || '';
    }
  }
  let parsed = null;
  let parseError = null;
  if (txt) {
    try {
      parsed = JSON.parse(txt);
    } catch (e) {
      try {
        const m = txt.match(/\{[\s\S]*\}/);
        parsed = m ? JSON.parse(m[0]) : null;
      } catch (e2) {
        parseError = String(e2?.message || e2 || 'parse_failed');
      }
    }
  } else {
    parseError = 'empty_llm_response';
  }
  return {
    parsed,
    rawText: txt,
    parseError,
    meta: {
      id: resp.id || null,
      created: resp.created || null,
      finish_reason: resp.output?.[0]?.finish_reason || null,
      usage: resp?.usage || null
    }
  };
}

// POST /api/brain/run  { idempotencyKey?, userAccountId, accountId?, inputs?:{ dispatch?:boolean } }
// accountId - UUID из ad_accounts.id для мультиаккаунтного режима (опционально, если не передан - определится через getAccountUUID)
fastify.post('/api/brain/run', async (request, reply) => {
  const started = Date.now();
  let userAccountId = null;
  let accountId = null;
  let inputs = null;
  try {
    const { idempotencyKey, userAccountId: reqUserAccountId, accountId: reqAccountId, inputs: reqInputs } = request.body || {};
    userAccountId = reqUserAccountId || null;
    accountId = reqAccountId || null;
    inputs = reqInputs || null;
    if (!userAccountId) return reply.code(400).send({ error: 'userAccountId required' });

    const idem = idempotencyKey || genIdem();

    if (BRAIN_DRY_RUN) {
      const idem = idempotencyKey || genIdem();
      const actionsDraft = [
        { type: 'GetCampaignStatus', params: { campaign_id: '123' } },
        { type: 'UpdateAdSetDailyBudget', params: { adset_id: '456', daily_budget: 3000 } },
        { type: 'PauseAd', params: { adId: '789' } }
      ];
      const actions = validateAndNormalizeActions(actionsDraft);
      let agentResponse = null;
      if (inputs?.dispatch) {
        agentResponse = await sendActionsBatch(idem, userAccountId, actions, null, null);
      }
      const date = new Date().toISOString().slice(0,10);
      const reportText = buildReport({
        date,
        accountStatus: { account_status: 1 },
        insights: [],
        actions: inputs?.dispatch ? actions : [],
        lastReports: []
      });
      const sent = false;
      return reply.send({
        idempotencyKey: idem,
        planNote: 'dry_run_plan',
        actions,
        dispatched: !!inputs?.dispatch,
        agentResponse,
        telegramSent: sent
      });
    }

    let ua = await getUserAccount(userAccountId);

    // Получаем UUID рекламного аккаунта для мультиаккаунтного режима
    // Если accountId передан явно (из processDailyBatch), используем его
    // Иначе определяем через getAccountUUID() по ad_account_id из user_accounts
    let accountUUID = accountId || await getAccountUUID(userAccountId, ua);

    // Если multi_account_enabled, но accountUUID не определён — берём дефолтный аккаунт
    if (ua.multi_account_enabled && !accountUUID) {
      const { data: defaultAccounts, error: defaultError } = await supabase
        .from('ad_accounts')
        .select('id')
        .eq('user_account_id', userAccountId)
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1);

      fastify.log.info({
        where: 'brain_run',
        phase: 'lookup_default_ad_account',
        userId: userAccountId,
        found: defaultAccounts?.length || 0,
        error: defaultError?.message || null
      });

      if (defaultAccounts && defaultAccounts.length > 0) {
        accountUUID = defaultAccounts[0].id;
        fastify.log.info({
          where: 'brain_run',
          phase: 'using_default_ad_account',
          userId: userAccountId,
          accountUUID
        });
      }
    }

    // ========================================
    // МУЛЬТИАККАУНТНОСТЬ: загружаем credentials из ad_accounts
    // ========================================
    if (ua.multi_account_enabled && accountUUID) {
      const { data: adAccount, error: adAccountError } = await supabase
        .from('ad_accounts')
        .select('access_token, ad_account_id, page_id, whatsapp_phone_number, telegram_id, telegram_id_2, telegram_id_3, telegram_id_4, name, username, default_cpl_target_cents, plan_daily_budget_cents, prompt3, ig_seed_audience_id, brain_timezone, tiktok_access_token, tiktok_business_id, tiktok_account_id, autopilot_tiktok')
        .eq('id', accountUUID)
        .eq('user_account_id', userAccountId)
        .single();

      if (adAccountError || !adAccount) {
        fastify.log.error({
          where: 'brain_run',
          phase: 'load_ad_account_credentials',
          userId: userAccountId,
          accountUUID,
          error: adAccountError?.message || 'ad_account not found'
        });
        return reply.code(400).send({
          error: 'Failed to load ad account credentials',
          details: adAccountError?.message
        });
      }

      // Заменяем credentials из user_accounts на credentials из ad_accounts
      ua = {
        ...ua,
        access_token: adAccount.access_token,
        ad_account_id: adAccount.ad_account_id,
        page_id: adAccount.page_id,
        whatsapp_phone_number: adAccount.whatsapp_phone_number,
        telegram_id: adAccount.telegram_id || null,
        telegram_id_2: adAccount.telegram_id_2 || null,
        telegram_id_3: adAccount.telegram_id_3 || null,
        telegram_id_4: adAccount.telegram_id_4 || null,
        prompt3: adAccount.prompt3 || ua.prompt3,
        ig_seed_audience_id: adAccount.ig_seed_audience_id || ua.ig_seed_audience_id,
        default_cpl_target_cents: adAccount.default_cpl_target_cents ?? ua.default_cpl_target_cents,
        plan_daily_budget_cents: adAccount.plan_daily_budget_cents ?? ua.plan_daily_budget_cents,
        tiktok_access_token: adAccount.tiktok_access_token || ua.tiktok_access_token,
        tiktok_business_id: adAccount.tiktok_business_id || ua.tiktok_business_id,
        tiktok_account_id: adAccount.tiktok_account_id || ua.tiktok_account_id,
        autopilot_tiktok: adAccount.autopilot_tiktok ?? ua.autopilot_tiktok,
        account_timezone: adAccount.brain_timezone || ua.account_timezone,
        accountName: adAccount.name || adAccount.ad_account_id || null,
        accountUsername: adAccount.username || null
      };

      fastify.log.info({
        where: 'brain_run',
        phase: 'credentials_loaded_from_ad_account',
        userId: userAccountId,
        accountUUID,
        hasAccessToken: !!adAccount.access_token,
        adAccountId: adAccount.ad_account_id
      });
    }

    // Логируем старт с username для Grafana
    fastify.log.info({
      where: 'brain_run',
      phase: 'start',
      userId: userAccountId,
      username: ua.username,
      multiAccountEnabled: !!ua.multi_account_enabled,
      accountUUID: accountUUID || null,
      accountIdFromRequest: accountId || null
    });
    
    // ========================================
    // DIRECTIONS - Получаем направления бизнеса
    // ВАЖНО: Передаём accountUUID для фильтрации по конкретному аккаунту!
    // ========================================
    const directions = await getUserDirections(userAccountId, accountUUID);
    fastify.log.info({
      where: 'brain_run',
      phase: 'directions_loaded',
      userId: userAccountId,
      username: ua.username,
      accountId: accountUUID || 'legacy',
      count: directions.length
    });

    // Если нет направлений — пропускаем аккаунт (по решению пользователя)
    if (accountUUID && (!directions || directions.length === 0)) {
      fastify.log.warn({
        where: 'brain_run',
        phase: 'no_directions',
        userId: userAccountId,
        username: ua.username,
        accountId: accountUUID,
        message: 'No directions found for account, skipping autopilot'
      });
      return reply.send({
        success: false,
        skipped: true,
        reason: 'no_directions',
        message: 'Аккаунт пропущен: не создано ни одного направления'
      });
    }

    // ========================================
    // 1. SCORING AGENT - запускается ПЕРВЫМ
    // ========================================
    let scoringOutput = null;
    if (SCORING_ENABLED) {
      try {
        fastify.log.info({ where: 'brain_run', phase: 'scoring_start', userId: userAccountId, username: ua.username });
        scoringOutput = await runScoringAgent(ua, {
          supabase,
          logger: fastify.log,
          useLLM: CAN_USE_LLM,
          responsesCreate: responsesCreateWithRetry,
          minImpressions: SCORING_MIN_IMPRESSIONS,
          predictionDays: SCORING_PREDICTION_DAYS,
          accountUUID: accountUUID  // UUID для мультиаккаунтности, NULL для legacy
        });
        fastify.log.info({ 
          where: 'brain_run', 
          phase: 'scoring_complete', 
          userId: userAccountId,
          username: ua.username,
          summary: scoringOutput?.summary 
        });
      } catch (err) {
        fastify.log.warn({
          where: 'brain_run',
          phase: 'scoring_failed',
          userId: userAccountId,
          username: ua.username,
          error: String(err)
        });

        // Логируем в централизованную систему ошибок
        logErrorToAdmin({
          user_account_id: userAccountId,
          error_type: 'scoring',
          raw_error: String(err?.message || err),
          stack_trace: err?.stack,
          action: 'brain_run_scoring',
          endpoint: '/api/brain/run',
          severity: 'warning'
        }).catch(() => {});

        // Продолжаем работу без scoring данных
        scoringOutput = {
          summary: { high_risk_count: 0, medium_risk_count: 0, low_risk_count: 0, overall_trend: 'unknown', alert_level: 'none' },
          items: [],
          active_creatives_ready: [],
          unused_creatives: [],
          recommendations_for_brain: []
        };
      }
    }
    
    // ========================================
    // 2. Сбор данных из Facebook API
    // ========================================
    // Используем adsets_config из scoring если доступен (избегаем повторный запрос и rate limit)
    const adsetsFromScoring = scoringOutput?.adsets_config;
    const [accountStatus, adsets] = await Promise.all([
      fetchAccountStatus(ua.ad_account_id, ua.access_token).catch(e=>({ error:String(e) })),
      adsetsFromScoring
        ? Promise.resolve(adsetsFromScoring)  // Переиспользуем из scoring
        : fetchAdsets(ua.ad_account_id, ua.access_token).catch(e=>({ error:String(e) }))
    ]);

    if (adsetsFromScoring) {
      fastify.log.info({
        where: 'brain_run',
        phase: 'adsets_reused_from_scoring',
        userId: userAccountId,
        adsetsCount: adsetsFromScoring?.data?.length || 0
      });
    }

    // ========================================
    // ПРОВЕРКА 1: Статус рекламного кабинета
    // ========================================
    // account_status: 1 = ACTIVE, 2 = DISABLED, 3 = UNSETTLED (задолженность)
    const accountHasDebt = accountStatus?.account_status && Number(accountStatus.account_status) !== 1;
    
    if (accountHasDebt) {
      fastify.log.warn({ 
        where: 'brain_run', 
        phase: 'account_debt', 
        userId: userAccountId,
        account_status: accountStatus.account_status,
        disable_reason: accountStatus.disable_reason,
        message: 'Рекламный кабинет имеет задолженность. Режим "только отчёт" активирован.'
      });
    }

    // Логируем ошибки Facebook API (rate limits, auth, etc)
    if (accountStatus?.error) {
      fastify.log.warn({ 
        where: 'brain_run', 
        phase: 'fb_api_error',
        userId: userAccountId,
        api: 'accountStatus',
        error: accountStatus.error 
      }, 'Facebook API error: account status');
    }
    if (adsets?.error) {
      fastify.log.warn({ 
        where: 'brain_run', 
        phase: 'fb_api_error',
        userId: userAccountId,
        api: 'adsets',
        error: adsets.error 
      }, 'Facebook API error: adsets (possibly rate limit)');
    }
    
    // Логируем что получили от FB API
    const adsetsCount = adsets?.data?.length || 0;
    fastify.log.info({
      where: 'brain_run',
      phase: 'fb_api_data_received',
      userId: userAccountId,
      adsetsCount,
      hasAdsetsError: !!adsets?.error
    }, `FB API data: ${adsetsCount} adsets`);

    const date = new Date().toISOString().slice(0,10);
    // Детализация по окнам и HS/решениям (детерминированная логика v1.2)
    const [yRows, d3Rows, d7Rows, d30Rows, todayRows, adRowsY, campY, camp3, camp7, camp30, campT, campList] = await Promise.all([
      fetchInsightsPreset(ua.ad_account_id, ua.access_token, 'yesterday').then(r=>r.data||[]).catch(()=>[]),
      fetchInsightsPreset(ua.ad_account_id, ua.access_token, 'last_3d').then(r=>r.data||[]).catch(()=>[]),
      fetchInsightsPreset(ua.ad_account_id, ua.access_token, 'last_7d').then(r=>r.data||[]).catch(()=>[]),
      fetchInsightsPreset(ua.ad_account_id, ua.access_token, 'last_30d').then(r=>r.data||[]).catch(()=>[]),
      fetchInsightsPreset(ua.ad_account_id, ua.access_token, 'today').then(r=>r.data||[]).catch(()=>[]),
      fetchAdLevelInsightsPreset(ua.ad_account_id, ua.access_token, 'yesterday').then(r=>r.data||[]).catch(()=>[]),
      fetchCampaignInsightsPreset(ua.ad_account_id, ua.access_token, 'yesterday').then(r=>r.data||[]).catch(()=>[]),
      fetchCampaignInsightsPreset(ua.ad_account_id, ua.access_token, 'last_3d').then(r=>r.data||[]).catch(()=>[]),
      fetchCampaignInsightsPreset(ua.ad_account_id, ua.access_token, 'last_7d').then(r=>r.data||[]).catch(()=>[]),
      fetchCampaignInsightsPreset(ua.ad_account_id, ua.access_token, 'last_30d').then(r=>r.data||[]).catch(()=>[]),
      fetchCampaignInsightsPreset(ua.ad_account_id, ua.access_token, 'today').then(r=>r.data||[]).catch(()=>[]),
      fetchCampaigns(ua.ad_account_id, ua.access_token).then(r=>r.data||[]).catch(()=>[])
    ]);
    const byY = indexByAdset(yRows);
    const by3 = indexByAdset(d3Rows);
    const by7 = indexByAdset(d7Rows);
    const by30 = indexByAdset(d30Rows);
    const byToday = indexByAdset(todayRows);
    const adsByAdsetY = indexAdsByAdset(adRowsY);

    // Проверяем если все массивы пустые - возможно FB API проблема
    const adsetData = adsets?.data || [];
    if (yRows.length === 0 && d3Rows.length === 0 && d7Rows.length === 0 && adsetData.length === 0) {
      fastify.log.warn({
        where: 'brain_run',
        phase: 'fb_api_empty_response',
        userId: userAccountId,
        message: 'All Facebook API responses are empty - possible rate limit or API issue'
      });
    }

    // ========================================
    // ИСТОРИЯ ДЕЙСТВИЙ ЗА ПОСЛЕДНИЕ 3 ДНЯ
    // ========================================
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    // ВАЖНО: В базе ad_account_id хранится с префиксом "act_"
    // normalizeAdAccountId() уже добавляет префикс если его нет
    const normalizedAccountId = normalizeAdAccountId(ua.ad_account_id);
    const { data: recentExecutions, error: historyError } = await supabase
      .from('agent_executions')
      .select(`
        id,
        created_at,
        status,
        source,
        agent_actions (
          action_idx,
          type,
          params_json,
          status,
          result_json,
          error_json,
          started_at,
          finished_at
        )
      `)
      .eq('ad_account_id', normalizedAccountId)
      .in('source', ['brain', 'campaign-builder'])
      .gte('created_at', threeDaysAgo)
      .order('created_at', { ascending: false })
      .limit(10); // Последние 10 запусков

    let actionHistory = [];
    if (historyError) {
      fastify.log.warn({ historyError }, 'Failed to fetch action history - continuing without it');
    } else if (recentExecutions && recentExecutions.length > 0) {
      try {
        actionHistory = recentExecutions.map(exec => ({
          execution_id: exec.id,
          date: exec.created_at.split('T')[0], // YYYY-MM-DD
          source: exec.source,
          status: exec.status,
          actions: (exec.agent_actions || []).map(a => ({
            type: a.type,
            params: a.params_json,
            status: a.status,
            result: a.result_json || null,
            error: a.error_json || null
          }))
        }));
        fastify.log.info({ actionHistoryCount: actionHistory.length }, 'Action history loaded successfully');
      } catch (mapError) {
        fastify.log.warn({ mapError }, 'Failed to map action history - continuing without it');
        actionHistory = [];
      }
    } else {
      fastify.log.info('No action history found for last 3 days - agent will work without context');
    }

    // ТЕСТОВЫЙ РЕЖИМ: подмена CPL для провокации LLM (только если BRAIN_TEST_MODE=true)
    if (process.env.BRAIN_TEST_MODE === 'true' && inputs?.overrideCPL?.length > 0) {
      for (const override of inputs.overrideCPL) {
        const adsetData = byY.get(override.adset_id);
        if (adsetData) {
          const leadsY = computeLeadsFromActions(adsetData).leads || 1;
          const qLeadsY = computeLeadsFromActions(adsetData).qualityLeads || 0;
          
          if (override.qcpl !== undefined && qLeadsY > 0) {
            adsetData.spend = override.qcpl * qLeadsY;
          } else if (override.cpl !== undefined) {
            adsetData.spend = override.cpl * leadsY;
          }
          byY.set(override.adset_id, adsetData);
        }
      }
    }

    const weights = { cpl_gap:45, trend:15, ctr_penalty:8, cpm_penalty:12, freq_penalty:10 };
    const classes = { very_good:25, good:5, neutral_low:-5, bad:-25 };
    const bounds = { minCents: 300, maxCents: 10000 };
    // Загружаем настройки из Supabase или используем дефолты
    const targets = {
      cpl_cents: ua.default_cpl_target_cents || 200,
      daily_budget_cents: ua.plan_daily_budget_cents || 2000
    };

    // ДЕТАЛЬНОЕ ЛОГИРОВАНИЕ: что приходит от Facebook API для yesterday
    console.log('\n=== [BRAIN DEBUG] Facebook API Response для YESTERDAY ===');
    console.log(`Количество строк от Facebook (campY.length): ${campY.length}`);
    if (campY.length > 0) {
      const campaignGroups = new Map();
      campY.forEach(row => {
        const id = row.campaign_id;
        if (!campaignGroups.has(id)) {
          campaignGroups.set(id, []);
        }
        campaignGroups.get(id).push(row);
      });

      console.log(`Уникальных кампаний: ${campaignGroups.size}`);
      console.log('\n--- Детали по каждой кампании ---');

      campaignGroups.forEach((rows, campaign_id) => {
        console.log(`\nКампания: ${rows[0].campaign_name} (${campaign_id})`);
        console.log(`  Facebook вернул ${rows.length} строк для этой кампании`);

        if (rows.length > 1) {
          console.warn('  ⚠️  ДУБЛИКАТЫ! Facebook вернул несколько строк:');
        }

        rows.forEach((row, idx) => {
          const leads = computeLeadsFromActions(row);
          console.log(`  Строка ${idx + 1}:`);
          console.log(`    - spend: ${row.spend}`);
          console.log(`    - impressions: ${row.impressions}`);
          console.log(`    - leads: ${leads.leads} (messaging: ${leads.messagingLeads}, site: ${leads.siteLeads}, form: ${leads.formLeads})`);
          console.log(`    - actions: ${JSON.stringify(row.actions || [])}`);
        });

        // Показываем что будет использовано
        const firstRow = rows[0];
        const firstLeads = computeLeadsFromActions(firstRow);
        console.log(`  ✅ Будет использовано (первая строка):`);
        console.log(`    - spend: ${firstRow.spend}, leads: ${firstLeads.leads}`);

        if (rows.length > 1) {
          console.warn(`  ❌ Будет ПРОПУЩЕНО (${rows.length - 1} дубликатов):`);
          rows.slice(1).forEach((row, idx) => {
            const skippedLeads = computeLeadsFromActions(row);
            console.warn(`    - Строка ${idx + 2}: spend=${row.spend}, leads=${skippedLeads.leads}`);
          });
        }
      });

      console.log('\n=== [BRAIN DEBUG] Конец детального лога ===\n');
    }

    const byCY = indexByCampaign(campY);
    const byC3 = indexByCampaign(camp3);
    const byC7 = indexByCampaign(camp7);
    const byC30 = indexByCampaign(camp30);
    const byCT = indexByCampaign(campT);

    const peers = { cpm: Array.from(byY.values()).map(v=>Number(v.cpm)||0) };

    const decisions = [];
    const hsSummary = [];
    const traceAdsets = [];
    const touchedCampaignIds = new Set();
    const adsetList = Array.isArray(adsets?.data) ? adsets.data : [];
    
    // ========================================
    // ПРОВЕРКА 1: Были ли вообще затраты за вчера (включая неактивные кампании)
    // ========================================
    // Считаем затраты на уровне КАМПАНИЙ (более надежно, чем adsets)
    const totalYesterdaySpendCampaigns = Array.from(byCY.values()).reduce((sum, data) => {
      return sum + (Number(data.spend) || 0);
    }, 0);
    
    // Также считаем на уровне adsets (для детализации)
    const totalYesterdaySpendAdsets = Array.from(byY.values()).reduce((sum, data) => {
      return sum + (Number(data.spend) || 0);
    }, 0);
    
    // Берем максимум (на случай если на одном уровне данные есть, на другом нет)
    const totalYesterdaySpend = Math.max(totalYesterdaySpendCampaigns, totalYesterdaySpendAdsets);
    
    const adsetsWithYesterdayResults = adsetList.filter(as => {
      // Только АКТИВНЫЕ adsets с затратами вчера
      if (as.effective_status !== 'ACTIVE') return false;
      const yesterdayData = byY.get(as.id)||{};
      const hasResults = (Number(yesterdayData.spend)||0) > 0 || (computeLeadsFromActions(yesterdayData).leads||0) > 0;
      return hasResults;
    });
    
    // Все adsets с затратами за вчера (независимо от статуса) - для отчета
    const allAdsetsWithYesterdaySpend = adsetList.filter(as => {
      const yesterdayData = byY.get(as.id)||{};
      const hasResults = (Number(yesterdayData.spend)||0) > 0 || (computeLeadsFromActions(yesterdayData).leads||0) > 0;
      return hasResults;
    });
    
    fastify.log.info({
      where: 'brain_run',
      phase: 'adsets_filtered',
      userId: userAccountId,
      total_adsets: adsetList.length,
      active_adsets: adsetList.filter(a => a.effective_status === 'ACTIVE').length,
      with_yesterday_results: adsetsWithYesterdayResults.length,
      all_with_spend: allAdsetsWithYesterdaySpend.length,
      total_yesterday_spend_campaigns: totalYesterdaySpendCampaigns,
      total_yesterday_spend_adsets: totalYesterdaySpendAdsets,
      total_yesterday_spend: totalYesterdaySpend,
      filtered_out: adsetList.length - adsetsWithYesterdayResults.length
    });
    
    // ========================================
    // ПРОВЕРКА 2: Если вчера не было затрат ВООБЩЕ - не вызываем LLM
    // ========================================
    if (totalYesterdaySpend === 0) {
      fastify.log.info({ 
        where: 'brain_run', 
        phase: 'no_spend_at_all', 
        userId: userAccountId,
        message: 'Вчера не было затрат вообще, пропускаем LLM'
      });
      
      // Формируем отчет с учетом задолженности
      const reportLines = [
        `📊 Отчёт за ${date}`,
        ``
      ];
      
      // Если есть задолженность - говорим об этом ПЕРВЫМ
      if (accountHasDebt) {
        reportLines.push(
          `💳 ВАЖНО: В рекламном кабинете обнаружена задолженность!`,
          ``,
          `Для возобновления показа рекламы необходимо пополнить баланс в Facebook Ads Manager.`,
          ``,
          `───────────────────────────────────`,
          ``
        );
      }
      
      reportLines.push(
        `⚠️ Вчера не было затрат по рекламным кампаниям.`,
        ``,
        accountHasDebt 
          ? `Рекламный кабинет заблокирован из-за задолженности. После пополнения баланса запустите рекламу.`
          : `Рекламный кабинет работает, но кампании не запущены или были на паузе.`,
        ``,
        accountHasDebt
          ? `💡 После пополнения баланса я продолжу давать вам ежедневные отчёты с рекомендациями.`
          : `🚀 Запустите рекламу, и я продолжу давать вам ежедневные отчёты с рекомендациями!`,
        ``,
        `📌 Статус аккаунта: ${getAccountStatusText(accountStatus)}`,
        `📊 Всего ad sets: ${adsetList.length}`,
        `✅ Активных ad sets: ${adsetList.filter(a => a.status === 'ACTIVE').length}`
      );
      
      const reportText = reportLines.join('\n');
      
      // Отправляем в Telegram (если dispatch=true)
      let telegramSent = false;
      let monitoringSent = false;

      const shouldSendTelegram = inputs?.sendReport !== undefined 
        ? inputs.sendReport 
        : (inputs?.dispatch === true);
      
      if (shouldSendTelegram && ua.telegram_id) {
        try {
          const clientResult = await sendToMultipleTelegramIds(ua, reportText);
          telegramSent = clientResult.success;
          fastify.log.info({ where: 'brain_run', phase: 'telegram_sent', userId: userAccountId, success: telegramSent });
        } catch (err) {
          fastify.log.warn({ where: 'brain_run', phase: 'telegram_failed', userId: userAccountId, error: String(err) });
        }

        // Мониторинговый бот
        try {
          monitoringSent = await sendToMonitoringBot(ua, reportText);
        } catch (err) {
          fastify.log.warn({ where: 'brain_run', phase: 'monitoring_failed', userId: userAccountId, error: String(err) });
        }
      }
      
      return reply.send({
        idempotencyKey: idem,
        planNote: 'no_spend_yesterday',
        actions: [],
        dispatched: false,
        telegramSent,
        monitoringSent,
        reportText,
        timing: {
          total_ms: Date.now() - started,
          scoring_ms: scoringOutput ? 0 : null
        }
      });
    }
    
    // ========================================
    // ПРОВЕРКА 3: Были затраты, но нет активных кампаний
    // ========================================
    // Причины для report-only mode:
    // 1. Задолженность в кабинете (account_status != 1)
    // 2. Были затраты, но все кампании неактивны
    const campaignsInactive = adsetsWithYesterdayResults.length === 0 && totalYesterdaySpend > 0;
    const reportOnlyMode = accountHasDebt || campaignsInactive;
    const reportOnlyReason = accountHasDebt ? 'account_debt' : (campaignsInactive ? 'campaigns_inactive' : null);
    
    if (reportOnlyMode) {
      const reasonMessage = accountHasDebt 
        ? 'Рекламный кабинет имеет задолженность. Генерируем только отчет без действий.'
        : 'Были затраты за вчера, но все кампании неактивны. Генерируем только отчет без действий.';
      
      fastify.log.info({ 
        where: 'brain_run', 
        phase: 'report_only_mode', 
        userId: userAccountId,
        reason: reportOnlyReason,
        message: reasonMessage
      });
    }
    
    for (const as of adsetsWithYesterdayResults) {
      const id = as.id;
      const windows = { y: byY.get(id)||{}, d3: by3.get(id)||{}, d7: by7.get(id)||{}, d30: by30.get(id)||{}, today: byToday.get(id)||{} };
      const hs = computeHealthScoreForAdset({ weights, classes, targets, windows, peers });
      hsSummary.push({ adset_id: id, name: as.name, hs: hs.score, cls: hs.cls, ctr: hs.ctr, cpm: hs.cpm, freq: hs.freq });
      const cid = (windows.y && windows.y.campaign_id) || (windows.d3 && windows.d3.campaign_id) || (windows.d7 && windows.d7.campaign_id) || (windows.d30 && windows.d30.campaign_id) || null;
      const actionsForAdset = [];
      const reasons = [];
      // обучение смягчается отчётом; шаги бюджетов строго по классам
      const current = toInt(as.daily_budget);
      if (current) {
        const next = decideBudgetChange(current, hs.cls, bounds);
        if (next !== current) {
          decisions.push({ type:'UpdateAdSetDailyBudget', params:{ adset_id: id, daily_budget: next } });
          actionsForAdset.push({ action: 'UpdateAdSetDailyBudget', from: current, to: next });
          reasons.push(`hs_class=${hs.cls}`);
          if (cid) touchedCampaignIds.add(String(cid));
        } else {
          reasons.push('no_change_budget');
        }
      } else {
        reasons.push('no_daily_budget');
      }
      // Пожиратель объявлений (вчера): >=50% spend и плохой CPL
      const ads = adsByAdsetY.get(id)||[];
      const totalSpend = ads.reduce((s,a)=>s+(a.spend||0),0);
      if (totalSpend > 0 && ads.length >= 2) {
        // находим лидера по тратам
        const sorted = ads.slice().sort((a,b)=>b.spend-a.spend);
        const top = sorted[0];
        if (top && top.spend >= 0.5*totalSpend) {
          const L = computeLeadsFromActions(top);
          const denom = (L.qualityLeads>=3 ? L.qualityLeads : (L.messagingLeads+L.siteLeads+ (L.formLeads||0)));
          const e = denom>0 ? (top.spend*100)/denom : Infinity;
          if (!Number.isFinite(e) || e > targets.cpl_cents*1.3) {
            decisions.push({ type:'PauseAd', params:{ ad_id: top.ad_id, status: 'PAUSED' } });
            actionsForAdset.push({ action: 'PauseAd', ad_id: top.ad_id, reason: 'ad_spend_share>=0.5 && poor_cpl' });
            reasons.push('pause_poor_ad');
            if (cid) touchedCampaignIds.add(String(cid));
          }
        }
      }

      traceAdsets.push({
        adset_id: id,
        name: as.name,
        campaign_id: cid,
        hs: hs.score,
        cls: hs.cls,
        metrics: { impressions: windows.y.impressions||0, spend: windows.y.spend||0, ctr: hs.ctr, cpm: hs.cpm, freq: hs.freq },
        decisions: actionsForAdset,
        reasons
      });
    }

    // Prepend GetCampaignStatus for all touched campaigns
    for (const cid of Array.from(touchedCampaignIds)) {
      decisions.unshift({ type:'GetCampaignStatus', params:{ campaign_id: cid } });
    }

    // В режиме reportOnlyMode очищаем decisions
    if (reportOnlyMode) {
      decisions.length = 0;
      touchedCampaignIds.clear();
      fastify.log.info({ 
        where: 'brain_run', 
        phase: 'report_only_mode_decisions_cleared', 
        userId: userAccountId 
      });
    }
    
    // Подготовка данных для LLM и фолбэк на детерминистический план
    
    // ========================================
    // НАПРАВЛЕНИЯ БИЗНЕСА + PRE-CREATED AD SETS
    // ========================================
    const directionsWithAdSets = await Promise.all(directions.map(async (d) => {
      let precreated_adsets = [];
      
      // Если режим use_existing - загрузить доступные PAUSED ad sets
      if (ua?.default_adset_mode === 'use_existing') {
        const { data: adsets } = await supabaseQuery('direction_adsets',
          async () => await supabase
            .from('direction_adsets')
            .select('id, fb_adset_id, ads_count, status')
            .eq('direction_id', d.id)
            .eq('is_active', true)
            .eq('status', 'PAUSED')
            .lt('ads_count', 50)
            .order('ads_count', { ascending: true })
            .order('linked_at', { ascending: true }),
          { direction_id: d.id }
        );
        precreated_adsets = adsets || [];
      }
      
      return {
        id: d.id,
        name: d.name,
        objective: d.objective,
        fb_campaign_id: d.fb_campaign_id,
        campaign_status: d.campaign_status,
        daily_budget_cents: d.daily_budget_cents,
        target_cpl_cents: d.target_cpl_cents,
        precreated_adsets: precreated_adsets
      };
    }));
    
    const llmInput = {
      userAccountId,
      ad_account_id: ua?.ad_account_id || null,
      account: {
        timezone: ua?.account_timezone || 'Asia/Almaty',
        report_date: date,
        dispatch: !!inputs?.dispatch,
        report_only_mode: reportOnlyMode,
        has_lal_audience: !!ua?.ig_seed_audience_id,
        default_adset_mode: ua?.default_adset_mode || 'api_create',
        whatsapp_connected: !!ua?.whatsapp_phone_number,
        account_name: ua?.accountName || null
      },
      limits: { min_cents: bounds.minCents, max_cents: bounds.maxCents, step_up: 0.30, step_down: 0.50 },
      targets,
      // ========================================
      // НАПРАВЛЕНИЯ БИЗНЕСА
      // ========================================
      directions: directionsWithAdSets,
      // ========================================
      // SCORING DATA - от scoring agent
      // ========================================
      scoring: scoringOutput || null,
      analysis: {
        hsSummary,
        touchedCampaignIds: Array.from(touchedCampaignIds),
        totals: {
          installed_daily_budget_cents_all: (adsetList||[]).reduce((s,a)=>s + (toInt(a.daily_budget)||0), 0),
          installed_daily_budget_cents_active: (adsetList||[]).filter(a=>String(a.status||'')==='ACTIVE').reduce((s,a)=>s + (toInt(a.daily_budget)||0), 0)
        },
        campaigns: (campList||[]).filter(c=>String(c.status||c.effective_status||'').includes('ACTIVE')).map(c=>{
          // Найти направление для этой кампании
          const direction = directions.find(d => d.fb_campaign_id === c.id);
          
          return {
            campaign_id: c.id,
            name: c.name,
            status: c.status,
            daily_budget: toInt(c.daily_budget)||0,
            lifetime_budget: toInt(c.lifetime_budget)||0,
            // Данные направления
            direction_id: direction?.id || null,
            direction_name: direction?.name || null,
            objective: direction?.objective || null,
            direction_daily_budget_cents: direction?.daily_budget_cents || null,
            direction_target_cpl_cents: direction?.target_cpl_cents || null,
            windows: {
              yesterday: byCY.get(c.id)||{},
              last_3d: byC3.get(c.id)||{},
              last_7d: byC7.get(c.id)||{},
              last_30d: byC30.get(c.id)||{},
              today: byCT.get(c.id)||{}
            }
          };
        }),
        adsets: (adsetList||[])
          .filter(as => {
            // В режиме reportOnlyMode - все adsets с затратами
            // В обычном режиме - только АКТИВНЫЕ adsets с затратами вчера
            const yesterdayData = byY.get(as.id)||{};
            const hasResults = (Number(yesterdayData.spend)||0) > 0 || (computeLeadsFromActions(yesterdayData).leads||0) > 0;
            
            if (reportOnlyMode) {
              // Режим "только отчет": включаем все adsets с затратами
              return hasResults;
            } else {
              // Обычный режим: только активные
              if (as.effective_status !== 'ACTIVE') return false;
              return hasResults;
            }
          })
          .map(as=>{
            const direction = directions.find(d => d.fb_campaign_id === as.campaign_id);
            const current = toInt(as.daily_budget)||0;
            const maxUp = Math.max(0, Math.min(bounds.maxCents, Math.round(current*1.3)) - current);
            const maxDown = Math.max(0, current - Math.max(bounds.minCents, Math.round(current*0.5)));
          
            // Получаем ads для этого adset (вчера)
            const adsForAdset = (adsByAdsetY.get(as.id)||[]).map(ad => ({
              ad_id: ad.ad_id,
              ad_name: ad.ad_name,
              spend: ad.spend || 0,
              impressions: ad.impressions || 0,
              actions: ad.actions || []
            }));
          
            return {
              adset_id: as.id,
              name: as.name,
              campaign_id: as.campaign_id,
              objective: direction?.objective || null,
              daily_budget_cents: current,
              status: as.status,
              step_constraints: { step_up_max_pct: 0.30, step_down_max_pct: 0.50 },
              step_bounds_cents: { max_increase: maxUp, max_decrease: maxDown },
              windows: {
                yesterday: byY.get(as.id)||{},
                last_3d: by3.get(as.id)||{},
                last_7d: by7.get(as.id)||{},
                last_30d: by30.get(as.id)||{},
                today: byToday.get(as.id)||{}
              },
              ads: adsForAdset
            };
          })
      },
      report: {
        report_date: date,
        timezone: ua?.account_timezone || 'Asia/Almaty',
        dispatch: !!inputs?.dispatch,
        // В reportOnlyMode учитывать все кампании с результатом, иначе только активные
        yesterday_totals: (()=>{
          const campaignsWithResults = (campList||[])
            .filter(c => reportOnlyMode ? true : String(c.status||c.effective_status||'').includes('ACTIVE'))
            .map(c=>({ c, y: byCY.get(c.id)||{} }))
            .filter(({y})=> (Number(y.spend)||0) > 0 || (computeLeadsFromActions(y).leads||0) > 0);
          const spend = campaignsWithResults.reduce((s,{y})=> s + (Number(y.spend)||0), 0);
          const leads = campaignsWithResults.reduce((s,{y})=> s + (computeLeadsFromActions(y).leads||0), 0);
          const ql = campaignsWithResults.reduce((s,{y})=> s + (computeLeadsFromActions(y).qualityLeads||0), 0);

          // ДЕТАЛЬНОЕ ЛОГИРОВАНИЕ: что попадает в отчет
          console.log('\n=== [BRAIN DEBUG] Данные для отчета (yesterday_totals) ===');
          console.log(`Кампаний с результатами: ${campaignsWithResults.length}`);
          campaignsWithResults.forEach(({c, y}) => {
            const campaignLeads = computeLeadsFromActions(y);
            console.log(`  - ${c.name} (${c.id}):`);
            console.log(`      spend: ${Number(y.spend)||0}`);
            console.log(`      leads: ${campaignLeads.leads} (messaging: ${campaignLeads.messagingLeads}, site: ${campaignLeads.siteLeads}, form: ${campaignLeads.formLeads})`);
          });
          console.log(`\n  ИТОГО в отчете:`);
          console.log(`    - total spend: ${spend.toFixed(2)}`);
          console.log(`    - total leads: ${leads}`);
          console.log(`    - quality leads: ${ql}`);
          console.log('=== [BRAIN DEBUG] Конец лога отчета ===\n');

          return {
            spend_usd: spend.toFixed(2),
            leads_total: leads,
            leads_quality: ql
          };
        })(),
        header_first_lines: (()=>{
          const d = date;
          const campaignsWithResults = (campList||[])
            .filter(c => reportOnlyMode ? true : String(c.status||c.effective_status||'').includes('ACTIVE'))
            .map(c=>({ c, y: byCY.get(c.id)||{} }))
            .filter(({y})=> (Number(y.spend)||0) > 0 || (computeLeadsFromActions(y).leads||0) > 0);
          const spend = campaignsWithResults.reduce((s,{y})=> s + (Number(y.spend)||0), 0);
          const Ltot = campaignsWithResults.reduce((s,{y})=> s + (computeLeadsFromActions(y).leads||0), 0);
          const Lq = campaignsWithResults.reduce((s,{y})=> s + (computeLeadsFromActions(y).qualityLeads||0), 0);
          const cpl = Ltot>0 ? (spend / Ltot) : null;
          const qcpl = Lq>0 ? (spend / Lq) : null;
          return [
            `📅 Дата отчета: ${d}`,
            '',
            `🏢 Статус рекламного кабинета: ${getAccountStatusText(accountStatus)}`,
            '',
            '📈 Общая сводка:',
            `- Общие затраты по всем кампаниям: ${spend.toFixed(2)} USD`,
            `- Общее количество полученных лидов: ${Ltot}`,
            `- Общий CPL (стоимость за лид): ${cpl!==null?cpl.toFixed(2):'н/д'} USD`,
            `- Общее количество качественных лидов: ${Lq}`,
            `- Общий CPL качественного лида: ${qcpl!==null?qcpl.toFixed(2):'н/д'} USD`
          ].join('\n');
        })(),
        campaigns_yesterday: (campList||[])
          .filter(c => String(c.status||c.effective_status||'').includes('ACTIVE'))
          .map(c=>({ c, y: byCY.get(c.id)||{} }))
          .filter(({y})=> (Number(y.spend)||0) > 0 || (computeLeadsFromActions(y).leads||0) > 0)
          .map(({c,y})=>({
            id: c.id,
            name: c.name,
            status: c.status,
            spend_usd: Number(y.spend||0).toFixed(2),
            leads: computeLeadsFromActions(y).leads || 0,
            leads_quality: computeLeadsFromActions(y).qualityLeads || 0
          })),
        report_template: '📅 Дата отчета: <YYYY-MM-DD>\n\n🏢 Статус рекламного кабинета: <Активен|Неактивен>\n\n📈 Общая сводка:\n- Общие затраты по всем кампаниям: <amount> USD\n- Общее количество полученных лидов: <int>\n- Общий CPL (стоимость за лид): <amount> USD\n- Общее количество качественных лидов: <int>\n- Общий CPL качественного лида: <amount> USD\n\n📊 Сводка по отдельным кампаниям:\n<n>. Кампания "<name>" (ID: <id>)\n   - Статус: <Активна|Неактивна>\n   - Затраты: <amount> USD\n   - Лидов: <int>\n   - CPL: <amount> USD\n   - Качественных лидов: <int>\n   - CPL качественного лида: <amount> USD\n\n📊 Качество лидов:\n- "<name>": <percent>% качественных лидов\n\n✅ Выполненные действия:\n1. Кампания "<name>":\n   - <краткая причина/действие>\n\n📊 Аналитика в динамике:\n- <наблюдение 1>\n- <наблюдение 2>\n\nДля дальнейшей оптимизации обращаем внимание на:\n- <рекомендация 1>\n- <рекомендация 2>'
      },
      // ========================================
      // ИСТОРИЯ ДЕЙСТВИЙ ЗА ПОСЛЕДНИЕ 3 ДНЯ
      // ========================================
      action_history: actionHistory || []
    };

    // DEBUG: Логируем что передаем в LLM
    fastify.log.info({
      where: 'llm_input_debug',
      userId: userAccountId,
      scoring_unused_creatives_count: llmInput.scoring?.unused_creatives?.length || 0,
      scoring_unused_creatives: llmInput.scoring?.unused_creatives || [],
      scoring_ready_creatives_count: llmInput.scoring?.ready_creatives?.length || 0
    });
    
    // DEBUG: Пишем в файл для локального дебага
    if (process.env.DEBUG_LLM_INPUT === 'true') {
      const fs = require('fs');
      fs.writeFileSync('/tmp/llm_input_debug.json', JSON.stringify({
        scoring: llmInput.scoring,
        analysis_campaigns_count: llmInput.analysis?.campaigns?.length || 0,
        analysis_adsets_count: llmInput.analysis?.adsets?.length || 0
      }, null, 2));
      fastify.log.debug('🐛 DEBUG: LLM input written to /tmp/llm_input_debug.json');
    }

    let actions;
    let planNote;
    let planLLMRaw = null;
    let reportTextFromLLM = null;
    if (CAN_USE_LLM) {
      try {
        // Используем тестовый промт если включен BRAIN_TEST_MODE
        const system = (process.env.BRAIN_TEST_MODE === 'true') ? TEST_SYSTEM_PROMPT : SYSTEM_PROMPT(ua?.prompt3 || '', reportOnlyMode, reportOnlyReason);
        const { parsed, rawText, parseError } = await llmPlan(system, llmInput);
        planLLMRaw = { rawText, parseError, parsed };
        
        // Логируем результат парсинга LLM
        fastify.log.info({
          where: 'llm_plan_result',
          parsed_ok: !!parsed,
          has_actions: Array.isArray(parsed?.actions),
          actions_count: parsed?.actions?.length || 0,
          has_reportText: !!parsed?.reportText,
          parseError: parseError,
          rawTextLength: rawText?.length || 0,
          rawTextPreview: rawText?.slice(0, 200)
        });
        
        if (!parsed || !Array.isArray(parsed.actions)) throw new Error(parseError || 'LLM invalid output');
        actions = validateAndNormalizeActions(parsed.actions);
        planNote = parsed.planNote || 'llm_plan_v1.2';
        if (typeof parsed.reportText === 'string' && parsed.reportText.trim()) {
          reportTextFromLLM = parsed.reportText.trim();
        }
      } catch (e) {
        // КРИТИЧНО: логируем ошибку LLM!
        fastify.log.error({
          where: 'llm_plan_failed',
          error: String(e?.message || e),
          stack: e?.stack,
          fallback_to_deterministic: true
        });
        
        const limited = Array.isArray(decisions) ? decisions.slice(0, Math.max(0, BRAIN_MAX_ACTIONS_PER_RUN)) : [];
        for (const cid of Array.from(touchedCampaignIds)) limited.unshift({ type:'GetCampaignStatus', params:{ campaign_id: cid } });
        const planFb = { planNote:'deterministic_fallback_v1.2', actions: limited };
        actions = validateAndNormalizeActions(planFb.actions);
        planNote = planFb.planNote;
      }
    } else {
      const limited = Array.isArray(decisions) ? decisions.slice(0, Math.max(0, BRAIN_MAX_ACTIONS_PER_RUN)) : [];
      for (const cid of Array.from(touchedCampaignIds)) limited.unshift({ type:'GetCampaignStatus', params:{ campaign_id: cid } });
      const planFb = { planNote:'deterministic_plan_v1.2', actions: limited };
      actions = validateAndNormalizeActions(planFb.actions);
      planNote = planFb.planNote;
    }

    let agentResponse = null;
    let dispatchFailed = false;

    fastify.log.info({
      where: 'before_actions_dispatch',
      dispatch_requested: !!inputs?.dispatch,
      actions_count: actions?.length || 0,
      actions_preview: actions?.slice(0, 3).map(a => a.type) || []
    });

    if (inputs?.dispatch) {
      try {
        fastify.log.info({
          where: 'dispatching_actions',
          actions_count: actions?.length || 0,
          idem
        });

        agentResponse = await sendActionsBatch(idem, userAccountId, actions, ua?.whatsapp_phone_number, accountUUID);

        fastify.log.info({
          where: 'actions_dispatched',
          success: !!agentResponse,
          response_preview: JSON.stringify(agentResponse).slice(0, 200)
        });
      } catch (dispatchErr) {
        dispatchFailed = true;
        fastify.log.error({
          msg: 'actions_dispatch_failed',
          where: 'actions_dispatch_failed',
          userAccountId,
          userAccountName: ua?.username,
          error: String(dispatchErr?.message || dispatchErr),
          stack: dispatchErr?.stack
        });
        // Не пробрасываем ошибку, но устанавливаем флаг для корректной обработки
      }
    }

    const reportTextRaw = reportTextFromLLM && reportTextFromLLM.trim() ? reportTextFromLLM : buildReport({
      date, accountStatus, insights: insights?.data, actions: inputs?.dispatch ? actions : [],
      lastReports: []
    });
    const reportText = finalizeReportText(reportTextRaw, { adAccountId: ua?.ad_account_id, dateStr: date });

    // Логируем сформированный отчёт
    fastify.log.info({
      where: 'report_generated',
      reportTextLength: reportText?.length || 0,
      reportTextPreview: reportText?.slice(0, 300),
      fromLLM: !!reportTextFromLLM,
      actions_count: actions?.length || 0
    });

    // Собираем plan для сохранения
    const plan = { planNote, actions, reportText: reportTextFromLLM || null };

    // Save report/logs
    let execStatus = 'success';
    if (supabase) {
      try {
        await supabase.from('campaign_reports').insert({
          telegram_id: String(ua.telegram_id || ''),
          account_id: accountUUID || null,  // UUID для мультиаккаунтности, NULL для legacy
          platform: 'facebook',
          report_data: { text: reportText, date, planNote, actions }
        });
      } catch (e) {
        fastify.log.warn({ msg:'save_campaign_report_failed', error:String(e) });
      }
      try {
        await supabase.from('brain_executions').insert({
          user_account_id: userAccountId,
          account_id: accountUUID || null,  // UUID для мультиаккаунтности, NULL для legacy
          idempotency_key: idem,
          plan_json: plan,
          actions_json: actions,
          executor_response_json: agentResponse,
          report_text: reportText,
          status: execStatus,
          duration_ms: Date.now() - started,
          platform: 'facebook'
        });
      } catch (e) {
        fastify.log.warn({ msg:'save_brain_execution_failed', error:String(e) });
      }
    }

    // Send Telegram
    // - По умолчанию отправляется только при dispatch=true (реальные действия)
    // - Можно явно включить через sendReport: true даже при dispatch=false
    // - Можно явно отключить через sendReport: false
    const shouldSendTelegram = inputs?.sendReport !== undefined 
      ? inputs.sendReport 
      : (inputs?.dispatch === true);
    
    fastify.log.info({
      where: 'before_telegram_send',
      shouldSendTelegram,
      has_telegram_id: !!ua.telegram_id,
      has_bot_token: !!ua.telegram_bot_token,
      reportLength: reportText?.length || 0
    });
    
    let sent = false;
    let monitoringSent = false;

    if (shouldSendTelegram) {
      // Если действия не выполнились - НЕ отправляем клиенту, только в monitoring bot
      if (!dispatchFailed) {
        try {
          // Отправляем клиенту на все его telegram_id
          const clientResult = await sendToMultipleTelegramIds(ua, reportText);
          sent = clientResult.success;

          fastify.log.info({
            where: 'telegram_send_result',
            success: sent,
            details: clientResult.results
          });
        } catch (err) {
          fastify.log.error({
            where: 'telegram_send_error',
            error: String(err?.message || err),
            stack: err?.stack
          });
        }
      } else {
        fastify.log.info({
          where: 'telegram_send_skipped',
          reason: 'dispatch_failed',
          userAccountId,
          userAccountName: ua?.username,
          message: 'Report not sent to client because actions dispatch failed'
        });
      }

      // Всегда отправляем в мониторинговый бот (даже если клиенту не отправилось)
      try {
        monitoringSent = await sendToMonitoringBot(ua, reportText, dispatchFailed);
      } catch (err) {
        fastify.log.error({
          where: 'monitoring_send_error',
          error: String(err?.message || err)
        });
      }
    }

    return reply.send({
      idempotencyKey: idem,
      planNote,
      actions,
      dispatched: !!inputs?.dispatch,
      agentResponse,
      telegramSent: sent,
      monitoringSent,
      trace: { adsets: traceAdsets },
      reportText,
      usedAdAccountId: ua?.ad_account_id || null,
      ...(BRAIN_DEBUG_LLM ? { llm: { used: CAN_USE_LLM, model: MODEL, input: llmInput, plan: planLLMRaw } } : {})
    });
  } catch (err) {
    const duration = Date.now() - started;
    
    // Попытаемся получить username если ua уже был получен
    let username = 'unknown';
    let uaForMonitoring = null;
    try {
      if (typeof ua !== 'undefined' && ua) {
        username = ua.username || 'N/A';
        uaForMonitoring = ua;
      } else if (userAccountId) {
        // Попробуем получить username из базы
        const tempUa = await getUserAccount(userAccountId).catch(() => null);
        if (tempUa) {
          username = tempUa.username || 'N/A';
          uaForMonitoring = tempUa;
        }
      }
    } catch {}
    
    // Логируем с username для Grafana
    request.log.error({
      where: 'brain_run',
      phase: 'fatal_error',
      userId: userAccountId,
      username,
      duration,
      error: String(err?.message || err),
      stack: err?.stack
    });
    
    // Логируем в централизованную систему ошибок
    logErrorToAdmin({
      user_account_id: userAccountId,
      error_type: 'api',
      raw_error: String(err?.message || err),
      stack_trace: err?.stack,
      action: 'brain_run',
      endpoint: '/api/brain/run',
      severity: 'critical'
    }).catch(() => {});

    // Отправляем в мониторинговый бот
    if (uaForMonitoring) {
      try {
        const errorReport = `❌ КРИТИЧЕСКАЯ ОШИБКА

Пользователь: ${username}
User ID: ${userAccountId}
Длительность: ${duration}ms

Ошибка: ${String(err?.message || err)}

Stack:
${err?.stack || 'N/A'}`;
        await sendToMonitoringBot(uaForMonitoring, errorReport, true);
      } catch (monitoringErr) {
        request.log.error({
          where: 'brain_run_catch',
          phase: 'monitoring_failed',
          error: String(monitoringErr)
        });
      }
    }

    return reply.code(500).send({ error:'brain_run_failed', details:String(err?.message || err) });
  }
});

// POST /api/brain/run-tiktok { idempotencyKey?, userAccountId, accountId?, inputs?:{ dispatch?:boolean } }
fastify.post('/api/brain/run-tiktok', async (request, reply) => {
  const started = Date.now();
  let userAccountId = null;
  let accountId = null;
  let inputs = null;

  try {
    const { idempotencyKey, userAccountId: reqUserAccountId, accountId: reqAccountId, inputs: reqInputs } = request.body || {};
    userAccountId = reqUserAccountId || null;
    accountId = reqAccountId || null;
    inputs = reqInputs || null;
    if (!userAccountId) return reply.code(400).send({ error: 'userAccountId required' });

    const idem = idempotencyKey || genIdem();

    let ua = await getUserAccount(userAccountId);

    // Получаем UUID рекламного аккаунта для мультиаккаунтного режима
    let accountUUID = accountId || await getAccountUUID(userAccountId, ua);

    if (ua.multi_account_enabled && !accountUUID) {
      const { data: defaultAccounts, error: defaultError } = await supabase
        .from('ad_accounts')
        .select('id')
        .eq('user_account_id', userAccountId)
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1);

      fastify.log.info({
        where: 'tiktok_brain_run',
        phase: 'lookup_default_ad_account',
        userId: userAccountId,
        found: defaultAccounts?.length || 0,
        error: defaultError?.message || null
      });

      if (defaultAccounts && defaultAccounts.length > 0) {
        accountUUID = defaultAccounts[0].id;
        fastify.log.info({
          where: 'tiktok_brain_run',
          phase: 'using_default_ad_account',
          userId: userAccountId,
          accountUUID
        });
      }
    }

    if (ua.multi_account_enabled && accountUUID) {
      const { data: adAccount, error: adAccountError } = await supabase
        .from('ad_accounts')
        .select('tiktok_access_token, tiktok_business_id, tiktok_account_id, telegram_id, telegram_id_2, telegram_id_3, telegram_id_4, name, username, brain_timezone, autopilot_tiktok')
        .eq('id', accountUUID)
        .eq('user_account_id', userAccountId)
        .single();

      if (adAccountError || !adAccount) {
        fastify.log.error({
          where: 'tiktok_brain_run',
          phase: 'load_ad_account_credentials',
          userId: userAccountId,
          accountUUID,
          error: adAccountError?.message || 'ad_account not found'
        });
        return reply.code(400).send({
          error: 'Failed to load ad account credentials',
          details: adAccountError?.message
        });
      }

      ua = {
        ...ua,
        tiktok_access_token: adAccount.tiktok_access_token || ua.tiktok_access_token,
        tiktok_business_id: adAccount.tiktok_business_id || ua.tiktok_business_id,
        tiktok_account_id: adAccount.tiktok_account_id || ua.tiktok_account_id,
        autopilot_tiktok: adAccount.autopilot_tiktok ?? ua.autopilot_tiktok,
        telegram_id: adAccount.telegram_id || ua.telegram_id,
        telegram_id_2: adAccount.telegram_id_2 || ua.telegram_id_2,
        telegram_id_3: adAccount.telegram_id_3 || ua.telegram_id_3,
        telegram_id_4: adAccount.telegram_id_4 || ua.telegram_id_4,
        accountName: adAccount.name || ua.accountName || null,
        accountUsername: adAccount.username || ua.accountUsername || null,
        account_timezone: adAccount.brain_timezone || ua.account_timezone
      };
    }

    const tikTokAccessToken = ua?.tiktok_access_token || null;
    const tikTokAdvertiserId = ua?.tiktok_business_id || null;

    if (!tikTokAccessToken || !tikTokAdvertiserId) {
      return reply.code(400).send({
        error: 'tiktok_credentials_missing',
        message: 'TikTok credentials not found. Please connect TikTok account first.'
      });
    }

    const usdRate = await getUsdToKzt();
    const minBudgetKzt = Number.isFinite(TIKTOK_MIN_DAILY_BUDGET_USD) && TIKTOK_MIN_DAILY_BUDGET_USD > 0
      ? convertUsdToKzt(TIKTOK_MIN_DAILY_BUDGET_USD, usdRate)
      : TIKTOK_MIN_DAILY_BUDGET_KZT;
    const budgetBounds = { minBudget: minBudgetKzt, maxBudget: TIKTOK_MAX_DAILY_BUDGET_KZT };

    let advertiserInfo = null;
    try {
      advertiserInfo = await getTikTokAdvertiserInfo(tikTokAdvertiserId, tikTokAccessToken);
    } catch (err) {
      fastify.log.warn({
        where: 'tiktok_brain_run',
        phase: 'advertiser_info_failed',
        userId: userAccountId,
        error: String(err?.message || err)
      });
      advertiserInfo = { error: String(err?.message || err) };
    }

    const accountTimezone = advertiserInfo?.timezone || ua?.account_timezone || 'Asia/Almaty';
    const date = formatDateInTimeZone(new Date(), accountTimezone);
    const accountStatusText = getTikTokAccountStatusText(advertiserInfo);

    const directions = await getUserDirections(userAccountId, accountUUID);
    const tiktokDirections = (directions || []).filter(d => {
      const platform = String(d.platform || '').toLowerCase();
      return platform === 'tiktok' || platform === 'both' || !!d.tiktok_campaign_id;
    });

    if (accountUUID && (!tiktokDirections || tiktokDirections.length === 0)) {
      fastify.log.warn({
        where: 'tiktok_brain_run',
        phase: 'no_directions',
        userId: userAccountId,
        accountId: accountUUID,
        message: 'No TikTok directions found for account, skipping'
      });
      return reply.send({
        success: false,
        skipped: true,
        reason: 'no_directions',
        message: 'Аккаунт пропущен: нет направлений TikTok'
      });
    }

    const directionCampaignIds = tiktokDirections
      .map(d => d.tiktok_campaign_id)
      .filter(Boolean);

    const reportFiltering = directionCampaignIds.length
      ? JSON.stringify([{
        field_name: 'campaign_ids',
        filter_type: 'IN',
        filter_value: JSON.stringify(directionCampaignIds)
      }])
      : undefined;

    const [campaigns, adgroups] = await Promise.all([
      getTikTokCampaigns(tikTokAdvertiserId, tikTokAccessToken, directionCampaignIds.length ? { filtering: { campaign_ids: directionCampaignIds } } : {}),
      getTikTokAdGroups(tikTokAdvertiserId, tikTokAccessToken, directionCampaignIds.length ? { campaignIds: directionCampaignIds } : {})
    ]);

    const getTikTokStatus = (entity) => entity?.operation_status || entity?.status;
    const isActiveStatus = (status) => status === 'ENABLE' || status === 'STATUS_ENABLE';
    const activeCampaigns = (campaigns || []).filter(c => isActiveStatus(getTikTokStatus(c)));
    const accountInactive = advertiserInfo?.status && !isActiveStatus(advertiserInfo.status);

    let reportOnlyMode = !!accountInactive;
    let reportOnlyReason = accountInactive ? 'account_inactive' : null;
    const accountStatusError = !!advertiserInfo?.error;
    const accountStatusMissing = !advertiserInfo?.status;
    if (!reportOnlyMode && (accountStatusError || accountStatusMissing)) {
      reportOnlyMode = true;
      reportOnlyReason = accountStatusError ? 'account_status_error' : 'account_status_missing';
    }

    fastify.log.info({
      where: 'tiktok_brain_run',
      phase: 'fetched_tiktok_entities',
      userId: userAccountId,
      accountId: accountUUID,
      campaignsCount: campaigns?.length || 0,
      adgroupsCount: adgroups?.length || 0,
      reportOnlyMode,
      reportOnlyReason
    });

    const reportMetrics = ['spend', 'impressions', 'clicks', 'conversions'];
    const [
      yCampaignRows,
      yAdgroupRows,
      d3AdgroupRows,
      d7AdgroupRows,
      d30AdgroupRows,
      todayAdgroupRows,
      yAdRows
    ] = await Promise.all([
      fetchTikTokReportPreset({
        advertiserId: tikTokAdvertiserId,
        accessToken: tikTokAccessToken,
        preset: 'yesterday',
        dataLevel: 'AUCTION_CAMPAIGN',
        dimensions: ['campaign_id'],
        metrics: reportMetrics,
        timeZone: accountTimezone,
        filtering: reportFiltering
      }),
      fetchTikTokReportPreset({
        advertiserId: tikTokAdvertiserId,
        accessToken: tikTokAccessToken,
        preset: 'yesterday',
        dataLevel: 'AUCTION_ADGROUP',
        dimensions: ['adgroup_id', 'campaign_id'],
        metrics: reportMetrics,
        timeZone: accountTimezone,
        filtering: reportFiltering
      }),
      fetchTikTokReportPreset({
        advertiserId: tikTokAdvertiserId,
        accessToken: tikTokAccessToken,
        preset: 'last_3d',
        dataLevel: 'AUCTION_ADGROUP',
        dimensions: ['adgroup_id'],
        metrics: reportMetrics,
        timeZone: accountTimezone,
        filtering: reportFiltering
      }),
      fetchTikTokReportPreset({
        advertiserId: tikTokAdvertiserId,
        accessToken: tikTokAccessToken,
        preset: 'last_7d',
        dataLevel: 'AUCTION_ADGROUP',
        dimensions: ['adgroup_id'],
        metrics: reportMetrics,
        timeZone: accountTimezone,
        filtering: reportFiltering
      }),
      fetchTikTokReportPreset({
        advertiserId: tikTokAdvertiserId,
        accessToken: tikTokAccessToken,
        preset: 'last_30d',
        dataLevel: 'AUCTION_ADGROUP',
        dimensions: ['adgroup_id'],
        metrics: reportMetrics,
        timeZone: accountTimezone,
        filtering: reportFiltering
      }),
      fetchTikTokReportPreset({
        advertiserId: tikTokAdvertiserId,
        accessToken: tikTokAccessToken,
        preset: 'today',
        dataLevel: 'AUCTION_ADGROUP',
        dimensions: ['adgroup_id'],
        metrics: reportMetrics,
        timeZone: accountTimezone,
        filtering: reportFiltering
      }),
      fetchTikTokReportPreset({
        advertiserId: tikTokAdvertiserId,
        accessToken: tikTokAccessToken,
        preset: 'yesterday',
        dataLevel: 'AUCTION_AD',
        dimensions: ['ad_id', 'adgroup_id', 'campaign_id'],
        metrics: reportMetrics,
        timeZone: accountTimezone,
        filtering: reportFiltering
      })
    ]);

    const byCampaignY = indexTikTokReportBy(yCampaignRows, 'campaign_id');
    const byAdgroupY = indexTikTokReportBy(yAdgroupRows, 'adgroup_id');
    const byAdgroup3 = indexTikTokReportBy(d3AdgroupRows, 'adgroup_id');
    const byAdgroup7 = indexTikTokReportBy(d7AdgroupRows, 'adgroup_id');
    const byAdgroup30 = indexTikTokReportBy(d30AdgroupRows, 'adgroup_id');
    const byAdgroupToday = indexTikTokReportBy(todayAdgroupRows, 'adgroup_id');
    const adsByAdgroupY = indexTikTokAdsByAdgroup(yAdRows);

    const directionByCampaignId = new Map();
    for (const d of tiktokDirections || []) {
      if (d.tiktok_campaign_id) {
        directionByCampaignId.set(String(d.tiktok_campaign_id), d);
      }
    }

    const getDirectionBudgetKzt = (direction) => {
      const explicitBudget = Number(direction?.tiktok_daily_budget);
      if (Number.isFinite(explicitBudget) && explicitBudget > 0) return Math.round(explicitBudget);
      if (Number.isFinite(direction?.daily_budget_cents)) {
        return convertUsdToKzt(direction.daily_budget_cents / 100, usdRate);
      }
      return null;
    };

    const getTargetCplKzt = (direction) => {
      const explicitTarget = Number(direction?.tiktok_target_cpl_kzt ?? direction?.tiktok_target_cpl);
      if (Number.isFinite(explicitTarget) && explicitTarget > 0) return explicitTarget;
      if (Number.isFinite(direction?.target_cpl_cents)) {
        return convertUsdToKzt(direction.target_cpl_cents / 100, usdRate);
      }
      return TIKTOK_DEFAULT_CPL_KZT;
    };

    const campaignsWithResults = (campaigns || [])
      .map(c => {
        const metrics = byCampaignY.get(c.campaign_id) || { spend: 0, impressions: 0, clicks: 0, conversions: 0 };
        const direction = directionByCampaignId.get(String(c.campaign_id));
        const objective = direction?.tiktok_objective || direction?.objective || c.objective_type || 'traffic';
        const leads = computeTikTokLeads(metrics, objective).leads || 0;
        return {
          id: c.campaign_id,
          name: c.campaign_name || c.name,
          status: getTikTokStatus(c),
          spend: metrics.spend || 0,
          leads,
          objective
        };
      })
      .filter(c => c.spend > 0 || c.leads > 0);

    const totalSpend = campaignsWithResults.reduce((s, c) => s + (c.spend || 0), 0);
    const totalLeads = campaignsWithResults.reduce((s, c) => s + (c.leads || 0), 0);

    if (!reportOnlyMode && campaignsWithResults.length > 0 && activeCampaigns.length === 0) {
      reportOnlyMode = true;
      reportOnlyReason = 'campaigns_inactive';
    }

    const weights = { cpl_gap: 45, trend: 15, ctr_penalty: 8, cpm_penalty: 12, freq_penalty: 10 };
    const classes = { very_good: 25, good: 5, neutral_low: -5, bad: -25 };
    const peers = { cpm: [] };
    for (const metrics of byAdgroupY.values()) {
      if (metrics.cpm > 0) peers.cpm.push(metrics.cpm);
    }

    const hsSummary = [];
    const decisions = [];
    for (const ag of adgroups || []) {
      const id = ag.adgroup_id;
      const metricsY = byAdgroupY.get(id) || { spend: 0, impressions: 0, clicks: 0, conversions: 0 };
      const direction = directionByCampaignId.get(String(ag.campaign_id));
      const objective = direction?.tiktok_objective || direction?.objective || 'traffic';
      const leadsY = computeTikTokLeads(metricsY, objective).leads || 0;
      const hasResults = (metricsY.spend || 0) > 0 || leadsY > 0;

      if (!hasResults) continue;

      const windows = {
        y: metricsY,
        d3: byAdgroup3.get(id) || { spend: 0, impressions: 0, clicks: 0, conversions: 0 },
        d7: byAdgroup7.get(id) || { spend: 0, impressions: 0, clicks: 0, conversions: 0 },
        d30: byAdgroup30.get(id) || { spend: 0, impressions: 0, clicks: 0, conversions: 0 },
        today: byAdgroupToday.get(id) || { spend: 0, impressions: 0, clicks: 0, conversions: 0 }
      };

      const targetCplKzt = getTargetCplKzt(direction);
      const hs = computeHealthScoreForTikTokAdgroup({
        weights,
        classes,
        targets: { cpl_kzt: targetCplKzt },
        windows,
        peers,
        objective
      });

      hsSummary.push({
        adgroup_id: id,
        name: ag.adgroup_name,
        campaign_id: ag.campaign_id,
        hs: hs.score,
        cls: hs.cls,
        ctr: hs.ctr,
        cpm: hs.cpm
      });

      if (reportOnlyMode || !isActiveStatus(getTikTokStatus(ag))) continue;

      const currentBudget = Number(ag.budget) || 0;
      if (currentBudget > 0) {
        let nextBudget = currentBudget;
        if (hs.cls === 'very_good') nextBudget = Math.round(currentBudget * 1.3);
        else if (hs.cls === 'bad') nextBudget = Math.round(currentBudget * 0.5);
        const normalized = normalizeTikTokBudget(nextBudget, budgetBounds);
        if (normalized !== null && normalized !== currentBudget) {
          decisions.push({ type: 'TikTok.UpdateAdGroupBudget', params: { adgroup_id: id, new_budget: normalized } });
        }
      }

      const adsForAdgroup = adsByAdgroupY.get(id) || [];
      const adSpendTotal = adsForAdgroup.reduce((s, a) => s + (a.spend || 0), 0);
      if (adSpendTotal > 0 && adsForAdgroup.length >= 2) {
        const top = adsForAdgroup.reduce((best, a) => (a.spend > best.spend ? a : best), adsForAdgroup[0]);
        const leadsTop = computeTikTokLeads(top, objective).leads || 0;
        const cplTop = leadsTop > 0 ? (top.spend / leadsTop) : Infinity;
        if (!Number.isFinite(cplTop) || cplTop > targetCplKzt * 1.3) {
          decisions.push({ type: 'TikTok.PauseAd', params: { ad_id: top.ad_id } });
        }
      }
    }

    if (reportOnlyMode) {
      decisions.length = 0;
    }

    const directionsWithAdGroups = await Promise.all((tiktokDirections || []).map(async (d) => {
      let precreated_adgroups = [];
      if (String(d.tiktok_adgroup_mode || '').toLowerCase() === 'use_existing') {
        const { data: adgroupsData } = await supabaseQuery('direction_tiktok_adgroups',
          async () => await supabase
            .from('direction_tiktok_adgroups')
            .select('id, tiktok_adgroup_id, ads_count, status')
            .eq('direction_id', d.id)
            .eq('is_active', true)
            .eq('status', 'DISABLE')
            .lt('ads_count', 50)
            .order('ads_count', { ascending: true })
            .order('linked_at', { ascending: true }),
          { direction_id: d.id }
        );
        precreated_adgroups = adgroupsData || [];
      }

      return {
        id: d.id,
        name: d.name,
        objective: d.tiktok_objective || d.objective,
        tiktok_campaign_id: d.tiktok_campaign_id,
        daily_budget_kzt: getDirectionBudgetKzt(d),
        target_cpl_kzt: getTargetCplKzt(d),
        tiktok_adgroup_mode: d.tiktok_adgroup_mode || null,
        precreated_adgroups
      };
    }));

    const llmInput = {
      platform: 'tiktok',
      userAccountId,
      account: {
        timezone: accountTimezone,
        report_date: date,
        dispatch: !!inputs?.dispatch,
        report_only_mode: reportOnlyMode,
        account_name: ua?.accountName || null,
        currency: advertiserInfo?.currency || 'KZT'
      },
      limits: {
        min_budget_kzt: budgetBounds.minBudget,
        max_budget_kzt: budgetBounds.maxBudget,
        step_up: 0.30,
        step_down: 0.50
      },
      targets: {
        default_cpl_kzt: TIKTOK_DEFAULT_CPL_KZT
      },
      directions: directionsWithAdGroups,
      analysis: {
        hsSummary,
        totals: {
          installed_daily_budget_kzt_all: (adgroups || []).reduce((s, a) => s + (Number(a.budget) || 0), 0),
          installed_daily_budget_kzt_active: (adgroups || []).filter(a => isActiveStatus(getTikTokStatus(a))).reduce((s, a) => s + (Number(a.budget) || 0), 0)
        },
        campaigns: (campaigns || []).map(c => {
          const direction = directionByCampaignId.get(String(c.campaign_id));
          return {
            campaign_id: c.campaign_id,
            name: c.campaign_name || c.name,
            status: getTikTokStatus(c),
            objective: direction?.tiktok_objective || direction?.objective || c.objective_type || null,
            direction_id: direction?.id || null,
            direction_name: direction?.name || null,
            direction_daily_budget_kzt: getDirectionBudgetKzt(direction),
            direction_target_cpl_kzt: getTargetCplKzt(direction),
            windows: {
              yesterday: byCampaignY.get(c.campaign_id) || {},
              last_3d: {},
              last_7d: {},
              last_30d: {},
              today: {}
            }
          };
        }),
        adgroups: (adgroups || []).map(ag => {
          const direction = directionByCampaignId.get(String(ag.campaign_id));
          const objective = direction?.tiktok_objective || direction?.objective || 'traffic';
          const current = Number(ag.budget) || 0;
          const maxUp = Math.max(0, Math.round(current * 1.3) - current);
          const maxDown = Math.max(0, current - Math.round(current * 0.5));
          const adsForAdgroup = (adsByAdgroupY.get(ag.adgroup_id) || []).map(ad => ({
            ad_id: ad.ad_id,
            spend: ad.spend || 0,
            impressions: ad.impressions || 0,
            clicks: ad.clicks || 0,
            conversions: ad.conversions || 0
          }));

          return {
            adgroup_id: ag.adgroup_id,
            name: ag.adgroup_name,
            campaign_id: ag.campaign_id,
            objective,
            daily_budget_kzt: current,
            status: getTikTokStatus(ag),
            step_constraints: { step_up_max_pct: 0.30, step_down_max_pct: 0.50 },
            step_bounds_kzt: { max_increase: maxUp, max_decrease: maxDown },
            windows: {
              yesterday: byAdgroupY.get(ag.adgroup_id) || {},
              last_3d: byAdgroup3.get(ag.adgroup_id) || {},
              last_7d: byAdgroup7.get(ag.adgroup_id) || {},
              last_30d: byAdgroup30.get(ag.adgroup_id) || {},
              today: byAdgroupToday.get(ag.adgroup_id) || {}
            },
            ads: adsForAdgroup
          };
        })
      },
      report: {
        report_date: date,
        timezone: accountTimezone,
        dispatch: !!inputs?.dispatch,
        yesterday_totals: {
          spend_kzt: Math.round(totalSpend),
          leads_total: totalLeads,
          avg_cpl_kzt: totalLeads > 0 ? Math.round(totalSpend / totalLeads) : null
        },
        header_first_lines: [
          `📅 Дата отчета: ${date}`,
          '',
          `🏢 Статус рекламного кабинета: ${accountStatusText}`,
          '',
          '📈 Общая сводка:',
          `- Общие затраты по всем кампаниям: ${formatKztAmount(totalSpend)}`,
          `- Общее количество полученных лидов/кликов: ${totalLeads}`,
          `- Средняя стоимость действия: ${totalLeads > 0 ? formatKztAmount(totalSpend / totalLeads) : 'н/д'}`
        ].join('\n'),
        campaigns_yesterday: campaignsWithResults.map(c => ({
          id: c.id,
          name: c.name,
          status: c.status,
          spend_kzt: Math.round(c.spend || 0),
          leads: c.leads || 0
        })),
        report_template: '📅 Дата отчета: <YYYY-MM-DD>\\n\\n🏢 Статус рекламного кабинета: <Активен|Неактивен>\\n\\n📈 Общая сводка:\\n- Общие затраты по всем кампаниям: <amount> ₸\\n- Общее количество полученных лидов/кликов: <int>\\n- Средняя стоимость действия: <amount> ₸\\n\\n📊 Сводка по отдельным кампаниям:\\n<n>. Кампания \"<name>\" (ID: <id>)\\n   - Статус: <Активна|Неактивна>\\n   - Затраты: <amount> ₸\\n   - Лидов/кликов: <int>\\n   - CPL/СРА: <amount> ₸\\n\\n📊 Качество лидов:\\n- Качество лидов для TikTok пока не рассчитывается.\\n\\n✅ Выполненные действия:\\n1. Кампания \"<name>\":\\n   - <краткая причина/действие>\\n\\n📊 Аналитика в динамике:\\n- <наблюдение 1>\\n- <наблюдение 2>\\n\\nДля дальнейшей оптимизации обращаем внимание на:\\n- <рекомендация 1>\\n- <рекомендация 2>'
      },
      action_history: []
    };

    let actions;
    let planNote;
    let planLLMRaw = null;
    let reportTextFromLLM = null;

    if (CAN_USE_LLM) {
      try {
        const system = TIKTOK_SYSTEM_PROMPT(ua?.prompt3 || '', reportOnlyMode, reportOnlyReason, minBudgetKzt);
        const { parsed, rawText, parseError } = await llmPlan(system, llmInput);
        planLLMRaw = { rawText, parseError, parsed };

        if (!parsed || !Array.isArray(parsed.actions)) throw new Error(parseError || 'LLM invalid output');
        actions = validateAndNormalizeTikTokActions(parsed.actions, budgetBounds);
        planNote = parsed.planNote || 'tiktok_llm_plan_v1';
        if (typeof parsed.reportText === 'string' && parsed.reportText.trim()) {
          reportTextFromLLM = parsed.reportText.trim();
        }
      } catch (e) {
        fastify.log.error({
          where: 'tiktok_llm_plan_failed',
          error: String(e?.message || e),
          stack: e?.stack,
          fallback_to_deterministic: true
        });

        const limited = Array.isArray(decisions) ? decisions.slice(0, Math.max(0, BRAIN_MAX_ACTIONS_PER_RUN)) : [];
        actions = validateAndNormalizeTikTokActions(limited, budgetBounds);
        planNote = 'tiktok_deterministic_fallback_v1';
      }
    } else {
      const limited = Array.isArray(decisions) ? decisions.slice(0, Math.max(0, BRAIN_MAX_ACTIONS_PER_RUN)) : [];
      actions = validateAndNormalizeTikTokActions(limited, budgetBounds);
      planNote = 'tiktok_deterministic_plan_v1';
    }

    if (reportOnlyMode) {
      actions = [];
    }

    fastify.log.info({
      where: 'tiktok_brain_run',
      phase: 'actions_planned',
      userId: userAccountId,
      accountId: accountUUID,
      reportOnlyMode,
      reportOnlyReason,
      actionsCount: Array.isArray(actions) ? actions.length : 0,
      planNote
    });

    let agentResponse = null;
    let dispatchFailed = false;

    if (inputs?.dispatch) {
      try {
        agentResponse = await sendActionsBatch(idem, userAccountId, actions, null, accountUUID);
      } catch (dispatchErr) {
        dispatchFailed = true;
        fastify.log.error({
          msg: 'tiktok_actions_dispatch_failed',
          where: 'tiktok_actions_dispatch_failed',
          userAccountId,
          userAccountName: ua?.username,
          error: String(dispatchErr?.message || dispatchErr),
          stack: dispatchErr?.stack
        });
      }
    }

    const reportTextRaw = reportTextFromLLM && reportTextFromLLM.trim()
      ? reportTextFromLLM
      : buildTikTokReport({
        date,
        accountStatusText,
        campaigns: campaignsWithResults,
        actions: inputs?.dispatch ? actions : [],
        totalSpend,
        totalLeads
      });

    const reportText = finalizeReportText(reportTextRaw, { adAccountId: null, dateStr: date });
    const plan = { planNote, actions, reportText: reportTextFromLLM || null };

    if (supabase) {
      try {
        await supabase.from('campaign_reports').insert({
          telegram_id: String(ua.telegram_id || ''),
          account_id: accountUUID || null,
          platform: 'tiktok',
          report_data: { text: reportText, date, planNote, actions, platform: 'tiktok' }
        });
      } catch (e) {
        fastify.log.warn({ msg: 'save_tiktok_campaign_report_failed', error: String(e) });
      }
      try {
        await supabase.from('brain_executions').insert({
          user_account_id: userAccountId,
          account_id: accountUUID || null,
          idempotency_key: idem,
          plan_json: plan,
          actions_json: actions,
          executor_response_json: agentResponse,
          report_text: reportText,
          status: 'success',
          duration_ms: Date.now() - started,
          platform: 'tiktok'
        });
      } catch (e) {
        fastify.log.warn({ msg: 'save_tiktok_brain_execution_failed', error: String(e) });
      }
    }

    const shouldSendTelegram = inputs?.sendReport !== undefined
      ? inputs.sendReport
      : (inputs?.dispatch === true);

    let sent = false;
    let monitoringSent = false;

    if (shouldSendTelegram) {
      if (!dispatchFailed) {
        try {
          const clientResult = await sendToMultipleTelegramIds(ua, reportText);
          sent = clientResult.success;
        } catch (err) {
          fastify.log.error({
            where: 'tiktok_telegram_send_error',
            error: String(err?.message || err),
            stack: err?.stack
          });
        }
      }

      try {
        monitoringSent = await sendToMonitoringBot(ua, reportText, dispatchFailed);
      } catch (err) {
        fastify.log.error({
          where: 'tiktok_monitoring_send_error',
          error: String(err?.message || err)
        });
      }
    }

    return reply.send({
      idempotencyKey: idem,
      planNote,
      actions,
      dispatched: !!inputs?.dispatch,
      agentResponse,
      telegramSent: sent,
      monitoringSent,
      reportText,
      platform: 'tiktok',
      ...(BRAIN_DEBUG_LLM ? { llm: { used: CAN_USE_LLM, model: MODEL, input: llmInput, plan: planLLMRaw } } : {})
    });
  } catch (err) {
    const duration = Date.now() - started;
    request.log.error({
      where: 'tiktok_brain_run',
      phase: 'fatal_error',
      userId: userAccountId,
      duration,
      error: String(err?.message || err),
      stack: err?.stack
    });

    logErrorToAdmin({
      user_account_id: userAccountId,
      error_type: 'api',
      raw_error: String(err?.message || err),
      stack_trace: err?.stack,
      action: 'tiktok_brain_run',
      endpoint: '/api/brain/run-tiktok',
      severity: 'critical'
    }).catch(() => {});

    return reply.code(500).send({ error: 'tiktok_brain_run_failed', details: String(err?.message || err) });
  }
});

// Старая совместимость: /api/brain/decide (только план, без FB fetch) — опционально, оставлено
fastify.post('/api/brain/decide', async (request, reply) => {
  try {
    const { idempotencyKey, userAccountId, goal, inputs } = request.body || {};
    if (!userAccountId) return reply.code(400).send({ error:'userAccountId required' });
    const system = SYSTEM_PROMPT(inputs?.client_prompt || '');
    const plan = USE_LLM ? await llmPlan(system, { goal, inputs }) : { planNote:'LLM disabled', actions: [] };
    const actions = validateAndNormalizeActions(plan.actions);
    return reply.send({ planNote: plan.planNote, actions, dispatched:false });
  } catch (err) {
    request.log.error(err);

    // Логируем в централизованную систему ошибок
    const { userAccountId } = request.body || {};
    logErrorToAdmin({
      user_account_id: userAccountId,
      error_type: 'api',
      raw_error: String(err?.message || err),
      stack_trace: err?.stack,
      action: 'brain_decide',
      endpoint: '/api/brain/decide',
      severity: 'warning'
    }).catch(() => {});

    return reply.code(500).send({ error:'brain_decide_failed', details:String(err?.message || err) });
  }
});

// ========================================
// CRON: Ежедневный запуск для всех активных пользователей
// ========================================

/**
 * Получить всех активных пользователей из Supabase
 *
 * ВАЖНО: Для мультиаккаунтного режима НЕ проверяем user_accounts.autopilot!
 * Вместо этого проверка autopilot происходит в processDailyBatch по ad_accounts.autopilot
 *
 * - Legacy пользователи: multi_account_enabled = false/null, autopilot = true
 * - Мультиаккаунтные: multi_account_enabled = true (autopilot проверяется в processDailyBatch)
 */
async function getActiveUsers() {
  try {
    // 1. Legacy пользователи (multi_account_enabled = false/null)
    // Включаем всех активных — autopilot определяет режим (dispatch или report)
    const legacyUsers = await supabaseQuery('user_accounts_legacy',
      async () => await supabase
        .from('user_accounts')
        .select('id, username, telegram_id, telegram_id_2, telegram_id_3, telegram_id_4, telegram_bot_token, account_timezone, multi_account_enabled, ad_account_id, autopilot, autopilot_tiktok, tiktok_access_token, tiktok_business_id, tiktok_account_id')
        .eq('is_active', true)
        .eq('optimization', 'agent2')
        .or('multi_account_enabled.eq.false,multi_account_enabled.is.null'),
      { where: 'getActiveUsers_legacy' }
    );

    // Multi-account пользователи обрабатываются ТОЛЬКО через schedule batch (getAccountsForCurrentHour)
    // Legacy batch — только для пользователей без multi_account_enabled
    const allUsers = legacyUsers || [];

    fastify.log.info({
      where: 'getActiveUsers',
      legacyCount: legacyUsers?.length || 0,
      totalCount: allUsers.length,
      filter: 'legacy only: multi_account_enabled=false/null (multi-account → schedule batch)'
    });

    return allUsers;
  } catch (err) {
    fastify.log.error({ where: 'getActiveUsers', err: String(err) });
    return [];
  }
}

/**
 * Получить всех активных пользователей с TikTok (legacy)
 */
async function getActiveUsersTikTok() {
  try {
    const legacyUsers = await supabaseQuery('user_accounts_tiktok',
      async () => await supabase
        .from('user_accounts')
        .select('id, username, telegram_id, telegram_id_2, telegram_id_3, telegram_id_4, telegram_bot_token, account_timezone, multi_account_enabled, autopilot_tiktok, tiktok_access_token, tiktok_business_id, tiktok_account_id')
        .eq('is_active', true)
        .eq('optimization', 'agent2')
        .or('multi_account_enabled.eq.false,multi_account_enabled.is.null')
        .not('tiktok_access_token', 'is', null)
        .not('tiktok_business_id', 'is', null),
      { where: 'getActiveUsersTikTok_legacy' }
    );

    return legacyUsers || [];
  } catch (err) {
    fastify.log.error({ where: 'getActiveUsersTikTok', err: String(err) });
    return [];
  }
}

/**
 * Отправить отчет в Telegram
 */
async function sendTelegramReport(telegramId, botToken, reportText) {
  if (!telegramId || !botToken || !reportText) {
    fastify.log.warn('Missing telegram params, skipping report');
    return { success: false, reason: 'missing_params' };
  }
  
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramId,
        text: reportText,
        parse_mode: 'Markdown'
      })
    });
    
    const result = await response.json();
    
    if (!response.ok || !result.ok) {
      fastify.log.error({ where: 'sendTelegramReport', status: response.status, result });
      return { success: false, reason: 'telegram_api_error', details: result };
    }
    
    return { success: true };
  } catch (err) {
    fastify.log.error({ where: 'sendTelegramReport', err: String(err) });
    return { success: false, reason: 'exception', error: String(err) };
  }
}

/**
 * Обработать одного пользователя: собрать данные, выполнить действия, отправить отчет
 * Для мультиаккаунтного режима user.accountId содержит UUID из ad_accounts.id
 */
async function processUser(user) {
  const startTime = Date.now();
  const accountId = user.accountId || null;  // UUID из ad_accounts.id или null для legacy

  // Определяем режим: autopilot=true → dispatch, иначе → только отчёт
  // Для multi-account режим определяется в processAccountBrain по brain_mode
  const isAutopilot = user.autopilot !== false;
  const inputs = isAutopilot
    ? { dispatch: true }
    : { dispatch: false, sendReport: true };

  fastify.log.info({
    where: 'processUser',
    userId: user.id,
    username: user.username,
    accountId: accountId || 'legacy',
    accountName: user.accountName || null,
    mode: isAutopilot ? 'autopilot' : 'report',
    status: 'started'
  });

  try {
    // Вызываем основной эндпоинт /api/brain/run
    // Передаём accountId для мультиаккаунтного режима
    const response = await fetch('http://localhost:7080/api/brain/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userAccountId: user.id,
        accountId: accountId,  // UUID из ad_accounts.id для мультиаккаунтности
        inputs
      })
    });

    if (!response.ok) {
      throw new Error(`Brain run failed: ${response.status}`);
    }

    const result = await response.json();

    // Telegram уже отправлен внутри /api/brain/run, не дублируем отправку
    // (telegramSent уже есть в result)

    const duration = Date.now() - startTime;
    fastify.log.info({
      where: 'processUser',
      userId: user.id,
      username: user.username,
      accountId: accountId || 'legacy',
      status: 'completed',
      duration,
      actionsCount: result.actions?.length || 0,
      dispatched: result.dispatched,
      telegramSent: result.telegramSent || false
    });

    return {
      userId: user.id,
      username: user.username,
      accountId: accountId,
      success: true,
      actionsCount: result.actions?.length || 0,
      telegramSent: result.telegramSent || false,
      duration
    };
  } catch (err) {
    const duration = Date.now() - startTime;
    fastify.log.error({
      where: 'processUser',
      userId: user.id,
      username: user.username,
      accountId: accountId || 'legacy',
      status: 'failed',
      duration,
      error: String(err?.message || err)
    });

    return {
      userId: user.id,
      username: user.username,
      accountId: accountId,
      success: false,
      error: String(err?.message || err),
      duration
    };
  }
}

/**
 * Обработать одного пользователя TikTok (legacy)
 */
async function processUserTikTok(user) {
  const startTime = Date.now();
  const accountId = user.accountId || null;
  const isAutopilot = user.autopilot_tiktok === true;
  const inputs = isAutopilot
    ? { dispatch: true }
    : { dispatch: false, sendReport: true };

  fastify.log.info({
    where: 'processUserTikTok',
    userId: user.id,
    username: user.username,
    accountId: accountId || 'legacy',
    mode: isAutopilot ? 'autopilot' : 'report',
    status: 'started'
  });

  try {
    const response = await fetch('http://localhost:7080/api/brain/run-tiktok', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userAccountId: user.id,
        accountId: accountId,
        inputs
      })
    });

    if (!response.ok) {
      throw new Error(`TikTok brain run failed: ${response.status}`);
    }

    const result = await response.json();

    // Собираем TikTok метрики за последние 7 дней
    let metricsResult = null;
    if (user.tiktok_business_id && user.tiktok_access_token) {
      try {
        fastify.log.info({
          where: 'processUserTikTok',
          userId: user.id,
          accountId: accountId || 'legacy',
          action: 'collecting_metrics'
        }, 'Starting TikTok metrics collection');

        metricsResult = await collectTikTokMetricsForDays(
          user.tiktok_business_id,  // advertiserId
          user.tiktok_access_token, // accessToken
          user.id,                   // userAccountId
          accountId,                 // accountId (UUID or null)
          7                          // days
        );

        fastify.log.info({
          where: 'processUserTikTok',
          userId: user.id,
          accountId: accountId || 'legacy',
          metricsCollected: metricsResult.totalMetrics,
          errorsCount: metricsResult.errors?.length || 0,
          action: 'metrics_collected'
        }, 'TikTok metrics collection completed');
      } catch (metricsErr) {
        fastify.log.warn({
          where: 'processUserTikTok',
          userId: user.id,
          accountId: accountId || 'legacy',
          error: metricsErr.message,
          action: 'metrics_collection_failed'
        }, 'Failed to collect TikTok metrics, continuing...');
      }
    }

    const duration = Date.now() - startTime;

    fastify.log.info({
      where: 'processUserTikTok',
      userId: user.id,
      username: user.username,
      accountId: accountId || 'legacy',
      status: 'completed',
      duration,
      actionsCount: result.actions?.length || 0,
      dispatched: result.dispatched,
      telegramSent: result.telegramSent || false,
      metricsCollected: metricsResult?.totalMetrics || 0
    });

    return {
      userId: user.id,
      username: user.username,
      accountId: accountId,
      success: true,
      actionsCount: result.actions?.length || 0,
      telegramSent: result.telegramSent || false,
      metricsCollected: metricsResult?.totalMetrics || 0,
      duration
    };
  } catch (err) {
    const duration = Date.now() - startTime;
    fastify.log.error({
      where: 'processUserTikTok',
      userId: user.id,
      username: user.username,
      accountId: accountId || 'legacy',
      status: 'failed',
      duration,
      error: String(err?.message || err)
    });

    return {
      userId: user.id,
      username: user.username,
      accountId: accountId,
      success: false,
      error: String(err?.message || err),
      duration
    };
  }
}

// ============================================================================
// HOURLY SCHEDULED BATCH FUNCTIONS (для индивидуального расписания аккаунтов)
// ============================================================================

/**
 * Конвертирует UTC час в локальный час для указанного часового пояса
 */
function getLocalHour(utcHour, timezone) {
  try {
    const date = new Date();
    date.setUTCHours(utcHour, 0, 0, 0);

    const formatter = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: timezone
    });

    return parseInt(formatter.format(date), 10);
  } catch (err) {
    // Если timezone невалидный, используем UTC
    fastify.log.warn({
      where: 'getLocalHour',
      timezone,
      error: String(err),
      fallback: 'UTC'
    });
    return utcHour;
  }
}

/**
 * Получить аккаунты, для которых сейчас время запуска
 * Включает все активные аккаунты — brain_mode определяет поведение:
 * - autopilot: выполнение proposals
 * - semi_auto: сохранение proposals на одобрение
 * - report/manual/disabled/null: только отчёт без действий
 */
async function getAccountsForCurrentHour(utcHour) {
  const startTime = Date.now();

  fastify.log.info({
    where: 'getAccountsForCurrentHour',
    utcHour,
    status: 'started',
    description: 'Получение аккаунтов для текущего часа по расписанию'
  });

  if (!supabase) {
    fastify.log.warn({
      where: 'getAccountsForCurrentHour',
      utcHour,
      message: 'Supabase не инициализирован'
    });
    return [];
  }

  // Получаем все активные аккаунты — brain_mode определяет режим обработки
  const { data: accounts, error } = await supabase
    .from('ad_accounts')
    .select(`
      id, user_account_id, name, ad_account_id, page_id, access_token,
      brain_mode, brain_schedule_hour, brain_timezone, autopilot,
      telegram_id, telegram_id_2, telegram_id_3, telegram_id_4,
      default_cpl_target_cents, plan_daily_budget_cents,
      last_brain_batch_run_at,
      prompt3, whatsapp_phone_number, ig_seed_audience_id,
      user_accounts!inner(
        id, username, access_token, multi_account_enabled, optimization, is_active
      )
    `)
    .eq('is_active', true);

  if (error) {
    fastify.log.error({
      where: 'getAccountsForCurrentHour',
      error: error?.message || JSON.stringify(error),
      code: error?.code,
      details: error?.details,
      hint: error?.hint
    });
    return [];
  }

  if (!accounts || accounts.length === 0) {
    return [];
  }

  const now = new Date();
  const fiftyMinutesAgo = new Date(now.getTime() - 50 * 60 * 1000);

  // Фильтруем по расписанию и дедупликации
  const accountsToProcess = accounts.filter(acc => {
    const timezone = acc.brain_timezone || 'Asia/Almaty';
    const scheduleHour = acc.brain_schedule_hour ?? 8;

    // Конвертируем UTC час в локальный час аккаунта
    const localHour = getLocalHour(utcHour, timezone);

    // Проверяем совпадение часа
    if (localHour !== scheduleHour) {
      return false;
    }

    // Дедупликация: не обрабатывать если уже обработан за последние 50 минут
    if (acc.last_brain_batch_run_at) {
      const lastRun = new Date(acc.last_brain_batch_run_at);
      if (lastRun > fiftyMinutesAgo) {
        fastify.log.debug({
          where: 'getAccountsForCurrentHour',
          accountId: acc.id,
          accountName: acc.name,
          lastRun: acc.last_brain_batch_run_at,
          skip: 'already_processed_recently'
        });
        return false;
      }
    }

    return true;
  });

  // Группируем по brain_mode для статистики
  const modeStats = accountsToProcess.reduce((acc, a) => {
    const mode = a.brain_mode || 'report';
    acc[mode] = (acc[mode] || 0) + 1;
    return acc;
  }, {});

  const duration = Date.now() - startTime;
  fastify.log.info({
    where: 'getAccountsForCurrentHour',
    utcHour,
    totalActive: accounts.length,
    toProcess: accountsToProcess.length,
    byMode: modeStats,
    accountNames: accountsToProcess.map(a => `${a.name} (${a.brain_mode || 'report'})`),
    duration,
    status: 'completed'
  });

  return accountsToProcess;
}

/**
 * Получить TikTok аккаунты для текущего часа (без дедупликации last_brain_batch_run_at)
 */
async function getTikTokAccountsForCurrentHour(utcHour) {
  const startTime = Date.now();

  fastify.log.info({
    where: 'getTikTokAccountsForCurrentHour',
    utcHour,
    status: 'started'
  });

  if (!supabase) {
    fastify.log.warn({
      where: 'getTikTokAccountsForCurrentHour',
      utcHour,
      message: 'Supabase не инициализирован'
    });
    return [];
  }

  const { data: accounts, error } = await supabase
    .from('ad_accounts')
    .select(`
      id, user_account_id, name, tiktok_access_token, tiktok_business_id, tiktok_account_id,
      autopilot_tiktok, brain_schedule_hour, brain_timezone,
      telegram_id, telegram_id_2, telegram_id_3, telegram_id_4,
      user_accounts!inner(
        id, username, multi_account_enabled, optimization, is_active
      )
    `)
    .eq('is_active', true)
    .not('tiktok_access_token', 'is', null)
    .not('tiktok_business_id', 'is', null);

  if (error) {
    fastify.log.error({
      where: 'getTikTokAccountsForCurrentHour',
      error: error?.message || JSON.stringify(error),
      code: error?.code,
      details: error?.details,
      hint: error?.hint
    });
    return [];
  }

  if (!accounts || accounts.length === 0) {
    return [];
  }

  const accountsToProcess = accounts.filter(acc => {
    const timezone = acc.brain_timezone || 'Asia/Almaty';
    const scheduleHour = acc.brain_schedule_hour ?? 8;
    const localHour = getLocalHour(utcHour, timezone);
    return localHour === scheduleHour;
  });

  const modeStats = accountsToProcess.reduce((acc, a) => {
    const mode = a.autopilot_tiktok === true ? 'autopilot' : 'report';
    acc[mode] = (acc[mode] || 0) + 1;
    return acc;
  }, {});

  const duration = Date.now() - startTime;
  fastify.log.info({
    where: 'getTikTokAccountsForCurrentHour',
    utcHour,
    totalActive: accounts.length,
    toProcess: accountsToProcess.length,
    byMode: modeStats,
    accountNames: accountsToProcess.map(a => `${a.name} (${a.autopilot_tiktok ? 'autopilot' : 'report'})`),
    duration,
    status: 'completed'
  });

  return accountsToProcess;
}

/**
 * Сохранить proposals в pending_brain_proposals и создать уведомление
 */
async function savePendingProposals(brainResult, account) {
  if (!supabase) return;

  const { proposals, summary, adset_analysis } = brainResult;

  if (!proposals || proposals.length === 0) {
    fastify.log.info({
      where: 'savePendingProposals',
      accountId: account.id,
      accountName: account.name,
      message: 'Нет proposals для сохранения'
    });
    return;
  }

  try {
    // 1. Помечаем старые pending как expired
    await supabase
      .from('pending_brain_proposals')
      .update({ status: 'expired' })
      .eq('ad_account_id', account.id)
      .eq('status', 'pending');

    // 2. Сначала сохраняем proposals (чтобы получить ID для уведомления)
    const criticalCount = proposals.filter(p => p.priority === 'critical').length;

    const { data: savedProposal, error: proposalError } = await supabase
      .from('pending_brain_proposals')
      .insert({
        ad_account_id: account.id,
        user_account_id: account.user_account_id,
        proposals: proposals,
        context: {
          summary: summary,
          adset_analysis: adset_analysis
        },
        proposals_count: proposals.length,
        status: 'pending'
      })
      .select('id')
      .single();

    if (proposalError) {
      fastify.log.error({
        where: 'savePendingProposals',
        phase: 'save_proposals',
        accountId: account.id,
        error: String(proposalError)
      });
      return;
    }

    // 3. Создаём уведомление с proposal_id в metadata
    const notificationTitle = criticalCount > 0
      ? `${proposals.length} предложений (${criticalCount} критических)`
      : `${proposals.length} предложений по оптимизации`;

    const { data: notification, error: notifError } = await supabase
      .from('user_notifications')
      .insert({
        user_account_id: account.user_account_id,
        type: 'brain_proposals',
        title: notificationTitle,
        message: `Brain проанализировал "${account.name}" и подготовил рекомендации`,
        metadata: {
          ad_account_id: account.id,
          ad_account_name: account.name,
          proposals_count: proposals.length,
          critical_count: criticalCount,
          high_count: proposals.filter(p => p.priority === 'high').length,
          summary: summary,
          proposal_id: savedProposal.id
        }
      })
      .select('id')
      .single();

    if (notifError) {
      fastify.log.error({
        where: 'savePendingProposals',
        phase: 'create_notification',
        accountId: account.id,
        error: String(notifError)
      });
    }

    // 4. Обновляем proposal с notification_id
    if (notification?.id) {
      await supabase
        .from('pending_brain_proposals')
        .update({ notification_id: notification.id })
        .eq('id', savedProposal.id);
    }

    fastify.log.info({
      where: 'savePendingProposals',
      accountId: account.id,
      accountName: account.name,
      proposalsCount: proposals.length,
      criticalCount,
      proposalId: savedProposal.id,
      notificationId: notification?.id,
      status: 'saved'
    });

  } catch (err) {
    fastify.log.error({
      where: 'savePendingProposals',
      accountId: account.id,
      error: String(err)
    });
  }
}

/**
 * Отправить только отчёт Brain без сохранения proposals (режим report)
 * Используется для аккаунтов с brain_mode = report/manual/disabled/null
 * @returns {Object} { success: boolean, sentCount: number, totalRecipients: number }
 */
async function sendBrainReportOnly(brainResult, account) {
  const startTime = Date.now();
  const { summary, llm, proposals } = brainResult;

  fastify.log.info({
    where: 'sendBrainReportOnly',
    accountId: account.id,
    accountName: account.name,
    brain_mode: account.brain_mode || 'report',
    proposalsCount: proposals?.length || 0,
    status: 'started'
  });

  try {
    // Формируем текст отчёта с деталями proposals
    const proposalsSummary = proposals && proposals.length > 0
      ? proposals.slice(0, 5).map((p, i) => `${i + 1}. ${p.type || p.action}: ${p.description || p.reason || '-'}`).join('\n')
      : 'Нет предложений';

    const reportLines = [
      `📊 *Отчёт Brain: ${account.name}*`,
      '',
      llm?.summary || 'Анализ завершён.',
      '',
      `📋 *Найдено предложений: ${proposals?.length || 0}*`,
      proposals?.length > 0 ? proposalsSummary : '',
      proposals?.length > 5 ? `_...и ещё ${proposals.length - 5}_` : '',
      '',
      '_Режим: только отчёт (действия не выполняются)_'
    ].filter(line => line !== '');

    const reportText = reportLines.join('\n');

    // Отправляем в Telegram
    const telegramIds = [
      account.telegram_id,
      account.telegram_id_2,
      account.telegram_id_3,
      account.telegram_id_4
    ].filter(Boolean);

    if (telegramIds.length === 0) {
      const duration = Date.now() - startTime;
      fastify.log.warn({
        where: 'sendBrainReportOnly',
        accountId: account.id,
        accountName: account.name,
        duration,
        message: 'Нет telegram_id для отправки отчёта'
      });
      return { success: false, sentCount: 0, totalRecipients: 0, reason: 'no_telegram_ids' };
    }

    let sentCount = 0;
    const errors = [];
    for (const chatId of telegramIds) {
      try {
        await sendTelegram(chatId, reportText, TELEGRAM_BOT_TOKEN);
        sentCount++;
      } catch (err) {
        errors.push({ chatId, error: String(err) });
        fastify.log.error({
          where: 'sendBrainReportOnly',
          accountId: account.id,
          accountName: account.name,
          chatId,
          error: String(err)
        });
      }
    }

    const duration = Date.now() - startTime;
    fastify.log.info({
      where: 'sendBrainReportOnly',
      accountId: account.id,
      accountName: account.name,
      brain_mode: account.brain_mode || 'report',
      proposalsCount: proposals?.length || 0,
      telegramSent: sentCount,
      telegramTotal: telegramIds.length,
      duration,
      status: 'completed'
    });

    // Сохраняем в brain_executions для истории (fallback режимы report/autopilot)
    if (supabase) {
      const proposalsCount = proposals?.length || 0;
      const idemKey = genIdem();

      fastify.log.info({
        where: 'sendBrainReportOnly',
        phase: 'save_brain_execution_start',
        accountId: account.id,
        accountName: account.name,
        user_account_id: account.user_account_id,
        brain_mode: account.brain_mode || 'report',
        proposalsCount,
        telegramSentCount: sentCount,
        idempotency_key: idemKey
      });

      try {
        const { data: insertedExec, error: insertErr } = await supabase
          .from('brain_executions')
          .insert({
            user_account_id: account.user_account_id,
            account_id: account.id,
            idempotency_key: idemKey,
            execution_mode: 'batch',
            platform: 'facebook',
            plan_json: {
              mode: 'report_only',
              brain_mode: account.brain_mode || 'report',
              proposals_count: proposalsCount,
              fallback: true,
              account_name: account.name,
              telegram_sent: sentCount
            },
            actions_json: [],  // Режим report - действия не выполняются
            report_text: reportText,
            status: 'success',
            duration_ms: duration
          })
          .select('id')
          .single();

        if (insertErr) {
          throw insertErr;
        }

        fastify.log.info({
          where: 'sendBrainReportOnly',
          phase: 'save_brain_execution_success',
          accountId: account.id,
          accountName: account.name,
          brainExecutionId: insertedExec?.id,
          proposalsCount,
          duration
        });
      } catch (saveErr) {
        fastify.log.error({
          where: 'sendBrainReportOnly',
          phase: 'save_brain_execution_failed',
          accountId: account.id,
          accountName: account.name,
          error: String(saveErr),
          stack: saveErr?.stack?.slice(0, 300)
        });
      }
    } else {
      fastify.log.warn({
        where: 'sendBrainReportOnly',
        phase: 'save_brain_execution_skipped',
        accountId: account.id,
        reason: 'supabase not available'
      });
    }

    return { success: sentCount > 0, sentCount, totalRecipients: telegramIds.length };

  } catch (err) {
    const duration = Date.now() - startTime;
    fastify.log.error({
      where: 'sendBrainReportOnly',
      accountId: account.id,
      accountName: account.name,
      duration,
      error: String(err),
      status: 'failed'
    });
    return { success: false, sentCount: 0, totalRecipients: 0, error: String(err) };
  }
}

/**
 * Формирует userAccountForBrain со ВСЕМИ необходимыми полями
 */
function buildUserAccountForBrain(account, userAccount) {
  return {
    id: account.user_account_id,
    ad_account_id: account.ad_account_id,
    access_token: account.access_token || userAccount.access_token,  // FALLBACK!
    page_id: account.page_id,
    account_uuid: account.id,
    username: userAccount.username,
    telegram_id: account.telegram_id,
    telegram_id_2: account.telegram_id_2,
    telegram_id_3: account.telegram_id_3,
    telegram_id_4: account.telegram_id_4,
    default_cpl_target_cents: account.default_cpl_target_cents,
    plan_daily_budget_cents: account.plan_daily_budget_cents,
    prompt3: account.prompt3,
    whatsapp_phone_number: account.whatsapp_phone_number,
    ig_seed_audience_id: account.ig_seed_audience_id,
    multi_account_enabled: userAccount.multi_account_enabled
  };
}

/**
 * Сохраняет метрики в creative_metrics_history только если ещё не сохраняли сегодня
 * Загружает креативы самостоятельно через getActiveCreatives()
 * @returns {Object} { saved: boolean, creativesCount: number, error?: string }
 */
async function saveMetricsIfNotSavedToday(userAccountId, accountId, adAccountId, accessToken) {
  const startTime = Date.now();

  fastify.log.info({
    where: 'saveMetricsIfNotSavedToday',
    phase: 'started',
    userAccountId,
    accountId,
    adAccountId,
    hasAccessToken: !!accessToken
  });

  try {
    // Проверяем, сохраняем метрики за ВЧЕРА (как в runScoringAgent)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    // Проверяем, есть ли уже записи за вчера для этого аккаунта
    // Для legacy аккаунтов accountId = null, используем .is() вместо .eq()
    let checkQuery = supabase
      .from('creative_metrics_history')
      .select('id')
      .eq('date', yesterdayStr);

    if (accountId) {
      checkQuery = checkQuery.eq('account_id', accountId);
    } else {
      checkQuery = checkQuery.is('account_id', null);
    }

    const { data: existingMetrics, error: checkError } = await checkQuery.limit(1);

    if (checkError) {
      fastify.log.warn({
        where: 'saveMetricsIfNotSavedToday',
        phase: 'check_existing_failed',
        accountId,
        date: yesterdayStr,
        error: String(checkError),
        duration: Date.now() - startTime
      });
      return { saved: false, creativesCount: 0, error: 'check_existing_failed' };
    }

    if (existingMetrics && existingMetrics.length > 0) {
      fastify.log.info({
        where: 'saveMetricsIfNotSavedToday',
        phase: 'skipped_already_exists',
        accountId,
        date: yesterdayStr,
        existingRecords: existingMetrics.length,
        duration: Date.now() - startTime
      });
      return { saved: false, creativesCount: 0, reason: 'already_saved' };
    }

    // Загружаем активные креативы пользователя
    const { getActiveCreatives, saveCreativeMetricsToHistory } = await import('./scoring.js');
    const userCreatives = await getActiveCreatives(supabase, userAccountId, accountId);

    if (!userCreatives || userCreatives.length === 0) {
      fastify.log.info({
        where: 'saveMetricsIfNotSavedToday',
        phase: 'skipped_no_creatives',
        accountId,
        date: yesterdayStr,
        duration: Date.now() - startTime
      });
      return { saved: false, creativesCount: 0, reason: 'no_creatives' };
    }

    // Преобразуем в формат для saveCreativeMetricsToHistory
    const readyCreatives = userCreatives.map(uc => ({
      user_creative_id: uc.id
    }));

    fastify.log.info({
      where: 'saveMetricsIfNotSavedToday',
      phase: 'saving_metrics',
      accountId,
      date: yesterdayStr,
      creativesCount: readyCreatives.length,
      creativeIds: readyCreatives.slice(0, 5).map(c => c.user_creative_id)
    });

    // Сохраняем метрики
    await saveCreativeMetricsToHistory(
      supabase,
      userAccountId,
      readyCreatives,
      adAccountId,
      accessToken,
      accountId
    );

    fastify.log.info({
      where: 'saveMetricsIfNotSavedToday',
      phase: 'completed',
      accountId,
      date: yesterdayStr,
      creativesCount: readyCreatives.length,
      duration: Date.now() - startTime
    });

    return { saved: true, creativesCount: readyCreatives.length };

  } catch (err) {
    fastify.log.error({
      where: 'saveMetricsIfNotSavedToday',
      phase: 'error',
      accountId,
      error: String(err),
      stack: err.stack?.slice(0, 500),
      duration: Date.now() - startTime
    });
    return { saved: false, creativesCount: 0, error: String(err) };
  }
}

/**
 * Восстанавливает метрики за диапазон дат (для исторических данных)
 * @param {string} userAccountId - User account ID
 * @param {string} accountId - Account UUID (ad_accounts.id)
 * @param {string} adAccountId - Facebook ad account ID
 * @param {string} accessToken - Facebook access token
 * @param {string} dateFrom - Start date (YYYY-MM-DD)
 * @param {string} dateTo - End date (YYYY-MM-DD)
 * @returns {Object} { success: boolean, datesProcessed: number, totalCreatives: number, errors: string[] }
 */
async function restoreMetricsForDateRange(userAccountId, accountId, adAccountId, accessToken, dateFrom, dateTo) {
  const startTime = Date.now();

  fastify.log.info({
    where: 'restoreMetricsForDateRange',
    userAccountId,
    accountId,
    dateFrom,
    dateTo,
    status: 'started'
  });

  const results = [];
  const errors = [];

  // Генерируем список дат
  const dates = [];
  const currentDate = new Date(dateFrom);
  const endDate = new Date(dateTo);

  while (currentDate <= endDate) {
    dates.push(currentDate.toISOString().split('T')[0]);
    currentDate.setDate(currentDate.getDate() + 1);
  }

  fastify.log.info({
    where: 'restoreMetricsForDateRange',
    totalDates: dates.length,
    dates: dates
  });

  // Загружаем креативы один раз
  const { getActiveCreatives, saveCreativeMetricsToHistory } = await import('./scoring.js');
  const readyCreatives = await getActiveCreatives(supabase, userAccountId, accountId);

  if (!readyCreatives || readyCreatives.length === 0) {
    fastify.log.warn({
      where: 'restoreMetricsForDateRange',
      message: 'No active creatives found'
    });
    return { success: false, error: 'no_creatives', datesProcessed: 0, totalCreatives: 0 };
  }

  fastify.log.info({
    where: 'restoreMetricsForDateRange',
    creativesCount: readyCreatives.length
  });

  // Обрабатываем каждую дату
  for (const date of dates) {
    try {
      fastify.log.info({
        where: 'restoreMetricsForDateRange',
        date,
        status: 'processing'
      });

      // Проверяем, есть ли уже метрики за эту дату
      // Для legacy аккаунтов accountId = null, используем .is() вместо .eq()
      let existingQuery = supabase
        .from('creative_metrics_history')
        .select('id')
        .eq('date', date);

      if (accountId) {
        existingQuery = existingQuery.eq('account_id', accountId);
      } else {
        existingQuery = existingQuery.is('account_id', null);
      }

      const { data: existing } = await existingQuery.limit(1);

      if (existing && existing.length > 0) {
        fastify.log.info({
          where: 'restoreMetricsForDateRange',
          date,
          status: 'skipped_already_exists'
        });
        results.push({ date, status: 'skipped', reason: 'already_exists' });
        continue;
      }

      // Сохраняем метрики за эту дату
      await saveCreativeMetricsToHistory(
        supabase,
        userAccountId,
        readyCreatives,
        adAccountId,
        accessToken,
        accountId,
        date  // Передаём конкретную дату
      );

      fastify.log.info({
        where: 'restoreMetricsForDateRange',
        date,
        status: 'saved'
      });

      results.push({ date, status: 'saved' });

      // Небольшая пауза между датами чтобы не перегружать FB API
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (err) {
      fastify.log.error({
        where: 'restoreMetricsForDateRange',
        date,
        error: String(err)
      });
      errors.push({ date, error: String(err) });
      results.push({ date, status: 'error', error: String(err) });
    }
  }

  const duration = Date.now() - startTime;

  fastify.log.info({
    where: 'restoreMetricsForDateRange',
    status: 'completed',
    datesProcessed: results.filter(r => r.status === 'saved').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    errorsCount: errors.length,
    totalCreatives: readyCreatives.length,
    duration
  });

  return {
    success: errors.length === 0,
    datesProcessed: results.filter(r => r.status === 'saved').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    totalCreatives: readyCreatives.length,
    totalDates: dates.length,
    results,
    errors,
    duration
  };
}

/**
 * Отправляет краткое Telegram уведомление о новых proposals для semi_auto режима
 * @returns {Object} { sent: number, total: number, errors: string[] }
 */
async function sendSemiAutoTelegramNotification(brainResult, account) {
  const startTime = Date.now();
  const { proposals, summary } = brainResult;

  fastify.log.info({
    where: 'sendSemiAutoTelegramNotification',
    phase: 'started',
    accountId: account.id,
    accountName: account.name,
    proposalsCount: proposals?.length || 0
  });

  if (!proposals || proposals.length === 0) {
    fastify.log.info({
      where: 'sendSemiAutoTelegramNotification',
      phase: 'skipped_no_proposals',
      accountId: account.id,
      duration: Date.now() - startTime
    });
    return { sent: 0, total: 0, reason: 'no_proposals' };
  }

  const criticalCount = proposals.filter(p => p.priority === 'critical').length;
  const highCount = proposals.filter(p => p.priority === 'high').length;

  let priorityText = '';
  if (criticalCount > 0) priorityText = ` (${criticalCount} критических!)`;
  else if (highCount > 0) priorityText = ` (${highCount} важных)`;

  const llmSummary = summary?.llm_used && summary?.llm_summary
    ? `\n💡 ${summary.llm_summary.slice(0, 200)}${summary.llm_summary.length > 200 ? '...' : ''}`
    : '';

  const reportText = `🔔 *Brain: ${account.name}*

📋 Подготовлено *${proposals.length}* предложений${priorityText}
${llmSummary}

👉 Откройте приложение для просмотра и одобрения.

_Режим: полуавтоматический_`;

  // Отправляем на все Telegram ID
  const telegramIds = [
    account.telegram_id,
    account.telegram_id_2,
    account.telegram_id_3,
    account.telegram_id_4
  ].filter(Boolean);

  if (telegramIds.length === 0) {
    fastify.log.warn({
      where: 'sendSemiAutoTelegramNotification',
      phase: 'skipped_no_telegram_ids',
      accountId: account.id,
      accountName: account.name,
      proposalsCount: proposals.length,
      duration: Date.now() - startTime
    });
    return { sent: 0, total: 0, reason: 'no_telegram_ids' };
  }

  let sentCount = 0;
  const errors = [];

  for (const chatId of telegramIds) {
    try {
      await sendTelegram(chatId, reportText, TELEGRAM_BOT_TOKEN);
      sentCount++;
    } catch (err) {
      errors.push({ chatId, error: String(err) });
      fastify.log.warn({
        where: 'sendSemiAutoTelegramNotification',
        phase: 'send_failed',
        accountId: account.id,
        chatId,
        error: String(err)
      });
    }
  }

  fastify.log.info({
    where: 'sendSemiAutoTelegramNotification',
    phase: 'completed',
    accountId: account.id,
    accountName: account.name,
    proposalsCount: proposals.length,
    criticalCount,
    highCount,
    telegramsSent: sentCount,
    telegramsTotal: telegramIds.length,
    errorsCount: errors.length,
    duration: Date.now() - startTime
  });

  return { sent: sentCount, total: telegramIds.length, errors: errors.map(e => e.error) };
}

/**
 * Обработать один аккаунт по расписанию
 *
 * Логика режимов:
 * - autopilot: Основной Brain (/api/brain/run dispatch=true) → метрики сохраняются автоматически
 * - semi_auto: Brain Mini → сохранение метрик + proposals + Telegram уведомление
 * - report: Основной Brain (/api/brain/run dispatch=false) → только отчёт
 *
 * @returns {Object} { success, accountId, brain_mode, duration, proposalsCount?, error?, details? }
 */
async function processAccountBrain(account) {
  const { brain_mode, id: accountId, name: accountName, user_account_id } = account;
  const userAccount = account.user_accounts;
  const startTime = Date.now();
  const details = {}; // Собираем детали для финального лога

  fastify.log.info({
    where: 'processAccountBrain',
    phase: 'started',
    accountId,
    accountName,
    brain_mode,
    user_account_id,
    ad_account_id: account.ad_account_id
  });

  try {
    if (brain_mode === 'autopilot') {
      // ========================================
      // AUTOPILOT: Основной Brain + выполнение proposals
      // ========================================
      fastify.log.info({
        where: 'processAccountBrain',
        phase: 'autopilot_calling_api',
        accountId,
        endpoint: '/api/brain/run',
        dispatch: true
      });

      try {
        const runResponse = await fetch('http://localhost:7080/api/brain/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userAccountId: user_account_id,
            accountId: accountId,
            inputs: { dispatch: true }
          })
        });

        // Проверяем HTTP статус
        if (!runResponse.ok) {
          const errorText = await runResponse.text();
          throw new Error(`HTTP ${runResponse.status}: ${errorText.slice(0, 200)}`);
        }

        const runResult = await runResponse.json();

        details.apiSuccess = true;
        details.actionsExecuted = runResult.actions?.length || 0;
        details.dispatched = runResult.dispatched;
        details.telegramSent = runResult.telegramSent;
        details.proposalsCount = runResult.proposalsCount || 0;

        fastify.log.info({
          where: 'processAccountBrain',
          phase: 'autopilot_api_success',
          accountId,
          accountName,
          ...details
        });

        // Сохраняем метрики после успешного autopilot
        const metricsResult = await saveMetricsIfNotSavedToday(
          user_account_id,
          accountId,
          account.ad_account_id,
          account.access_token || userAccount.access_token
        );
        details.metricsSaved = metricsResult?.saved || false;

      } catch (apiErr) {
        // FALLBACK: если /api/brain/run упал — переключаемся на Brain Mini
        fastify.log.error({
          where: 'processAccountBrain',
          phase: 'autopilot_api_failed_using_fallback',
          accountId,
          accountName,
          error: String(apiErr),
          stack: apiErr.stack?.slice(0, 300)
        });

        details.fallbackUsed = true;
        details.apiError = String(apiErr);

        const userAccountForBrain = buildUserAccountForBrain(account, userAccount);
        const { runInteractiveBrain } = await import('./scoring.js');

        fastify.log.info({
          where: 'processAccountBrain',
          phase: 'autopilot_fallback_running_brain_mini',
          accountId
        });

        const result = await runInteractiveBrain(userAccountForBrain, {
          accountUUID: accountId,
          supabase,
          logger: fastify.log
        });

        // Проверяем успех Brain Mini в fallback
        if (!result.success) {
          fastify.log.error({
            where: 'processAccountBrain',
            phase: 'autopilot_fallback_brain_mini_failed',
            accountId,
            error: result.error
          });
          details.brainMiniSuccess = false;
          details.brainMiniError = result.error;
        } else {
          details.brainMiniSuccess = true;
          details.proposalsCount = result.proposals?.length || 0;

          // Сохраняем метрики в fallback режиме
          const metricsResult = await saveMetricsIfNotSavedToday(
            user_account_id,
            accountId,
            account.ad_account_id,
            account.access_token || userAccount.access_token
          );
          details.metricsSaved = metricsResult?.saved || false;

          // Отправляем отчёт
          await sendBrainReportOnly(result, account);
          details.reportSent = true;
        }
      }

    } else if (brain_mode === 'report') {
      // ========================================
      // REPORT: Основной Brain + только отчёт (с fallback)
      // ========================================
      fastify.log.info({
        where: 'processAccountBrain',
        phase: 'report_calling_api',
        accountId,
        endpoint: '/api/brain/run',
        dispatch: false,
        sendReport: true
      });

      try {
        const runResponse = await fetch('http://localhost:7080/api/brain/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userAccountId: user_account_id,
            accountId: accountId,
            inputs: { dispatch: false, sendReport: true }
          })
        });

        // Проверяем HTTP статус
        if (!runResponse.ok) {
          const errorText = await runResponse.text();
          throw new Error(`HTTP ${runResponse.status}: ${errorText.slice(0, 200)}`);
        }

        const runResult = await runResponse.json();

        details.apiSuccess = true;
        details.telegramSent = runResult.telegramSent;
        details.proposalsCount = runResult.proposalsCount || 0;

        fastify.log.info({
          where: 'processAccountBrain',
          phase: 'report_api_success',
          accountId,
          accountName,
          ...details
        });

        // Сохраняем метрики после успешного report
        const metricsResult = await saveMetricsIfNotSavedToday(
          user_account_id,
          accountId,
          account.ad_account_id,
          account.access_token || userAccount.access_token
        );
        details.metricsSaved = metricsResult?.saved || false;

      } catch (apiErr) {
        // FALLBACK: если /api/brain/run упал — используем Brain Mini для отчёта
        fastify.log.error({
          where: 'processAccountBrain',
          phase: 'report_api_failed_using_fallback',
          accountId,
          accountName,
          error: String(apiErr)
        });

        details.fallbackUsed = true;
        details.apiError = String(apiErr);

        const userAccountForBrain = buildUserAccountForBrain(account, userAccount);
        const { runInteractiveBrain } = await import('./scoring.js');

        const result = await runInteractiveBrain(userAccountForBrain, {
          accountUUID: accountId,
          supabase,
          logger: fastify.log
        });

        if (result.success) {
          // Сохраняем метрики
          const metricsResult = await saveMetricsIfNotSavedToday(
            user_account_id,
            accountId,
            account.ad_account_id,
            account.access_token || userAccount.access_token
          );
          details.metricsSaved = metricsResult?.saved || false;

          await sendBrainReportOnly(result, account);
          details.reportSent = true;
          details.proposalsCount = result.proposals?.length || 0;
        } else {
          details.brainMiniSuccess = false;
          details.brainMiniError = result.error;
        }
      }

    } else if (brain_mode === 'semi_auto') {
      // ========================================
      // SEMI_AUTO: Brain Mini + сохранение метрик + proposals
      // ========================================
      fastify.log.info({
        where: 'processAccountBrain',
        phase: 'semi_auto_starting_brain_mini',
        accountId,
        accountName
      });

      const userAccountForBrain = buildUserAccountForBrain(account, userAccount);
      const { runInteractiveBrain } = await import('./scoring.js');

      const result = await runInteractiveBrain(userAccountForBrain, {
        accountUUID: accountId,
        supabase,
        logger: fastify.log
      });

      // Проверяем успех runInteractiveBrain
      if (!result.success) {
        fastify.log.error({
          where: 'processAccountBrain',
          phase: 'semi_auto_brain_mini_failed',
          accountId,
          accountName,
          error: result.error || 'runInteractiveBrain failed',
          duration: Date.now() - startTime
        });
        return {
          success: false,
          accountId,
          brain_mode,
          error: result.error || 'Brain Mini failed',
          duration: Date.now() - startTime
        };
      }

      details.brainMiniSuccess = true;
      details.proposalsCount = result.proposals?.length || 0;
      details.criticalCount = result.proposals?.filter(p => p.priority === 'critical').length || 0;
      details.highCount = result.proposals?.filter(p => p.priority === 'high').length || 0;

      fastify.log.info({
        where: 'processAccountBrain',
        phase: 'semi_auto_brain_mini_success',
        accountId,
        proposalsCount: details.proposalsCount,
        criticalCount: details.criticalCount
      });

      // Шаг 1: Сохраняем метрики (изолировано от ошибок)
      try {
        const metricsResult = await saveMetricsIfNotSavedToday(
          user_account_id,
          accountId,
          account.ad_account_id,
          account.access_token || userAccount.access_token
        );
        details.metricsSaved = metricsResult?.saved || false;
        details.metricsCreativesCount = metricsResult?.creativesCount || 0;
      } catch (metricsErr) {
        fastify.log.error({
          where: 'processAccountBrain',
          phase: 'semi_auto_save_metrics_error',
          accountId,
          error: String(metricsErr)
        });
        details.metricsError = String(metricsErr);
      }

      // Шаг 2: Сохраняем proposals (изолировано от ошибок)
      try {
        await savePendingProposals(result, account);
        details.proposalsSaved = true;
      } catch (proposalsErr) {
        fastify.log.error({
          where: 'processAccountBrain',
          phase: 'semi_auto_save_proposals_error',
          accountId,
          error: String(proposalsErr)
        });
        details.proposalsError = String(proposalsErr);
      }

      // Шаг 2.5: Сохраняем в brain_executions для истории (изолировано от ошибок)
      if (supabase) {
        const proposalsCount = result.proposals?.length || 0;
        const idemKey = genIdem();
        const durationMs = Date.now() - startTime;

        fastify.log.info({
          where: 'processAccountBrain',
          phase: 'save_brain_execution_semi_auto_start',
          accountId,
          accountName,
          user_account_id,
          proposalsCount,
          criticalCount: details.criticalCount || 0,
          highCount: details.highCount || 0,
          idempotency_key: idemKey
        });

        try {
          const { data: insertedExec, error: insertErr } = await supabase
            .from('brain_executions')
            .insert({
              user_account_id: user_account_id,
              account_id: accountId,
              idempotency_key: idemKey,
              execution_mode: 'batch',
              platform: 'facebook',
              plan_json: {
                mode: 'semi_auto',
                brain_mode: 'semi_auto',
                proposals_count: proposalsCount,
                critical_count: details.criticalCount || 0,
                high_count: details.highCount || 0,
                summary: result.summary || null,
                account_name: accountName
              },
              actions_json: result.proposals || [],
              report_text: result.llm?.summary || `Semi-auto: ${proposalsCount} proposals для ${accountName}`,
              status: 'success',
              duration_ms: durationMs
            })
            .select('id')
            .single();

          if (insertErr) {
            throw insertErr;
          }

          details.brainExecutionSaved = true;
          details.brainExecutionId = insertedExec?.id || null;

          fastify.log.info({
            where: 'processAccountBrain',
            phase: 'save_brain_execution_semi_auto_success',
            accountId,
            accountName,
            brainExecutionId: insertedExec?.id,
            proposalsCount,
            durationMs
          });
        } catch (brainExecErr) {
          fastify.log.error({
            where: 'processAccountBrain',
            phase: 'save_brain_execution_semi_auto_failed',
            accountId,
            accountName,
            error: String(brainExecErr),
            stack: brainExecErr?.stack?.slice(0, 300)
          });
          details.brainExecutionSaved = false;
          details.brainExecutionError = String(brainExecErr);
        }
      } else {
        fastify.log.warn({
          where: 'processAccountBrain',
          phase: 'save_brain_execution_semi_auto_skipped',
          accountId,
          reason: 'supabase not available'
        });
      }

      // Шаг 3: Отправляем Telegram (изолировано от ошибок)
      try {
        const telegramResult = await sendSemiAutoTelegramNotification(result, account);
        details.telegramSent = telegramResult?.sent || 0;
        details.telegramTotal = telegramResult?.total || 0;
      } catch (telegramErr) {
        fastify.log.error({
          where: 'processAccountBrain',
          phase: 'semi_auto_telegram_error',
          accountId,
          error: String(telegramErr)
        });
        details.telegramError = String(telegramErr);
      }

    } else {
      // ========================================
      // UNKNOWN MODE: логируем предупреждение
      // ========================================
      fastify.log.warn({
        where: 'processAccountBrain',
        phase: 'unknown_brain_mode',
        accountId,
        accountName,
        brain_mode,
        message: 'Unknown brain_mode, skipping processing'
      });
      details.skipped = true;
      details.reason = 'unknown_brain_mode';
    }

    // ВСЕГДА обновляем timestamp
    await supabase
      .from('ad_accounts')
      .update({ last_brain_batch_run_at: new Date().toISOString() })
      .eq('id', accountId);

    const duration = Date.now() - startTime;

    fastify.log.info({
      where: 'processAccountBrain',
      phase: 'completed',
      accountId,
      accountName,
      brain_mode,
      duration,
      ...details
    });

    return {
      success: true,
      accountId,
      accountName,
      brain_mode,
      duration,
      ...details
    };

  } catch (err) {
    const duration = Date.now() - startTime;
    fastify.log.error({
      where: 'processAccountBrain',
      phase: 'fatal_error',
      accountId,
      accountName,
      brain_mode,
      duration,
      error: String(err),
      stack: err.stack?.slice(0, 500)
    });
    return {
      success: false,
      accountId,
      accountName,
      brain_mode,
      error: String(err),
      duration
    };
  }
}

/**
 * Обработать один аккаунт TikTok по расписанию (multi-account)
 */
async function processAccountTikTok(account) {
  const startTime = Date.now();
  const isAutopilot = account.autopilot_tiktok === true;
  const inputs = isAutopilot
    ? { dispatch: true }
    : { dispatch: false, sendReport: true };

  fastify.log.info({
    where: 'processAccountTikTok',
    phase: 'started',
    accountId: account.id,
    accountName: account.name,
    user_account_id: account.user_account_id,
    mode: isAutopilot ? 'autopilot' : 'report'
  });

  try {
    const runResponse = await fetch('http://localhost:7080/api/brain/run-tiktok', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userAccountId: account.user_account_id,
        accountId: account.id,
        inputs
      })
    });

    if (!runResponse.ok) {
      const errorText = await runResponse.text();
      throw new Error(`HTTP ${runResponse.status}: ${errorText.slice(0, 200)}`);
    }

    const runResult = await runResponse.json();

    // Собираем TikTok метрики за последние 7 дней
    let metricsResult = null;
    if (account.tiktok_business_id && account.tiktok_access_token) {
      try {
        fastify.log.info({
          where: 'processAccountTikTok',
          accountId: account.id,
          action: 'collecting_metrics'
        }, 'Starting TikTok metrics collection');

        metricsResult = await collectTikTokMetricsForDays(
          account.tiktok_business_id,  // advertiserId
          account.tiktok_access_token, // accessToken
          account.user_account_id,     // userAccountId
          account.id,                  // accountId (UUID)
          7                            // days
        );

        fastify.log.info({
          where: 'processAccountTikTok',
          accountId: account.id,
          metricsCollected: metricsResult.totalMetrics,
          errorsCount: metricsResult.errors?.length || 0,
          action: 'metrics_collected'
        }, 'TikTok metrics collection completed');
      } catch (metricsErr) {
        fastify.log.warn({
          where: 'processAccountTikTok',
          accountId: account.id,
          error: metricsErr.message,
          action: 'metrics_collection_failed'
        }, 'Failed to collect TikTok metrics, continuing...');
      }
    }

    const duration = Date.now() - startTime;

    fastify.log.info({
      where: 'processAccountTikTok',
      phase: 'completed',
      accountId: account.id,
      accountName: account.name,
      duration,
      actionsCount: runResult.actions?.length || 0,
      dispatched: runResult.dispatched,
      telegramSent: runResult.telegramSent || false,
      metricsCollected: metricsResult?.totalMetrics || 0
    });

    return {
      success: true,
      accountId: account.id,
      accountName: account.name,
      duration,
      actionsCount: runResult.actions?.length || 0,
      telegramSent: runResult.telegramSent || false,
      metricsCollected: metricsResult?.totalMetrics || 0
    };
  } catch (err) {
    const duration = Date.now() - startTime;
    fastify.log.error({
      where: 'processAccountTikTok',
      phase: 'failed',
      accountId: account.id,
      accountName: account.name,
      duration,
      error: String(err)
    });
    return {
      success: false,
      accountId: account.id,
      accountName: account.name,
      error: String(err),
      duration
    };
  }
}

/**
 * Hourly batch: обработка аккаунтов по их индивидуальному расписанию
 */
async function processDailyBatchBySchedule(utcHour) {
  const batchStartTime = Date.now();
  const lockKey = 'hourly_batch_lock';
  const instanceId = process.env.HOSTNAME || 'unknown';

  fastify.log.info({
    where: 'processDailyBatchBySchedule',
    utcHour,
    instanceId,
    status: 'started'
  });

  // Cleanup expired locks
  if (supabase) {
    try {
      await supabase.rpc('cleanup_expired_batch_locks');
    } catch (cleanupErr) {
      fastify.log.warn({
        where: 'processDailyBatchBySchedule',
        phase: 'cleanup_locks',
        error: String(cleanupErr)
      });
    }
  }

  // Получаем аккаунты для текущего часа
  const accountsToProcess = await getAccountsForCurrentHour(utcHour);

  if (accountsToProcess.length === 0) {
    fastify.log.info({
      where: 'processDailyBatchBySchedule',
      utcHour,
      status: 'no_accounts_to_process'
    });
    return { success: true, processed: 0 };
  }

  const results = [];
  const BATCH_CONCURRENCY = Number(process.env.BRAIN_BATCH_CONCURRENCY || '5');

  // Обрабатываем аккаунты с ограничением concurrency
  for (let i = 0; i < accountsToProcess.length; i += BATCH_CONCURRENCY) {
    const batch = accountsToProcess.slice(i, i + BATCH_CONCURRENCY);

    const batchResults = await Promise.all(
      batch.map(account => processAccountBrain(account))
    );

    results.push(...batchResults);

    // Пауза между батчами
    if (i + BATCH_CONCURRENCY < accountsToProcess.length) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  const successCount = results.filter(r => r.success).length;
  const failureCount = results.filter(r => !r.success).length;
  const batchDuration = Date.now() - batchStartTime;

  // Сохраняем результаты
  if (supabase) {
    try {
      await supabase.from('batch_execution_results').insert({
        execution_date: new Date().toISOString().split('T')[0],
        execution_hour: utcHour,
        started_at: new Date(batchStartTime).toISOString(),
        completed_at: new Date().toISOString(),
        total_users: accountsToProcess.length,
        success_count: successCount,
        failure_count: failureCount,
        total_duration_ms: batchDuration,
        results: results,
        instance_id: instanceId
      });
    } catch (saveErr) {
      fastify.log.error({
        where: 'processDailyBatchBySchedule',
        phase: 'save_results',
        error: String(saveErr)
      });
    }
  }

  fastify.log.info({
    where: 'processDailyBatchBySchedule',
    utcHour,
    processed: accountsToProcess.length,
    success: successCount,
    failed: failureCount,
    duration: batchDuration,
    status: 'completed'
  });

  return {
    success: true,
    processed: accountsToProcess.length,
    successCount,
    failureCount,
    duration: batchDuration
  };
}

/**
 * Hourly batch: обработка TikTok аккаунтов по их индивидуальному расписанию
 */
async function processDailyBatchByScheduleTikTok(utcHour) {
  const batchStartTime = Date.now();

  fastify.log.info({
    where: 'processDailyBatchByScheduleTikTok',
    utcHour,
    status: 'started'
  });

  const accountsToProcess = await getTikTokAccountsForCurrentHour(utcHour);

  if (accountsToProcess.length === 0) {
    fastify.log.info({
      where: 'processDailyBatchByScheduleTikTok',
      utcHour,
      status: 'no_accounts_to_process'
    });
    return { success: true, processed: 0 };
  }

  const results = [];
  const BATCH_CONCURRENCY = Number(process.env.BRAIN_BATCH_CONCURRENCY || '5');

  for (let i = 0; i < accountsToProcess.length; i += BATCH_CONCURRENCY) {
    const batch = accountsToProcess.slice(i, i + BATCH_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(account => processAccountTikTok(account))
    );
    results.push(...batchResults);

    if (i + BATCH_CONCURRENCY < accountsToProcess.length) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  const successCount = results.filter(r => r.success).length;
  const failureCount = results.filter(r => !r.success).length;
  const batchDuration = Date.now() - batchStartTime;

  fastify.log.info({
    where: 'processDailyBatchByScheduleTikTok',
    utcHour,
    processed: accountsToProcess.length,
    success: successCount,
    failed: failureCount,
    duration: batchDuration,
    status: 'completed'
  });

  return {
    success: true,
    processed: accountsToProcess.length,
    successCount,
    failureCount,
    duration: batchDuration
  };
}

// ============================================================================
// LEGACY DAILY BATCH (оставляем для обратной совместимости)
// ============================================================================

/**
 * Batch-обработка всех активных пользователей (параллельно с ограничением concurrency)
 */
async function processDailyBatch() {
  const batchStartTime = Date.now();
  const lockKey = 'daily_batch_lock';
  const instanceId = process.env.HOSTNAME || 'unknown';
  
  fastify.log.info({ where: 'processDailyBatch', status: 'started', instanceId });
  
  // Leader Lock: проверяем, не запущен ли уже batch другим инстансом
  if (supabase) {
    try {
      const { data: existingLock, error: lockCheckError } = await supabase
        .from('batch_locks')
        .select('*')
        .eq('lock_key', lockKey)
        .maybeSingle();
      
      if (lockCheckError && lockCheckError.code !== 'PGRST116') {
        // PGRST116 = no rows returned, это нормально (нет лока)
        fastify.log.error({ 
          where: 'processDailyBatch', 
          phase: 'lock_check_failed', 
          error: String(lockCheckError) 
        });
      }
      
      if (existingLock && new Date(existingLock.expires_at) > new Date()) {
        fastify.log.warn({
          where: 'processDailyBatch',
          status: 'locked',
          lockedBy: existingLock.instance_id,
          expiresAt: existingLock.expires_at,
          message: 'Another instance is already processing batch'
        });
        return { 
          success: false, 
          reason: 'locked_by_another_instance',
          lockedBy: existingLock.instance_id 
        };
      }
      
      // Устанавливаем lock (или обновляем существующий)
      const { error: lockSetError } = await supabase
        .from('batch_locks')
        .upsert({
          lock_key: lockKey,
          instance_id: instanceId,
          expires_at: new Date(Date.now() + 900000).toISOString() // 15 минут (для hourly cron)
        });
      
      if (lockSetError) {
        fastify.log.error({ 
          where: 'processDailyBatch', 
          phase: 'lock_set_failed', 
          error: String(lockSetError) 
        });
      } else {
        fastify.log.info({ 
          where: 'processDailyBatch', 
          phase: 'lock_acquired', 
          instanceId,
          expiresIn: '15 minutes'
        });
      }
    } catch (lockErr) {
      fastify.log.error({ 
        where: 'processDailyBatch', 
        phase: 'lock_error', 
        error: String(lockErr) 
      });
      // Продолжаем выполнение даже если lock не удался (graceful degradation)
    }
  }
  
  try {
    const users = await getActiveUsers();

    if (users.length === 0) {
      fastify.log.info({ where: 'processDailyBatch', status: 'no_active_users' });
      return { success: true, usersProcessed: 0, results: [] };
    }

    fastify.log.info({ where: 'processDailyBatch', usersCount: users.length });

    // ========================================
    // Мультиаккаунтность: разворачиваем пользователей по ad_accounts
    // Для multi_account_enabled=true создаём отдельную задачу для каждого ad_account
    // ВАЖНО: Проверяем ad_accounts.autopilot для каждого аккаунта!
    // ========================================
    const expandedUsers = [];
    for (const user of users) {
      if (user.multi_account_enabled) {
        // Загружаем только активные ad_accounts с включённым автопилотом
        const { data: adAccounts, error: adAccountsError } = await supabase
          .from('ad_accounts')
          .select('id, ad_account_id, name, autopilot, telegram_id, telegram_id_2, telegram_id_3, telegram_id_4, default_cpl_target_cents, plan_daily_budget_cents')
          .eq('user_account_id', user.id)
          .eq('is_active', true)
          .eq('autopilot', true);  // ← КРИТИЧНО: только аккаунты с включённым автопилотом!

        if (adAccountsError) {
          fastify.log.error({
            where: 'processDailyBatch',
            phase: 'load_ad_accounts',
            userId: user.id,
            error: String(adAccountsError)
          });
          // Пропускаем пользователя если не удалось загрузить аккаунты
          continue;
        }

        if (!adAccounts || adAccounts.length === 0) {
          fastify.log.info({
            where: 'processDailyBatch',
            phase: 'no_autopilot_accounts',
            userId: user.id,
            username: user.username,
            message: 'Multi-account user has no ad_accounts with autopilot=true'
          });
          continue;
        }

        // Создаём отдельную задачу для каждого ad_account
        for (const adAccount of adAccounts) {
          const hasTelegramIds = !!(adAccount.telegram_id || adAccount.telegram_id_2 || adAccount.telegram_id_3 || adAccount.telegram_id_4);

          fastify.log.info({
            where: 'processDailyBatch',
            phase: 'expand_ad_account',
            userId: user.id,
            username: user.username,
            accountId: adAccount.id,
            accountName: adAccount.name || adAccount.ad_account_id,
            hasTelegramIds,
            telegramIdCount: [adAccount.telegram_id, adAccount.telegram_id_2, adAccount.telegram_id_3, adAccount.telegram_id_4].filter(Boolean).length,
            defaultCplCents: adAccount.default_cpl_target_cents || null,
            planBudgetCents: adAccount.plan_daily_budget_cents || null,
            autopilot: adAccount.autopilot
          });

          expandedUsers.push({
            ...user,
            accountId: adAccount.id,  // UUID из ad_accounts.id
            accountName: adAccount.name || adAccount.ad_account_id,
            // Переопределяем telegram_id из ad_accounts (БЕЗ fallback на user_accounts!)
            telegram_id: adAccount.telegram_id || null,
            telegram_id_2: adAccount.telegram_id_2 || null,
            telegram_id_3: adAccount.telegram_id_3 || null,
            telegram_id_4: adAccount.telegram_id_4 || null,
            // Добавляем CPL и budget из ad_accounts
            default_cpl_target_cents: adAccount.default_cpl_target_cents,
            plan_daily_budget_cents: adAccount.plan_daily_budget_cents
          });
        }

        fastify.log.info({
          where: 'processDailyBatch',
          phase: 'expanded_multi_account_complete',
          userId: user.id,
          username: user.username,
          adAccountsCount: adAccounts.length,
          accountNames: adAccounts.map(a => a.name || a.ad_account_id),
          accountIds: adAccounts.map(a => a.id)
        });
      } else {
        // Legacy режим: один пользователь = одна задача
        fastify.log.info({
          where: 'processDailyBatch',
          phase: 'expand_legacy_user',
          userId: user.id,
          username: user.username,
          mode: 'legacy',
          hasTelegramIds: !!(user.telegram_id || user.telegram_id_2 || user.telegram_id_3 || user.telegram_id_4),
          telegramIdCount: [user.telegram_id, user.telegram_id_2, user.telegram_id_3, user.telegram_id_4].filter(Boolean).length
        });

        expandedUsers.push({
          ...user,
          accountId: null,  // NULL для legacy режима
          accountName: null
        });
      }
    }

    fastify.log.info({
      where: 'processDailyBatch',
      originalUsersCount: users.length,
      expandedTasksCount: expandedUsers.length,
      message: 'Users expanded by ad_accounts for multi-account mode'
    });

    // Параллельная обработка с ограничением concurrency
    const BATCH_CONCURRENCY = Number(process.env.BRAIN_BATCH_CONCURRENCY || '5'); // 5 задач одновременно
    const results = [];

    // Разбиваем на батчи по BATCH_CONCURRENCY
    for (let i = 0; i < expandedUsers.length; i += BATCH_CONCURRENCY) {
      const batch = expandedUsers.slice(i, i + BATCH_CONCURRENCY);
      fastify.log.info({
        where: 'processDailyBatch',
        batchNumber: Math.floor(i / BATCH_CONCURRENCY) + 1,
        batchSize: batch.length,
        totalBatches: Math.ceil(expandedUsers.length / BATCH_CONCURRENCY)
      });

      // Обрабатываем батч параллельно
      const batchResults = await Promise.all(
        batch.map(user => processUser(user))
      );
      results.push(...batchResults);

      // Небольшая пауза между батчами (не между пользователями!)
      if (i + BATCH_CONCURRENCY < expandedUsers.length) {
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2 секунды между батчами
      }
    }
    
    const batchDuration = Date.now() - batchStartTime;
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;
    
    fastify.log.info({
      where: 'processDailyBatch',
      status: 'completed',
      totalUsers: users.length,
      successCount,
      failureCount,
      totalDuration: batchDuration
    });

    // Сохраняем результаты batch в БД для отчёта мониторинга
    if (supabase) {
      try {
        await supabase.from('batch_execution_results').insert({
          execution_date: new Date().toISOString().split('T')[0],
          started_at: new Date(batchStartTime).toISOString(),
          completed_at: new Date().toISOString(),
          total_users: expandedUsers.length,
          success_count: successCount,
          failure_count: failureCount,
          total_duration_ms: batchDuration,
          results: results,
          instance_id: instanceId
        });

        fastify.log.info({
          where: 'processDailyBatch',
          phase: 'results_saved_to_db'
        });
      } catch (saveErr) {
        fastify.log.error({
          where: 'processDailyBatch',
          phase: 'results_save_failed',
          error: String(saveErr)
        });
      }
    }

    return {
      success: true,
      usersProcessed: users.length,
      successCount,
      failureCount,
      results,
      totalDuration: batchDuration
    };
  } catch (err) {
    const batchDuration = Date.now() - batchStartTime;
    fastify.log.error({
      where: 'processDailyBatch',
      status: 'error',
      totalDuration: batchDuration,
      error: String(err?.message || err)
    });
    
    return {
      success: false,
      error: String(err?.message || err),
      totalDuration: batchDuration
    };
  } finally {
    // Освобождаем lock после завершения обработки (успешной или с ошибкой)
    if (supabase) {
      try {
        await supabase
          .from('batch_locks')
          .delete()
          .eq('lock_key', lockKey)
          .eq('instance_id', instanceId);
        
        fastify.log.info({ 
          where: 'processDailyBatch', 
          phase: 'lock_released', 
          instanceId 
        });
      } catch (unlockErr) {
        fastify.log.error({ 
          where: 'processDailyBatch', 
          phase: 'lock_release_failed', 
          error: String(unlockErr) 
        });
      }
    }
  }
}

/**
 * Legacy batch для TikTok (только legacy users без multi_account)
 */
async function processDailyBatchTikTok() {
  const batchStartTime = Date.now();
  const lockKey = 'daily_batch_tiktok_lock';
  const instanceId = process.env.HOSTNAME || 'unknown';

  fastify.log.info({ where: 'processDailyBatchTikTok', status: 'started', instanceId });

  if (supabase) {
    try {
      const { data: existingLock } = await supabase
        .from('batch_locks')
        .select('*')
        .eq('lock_key', lockKey)
        .maybeSingle();

      if (existingLock && new Date(existingLock.expires_at) > new Date()) {
        fastify.log.warn({
          where: 'processDailyBatchTikTok',
          status: 'locked',
          lockedBy: existingLock.instance_id,
          expiresAt: existingLock.expires_at
        });
        return {
          success: false,
          reason: 'locked_by_another_instance',
          lockedBy: existingLock.instance_id
        };
      }

      await supabase
        .from('batch_locks')
        .upsert({
          lock_key: lockKey,
          instance_id: instanceId,
          expires_at: new Date(Date.now() + 900000).toISOString()
        });
    } catch (lockErr) {
      fastify.log.error({
        where: 'processDailyBatchTikTok',
        phase: 'lock_error',
        error: String(lockErr)
      });
    }
  }

  try {
    const users = await getActiveUsersTikTok();

    if (users.length === 0) {
      fastify.log.info({ where: 'processDailyBatchTikTok', status: 'no_active_users' });
      return { success: true, usersProcessed: 0, results: [] };
    }

    const expandedUsers = users.map(user => ({
      ...user,
      accountId: null,
      accountName: null
    }));

    const BATCH_CONCURRENCY = Number(process.env.BRAIN_BATCH_CONCURRENCY || '5');
    const results = [];

    for (let i = 0; i < expandedUsers.length; i += BATCH_CONCURRENCY) {
      const batch = expandedUsers.slice(i, i + BATCH_CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(user => processUserTikTok(user))
      );
      results.push(...batchResults);

      if (i + BATCH_CONCURRENCY < expandedUsers.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    const batchDuration = Date.now() - batchStartTime;
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    fastify.log.info({
      where: 'processDailyBatchTikTok',
      status: 'completed',
      totalUsers: users.length,
      successCount,
      failureCount,
      totalDuration: batchDuration
    });

    return {
      success: true,
      usersProcessed: users.length,
      successCount,
      failureCount,
      results,
      totalDuration: batchDuration
    };
  } catch (err) {
    const batchDuration = Date.now() - batchStartTime;
    fastify.log.error({
      where: 'processDailyBatchTikTok',
      status: 'error',
      totalDuration: batchDuration,
      error: String(err?.message || err)
    });
    return {
      success: false,
      error: String(err?.message || err),
      totalDuration: batchDuration
    };
  } finally {
    if (supabase) {
      try {
        await supabase
          .from('batch_locks')
          .delete()
          .eq('lock_key', lockKey)
          .eq('instance_id', instanceId);
      } catch (unlockErr) {
        fastify.log.error({
          where: 'processDailyBatchTikTok',
          phase: 'lock_release_failed',
          error: String(unlockErr)
        });
      }
    }
  }
}

// Эндпоинт для проверки выборки пользователей (без обработки)
fastify.get('/api/brain/cron/check-users', async (request, reply) => {
  try {
    const users = await getActiveUsers();

    // Статистика по режимам
    const stats = {
      total: users.length,
      withAutopilot: users.filter(u => u.autopilot === true).length,
      withoutAutopilot: users.filter(u => u.autopilot === false).length,
      autopilotNull: users.filter(u => u.autopilot === null || u.autopilot === undefined).length,
      multiAccountEnabled: users.filter(u => u.multi_account_enabled === true).length,
      multiAccountDisabled: users.filter(u => u.multi_account_enabled === false || u.multi_account_enabled === null).length
    };

    return reply.send({
      success: true,
      usersCount: users.length,
      stats,
      users: users.map(u => ({
        id: u.id,
        username: u.username,
        autopilot: u.autopilot,
        multi_account_enabled: u.multi_account_enabled,
        ad_account_id: u.ad_account_id,
        has_telegram: !!(u.telegram_id && u.telegram_bot_token),
        timezone: u.account_timezone,
        mode: u.autopilot === false ? 'report' : 'autopilot'
      }))
    });
  } catch (err) {
    fastify.log.error(err);

    logErrorToAdmin({
      error_type: 'cron',
      raw_error: err.message || String(err),
      stack_trace: err.stack,
      action: 'cron_check_users',
      endpoint: '/api/brain/cron/check-users',
      severity: 'warning'
    }).catch(() => {});

    return reply.code(500).send({ error: 'check_failed', details: String(err?.message || err) });
  }
});

// Эндпоинт для проверки выборки multi-account аккаунтов по расписанию (без обработки)
fastify.get('/api/brain/cron/check-schedule', async (request, reply) => {
  try {
    const { hour } = request.query; // ?hour=8 для проверки конкретного часа
    const now = new Date();
    const utcHour = hour !== undefined ? parseInt(hour) : now.getUTCHours();

    const accounts = await getAccountsForCurrentHour(utcHour);

    // Статистика по режимам
    const stats = {
      total: accounts.length,
      byMode: {
        autopilot: accounts.filter(a => a.brain_mode === 'autopilot').length,
        semi_auto: accounts.filter(a => a.brain_mode === 'semi_auto').length,
        report: accounts.filter(a => !a.brain_mode || a.brain_mode === 'report').length
      },
      byScheduleHour: accounts.reduce((acc, a) => {
        const h = a.brain_schedule_hour ?? 8;
        acc[h] = (acc[h] || 0) + 1;
        return acc;
      }, {})
    };

    return reply.send({
      success: true,
      utcHour,
      localTimeExample: `UTC ${utcHour}:00 = Asia/Almaty ${(utcHour + 5) % 24}:00`,
      accountsCount: accounts.length,
      stats,
      accounts: accounts.map(a => ({
        id: a.id,
        name: a.name,
        brain_mode: a.brain_mode || 'report',
        brain_schedule_hour: a.brain_schedule_hour ?? 8,
        brain_timezone: a.brain_timezone || 'Asia/Almaty',
        ad_account_id: a.ad_account_id,
        user_account_id: a.user_account_id,
        username: a.user_accounts?.username,
        has_telegram: !!(a.telegram_id),
        last_run: a.last_brain_batch_run_at
      }))
    });
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send({ error: 'check_failed', details: String(err?.message || err) });
  }
});

// Эндпоинт для ручного запуска batch-обработки
fastify.post('/api/brain/cron/run-batch', async (request, reply) => {
  try {
    const result = await processDailyBatch();
    return reply.send(result);
  } catch (err) {
    fastify.log.error(err);

    logErrorToAdmin({
      error_type: 'cron',
      raw_error: err.message || String(err),
      stack_trace: err.stack,
      action: 'cron_run_batch',
      endpoint: '/api/brain/cron/run-batch',
      severity: 'critical'
    }).catch(() => {});

    return reply.code(500).send({ error: 'batch_failed', details: String(err?.message || err) });
  }
});

// Эндпоинт для генерации и отправки отчёта по batch (для тестирования)
// Группа онбординга (куда приходят уведомления о новых клиентах)
const ONBOARDING_CHAT_ID = '-5079020326';

fastify.get('/api/brain/cron/batch-report', async (request, reply) => {
  try {
    const { send } = request.query; // ?send=true для отправки в Telegram
    const { success, report } = await generateBatchReport();
    const botToken = process.env.LOG_ALERT_TELEGRAM_BOT_TOKEN;

    if (send === 'true' && botToken) {
      await sendTelegram(ONBOARDING_CHAT_ID, report, botToken);
      return reply.send({ success, report, sent: true, chatId: ONBOARDING_CHAT_ID });
    }

    return reply.send({ success, report, sent: false });
  } catch (err) {
    fastify.log.error(err);

    logErrorToAdmin({
      error_type: 'cron',
      raw_error: err.message || String(err),
      stack_trace: err.stack,
      action: 'cron_batch_report',
      endpoint: '/api/brain/cron/batch-report',
      severity: 'warning'
    }).catch(() => {});

    return reply.code(500).send({ error: 'report_failed', details: String(err?.message || err) });
  }
});

// Manual currency rate update endpoint
fastify.post('/api/brain/cron/update-currency', async (request, reply) => {
  try {
    const result = await updateCurrencyRates();
    return reply.send(result);
  } catch (err) {
    logErrorToAdmin({
      error_type: 'cron',
      raw_error: err.message || String(err),
      stack_trace: err.stack,
      action: 'cron_update_currency',
      endpoint: '/api/brain/cron/update-currency',
      severity: 'warning'
    }).catch(() => {});

    return reply.code(500).send({ error: 'currency_update_failed', details: String(err?.message || err) });
  }
});

/**
 * OPTIONS /api/analyzer/analyze-creative
 * CORS preflight handler
 */
fastify.options('/api/analyzer/analyze-creative', async (request, reply) => {
  return reply.code(204).send();
});

/**
 * POST /api/analyzer/analyze-creative
 *
 * Анализирует креатив на основе метрик из creative_metrics_history
 * account_id - UUID из ad_accounts.id для мультиаккаунтного режима (опционально)
 */
fastify.post('/api/analyzer/analyze-creative', async (request, reply) => {
  try {
    const { creative_id, user_id, account_id } = request.body;

    if (!creative_id || !user_id) {
      return reply.code(400).send({ error: 'creative_id and user_id are required' });
    }

    fastify.log.info({
      where: 'analyzeCreative',
      creative_id,
      user_id,
      account_id: account_id || 'legacy',
      status: 'started'
    });

    // Получаем метрики креатива из creative_metrics_history
    // p_account_id используется для фильтрации в мультиаккаунтном режиме
    const { data: metricsData, error: metricsError } = await supabase
      .rpc('get_creative_aggregated_metrics', {
        p_user_creative_id: creative_id,
        p_user_account_id: user_id,
        p_account_id: account_id || null,  // UUID для мультиаккаунтности, NULL для legacy
        p_days_limit: 30
      });

    if (metricsError || !metricsData || metricsData.length === 0) {
      fastify.log.error({ where: 'analyzeCreative', creative_id, error: metricsError });
      return reply.code(404).send({ error: 'No metrics found for this creative' });
    }

    // Агрегируем метрики за весь период
    const aggregatedMetrics = metricsData.reduce((acc, metric) => ({
      impressions: acc.impressions + (metric.total_impressions || 0),
      reach: acc.reach + (metric.total_reach || 0),
      clicks: acc.clicks + (metric.total_clicks || 0),
      link_clicks: acc.link_clicks + (metric.total_link_clicks || 0),
      leads: acc.leads + (metric.total_leads || 0),
      spend: acc.spend + (metric.total_spend || 0),
      video_views: acc.video_views + (metric.total_video_views || 0),
      video_views_25_percent: acc.video_views_25_percent + (metric.total_video_views_25 || 0),
      video_views_50_percent: acc.video_views_50_percent + (metric.total_video_views_50 || 0),
      video_views_75_percent: acc.video_views_75_percent + (metric.total_video_views_75 || 0),
    }), {
      impressions: 0,
      reach: 0,
      clicks: 0,
      link_clicks: 0,
      leads: 0,
      spend: 0,
      video_views: 0,
      video_views_25_percent: 0,
      video_views_50_percent: 0,
      video_views_75_percent: 0,
    });

    // Вычисляем производные метрики
    const ctr = aggregatedMetrics.impressions > 0 
      ? aggregatedMetrics.clicks / aggregatedMetrics.impressions 
      : 0;
    const link_ctr = aggregatedMetrics.impressions > 0 
      ? aggregatedMetrics.link_clicks / aggregatedMetrics.impressions 
      : 0;
    const cpm_cents = aggregatedMetrics.impressions > 0 
      ? (aggregatedMetrics.spend * 100 / aggregatedMetrics.impressions) * 1000 
      : 0;
    const cpl_cents = aggregatedMetrics.leads > 0 
      ? (aggregatedMetrics.spend * 100) / aggregatedMetrics.leads 
      : null;
    const frequency = aggregatedMetrics.reach > 0 
      ? aggregatedMetrics.impressions / aggregatedMetrics.reach 
      : 0;

    // Получаем креатив с account_id для мультиаккаунтности
    const { data: creative, error: creativeError } = await supabase
      .from('user_creatives')
      .select('id, title, account_id')
      .eq('id', creative_id)
      .single();

    if (creativeError || !creative) {
      fastify.log.error({ where: 'analyzeCreative', creative_id, error: creativeError });
      return reply.code(404).send({ error: 'Creative not found' });
    }

    // account_id для мультиаккаунтности (UUID или null для legacy)
    // Приоритет: переданный в запросе > из креатива > null
    const accountId = account_id || creative.account_id || null;

    // Получаем транскрибацию
    const { data: transcript } = await supabase
      .from('creative_transcripts')
      .select('text')
      .eq('creative_id', creative_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const transcriptText = transcript?.text || null;

    // Подготавливаем данные для LLM
    const testData = {
      creative_title: creative.title || 'Untitled',
      impressions: aggregatedMetrics.impressions,
      reach: aggregatedMetrics.reach,
      frequency: frequency,
      clicks: aggregatedMetrics.clicks,
      link_clicks: aggregatedMetrics.link_clicks,
      ctr: ctr,
      link_ctr: link_ctr,
      leads: aggregatedMetrics.leads,
      spend_cents: Math.round(aggregatedMetrics.spend * 100),
      cpm_cents: Math.round(cpm_cents),
      cpc_cents: aggregatedMetrics.clicks > 0 
        ? Math.round((aggregatedMetrics.spend * 100) / aggregatedMetrics.clicks) 
        : 0,
      cpl_cents: cpl_cents ? Math.round(cpl_cents) : null,
      video_views: aggregatedMetrics.video_views,
      video_views_25_percent: aggregatedMetrics.video_views_25_percent,
      video_views_50_percent: aggregatedMetrics.video_views_50_percent,
      video_views_75_percent: aggregatedMetrics.video_views_75_percent,
      video_avg_watch_time_sec: metricsData[0]?.avg_video_watch_time || 0
    };

    // Анализируем через LLM
    const analysis = await analyzeCreativeTest(testData, transcriptText);

    fastify.log.info({ 
      where: 'analyzeCreative', 
      creative_id,
      score: analysis?.score,
      verdict: analysis?.verdict
    });

    // Сохраняем результаты анализа
    try {
      const { error: analysisError } = await supabase
        .from('creative_analysis')
        .insert({
          creative_id: creative_id,
          user_account_id: user_id,
          account_id: accountId,  // UUID для мультиаккаунтности, null для legacy
          source: 'manual',
          date_from: metricsData[metricsData.length - 1]?.date || new Date().toISOString().split('T')[0],
          date_to: metricsData[0]?.date || new Date().toISOString().split('T')[0],
          metrics: testData,
          score: analysis?.score || null,
          verdict: analysis?.verdict || null,
          reasoning: analysis?.reasoning || null,
          video_analysis: analysis?.video_analysis || null,
          text_recommendations: analysis?.text_recommendations || null,
          transcript_match_quality: analysis?.transcript_match_quality || null,
          transcript_suggestions: analysis?.transcript_suggestions || null
        });

      if (analysisError) {
        fastify.log.warn({ 
          creative_id, 
          error: analysisError.message 
        }, 'Failed to save analysis to creative_analysis table');
      }
    } catch (err) {
      fastify.log.warn({ 
        creative_id,
        error: err.message 
      }, 'Error saving analysis, continuing...');
    }

    // Возвращаем результаты
    return reply.send({
      success: true,
      creative_id,
      metrics: testData,
      analysis: analysis,
      transcript_available: !!transcriptText
    });
    
  } catch (error) {
    fastify.log.error({ error: error.message, stack: error.stack }, 'Analyze creative error');

    // Логируем в централизованную систему ошибок
    const { user_id } = request.body || {};
    logErrorToAdmin({
      user_account_id: user_id,
      error_type: 'api',
      raw_error: error.message || String(error),
      stack_trace: error.stack,
      action: 'analyze_creative',
      endpoint: '/api/analyzer/analyze-creative',
      severity: 'warning'
    }).catch(() => {});

    return reply.code(500).send({ error: error.message });
  }
});

// Настройка cron: каждый день в 08:00
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 8 * * *'; // 08:00 каждый день
const CRON_ENABLED = process.env.CRON_ENABLED !== 'false'; // По умолчанию включен

if (CRON_ENABLED) {
  cron.schedule(CRON_SCHEDULE, async () => {
    fastify.log.info({ where: 'cron', schedule: CRON_SCHEDULE, status: 'triggered' });
    await processDailyBatch();
    await processDailyBatchTikTok();
  }, {
    scheduled: true,
    timezone: "Asia/Almaty" // Можно сделать динамическим если нужно
  });

  fastify.log.info({ where: 'cron', schedule: CRON_SCHEDULE, timezone: 'Asia/Almaty', status: 'scheduled' });

  // Hourly cron для schedule-based обработки (semi_auto и autopilot с индивидуальным расписанием)
  const HOURLY_CRON_SCHEDULE = '0 * * * *'; // Каждый час в :00
  const HOURLY_CRON_ENABLED = process.env.HOURLY_CRON_ENABLED !== 'false';

  if (HOURLY_CRON_ENABLED) {
    cron.schedule(HOURLY_CRON_SCHEDULE, async () => {
      const utcHour = new Date().getUTCHours();

      fastify.log.info({
        where: 'hourly_brain_cron',
        schedule: HOURLY_CRON_SCHEDULE,
        utcHour,
        status: 'triggered'
      });

      // Очистка истёкших locks перед обработкой
      try {
        await supabase.rpc('cleanup_expired_batch_locks');
      } catch (cleanupErr) {
        fastify.log.warn({
          where: 'hourly_brain_cron',
          phase: 'lock_cleanup_failed',
          error: String(cleanupErr)
        });
      }

      try {
        await processDailyBatchBySchedule(utcHour);
      } catch (err) {
        fastify.log.error({
          where: 'hourly_brain_cron',
          status: 'failed',
          utcHour,
          error: String(err)
        });
      }

      try {
        await processDailyBatchByScheduleTikTok(utcHour);
      } catch (err) {
        fastify.log.error({
          where: 'hourly_tiktok_cron',
          status: 'failed',
          utcHour,
          error: String(err)
        });
      }
    }, {
      scheduled: true,
      timezone: "UTC" // UTC для точного расчёта локальных часов
    });

    fastify.log.info({
      where: 'hourly_brain_cron',
      schedule: HOURLY_CRON_SCHEDULE,
      timezone: 'UTC',
      status: 'scheduled'
    });
  }

  // Cron: Отчёт по утреннему batch в 9:00 по Алматы (через час после batch)
  const REPORT_CRON_SCHEDULE = '0 9 * * *';
  const BATCH_REPORT_BOT_TOKEN = process.env.LOG_ALERT_TELEGRAM_BOT_TOKEN;

  cron.schedule(REPORT_CRON_SCHEDULE, async () => {
    fastify.log.info({
      where: 'batch_report_cron',
      schedule: REPORT_CRON_SCHEDULE,
      status: 'triggered'
    });

    try {
      const { success, report } = await generateBatchReport();

      // Отправляем в группу онбординга
      if (BATCH_REPORT_BOT_TOKEN) {
        await sendTelegram(ONBOARDING_CHAT_ID, report, BATCH_REPORT_BOT_TOKEN);

        fastify.log.info({
          where: 'batch_report_cron',
          status: 'sent',
          chatId: ONBOARDING_CHAT_ID,
          reportSuccess: success
        });
      } else {
        fastify.log.warn({
          where: 'batch_report_cron',
          error: 'LOG_ALERT_TELEGRAM_BOT_TOKEN not configured'
        });
      }
    } catch (err) {
      fastify.log.error({
        where: 'batch_report_cron',
        status: 'failed',
        error: String(err)
      });
    }
  }, {
    scheduled: true,
    timezone: "Asia/Almaty"
  });

  fastify.log.info({
    where: 'batch_report_cron',
    schedule: REPORT_CRON_SCHEDULE,
    timezone: 'Asia/Almaty',
    status: 'scheduled'
  });

  // Start AmoCRM leads sync cron (every hour)
  startAmoCRMLeadsSyncCron();

  // Currency rate update cron (daily at 06:00 Almaty time)
  const CURRENCY_CRON_SCHEDULE = '0 6 * * *';
  cron.schedule(CURRENCY_CRON_SCHEDULE, async () => {
    fastify.log.info({ where: 'currency_rate_cron', status: 'triggered' });
    try {
      const result = await updateCurrencyRates();
      fastify.log.info({ where: 'currency_rate_cron', status: 'completed', ...result });
    } catch (err) {
      fastify.log.error({ where: 'currency_rate_cron', status: 'failed', error: String(err) });
    }
  }, {
    scheduled: true,
    timezone: "Asia/Almaty"
  });

  fastify.log.info({
    where: 'currency_rate_cron',
    schedule: CURRENCY_CRON_SCHEDULE,
    timezone: 'Asia/Almaty',
    status: 'scheduled'
  });

  // Update currency rate on startup
  updateCurrencyRates().catch(err => {
    fastify.log.warn({ where: 'currency_rate_cron', status: 'startup_update_failed', error: String(err) });
  });

  // Cron: Отчёт по перепискам в 9:30 по Алматы (после batch отчёта)
  const CONVERSATION_REPORT_CRON_SCHEDULE = '30 9 * * *';
  const CRM_BACKEND_URL = process.env.CRM_BACKEND_URL || 'http://crm-backend:8084';
  const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';

  cron.schedule(CONVERSATION_REPORT_CRON_SCHEDULE, async () => {
    fastify.log.info({
      where: 'conversation_report_cron',
      schedule: CONVERSATION_REPORT_CRON_SCHEDULE,
      status: 'triggered'
    });

    try {
      // Вызываем API crm-backend для генерации всех отчётов
      const response = await fetch(`${CRM_BACKEND_URL}/conversation-reports/generate-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminKey: ADMIN_API_KEY })
      });

      const result = await response.json();

      if (result.success) {
        fastify.log.info({
          where: 'conversation_report_cron',
          status: 'completed',
          total: result.total,
          generated: result.generated,
          failed: result.failed
        });

        // Отправляем сводку в мониторинг
        if (BATCH_REPORT_BOT_TOKEN && ONBOARDING_CHAT_ID) {
          const summaryText = `📊 Отчёты по перепискам сгенерированы\n\n` +
            `✅ Успешно: ${result.generated}/${result.total}\n` +
            `❌ С ошибками: ${result.failed}\n` +
            (result.errors?.length > 0 ? `\n⚠️ Ошибки:\n${result.errors.slice(0, 5).join('\n')}` : '');

          await sendTelegram(ONBOARDING_CHAT_ID, summaryText, BATCH_REPORT_BOT_TOKEN);
        }
      } else {
        throw new Error(result.error || 'Unknown error');
      }
    } catch (err) {
      fastify.log.error({
        where: 'conversation_report_cron',
        status: 'failed',
        error: String(err)
      });

      // Уведомляем об ошибке
      if (BATCH_REPORT_BOT_TOKEN && ONBOARDING_CHAT_ID) {
        await sendTelegram(
          ONBOARDING_CHAT_ID,
          `⚠️ Ошибка генерации отчётов по перепискам:\n${String(err)}`,
          BATCH_REPORT_BOT_TOKEN
        ).catch(() => {});
      }
    }
  }, {
    scheduled: false, // ВРЕМЕННО ВЫКЛЮЧЕН - тестируем локально
    timezone: "Asia/Almaty"
  });

  fastify.log.info({
    where: 'conversation_report_cron',
    schedule: CONVERSATION_REPORT_CRON_SCHEDULE,
    timezone: 'Asia/Almaty',
    status: 'scheduled'
  });
} else {
  fastify.log.info({ where: 'cron', status: 'disabled' });
}

// =============================================================================
// Moltbot Usage Tracking (независимо от cron)
// =============================================================================

// Start Moltbot usage tracking (every 15 seconds)
startMoltbotUsageTracking(15000);

// =============================================================================
// API Context Endpoint (для Moltbot Skills)
// =============================================================================

/**
 * GET /api/context — получить credentials по telegram_id
 * Используется skills в Moltbot для получения контекста пользователя
 */
fastify.get('/api/context', async (request, reply) => {
  const telegramId = request.headers['x-telegram-id'];

  if (!telegramId) {
    return reply.code(400).send({ error: 'X-Telegram-Id header required' });
  }

  fastify.log.info({ telegramId }, 'Context request received');

  try {
    // Найти пользователя по telegram_id (проверяем все поля telegram_id, telegram_id_2, telegram_id_3, telegram_id_4)
    const { data: users, error: userError } = await supabase
      .from('user_accounts')
      .select('id, access_token, ad_account_id, multi_account_enabled')
      .or(`telegram_id.eq.${telegramId},telegram_id_2.eq.${telegramId},telegram_id_3.eq.${telegramId},telegram_id_4.eq.${telegramId}`)
      .limit(1);

    const user = users?.[0];

    if (userError || !user) {
      fastify.log.warn({ telegramId, error: userError?.message }, 'User not found by telegram_id');
      return reply.code(404).send({
        error: 'User not found',
        needsOnboarding: true,
        message: 'Пользователь не найден. Пройдите регистрацию через /onboarding'
      });
    }

    // Базовые credentials
    let credentials = {
      userAccountId: user.id,
      accessToken: user.access_token,
      adAccountId: user.ad_account_id
    };

    // Multi-account: получить активный аккаунт
    if (user.multi_account_enabled) {
      const { data: activeAccount, error: accError } = await supabase
        .from('ad_accounts')
        .select('id, access_token, ad_account_id')
        .eq('user_account_id', user.id)
        .eq('is_active', true)
        .single();

      if (activeAccount && !accError) {
        credentials = {
          userAccountId: user.id,
          accountId: activeAccount.id,
          accessToken: activeAccount.access_token,
          adAccountId: activeAccount.ad_account_id
        };
      }
    }

    fastify.log.info({
      telegramId,
      userAccountId: credentials.userAccountId,
      hasAccountId: !!credentials.accountId,
      hasAccessToken: !!credentials.accessToken
    }, 'Context resolved');

    return credentials;

  } catch (error) {
    fastify.log.error({ telegramId, error: error.message }, 'Context lookup failed');
    return reply.code(500).send({ error: 'Internal server error' });
  }
});

/**
 * Helper functions for onboarding
 */

function generateUsername() {
  const randomPart = randomBytes(4).toString('hex');
  return `user_${randomPart}`;
}

async function generateUniqueUsername(maxAttempts = 5) {
  let username;
  let attempts = 0;

  do {
    const randomPart = randomBytes(4).toString('hex');
    username = `user_${randomPart}`;

    const { data } = await supabase
      .from('user_accounts')
      .select('id')
      .eq('username', username)
      .single();

    if (!data) return username;
    attempts++;
  } while (attempts < maxAttempts);

  // Fallback с timestamp
  return `user_${Date.now().toString(36)}`;
}

function generatePassword(length = 8) {
  const uppercase = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lowercase = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const allChars = uppercase + lowercase + digits;

  const bytes = randomBytes(length);
  let password = '';

  password += uppercase[bytes[0] % uppercase.length];
  password += lowercase[bytes[1] % lowercase.length];
  password += digits[bytes[2] % digits.length];

  for (let i = 3; i < length; i++) {
    password += allChars[bytes[i] % allChars.length];
  }

  return password.split('').sort(() => Math.random() - 0.5).join('');
}

function buildFacebookOAuthUrl(userId) {
  const FB_APP_ID = process.env.FB_APP_ID || '690472653668355';
  const FB_REDIRECT_URI = 'https://app.performanteaiagency.com/profile';
  const FB_SCOPE = 'ads_read,ads_management,business_management,pages_show_list,pages_manage_ads,pages_read_engagement';
  const state = `user_${userId}_${Date.now()}`;

  return (
    `https://www.facebook.com/v21.0/dialog/oauth?` +
    `client_id=${FB_APP_ID}&` +
    `redirect_uri=${encodeURIComponent(FB_REDIRECT_URI)}&` +
    `scope=${FB_SCOPE}&` +
    `response_type=code&` +
    `state=${state}`
  );
}

// =============================================================================
// AI Usage Limits Endpoints (для Moltbot Telegram)
// =============================================================================

/**
 * GET /api/limits/check — проверить лимит затрат пользователя
 * Используется Moltbot skill для проверки перед обработкой сообщения
 */
fastify.get('/api/limits/check', async (request, reply) => {
  const telegramId = request.headers['x-telegram-id'];

  if (!telegramId) {
    return reply.code(400).send({ error: 'X-Telegram-Id header required' });
  }

  try {
    const { checkUserLimit } = await import('./lib/usageLimits.js');
    const result = await checkUserLimit(telegramId);

    return reply.send(result);
  } catch (error) {
    fastify.log.error({ error: error.message, telegramId }, 'Error checking user limit');
    // Fail-open: при ошибке разрешаем запрос
    return reply.send({
      allowed: true,
      remaining: 1.00,
      limit: 1.00,
      spent: 0,
      failOpen: true,
      error: error.message
    });
  }
});

/**
 * POST /api/limits/track — записать usage после обработки сообщения
 * Используется Moltbot skill для отслеживания затрат
 */
fastify.post('/api/limits/track', async (request, reply) => {
  const telegramId = request.headers['x-telegram-id'];
  const { model, usage } = request.body || {};

  if (!telegramId) {
    return reply.code(400).send({ error: 'X-Telegram-Id header required' });
  }

  if (!model || !usage || (!usage.prompt_tokens && !usage.completion_tokens)) {
    return reply.code(400).send({
      error: 'Missing required fields: model, usage.prompt_tokens, usage.completion_tokens'
    });
  }

  try {
    const { trackUsage, calculateCost } = await import('./lib/usageLimits.js');

    // Записать usage в БД
    await trackUsage(telegramId, model, usage);

    // Посчитать стоимость для ответа
    const cost = calculateCost(model, usage);

    // Получить общий расход за сегодня
    const today = new Date().toISOString().split('T')[0];
    const { data: usageRows } = await supabase
      .from('user_ai_usage')
      .select('cost_usd')
      .eq('telegram_id', telegramId)
      .eq('date', today);

    const totalSpentToday = usageRows?.reduce((sum, row) => sum + parseFloat(row.cost_usd || 0), 0) || 0;

    return reply.send({
      success: true,
      cost_usd: parseFloat(cost.toFixed(6)),
      total_spent_today: parseFloat(totalSpentToday.toFixed(6))
    });
  } catch (error) {
    fastify.log.error({
      error: error.message,
      stack: error.stack,
      telegramId,
      model,
      usage
    }, 'Error tracking usage');

    // Не падаем при ошибке трекинга, просто логируем
    return reply.code(500).send({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/onboarding/create-user
 *
 * Создание нового пользователя из Moltbot onboarding
 * Вызывается после того как пользователь ответил на 15 вопросов
 */
fastify.post('/api/onboarding/create-user', async (request, reply) => {
  try {
    const { telegramId, answers } = request.body;

    if (!telegramId) {
      return reply.code(400).send({ error: 'telegramId required' });
    }

    // Проверяем обязательные поля
    if (!answers?.business_name || !answers?.business_niche) {
      return reply.code(400).send({
        error: 'Required fields: business_name, business_niche'
      });
    }

    fastify.log.info({ telegramId, answers }, 'Onboarding create-user request');

    // 1. Проверяем существование пользователя
    const { data: existingUser } = await supabase
      .from('user_accounts')
      .select('id, username')
      .eq('telegram_id', telegramId)
      .single();

    if (existingUser) {
      fastify.log.info({ telegramId, existingUserId: existingUser.id }, 'User already exists');
      return reply.send({
        success: true,
        alreadyExists: true,
        userId: existingUser.id,
        username: existingUser.username,
        message: 'Пользователь уже зарегистрирован'
      });
    }

    // 2. Генерируем уникальный username и password
    const username = await generateUniqueUsername();
    const password = generatePassword();

    // 3. Создаём user_accounts
    const { data: newUser, error: userError } = await supabase
      .from('user_accounts')
      .insert({
        telegram_id: telegramId,
        username,
        password,
        onboarding_stage: 'registered',
        is_active: true,
        multi_account_enabled: false,
        access_token: '',
        ad_account_id: '',
        page_id: ''
      })
      .select('id')
      .single();

    if (userError || !newUser) {
      fastify.log.error({ error: userError, telegramId }, 'Failed to create user');
      return reply.code(500).send({ error: 'Failed to create user' });
    }

    const userId = newUser.id;

    // 4. Сохраняем ответы в user_briefing_responses
    const { error: briefingError } = await supabase
      .from('user_briefing_responses')
      .insert({
        user_id: userId,
        business_name: answers.business_name,
        business_niche: answers.business_niche,
        instagram_url: answers.instagram_url || null,
        website_url: answers.website_url || null,
        target_audience: answers.target_audience || null,
        geography: answers.geography || null,
        main_pains: answers.main_pains || null,
        main_services: answers.main_services || null,
        competitive_advantages: answers.competitive_advantages || null,
        price_segment: answers.price_segment || null,
        tone_of_voice: answers.tone_of_voice || null,
        main_promises: answers.main_promises || null,
        social_proof: answers.social_proof || null,
        guarantees: answers.guarantees || null,
        competitor_instagrams: answers.competitor_instagrams || []
      });

    if (briefingError) {
      fastify.log.error({ error: briefingError, userId }, 'Failed to save briefing responses');
      // Не критично - пользователь создан, продолжаем
    }

    // 5. Генерируем Facebook OAuth URL
    const fbOAuthUrl = buildFacebookOAuthUrl(userId);

    fastify.log.info({ userId, username, telegramId }, 'User created successfully');

    // 6. Возвращаем результат
    return reply.send({
      success: true,
      userId,
      username,
      password,
      fbOAuthUrl
    });

  } catch (error) {
    fastify.log.error({ error: error.message, stack: error.stack }, 'Onboarding error');
    return reply.code(500).send({ error: 'Internal server error' });
  }
});

// Moltbot Routing Endpoint
fastify.post('/api/moltbot/route', async (request, reply) => {
  const { specialist, message, telegramChatId } = request.body;

  if (!specialist || !message || !telegramChatId) {
    return reply.code(400).send({
      error: 'Missing required fields: specialist, message, telegramChatId'
    });
  }

  try {
    const result = await routeToSpecialist(specialist, message, telegramChatId);
    return reply.send(result);
  } catch (error) {
    request.log.error({ error: error.message, stack: error.stack }, 'Routing error');
    return reply.code(500).send({ error: error.message });
  }
});

// Creative Upload endpoint for Moltbot (with chunked download)
fastify.post('/api/moltbot/creative/upload', async (request, reply) => {
  const {
    userAccountId,
    accountId,
    telegramFileId,
    fileName,
    directionName,
    directionId
  } = request.body;

  if (!userAccountId || !accountId || !telegramFileId) {
    return reply.code(400).send({
      error: 'Missing required fields: userAccountId, accountId, telegramFileId'
    });
  }

  // P1.4: Temp file cleanup - declare tempPath outside try block
  let tempPath = null;
  const uploadStartTime = Date.now();

  try {
    // P3: Structured logging - upload start
    request.log.info({
      event: 'creative_upload_start',
      userAccountId,
      accountId,
      telegramFileId: telegramFileId.slice(0, 20) + '...',
      hasFileName: !!fileName,
      fileName: fileName || null,
      directionName: directionName || null,
      directionId: directionId || null,
      requestIp: request.ip
    }, 'Creative upload request initiated');

    const BOT_TOKEN = process.env.MOLTBOT_TELEGRAM_BOT_TOKEN;

    if (!BOT_TOKEN) {
      return reply.code(500).send({ error: 'MOLTBOT_TELEGRAM_BOT_TOKEN not configured' });
    }

    // 1. Получить file_path от Telegram Bot API
    request.log.info({ telegramFileId }, 'Fetching file info from Telegram');

    const fileInfoResponse = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${telegramFileId}`
    );
    const fileInfo = await fileInfoResponse.json();

    if (!fileInfo.ok) {
      request.log.error({ fileInfo }, 'Invalid file_id from Telegram');
      return reply.code(400).send({ error: 'Invalid file_id', details: fileInfo });
    }

    const filePath = fileInfo.result.file_path;
    const fileSize = fileInfo.result.file_size;
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

    // P1.2: File size validation (prevent OOM)
    const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB
    if (fileSize > MAX_FILE_SIZE) {
      request.log.warn({
        fileSize,
        limit: MAX_FILE_SIZE,
        telegramFileId,
        fileSize_mb: Math.round(fileSize / 1024 / 1024)
      }, 'File size exceeds limit');
      return reply.code(400).send({
        error: 'File too large',
        max_size_mb: 500,
        file_size_mb: Math.round(fileSize / 1024 / 1024)
      });
    }

    // P2.4: Redact bot token from logs
    // P3: Structured logging - file fetched
    request.log.info({
      event: 'telegram_file_fetched',
      filePath,
      fileSize,
      fileSize_mb: Math.round(fileSize / 1024 / 1024),
      fileUrl: fileUrl.replace(/bot[^/]+/, 'bot[REDACTED]')
    }, 'File info retrieved and validated');

    // 2. Определить direction
    let targetDirectionId = directionId;

    if (!targetDirectionId && directionName) {
      const { data: directions, error: dirError } = await supabase
        .from('account_directions')
        .select('id, name')
        .eq('user_account_id', userAccountId)
        .eq('account_id', accountId)
        .eq('is_active', true);

      if (!dirError && directions) {
        const found = directions.find(d =>
          d.name.toLowerCase().includes(directionName.toLowerCase())
        );

        if (found) {
          targetDirectionId = found.id;
        }
      }
    }

    if (!targetDirectionId) {
      // Нужен выбор direction
      const { data: directions, error: dirError } = await supabase
        .from('account_directions')
        .select('id, name')
        .eq('user_account_id', userAccountId)
        .eq('account_id', accountId)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (dirError || !directions) {
        request.log.error({ error: dirError }, 'Failed to fetch directions');
        return reply.code(500).send({ error: 'Failed to fetch directions' });
      }

      if (directions.length === 0) {
        return reply.code(400).send({
          error: 'No active directions found',
          message: 'Создайте direction перед загрузкой креатива'
        });
      }

      if (directions.length === 1) {
        targetDirectionId = directions[0].id;
      } else {
        return reply.send({
          needsSelection: true,
          directions: directions.map(d => ({ id: d.id, name: d.name })),
          message: 'Выберите direction для привязки креатива'
        });
      }
    }

    // 3. Chunked download
    request.log.info({ fileUrl, fileSize }, 'Starting chunked download');

    const chunks = [];
    const chunkSize = 10 * 1024 * 1024; // 10 MB chunks
    let offset = 0;

    while (offset < fileSize) {
      const end = Math.min(offset + chunkSize - 1, fileSize - 1);

      const response = await fetch(fileUrl, {
        headers: {
          'Range': `bytes=${offset}-${end}`
        }
      });

      if (!response.ok) {
        request.log.error({ status: response.status, offset, end }, 'Chunk download failed');
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const chunk = await response.arrayBuffer();
      chunks.push(Buffer.from(chunk));

      const progress = Math.round(((offset + chunk.byteLength) / fileSize) * 100);
      request.log.info({ progress, offset, fileSize }, `Downloaded ${progress}%`);

      offset = end + 1;
    }

    const buffer = Buffer.concat(chunks);
    request.log.info({ totalBytes: buffer.length }, 'Download completed');

    // 4. Сохранить temporary файл
    // P1.3: Path traversal protection - sanitize fileName
    const path = require('path');
    const sanitizedFileName = path.basename(fileName || 'video.mp4').replace(/[^a-zA-Z0-9._-]/g, '_');
    const tempFileName = `telegram_${Date.now()}_${sanitizedFileName}`;
    tempPath = `/tmp/${tempFileName}`; // assigned to outer scope variable for cleanup in finally

    request.log.info({
      originalFileName: fileName,
      sanitizedFileName,
      tempPath
    }, 'Temp file path created');

    await require('fs').promises.writeFile(tempPath, buffer);
    // P3: Structured logging - temp file written
    request.log.info({
      event: 'temp_file_written',
      tempPath,
      size_bytes: buffer.length,
      size_mb: Math.round(buffer.length / 1024 / 1024)
    }, 'Temporary file saved to disk');

    // 5. Создать запись в user_creatives
    const { data: creative, error: createError } = await supabase
      .from('user_creatives')
      .insert({
        user_id: userAccountId,
        account_id: accountId,
        title: fileName || tempFileName,
        status: 'processing',
        media_type: 'video',
        direction_id: targetDirectionId,
        source: 'telegram_upload'
      })
      .select()
      .single();

    if (createError) {
      request.log.error({ error: createError }, 'Failed to create creative record');
      return reply.code(500).send({ error: 'Failed to create creative record' });
    }

    // P3: Structured logging - creative record created
    request.log.info({
      event: 'creative_record_created',
      creativeId: creative.id,
      status: 'processing',
      directionId: targetDirectionId,
      title: fileName || tempFileName
    }, 'Database creative record created');

    // 6. Получить credentials пользователя через /api/context
    // Нужно telegramId для получения accessToken
    const { telegramId } = request.body;
    if (!telegramId) {
      return reply.code(400).send({
        error: 'Missing telegramId',
        message: 'telegramId is required to fetch user credentials'
      });
    }

    request.log.info({ telegramId, creativeId: creative.id }, 'Fetching user credentials');

    const contextResponse = await fetch(
      `http://localhost:${process.env.PORT || 7080}/api/context`,
      {
        headers: {
          'X-Telegram-Id': telegramId,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!contextResponse.ok) {
      request.log.error({ status: contextResponse.status }, 'Failed to fetch user context');
      return reply.code(500).send({
        error: 'Failed to get user credentials',
        details: `Context API returned ${contextResponse.status}`
      });
    }

    const context = await contextResponse.json();
    const { adAccountId, accessToken } = context;

    if (!adAccountId || !accessToken) {
      return reply.code(500).send({
        error: 'Incomplete user credentials',
        details: 'Context missing adAccountId or accessToken'
      });
    }

    // 7. Загрузить видео в Facebook через Graph API
    request.log.info({
      creativeId: creative.id,
      tempPath,
      adAccountId: adAccountId?.slice(0, 15) + '...',
      fileSize: buffer.length
    }, 'Uploading video to Facebook');

    const videoUploadResult = await uploadVideoToFacebook({
      adAccountId,
      accessToken,
      filePath: tempPath,
      title: fileName || tempFileName
    });

    request.log.info({
      fbVideoId: videoUploadResult.id,
      thumbnailUrl: videoUploadResult.thumbnail_url
    }, 'Video uploaded to Facebook successfully');

    // 8. Обновить creative с fb_video_id и thumbnail
    await supabase
      .from('user_creatives')
      .update({
        status: 'ready',
        fb_video_id: videoUploadResult.id,
        fb_thumbnail_url: videoUploadResult.thumbnail_url
      })
      .eq('id', creative.id);

    const { data: direction } = await supabase
      .from('account_directions')
      .select('name')
      .eq('id', targetDirectionId)
      .single();

    // P3: Structured logging - upload complete
    request.log.info({
      event: 'creative_upload_complete',
      creativeId: creative.id,
      fbVideoId: videoUploadResult.id,
      thumbnailUrl: videoUploadResult.thumbnail_url,
      directionName: direction?.name,
      fileName: fileName || tempFileName,
      duration_ms: Date.now() - uploadStartTime
    }, 'Creative upload completed successfully (video uploaded to Facebook)');

    return reply.send({
      success: true,
      creative_id: creative.id,
      fb_video_id: videoUploadResult.id,
      thumbnail_url: videoUploadResult.thumbnail_url,
      direction_name: direction?.name || 'Unknown'
    });

  } catch (error) {
    request.log.error({
      error: error.message,
      stack: error.stack,
      userAccountId,
      accountId,
      tempPath,
      phase: 'creative_upload'
    }, 'Creative upload error');

    // P1.4: Log to admin for monitoring
    logErrorToAdmin({
      user_account_id: userAccountId,
      error_type: 'api',
      error_code: error.code || 'UPLOAD_ERROR',
      raw_error: error.message,
      stack_trace: error.stack,
      action: 'moltbot_creative_upload',
      endpoint: '/api/moltbot/creative/upload',
      request_data: { accountId, telegramFileId, fileName, directionName },
      severity: 'critical'
    }).catch(() => {});

    return reply.code(500).send({ error: error.message });
  } finally {
    // P1.4: Always cleanup temp file
    if (tempPath) {
      await require('fs').promises.unlink(tempPath)
        .then(() => {
          request.log.info({ tempPath }, 'Temp file cleaned up');
        })
        .catch(err => {
          request.log.warn({ tempPath, error: err.message }, 'Failed to cleanup temp file');
        });
    }
  }
});

// Brain Mini approval endpoint for Moltbot
fastify.post('/api/moltbot/brain/approve', async (request, reply) => {
  const { userAccountId, accountId, stepIndices } = request.body;

  if (!userAccountId || !accountId) {
    return reply.code(400).send({
      error: 'Missing required fields: userAccountId, accountId'
    });
  }

  if (!Array.isArray(stepIndices)) {
    return reply.code(400).send({
      error: 'stepIndices must be an array'
    });
  }

  try {
    // P2.1: Authorization - verify user owns this account
    const { data: ownership, error: ownershipError } = await supabase
      .from('user_ad_accounts')
      .select('id')
      .eq('user_account_id', userAccountId)
      .eq('account_id', accountId)
      .single();

    if (ownershipError || !ownership) {
      request.log.warn({
        userAccountId,
        accountId,
        error: ownershipError?.message,
        ip: request.ip
      }, 'Unauthorized access attempt to brain approval');

      logErrorToAdmin({
        user_account_id: userAccountId,
        error_type: 'api',
        error_code: 'UNAUTHORIZED_ACCESS',
        raw_error: 'Attempted to approve proposals for unowned account',
        action: 'moltbot_brain_approve',
        endpoint: '/api/moltbot/brain/approve',
        request_data: { accountId },
        severity: 'warning'
      }).catch(() => {});

      return reply.code(403).send({ error: 'Access denied' });
    }

    request.log.info({ userAccountId, accountId }, 'Account ownership verified');

    // P2.2: Validate stepIndices are non-negative integers
    if (!stepIndices.every(idx => Number.isInteger(idx) && idx >= 0)) {
      request.log.warn({ stepIndices }, 'Invalid stepIndices: must be non-negative integers');
      return reply.code(400).send({
        error: 'stepIndices must be non-negative integers',
        received: stepIndices
      });
    }

    // Remove duplicates
    const uniqueSteps = [...new Set(stepIndices)];
    if (uniqueSteps.length !== stepIndices.length) {
      request.log.info({
        original: stepIndices,
        deduplicated: uniqueSteps
      }, 'Removed duplicate stepIndices');
    }

    request.log.info({ stepIndices: uniqueSteps, count: uniqueSteps.length }, 'stepIndices validated');

    // 1. Найти последний pending proposal для этого user/account
    const { data: proposal, error: fetchError } = await supabase
      .from('pending_brain_proposals')
      .select('*')
      .eq('user_account_id', userAccountId)
      .eq('ad_account_id', accountId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (fetchError || !proposal) {
      request.log.warn({ userAccountId, accountId, error: fetchError }, 'No pending proposals found');
      return reply.code(404).send({ error: 'No pending proposals found' });
    }

    request.log.info({
      proposalId: proposal.id,
      userAccountId,
      accountId,
      stepIndices: uniqueSteps,
      totalProposals: proposal.proposals?.length || 0,
      selectedCount: uniqueSteps.length,
      proposalCreatedAt: proposal.created_at,
      proposalStatus: proposal.status,
      requestIp: request.ip,
      userAgent: request.headers['user-agent']
    }, 'Starting Brain Mini approval process');

    // 2. Вызвать approve через внутренний fetch к /brain-proposals/:id/approve
    // P1.5: Use AGENT_SERVICE_URL instead of hardcoded localhost (works in Docker)
    const AGENT_SERVICE_URL = process.env.AGENT_SERVICE_URL || 'http://agent-service:8082';

    // P2.3: Add timeout to prevent hanging requests
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

    try {
      request.log.info({
        proposalId: proposal.id,
        url: `${AGENT_SERVICE_URL}/brain-proposals/${proposal.id}/approve`,
        stepIndices: uniqueSteps
      }, 'Sending approval request');

      const approveResponse = await fetch(
        `${AGENT_SERVICE_URL}/brain-proposals/${proposal.id}/approve`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': userAccountId
          },
          body: JSON.stringify({ stepIndices: uniqueSteps }),
          signal: controller.signal
        }
      );

      clearTimeout(timeoutId);

      request.log.info({
        proposalId: proposal.id,
        status: approveResponse.status,
        ok: approveResponse.ok
      }, 'Approval response received');

      if (!approveResponse.ok) {
        const errorText = await approveResponse.text();
        request.log.error({
          proposalId: proposal.id,
          status: approveResponse.status,
          errorText
        }, 'Approval endpoint error');
        return reply.code(approveResponse.status).send({ error: errorText });
      }

      const result = await approveResponse.json();

      request.log.info({
        proposalId: proposal.id,
        executed: result.execution_results?.length || 0
      }, 'Brain Mini proposal approved successfully');

      return reply.send(result);

    } catch (fetchError) {
      clearTimeout(timeoutId);

      if (fetchError.name === 'AbortError') {
        request.log.error({
          proposalId: proposal.id,
          timeout: 30000
        }, 'Approval request timeout');

        return reply.code(504).send({
          error: 'Approval request timeout',
          timeout_ms: 30000
        });
      }

      throw fetchError; // Re-throw to outer catch
    }

  } catch (error) {
    request.log.error({ error: error.message, stack: error.stack }, 'Brain approval error');
    return reply.code(500).send({ error: error.message });
  }
});

// Register Chat Assistant routes
registerChatRoutes(fastify);

// Register MCP routes (if enabled)
if (MCP_CONFIG.enabled) {
  registerMCPRoutes(fastify);
  fastify.log.info({ mcpServerUrl: MCP_CONFIG.serverUrl }, 'MCP server enabled');
} else {
  fastify.log.info('MCP server disabled (set MCP_ENABLED=true to enable)');
}

const port = Number(process.env.BRAIN_PORT || 7080);
fastify.listen({ host:'0.0.0.0', port }).then(()=>fastify.log.info(`Brain listening on ${port}`)).catch(err=>{ fastify.log.error(err); process.exit(1); });
