export type AdsetSource = 'Manual' | 'Brain' | 'AI Launch' | 'Test';

// Маппинг objective → наше короткое название
// Поддерживаем оба формата: snake_case (из БД) и PascalCase (из UI)
const OBJECTIVE_LABELS: Record<string, string> = {
  // snake_case формат (из account_directions.objective)
  'whatsapp': 'wa',
  'lead_forms': 'leadforms',
  'app_installs': 'app',
  'site_leads': 'site leads',
  'instagram_traffic': 'clicks',
  // PascalCase формат (из createCampaignWithCreative)
  'WhatsApp': 'wa',
  'LeadForms': 'leadforms',
  'AppInstalls': 'app',
  'SiteLeads': 'site leads',
  'Instagram': 'clicks',
};

function generateShortId(): string {
  return Math.random().toString(36).substring(2, 6);
}

export function generateAdsetName(params: {
  directionName: string;
  source: AdsetSource;
  objective: string;
}): string {
  const date = new Date().toISOString().split('T')[0];
  const goalLabel = OBJECTIVE_LABELS[params.objective] || params.objective;
  const shortId = generateShortId();

  return `${params.directionName} | ${params.source} | ${date} | ${goalLabel} | ${shortId}`;
}
