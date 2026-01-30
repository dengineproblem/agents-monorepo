/**
 * Типы для генерации метрик
 */

export interface MetricsConfig {
  minCampaigns: number;       // Минимальное количество кампаний (2)
  maxCampaigns: number;       // Максимальное количество кампаний (3)
  minSpend: number;           // Минимальные затраты (15 USD)
  maxSpend: number;           // Максимальные затраты (35 USD)
  targetCplVariance: number;  // Отклонение CPL от целевого (±20%)
  qualityLeadsMin: number;    // Минимальный % качественных лидов (0.60)
  qualityLeadsMax: number;    // Максимальный % качественных лидов (0.80)
}

export interface GeneratedMetrics {
  campaigns: Array<{
    id: string;
    name: string;
    status: 'Активна' | 'Неактивна';
    spend: number;
    leads: number;
    cpl: number;
    qualityLeads: number;
    qualityCpl: number;
    qualityPercent: number;
  }>;
  totalSpend: number;
  totalLeads: number;
  totalQualityLeads: number;
}

export interface CampaignMetrics {
  spend: number;              // Затраты кампании
  cpl: number;                // CPL кампании
  leads: number;              // Количество лидов
  qualityPercent: number;     // Процент качественных лидов (0.6-0.8)
  qualityLeads: number;       // Количество качественных лидов
  qualityCpl: number;         // CPL качественного лида
}
