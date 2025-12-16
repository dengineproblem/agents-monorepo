/**
 * Request Classifier
 * Determines which agent(s) should handle a user request
 */

import OpenAI from 'openai';
import { logger } from '../../lib/logger.js';
import { logErrorToAdmin } from '../../lib/errorLogger.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Use a faster model for classification
const CLASSIFIER_MODEL = 'gpt-5-mini';

/**
 * Domain keywords for quick classification
 */
const DOMAIN_KEYWORDS = {
  ads: [
    'кампани', 'адсет', 'бюджет', 'расход', 'spend', 'cpm',
    'реклам', 'campaign', 'facebook', 'instagram',
    'impressions', 'clicks', 'конверс', 'направлени',
    'roi', 'roas', 'охват', 'direction',
    // ROI/Revenue keywords
    'окупаемост', 'рентабельност', 'прибыл', 'доход',
    'сколько заработал', 'revenue', 'сколько потратил',
    'отбил', 'вернул', 'эффективност рекламы'
  ],
  creative: [
    'креатив', 'видео', 'картинк', 'изображен', 'баннер',
    'анализ креатив', 'тест креатив', 'лонч', 'запуст креатив',
    'транскрип', 'скор', 'retention', 'досмотр', 'удержани',
    'топ креатив', 'лучш креатив', 'худш креатив', 'сравн креатив',
    'video views', 'cpl', 'ctr', 'метрик креатив'
  ],
  whatsapp: [
    'диалог', 'переписк', 'сообщен', 'whatsapp', 'ватсап', 'чат',
    'написал', 'ответил', 'переписка', 'message', 'контакт',
    'анализ диалога', 'история сообщений'
  ],
  crm: [
    'лид', 'воронк', 'этап', 'score', 'горяч', 'тёпл', 'холодн',
    'funnel', 'lead', 'клиент', 'продаж', 'сделк', 'квалификац',
    'crm', 'амо', 'amo',
    // Revenue/выручка keywords
    'выручк', 'покупк', 'средний чек', 'конверсия в покупку',
    'сколько купили', 'топ покупател'
  ]
};

/**
 * Quick keyword-based classification
 * @param {string} message - User message
 * @returns {{ domain: string, agents: string[], confidence: number } | null}
 */
function quickClassify(message) {
  const lower = message.toLowerCase();

  const scores = {
    ads: 0,
    creative: 0,
    whatsapp: 0,
    crm: 0
  };

  // Count keyword matches
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    for (const keyword of keywords) {
      if (lower.includes(keyword)) {
        scores[domain]++;
      }
    }
  }

  // Find domain with highest score
  const maxScore = Math.max(...Object.values(scores));

  if (maxScore === 0) {
    return null; // Need LLM classification
  }

  const topDomains = Object.entries(scores)
    .filter(([_, score]) => score === maxScore)
    .map(([domain]) => domain);

  // If only one domain matched, return it
  if (topDomains.length === 1 && maxScore >= 2) {
    return {
      domain: topDomains[0],
      agents: topDomains,
      confidence: Math.min(maxScore * 0.3, 0.9)
    };
  }

  // Multiple domains or low confidence - need LLM
  if (topDomains.length > 1) {
    return {
      domain: 'mixed',
      agents: topDomains,
      confidence: 0.5
    };
  }

  return null;
}

/**
 * LLM-based classification for complex requests
 * @param {string} message - User message
 * @param {Object} context - Business context
 * @returns {Promise<{ domain: string, agents: string[], instructions: string }>}
 */
async function llmClassify(message, context) {
  const systemPrompt = `Ты классификатор запросов для AI-ассистента.
Определи к какому домену относится запрос пользователя.

ДОМЕНЫ:
- ads: Facebook/Instagram реклама (кампании, адсеты, бюджеты направлений, расходы, пауза/возобновление кампаний)
- creative: Креативы (анализ креативов, метрики креативов, видео retention, тесты креативов, запуск креативов, сравнение креативов, топ/худшие креативы)
- whatsapp: WhatsApp диалоги (переписки, сообщения, анализ диалога)
- crm: Лиды и воронка продаж (поиск лидов, этапы, score, статистика воронки)
- mixed: Запрос требует данных из нескольких доменов

ПРАВИЛА:
1. Если запрос про креативы (видео, картинки, баннеры, анализ креативов) — выбери "creative"
2. Если запрос про кампании, адсеты, направления, бюджеты — выбери "ads"
3. Если нужны данные из нескольких источников — выбери "mixed" и укажи нужные домены
4. Если непонятно — выбери наиболее вероятный домен

Ответь ТОЛЬКО валидным JSON:
{
  "domain": "ads" | "creative" | "whatsapp" | "crm" | "mixed",
  "agents": ["ads"] // массив нужных агентов
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: CLASSIFIER_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message }
      ],
      temperature: 0.1,
      max_tokens: 100
    });

    const response = completion.choices[0].message.content;

    // Parse JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const domain = parsed.domain || 'ads';

      // Valid agent names (not "mixed")
      const validAgents = ['ads', 'creative', 'whatsapp', 'crm'];

      // Filter to only valid agents
      let agents = (parsed.agents || []).filter(a => validAgents.includes(a));

      // If no valid agents, use domain (if valid) or all agents for "mixed"
      if (agents.length === 0) {
        agents = validAgents.includes(domain) ? [domain] : validAgents;
      }

      return {
        domain,
        agents,
        instructions: parsed.instructions || ''
      };
    }
  } catch (error) {
    logger.error({ error: error.message }, 'LLM classification failed');

    logErrorToAdmin({
      error_type: 'api',
      raw_error: error.message || String(error),
      stack_trace: error.stack,
      action: 'llm_classify_request',
      severity: 'warning'
    }).catch(() => {});
  }

  // Default fallback
  return {
    domain: 'ads',
    agents: ['ads'],
    instructions: ''
  };
}

/**
 * Classify a user request to determine which agent(s) should handle it
 * @param {string} message - User message
 * @param {Object} context - Business context
 * @returns {Promise<{ domain: string, agents: string[], instructions?: string }>}
 */
export async function classifyRequest(message, context = {}) {
  // Try quick keyword classification first
  const quickResult = quickClassify(message);

  if (quickResult && quickResult.confidence >= 0.7) {
    logger.info({
      message: message.substring(0, 50),
      result: quickResult,
      method: 'keywords'
    }, 'Request classified via keywords');

    return {
      domain: quickResult.domain,
      agents: quickResult.agents,
      instructions: ''
    };
  }

  // Fall back to LLM classification
  const llmResult = await llmClassify(message, context);

  logger.info({
    message: message.substring(0, 50),
    result: llmResult,
    method: 'llm'
  }, 'Request classified via LLM');

  return llmResult;
}

/**
 * Get all available domains
 */
export function getAvailableDomains() {
  return ['ads', 'creative', 'whatsapp', 'crm'];
}
