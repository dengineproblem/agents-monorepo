/**
 * Intent Router — classifies user messages into domains
 *
 * Phase 1: Keyword/regex matching (0ms, handles ~80% of messages)
 * Phase 2: LLM fallback via Haiku (~300ms, for ambiguous messages)
 * Phase 3: Fallback to null (caller loads all tools)
 */
import Anthropic from '@anthropic-ai/sdk';
import { logger } from './logger.js';

export interface RouteResult {
  domain: string;
  method: 'keyword' | 'llm' | 'fallback';
  // Optional token usage (for legacy daily spending limits).
  // Anthropic Messages API returns input/output tokens; we pass through as-is.
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

interface KeywordRule {
  domain: string;
  patterns: RegExp[];
}

const KEYWORD_RULES: KeywordRule[] = [
  {
    domain: 'ads',
    patterns: [
      /кампани[юияей]/i,
      /адсет/i,
      /бюджет/i,
      /расход/i,
      /\b(CPL|CTR|CPC|ROAS)\b/i,
      /направлени[еяюй]/i,
      /\bFacebook\b|\bFB\b|\bInstagram\b/i,
      /реклам[уае]/i,
      /паузу.*кампани|поставь.*паузу|возобнов/i,
      /brain|оптимизаци/i,
      /\bROI\b/i,
      /отчёт.*расход|расход.*отчёт/i,
      /аккаунт.*статус|статус.*аккаунт/i,
      /масштабир/i,
    ],
  },
  {
    domain: 'creative',
    patterns: [
      /креатив/i,
      /баннер/i,
      /картинк[уаие]/i,
      /карусел/i,
      /генер.*изображени|сгенерируй|сделай.*картинк/i,
      /оффер/i,
      /буллет/i,
      /сценарий/i,
      /текст.*рилс|текст.*видео|рилс.*текст/i,
      /A\/B\s*тест/i,
      /анализ.*креатив|креатив.*анализ/i,
      /транскрипци/i,
      /запуст.*креатив|launch/i,
      /изображени[еяй]/i,
    ],
  },
  {
    domain: 'crm',
    patterns: [
      /лид[оыуаеёв]/i,
      /продаж[уаиеёы]/i,
      /воронк/i,
      /диалог.*whatsapp|whatsapp.*диалог/i,
      /\bCRM\b/i,
      /клиент.*телефон|номер.*клиент/i,
      /стади[юияей].*лид/i,
      /качество.*лид|лид.*качество/i,
    ],
  },
  {
    domain: 'tiktok',
    patterns: [
      /tiktok|тикток|тик.?ток/i,
    ],
  },
  {
    domain: 'onboarding',
    patterns: [
      /создай.*пользовател|регистрац|онбординг|новый.*пользовател/i,
    ],
  },
];

/**
 * Phase 1: Keyword-based classification (synchronous, 0ms)
 * Returns null if no match or cross-domain detected
 */
function classifyByKeywords(message: string): RouteResult | null {
  const matched: string[] = [];

  for (const rule of KEYWORD_RULES) {
    if (rule.patterns.some(p => p.test(message))) {
      matched.push(rule.domain);
    }
  }

  if (matched.length === 0) return null;

  // Cross-domain: multiple domains matched → let caller fallback
  if (matched.length > 1) {
    logger.info({ domains: matched }, 'Cross-domain detected, fallback to all tools');
    return null;
  }

  return { domain: matched[0], method: 'keyword' };
}

const ROUTER_SYSTEM_PROMPT = `Classify the user message into ONE domain. Reply with ONLY the domain name:
- ads (Facebook campaigns, budgets, metrics, directions, optimization, adsets)
- creative (image/text generation, creative analysis, A/B tests, banners, carousels)
- crm (leads, sales, WhatsApp dialogs, funnel, clients)
- tiktok (TikTok campaigns and metrics)
- onboarding (user registration, creating accounts)
- general (greetings, unclear requests, errors, web search, other)

Reply with ONLY ONE word — the domain name.`;

/**
 * Phase 2: LLM classification via Haiku (~300ms)
 */
async function classifyByLLM(message: string, anthropic: Anthropic): Promise<RouteResult> {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 10,
      system: ROUTER_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: message.slice(0, 200) }],
    });

    const text = response.content
      .find(b => b.type === 'text')
      ?.text?.trim()
      .toLowerCase() || '';

    const validDomains = ['ads', 'creative', 'crm', 'tiktok', 'onboarding', 'general'];
    const domain = validDomains.includes(text) ? text : 'general';

    const usage = (response as any)?.usage;
    return {
      domain,
      method: 'llm',
      usage: usage
        ? {
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
            cache_creation_input_tokens: usage.cache_creation_input_tokens,
            cache_read_input_tokens: usage.cache_read_input_tokens,
          }
        : undefined,
    };
  } catch (error: any) {
    logger.error({ error: error.message }, 'LLM routing failed, fallback');
    return { domain: 'general', method: 'fallback' };
  }
}

// Какие сервисы нужны для каждого домена
const DOMAIN_STACK_REQUIREMENTS: Record<string, string[]> = {
  ads: ['facebook'],
  creative: ['facebook'],
  crm: [],
  tiktok: ['tiktok'],
  onboarding: [],
  general: [],
};

// Паттерн переключения аккаунта
export const ACCOUNT_SWITCH_PATTERN = /переключи.*аккаунт|смени.*аккаунт|другой\s+аккаунт/i;

/**
 * Проверяет, доступен ли домен для данного стека пользователя
 */
function isDomainAvailable(domain: string, userStack: string[]): boolean {
  const required = DOMAIN_STACK_REQUIREMENTS[domain];
  if (!required || required.length === 0) return true;
  return required.some(req => userStack.includes(req));
}

/**
 * Route a user message to a domain.
 * Returns RouteResult with domain name and classification method.
 * Returns null if cross-domain or error → caller should use all tools.
 */
export async function routeMessage(
  message: string,
  anthropic: Anthropic,
  userStack?: string[],
): Promise<RouteResult | null> {
  // Phase 1: keyword matching (0ms)
  const keywordResult = classifyByKeywords(message);
  if (keywordResult) {
    // Фильтрация по стеку — если домен недоступен, fallback на general
    if (userStack && !isDomainAvailable(keywordResult.domain, userStack)) {
      logger.info({ domain: keywordResult.domain, userStack }, 'Domain not available for user stack, fallback to general');
      return { domain: 'general', method: 'keyword' };
    }
    logger.info({ domain: keywordResult.domain, method: 'keyword' }, 'Routed');
    return keywordResult;
  }

  // Phase 2: LLM classify (~300ms)
  const llmResult = await classifyByLLM(message, anthropic);

  // Фильтрация по стеку
  if (userStack && !isDomainAvailable(llmResult.domain, userStack)) {
    logger.info({ domain: llmResult.domain, userStack }, 'Domain not available for user stack, fallback to general');
    return { domain: 'general', method: llmResult.method };
  }

  logger.info({ domain: llmResult.domain, method: llmResult.method }, 'Routed');
  return llmResult;
}
