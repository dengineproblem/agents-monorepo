/**
 * Meta-Tools Formatters
 *
 * Загрузка и форматирование domain tools для LLM
 */

import { AdsToolDefs } from '../agents/ads/toolDefs.js';
import { CreativeToolDefs } from '../agents/creative/toolDefs.js';
import { CrmToolDefs } from '../agents/crm/toolDefs.js';
import { WhatsappToolDefs } from '../agents/whatsapp/toolDefs.js';

/**
 * Domain tool definitions mapping
 */
const DOMAIN_TOOLS = {
  ads: AdsToolDefs,
  creative: CreativeToolDefs,
  crm: CrmToolDefs,
  whatsapp: WhatsappToolDefs
};

/**
 * Domain descriptions
 */
const DOMAIN_DESCRIPTIONS = {
  ads: 'Управление Facebook рекламой: кампании, адсеты, бюджеты, расходы, CPL, ROI, направления, Brain Agent',
  creative: 'Креативы: анализ метрик, retention, risk scores, топ/худшие креативы, запуск, A/B тесты, генерация',
  crm: 'CRM и лиды: воронка продаж, этапы, квалификация, детали лидов, качество продаж',
  whatsapp: 'WhatsApp диалоги: история сообщений, AI-анализ переписок, поиск по диалогам'
};

/**
 * Load all tools for a domain
 * @param {string} domain - Domain name (ads, creative, crm, whatsapp)
 * @returns {Array} Array of tool definitions with name and metadata
 */
export function loadDomainTools(domain) {
  const toolDefs = DOMAIN_TOOLS[domain];

  if (!toolDefs) {
    throw new Error(`Unknown domain: ${domain}`);
  }

  return Object.entries(toolDefs).map(([name, def]) => ({
    name,
    description: def.description,
    schema: def.schema,
    meta: def.meta || {}
  }));
}

/**
 * Format tools for LLM consumption
 * Adds DANGEROUS marker and converts schema to parameters description
 * @param {Array} tools - Array of tool definitions
 * @returns {Array} Formatted tools for LLM
 */
export function formatToolsForLLM(tools) {
  return tools.map(tool => {
    const isDangerous = tool.meta?.dangerous === true;

    // Build parameters description from Zod schema
    const parameters = extractParametersFromZod(tool.schema);

    return {
      name: tool.name,
      description: isDangerous
        ? `⚠️ DANGEROUS: ${tool.description} Требует подтверждения пользователя!`
        : tool.description,
      parameters,
      dangerous: isDangerous,
      timeout_ms: tool.meta?.timeout || 20000
    };
  });
}

/**
 * Extract parameters info from Zod schema
 * @param {z.ZodType} schema - Zod schema
 * @returns {Array} Parameters array with name, type, required, description
 */
function extractParametersFromZod(schema) {
  if (!schema || !schema.shape) {
    return [];
  }

  const params = [];

  for (const [key, value] of Object.entries(schema.shape)) {
    const param = {
      name: key,
      type: getZodTypeName(value),
      required: !isOptional(value)
    };

    // Extract description
    if (value._def?.description) {
      param.description = value._def.description;
    }

    // Extract enum values
    if (value._def?.typeName === 'ZodEnum') {
      param.enum = value._def.values;
    }

    // Extract default value
    if (value._def?.typeName === 'ZodDefault') {
      param.default = value._def.defaultValue();
    }

    params.push(param);
  }

  return params;
}

/**
 * Get type name from Zod type
 */
function getZodTypeName(zodType) {
  let type = zodType;

  // Unwrap optional/default
  while (type._def?.innerType) {
    type = type._def.innerType;
  }

  const typeName = type._def?.typeName;

  switch (typeName) {
    case 'ZodString':
      return 'string';
    case 'ZodNumber':
      return 'number';
    case 'ZodBoolean':
      return 'boolean';
    case 'ZodArray':
      return 'array';
    case 'ZodObject':
      return 'object';
    case 'ZodEnum':
      return 'string (enum)';
    case 'ZodRecord':
      return 'object';
    default:
      return 'string';
  }
}

/**
 * Check if Zod type is optional
 */
function isOptional(zodType) {
  // ZodOptional
  if (zodType._def?.typeName === 'ZodOptional') {
    return true;
  }

  // ZodDefault is also optional (has default value)
  if (zodType._def?.typeName === 'ZodDefault') {
    return true;
  }

  // Check isOptional method
  if (typeof zodType.isOptional === 'function') {
    return zodType.isOptional();
  }

  return false;
}

/**
 * Get domain description
 * @param {string} domain - Domain name
 * @returns {string} Description
 */
export function getDomainDescription(domain) {
  return DOMAIN_DESCRIPTIONS[domain] || `Unknown domain: ${domain}`;
}

/**
 * Get all domain names
 * @returns {string[]} Array of domain names
 */
export function getAllDomains() {
  return Object.keys(DOMAIN_TOOLS);
}

/**
 * Check if tool exists
 * @param {string} toolName - Tool name
 * @returns {{ domain: string, tool: Object } | null}
 */
export function findTool(toolName) {
  for (const [domain, tools] of Object.entries(DOMAIN_TOOLS)) {
    if (tools[toolName]) {
      return {
        domain,
        tool: {
          name: toolName,
          ...tools[toolName]
        }
      };
    }
  }
  return null;
}

/**
 * Get tool definition by name
 * @param {string} toolName - Tool name
 * @returns {Object | null} Tool definition or null
 */
export function getToolDef(toolName) {
  const result = findTool(toolName);
  return result ? result.tool : null;
}

/**
 * Get domain for tool
 * @param {string} toolName - Tool name
 * @returns {string | null} Domain name or null
 */
export function getDomainForTool(toolName) {
  const result = findTool(toolName);
  return result ? result.domain : null;
}
