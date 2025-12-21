/**
 * Meta-Tools Definitions
 *
 * 3 meta-tools for lazy-loading domain tools:
 * - getAvailableDomains() - список доступных доменов
 * - getDomainTools(domain) - tools конкретного домена
 * - executeTool(name, args) - выполнение tool
 */

import { z } from 'zod';
import { formatToolsForLLM, loadDomainTools, getDomainDescription } from './formatters.js';
import { executeToolAdaptive } from './mcpBridge.js';
import { routeToolCallsToDomains } from './domainRouter.js';

/**
 * Domain configurations
 */
const DOMAINS = {
  ads: {
    name: 'ads',
    description: 'Управление рекламой: кампании, бюджеты, расходы, CPL, ROI, направления'
  },
  creative: {
    name: 'creative',
    description: 'Креативы: анализ, retention, risk score, топ/худшие, запуск, A/B тесты'
  },
  crm: {
    name: 'crm',
    description: 'Лиды: воронка, этапы, квалификация, детали контакта'
  },
  whatsapp: {
    name: 'whatsapp',
    description: 'Диалоги: история сообщений, AI-анализ переписок, поиск'
  }
};

/**
 * Meta-Tool Definitions
 */
export const META_TOOLS = {
  /**
   * Get available domains with descriptions
   */
  getAvailableDomains: {
    name: 'getAvailableDomains',
    description: 'Получить список доступных доменов (ads, creative, crm, whatsapp) с описанием возможностей каждого. Вызови первым чтобы понять какие домены нужны для запроса.',
    schema: z.object({}),
    handler: async (_args, context) => {
      const domains = Object.values(DOMAINS).map(d => ({
        name: d.name,
        description: d.description,
        available: isDomainAvailable(d.name, context)
      }));

      return {
        domains,
        hint: 'Используй getDomainTools(domain) чтобы получить список tools нужного домена'
      };
    }
  },

  /**
   * Get tools for specific domain
   */
  getDomainTools: {
    name: 'getDomainTools',
    description: 'Получить список tools для конкретного домена с описаниями и параметрами. Tools с меткой DANGEROUS требуют подтверждения пользователя.',
    schema: z.object({
      domain: z.enum(['ads', 'creative', 'crm', 'whatsapp'])
        .describe('Домен для получения tools')
    }),
    handler: async ({ domain }, _context) => {
      const tools = loadDomainTools(domain);
      const formattedTools = formatToolsForLLM(tools);

      return {
        domain,
        description: getDomainDescription(domain),
        tools_count: formattedTools.length,
        tools: formattedTools
      };
    }
  },

  /**
   * Execute tools and get processed response from domain agent
   *
   * Domain agent receives:
   * - Raw data from tools
   * - User context (directions, target CPL, etc.)
   * - User question
   *
   * Domain agent returns ready answer, orchestrator may formalize/combine if multiple domains.
   */
  executeTools: {
    name: 'executeTools',
    description: `Выполнить tools и получить готовый ответ от специализированного агента.

⚠️ КРИТИЧНО: Каждый tool ДОЛЖЕН иметь args с параметрами!

Примеры правильного вызова:
- { "name": "getSalesQuality", "args": { "direction_id": "uuid-here", "date_from": "2024-06-20", "date_to": "2024-12-20" } }
- { "name": "getSpendReport", "args": { "date_from": "2024-12-01", "date_to": "2024-12-20" } }

НЕ ПЕРЕДАВАЙ параметры в user_question — передавай их в args каждого tool!

Агент возвращает готовый ответ. Если несколько доменов — ты объединяешь ответы.

DANGEROUS tools требуют подтверждения — сначала спроси пользователя!`,
    schema: z.object({
      tools: z.array(z.object({
        name: z.string().describe('Имя tool (например: getSpendReport)'),
        args: z.record(z.unknown()).describe('ОБЯЗАТЕЛЬНО! Аргументы tool: direction_id, date_from, date_to, period и др. НЕ оставляй пустым!')
      })).describe('Массив tools. Каждый tool ДОЛЖЕН иметь args с параметрами (direction_id, date_from, date_to).'),
      user_question: z.string().describe('Краткий вопрос пользователя для контекста (БЕЗ параметров — они в args)')
    }),
    handler: async ({ tools, user_question }, context) => {
      // DEBUG: Log incoming tool calls from LLM
      console.log('[executeTools] LLM tool calls:', JSON.stringify(tools, null, 2));
      console.log('[executeTools] User question:', user_question);

      // Route through domain agents
      const results = await routeToolCallsToDomains(tools, context, user_question);

      // Format response for orchestrator
      const domainResponses = {};
      const allToolsExecuted = [];
      let extractedPlan = null; // Plan from tools like triggerBrainOptimizationRun

      for (const [domain, result] of Object.entries(results)) {
        if (result.success) {
          domainResponses[domain] = result.response;
          // Extract plan if domain returned one (e.g., from triggerBrainOptimizationRun)
          if (result.plan && !extractedPlan) {
            extractedPlan = result.plan;
            console.log('[executeTools] Plan extracted from domain:', domain);
          }
        } else {
          domainResponses[domain] = `Ошибка: ${result.error}`;
        }
        // Collect all executed tools from all domains
        if (result.toolsExecuted) {
          allToolsExecuted.push(...result.toolsExecuted);
        }
      }

      return {
        success: true,
        responses: domainResponses,
        domains_called: Object.keys(results),
        tools_executed: allToolsExecuted, // For tracking in executedTools
        plan: extractedPlan, // Plan from mini-AgentBrain (triggerBrainOptimizationRun)
        hint: 'Объедини ответы агентов в единый ответ пользователю'
      };
    }
  },

  /**
   * Execute single tool directly (for simple cases)
   * @deprecated Use executeTools for better responses
   */
  executeTool: {
    name: 'executeTool',
    description: '[DEPRECATED - используй executeTools] Выполнить один tool напрямую. Возвращает сырые данные.',
    schema: z.object({
      tool_name: z.string()
        .describe('Имя tool для выполнения'),
      arguments: z.record(z.unknown())
        .describe('Аргументы для tool')
    }),
    handler: async ({ tool_name, arguments: args }, context) => {
      return executeToolAdaptive(tool_name, args, context);
    }
  }
};

