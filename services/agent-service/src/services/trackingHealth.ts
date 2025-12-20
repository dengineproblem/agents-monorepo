/**
 * TRACKING HEALTH SERVICE
 *
 * Iteration 2: Обнаружение проблем с трекингом (pixel/CAPI)
 * - Clicks without results
 * - Sudden result drops
 * - High volatility in results
 */

import { supabase } from '../lib/supabaseClient.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger({ module: 'trackingHealth' });

// ============================================================================
// TYPES
// ============================================================================

interface TrackingIssue {
  weekStartDate: string;
  issueType: 'clicks_no_results' | 'results_dropped' | 'high_volatility';
  severity: 'high' | 'medium' | 'low';
  resultFamily: string;
  details: {
    linkClicks?: number;
    resultsCount?: number;
    spend?: number;
    previousResults?: number;
    dropPct?: number;
    volatilityCv?: number;
  };
  recommendations: string[];
}

interface TrackingHealthReport {
  period: { start: string; end: string };
  summary: {
    totalIssues: number;
    highSeverity: number;
    mediumSeverity: number;
    lowSeverity: number;
    issuesByType: Record<string, number>;
  };
  issues: TrackingIssue[];
  overall: {
    healthScore: number; // 0-100
    status: 'healthy' | 'warning' | 'critical';
    recommendations: string[];
  };
}

// ============================================================================
// HELPERS
// ============================================================================

function coefficientOfVariation(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  if (mean === 0) return 0;
  const variance = arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / arr.length;
  return Math.sqrt(variance) / mean;
}

// ============================================================================
// TRACKING HEALTH ANALYSIS
// ============================================================================

/**
 * Анализирует проблемы с трекингом для ad account
 */
