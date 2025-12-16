/**
 * MCP Response Formatter
 *
 * Применяет форматирование к ответам MCP:
 * - Валидация структуры (responseValidator)
 * - Добавление entity refs (entityLinker)
 * - Генерация ui_json для карточек/таблиц
 */

import { validateAgentResponse, formatValidationResult } from '../chatAssistant/shared/responseValidator.js';
import { attachRefs, buildEntityMap } from '../chatAssistant/shared/entityLinker.js';
import { logger } from '../lib/logger.js';

/**
 * Форматирует MCP response с валидацией и entity linking
 * @param {Object} mcpResponse - Ответ от MCP
 * @param {Object} options
 * @param {string} options.domain - Домен (ads, creative, crm, whatsapp)
 * @param {boolean} options.validate - Применять валидацию
 * @param {boolean} options.addRefs - Добавлять entity refs
 * @returns {Object} Отформатированный ответ
 */
export function formatMCPResponse(mcpResponse, options = {}) {
  const {
    domain = 'unknown',
    validate = true,
    addRefs = true
  } = options;

  let content = mcpResponse.content || '';
  const toolCalls = mcpResponse.toolCalls || [];
  let entities = [];
  let uiJson = null;
  let validation = null;

  // 1. Извлечь entities из tool results и добавить refs
  if (addRefs && toolCalls.length > 0) {
    const extracted = extractEntitiesFromToolCalls(toolCalls, domain);
    entities = extracted.entities;

    // Заменить в тексте ID на refs если возможно
    if (entities.length > 0) {
      content = addRefsToContent(content, entities);
    }
  }

  // 2. Валидация структуры ответа
  if (validate && content) {
    validation = validateAgentResponse(content, { agent: domain });

    if (!validation.valid) {
      logger.warn({
        domain,
        errors: validation.errors,
        warnings: validation.warnings
      }, 'MCP response validation failed');
    }
  }

  // 3. Генерация ui_json для карточек
  if (toolCalls.length > 0) {
    uiJson = generateUIJson(toolCalls, domain);
  }

  return {
    content,
    toolCalls,
    entities,
    uiJson,
    validation,
    formatted: true
  };
}

/**
 * Извлекает entities из результатов tool calls
 * @param {Array} toolCalls
 * @param {string} domain
 * @returns {Object} { entities, entityMap }
 */
function extractEntitiesFromToolCalls(toolCalls, domain) {
  const entities = [];
  const typeMap = {
    getCampaigns: 'c',
    getCampaignDetails: 'c',
    getDirections: 'd',
    getDirectionDetails: 'd',
    getCreatives: 'cr',
    getCreativeDetails: 'cr',
    getLeads: 'l',
    getLeadDetails: 'l'
  };

  for (const tc of toolCalls) {
    const refType = typeMap[tc.name];
    if (!refType) continue;

    try {
      const result = typeof tc.result === 'string' ? JSON.parse(tc.result) : tc.result;

      // Handle arrays (list tools)
      if (Array.isArray(result)) {
        const withRefs = attachRefs(result, refType);
        const entityMap = buildEntityMap(result, refType);
        entities.push(...entityMap);
      }
      // Handle single objects (detail tools)
      else if (result && result.id) {
        entities.push({
          ref: `${refType}1`,
          type: refType,
          id: result.id,
          name: result.name || result.title || result.campaign_name || `#${result.id.slice(-6)}`
        });
      }
    } catch (e) {
      // Not JSON, skip
    }
  }

  return { entities };
}

/**
 * Добавляет refs в текстовый контент
 * @param {string} content
 * @param {Array} entities
 * @returns {string}
 */
