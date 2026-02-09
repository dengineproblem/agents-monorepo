// Маппинг objective → наше короткое название
// Поддерживаем оба формата: snake_case (из БД) и PascalCase (из UI)
const OBJECTIVE_LABELS = {
  // snake_case формат (из account_directions.objective)
  'whatsapp': 'wa',
  'lead_forms': 'leadforms',
  'app_installs': 'app',
  'site_leads': 'site leads',
  'instagram_traffic': 'clicks',
  // PascalCase формат
  'WhatsApp': 'wa',
  'LeadForms': 'leadforms',
  'AppInstalls': 'app',
  'SiteLeads': 'site leads',
  'Instagram': 'clicks',
};

function generateShortId() {
  return Math.random().toString(36).substring(2, 6);
}

export function generateAdsetName({ directionName, source, objective }) {
  const date = new Date().toISOString().split('T')[0];
  const goalLabel = OBJECTIVE_LABELS[objective] || objective;
  const shortId = generateShortId();
  return `${directionName} | ${source} | ${date} | ${goalLabel} | ${shortId}`;
}
