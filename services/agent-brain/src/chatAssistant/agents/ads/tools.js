/**
 * AdsAgent Tools - Facebook/Instagram Advertising
 * 15 tools: 7 READ + 8 WRITE
 */

export const ADS_TOOLS = [
  // ============================================================
  // READ TOOLS - Campaigns & AdSets
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
  // READ TOOLS - Directions
  // ============================================================
  {
    name: 'getDirections',
    description: 'Получить список направлений (рекламных вертикалей) с метриками за период',
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['active', 'paused', 'all'],
          description: 'Фильтр по статусу направлений'
        },
        period: {
          type: 'string',
          enum: ['today', 'yesterday', 'last_7d', 'last_30d'],
          description: 'Период для метрик'
        }
      }
    }
  },
  {
    name: 'getDirectionDetails',
    description: 'Получить детальную информацию о направлении включая привязанные адсеты и креативы',
    parameters: {
      type: 'object',
      properties: {
        direction_id: {
          type: 'string',
          description: 'UUID направления из таблицы directions'
        }
      },
      required: ['direction_id']
    }
  },
  {
    name: 'getDirectionMetrics',
    description: 'Получить метрики направления с разбивкой по дням за период',
    parameters: {
      type: 'object',
      properties: {
        direction_id: {
          type: 'string',
          description: 'UUID направления'
        },
        period: {
          type: 'string',
          enum: ['7d', '14d', '30d'],
          description: 'Период для метрик'
        }
      },
      required: ['direction_id']
    }
  },

  // ============================================================
  // WRITE TOOLS - Campaigns & AdSets
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
  },

  // ============================================================
  // WRITE TOOLS - Directions
  // ============================================================
  {
    name: 'updateDirectionBudget',
    description: 'Изменить суточный бюджет направления. Обновит budget_per_day в настройках направления.',
    parameters: {
      type: 'object',
      properties: {
        direction_id: {
          type: 'string',
          description: 'UUID направления'
        },
        new_budget: {
          type: 'number',
          description: 'Новый суточный бюджет в долларах (например: 50)'
        }
      },
      required: ['direction_id', 'new_budget']
    }
  },
  {
    name: 'updateDirectionTargetCPL',
    description: 'Изменить целевой CPL направления. Используется для автоматической оптимизации.',
    parameters: {
      type: 'object',
      properties: {
        direction_id: {
          type: 'string',
          description: 'UUID направления'
        },
        target_cpl: {
          type: 'number',
          description: 'Новый целевой CPL в долларах (например: 15.50)'
        }
      },
      required: ['direction_id', 'target_cpl']
    }
  },
  {
    name: 'pauseDirection',
    description: 'Поставить направление на паузу. Все связанные адсеты будут приостановлены.',
    parameters: {
      type: 'object',
      properties: {
        direction_id: {
          type: 'string',
          description: 'UUID направления'
        },
        reason: {
          type: 'string',
          description: 'Причина паузы (для логирования)'
        }
      },
      required: ['direction_id']
    }
  }
];

// Write tools that require confirmation in 'plan' mode
export const ADS_WRITE_TOOLS = [
  'pauseCampaign',
  'resumeCampaign',
  'pauseAdSet',
  'resumeAdSet',
  'updateBudget',
  'updateDirectionBudget',
  'updateDirectionTargetCPL',
  'pauseDirection'
];

// Dangerous tools that ALWAYS require confirmation
export const ADS_DANGEROUS_TOOLS = ['updateBudget', 'pauseDirection'];
