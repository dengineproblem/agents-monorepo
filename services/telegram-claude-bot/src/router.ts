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
  domains?: string[];     // set when multiple domains matched (cross-domain merge)
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
 * Returns RouteResult for single or multi-domain match, null for no match
 */
function classifyByKeywords(message: string): RouteResult | null {
  const matched: string[] = [];

  for (const rule of KEYWORD_RULES) {
    if (rule.patterns.some(p => p.test(message))) {
      matched.push(rule.domain);
    }
  }

  if (matched.length === 0) return null;

  // Cross-domain: merge tools from matched domains instead of fallback to all
  if (matched.length > 1) {
    logger.info({ domains: matched }, 'Cross-domain detected, merging tools');
    return { domain: matched[0], domains: matched, method: 'keyword' };
  }

  return { domain: matched[0], method: 'keyword' };
}

const ROUTER_SYSTEM_PROMPT = `Classify the user message into ONE domain. Reply with ONLY the domain name:
- ads (Facebook campaigns, budgets, metrics, directions, optimization, adsets, spend reports, ROI)
- creative (image/text generation, creative analysis, A/B tests, banners, carousels)
- crm (leads, sales, WhatsApp dialogs, funnel, clients)
- tiktok (TikTok campaigns and metrics)
- onboarding (user registration, creating accounts)
- general (greetings, unclear requests, errors, web search, other)

IMPORTANT: If the user message is a follow-up (like "try again", "show more", "yes", "do it"), classify based on the CONVERSATION CONTEXT, not just the current message.

Reply with ONLY ONE word — the domain name.`;

/**
 * Phase 2: LLM classification via Haiku (~300ms)
 * Retries once on connection errors (DNS flakes in Docker)
 * Uses recent conversation context for follow-up messages
 */
async function classifyByLLM(
  message: string,
  anthropic: Anthropic,
  recentContext?: string,
): Promise<RouteResult> {
  const MAX_ATTEMPTS = 2;

  // Build messages with optional conversation context
  const llmMessages: Anthropic.MessageParam[] = [];
  if (recentContext) {
    llmMessages.push({ role: 'user', content: `Recent conversation:\n${recentContext}` });
    llmMessages.push({ role: 'assistant', content: 'Understood. I will use this context to classify the next message.' });
  }
  llmMessages.push({ role: 'user', content: message.slice(0, 200) });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await anthropic.messages.create(
        {
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 10,
          system: ROUTER_SYSTEM_PROMPT,
          messages: llmMessages,
        },
        { timeout: 10_000 }, // 10s timeout for routing (default is too long)
      );

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
      const isConnectionError = error instanceof Anthropic.APIConnectionError
        || error?.message?.includes('Connection error')
        || error?.code === 'EAI_AGAIN'
        || error?.code === 'ECONNRESET';

      if (isConnectionError && attempt < MAX_ATTEMPTS) {
        logger.warn({ attempt, error: error.message }, 'LLM routing connection error, retrying');
        continue;
      }

      logger.error({ error: error.message, attempt }, 'LLM routing failed, fallback');
      return { domain: 'general', method: 'fallback' };
    }
  }

  return { domain: 'general', method: 'fallback' };
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
export const ACCOUNT_SWITCH_PATTERN = new RegExp([
  'переключи(ть)?.*аккаунт',
  'смени(ть)?.*аккаунт',
  'поменя(й|ть).*аккаунт',
  'выбер(и|ать).*аккаунт',
  'другой\\s+аккаунт',
  'покажи.*аккаунт',
  'список\\s+аккаунт',
  'какой\\s+аккаунт',
  'текущий\\s+аккаунт',
  'мои\\s+аккаунт',
  'аккаунты',
  'switch\\s+account',
  'change\\s+account',
].join('|'), 'i');

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
 *
 * @param recentContext — last 3 messages for LLM context (follow-up routing)
 * @param lastDomain — sticky domain from session (fallback for vague messages)
 */
export async function routeMessage(
  message: string,
  anthropic: Anthropic,
  userStack?: string[],
  recentContext?: string,
  lastDomain?: string | null,
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

  // Phase 2: LLM classify (~300ms) — only for "no keyword match" case
  const llmResult = await classifyByLLM(message, anthropic, recentContext);

  // Phase 3: Sticky domain — if LLM returns 'general' but we had a recent domain, use it
  if (llmResult.domain === 'general' && lastDomain && lastDomain !== 'general') {
    logger.info({ llmDomain: 'general', stickyDomain: lastDomain }, 'LLM returned general, using sticky domain');
    return { domain: lastDomain, method: 'fallback' };
  }

  // Фильтрация по стеку
  if (userStack && !isDomainAvailable(llmResult.domain, userStack)) {
    logger.info({ domain: llmResult.domain, userStack }, 'Domain not available for user stack, fallback to general');
    return { domain: 'general', method: llmResult.method };
  }

  logger.info({ domain: llmResult.domain, method: llmResult.method }, 'Routed');
  return llmResult;
}
