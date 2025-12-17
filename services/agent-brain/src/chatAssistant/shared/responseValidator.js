/**
 * Response Validator
 * Проверяет структуру ответов агентов на соответствие контракту
 */

/**
 * Валидатор структуры ответа агента
 * @param {string} content - Текст ответа агента
 * @param {Object} options - Опции валидации
 * @param {string} options.agent - Имя агента (ads, crm, creative, whatsapp)
 * @param {boolean} options.strict - Строгий режим (ошибки вместо предупреждений)
 * @returns {ValidationResult}
 */
export function validateAgentResponse(content, options = {}) {
  const { agent = 'unknown', strict = false } = options;
  const errors = [];
  const warnings = [];

  // 1. Проверка секций
  const hasItog = /\*\*Итог\*\*|📊\s*\*?\*?Итог/i.test(content);
  const hasInsights = /\*\*Инсайты?\*\*|Инсайт[ыи]?:/i.test(content);
  const hasNextSteps = /\*\*Следующие шаги\*\*|Следующие шаги:/i.test(content);
  const hasConfidence = false; // Removed confidence requirement

  if (!hasItog) {
    (strict ? errors : warnings).push('Нет секции "Итог"');
  }
  if (!hasInsights) {
    (strict ? errors : warnings).push('Нет секции "Инсайты"');
  }
  if (!hasNextSteps) {
    (strict ? errors : warnings).push('Нет секции "Следующие шаги"');
  }
  // Confidence check removed

  // 2. Проверка refs
  const refs = content.match(/\[(c|d|cr|l)\d+\]/g) || [];
  const uniqueRefs = [...new Set(refs)];
  if (uniqueRefs.length === 0) {
    warnings.push('Нет refs в ответе');
  }

  // 3. Проверка инсайтов (минимум 2)
  const insightMarkers = (content.match(/[✅⚠️🚨⚡🔥❄️]/g) || []).length;
  if (insightMarkers < 2) {
    warnings.push(`Меньше 2 инсайтов с эмодзи (найдено: ${insightMarkers})`);
  }

  // 4. Проверка "галлюцинаций" — X% без числа
  const suspiciousPercent = /на X%|X₸|около X|примерно X/i.test(content);
  if (suspiciousPercent) {
    errors.push('Найден placeholder X — нужно реальное число или "н/д"');
  }

  // 5. Проверка незаполненных данных
  const missingData = content.match(/\[не указано\]|\[нет данных\]|\[?н\/д\]?/gi) || [];
  if (missingData.length > 3) {
    warnings.push(`Много незаполненных данных (${missingData.length} шт.) — возможно проблема с tool`);
  }

  // 6. Проверка таблиц (если есть данные)
  const hasTable = /\|.*\|.*\|/m.test(content);
  const hasListData = refs.length > 2;
  if (hasListData && !hasTable) {
    warnings.push('Есть refs, но нет таблицы — лучше структурировать');
  }

  // 7. Проверка следующих шагов removed (emoji markers no longer required)

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: {
      refs: uniqueRefs.length,
      insights: insightMarkers,
      hasTable,
      hasConfidence,
      sections: {
        itog: hasItog,
        insights: hasInsights,
        nextSteps: hasNextSteps,
        confidence: hasConfidence
      }
    },
    agent
  };
}

/**
 * Валидатор для синтезированного ответа (multi-agent)
 * @param {string} content - Текст синтезированного ответа
 * @param {Array<string>} agents - Список агентов, участвовавших в синтезе
 * @returns {ValidationResult}
 */
export function validateSynthesisResponse(content, agents = []) {
  const baseResult = validateAgentResponse(content, { agent: 'synthesis' });

  // Дополнительные проверки для синтеза
  const warnings = [...baseResult.warnings];

  // Проверка упоминания доменов
  const domainMentions = {
    ads: /реклам|кампани|бюджет|spend|CPL/i.test(content),
    crm: /лид|воронк|этап|score/i.test(content),
    creative: /креатив|risk.*score|retention/i.test(content)
  };

  const mentionedDomains = Object.entries(domainMentions)
    .filter(([, mentioned]) => mentioned)
    .map(([domain]) => domain);

  if (agents.length > 1 && mentionedDomains.length < 2) {
    warnings.push('Multi-agent ответ, но упомянут только один домен');
  }

  // Проверка связей между доменами
  const hasCrossInsight = /\+.*→|связь|при этом|однако|но качество|но риск/i.test(content);
  if (agents.length > 1 && !hasCrossInsight) {
    warnings.push('Нет кросс-доменных инсайтов в синтезе');
  }

  return {
    ...baseResult,
    warnings,
    stats: {
      ...baseResult.stats,
      domains: mentionedDomains,
      hasCrossInsight
    }
  };
}

/**
 * Форматирует результат валидации в читаемый вид
 * @param {ValidationResult} result
 * @returns {string}
 */
export function formatValidationResult(result) {
  const lines = [];

  if (result.valid) {
    lines.push('✅ Ответ валиден');
  } else {
    lines.push('❌ Ответ невалиден');
  }

  if (result.errors.length > 0) {
    lines.push('\nОшибки:');
    result.errors.forEach(e => lines.push(`  🚨 ${e}`));
  }

  if (result.warnings.length > 0) {
    lines.push('\nПредупреждения:');
    result.warnings.forEach(w => lines.push(`  ⚠️ ${w}`));
  }

  lines.push('\nСтатистика:');
  lines.push(`  - Refs: ${result.stats.refs}`);
  lines.push(`  - Инсайты: ${result.stats.insights}`);
  lines.push(`  - Таблица: ${result.stats.hasTable ? 'да' : 'нет'}`);
  lines.push(`  - Уверенность: ${result.stats.hasConfidence ? 'да' : 'нет'}`);

  return lines.join('\n');
}

/**
 * Быстрая проверка — прошёл ли ответ валидацию
 * @param {string} content
 * @returns {boolean}
 */
export function isValidResponse(content) {
  return validateAgentResponse(content).valid;
}
