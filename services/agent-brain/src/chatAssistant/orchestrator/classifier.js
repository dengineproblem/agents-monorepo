/**
 * Request Classifier
 * Determines which agent(s) should handle a user request
 *
 * Extended (Hybrid C): Now detects intent for policy-based tool filtering
 */

import OpenAI from 'openai';
import { logger } from '../../lib/logger.js';
import { logErrorToAdmin } from '../../lib/errorLogger.js';
import { policyEngine } from '../hybrid/policyEngine.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Use a faster model for classification
const CLASSIFIER_MODEL = 'gpt-4o-mini';

/**
 * Extract user request from formatted message
 * @param {string} message - Full formatted message
 * @returns {string} - Just the user's request
 */
function extractUserRequest(message) {
  const userRequestMatch = message.match(/## Запрос пользователя\s*\n\n(.+)/s);
  return userRequestMatch ? userRequestMatch[1].trim() : message;
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
- greeting: Приветствия и нейтральные сообщения (привет, салам, здравствуй, как дела, йо, хай, добрый день, ?)
- ads: Facebook/Instagram реклама (кампании, адсеты, бюджеты направлений, расходы, пауза/возобновление кампаний)
- creative: Креативы (анализ креативов, метрики креативов, видео retention, тесты креативов, запуск креативов, сравнение креативов, топ/худшие креативы)
- whatsapp: WhatsApp диалоги (переписки, сообщения, анализ диалога)
- crm: Лиды и воронка продаж (поиск лидов, этапы, score, статистика воронки)
- mixed: Запрос требует данных из нескольких доменов

ПРАВИЛА:
1. Если сообщение это приветствие или нейтральное (привет, салам, йо, как дела, ?) — выбери "greeting"
2. Если запрос про креативы (видео, картинки, баннеры, анализ креативов) — выбери "creative"
3. Если запрос про кампании, адсеты, направления, бюджеты — выбери "ads"
4. Если нужны данные из нескольких источников — выбери "mixed" и укажи нужные домены
5. Если непонятно — выбери наиболее вероятный домен

Ответь ТОЛЬКО валидным JSON:
{
  "domain": "greeting" | "ads" | "creative" | "whatsapp" | "crm" | "mixed",
  "agents": [] // пустой для greeting, иначе массив нужных агентов
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: CLASSIFIER_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message }
      ],
      max_completion_tokens: 10000
    });

    const fullMessage = completion.choices[0].message;
    const response = fullMessage.content || '';
    const finishReason = completion.choices[0].finish_reason;

    logger.info({
      llmResponse: response,
      fullMessage: JSON.stringify(fullMessage),
      finishReason,
      messagePreview: message.substring(0, 100)
    }, 'LLM classifier raw response');

    // If response is empty or truncated, check for greeting in original message
    if (!response || finishReason === 'length') {
      // Extract just the user's request from the formatted message
      const userRequestMatch = message.match(/## Запрос пользователя\s*\n\n(.+)/s);
      const userRequest = userRequestMatch ? userRequestMatch[1].trim() : message;

      // Check if it's a greeting
      const greetingPattern = /^(?:привет|салам|здравствуй|хай|йо|hello|hi|хей|ку|здаров|приветик|хола|добр(?:ый|ое|ого)\s*(?:день|утр|вечер)|как дела|что нового|\?)!?$/i;
      if (greetingPattern.test(userRequest)) {
        logger.info({ userRequest }, 'LLM empty response, detected greeting from message');
        return {
          domain: 'general',
          agents: [],
          instructions: '',
          intent: 'greeting_neutral',
          intentConfidence: 0.9
        };
      }
    }

    // Parse JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const domain = parsed.domain || 'ads';

      // Handle greeting domain specially
      if (domain === 'greeting') {
        return {
          domain: 'general',
          agents: [],
          instructions: '',
          intent: 'greeting_neutral',
          intentConfidence: 0.9
        };
      }

      // Valid agent names (not "mixed" or "greeting")
      const validAgents = ['ads', 'creative', 'whatsapp', 'crm'];

      // Filter to only valid agents
      let agents = (parsed.agents || []).filter(a => validAgents.includes(a));

      // If no valid agents, use domain (if valid) or all agents for "mixed"
      if (agents.length === 0) {
        agents = validAgents.includes(domain) ? [domain] : validAgents;
      }

      // Detect intent using PolicyEngine
      const intentResult = policyEngine.detectIntent(message);

      return {
        domain,
        agents,
        instructions: parsed.instructions || '',
        intent: intentResult.intent,
        intentConfidence: intentResult.confidence
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

  // Default fallback - also detect intent
  const intentResult = policyEngine.detectIntent(message);

  return {
    domain: 'ads',
    agents: ['ads'],
    instructions: '',
    intent: intentResult.intent,
    intentConfidence: intentResult.confidence
  };
}

/**
 * Classify a user request to determine which agent(s) should handle it
 * @param {string} message - User message
 * @param {Object} context - Business context
 * @returns {Promise<{ domain: string, agents: string[], intent: string, instructions?: string }>}
 */
export async function classifyRequest(message, context = {}) {
  // Use LLM for all classification (domain + intent detection)
  const result = await llmClassify(message, context);

  logger.info({
    message: message.substring(0, 50),
    domain: result.domain,
    agents: result.agents,
    intent: result.intent,
    intentConfidence: result.intentConfidence
  }, 'Request classified');

  return result;
}

/**
 * Get all available domains
 */
export function getAvailableDomains() {
  return ['ads', 'creative', 'whatsapp', 'crm'];
}
