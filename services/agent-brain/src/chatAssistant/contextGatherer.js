/**
 * Context Gatherer for Chat Assistant
 * Collects relevant context data before LLM call with token budgeting
 *
 * NOTE: For conversation/message CRUD operations, prefer using unifiedStore.
 * This module focuses on gathering context data (metrics, profiles, etc.)
 */

import { supabase, supabaseQuery } from '../lib/supabaseClient.js';
import { logger } from '../lib/logger.js';
import { logErrorToAdmin } from '../lib/errorLogger.js';
import { unifiedStore } from './stores/unifiedStore.js';
import { TokenBudget } from './shared/tokenBudget.js';
import { formatBrainActionsForNotes } from './shared/brainRules.js';

/**
 * Gather all context needed for the chat assistant with token budgeting
 * @param {Object} params
 * @param {string} params.userAccountId - User account ID
 * @param {string} params.adAccountId - Ad account ID (optional)
 * @param {string} params.conversationId - Current conversation ID
 * @param {Object} params.budget - Optional custom budget configuration
 * @returns {Promise<Object>} Context data with stats
 */
export async function gatherContext({ userAccountId, adAccountId, conversationId, budget = {} }) {
  const tokenBudget = new TokenBudget(budget);

  try {
    // Run queries in parallel for speed
    const [
      chatHistory,
      businessProfile,
      todayMetrics,
      activeContexts,
      directions
    ] = await Promise.allSettled([
      getChatHistory(conversationId),
      getBusinessProfile(userAccountId, adAccountId),
      getTodayMetrics(userAccountId, adAccountId),
      getActiveContexts(userAccountId, adAccountId),
      getDirections(userAccountId, adAccountId)
    ]);

    // Add blocks with priorities (higher = more important, kept first)
    // Priority 10: Chat history — most important for continuity
    if (chatHistory.status === 'fulfilled' && chatHistory.value) {
      tokenBudget.addBlock('recentMessages', chatHistory.value, 10);
    }

    // Priority 9: Directions — critical for ads/creative context
    // LLM needs to know direction IDs, names, budgets, target CPL
    if (directions.status === 'fulfilled' && directions.value?.length > 0) {
      tokenBudget.addBlock('directions', directions.value, 9);
    }

    // Priority 8: Today's metrics — current state
    if (todayMetrics.status === 'fulfilled' && todayMetrics.value) {
      tokenBudget.addBlock('todayMetrics', todayMetrics.value, 8);
    }

    // Priority 6: Business profile — context about the business
    if (businessProfile.status === 'fulfilled' && businessProfile.value) {
      tokenBudget.addBlock('businessProfile', businessProfile.value, 6);
    }

    // Priority 4: Active contexts — promotional contexts
    if (activeContexts.status === 'fulfilled' && activeContexts.value) {
      tokenBudget.addBlock('activeContexts', activeContexts.value, 4);
    }

    // Build context with budgeting
    const { context, stats } = tokenBudget.build();

    logger.debug({
      userAccountId,
      conversationId,
      contextStats: {
        usedTokens: stats.usedTokens,
        budget: stats.budget,
        utilization: stats.utilization + '%',
        blocks: stats.blocksIncluded
      }
    }, 'Context gathered with token budgeting');

    return context;

  } catch (error) {
    logger.error({ error: error.message }, 'Failed to gather context');

    logErrorToAdmin({
      user_account_id: userAccountId,
      error_type: 'api',
      raw_error: error.message || String(error),
      stack_trace: error.stack,
      action: 'gather_context',
      severity: 'warning'
    }).catch(() => {});

    return {};
  }
}

/**
 * Get recent chat history for conversation
 */
async function getChatHistory(conversationId) {
  if (!conversationId) return [];

  const { data, error } = await supabase
    .from('ai_messages')
    .select('role, content, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    logger.warn({ error: error.message }, 'Failed to get chat history');
    return [];
  }

  // Return in chronological order
  return (data || []).reverse();
}