export async function analyzeTrackingHealth(
  adAccountId: string,
  periodStart?: string,
  periodEnd?: string
): Promise<TrackingHealthReport> {
  log.info({ adAccountId }, 'Analyzing tracking health');

  const end = periodEnd || new Date().toISOString().split('T')[0];
  const start = periodStart || (() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3); // Последние 3 месяца
    return d.toISOString().split('T')[0];
  })();

  const issues: TrackingIssue[] = [];
  const issuesByType: Record<string, number> = {
    clicks_no_results: 0,
    results_dropped: 0,
    high_volatility: 0,
  };

  // 1. Получаем weekly insights с link_clicks
  const { data: insights, error: insightsError } = await supabase
    .from('meta_insights_weekly')
    .select('fb_ad_id, week_start_date, link_clicks, spend')
    .eq('ad_account_id', adAccountId)
    .gte('week_start_date', start)
    .lte('week_start_date', end)
    .gt('link_clicks', 0)
    .order('week_start_date', { ascending: true });

  if (insightsError) throw insightsError;

  // 2. Получаем weekly results
  const { data: results, error: resultsError } = await supabase
    .from('meta_weekly_results')
    .select('fb_ad_id, week_start_date, result_family, result_count, spend')
    .eq('ad_account_id', adAccountId)
    .gte('week_start_date', start)
    .lte('week_start_date', end)
    .order('week_start_date', { ascending: true });

  if (resultsError) throw resultsError;

  // 3. Группируем results по неделям и семействам
  const weeklyResults = new Map<string, Map<string, { count: number; spend: number }>>();
  for (const row of results || []) {
    const key = `${row.week_start_date}`;
    if (!weeklyResults.has(key)) {
      weeklyResults.set(key, new Map());
    }
    const weekMap = weeklyResults.get(key)!;
    if (!weekMap.has(row.result_family)) {
      weekMap.set(row.result_family, { count: 0, spend: 0 });
    }
    const family = weekMap.get(row.result_family)!;
    family.count += row.result_count || 0;
    family.spend += parseFloat(row.spend) || 0;
  }

  // 4. Проверяем clicks_no_results
  // Агрегируем insights по неделям
  const weeklyClicks = new Map<string, { clicks: number; spend: number }>();
  for (const row of insights || []) {
    const key = row.week_start_date;
    if (!weeklyClicks.has(key)) {
      weeklyClicks.set(key, { clicks: 0, spend: 0 });
    }
    const week = weeklyClicks.get(key)!;
    week.clicks += row.link_clicks || 0;
    week.spend += parseFloat(row.spend) || 0;
  }

  for (const [week, clickData] of weeklyClicks) {
    const resultData = weeklyResults.get(week);
    let hasConversionResults = false;
    let totalResults = 0;

    if (resultData) {
      // Проверяем только conversion families (не clicks)
      for (const [family, data] of resultData) {
        if (family !== 'click' && data.count > 0) {
          hasConversionResults = true;
          totalResults += data.count;
        }
      }
    }

    // Много кликов но нет конверсий
    if (clickData.clicks > 50 && !hasConversionResults) {
      const severity = clickData.clicks > 200 ? 'high' : clickData.clicks > 100 ? 'medium' : 'low';

      issues.push({
        weekStartDate: week,
        issueType: 'clicks_no_results',
        severity,
        resultFamily: 'all',
        details: {
          linkClicks: clickData.clicks,
          resultsCount: totalResults,
          spend: clickData.spend,
        },
        recommendations: [
          'Проверьте установку pixel/CAPI на сайте',
          'Убедитесь что события отправляются корректно',
          'Проверьте Events Manager в Facebook',
          'Сравните данные pixel с данными аналитики сайта',
        ],
      });
      issuesByType.clicks_no_results++;
    }
  }

  // 5. Проверяем results_dropped
  // Получаем уникальные семейства
  const families = new Set<string>();
  for (const [, familyMap] of weeklyResults) {
    for (const family of familyMap.keys()) {
      if (family !== 'click') families.add(family);
    }
  }

  // Для каждого семейства проверяем drops
  for (const family of families) {
    const weeks = [...weeklyResults.entries()]
      .filter(([, m]) => m.has(family))
      .sort((a, b) => a[0].localeCompare(b[0]));

    for (let i = 1; i < weeks.length; i++) {
      const prev = weeks[i - 1][1].get(family)!;
      const curr = weeks[i][1].get(family)!;
      const currWeek = weeks[i][0];

      // Если предыдущая неделя имела >10 результатов и текущая упала на >70%
      if (prev.count > 10 && curr.count < prev.count * 0.3) {
        const dropPct = ((prev.count - curr.count) / prev.count) * 100;

        issues.push({
          weekStartDate: currWeek,
          issueType: 'results_dropped',
          severity: dropPct > 90 ? 'high' : dropPct > 80 ? 'medium' : 'low',
          resultFamily: family,
          details: {
            resultsCount: curr.count,
            previousResults: prev.count,
            dropPct,
            spend: curr.spend,
          },
          recommendations: [
            'Проверьте изменения на сайте/лендинге',
            'Проверьте работу форм/кнопок конверсии',
            'Убедитесь что pixel/CAPI не сломался',
            'Проверьте изменения в настройках рекламы',
          ],
        });
        issuesByType.results_dropped++;
      }
    }
  }

  // 6. Проверяем high_volatility
  for (const family of families) {
    const weeklyData = [...weeklyResults.entries()]
      .filter(([, m]) => m.has(family))
      .map(([week, m]) => ({
        week,
        count: m.get(family)!.count,
        spend: m.get(family)!.spend,
      }))
      .sort((a, b) => a.week.localeCompare(b.week));

    // Нужно минимум 4 недели данных
    if (weeklyData.length < 4) continue;

    // Считаем rolling CV (коэффициент вариации) за последние 4 недели
    const lastWeeks = weeklyData.slice(-4);
    const counts = lastWeeks.map(w => w.count);
    const cv = coefficientOfVariation(counts);

    // CV > 0.8 считаем высокой волатильностью
    if (cv > 0.8 && counts.some(c => c > 5)) {
      const latestWeek = lastWeeks[lastWeeks.length - 1];

      issues.push({
        weekStartDate: latestWeek.week,
        issueType: 'high_volatility',
        severity: cv > 1.5 ? 'high' : cv > 1.0 ? 'medium' : 'low',
        resultFamily: family,
        details: {
          resultsCount: latestWeek.count,
          volatilityCv: cv,
          spend: latestWeek.spend,
        },
        recommendations: [
          'Нестабильность результатов может указывать на проблемы с трекингом',
          'Проверьте консистентность работы pixel/CAPI',
          'Убедитесь что нет технических проблем на сайте',
          'Проверьте нет ли проблем с event deduplication',
        ],
      });
      issuesByType.high_volatility++;
    }
  }

  // 7. Сохраняем issues в БД
  for (const issue of issues) {
    await supabase.from('tracking_health_issues').upsert({
      ad_account_id: adAccountId,
      week_start_date: issue.weekStartDate,
      clicks_no_results: issue.issueType === 'clicks_no_results',
      results_dropped: issue.issueType === 'results_dropped',
      high_volatility: issue.issueType === 'high_volatility',
      link_clicks: issue.details.linkClicks,
      results_count: issue.details.resultsCount,
      spend: issue.details.spend,
      result_family: issue.resultFamily,
      volatility_cv: issue.details.volatilityCv,
      recommendations: issue.recommendations,
    }, {
      onConflict: 'ad_account_id,week_start_date,result_family',
    });
  }

  // 8. Вычисляем общий health score
  const highCount = issues.filter(i => i.severity === 'high').length;
  const mediumCount = issues.filter(i => i.severity === 'medium').length;
  const lowCount = issues.filter(i => i.severity === 'low').length;

  // Базовый score 100, вычитаем за каждую проблему
  let healthScore = 100 - (highCount * 20) - (mediumCount * 10) - (lowCount * 5);
  healthScore = Math.max(0, Math.min(100, healthScore));

  let status: 'healthy' | 'warning' | 'critical';
  if (healthScore >= 80) {
    status = 'healthy';
  } else if (healthScore >= 50) {
    status = 'warning';
  } else {
    status = 'critical';
  }

  const overallRecommendations: string[] = [];
  if (issuesByType.clicks_no_results > 0) {
    overallRecommendations.push('Обнаружены клики без конверсий - проверьте pixel/CAPI');
  }
  if (issuesByType.results_dropped > 0) {
    overallRecommendations.push('Обнаружены резкие падения результатов - проверьте техническую часть');
  }
  if (issuesByType.high_volatility > 0) {
    overallRecommendations.push('Высокая волатильность результатов - проверьте стабильность трекинга');
  }

  const report: TrackingHealthReport = {
    period: { start, end },
    summary: {
      totalIssues: issues.length,
      highSeverity: highCount,
      mediumSeverity: mediumCount,
      lowSeverity: lowCount,
      issuesByType,
    },
    issues: issues.sort((a, b) => {
      const severityOrder = { high: 0, medium: 1, low: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    }),
    overall: {
      healthScore,
      status,
      recommendations: overallRecommendations,
    },
  };

  log.info({
    adAccountId,
    issuesCount: issues.length,
    healthScore,
    status
  }, 'Tracking health analysis completed');

  return report;
}

/**
 * Получает историю issues из кэша
 */
export async function getTrackingIssuesHistory(
  adAccountId: string,
  limit: number = 50
): Promise<any[]> {
  const { data, error } = await supabase
    .from('tracking_health_issues')
    .select('*')
    .eq('ad_account_id', adAccountId)
    .order('week_start_date', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}
