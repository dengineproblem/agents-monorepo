/**
 * MCP Resources Registry
 *
 * Phase 3: Реестр ресурсов MCP. Ресурсы - это статические данные,
 * которые модель может запросить (метрики, snapshot, заметки).
 *
 * Resources:
 * - project://metrics/today - Метрики за 7 дней из scoring_output
 * - project://snapshot/business - Полный снимок бизнеса
 * - project://notes/{domain} - Заметки агента по домену
 * - project://brain/actions - История Brain за 3 дня
 */

import { supabase } from '../../lib/supabaseClient.js';
import { logger } from '../../lib/logger.js';

/**
 * Resource definitions
 * URI format: project://{category}/{name}
 */
const resourceDefinitions = [
  {
    uri: 'project://metrics/today',
    name: 'Today Metrics',
    description: 'Агрегированные метрики за последние 7 дней (spend, leads, CPL)',
    mimeType: 'application/json'
  },
  {
    uri: 'project://snapshot/business',
    name: 'Business Snapshot',
    description: 'Полный снимок состояния бизнеса: ads, directions, creatives, notes',
    mimeType: 'application/json'
  },
  {
    uri: 'project://notes/{domain}',
    name: 'Agent Notes',
    description: 'Заметки агента по домену (ads, creative, crm, whatsapp)',
    mimeType: 'application/json'
  },
  {
    uri: 'project://brain/actions',
    name: 'Brain Actions',
    description: 'История действий автопилота за последние 3 дня',
    mimeType: 'application/json'
  }
];

// Valid domains for notes
const VALID_DOMAINS = ['ads', 'creative', 'crm', 'whatsapp'];

/**
 * Get all registered resources
 * @returns {Array}
 */
export function getResourceRegistry() {
  return resourceDefinitions.map(r => ({
    uri: r.uri,
    name: r.name,
    description: r.description,
    mimeType: r.mimeType
  }));
}

/**
 * Read resource content
 * @param {string} uri - Resource URI
 * @param {Object} context - Session context { userAccountId, adAccountId }
 * @returns {Promise<Array>} Resource contents
 */
export async function readResource(uri, context) {
  // Parse URI
  const match = uri.match(/^project:\/\/(.+)$/);
  if (!match) {
    throw new Error(`Invalid resource URI: ${uri}`);
  }

  const path = match[1];
  const { userAccountId, adAccountId } = context;

  if (!userAccountId) {
    throw new Error('userAccountId required in context');
  }

  try {
    // Route to specific handler
    if (path === 'metrics/today') {
      return await readMetricsResource(uri, userAccountId, adAccountId);
    }

    if (path === 'snapshot/business') {
      return await readSnapshotResource(uri, userAccountId, adAccountId);
    }

    if (path.startsWith('notes/')) {
      const domain = path.replace('notes/', '');
      return await readNotesResource(uri, userAccountId, adAccountId, domain);
    }

    if (path === 'brain/actions') {
      return await readBrainActionsResource(uri, userAccountId, adAccountId);
    }

    throw new Error(`Unknown resource: ${uri}`);

  } catch (error) {
    logger.error({ error: error.message, uri, userAccountId }, 'MCP resource read failed');
    return [{
      uri,
      mimeType: 'application/json',
      text: JSON.stringify({
        error: error.message,
        uri
      })
    }];
  }
}

// ============================================================
// RESOURCE HANDLERS
// ============================================================

/**
 * Read metrics/today resource
 * Source: scoring_executions.scoring_output
 */
async function readMetricsResource(uri, userAccountId, adAccountId) {
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

  if (error) {
    throw new Error(`Failed to get metrics: ${error.message}`);
  }

  if (!execution?.scoring_output) {
    return [{
      uri,
      mimeType: 'application/json',
      text: JSON.stringify({
        period: 'last_7d',
        message: 'No metrics data available',
        dataDate: null
      })
    }];
  }

  const { adsets, ready_creatives } = execution.scoring_output;

  if (!adsets?.length) {
    return [{
      uri,
      mimeType: 'application/json',
      text: JSON.stringify({
        period: 'last_7d',
        message: 'No adsets data available',
        dataDate: execution.created_at
      })
    }];
  }

  // Aggregate metrics from adsets
  const totals = adsets.reduce((acc, adset) => {
    const m = adset.metrics_last_7d || {};
    return {
      spend: acc.spend + (parseFloat(m.spend) || 0),
      leads: acc.leads + (parseInt(m.total_leads) || 0),
      impressions: acc.impressions + (parseInt(m.impressions) || 0),
      clicks: acc.clicks + (parseInt(m.clicks) || 0)
    };
  }, { spend: 0, leads: 0, impressions: 0, clicks: 0 });

  const metrics = {
    period: 'last_7d',
    spend: Math.round(totals.spend * 100) / 100,
    leads: totals.leads,
    cpl: totals.leads > 0 ? Math.round(totals.spend / totals.leads * 100) / 100 : null,
    impressions: totals.impressions,
    clicks: totals.clicks,
    ctr: totals.impressions > 0 ? Math.round((totals.clicks / totals.impressions) * 10000) / 100 : null,
    activeAdsets: adsets.length,
    activeCreatives: ready_creatives?.filter(c => c.has_data)?.length || 0,
    dataDate: execution.created_at
  };

  return [{
    uri,
    mimeType: 'application/json',
    text: JSON.stringify(metrics)
  }];
}

/**
 * Read snapshot/business resource
 * Aggregates: ads, directions, creatives, notes
 */