/**
 * Get business profile for personalized context
 */
async function getBusinessProfile(userAccountId, adAccountId) {
  let query = supabase
    .from('business_profile')
    .select('*')
    .eq('user_account_id', userAccountId);

  // Фильтр по account_id для мультиаккаунтности
  if (adAccountId) {
    query = query.eq('account_id', adAccountId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    logger.warn({ error: error.message }, 'Failed to get business profile');
    return null;
  }

  return data;
}

/**
 * Get today's campaign metrics summary from scoring_executions
 * scoring_output содержит готовую выжимку метрик (обновляется каждый день в 08:00)
 */
async function getTodayMetrics(userAccountId, adAccountId) {
  try {
    // 1. Получить последний scoring_output (обновляется каждый день в 08:00)
    let query = supabase
      .from('scoring_executions')
      .select('scoring_output, created_at')
      .eq('user_account_id', userAccountId)
      .eq('status', 'success')
      .order('created_at', { ascending: false })
      .limit(1);

    // Для мультиаккаунтности фильтруем по account_id
    if (adAccountId) {
      query = query.eq('account_id', adAccountId);
    }

    const { data: execution, error } = await query.maybeSingle();

    if (error) {
      logger.warn({ error: error.message }, 'Failed to get scoring_executions');
      return null;
    }

    if (!execution?.scoring_output) {
      return null;
    }

    // Check freshness — if data is older than 3 days, don't show it
    const dataAge = Date.now() - new Date(execution.created_at).getTime();
    const maxAgeDays = 3;
    if (dataAge > maxAgeDays * 24 * 60 * 60 * 1000) {
      logger.info({
        dataDate: execution.created_at,
        ageDays: Math.round(dataAge / (24 * 60 * 60 * 1000))
      }, 'Scoring data too old, skipping');
      return null;
    }

    // 2. Извлечь агрегированные метрики из adsets
    const { adsets, ready_creatives } = execution.scoring_output;

    if (!adsets?.length) {
      return null;
    }

    // 3. Суммировать по всем adsets (metrics_last_7d — это агрегат за 7 дней)
    const totals = adsets.reduce((acc, adset) => {
      const m = adset.metrics_last_7d || {};
      return {
        spend: acc.spend + (parseFloat(m.spend) || 0),
        leads: acc.leads + (parseInt(m.total_leads) || 0),
        impressions: acc.impressions + (parseInt(m.impressions) || 0),
        clicks: acc.clicks + (parseInt(m.clicks) || 0)
      };
    }, { spend: 0, leads: 0, impressions: 0, clicks: 0 });

    // Округляем spend
    totals.spend = Math.round(totals.spend * 100) / 100;
    totals.cpl = totals.leads > 0 ? Math.round(totals.spend / totals.leads) : null;
    totals.active_adsets = adsets.length;
    totals.active_creatives = ready_creatives?.filter(c => c.has_data)?.length || 0;
    totals.data_date = execution.created_at;
    totals.period = 'last_7d'; // scoring_output содержит метрики за 7 дней

    return totals;

  } catch (error) {
    logger.warn({ error: error.message }, 'Error getting today metrics from scoring_executions');
    return null;
  }
}

/**
 * Get active promotional contexts
 * @param {string} userAccountId
 * @param {string} [adAccountId] - UUID из ad_accounts для мультиаккаунтности
 */
async function getActiveContexts(userAccountId, adAccountId) {
  let query = supabase
    .from('campaign_contexts')
    .select('id, title, content, context_type')
    .eq('user_account_id', userAccountId)
    .eq('is_active', true);

  // Фильтр по account_id для мультиаккаунтности
  if (adAccountId) {
    query = query.eq('account_id', adAccountId);
  }

  const { data, error } = await query.limit(5);

  if (error) {
    logger.warn({ error: error.message }, 'Failed to get active contexts');
    return [];
  }

  return data || [];
}

// ============================================================
// BUSINESS SNAPSHOT (Snapshot-First Pattern)
// ============================================================

/**
 * Get compact business snapshot for context
 * Provides aggregated view of ads, creatives, CRM in one call
 *
 * @param {Object} params
 * @param {string} params.userAccountId
 * @param {string} [params.adAccountId]
 * @returns {Promise<Object>} Business snapshot
 */
export async function getBusinessSnapshot({ userAccountId, adAccountId }) {
  const startTime = Date.now();

  try {
    // Run all queries in parallel
    const [
      scoringResult,
      directionsResult,
      creativesResult,
      notesResult
    ] = await Promise.allSettled([
      getAdsSnapshot(userAccountId, adAccountId),
      getDirectionsSnapshot(userAccountId, adAccountId),
      getCreativesSnapshot(userAccountId, adAccountId),
      getNotesSnapshot(userAccountId, adAccountId)
    ]);

    // Build snapshot
    const snapshot = {
      ads: scoringResult.status === 'fulfilled' ? scoringResult.value : null,
      directions: directionsResult.status === 'fulfilled' ? directionsResult.value : null,
      creatives: creativesResult.status === 'fulfilled' ? creativesResult.value : null,
      notes: notesResult.status === 'fulfilled' ? notesResult.value : {},

      // Metadata
      generatedAt: new Date().toISOString(),
      latencyMs: Date.now() - startTime,
      freshness: determineFreshness(scoringResult.value?.dataDate)
    };

    logger.debug({
      userAccountId,
      latencyMs: snapshot.latencyMs,
      freshness: snapshot.freshness
    }, 'Business snapshot generated');

    return snapshot;

  } catch (error) {
    logger.error({ error: error.message }, 'Failed to generate business snapshot');
    return {
      ads: null,
      directions: null,
      creatives: null,
      notes: {},
      generatedAt: new Date().toISOString(),
      latencyMs: Date.now() - startTime,
      freshness: 'error'
    };
  }
}

/**
 * Get ads snapshot from scoring_executions
 * Returns aggregated metrics + full scoring details for AdsAgent prompt
 */
async function getAdsSnapshot(userAccountId, adAccountId) {
  let query = supabase
    .from('scoring_executions')
    .select('scoring_output, created_at')
    .eq('user_account_id', userAccountId)
    .eq('status', 'success')
    .order('created_at', { ascending: false })
    .limit(1);

  if (adAccountId) {
    query = query.eq('account_id', adAccountId);
  }

  const { data: execution, error } = await query.maybeSingle();

  if (error || !execution?.scoring_output) {
    return null;
  }

  const { adsets, ready_creatives, unused_creatives } = execution.scoring_output;

  if (!adsets?.length) {
    return null;
  }

  // Aggregate metrics
  const totals = adsets.reduce((acc, adset) => {
    const m = adset.metrics_last_7d || {};
    return {
      spend: acc.spend + (parseFloat(m.spend) || 0),
      leads: acc.leads + (parseInt(m.total_leads) || 0),
      impressions: acc.impressions + (parseInt(m.impressions) || 0),
      clicks: acc.clicks + (parseInt(m.clicks) || 0)
    };
  }, { spend: 0, leads: 0, impressions: 0, clicks: 0 });

  // Find best/worst by CPL
  const adsetsWithCPL = adsets
    .map(a => ({
      name: a.adset_name,
      campaignId: a.campaign_id,
      spend: parseFloat(a.metrics_last_7d?.spend) || 0,
      leads: parseInt(a.metrics_last_7d?.total_leads) || 0
    }))
    .filter(a => a.leads > 0)
    .map(a => ({ ...a, cpl: Math.round(a.spend / a.leads) }))
    .sort((a, b) => a.cpl - b.cpl);

  return {
    period: 'last_7d',
    spend: Math.round(totals.spend * 100) / 100,
    leads: totals.leads,
    cpl: totals.leads > 0 ? Math.round(totals.spend / totals.leads) : null,
    impressions: totals.impressions,
    clicks: totals.clicks,
    activeAdsets: adsets.length,
    activeCreatives: ready_creatives?.filter(c => c.has_data)?.length || 0,
    topAdset: adsetsWithCPL[0] || null,
    worstAdset: adsetsWithCPL[adsetsWithCPL.length - 1] || null,
    dataDate: execution.created_at,

    // Full scoring details for AdsAgent prompt (Brain rules integration)
    scoringDetails: {
      adsets: adsets,                      // Full adsets with trends, metrics
      ready_creatives: ready_creatives,     // Creatives with performance data
      unused_creatives: unused_creatives    // Unused creatives for rotation
    }
  };
}

/**
 * Get directions snapshot from direction_metrics_rollup
 */
async function getDirectionsSnapshot(userAccountId, adAccountId) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  let query = supabase
    .from('direction_metrics_rollup')
    .select('direction_id, spend, leads, cpl, active_creatives_count')
    .eq('user_account_id', userAccountId)
    .gte('day', sevenDaysAgo);

  if (adAccountId) {
    query = query.eq('account_id', adAccountId);
  }

  const { data, error } = await query;

  if (error || !data?.length) {
    return null;
  }

  // Aggregate by direction
  const byDirection = {};
  data.forEach(row => {
    const id = row.direction_id;
    if (!byDirection[id]) {
      byDirection[id] = { spend: 0, leads: 0, activeCreatives: 0 };
    }
    byDirection[id].spend += parseFloat(row.spend) || 0;
    byDirection[id].leads += parseInt(row.leads) || 0;
    byDirection[id].activeCreatives = Math.max(byDirection[id].activeCreatives, row.active_creatives_count || 0);
  });

  const directions = Object.entries(byDirection)
    .map(([id, d]) => ({
      id,
      spend: Math.round(d.spend * 100) / 100,
      leads: d.leads,
      cpl: d.leads > 0 ? Math.round(d.spend / d.leads) : null,
      activeCreatives: d.activeCreatives
    }))
    .sort((a, b) => (a.cpl || 9999) - (b.cpl || 9999));

  return {
    count: directions.length,
    totalSpend: directions.reduce((sum, d) => sum + d.spend, 0),
    totalLeads: directions.reduce((sum, d) => sum + d.leads, 0),
    topDirection: directions[0] || null,
    worstDirection: directions[directions.length - 1] || null
  };
}

