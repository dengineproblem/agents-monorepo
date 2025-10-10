import Fastify from 'fastify';
import 'dotenv/config';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import cron from 'node-cron';
import { runScoringAgent } from './scoring.js';

const fastify = Fastify({ logger: true });
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
  try { fastify.log.info({ where:'responsesCreate', request: safeBody, status: res.status, body: text.slice(0, 500) }); } catch {}
  if (!res.ok) {
    const err = new Error(`${res.status} ${text}`);
    err._requestBody = safeBody;
    err._responseText = text;
    throw err;
  }
  try { return JSON.parse(text); } catch { return { raw: text }; }
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
    
    // Run scoring agent
    const scoringOutput = await runScoringAgent(ua, {
      supabase,
      logger: fastify.log,
      useLLM: true,
      responsesCreate,
      minImpressions: SCORING_MIN_IMPRESSIONS,
      predictionDays: SCORING_PREDICTION_DAYS
    });
    
    return reply.send({
      success: true,
      userAccountId,
      model: MODEL,
      scoring: scoringOutput
    });
    
  } catch (e) {
    fastify.log.error({ where: 'test_scoring', error: String(e), stack: e.stack });
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
    
    // 1. Run Scoring Agent
    const scoringData = await runScoringAgent(ua, {
      supabase,
      logger: fastify.log,
      responsesCreate,
      saveExecution: false
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
    return reply.code(500).send({
      error: String(e),
      stack: e.stack
    });
  }
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

const FB_API_VERSION = 'v20.0';
const MODEL = process.env.BRAIN_MODEL || 'gpt-5';
const USE_LLM = String(process.env.BRAIN_USE_LLM || 'true').toLowerCase() === 'true';
const CAN_USE_LLM = USE_LLM && Boolean(process.env.OPENAI_API_KEY);
const AGENT_URL = (process.env.AGENT_SERVICE_URL || '').replace(/\/+$/,'') + '/api/agent/actions';
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
  // Workflows (executor manual handlers)
  'Workflow.DuplicateAndPauseOriginal',
  'Workflow.DuplicateKeepOriginalActive',
  // Audience tools
  'Audience.DuplicateAdSetWithAudience',
  // Creative-based campaign creation
  'CreateCampaignWithCreative'
]);

function genIdem() {
  const d = new Date();
  const p = (n)=>String(n).padStart(2,'0');
  return `think-${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}-${Math.random().toString(36).slice(2,8)}`;
}
const toInt = (v) => Number.isFinite(+v) ? Math.round(+v) : null;

