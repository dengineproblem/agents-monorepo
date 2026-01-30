import OpenAI from 'openai';
import { config } from '../config.js';
import type { Campaign } from '../types/report.js';

let openai: OpenAI | null = null;

/**
 * Инициализация OpenAI клиента
 */
export function initializeOpenAI(): void {
  if (!config.openai.apiKey) {
    throw new Error('OPENAI_API_KEY must be set');
  }

  openai = new OpenAI({ apiKey: config.openai.apiKey });
  console.log('[OpenAI] Initialized successfully');
  console.log('[OpenAI] Model:', config.openai.model);
}

/**
 * Получение OpenAI клиента
 */
function getClient(): OpenAI {
  if (!openai) {
    throw new Error('OpenAI not initialized. Call initializeOpenAI() first');
  }
  return openai;
}

/**
 * Генерация названий кампаний
 */
export async function generateCampaignNames(
  niche: string,
  count: number
): Promise<string[]> {
  const systemPrompt = `Ты эксперт по Facebook Ads. Твоя задача — создать ${count} названия кампаний для ниши: "${niche}".

ПРАВИЛА:
- Формат: "[Название] WhatsApp" или "[Название] Lead Form"
- Названия должны быть короткие и цепляющие (1-3 слова)
- Отражать целевую аудиторию или УТП
- Писать на русском языке

ПРИМЕРЫ:
Для ниши "Роддом":
- "[Мамы] WhatsApp"
- "[Призывники] WhatsApp"

Для ниши "Стоматология":
- "[Имплантация] WhatsApp"
- "[Отбеливание] Lead Form"

Верни только названия, каждое с новой строки, без нумерации.`;

  const userPrompt = `Ниша: ${niche}\nКоличество кампаний: ${count}`;

  const completion = await getClient().chat.completions.create({
    model: config.openai.model,
    temperature: 0.7,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  });

  const text = completion.choices[0]?.message?.content || '';
  const names = text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .slice(0, count);

  return names.length >= count ? names : [
    `[${niche}] WhatsApp`,
    `[${niche} VIP] Lead Form`
  ].slice(0, count);
}

/**
 * Генерация текста "Выполненные действия"
 */
export async function generateActionsText(
  campaigns: Campaign[],
  targetCpl: number,
  niche: string
): Promise<string> {
  const systemPrompt = `Ты AI-агент по оптимизации Facebook Ads. Твоя задача — описать выполненные действия для рекламных кампаний.

КОНТЕКСТ:
- Ты управляешь рекламными кампаниями для ниши: "${niche}"
- Плановая стоимость лида: ${targetCpl.toFixed(2)} USD
- Ты анализируешь метрики и вносишь изменения в бюджеты

СТИЛЬ:
- Технический, но понятный клиенту
- Конкретные причины изменений
- Упор на стоимость лида (CPL) и качество лидов

ФОРМАТ:
Для каждой кампании напиши 2-3 предложения с действием или наблюдением.

ПРИМЕРЫ:
"Кампания показывает хорошие результаты: CPL ниже плановой стоимости на 15%. Качество лидов высокое (75%). Изменения не требуются."

"Превышена плановая стоимость качественного лида на 20%. Рекомендуется обновить креативы для повышения конверсии."

Не используй технические термины вроде "ребаланс", "ad set", "QCPL" — объясняй простым языком.`;

  const campaignData = campaigns.map(c => ({
    name: c.name,
    spend: c.spend,
    leads: c.leads,
    cpl: c.cpl,
    qualityLeads: c.qualityLeads,
    qualityPercent: c.qualityPercent
  }));

  const userPrompt = `Кампании:\n${JSON.stringify(campaignData, null, 2)}\n\nПлановый CPL: ${targetCpl.toFixed(2)} USD`;

  const completion = await getClient().chat.completions.create({
    model: config.openai.model,
    temperature: 0.3,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  });

  return completion.choices[0]?.message?.content || 'Действия по оптимизации не требуются.';
}

/**
 * Генерация текста "Аналитика в динамике"
 */
export async function generateAnalyticsText(
  campaigns: Campaign[],
  niche: string
): Promise<string> {
  const systemPrompt = `Ты AI-агент по аналитике Facebook Ads. Твоя задача — написать краткую аналитику в динамике.

КОНТЕКСТ:
- Ниша: "${niche}"
- Ты наблюдаешь за кампаниями несколько дней

СТИЛЬ:
- Лаконичный, инсайтовый
- Сравнение кампаний между собой
- Наблюдения трендов

ФОРМАТ:
2-4 предложения в формате:
"- <Наблюдение 1>"
"- <Наблюдение 2>"

ПРИМЕРЫ:
"- Кампания "Мамы" стабильно дает дешевые лиды, качество высокое"
"- "Призывники" показывают вариабельное качество, требуется оптимизация креативов"

Пиши конкретно и по делу.`;

  const campaignData = campaigns.map(c => ({
    name: c.name,
    cpl: c.cpl,
    qualityPercent: c.qualityPercent
  }));

  const userPrompt = `Кампании:\n${JSON.stringify(campaignData, null, 2)}`;

  const completion = await getClient().chat.completions.create({
    model: config.openai.model,
    temperature: 0.7,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  });

  return completion.choices[0]?.message?.content || '- Кампании показывают стабильные результаты.';
}

/**
 * Генерация рекомендаций
 */
export async function generateRecommendations(
  campaigns: Campaign[],
  targetCpl: number,
  niche: string
): Promise<string> {
  const systemPrompt = `Ты AI-агент по оптимизации Facebook Ads. Твоя задача — дать рекомендации для дальнейшей оптимизации.

КОНТЕКСТ:
- Ниша: "${niche}"
- Плановая стоимость лида: ${targetCpl.toFixed(2)} USD

СТИЛЬ:
- Конкретные действия
- Реалистичные рекомендации

ФОРМАТ:
2-3 рекомендации в формате:
"- <Рекомендация>"

ПРИМЕРЫ:
"- Протестировать новые креативы для кампании "Призывники" для снижения CPL"
"- Рассмотреть масштабирование бюджета для кампании "Мамы" при стабильных результатах"

Пиши практично и по делу.`;

  const campaignData = campaigns.map(c => ({
    name: c.name,
    cpl: c.cpl,
    qualityPercent: c.qualityPercent
  }));

  const userPrompt = `Кампании:\n${JSON.stringify(campaignData, null, 2)}\nПлановый CPL: ${targetCpl.toFixed(2)} USD`;

  const completion = await getClient().chat.completions.create({
    model: config.openai.model,
    temperature: 0.7,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  });

  return completion.choices[0]?.message?.content || '- Продолжать мониторинг кампаний.';
}
