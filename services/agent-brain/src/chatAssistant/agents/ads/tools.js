/**
 * AdsAgent Tools - Facebook/Instagram Advertising
 * 9 tools: 4 READ + 5 WRITE
 */

export const ADS_TOOLS = [
  // ============================================================
  // READ TOOLS
  // ============================================================
  {
    name: 'getCampaigns',
    description: 'Получить список кампаний с метриками (расходы, лиды, CPL, CTR) за указанный период',
    parameters: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          enum: ['today', 'yesterday', 'last_7d', 'last_30d'],
          description: 'Период для метрик'
        },
        status: {
          type: 'string',
          enum: ['ACTIVE', 'PAUSED', 'all'],
          description: 'Фильтр по статусу кампаний'
        }
      },
      required: ['period']
    }
  },
  {
    name: 'getCampaignDetails',
    description: 'Получить детальную информацию о кампании включая адсеты и объявления',
    parameters: {
      type: 'object',
      properties: {
        campaign_id: {
          type: 'string',
          description: 'ID кампании в Facebook'
        }
      },
      required: ['campaign_id']
    }
  },
  {
    name: 'getAdSets',
    description: 'Получить список адсетов кампании с метриками',
    parameters: {
      type: 'object',
      properties: {
        campaign_id: {
          type: 'string',
          description: 'ID кампании'
        },
        period: {
          type: 'string',
          enum: ['today', 'yesterday', 'last_7d', 'last_30d'],
          description: 'Период для метрик'
        }
      },
      required: ['campaign_id']
    }
  },
  {
    name: 'getSpendReport',
    description: 'Получить отчёт по расходам за период с разбивкой по кампаниям или дням',
    parameters: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          enum: ['today', 'yesterday', 'last_7d', 'last_30d'],
          description: 'Период отчёта'
        },
        group_by: {
          type: 'string',
          enum: ['campaign', 'day'],
          description: 'Группировка данных'
        }
      },
      required: ['period']
    }
  },

  // ============================================================
  // WRITE TOOLS
  // ============================================================
  {
    name: 'pauseCampaign',
    description: 'Поставить кампанию на паузу',
    parameters: {
      type: 'object',
      properties: {
        campaign_id: {
          type: 'string',
          description: 'ID кампании для паузы'
        },
        reason: {
          type: 'string',
          description: 'Причина паузы (для логирования)'
        }
      },
      required: ['campaign_id']
    }
  },
  {
    name: 'resumeCampaign',
    description: 'Возобновить приостановленную кампанию',
    parameters: {
      type: 'object',
      properties: {
        campaign_id: {
          type: 'string',
          description: 'ID кампании для возобновления'
        }
      },
      required: ['campaign_id']
    }
  },
  {
    name: 'pauseAdSet',
    description: 'Поставить адсет на паузу',
    parameters: {
      type: 'object',
      properties: {
        adset_id: {
          type: 'string',
          description: 'ID адсета для паузы'
        },
        reason: {
          type: 'string',
          description: 'Причина паузы'
        }
      },
      required: ['adset_id']
    }
  },
  {
    name: 'resumeAdSet',
    description: 'Возобновить приостановленный адсет',
    parameters: {
      type: 'object',
      properties: {
        adset_id: {
          type: 'string',
          description: 'ID адсета для возобновления'
        }
      },
      required: ['adset_id']
    }
  },
  {
    name: 'updateBudget',
    description: 'Изменить дневной бюджет адсета. ВНИМАНИЕ: изменение бюджета > 50% требует подтверждения.',
    parameters: {
      type: 'object',
      properties: {
        adset_id: {
          type: 'string',
          description: 'ID адсета'
        },
        new_budget_cents: {
          type: 'number',
          description: 'Новый дневной бюджет в центах (минимум 500, т.е. $5)'
        }
      },
      required: ['adset_id', 'new_budget_cents']
    }
  }
];

// Write tools that require confirmation in 'plan' mode
export const ADS_WRITE_TOOLS = [
  'pauseCampaign',
  'resumeCampaign',
  'pauseAdSet',
  'resumeAdSet',
  'updateBudget'
];

// Dangerous tools that ALWAYS require confirmation
export const ADS_DANGEROUS_TOOLS = ['updateBudget'];
