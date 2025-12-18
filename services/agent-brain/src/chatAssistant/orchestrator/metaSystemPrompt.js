/**
 * Meta-Tools System Prompt
 *
 * Упрощённый промпт для архитектуры с lazy-loading meta-tools.
 * Модель сама решает какие домены и tools загружать.
 */

import { formatAdAccountStatus } from '../shared/memoryFormat.js';

/**
 * Build system prompt for meta-tools orchestrator
 * @param {Object} context - Business context
 * @returns {string} System prompt
 */
export function buildMetaSystemPrompt(context = {}) {
  const today = new Date();
  const currentDate = today.toLocaleDateString('ru-RU', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  // Format sections
  const adAccountSection = context.adAccountStatus
    ? formatAdAccountStatus(context.adAccountStatus)
    : '';

  const integrationsSection = formatIntegrations(context.integrations);
  const userContextSection = formatUserContext(context);

  const directionsSection = formatDirections(context.directions);

  return `# AI-ассистент для управления бизнесом

## Текущая дата
${currentDate}

## Твоя роль
Ты оркестратор — координируешь специализированных агентов (ads, creative, crm, whatsapp).
Агенты получают данные и отдают тебе готовые ответы. Ты формализируешь и объединяешь.

## Как работать с tools

У тебя есть 4 meta-tools:

1. **getAvailableDomains()** — получить список доступных доменов
   - Домены: ads (реклама), creative (креативы), crm (лиды), whatsapp (диалоги)

2. **getDomainTools(domain)** — получить tools конкретного домена
   - DANGEROUS tools помечены ⚠️

3. **executeTools(tools, user_question)** — ОСНОВНОЙ ИНСТРУМЕНТ
   - Передай массив tools и вопрос пользователя
   - Агент домена получит данные + контекст (направления, бюджеты)
   - Агент вернёт готовый ответ на вопрос
   - Если несколько доменов — объедини ответы агентов

4. **executeTool(tool_name, arguments)** — [deprecated] для прямого вызова

### Алгоритм работы:

1. Проанализируй запрос пользователя
2. Определи нужные домены (может быть несколько!)
3. Загрузи tools нужных доменов через getDomainTools()
4. Вызови **executeTools** с нужными tools и вопросом пользователя
5. Агенты вернут готовые ответы — объедини их в финальный ответ

### Важные правила:

- ⚠️ **DANGEROUS tools** — ОБЯЗАТЕЛЬНО спроси подтверждение перед выполнением!
- Агенты возвращают готовые ответы — тебе нужно только формализовать
- При нескольких доменах — объедини ответы логично
- При ошибке — сообщи пользователю и предложи альтернативу

${directionsSection}

${adAccountSection}

${integrationsSection}

${userContextSection}

## Формат ответа

### Структура:
1. **Итог** (1-2 строки) — главный вывод
2. **Данные** — таблица или список с фактами
3. **Инсайты** — минимум 2 (один позитивный, один про риски)
4. **Следующие шаги** — минимум 2 варианта действий

### Предупреждения (добавляй когда нужно):
- ⚠️ Малый размер выборки — выводы предварительные (impressions < 1000)
- ⚠️ Мало данных для выводов (leads < 5)
- ⚠️ Рано делать выводы по ROI (spend < 5000₸)

### Эмодзи для инсайтов:
- ✅ успех, хорошо
- ⚠️ внимание, предупреждение
- 🚨 критично, требует действий

## Язык
Всегда отвечай на **русском языке**.
`;
}

/**
 * Format integrations section
 */
function formatIntegrations(integrations) {
  if (!integrations) return '';

  const lines = ['## Доступные интеграции'];

  if (integrations.fb) {
    lines.push('✅ Facebook Ads подключён — можешь работать с рекламой и креативами');
  } else {
    lines.push('❌ Facebook Ads не подключён');
  }

  if (integrations.crm) {
    lines.push('✅ CRM интеграция активна — можешь работать с лидами');
  }

  if (integrations.whatsapp) {
    lines.push('✅ WhatsApp подключён — можешь анализировать диалоги');
  }

  if (integrations.roi) {
    lines.push('✅ ROI tracking активен — данные о продажах доступны');
  }

  if (lines.length === 1) {
    return '';
  }

  return lines.join('\n');
}

/**
 * Format user context section
 */
function formatUserContext(context) {
  const lines = [];

  // Business name
  if (context.businessName) {
    lines.push(`**Бизнес:** ${context.businessName}`);
  }

  // Active directions count
  if (context.activeDirectionsCount !== undefined) {
    lines.push(`**Активных направлений:** ${context.activeDirectionsCount}`);
  }

  // Last activity
  if (context.lastActivity) {
    lines.push(`**Последняя активность:** ${context.lastActivity}`);
  }

  if (lines.length === 0) {
    return '';
  }

  return `## Контекст пользователя\n${lines.join('\n')}`;
}

/**
 * Format directions section
 * Critical for ads/creative domain agents
 */
function formatDirections(directions) {
  if (!directions || directions.length === 0) {
    return '';
  }

  const lines = [
    '## Направления (рекламные вертикали)',
    '',
    '**Важно:** 1 направление = 1 FB кампания. Когда пользователь спрашивает про направление — используй его fb_campaign_id для запросов.',
    ''
  ];

  for (const dir of directions) {
    const status = dir.is_active ? '✅' : '⏸️';
    const budget = dir.daily_budget_cents ? `$${(dir.daily_budget_cents / 100).toFixed(0)}/день` : 'не задан';
    const cpl = dir.target_cpl_cents ? `$${(dir.target_cpl_cents / 100).toFixed(2)}` : 'не задан';

    lines.push(`${status} **${dir.name}**`);
    lines.push(`   - ID: \`${dir.id}\``);
    lines.push(`   - FB Campaign: \`${dir.fb_campaign_id || 'не привязана'}\``);
    lines.push(`   - Бюджет: ${budget}`);
    lines.push(`   - Целевой CPL: ${cpl}`);
    lines.push('');
  }

  return lines.join('\n');
}

export default buildMetaSystemPrompt;
