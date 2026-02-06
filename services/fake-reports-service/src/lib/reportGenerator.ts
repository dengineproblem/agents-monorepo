import {
  generateMetrics,
  generateAdAccountId,
  generateUserId,
  generateUsername
} from './metricsGenerator.js';
import {
  generateCampaignNames,
  generateActionsText,
  generateAnalyticsText,
  generateRecommendations
} from './llmService.js';
import type { FakeReport, GenerateReportRequest } from '../types/report.js';

/**
 * Генерация фейкового отчета
 */
export async function generateFakeReport(
  request: GenerateReportRequest
): Promise<FakeReport> {
  const { niche, targetCpl } = request;

  console.log('[Report] Starting fake report generation...');
  console.log('[Report] Niche:', niche);
  console.log('[Report] Target CPL:', targetCpl);

  // 1. Определяем количество кампаний (2 или 3)
  const numCampaigns = Math.random() > 0.5 ? 3 : 2;
  console.log('[Report] Campaigns count:', numCampaigns);

  // 2. Генерируем названия кампаний через LLM
  console.log('[Report] Generating campaign names...');
  const campaignNames = await generateCampaignNames(niche, numCampaigns);
  console.log('[Report] Campaign names:', campaignNames);

  // 3. Генерируем метрики
  console.log('[Report] Generating metrics...');
  const metrics = generateMetrics(targetCpl, niche, campaignNames);
  console.log('[Report] Metrics generated:', {
    totalSpend: metrics.totalSpend,
    totalLeads: metrics.totalLeads,
    campaigns: metrics.campaigns.length
  });

  // 4. Генерируем тексты через LLM (параллельно для ускорения)
  console.log('[Report] Generating texts via LLM...');
  const [actionsText, analyticsText, recommendationsText] = await Promise.all([
    generateActionsText(metrics.campaigns, targetCpl, niche),
    generateAnalyticsText(metrics.campaigns, niche),
    generateRecommendations(metrics.campaigns, targetCpl, niche)
  ]);
  console.log('[Report] Texts generated successfully');

  // 5. Рассчитываем итоговые метрики
  const totalCpl = metrics.totalLeads > 0
    ? metrics.totalSpend / metrics.totalLeads
    : 0;

  const totalQualityCpl = metrics.totalQualityLeads > 0
    ? metrics.totalSpend / metrics.totalQualityLeads
    : 0;

  // 6. Собираем финальный отчет
  const report: FakeReport = {
    date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0], // YYYY-MM-DD (вчера)
    userId: generateUserId(),
    username: generateUsername(niche),
    adAccountId: generateAdAccountId(),
    accountStatus: 'Активен',
    totalSpend: metrics.totalSpend,
    totalLeads: metrics.totalLeads,
    totalCpl: roundToTwo(totalCpl),
    totalQualityLeads: metrics.totalQualityLeads,
    totalQualityCpl: roundToTwo(totalQualityCpl),
    campaigns: metrics.campaigns,
    actionsText,
    analyticsText,
    recommendationsText
  };

  console.log('[Report] Fake report generated successfully');

  return report;
}

/**
 * Округление до двух знаков после запятой
 */
function roundToTwo(num: number): number {
  return Math.round(num * 100) / 100;
}
