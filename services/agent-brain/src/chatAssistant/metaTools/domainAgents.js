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
const DOMAIN_AGENT_MODEL = process.env.DOMAIN_AGENT_MODEL || 'gpt-5.2';

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
  const { layerLogger } = context;

  // Fast path: triggerBrainOptimizationRun с proposals = 0 → вернуть formatted.text напрямую (без LLM)
  const brainResult = rawResults['triggerBrainOptimizationRun'];
  if (brainResult?.result?.formatted?.text) {
    const proposals = brainResult.result.proposals || [];
    if (proposals.length === 0) {
      logger.info({ domain, proposals: 0 }, 'Domain agent: skipping LLM, returning formatted.text directly');
      return brainResult.result.formatted.text;
    }
  }

  // Layer 9: Domain Agents start
  layerLogger?.start(9, { domain, toolsCount: Object.keys(rawResults).length });

  // Get domain-specific system prompt
  const systemPrompt = buildDomainSystemPrompt(domain, context);

  // Format tool results for LLM
  const toolResultsText = formatToolResults(rawResults);

  // Build user message with context and recommendations
  const userPrompt = buildDomainUserPrompt(userMessage, toolCalls, toolResultsText, context, rawResults);

  layerLogger?.info(9, `LLM call for domain: ${domain}`, { model: DOMAIN_AGENT_MODEL });

  try {
    const response = await openai.chat.completions.create({
      model: DOMAIN_AGENT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      max_completion_tokens: 16000
    });

    const content = response.choices[0]?.message?.content || '';
    const latency = Date.now() - startTime;

    logger.info({
      domain,
      toolsCount: Object.keys(rawResults).length,
      latency,
      responseLength: content.length
    }, 'Domain agent: processed results');

    layerLogger?.end(9, { domain, responseLength: content.length, latencyMs: latency });

    return content;

  } catch (error) {
    layerLogger?.error(9, error, { domain });
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

    // Directions context (priority over manual mode)
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
    } else if (context.campaignMapping?.length > 0) {
      // Manual mode: user has campaign mappings from memory
      parts.push('\n### Кампании (ручной режим):');
      parts.push('⚠️ Пользователь управляет рекламой вручную, данные из памяти.');
      parts.push('');
      for (const m of context.campaignMapping) {
        const cplDisplay = m.target_cpl_cents ? `$${(m.target_cpl_cents / 100).toFixed(2)}` : 'не указан';
        parts.push(`- **${m.direction_name}** (Campaign: ${m.campaign_id})`);
        parts.push(`  - Цель: ${m.goal || 'не указана'}`);
        parts.push(`  - Target CPL: ${cplDisplay}`);
        if (m.campaign_name) {
          parts.push(`  - Название: ${m.campaign_name}`);
        }
      }
      parts.push('');
      parts.push('**При анализе:**');
      parts.push('- Сравнивай фактический CPL с target_cpl из маппинга');
      parts.push('- CPL > target × 1.3 → рекомендуй снижение бюджета или паузу');
      parts.push('- CPL < target × 0.7 → рекомендуй масштабирование');
    } else if (context.isManualMode) {
      // Manual mode without mappings yet
      parts.push('\n### Ручной режим (нет данных о кампаниях)');
      parts.push('⚠️ У пользователя нет направлений в системе и нет сохранённых маппингов.');
      parts.push('');
      parts.push('**Что делать:**');
      parts.push('1. Покажи список кампаний из кабинета');
      parts.push('2. Спроси какие направления и какой плановый CPL');
      parts.push('3. Сохрани через saveCampaignMapping');
    }

    // Account settings
    if (context.adAccountId) {
      parts.push(`\n### Рекламный аккаунт: ${context.adAccountId}`);
    }

    // Important business logic
    parts.push('\n### Важно:');
    if (context.directions?.length > 0) {
      parts.push('- 1 направление = 1 FB кампания');
      parts.push('- Если вопрос про направление — используй его fb_campaign_id для данных');
    } else {
      parts.push('- В ручном режиме ориентируйся на campaign_id из маппинга');
      parts.push('- НЕ создавай новые адсеты — нет загруженных креативов');
    }

    // ROI-ориентация
    parts.push('\n### ROI-ориентация (КРИТИЧНО!)');
    parts.push('- **Главная метрика:** ROI, если недоступен → QCPL');
    parts.push('- ⚠️ Дешёвый CPL ≠ хороший креатив');
    parts.push('- Всегда сопоставляй: CPL → QCPL → конверсию воронки');
    parts.push('- Масштабировать ТОЛЬКО если QCPL в пределах target');

    parts.push('\n### Формулы:');
    parts.push('- CPL = spend / leads');
    parts.push('- QCPL = spend / quality_leads (2+ сообщений)');
    parts.push('- ROI = (revenue - spend) / spend × 100');

    parts.push('\n### Связь с воронкой:');
    parts.push('- Реклама привлекает лидов → лиды идут по воронке → часть конвертируется');
    parts.push('- Хороший креатив = привлекает ЦЕЛЕВУЮ аудиторию, которая конвертируется');
    parts.push('- Если CPL низкий, но лиды не конвертируются → креатив привлекает нецелевых');

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

    parts.push('\n### Performance тиры (ROI-ориентация):');
    parts.push('- **A**: ROI > 150% ИЛИ QCPL < target × 0.7 → МАСШТАБИРОВАТЬ');
    parts.push('- **B**: ROI 100-150% ИЛИ QCPL < target → ДЕРЖАТЬ');
    parts.push('- **C**: ROI 50-100% ИЛИ QCPL = target × 1.3 → ТЕСТИРОВАТЬ');
    parts.push('- **D**: ROI < 50% ИЛИ QCPL > target × 1.5 → ОПТИМИЗИРОВАТЬ/ВЫКЛЮЧИТЬ');

    parts.push('\n### Качество креатива:');
    parts.push('- Хороший креатив = привлекает целевую аудиторию');
    parts.push('- Оценивай не только CTR/CPL, но и качество лидов');
    parts.push('- Креатив с CTR 0.5% но горячими лидами лучше CTR 2% с холодными');

    parts.push('\n### Связь с воронкой:');
    parts.push('- Креатив → привлекает лидов → лиды идут по воронке');
    parts.push('- Если лиды не конвертируются → креатив привлекает нецелевых');
    parts.push('- Смотри на qualification_rate: % лидов, дошедших до ключевого этапа');

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

    parts.push('\n### Связь с рекламой (ВАЖНО!)');
    parts.push('- Каждый лид пришёл от конкретного креатива/кампании');
    parts.push('- Анализируй: какие креативы дают HOT лидов, какие COLD');
    parts.push('- Если лиды от креатива X не конвертируются → сигнал отключить креатив');
    parts.push('- Qualification rate по креативу = % лидов, дошедших до ключевого этапа');

    parts.push('\n### Метрики качества:');
    parts.push('- Qualification rate = qualified / total × 100');
    parts.push('- Conversion to key stage = key_stage_leads / total × 100');
    parts.push('- Если qualification_rate < 20% → креатив привлекает нецелевых');

    parts.push('\n### Формат ответа');
    parts.push('- Используй 🔥⚡❄️ для температуры');
    parts.push('- Показывай qualification_rate в %');
    parts.push('- **ВАЖНО**: используй `recommendations` из данных для инсайтов');
    parts.push('- Группируй по креативам/направлениям если есть');

    return parts.join('\n');
  },

  whatsapp: (context) => {
    const parts = ['\n## Контекст WhatsApp'];

    // Dialogs context
    if (context.activeDialogs) {
      parts.push(`\n### Статистика диалогов`);
      parts.push(`- Активных за 24ч: ${context.activeDialogs || 0}`);
      parts.push(`- Всего диалогов: ${context.totalDialogs || 0}`);
    }

    // Directions context (source of leads)
    if (context.directions?.length > 0) {
      parts.push('\n### Направления (источники лидов):');
      for (const dir of context.directions) {
        parts.push(`- **${dir.name}** (ID: ${dir.id})`);
      }
    }

    // Temperature legend
    parts.push('\n### Температура лидов (interest_level)');
    parts.push('- 🔥 **hot**: score 70-100, готов к покупке, обсуждает детали');
    parts.push('- ⚡ **warm**: score 40-69, есть интерес, нужна работа');
    parts.push('- ❄️ **cold**: score 0-39, слабый интерес');

    // Funnel stages
    parts.push('\n### Этапы воронки (funnel_stage)');
    parts.push('- `new` — новый контакт');
    parts.push('- `qualified` — квалифицирован');
    parts.push('- `interested` — проявил интерес');
    parts.push('- `objection` — есть возражения');
    parts.push('- `scheduled` — записан на приём');

    // Analysis fields
    parts.push('\n### Поля анализа диалога');
    parts.push('- `key_interests` — что интересует клиента');
    parts.push('- `objections` — выявленные возражения');
    parts.push('- `buying_signals` — сигналы готовности к покупке');
    parts.push('- `next_action` — рекомендуемое следующее действие');

    // Связь с рекламой
    parts.push('\n### Влияние на рекламу (ВАЖНО!)');
    parts.push('- Качество диалога = сигнал о качестве креатива');
    parts.push('- Много "one-message" диалогов → креатив привлекает любопытных, не целевых');
    parts.push('- Много вопросов о цене → креатив не транслирует ценник');
    parts.push('- Много возражений → нужно работать над messaging в креативах');

    parts.push('\n### Связь температуры с источником:');
    parts.push('- HOT диалоги → креатив попал в целевую аудиторию');
    parts.push('- COLD диалоги → креатив привлёк случайных');
    parts.push('- Если direction X даёт больше HOT → масштабировать');

    // Formatting rules
    parts.push('\n### Формат ответа');
    parts.push('- Маскируй телефоны: 79001234567 → +7***4567');
    parts.push('- Используй [dl1], [dl2] для refs на диалоги');
    parts.push('- Группируй по температуре: hot → warm → cold');
    parts.push('- Добавляй эмодзи 🔥⚡❄️ для наглядности');
    parts.push('- Выделяй возражения и сигналы покупки');

    return parts.join('\n');
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
      // Для triggerBrainOptimizationRun БЕЗ proposals — шаблонный ответ (без LLM интерпретации)
      // Если есть proposals — старое поведение (полный JSON для LLM)
      const proposals = data.result?.proposals || [];
      if (toolName === 'triggerBrainOptimizationRun' && proposals.length === 0 && data.result?.formatted?.text) {
        parts.push(data.result.formatted.text);
      } else {
        // Pretty print result, limit size (increased for large datasets like 50+ ads)
        const resultStr = JSON.stringify(data.result, null, 2);
        console.log(`[formatToolResults] ${toolName}: ${resultStr.length} chars, ads: ${data.result?.ads?.length || 0}, totals: ${JSON.stringify(data.result?.totals || {})}`);
        if (resultStr.length > 50000) {
          parts.push(resultStr.substring(0, 50000) + '\n... (данные обрезаны)');
        } else {
          parts.push(resultStr);
        }
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
