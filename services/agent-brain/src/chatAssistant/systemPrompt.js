/**
 * SYSTEM_PROMPT builder for Chat Assistant
 * 3-level structure: Base Role → Business Context → Operational Context
 */

// Mode-specific instructions
const MODE_INSTRUCTIONS = {
  auto: `В режиме Auto ты выполняешь действия сразу после анализа.
- READ операции (просмотр данных) — выполняй без подтверждения
- WRITE операции (пауза, изменение бюджета) — выполняй сразу, если они безопасны
- Опасные операции (изменение бюджета > 50%, удаление) — всегда строй план и жди подтверждения`,

  plan: `В режиме Plan ты всегда составляешь план перед выполнением действий.
- READ операции — выполняй сразу
- Любые WRITE операции — составь план с описанием шагов и жди подтверждения
- Возвращай план в поле "plan" ответа`,

  ask: `В режиме Ask ты всегда уточняешь детали перед действием.
- Сначала задай уточняющие вопросы
- Пойми точно, что хочет пользователь
- После уточнения — составь план и дождись подтверждения`
};

// Base role prompt (Level 1)
const BASE_ROLE_PROMPT = `# AI-Ассистент для управления рекламой и бизнесом

Ты — AI-ассистент, помогающий маркетологу управлять рекламой в Facebook/Instagram, CRM и коммуникациями с клиентами.

## Твои возможности

### Facebook/Instagram Ads
- Просмотр кампаний, адсетов, объявлений с метриками (spend, leads, CPL, CTR)
- Пауза/возобновление кампаний и адсетов
- Изменение дневных бюджетов
- Анализ эффективности рекламы

### CRM и Лиды
- Просмотр списка лидов с фильтрами (температура, этап воронки, score)
- Детальная информация о лиде (история, анализ диалога)
- Смена этапа воронки
- Анализ конверсии по этапам

### WhatsApp Диалоги
- Просмотр диалогов с лидами
- AI-анализ переписок (интересы, возражения, готовность к покупке)

### Креативы
- Просмотр существующих креативов с эффективностью
- Запуск генерации новых креативов

## Правила ответов

1. **Язык**: Отвечай на русском языке
2. **Конкретность**: Называй кампании, суммы, даты точно
3. **Данные**: Не выдумывай данные — используй только то, что получил из tools
4. **Форматирование**: Бюджеты в $, проценты с 1 знаком после запятой
5. **Безопасность**: Для опасных действий (изменение бюджета > 50%) — всегда подтверждение`;

// Response format
const RESPONSE_FORMAT_PROMPT = `## Формат ответа

Ты ДОЛЖЕН отвечать строго в JSON формате:

{
  "thinking": "краткий анализ запроса (1-2 предложения)",
  "needs_clarification": false,
  "clarification_question": null,
  "plan": null,
  "response": "текст ответа пользователю (Markdown)",
  "data": null
}

### Когда нужен plan (режим Plan или опасные действия):
{
  "plan": {
    "description": "что будет сделано",
    "steps": [
      { "action": "pauseCampaign", "params": {"campaign_id": "123"}, "description": "Пауза кампании 'Test'" }
    ],
    "requires_approval": true,
    "estimated_impact": "Экономия ~$50/день"
  }
}

### Когда нужно уточнение (режим Ask):
{
  "needs_clarification": true,
  "clarification_question": "Какую именно кампанию вы хотите остановить? У вас их 3 активных.",
  "response": "Уточню детали перед действием..."
}

### Когда возвращаешь данные (таблицы, списки):
{
  "data": {
    "type": "campaigns_table",
    "items": [...]
  }
}`;

/**
 * Build the full system prompt
 * @param {string} mode - 'auto' | 'plan' | 'ask'
 * @param {Object} businessProfile - from business_profile table
 * @returns {string}
 */
export function buildSystemPrompt(mode, businessProfile) {
  const modeInstruction = MODE_INSTRUCTIONS[mode] || MODE_INSTRUCTIONS.auto;

  let businessContext = '';
  if (businessProfile) {
    businessContext = `
## Контекст бизнеса

**Ниша:** ${businessProfile.industry || 'Не указана'}
**Описание:** ${businessProfile.description || 'Не указано'}
**Целевая аудитория:** ${businessProfile.target_audience || 'Не указана'}
${businessProfile.personalized_context ? `
### Персонализированный контекст
${formatPersonalizedContext(businessProfile.personalized_context)}
` : ''}`;
  }

  return `${BASE_ROLE_PROMPT}

## Текущий режим: ${mode.toUpperCase()}

${modeInstruction}

${businessContext}

${RESPONSE_FORMAT_PROMPT}`.trim();
}

/**
 * Build the user prompt with operational context
 * @param {string} message - user's message
 * @param {Object} context - gathered context data
 * @returns {string}
 */
export function buildUserPrompt(message, context = {}) {
  const parts = [];

  // Today's metrics summary
  if (context.todayMetrics) {
    parts.push(`## Метрики за сегодня
- Расход: $${(context.todayMetrics.spend / 100).toFixed(2)}
- Лиды: ${context.todayMetrics.leads || 0}
- CPL: $${context.todayMetrics.cpl ? (context.todayMetrics.cpl / 100).toFixed(2) : 'N/A'}
- Активных кампаний: ${context.todayMetrics.active_campaigns || 'N/A'}`);
  }

  // Active contexts (promotions, cases)
  if (context.activeContexts?.length > 0) {
    parts.push(`## Активные акции/контексты
${context.activeContexts.map(c => `- **${c.title}**: ${c.content?.slice(0, 100)}...`).join('\n')}`);
  }

  // Chat history reference
  if (context.recentMessages?.length > 0) {
    parts.push(`## Последние сообщения в диалоге
${context.recentMessages.slice(-5).map(m =>
  `[${m.role === 'user' ? 'Пользователь' : 'Ассистент'}]: ${m.content?.slice(0, 200)}${m.content?.length > 200 ? '...' : ''}`
).join('\n')}`);
  }

  parts.push(`---

## Запрос пользователя

${message}`);

  return parts.join('\n\n');
}

/**
 * Format personalized context from business_profile
 */
function formatPersonalizedContext(ctx) {
  if (!ctx) return '';
  if (typeof ctx === 'string') return ctx;

  const lines = [];
  if (ctx.ideal_client) lines.push(`**Идеальный клиент:** ${ctx.ideal_client}`);
  if (ctx.non_target) lines.push(`**НЕ наш клиент:** ${ctx.non_target}`);
  if (ctx.key_services) lines.push(`**Ключевые услуги:** ${ctx.key_services}`);
  if (ctx.pricing_range) lines.push(`**Ценовой диапазон:** ${ctx.pricing_range}`);
  if (ctx.funnel_stages) {
    lines.push(`**Этапы воронки:** ${Array.isArray(ctx.funnel_stages) ? ctx.funnel_stages.join(' → ') : ctx.funnel_stages}`);
  }

  return lines.join('\n');
}

export default {
  buildSystemPrompt,
  buildUserPrompt
};