/**
 * Get creatives snapshot from creative_scores / creative_analysis
 */
async function getCreativesSnapshot(userAccountId, adAccountId) {
  // Get creative scores (risk assessment)
  let scoresQuery = supabase
    .from('creative_scores')
    .select('user_creative_id, score, verdict, created_at')
    .eq('user_account_id', userAccountId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (adAccountId) {
    scoresQuery = scoresQuery.eq('account_id', adAccountId);
  }

  const { data: scores, error } = await scoresQuery;

  if (error || !scores?.length) {
    return null;
  }

  // Group by creative, take latest score
  const latestScores = {};
  scores.forEach(s => {
    if (!latestScores[s.user_creative_id]) {
      latestScores[s.user_creative_id] = s;
    }
  });

  const allScores = Object.values(latestScores);
  const highRisk = allScores.filter(s => s.score >= 70);
  const avgScore = allScores.length > 0
    ? Math.round(allScores.reduce((sum, s) => sum + s.score, 0) / allScores.length)
    : null;

  return {
    totalWithScores: allScores.length,
    avgRiskScore: avgScore,
    highRiskCount: highRisk.length,
    highRiskCreatives: highRisk.slice(0, 3).map(s => ({
      id: s.user_creative_id,
      score: s.score,
      verdict: s.verdict
    }))
  };
}

/**
 * Get notes snapshot from agent_notes
 */
async function getNotesSnapshot(userAccountId, adAccountId) {
  const { memoryStore } = await import('./stores/memoryStore.js');
  return memoryStore.getNotesDigest(userAccountId, adAccountId, ['ads', 'creative'], 3);
}

/**
 * Get directions (advertising verticals) for context
 * Returns list of directions with their settings (budget, target CPL, campaign ID)
 * Critical for ads/creative domain agents
 */
async function getDirections(userAccountId, adAccountId) {
  let query = supabase
    .from('account_directions')
    .select(`
      id,
      name,
      is_active,
      daily_budget_cents,
      target_cpl_cents,
      fb_campaign_id,
      objective,
      created_at
    `)
    .eq('user_account_id', userAccountId)
    .order('is_active', { ascending: false })
    .order('name', { ascending: true });

  // Filter by ad account for multi-account support
  if (adAccountId) {
    query = query.eq('account_id', adAccountId);
  }

  const { data, error } = await query;

  if (error) {
    logger.warn({ error: error.message }, 'Failed to get directions');
    return [];
  }

  // Format for context - include all relevant fields for domain agents
  return (data || []).map(d => ({
    id: d.id,
    name: d.name,
    is_active: d.is_active,
    daily_budget_cents: d.daily_budget_cents,
    target_cpl_cents: d.target_cpl_cents,
    fb_campaign_id: d.fb_campaign_id,
    objective: d.objective
  }));
}

/**
 * Determine data freshness
 */
function determineFreshness(dataDate) {
  if (!dataDate) return 'missing';

  const hoursAgo = (Date.now() - new Date(dataDate).getTime()) / (1000 * 60 * 60);

  if (hoursAgo < 24) return 'fresh';      // Less than 24 hours
  if (hoursAgo < 48) return 'stale';      // 24-48 hours
  return 'outdated';                       // More than 48 hours
}

/**
 * Format business snapshot for injection into prompt
 * @param {Object} snapshot
 * @returns {string}
 */
export function formatSnapshotForPrompt(snapshot) {
  if (!snapshot || snapshot.freshness === 'error') {
    return '';
  }

  const lines = ['## Текущее состояние бизнеса\n'];

  // Ads summary
  if (snapshot.ads) {
    const a = snapshot.ads;
    lines.push(`**Реклама (${a.period}):**`);
    lines.push(`• Расход: $${a.spend} | Лиды: ${a.leads} | CPL: ${a.cpl || 'N/A'}`);
    lines.push(`• Активных адсетов: ${a.activeAdsets} | Креативов: ${a.activeCreatives}`);
    if (a.topAdset) {
      lines.push(`• Лучший: ${a.topAdset.name} (CPL: $${a.topAdset.cpl})`);
    }
    if (a.worstAdset && a.worstAdset !== a.topAdset) {
      lines.push(`• Худший: ${a.worstAdset.name} (CPL: $${a.worstAdset.cpl})`);
    }
    lines.push('');
  }

  // Creatives summary
  if (snapshot.creatives) {
    const c = snapshot.creatives;
    lines.push(`**Креативы:**`);
    lines.push(`• С оценками: ${c.totalWithScores} | Avg Risk: ${c.avgRiskScore || 'N/A'}`);
    if (c.highRiskCount > 0) {
      lines.push(`• ⚠️ Высокий риск: ${c.highRiskCount} креативов`);
    }
    lines.push('');
  }

  // Directions summary
  if (snapshot.directions) {
    const d = snapshot.directions;
    lines.push(`**Направления:**`);
    lines.push(`• Активных: ${d.count} | Расход: $${d.totalSpend} | Лиды: ${d.totalLeads}`);
    lines.push('');
  }

  // Notes
  if (snapshot.notes && Object.keys(snapshot.notes).length > 0) {
    lines.push(`**Заметки:**`);
    for (const [domain, notes] of Object.entries(snapshot.notes)) {
      if (notes?.length > 0) {
        notes.forEach(n => lines.push(`• [${domain}] ${n.text}`));
      }
    }
    lines.push('');
  }

  lines.push(`_Данные: ${snapshot.freshness === 'fresh' ? 'актуальные' : snapshot.freshness}_`);
  lines.push('---\n');

  return lines.join('\n');
}

/**
 * Get or create a conversation
 * @deprecated Use unifiedStore.getOrCreate() for new code
 */
export async function getOrCreateConversation({ userAccountId, adAccountId, conversationId, mode }) {
  // Delegate to unifiedStore for unified behavior
  if (conversationId) {
    const existing = await unifiedStore.getById(conversationId);
    if (existing && existing.user_account_id === userAccountId) {
      return existing;
    }
  }

  // Create via unifiedStore (source: 'web' for backward compatibility)
  return await unifiedStore.getOrCreate({
    source: 'web',
    userAccountId,
    adAccountId,
    mode
  });
}

/**
 * Save a message to the conversation
 * @deprecated Use unifiedStore.addMessage() for new code
 */
export async function saveMessage({ conversationId, role, content, planJson, actionsJson, toolCallsJson, uiJson, agent, domain }) {
  // Delegate to unifiedStore for unified behavior
  return await unifiedStore.addMessage(conversationId, {
    role,
    content,
    planJson,
    actionsJson,
    toolCalls: toolCallsJson,
    uiJson,
    agent,
    domain
  });
}

/**
 * Update conversation title (auto-generated from first message)
 */
export async function updateConversationTitle(conversationId, message) {
  // Generate title from first user message (truncated)
  const title = message.slice(0, 50) + (message.length > 50 ? '...' : '');

  await supabase
    .from('ai_conversations')
    .update({ title })
    .eq('id', conversationId);
}

/**
 * Get list of conversations for user
 */
export async function getConversations({ userAccountId, adAccountId, limit = 20, source = null }) {
  let query = supabase
    .from('ai_conversations')
    .select('id, title, mode, source, last_agent, last_domain, updated_at, created_at')
    .eq('user_account_id', userAccountId)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (adAccountId) {
    query = query.eq('ad_account_id', adAccountId);
  }

  // Filter by source if specified (web, telegram)
  if (source) {
    query = query.eq('source', source);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to get conversations: ${error.message}`);
  }

  return data || [];
}

/**
 * Delete a conversation
 */
export async function deleteConversation(conversationId, userAccountId) {
  const { error } = await supabase
    .from('ai_conversations')
    .delete()
    .eq('id', conversationId)
    .eq('user_account_id', userAccountId);

  if (error) {
    throw new Error(`Failed to delete conversation: ${error.message}`);
  }

  return { success: true };
}

/**
 * Get business specs (procedural memory)
 * @param {string} userAccountId
 * @param {string|null} accountId - For multi-account: ad_account FK, null for legacy
 * @returns {Promise<Object>} { tracking, crm, kpi }
 * @deprecated Use memoryStore.getSpecs() directly
 */
export async function getSpecs(userAccountId, accountId = null) {
  const { memoryStore } = await import('./stores/memoryStore.js');
  return memoryStore.getSpecs(userAccountId, accountId);
}

/**
 * Get agent notes digest (mid-term memory)
 * @param {string} userAccountId
 * @param {string|null} accountId
 * @returns {Promise<Object>} { ads: [...], creative: [...], ... }
 */
export async function getNotesDigest(userAccountId, accountId = null) {
  const { memoryStore } = await import('./stores/memoryStore.js');
  return memoryStore.getNotesDigest(userAccountId, accountId);
}

// ============================================================
// BRAIN ACTIONS HISTORY
// ============================================================

/**
 * Get recent Brain agent actions for context
 * Queries brain_executions table for last 3 days
 *
 * @param {string} userAccountId
 * @param {string} [adAccountId]
 * @returns {Promise<Array>} Array of formatted notes from Brain actions
 */
export async function getRecentBrainActions(userAccountId, adAccountId) {
  try {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

    let query = supabase
      .from('brain_executions')
      .select('actions_json, plan_json, created_at, status')
      .eq('user_account_id', userAccountId)
      .gte('created_at', threeDaysAgo)
      .order('created_at', { ascending: false })
      .limit(5);

    // Filter by account_id if provided
    if (adAccountId) {
      query = query.eq('account_id', adAccountId);
    }

    const { data, error } = await query;

    if (error) {
      logger.warn({ error: error.message }, 'Failed to get brain executions');
      return [];
    }

    if (!data?.length) {
      return [];
    }

    // Format using shared function from brainRules.js
    return formatBrainActionsForNotes(data);

  } catch (error) {
    logger.warn({ error: error.message }, 'Error getting recent brain actions');
    return [];
  }
}

// ============================================================
// INTEGRATIONS CHECK
// ============================================================

/**
 * Check which integrations are available for user
 * Used by agents to avoid calling unavailable tools
 *
 * @param {string} userAccountId
 * @param {string} [adAccountId] - UUID from ad_accounts
 * @param {boolean} [hasFbToken] - Whether FB access token is available
 * @returns {Promise<Object>} { fb, crm, roi, whatsapp }
 */
export async function getIntegrations(userAccountId, adAccountId, hasFbToken = false) {
  try {
    const [leadsResult, purchasesResult, waResult] = await Promise.allSettled([
      // Check CRM: has any leads?
      supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('user_account_id', userAccountId)
        .limit(1),
      // Check ROI: has any purchases?
      supabase
        .from('purchases')
        .select('id', { count: 'exact', head: true })
        .eq('user_account_id', userAccountId)
        .limit(1),
      // Check WhatsApp: has evolution_api configured?
      supabase
        .from('integrations')
        .select('id')
        .eq('user_account_id', userAccountId)
        .eq('type', 'evolution_api')
        .eq('is_active', true)
        .maybeSingle()
    ]);

    const hasCRM = leadsResult.status === 'fulfilled' &&
      (leadsResult.value?.count > 0 || leadsResult.value?.data?.length > 0);

    const hasROI = purchasesResult.status === 'fulfilled' &&
      (purchasesResult.value?.count > 0 || purchasesResult.value?.data?.length > 0);

    const hasWhatsApp = waResult.status === 'fulfilled' &&
      waResult.value?.data !== null;

    return {
      fb: hasFbToken,           // Facebook Ads connected
      crm: hasCRM,              // Has leads data
      roi: hasROI,              // Has purchases (for ROI calc)
      whatsapp: hasWhatsApp     // WhatsApp integration active
    };

  } catch (error) {
    logger.warn({ error: error.message }, 'Failed to check integrations');
    return {
      fb: hasFbToken,
      crm: false,
      roi: false,
      whatsapp: false
    };
  }
}

/**
 * Определить стек интеграций клиента
 * @param {Object} integrations - { fb, crm, roi, whatsapp }
 * @returns {string} - Stack ID: 'fb_only' | 'fb_wa' | 'fb_crm' | 'fb_wa_crm' | 'no_fb'
 */
export function getIntegrationStack(integrations) {
  if (!integrations) return 'no_fb';

  const { fb, crm, whatsapp } = integrations;

  if (!fb) return 'no_fb';
  if (fb && whatsapp && crm) return 'fb_wa_crm';
  if (fb && whatsapp && !crm) return 'fb_wa';
  if (fb && !whatsapp && crm) return 'fb_crm';
  return 'fb_only';
}

/**
 * Получить человекочитаемое описание стека
 * @param {string} stack - Stack ID
 * @returns {string}
 */
export function getStackDescription(stack) {
  const descriptions = {
    no_fb: 'Facebook не подключён. Доступны только базовые функции.',
    fb_only: 'Подключён только Facebook Ads. Данные о лидах и диалогах недоступны.',
    fb_wa: 'Facebook Ads + WhatsApp. Можно анализировать диалоги, но нет CRM.',
    fb_crm: 'Facebook Ads + CRM. Есть данные о лидах, но нет WhatsApp переписок.',
    fb_wa_crm: 'Полный стек: Facebook + WhatsApp + CRM. Все функции доступны.'
  };
  return descriptions[stack] || descriptions.fb_only;
}

/**
 * Получить список доступных возможностей для стека
 * @param {string} stack - Stack ID
 * @returns {string[]}
 */
export function getStackCapabilities(stack) {
  const caps = {
    no_fb: ['general_questions'],
    fb_only: ['campaigns', 'adsets', 'creatives', 'spend', 'cpl'],
    fb_wa: ['campaigns', 'adsets', 'creatives', 'spend', 'cpl', 'dialogs', 'dialog_analysis'],
    fb_crm: ['campaigns', 'adsets', 'creatives', 'spend', 'cpl', 'leads', 'funnel', 'revenue'],
    fb_wa_crm: ['campaigns', 'adsets', 'creatives', 'spend', 'cpl', 'dialogs', 'dialog_analysis', 'leads', 'funnel', 'revenue']
  };
  return caps[stack] || caps.fb_only;
}

/**
 * Получить короткое название стека для UI
 * @param {string} stack - Stack ID
 * @returns {string}
 */
export function getStackLabel(stack) {
  const labels = {
    no_fb: 'Нет FB',
    fb_only: 'FB Only',
    fb_wa: 'FB + WhatsApp',
    fb_crm: 'FB + CRM',
    fb_wa_crm: 'Полный стек'
  };
  return labels[stack] || 'Unknown';
}

/**
 * Format integrations for prompt with stack info
 * @param {Object} integrations
 * @param {string} stack - Optional stack ID (will be calculated if not provided)
 * @returns {string}
 */
export function formatIntegrationsForPrompt(integrations, stack = null) {
  if (!integrations) return '';

  const effectiveStack = stack || getIntegrationStack(integrations);
  const lines = [];

  lines.push('## Стек клиента');
  lines.push(`**Тип:** ${getStackLabel(effectiveStack)}`);
  lines.push(`**Описание:** ${getStackDescription(effectiveStack)}`);
  lines.push('');
  lines.push('**Интеграции:**');
  lines.push(`• Facebook Ads: ${integrations.fb ? '✅' : '❌'}`);
  lines.push(`• WhatsApp: ${integrations.whatsapp ? '✅' : '❌'}`);
  lines.push(`• CRM (лиды): ${integrations.crm ? '✅' : '❌'}`);
  lines.push(`• ROI (покупки): ${integrations.roi ? '✅' : '❌'}`);
  lines.push('');

  // Добавить важные ограничения
  if (effectiveStack === 'fb_only') {
    lines.push('**Ограничения:** Нет данных о диалогах и лидах. Не предлагай анализ качества лидов.');
  } else if (effectiveStack === 'fb_wa') {
    lines.push('**Ограничения:** Нет CRM. Можно анализировать диалоги, но нет данных о воронке.');
  } else if (effectiveStack === 'fb_crm') {
    lines.push('**Ограничения:** Нет WhatsApp. Нельзя анализировать переписки.');
  }

  return lines.join('\n');
}

// Re-export stores for convenience
export { unifiedStore } from './stores/unifiedStore.js';
export { memoryStore } from './stores/memoryStore.js';

export default {
  gatherContext,
  getOrCreateConversation,
  saveMessage,
  updateConversationTitle,
  getConversations,
  deleteConversation,
  getSpecs,
  getNotesDigest,
  getRecentBrainActions,
  getBusinessSnapshot,
  getIntegrations,
  formatIntegrationsForPrompt,
  // Stack functions
  getIntegrationStack,
  getStackDescription,
  getStackCapabilities,
  getStackLabel,
  // Also expose stores on default export
  unifiedStore
};
