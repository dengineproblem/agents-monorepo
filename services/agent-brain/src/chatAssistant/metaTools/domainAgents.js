/**
 * Domain Agents
 *
 * Специализированные агенты по доменам (ads, creative, crm, whatsapp).
 * Каждый агент получает:
 * - Raw данные от tools
 * - Контекст пользователя (направления, плановый CPL, и т.д.)
 * - Вопрос пользователя
 *
 * Агент отдаёт готовый ответ на вопрос пользователя.
 * Оркестратор формализирует и объединяет если несколько доменов.
 */

import OpenAI from 'openai';
import { logger } from '../../lib/logger.js';

const openai = new OpenAI();

// Model for domain agents - fast and good for summarization
const DOMAIN_AGENT_MODEL = process.env.DOMAIN_AGENT_MODEL || 'gpt-4o-mini';

/**
 * Process raw tool results through domain agent
 *
 * @param {string} domain - Domain name (ads, creative, crm, whatsapp)
 * @param {Array<{name: string, args: Object}>} toolCalls - Executed tool calls
 * @param {Object} rawResults - Raw results from tools { toolName: { args, result } }
 * @param {Object} context - Full context including directions, target CPL, etc.
 * @param {string} userMessage - Original user question
 * @returns {Promise<string>} Processed response from domain agent
 */
export async function processDomainResults(domain, toolCalls, rawResults, context, userMessage) {
  const startTime = Date.now();

  // Get domain-specific system prompt
  const systemPrompt = buildDomainSystemPrompt(domain, context);

  // Format tool results for LLM
  const toolResultsText = formatToolResults(rawResults);

  // Build user message with context and recommendations
  const userPrompt = buildDomainUserPrompt(userMessage, toolCalls, toolResultsText, context, rawResults);

  try {
    const response = await openai.chat.completions.create({
      model: DOMAIN_AGENT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      max_tokens: 1500
    });

    const content = response.choices[0]?.message?.content || '';
    const latency = Date.now() - startTime;

    logger.info({
      domain,
      toolsCount: Object.keys(rawResults).length,
      latency,
      responseLength: content.length
    }, 'Domain agent: processed results');

    return content;

  } catch (error) {
    logger.error({ domain, error: error.message }, 'Domain agent: LLM call failed');
    // Fallback: return raw summary
    return formatFallbackResponse(domain, rawResults, userMessage);
  }
}

/**
 * Build system prompt for domain agent
 */
function buildDomainSystemPrompt(domain, context) {
  const base = `Ты эксперт-аналитик по ${DOMAIN_DESCRIPTIONS[domain] || domain}.

## Твоя задача
Проанализировать данные и дать чёткий, конкретный ответ на вопрос пользователя.

## Формат ответа
- Отвечай на русском языке
- Будь конкретным: суммы в долларах, проценты, ID
- Используй bullet points для списков
- Если есть проблемы — укажи их
- Если нужны действия — предложи конкретные шаги
- НЕ добавляй лишние рассуждения, отвечай по существу

## Дата
Сегодня: ${new Date().toLocaleDateString('ru-RU')}
`;

  // Add domain-specific context
  const domainContext = DOMAIN_CONTEXT_BUILDERS[domain]?.(context) || '';

  return base + domainContext;
}

/**
 * Domain descriptions for system prompts
 */
const DOMAIN_DESCRIPTIONS = {
  ads: 'рекламе в Facebook/Instagram. Кампании, адсеты, бюджеты, CPL, ROI',
  creative: 'креативам. Анализ эффективности, retention, risk score, запуск/пауза',
  crm: 'лидам и воронке продаж. Этапы, конверсии, качество лидов',
  whatsapp: 'WhatsApp диалогам. История переписок, вовлечённость, анализ общения'
};

/**
 * Domain-specific context builders
 */