function addRefsToContent(content, entities) {
  let result = content;

  for (const entity of entities) {
    // Попробовать найти упоминание entity по имени и добавить ref
    if (entity.name) {
      const escapedName = entity.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(${escapedName})(?!.*\\[${entity.ref}\\])`, 'g');
      result = result.replace(regex, `$1 [${entity.ref}]`);
    }
  }

  return result;
}

/**
 * Генерирует ui_json для визуализации
 * @param {Array} toolCalls
 * @param {string} domain
 * @returns {Object|null}
 */
function generateUIJson(toolCalls, domain) {
  // Находим основной data tool call
  const dataTool = toolCalls.find(tc =>
    tc.name.startsWith('get') && tc.result
  );

  if (!dataTool) return null;

  try {
    const result = typeof dataTool.result === 'string'
      ? JSON.parse(dataTool.result)
      : dataTool.result;

    // Определяем тип визуализации
    if (Array.isArray(result) && result.length > 0) {
      return generateTableUI(result, dataTool.name, domain);
    }

    if (result && typeof result === 'object') {
      return generateCardUI(result, dataTool.name, domain);
    }

  } catch (e) {
    return null;
  }

  return null;
}

/**
 * Генерирует табличный UI
 */
function generateTableUI(items, toolName, domain) {
  // Определяем колонки на основе tool
  const columnDefs = {
    getCampaigns: ['name', 'status', 'spend', 'leads', 'cpl'],
    getDirections: ['name', 'status', 'daily_budget', 'spend', 'leads'],
    getCreatives: ['name', 'type', 'risk_score', 'spend', 'leads'],
    getLeads: ['name', 'phone', 'stage', 'score', 'created_at'],
    getROIReport: ['name', 'spend', 'revenue', 'roi', 'leads'],
    getROIComparison: ['name', 'spend', 'revenue', 'roi_percent', 'rank']
  };

  const columns = columnDefs[toolName] || Object.keys(items[0] || {}).slice(0, 5);

  return {
    type: 'table',
    tool: toolName,
    domain,
    columns,
    rows: items.slice(0, 10).map(item => {
      const row = {};
      for (const col of columns) {
        row[col] = formatCellValue(item[col], col);
      }
      return row;
    }),
    total: items.length,
    truncated: items.length > 10
  };
}

/**
 * Генерирует карточный UI
 */
function generateCardUI(item, toolName, domain) {
  return {
    type: 'card',
    tool: toolName,
    domain,
    title: item.name || item.title || item.campaign_name || 'Детали',
    id: item.id,
    fields: Object.entries(item)
      .filter(([k]) => !k.startsWith('_') && k !== 'id')
      .slice(0, 10)
      .map(([key, value]) => ({
        label: formatFieldLabel(key),
        value: formatCellValue(value, key)
      }))
  };
}

/**
 * Форматирует значение ячейки
 */
function formatCellValue(value, column) {
  if (value === null || value === undefined) return '—';

  // Денежные поля
  if (['spend', 'revenue', 'cpl', 'budget', 'daily_budget'].includes(column)) {
    const num = parseFloat(value);
    if (!isNaN(num)) {
      return `$${num.toFixed(2)}`;
    }
  }

  // Процентные поля
  if (['roi', 'roi_percent', 'ctr', 'conversion_rate'].includes(column)) {
    const num = parseFloat(value);
    if (!isNaN(num)) {
      return `${num.toFixed(1)}%`;
    }
  }

  // Даты
  if (column.includes('_at') || column.includes('date')) {
    try {
      return new Date(value).toLocaleDateString('ru-RU');
    } catch (e) {
      return value;
    }
  }

  return String(value);
}

/**
 * Форматирует label поля
 */
function formatFieldLabel(key) {
  const labels = {
    name: 'Название',
    status: 'Статус',
    spend: 'Расход',
    revenue: 'Выручка',
    leads: 'Лиды',
    cpl: 'CPL',
    roi: 'ROI',
    roi_percent: 'ROI %',
    daily_budget: 'Дневной бюджет',
    created_at: 'Создано',
    updated_at: 'Обновлено',
    phone: 'Телефон',
    stage: 'Этап',
    score: 'Скор',
    risk_score: 'Risk Score',
    type: 'Тип'
  };

  return labels[key] || key.replace(/_/g, ' ');
}

/**
 * Проверка — нужен ли repair pass
 * @param {Object} validation
 * @returns {boolean}
 */
export function needsRepairPass(validation) {
  if (!validation) return false;

  // Repair если есть критические ошибки
  return validation.errors.length > 0;
}

export default {
  formatMCPResponse,
  needsRepairPass
};