async function getUserAccount(userAccountId) {
  if (!supabase) throw new Error('supabase not configured');
  const { data, error } = await supabase
    .from('user_accounts')
    .select('id, access_token, ad_account_id, page_id, telegram_id, telegram_bot_token, username, prompt3, plan_daily_budget_cents, default_cpl_target_cents, whatsapp_phone_number')
    .eq('id', userAccountId)
    .single();
  if (error) throw error;
  return data;
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
  url.searchParams.set('access_token', accessToken);
  return fbGet(url.toString());
}
async function fetchYesterdayInsights(adAccountId, accessToken) {
  const url = new URL(`https://graph.facebook.com/${FB_API_VERSION}/${adAccountId}/insights`);
  url.searchParams.set('fields','campaign_name,campaign_id,adset_name,adset_id,ad_name,ad_id,spend,actions,cpm,ctr,video_thruplay_watched_actions');
  url.searchParams.set('date_preset','yesterday');
  url.searchParams.set('level','adset');
  url.searchParams.set('action_breakdowns','action_type');
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
  const actions = Array.isArray(stat?.actions) ? stat.actions : [];
  for (const action of actions) {
    const t = action?.action_type;
    const v = parseInt(action?.value || '0', 10) || 0;
    if (t === 'onsite_conversion.total_messaging_connection') {
      messagingLeads = v;
    } else if (t === 'onsite_conversion.messaging_user_depth_2_message_send') {
      qualityLeads = v;
    } else if (t === 'lead' || t === 'fb_form_lead' || (typeof t === 'string' && (t.includes('fb_form_lead') || t.includes('leadgen')))) {
      formLeads = sumInt(formLeads, v);
    } else if (t === 'onsite_web_lead') {
      siteLeads = sumInt(siteLeads, v);
    } else if (t === 'offsite_conversion.fb_pixel_lead') {
      siteLeads = sumInt(siteLeads, v);
    } else if (t === 'offsite_conversion.lead') {
      siteLeads = sumInt(siteLeads, v);
    } else if (typeof t === 'string' && t.startsWith('offsite_conversion.custom')) {
      siteLeads = sumInt(siteLeads, v);
    } else if (typeof t === 'string' && t.startsWith('offsite_conversion.') && !String(t).includes('fb_form_lead') && (String(t).includes('lead') || String(t).includes('custom'))) {
      siteLeads = sumInt(siteLeads, v);
    }
  }
  const leads = messagingLeads + siteLeads + formLeads;
  return { messagingLeads, qualityLeads, siteLeads, formLeads, leads };
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
  for (const r of rows || []) {
    const id = r.campaign_id;
    if (!id) continue;
    const prev = map.get(id) || { spend:0, impressions:0, ctr:0, cpm:0, frequency:0, actions:[] };
    prev.spend = sumInt(prev.spend, Number(r.spend)||0);
    prev.impressions = sumInt(prev.impressions, Number(r.impressions)||0);
    prev.ctr = r.ctr !== undefined ? Number(r.ctr)||0 : prev.ctr;
    prev.cpm = r.cpm !== undefined ? Number(r.cpm)||0 : prev.cpm;
    prev.frequency = r.frequency !== undefined ? Number(r.frequency)||0 : prev.frequency;
    if (Array.isArray(r.actions)) prev.actions = r.actions;
    map.set(id, prev);
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

const SYSTEM_PROMPT = (clientPrompt) => [
  (clientPrompt || '').trim(),
  '',
  'ОБЩИЙ КОНТЕКСТ (ЗАЧЕМ И КАК РАБОТАЕМ)',
  '- Ты — таргетолог-агент, управляющий рекламой в Facebook Ads Manager через Aggregated Insights и Graph API.',
  '- Бизнес-цель: (1) строго выдерживать общий суточный бюджет аккаунта и бюджеты по направлениям; (2) достигать планового CPL, а для WhatsApp — планового QCPL (стоимость качественного лида ≥2 сообщений).',
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
  '- 2) Главный KPI — CPL (стоимость заявки). Для WhatsApp приоритет — QCPL (стоимость КАЧЕСТВЕННОГО лида ≥2 сообщений).',
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
  '  • Лид-формы: lead, fb_form_lead, leadgen',
  '  • Сайт/пиксель: onsite_web_lead, offsite_conversion.lead, offsite_conversion.fb_pixel_lead, offsite_conversion.custom*',
  '- Формулы: CPL = spend / max(total_leads,1); QCPL = spend / max(quality_leads,1). Для WhatsApp сначала QCPL; если quality_leads<3 на окне — опираемся на CPL.',
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
  '  • unused_creatives: список креативов которые готовы к использованию но НЕ ИСПОЛЬЗУЮТСЯ в активных ads сейчас (с рекомендуемым objective). ПРИОРИТЕТ для новых кампаний!',
  '  • recommendations_for_brain: список рекомендаций для тебя от Scoring Agent',
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
  '🎯 ПРИОРИТЕТ 1: НОВЫЙ КОНТЕНТ (если есть unused_creatives)',
  '- ВСЕГДА проверяй поле scoring.unused_creatives ПЕРЕД любым дублированием!',
  '- Если unused_creatives.length ≥ 1: создай ОДНУ кампанию с ВСЕМИ креативами в ОДНОМ adset!',
  '- ВАЖНО: Передавай ВСЕ user_creative_ids ОДНИМ вызовом в МАССИВЕ: user_creative_ids: ["uuid-1", "uuid-2", "uuid-3"]',
  '- Результат: 1 Campaign → 1 AdSet → 3 Ads (по одному на каждый креатив)',
  '- Facebook сам выберет лучший креатив через machine learning!',
  '- Параметры:',
  '  • objective: используй recommended_objective из unused_creatives (обычно "WhatsApp")',
  '  • daily_budget_cents: РАССЧИТАЙ САМ! Учитывай:',
  '    - Если отключаешь плохой adset с бюджетом X → распредели X между новыми кампаниями',
  '    - Плановый бюджет направления и общий лимит аккаунта',
  '    - Минимум 1000 центов ($10) на кампанию',
  '    - Типичный диапазон 3000-5000 центов ($30-50) для одной кампании',
  '    - Если создаешь 3 кампании и освободилось $50 → по $16-17 на каждую ($50/3)',
  '  • use_default_settings: true (авто таргетинг)',
  '  • auto_activate: true (ВАЖНО! Сразу запуск для продакшена)',
  '  • campaign_name: "<Название> — Креатив 1" (уникальное название для каждой кампании!)',
  '',
  '🎯 ПРИОРИТЕТ 2: РОТАЦИЯ СУЩЕСТВУЮЩИХ КРЕАТИВОВ (если unused пусто, но есть ready_creatives)',
  '- Применяется если scoring.unused_creatives = [] НО scoring.ready_creatives.length > 0',
  '- Назначение: ротация уже протестированных креативов в новой кампании для свежего обучения алгоритма',
  '- ВЫБОР КРЕАТИВА:',
  '  • Анализируй performance из ready_creatives (avg_cpl, avg_ctr, total_leads)',
  '  • Выбирай креативы с ЛУЧШЕЙ historical performance (низкий CPL, высокий CTR)',
  '  • Можно выбрать 1-3 лучших креатива для ротации',
  '- Используй CreateCampaignWithCreative с user_creative_ids из ready_creatives',
  '- Параметры те же что в ПРИОРИТЕТ 1 (objective, daily_budget_cents, use_default_settings, auto_activate)',
  '- Это НЕ новый контент, но даёт шанс на лучшие результаты через свежую связку Campaign+AdSet',
  '',
  '🎯 ПРИОРИТЕТ 3: LAL ДУБЛЬ (если нет креативов вообще)',
  '- Применяется ТОЛЬКО если unused_creatives = [] И ready_creatives = []',
  '- Назначение: смена аудитории на LAL 3% IG Engagers 365d (когда нет креативов для ротации)',
  '- Условия:',
  '  • HS ≤ -6 (slightly_bad или bad)',
  '  • CPL_ratio ≥ 2.0 на yesterday ИЛИ last_3d',
  '  • impr_yesterday ≥ 1000 ИЛИ impr_last_3d ≥ 1500',
  '- Бюджет дубля: min(original_daily_budget, $10), в пределах [300..10000] центов',
  '- Экшен: Audience.DuplicateAdSetWithAudience {"source_adset_id","audience_id":"use_lal_from_settings","daily_budget"<=1000,"name_suffix":"LAL3"}',
  '',
  'РЕБАЛАНС БЮДЖЕТА (АККАУНТ → НАПРАВЛЕНИЯ → AD SET)',
  '- ⚠️ КРИТИЧЕСКИ ВАЖНО: При снижении/паузе любого adset ВСЕГДА перераспределяй освободившийся бюджет!',
  '- Цель: выйти ровно на плановые суммы (аккаунт и направления).',
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
  '- PauseAdset {"adsetId"} — ПОЛНАЯ ПАУЗА adset (освобождает 100% бюджета)',
  '- PauseAd {"ad_id","status":"PAUSED"}',
  '- Workflow.DuplicateAndPauseOriginal {"campaign_id","name?"} — дублирует кампанию и паузит оригинал (используется для реанимации)',
  '- Workflow.DuplicateKeepOriginalActive {"campaign_id","name?"} — дублирует кампанию, оригинал оставляет активным (масштабирование)',
  '- Audience.DuplicateAdSetWithAudience {"source_adset_id","audience_id","daily_budget?","name_suffix?"} — дубль ad set c заданной аудиторией (LAL3 IG Engagers 365d) без отключения Advantage+.',
  '- CreateCampaignWithCreative {"user_creative_ids":["uuid1","uuid2","uuid3"],"objective","campaign_name","daily_budget_cents","adset_name?","use_default_settings?","auto_activate?"} — создает НОВУЮ кампанию с НЕСКОЛЬКИМИ креативами в ОДНОМ adset. ПРИОРИТЕТНЫЙ инструмент для реанимации! ВАЖНО: use_default_settings=true автоматически применяет таргетинг из default_ad_settings. auto_activate=true сразу запускает (рекомендуется!). Работает СРАЗУ и БЕССРОЧНО (daily_budget). ПАРАМЕТР user_creative_ids — МАССИВ! Передавай ВСЕ unused_creatives (1-3 штуки) ОДНИМ вызовом — они автоматически создадутся как отдельные ads в одном adset. КОГДА: (1) ВСЕГДА если есть unused_creatives при slightly_bad/bad; (2) если нужно масштабирование но текущие кампании в обучении. BACKWARD COMPATIBILITY: можно передать user_creative_id (одиночный) для одного креатива.',
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
  '- Лиды: messaging_total + lead_forms + site_leads; качественные: messaging_user_depth_2_message_send.',
  '- CPL=spend/leads, QCPL=spend/quality_leads; при делении на 0 — выводи "н/д".',
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
  'Example JSON:\n{\n  "planNote": "HS bad (adset_123, бюджет 5000 центов = $50/день, CPL x2.5). Снижаем плохой adset на -50% (до $25/день), unused_creatives=3. Создаем ОДНУ новую кампанию с ТРЕМЯ креативами в ОДНОМ adset, переносим освободившийся бюджет $25 на нее.",\n  "actions": [\n    { "type": "GetCampaignStatus", "params": { "campaign_id": "<CAMP_ID>" } },\n    { "type": "UpdateAdSetDailyBudget", "params": { "adset_id": "adset_123", "daily_budget": 2500 } },\n    { "type": "CreateCampaignWithCreative", "params": { "user_creative_ids": ["uuid-1", "uuid-2", "uuid-3"], "objective": "WhatsApp", "campaign_name": "Новая кампания — Тест 3 креативов", "daily_budget_cents": 2500, "use_default_settings": true, "auto_activate": true } }\n  ],\n  "reportText": "📊 Отчет\\n\\nОбнаружены плохие результаты (adset_123, CPL превышает целевой в 2.5 раза). Снижаем бюджет плохого adset на 50% (с $50 до $25/день). Вместо дублирования запускаем новую кампанию с 3 свежими креативами в одном adset — Facebook сам выберет лучший. Переносим освободившуюся половину бюджета ($25/день) на новую кампанию."\n}',
  '',
  'ПРИМЕР 3B (реанимация: полная пауза, переносим весь бюджет, ДВА креатива)',
  'Example JSON:\n{\n  "planNote": "HS bad (adset_456, бюджет 5000 центов = $50/день, CPL x4, траты есть но лидов почти нет). ПАУЗИМ adset полностью, unused_creatives=2. Создаем ОДНУ новую кампанию с ДВУМЯ креативами в ОДНОМ adset, переносим весь освободившийся бюджет $50 на нее.",\n  "actions": [\n    { "type": "GetCampaignStatus", "params": { "campaign_id": "<CAMP_ID>" } },\n    { "type": "PauseAdset", "params": { "adsetId": "adset_456" } },\n    { "type": "CreateCampaignWithCreative", "params": { "user_creative_ids": ["uuid-2", "uuid-5"], "objective": "WhatsApp", "campaign_name": "Новая кампания — Тест 2 креативов", "daily_budget_cents": 5000, "use_default_settings": true, "auto_activate": true } }\n  ],\n  "reportText": "📊 Отчет\\n\\nОбнаружены критические результаты (adset_456, CPL превышает целевой в 4 раза, траты без лидов). ПОЛНОСТЬЮ паузим неэффективный adset. Вместо дублирования запускаем новую кампанию с 2 свежими креативами в одном adset — Facebook сам выберет лучший. Переносим весь освободившийся бюджет ($50/день) на новую кампанию для свежего старта."\n}',
  '',
  'ПРИМЕР 4 (ротация существующих креативов, unused пусто)',
  'Example JSON:\n{\n  "planNote": "HS bad, unused_creatives=[] но ready_creatives=[2]. Ротация лучших креативов в новой кампании.",\n  "actions": [\n    { "type": "GetCampaignStatus", "params": { "campaign_id": "<CAMP_ID>" } },\n    { "type": "UpdateAdSetDailyBudget", "params": { "adset_id": "<ADSET_ID>", "daily_budget": 2500 } },\n    { "type": "CreateCampaignWithCreative", "params": { "user_creative_ids": ["uuid-5", "uuid-7"], "objective": "WhatsApp", "campaign_name": "Ротация — Лучшие креативы", "daily_budget_cents": 2500, "use_default_settings": true, "auto_activate": true } }\n  ],\n  "reportText": "📊 Отчет\\n\\nТекущая кампания показывает плохие результаты. Новых креативов нет, но есть проверенные креативы с хорошей historical performance (CPL $3.20 и $4.10). Снижаем бюджет плохого adset на 50% и запускаем ротацию 2 лучших креативов в новой кампании — свежая связка Campaign+AdSet даст шанс на улучшение результатов."\n}',
  '',
  'ПРИМЕР 5 (ребаланс бюджета: снижение плохого + увеличение хороших)',
  'Example JSON:\n{\n  "planNote": "AdSet_A (slightly_bad, бюджет $30) → снижаем на -40% до $18 (освобождается $12). AdSet_B (good) и AdSet_C (very_good) получают по $6 каждый. unused_creatives=[], ready_creatives=[].",\n  "actions": [\n    { "type": "GetCampaignStatus", "params": { "campaign_id": "<CAMP_A>" } },\n    { "type": "UpdateAdSetDailyBudget", "params": { "adset_id": "adset_A", "daily_budget": 1800 } },\n    { "type": "GetCampaignStatus", "params": { "campaign_id": "<CAMP_B>" } },\n    { "type": "UpdateAdSetDailyBudget", "params": { "adset_id": "adset_B", "daily_budget": 2600 } },\n    { "type": "GetCampaignStatus", "params": { "campaign_id": "<CAMP_C>" } },\n    { "type": "UpdateAdSetDailyBudget", "params": { "adset_id": "adset_C", "daily_budget": 3600 } }\n  ],\n  "reportText": "📊 Отчет\\n\\nПроизведен ребаланс бюджета для соблюдения планового расхода. AdSet_A показывает slightly_bad результаты (CPL выше целевого на 40%) — снижен бюджет на $12/день. Освободившиеся средства перераспределены на эффективные adsets: AdSet_B (good, +$6) и AdSet_C (very_good, +$6). Общий суточный бюджет сохранен. Новых креативов для тестирования нет."\n}',
  '',
  'ПРИМЕР 6 (фолбэк на LAL дубль если нет креативов вообще)',
  'Example JSON:\n{\n  "planNote": "HS bad, unused_creatives=[], ready_creatives=[]. Фолбэк: LAL дубль т.к. нет креативов для ротации.",\n  "actions": [\n    { "type": "GetCampaignStatus", "params": { "campaign_id": "<CAMP_ID>" } },\n    { "type": "Audience.DuplicateAdSetWithAudience", "params": { "source_adset_id": "<ADSET_ID>", "audience_id": "use_lal_from_settings", "daily_budget": 1000, "name_suffix": "LAL3" } }\n  ],\n  "reportText": "📊 Отчет\\n\\nТекущая кампания показывает плохие результаты. Креативов для ротации нет, поэтому создаем дубль с LAL аудиторией из настроек. Бюджет $10/день."\n}',
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
  '- Язык ответа — русский; никаких пояснений вне JSON.'
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
    cleaned.push({ type, params });
  }
  if (!cleaned.length) throw new Error('No valid actions');
  return cleaned;
}

async function sendActionsBatch(idem, userAccountId, actions, whatsappPhoneNumber) {
  const res = await fetch(AGENT_URL, {
    method: 'POST',
    headers: { 'content-type':'application/json' },
    body: JSON.stringify({
      idempotencyKey: idem,
      source: 'brain',
      account: { 
        userAccountId,
        ...(whatsappPhoneNumber && { whatsappPhoneNumber })
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
  if (!chatId) return false;
  const bot = token || process.env.TELEGRAM_FALLBACK_BOT_TOKEN;
  if (!bot) return false;

  const MAX_PART = 3800; // запас по лимиту 4096
  const parts = [];
  let remaining = String(text || '');
  while (remaining.length > MAX_PART) {
    parts.push(remaining.slice(0, MAX_PART));
    remaining = remaining.slice(MAX_PART);
  }
  parts.push(remaining);

  for (const part of parts) {
  const r = await fetch(`https://api.telegram.org/bot${bot}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type':'application/json' },
      // без parse_mode для надёжности (Markdown может ломаться)
      body: JSON.stringify({ chat_id: String(chatId), text: part, disable_web_page_preview: true })
    });
    if (!r.ok) {
      const errText = await r.text().catch(()=> '');
      fastify.log.warn({ msg: 'telegram_send_failed', status: r.status, errText });
      return false;
    }
  }
  return true;
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

function buildReport({ date, accountStatus, insights, actions, lastReports }) {
  const statusLine = accountStatus?.account_status === 1
    ? `Аккаунт активен (ID: ${accountStatus?.id || '—'})`
    : `Аккаунт неактивен (причина: ${accountStatus?.disable_reason ?? '—'})`;

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
  const resp = await responsesCreate({
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

// POST /api/brain/run  { idempotencyKey?, userAccountId, inputs?:{ dispatch?:boolean } }
fastify.post('/api/brain/run', async (request, reply) => {
  const started = Date.now();
  try {
    const { idempotencyKey, userAccountId, inputs } = request.body || {};
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
        agentResponse = await sendActionsBatch(idem, userAccountId, actions, null);
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

    const ua = await getUserAccount(userAccountId);
    
    // ========================================
    // 1. SCORING AGENT - запускается ПЕРВЫМ
    // ========================================
    let scoringOutput = null;
    if (SCORING_ENABLED) {
      try {
        fastify.log.info({ where: 'brain_run', phase: 'scoring_start', userId: userAccountId });
        scoringOutput = await runScoringAgent(ua, {
          supabase,
          logger: fastify.log,
          useLLM: CAN_USE_LLM,
          responsesCreate,
          minImpressions: SCORING_MIN_IMPRESSIONS,
          predictionDays: SCORING_PREDICTION_DAYS
        });
        fastify.log.info({ 
          where: 'brain_run', 
          phase: 'scoring_complete', 
          userId: userAccountId,
          summary: scoringOutput?.summary 
        });
      } catch (err) {
        fastify.log.warn({ 
          where: 'brain_run', 
          phase: 'scoring_failed', 
          userId: userAccountId, 
          error: String(err) 
        });
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
    const [accountStatus, adsets, insights] = await Promise.all([
      fetchAccountStatus(ua.ad_account_id, ua.access_token).catch(e=>({ error:String(e) })),
      fetchAdsets(ua.ad_account_id, ua.access_token).catch(e=>({ error:String(e) })),
      fetchYesterdayInsights(ua.ad_account_id, ua.access_token).catch(e=>({ error:String(e) }))
    ]);

    const date = (insights?.data?.[0]?.date_start) || new Date().toISOString().slice(0,10);
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

    // ========================================
    // ИСТОРИЯ ДЕЙСТВИЙ ЗА ПОСЛЕДНИЕ 3 ДНЯ
    // ========================================
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    // ВАЖНО: В базе ad_account_id хранится с префиксом "act_"
    // normalizeAdAccountId() уже добавляет префикс если его нет
    const normalizedAccountId = normalizeAdAccountId(adAccountId);
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
    const adsetsWithYesterdayResults = adsetList.filter(as => {
      // Только АКТИВНЫЕ adsets с затратами вчера
      if (as.effective_status !== 'ACTIVE') return false;
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
      filtered_out: adsetList.length - adsetsWithYesterdayResults.length
    });
    
    // ========================================
    // ПРОВЕРКА: Если вчера не было затрат - не вызываем LLM
    // ========================================
    if (adsetsWithYesterdayResults.length === 0) {
      fastify.log.info({ 
        where: 'brain_run', 
        phase: 'no_spend_yesterday', 
        userId: userAccountId,
        message: 'Вчера не было активных кампаний с затратами, пропускаем LLM'
      });
      
      const reportText = [
        `📊 Отчёт за ${date}`,
        ``,
        `⚠️ Вчера не было активных рекламных кампаний с затратами.`,
        ``,
        `Рекламный кабинет работает, но кампании не запущены или были на паузе.`,
        ``,
        `🚀 Запустите рекламу, и я продолжу давать вам ежедневные отчёты с рекомендациями!`,
        ``,
        `Статус аккаунта: ${accountStatus?.account_status === 1 ? '✅ Активен' : '⚠️ Проверьте статус'}`,
        `Всего ad sets: ${adsetList.length}`,
        `Активных ad sets: ${adsetList.filter(a => a.status === 'ACTIVE').length}`,
      ].join('\n');
      
      // Отправляем в Telegram (если dispatch=true)
      let telegramSent = false;
      if (inputs?.dispatch && ua.telegram_chat_id && process.env.TELEGRAM_BOT_TOKEN) {
        try {
          await sendTelegramReport(ua.telegram_chat_id, process.env.TELEGRAM_BOT_TOKEN, reportText);
          telegramSent = true;
          fastify.log.info({ where: 'brain_run', phase: 'telegram_sent', userId: userAccountId });
        } catch (err) {
          fastify.log.warn({ where: 'brain_run', phase: 'telegram_failed', userId: userAccountId, error: String(err) });
        }
      }
      
      return reply.send({
        idempotencyKey: idem,
        planNote: 'no_spend_yesterday',
        actions: [],
        dispatched: false,
        telegramSent,
        reportText,
        timing: {
          total_ms: Date.now() - started,
          scoring_ms: scoringOutput ? 0 : null
        }
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

    // Подготовка данных для LLM и фолбэк на детерминистический план
    const llmInput = {
      userAccountId,
      ad_account_id: ua?.ad_account_id || null,
      account: {
        timezone: ua?.account_timezone || 'Asia/Almaty',
        report_date: date,
        dispatch: !!inputs?.dispatch
      },
      limits: { min_cents: bounds.minCents, max_cents: bounds.maxCents, step_up: 0.30, step_down: 0.50 },
      targets,
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
        campaigns: (campList||[]).filter(c=>String(c.status||c.effective_status||'').includes('ACTIVE')).map(c=>({
          campaign_id: c.id,
          name: c.name,
          status: c.status,
          daily_budget: toInt(c.daily_budget)||0,
          lifetime_budget: toInt(c.lifetime_budget)||0,
          windows: {
            yesterday: byCY.get(c.id)||{},
            last_3d: byC3.get(c.id)||{},
            last_7d: byC7.get(c.id)||{},
            last_30d: byC30.get(c.id)||{},
            today: byCT.get(c.id)||{}
          }
        })),
        adsets: (adsetList||[])
          .filter(as => {
            // Только АКТИВНЫЕ adsets с затратами вчера (для LLM)
            if (as.effective_status !== 'ACTIVE') return false;
            const yesterdayData = byY.get(as.id)||{};
            const hasResults = (Number(yesterdayData.spend)||0) > 0 || (computeLeadsFromActions(yesterdayData).leads||0) > 0;
            return hasResults;
          })
          .map(as=>{
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
        // учитывать только активные кампании с результатом
        yesterday_totals: (()=>{
          const activeWithResults = (campList||[])
            .filter(c => String(c.status||c.effective_status||'').includes('ACTIVE'))
            .map(c=>({ c, y: byCY.get(c.id)||{} }))
            .filter(({y})=> (Number(y.spend)||0) > 0 || (computeLeadsFromActions(y).leads||0) > 0);
          const spend = activeWithResults.reduce((s,{y})=> s + (Number(y.spend)||0), 0);
          const leads = activeWithResults.reduce((s,{y})=> s + (computeLeadsFromActions(y).leads||0), 0);
          const ql = activeWithResults.reduce((s,{y})=> s + (computeLeadsFromActions(y).qualityLeads||0), 0);
          return {
            spend_usd: spend.toFixed(2),
            leads_total: leads,
            leads_quality: ql
          };
        })(),
        header_first_lines: (()=>{
          const d = date;
          const activeWithResults = (campList||[])
            .filter(c => String(c.status||c.effective_status||'').includes('ACTIVE'))
            .map(c=>({ c, y: byCY.get(c.id)||{} }))
            .filter(({y})=> (Number(y.spend)||0) > 0 || (computeLeadsFromActions(y).leads||0) > 0);
          const spend = activeWithResults.reduce((s,{y})=> s + (Number(y.spend)||0), 0);
          const Ltot = activeWithResults.reduce((s,{y})=> s + (computeLeadsFromActions(y).leads||0), 0);
          const Lq = activeWithResults.reduce((s,{y})=> s + (computeLeadsFromActions(y).qualityLeads||0), 0);
          const cpl = Ltot>0 ? (spend / Ltot) : null;
          const qcpl = Lq>0 ? (spend / Lq) : null;
          const status = (accountStatus?.account_status === 1) ? 'Активен' : 'Неактивен';
          return [
            `📅 Дата отчета: ${d}`,
            '',
            `🏢 Статус рекламного кабинета: ${status}`,
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
      console.log('🐛 DEBUG: LLM input written to /tmp/llm_input_debug.json');
    }

    let actions;
    let planNote;
    let planLLMRaw = null;
    let reportTextFromLLM = null;
    if (CAN_USE_LLM) {
      try {
        // Используем тестовый промт если включен BRAIN_TEST_MODE
        const system = (process.env.BRAIN_TEST_MODE === 'true') ? TEST_SYSTEM_PROMPT : SYSTEM_PROMPT(ua?.prompt3 || '');
        const { parsed, rawText, parseError } = await llmPlan(system, llmInput);
        planLLMRaw = { rawText, parseError, parsed };
        if (!parsed || !Array.isArray(parsed.actions)) throw new Error(parseError || 'LLM invalid output');
        actions = validateAndNormalizeActions(parsed.actions);
        planNote = parsed.planNote || 'llm_plan_v1.2';
        if (typeof parsed.reportText === 'string' && parsed.reportText.trim()) {
          reportTextFromLLM = parsed.reportText.trim();
        }
      } catch (e) {
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
    if (inputs?.dispatch) {
      agentResponse = await sendActionsBatch(idem, userAccountId, actions, ua?.whatsapp_phone_number);
    }

    const reportTextRaw = reportTextFromLLM && reportTextFromLLM.trim() ? reportTextFromLLM : buildReport({
      date, accountStatus, insights: insights?.data, actions: inputs?.dispatch ? actions : [],
      lastReports: []
    });
    const reportText = finalizeReportText(reportTextRaw, { adAccountId: ua?.ad_account_id, dateStr: date });

    // Собираем plan для сохранения
    const plan = { planNote, actions, reportText: reportTextFromLLM || null };

    // Save report/logs
    let execStatus = 'success';
    if (supabase) {
      try {
        await supabase.from('campaign_reports').insert({
          telegram_id: String(ua.telegram_id || ''),
          report_data: { text: reportText, date, planNote, actions }
        });
      } catch (e) {
        fastify.log.warn({ msg:'save_campaign_report_failed', error:String(e) });
      }
      try {
        await supabase.from('brain_executions').insert({
          user_account_id: userAccountId,
          idempotency_key: idem,
          plan_json: plan,
          actions_json: actions,
          executor_response_json: agentResponse,
          report_text: reportText,
          status: execStatus,
          duration_ms: Date.now() - started
        });
      } catch (e) {
        fastify.log.warn({ msg:'save_brain_execution_failed', error:String(e) });
      }
    }

    // Send Telegram (по умолчанию включено, отключается через sendReport: false)
    const shouldSendTelegram = inputs?.sendReport !== false;
    const sent = shouldSendTelegram ? await sendTelegram(ua.telegram_id, reportText, ua.telegram_bot_token) : false;

    return reply.send({
      idempotencyKey: idem,
      planNote,
      actions,
      dispatched: !!inputs?.dispatch,
      agentResponse,
      telegramSent: sent,
      trace: { adsets: traceAdsets },
      reportText,
      usedAdAccountId: ua?.ad_account_id || null,
      ...(BRAIN_DEBUG_LLM ? { llm: { used: CAN_USE_LLM, model: MODEL, input: llmInput, plan: planLLMRaw } } : {})
    });
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({ error:'brain_run_failed', details:String(err?.message || err) });
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
    return reply.code(500).send({ error:'brain_decide_failed', details:String(err?.message || err) });
  }
});

// ========================================
// CRON: Ежедневный запуск для всех активных пользователей
// ========================================

/**
 * Получить всех активных пользователей из Supabase
 */
async function getActiveUsers() {
  if (!supabase) {
    fastify.log.warn('Supabase not configured, skipping getActiveUsers');
    return [];
  }
  
  try {
    const { data, error } = await supabase
      .from('user_accounts')
      .select('id, username, telegram_id, telegram_bot_token, account_timezone')
      .eq('is_active', true)
      .eq('optimization', 'agent2');
    
    if (error) {
      fastify.log.error({ where: 'getActiveUsers', error });
      return [];
    }
    
    fastify.log.info({ where: 'getActiveUsers', count: data?.length || 0, filter: 'optimization=agent2' });
    
    return data || [];
  } catch (err) {
    fastify.log.error({ where: 'getActiveUsers', err: String(err) });
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
 */
async function processUser(user) {
  const startTime = Date.now();
  fastify.log.info({ where: 'processUser', userId: user.id, username: user.username, status: 'started' });
  
  try {
    // Вызываем основной эндпоинт /api/brain/run с dispatch=true
    const response = await fetch('http://localhost:7080/api/brain/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userAccountId: user.id,
        inputs: { dispatch: true }
      })
    });
    
    if (!response.ok) {
      throw new Error(`Brain run failed: ${response.status}`);
    }
    
    const result = await response.json();
    
    // Отправляем отчет в Telegram
    let telegramResult = null;
    if (result.reportText && user.telegram_id && user.telegram_bot_token) {
      telegramResult = await sendTelegramReport(
        user.telegram_id,
        user.telegram_bot_token,
        result.reportText
      );
    }
    
    const duration = Date.now() - startTime;
    fastify.log.info({
      where: 'processUser',
      userId: user.id,
      username: user.username,
      status: 'completed',
      duration,
      actionsCount: result.actions?.length || 0,
      dispatched: result.dispatched,
      telegramSent: telegramResult?.success || false
    });
    
    return {
      userId: user.id,
      username: user.username,
      success: true,
      actionsCount: result.actions?.length || 0,
      telegramSent: telegramResult?.success || false,
      duration
    };
  } catch (err) {
    const duration = Date.now() - startTime;
    fastify.log.error({
      where: 'processUser',
      userId: user.id,
      username: user.username,
      status: 'failed',
      duration,
      error: String(err?.message || err)
    });
    
    return {
      userId: user.id,
      username: user.username,
      success: false,
      error: String(err?.message || err),
      duration
    };
  }
}

/**
 * Batch-обработка всех активных пользователей (поочередно)
 */
async function processDailyBatch() {
  const batchStartTime = Date.now();
  fastify.log.info({ where: 'processDailyBatch', status: 'started' });
  
  try {
    const users = await getActiveUsers();
    
    if (users.length === 0) {
      fastify.log.info({ where: 'processDailyBatch', status: 'no_active_users' });
      return { success: true, usersProcessed: 0, results: [] };
    }
    
    fastify.log.info({ where: 'processDailyBatch', usersCount: users.length });
    
    const results = [];
    
    // Обрабатываем пользователей поочередно (не параллельно)
    for (const user of users) {
      const result = await processUser(user);
      results.push(result);
      
      // Небольшая пауза между пользователями (опционально)
      if (users.indexOf(user) < users.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
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
  }
}

// Эндпоинт для проверки выборки пользователей (без обработки)
fastify.get('/api/brain/cron/check-users', async (request, reply) => {
  try {
    const users = await getActiveUsers();
    return reply.send({
      success: true,
      usersCount: users.length,
      users: users.map(u => ({
        id: u.id,
        username: u.username,
        has_telegram: !!(u.telegram_id && u.telegram_bot_token),
        timezone: u.account_timezone
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
    return reply.code(500).send({ error: 'batch_failed', details: String(err?.message || err) });
  }
});

// Настройка cron: каждый день в 08:00
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 8 * * *'; // 08:00 каждый день
const CRON_ENABLED = process.env.CRON_ENABLED !== 'false'; // По умолчанию включен

if (CRON_ENABLED) {
  cron.schedule(CRON_SCHEDULE, async () => {
    fastify.log.info({ where: 'cron', schedule: CRON_SCHEDULE, status: 'triggered' });
    await processDailyBatch();
  }, {
    scheduled: true,
    timezone: "Asia/Almaty" // Можно сделать динамическим если нужно
  });
  
  fastify.log.info({ where: 'cron', schedule: CRON_SCHEDULE, timezone: 'Asia/Almaty', status: 'scheduled' });
} else {
  fastify.log.info({ where: 'cron', status: 'disabled' });
}

const port = Number(process.env.BRAIN_PORT || 7080);
fastify.listen({ host:'0.0.0.0', port }).then(()=>fastify.log.info(`Brain listening on ${port}`)).catch(err=>{ fastify.log.error(err); process.exit(1); });
