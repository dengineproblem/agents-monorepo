import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import { logger } from './logger.js';

const AGENT_SERVICE_URL = process.env.AGENT_SERVICE_URL || 'http://agent-service:8082';
const BRAIN_SERVICE_URL = process.env.BRAIN_SERVICE_URL || 'http://agent-brain:7080';

/**
 * Определения всех инструментов для Anthropic Tool Use
 */
export const tools: Anthropic.Tool[] = [
  // ===== FACEBOOK ADS SPECIALIST =====
  {
    name: 'getCampaigns',
    description: 'Получить список Facebook кампаний с метриками',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: {
          type: 'string',
          description: 'UUID пользователя из контекста сессии',
        },
        period: {
          type: 'string',
          enum: ['today', 'yesterday', 'last_7d', 'last_30d', 'lifetime'],
          description: 'Период для метрик',
        },
        status: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['ACTIVE', 'PAUSED'],
          },
          description: 'Фильтр по статусу кампаний',
        },
      },
      required: ['userAccountId'],
    },
  },
  {
    name: 'getAdSets',
    description: 'Получить адсеты кампании',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        campaignId: { type: 'string', description: 'ID Facebook кампании' },
        period: { type: 'string' },
      },
      required: ['userAccountId', 'campaignId'],
    },
  },
  {
    name: 'getCampaignDetails',
    description: 'Детали конкретной кампании',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        campaignId: { type: 'string' },
        period: { type: 'string' },
      },
      required: ['userAccountId', 'campaignId'],
    },
  },
  {
    name: 'getDirections',
    description: 'Получить направления (группы кампаний)',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
      },
      required: ['userAccountId'],
    },
  },
  {
    name: 'pauseAdSet',
    description: 'Поставить адсет на паузу',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        adSetId: { type: 'string' },
      },
      required: ['userAccountId', 'adSetId'],
    },
  },
  {
    name: 'resumeAdSet',
    description: 'Возобновить адсет',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        adSetId: { type: 'string' },
      },
      required: ['userAccountId', 'adSetId'],
    },
  },
  {
    name: 'updateBudget',
    description: 'Изменить бюджет адсета',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        adSetId: { type: 'string' },
        dailyBudget: { type: 'number', description: 'Новый суточный бюджет в долларах' },
      },
      required: ['userAccountId', 'adSetId', 'dailyBudget'],
    },
  },
  {
    name: 'updateDirectionBudget',
    description: 'Изменить суточный бюджет направления',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        direction_id: { type: 'string', description: 'UUID направления' },
        new_budget: { type: 'number', description: 'Новый суточный бюджет в долларах' },
        dry_run: { type: 'boolean', description: 'Preview режим без выполнения' },
      },
      required: ['userAccountId', 'direction_id', 'new_budget'],
    },
  },

  // ===== CREATIVES SPECIALIST =====
  {
    name: 'getCreatives',
    description: 'Получить список креативов с метриками за 30 дней',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        direction_id: { type: 'string', description: 'UUID направления для фильтрации' },
        status: { type: 'string', enum: ['active', 'all'] },
        sort_by: { type: 'string', enum: ['cpl', 'leads', 'spend', 'score', 'created'] },
        limit: { type: 'number' },
      },
      required: ['userAccountId'],
    },
  },
  {
    name: 'generateOffer',
    description: 'Сгенерировать заголовок/оффер для креатива (ШАГ 1 из 5)',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        prompt: { type: 'string', description: 'Описание для генерации оффера' },
      },
      required: ['userAccountId', 'prompt'],
    },
  },
  {
    name: 'generateBullets',
    description: 'Сгенерировать буллеты/преимущества (ШАГ 2 из 5)',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        prompt: { type: 'string' },
        existing_offer: { type: 'string', description: 'Оффер из шага 1' },
      },
      required: ['userAccountId', 'prompt'],
    },
  },
  {
    name: 'generateProfits',
    description: 'Сгенерировать выгоды для клиента (ШАГ 3 из 5)',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        prompt: { type: 'string' },
        existing_offer: { type: 'string' },
        existing_bullets: { type: 'string' },
      },
      required: ['userAccountId', 'prompt'],
    },
  },
  {
    name: 'generateCta',
    description: 'Сгенерировать призыв к действию (ШАГ 4 из 5)',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        prompt: { type: 'string' },
        existing_offer: { type: 'string' },
        existing_bullets: { type: 'string' },
        existing_profits: { type: 'string' },
      },
      required: ['userAccountId', 'prompt'],
    },
  },
  {
    name: 'generateCreatives',
    description: 'Сгенерировать изображение креатива 1080x1920px с готовыми текстами (ШАГ 5 ФИНАЛ)',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        offer: { type: 'string', description: 'Готовый заголовок' },
        bullets: { type: 'string', description: 'Готовые буллеты' },
        profits: { type: 'string', description: 'Готовые выгоды' },
        cta: { type: 'string', description: 'Готовый CTA' },
        direction_id: { type: 'string' },
        style_id: {
          type: 'string',
          enum: ['modern_performance', 'clean_minimal', 'bold_dark', 'neon_glow', 'gradient_soft'],
        },
      },
      required: ['userAccountId', 'offer'],
    },
  },

  // ===== CRM SPECIALIST =====
  {
    name: 'getLeads',
    description: 'Получить список лидов с фильтрацией',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        status: { type: 'string' },
        period: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['userAccountId'],
    },
  },
  {
    name: 'getSales',
    description: 'Получить список продаж с детализацией',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        period: { type: 'string' },
        direction_id: { type: 'string' },
        min_amount: { type: 'number', description: 'Минимальная сумма покупки в тенге' },
        search: { type: 'string', description: 'Поиск по номеру телефона' },
        limit: { type: 'number' },
      },
      required: ['userAccountId'],
    },
  },
  {
    name: 'addSale',
    description: 'Добавить продажу вручную',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        client_phone: { type: 'string', description: 'Номер телефона клиента (формат: +77001234567)' },
        amount: { type: 'number', description: 'Сумма продажи в тенге (например: 150000 = 150K ₸)' },
        direction_id: { type: 'string' },
        manual_source_id: { type: 'string', description: 'source ID креатива если лид не найден' },
      },
      required: ['userAccountId', 'client_phone', 'amount'],
    },
  },
];

/**
 * Выполнить tool через HTTP запрос к agent-service
 */
export async function executeTool(
  toolName: string,
  toolInput: Record<string, any>
): Promise<any> {
  try {
    logger.info({ toolName, toolInput }, 'Executing tool');

    const url = `${AGENT_SERVICE_URL}/api/brain/tools/${toolName}`;

    const response = await axios.post(url, toolInput, {
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 30000, // 30 секунд
    });

    logger.info({ toolName, success: true }, 'Tool executed successfully');
    return response.data;
  } catch (error: any) {
    logger.error({
      toolName,
      error: error.message,
      response: error.response?.data,
    }, 'Tool execution failed');

    return {
      success: false,
      error: error.response?.data?.error || error.message,
    };
  }
}