const DOMAIN_CONTEXT_BUILDERS = {
  ads: (context) => {
    const parts = ['\n## Контекст аккаунта'];

    // Directions context
    if (context.directions?.length > 0) {
      parts.push('\n### Активные направления:');
      for (const dir of context.directions) {
        parts.push(`- **${dir.name}** (ID: ${dir.id})`);
        parts.push(`  - Статус: ${dir.is_active ? 'активно' : 'на паузе'}`);
        parts.push(`  - Бюджет/день: $${(dir.daily_budget_cents || 0) / 100}`);
        parts.push(`  - Целевой CPL: $${(dir.target_cpl_cents || 0) / 100}`);
        if (dir.fb_campaign_id) {
          parts.push(`  - FB Campaign: ${dir.fb_campaign_id}`);
        }
      }
    }

    // Account settings
    if (context.adAccountId) {
      parts.push(`\n### Рекламный аккаунт: ${context.adAccountId}`);
    }

    // Important business logic
    parts.push('\n### Важно:');
    parts.push('- 1 направление = 1 FB кампания');
    parts.push('- Если вопрос про направление — используй его fb_campaign_id для данных');

    return parts.join('\n');
  },

  creative: (context) => {
    const parts = ['\n## Контекст'];

    if (context.directions?.length > 0) {
      parts.push('\n### Направления для креативов:');
      for (const dir of context.directions) {
        parts.push(`- ${dir.name} (ID: ${dir.id})`);
      }
    }

    parts.push('\n### Performance тиры:');
    parts.push('- **A**: Отличный (масштабировать)');
    parts.push('- **B**: Хороший (поддерживать)');
    parts.push('- **C**: Средний (тестировать)');
    parts.push('- **D**: Плохой (оптимизировать или отключить)');

    return parts.join('\n');
  },

  crm: (context) => {
    const parts = ['\n## Контекст воронки'];

    if (context.directions?.length > 0) {
      parts.push('\n### Направления (источники лидов):');
      for (const dir of context.directions) {
        parts.push(`- **${dir.name}** (ID: ${dir.id})`);
        if (dir.key_stage_1_status_id) parts.push('  - Ключевые этапы настроены');
      }
    }

    // amoCRM integration context
    if (context.integrations?.crm) {
      parts.push('\n### amoCRM интеграция');
      parts.push('- amoCRM подключён');
      parts.push('- Доступна статистика квалификации');
      parts.push('- Доступна история статусов лидов');
    }

    parts.push('\n### Температура лидов');
    parts.push('- 🔥 **Hot**: score 70-100, готов к сделке');
    parts.push('- ⚡ **Warm**: score 40-69, есть интерес');
    parts.push('- ❄️ **Cold**: score 0-39, требует прогрева');

    parts.push('\n### Квалификация (amoCRM)');
    parts.push('- `is_qualified` — лид прошёл квалификационный этап');
    parts.push('- `reached_key_stage_1/2/3` — достиг ключевого этапа (навсегда)');

    parts.push('\n### Формат ответа');
    parts.push('- Используй 🔥⚡❄️ для температуры');
    parts.push('- Показывай qualification_rate в %');
    parts.push('- **ВАЖНО**: используй `recommendations` из данных для инсайтов');
    parts.push('- Группируй по креативам/направлениям если есть');

    return parts.join('\n');
  },

  whatsapp: (context) => {
    return '\n## Контекст\nАнализируй диалоги с учётом бизнес-контекста клиента.';
  }
};

/**
 * Build user prompt for domain agent
 */
function buildDomainUserPrompt(userMessage, toolCalls, toolResultsText, context, rawResults) {
  const parts = [];

  // Original question
  parts.push('## Вопрос пользователя');
  parts.push(userMessage || '(не указан)');

  // Tools executed
  parts.push('\n## Выполненные запросы');
  for (const call of toolCalls) {
    parts.push(`- ${call.name}(${JSON.stringify(call.args)})`);
  }

  // Raw results
  parts.push('\n## Полученные данные');
  parts.push(toolResultsText);

  // Extract recommendations from tool results
  const recommendations = extractRecommendations(rawResults);
  if (recommendations.length > 0) {
    parts.push('\n## 🎯 Рекомендации из анализа (ИСПОЛЬЗУЙ ИХ!)');
    for (const rec of recommendations) {
      const icon = rec.type === 'scale_creative' || rec.type === 'high_conversion' ? '✅' : '⚠️';
      parts.push(`- ${icon} **${rec.reason}** → ${rec.action_label}`);
    }
  }

  // Instructions
  parts.push('\n---');
  parts.push('Проанализируй данные и ответь на вопрос пользователя.');
  parts.push('Если есть рекомендации выше — обязательно включи их в ответ.');
  parts.push('Если данных недостаточно — укажи что ещё нужно запросить.');

  return parts.join('\n');
}

/**
 * Extract recommendations from raw tool results
 */
function extractRecommendations(rawResults) {
  const recommendations = [];

  for (const [toolName, data] of Object.entries(rawResults || {})) {
    const result = data?.result;
    if (!result) continue;

    // Direct recommendations array
    if (Array.isArray(result.recommendations)) {
      recommendations.push(...result.recommendations);
    }

    // Nested in data
    if (result.data?.recommendations) {
      recommendations.push(...result.data.recommendations);
    }
  }

  return recommendations;
}

/**
 * Format tool results for LLM consumption
 */
function formatToolResults(rawResults) {
  const parts = [];

  for (const [toolName, data] of Object.entries(rawResults)) {
    parts.push(`### ${toolName}`);

    if (data.result?.success === false) {
      parts.push(`Ошибка: ${data.result.error || 'unknown'}`);
    } else {
      // Pretty print result, limit size
      const resultStr = JSON.stringify(data.result, null, 2);
      if (resultStr.length > 3000) {
        parts.push(resultStr.substring(0, 3000) + '\n... (данные обрезаны)');
      } else {
        parts.push(resultStr);
      }
    }

    parts.push('');
  }

  return parts.join('\n');
}

/**
 * Fallback response if LLM fails
 */
function formatFallbackResponse(domain, rawResults, userMessage) {
  const toolNames = Object.keys(rawResults).join(', ');
  const hasErrors = Object.values(rawResults).some(r => r.result?.success === false);

  if (hasErrors) {
    return `⚠️ Возникли ошибки при получении данных (${toolNames}). Попробуйте уточнить запрос.`;
  }

  return `Данные получены (${toolNames}). Вопрос: "${userMessage}"`;
}

export default {
  processDomainResults
};
