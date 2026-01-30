import type { GeneratedMetrics, MetricsConfig } from '../types/metrics.js';

const DEFAULT_CONFIG: MetricsConfig = {
  minCampaigns: 2,
  maxCampaigns: 3,
  minSpend: 15,
  maxSpend: 35,
  targetCplVariance: 0.20,  // ±20%
  qualityLeadsMin: 0.60,    // 60%
  qualityLeadsMax: 0.80     // 80%
};

/**
 * Генерация реалистичных метрик для фейкового отчета
 */
export function generateMetrics(
  targetCpl: number,
  niche: string,
  campaignNames: string[],
  config: MetricsConfig = DEFAULT_CONFIG
): GeneratedMetrics {
  // 1. Генерируем общий бюджет
  const totalSpend = randomBetween(config.minSpend, config.maxSpend);

  // 2. Распределяем бюджет между кампаниями
  const numCampaigns = campaignNames.length;
  const campaignSpends = distributeBudget(totalSpend, numCampaigns);

  // 3. Генерируем метрики для каждой кампании
  const campaigns = campaignNames.map((name, index) => {
    const spend = campaignSpends[index];

    // CPL близко к целевому (±20%)
    const cplVariance = randomBetween(
      -config.targetCplVariance,
      config.targetCplVariance
    );
    const campaignCpl = targetCpl * (1 + cplVariance);

    // Рассчитываем лиды из затрат и CPL
    const leads = Math.max(1, Math.floor(spend / campaignCpl));

    // Качественные лиды: 60-80% от общих
    const qualityPercent = randomBetween(
      config.qualityLeadsMin,
      config.qualityLeadsMax
    );
    const qualityLeads = Math.max(1, Math.floor(leads * qualityPercent));
    const qualityCpl = qualityLeads > 0 ? spend / qualityLeads : 0;

    return {
      id: generateCampaignId(),
      name,
      status: 'Активна' as const,
      spend: roundToTwo(spend),
      leads,
      cpl: roundToTwo(campaignCpl),
      qualityLeads,
      qualityCpl: roundToTwo(qualityCpl),
      qualityPercent: Math.round(qualityPercent * 100)
    };
  });

  // 4. Рассчитываем итоговые метрики
  const totalLeads = campaigns.reduce((sum, c) => sum + c.leads, 0);
  const totalQualityLeads = campaigns.reduce((sum, c) => sum + c.qualityLeads, 0);

  return {
    campaigns,
    totalSpend: roundToTwo(totalSpend),
    totalLeads,
    totalQualityLeads
  };
}

/**
 * Генерация Campaign ID (18-значное число как у Facebook)
 */
export function generateCampaignId(): string {
  const min = 100000000000000000n;
  const max = 999999999999999999n;
  const range = max - min;
  const randomBigInt = min + BigInt(Math.floor(Math.random() * Number(range)));
  return randomBigInt.toString();
}

/**
 * Генерация Ad Account ID (формат: act_XXXXXXXXXX)
 */
export function generateAdAccountId(): string {
  const randomDigits = Math.floor(1000000000 + Math.random() * 9000000000);
  return `act_${randomDigits}`;
}

/**
 * Генерация User ID (UUID v4)
 */
export function generateUserId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Генерация username для отображения
 */
export function generateUsername(niche: string): string {
  const nicheSlug = niche
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
  const randomNum = Math.floor(Math.random() * 9999);
  return `${nicheSlug}_${randomNum}`;
}

/**
 * Распределение бюджета между кампаниями (weighted random)
 */
function distributeBudget(total: number, count: number): number[] {
  // Генерируем случайные веса
  const weights = Array.from({ length: count }, () => Math.random() + 0.5);
  const sum = weights.reduce((a, b) => a + b, 0);

  // Распределяем бюджет пропорционально весам
  return weights.map(w => (w / sum) * total);
}

/**
 * Случайное число в диапазоне [min, max]
 */
function randomBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

/**
 * Округление до двух знаков после запятой
 */
function roundToTwo(num: number): number {
  return Math.round(num * 100) / 100;
}