async function readSnapshotResource(uri, userAccountId, adAccountId) {
  const startTime = Date.now();

  // Run all queries in parallel
  const [adsResult, directionsResult, creativesResult, notesResult] = await Promise.allSettled([
    getAdsSnapshot(userAccountId, adAccountId),
    getDirectionsSnapshot(userAccountId, adAccountId),
    getCreativesSnapshot(userAccountId, adAccountId),
    getNotesSnapshot(userAccountId, adAccountId)
  ]);

  const snapshot = {
    ads: adsResult.status === 'fulfilled' ? adsResult.value : null,
    directions: directionsResult.status === 'fulfilled' ? directionsResult.value : null,
    creatives: creativesResult.status === 'fulfilled' ? creativesResult.value : null,
    notes: notesResult.status === 'fulfilled' ? notesResult.value : {},
    generatedAt: new Date().toISOString(),
    latencyMs: Date.now() - startTime
  };

  return [{
    uri,
    mimeType: 'application/json',
    text: JSON.stringify(snapshot)
  }];
}

/**
 * Read notes/{domain} resource
 * Source: agent_notes table
 */
async function readNotesResource(uri, userAccountId, adAccountId, domain) {
  if (!VALID_DOMAINS.includes(domain)) {
    throw new Error(`Invalid domain: ${domain}. Valid: ${VALID_DOMAINS.join(', ')}`);
  }

  let query = supabase
    .from('agent_notes')
    .select('id, text, source, importance, created_at')
    .eq('user_account_id', userAccountId)
    .eq('domain', domain)
    .order('importance', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(20);

  if (adAccountId) {
    query = query.eq('account_id', adAccountId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to get notes: ${error.message}`);
  }

  return [{
    uri,
    mimeType: 'application/json',
    text: JSON.stringify({
      domain,
      notes: data || [],
      total: data?.length || 0
    })
  }];
}

/**
 * Read brain/actions resource
 * Source: brain_executions table (last 3 days)
 */
async function readBrainActionsResource(uri, userAccountId, adAccountId) {
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

  let query = supabase
    .from('brain_executions')
    .select('id, actions_json, plan_json, status, created_at')
    .eq('user_account_id', userAccountId)
    .gte('created_at', threeDaysAgo)
    .order('created_at', { ascending: false })
    .limit(10);

  if (adAccountId) {
    query = query.eq('account_id', adAccountId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to get brain actions: ${error.message}`);
  }

  // Format actions for readability
  const actions = (data || []).map(exec => ({
    id: exec.id,
    status: exec.status,
    createdAt: exec.created_at,
    plan: exec.plan_json,
    actions: exec.actions_json
  }));

  return [{
    uri,
    mimeType: 'application/json',
    text: JSON.stringify({
      period: 'last_3d',
      executions: actions,
      total: actions.length
    })
  }];
}

// ============================================================
// SNAPSHOT HELPERS
// ============================================================

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

  const { adsets, ready_creatives } = execution.scoring_output;

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
      spend: parseFloat(a.metrics_last_7d?.spend) || 0,
      leads: parseInt(a.metrics_last_7d?.total_leads) || 0
    }))
    .filter(a => a.leads > 0)
    .map(a => ({ ...a, cpl: Math.round(a.spend / a.leads * 100) / 100 }))
    .sort((a, b) => a.cpl - b.cpl);

  return {
    period: 'last_7d',
    spend: Math.round(totals.spend * 100) / 100,
    leads: totals.leads,
    cpl: totals.leads > 0 ? Math.round(totals.spend / totals.leads * 100) / 100 : null,
    impressions: totals.impressions,
    clicks: totals.clicks,
    activeAdsets: adsets.length,
    activeCreatives: ready_creatives?.filter(c => c.has_data)?.length || 0,
    topAdset: adsetsWithCPL[0] || null,
    worstAdset: adsetsWithCPL[adsetsWithCPL.length - 1] || null,
    dataDate: execution.created_at
  };
}

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
      cpl: d.leads > 0 ? Math.round(d.spend / d.leads * 100) / 100 : null,
      activeCreatives: d.activeCreatives
    }))
    .sort((a, b) => (a.cpl || 9999) - (b.cpl || 9999));

  return {
    count: directions.length,
    totalSpend: Math.round(directions.reduce((sum, d) => sum + d.spend, 0) * 100) / 100,
    totalLeads: directions.reduce((sum, d) => sum + d.leads, 0),
    topDirection: directions[0] || null,
    worstDirection: directions[directions.length - 1] || null
  };
}

async function getCreativesSnapshot(userAccountId, adAccountId) {
  let query = supabase
    .from('creative_scores')
    .select('user_creative_id, score, verdict, created_at')
    .eq('user_account_id', userAccountId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (adAccountId) {
    query = query.eq('account_id', adAccountId);
  }

  const { data: scores, error } = await query;

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

async function getNotesSnapshot(userAccountId, adAccountId) {
  let query = supabase
    .from('agent_notes')
    .select('domain, text, importance')
    .eq('user_account_id', userAccountId)
    .order('importance', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(30);

  if (adAccountId) {
    query = query.eq('account_id', adAccountId);
  }

  const { data, error } = await query;

  if (error || !data?.length) {
    return {};
  }

  // Group by domain
  const byDomain = {};
  data.forEach(note => {
    if (!byDomain[note.domain]) {
      byDomain[note.domain] = [];
    }
    if (byDomain[note.domain].length < 5) {
      byDomain[note.domain].push({
        text: note.text,
        importance: note.importance
      });
    }
  });

  return byDomain;
}

export default { getResourceRegistry, readResource };
