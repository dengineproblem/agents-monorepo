/**
 * CRMAgent Tools - Leads & Funnel
 * 4 tools: 3 READ + 1 WRITE
 */

export const CRM_TOOLS = [
  // ============================================================
  // READ TOOLS
  // ============================================================
  {
    name: 'getLeads',
    description: 'Получить список лидов с фильтрами по температуре, этапу воронки, score',
    parameters: {
      type: 'object',
      properties: {
        interest_level: {
          type: 'string',
          enum: ['hot', 'warm', 'cold'],
          description: 'Фильтр по температуре лида'
        },
        funnel_stage: {
          type: 'string',
          description: 'Фильтр по этапу воронки'
        },
        min_score: {
          type: 'number',
          description: 'Минимальный score лида (0-100)'
        },
        limit: {
          type: 'number',
          description: 'Максимальное количество лидов (по умолчанию 20)'
        },
        search: {
          type: 'string',
          description: 'Поиск по имени или телефону'
        }
      }
    }
  },
  {
    name: 'getLeadDetails',
    description: 'Получить полную информацию о лиде: контакты, история, анализ диалога',
    parameters: {
      type: 'object',
      properties: {
        lead_id: {
          type: 'string',
          description: 'ID лида'
        }
      },
      required: ['lead_id']
    }
  },
  {
    name: 'getFunnelStats',
    description: 'Получить статистику по воронке продаж: количество лидов на каждом этапе, конверсии',
    parameters: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          enum: ['today', 'yesterday', 'last_7d', 'last_30d'],
          description: 'Период для статистики'
        }
      },
      required: ['period']
    }
  },

  // ============================================================
  // WRITE TOOLS
  // ============================================================
  {
    name: 'updateLeadStage',
    description: 'Изменить этап воронки для лида',
    parameters: {
      type: 'object',
      properties: {
        lead_id: {
          type: 'string',
          description: 'ID лида'
        },
        new_stage: {
          type: 'string',
          description: 'Новый этап воронки'
        },
        reason: {
          type: 'string',
          description: 'Причина изменения'
        }
      },
      required: ['lead_id', 'new_stage']
    }
  }
];

// Write tools that may require confirmation
export const CRM_WRITE_TOOLS = ['updateLeadStage'];