/**
 * Check if domain is available for user
 * @param {string} domain - Domain name
 * @param {Object} context - User context with integrations
 * @returns {boolean}
 */
function isDomainAvailable(domain, context) {
  const integrations = context?.integrations || {};

  switch (domain) {
    case 'ads':
    case 'creative':
      return integrations.fb === true;
    case 'crm':
      return integrations.crm === true;
    case 'whatsapp':
      return integrations.whatsapp === true;
    default:
      return false;
  }
}

/**
 * Get meta-tools formatted for OpenAI function calling
 * @returns {Array} OpenAI tools format
 */
export function getMetaToolsForOpenAI() {
  return Object.values(META_TOOLS).map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: zodToJsonSchema(tool.schema)
    }
  }));
}

/**
 * Convert Zod schema to JSON Schema for OpenAI
 * @param {z.ZodType} zodSchema
 * @returns {Object} JSON Schema
 */
function zodToJsonSchema(zodSchema) {
  // For empty object schema
  if (zodSchema._def.typeName === 'ZodObject' && Object.keys(zodSchema.shape).length === 0) {
    return {
      type: 'object',
      properties: {},
      required: []
    };
  }

  const shape = zodSchema.shape;
  const properties = {};
  const required = [];

  for (const [key, value] of Object.entries(shape)) {
    properties[key] = zodTypeToJsonSchema(value);

    // Check if required
    if (!value.isOptional()) {
      required.push(key);
    }
  }

  return {
    type: 'object',
    properties,
    required
  };
}

/**
 * Convert a single Zod type to JSON Schema
 * @param {z.ZodType} zodType
 * @returns {Object} JSON Schema for this type
 */
function zodTypeToJsonSchema(zodType) {
  const typeName = zodType._def.typeName;
  const result = {};

  // Add description if exists
  if (zodType._def.description) {
    result.description = zodType._def.description;
  }

  switch (typeName) {
    case 'ZodString':
      result.type = 'string';
      break;

    case 'ZodNumber':
      result.type = 'number';
      break;

    case 'ZodBoolean':
      result.type = 'boolean';
      break;

    case 'ZodEnum':
      result.type = 'string';
      result.enum = zodType._def.values;
      break;

    case 'ZodArray': {
      result.type = 'array';
      // Get the inner type schema for items
      const innerType = zodType._def.type;
      result.items = zodTypeToJsonSchema(innerType);
      break;
    }

    case 'ZodObject': {
      result.type = 'object';
      const shape = zodType.shape;
      result.properties = {};
      result.required = [];

      for (const [key, value] of Object.entries(shape)) {
        result.properties[key] = zodTypeToJsonSchema(value);
        if (!value.isOptional()) {
          result.required.push(key);
        }
      }
      break;
    }

    case 'ZodRecord':
      result.type = 'object';
      result.additionalProperties = true;
      break;

    case 'ZodOptional':
      return zodTypeToJsonSchema(zodType._def.innerType);

    case 'ZodUnknown':
    case 'ZodAny':
      // For unknown/any, use object with additionalProperties
      result.type = 'object';
      result.additionalProperties = true;
      break;

    default:
      result.type = 'string';
  }

  return result;
}

export default META_TOOLS;
