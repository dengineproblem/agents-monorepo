/**
 * OpenAI Function Calling tools definitions for Chat Assistant
 * Organized by category: Facebook Ads, CRM, WhatsApp, Creatives
 */

export const CHAT_TOOLS = [
  // ============================================================
  // FACEBOOK ADS - READ
  // ============================================================
  {
    type: 'function',
    function: {
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
    }
  },
  {
    type: 'function',
    function: {
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
    }
  },
  {
    type: 'function',
    function: {
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
    }
  },
  {
    type: 'function',
    function: {
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
    }
  },

  // ============================================================
  // FACEBOOK ADS - WRITE
  // ============================================================
  {
    type: 'function',
    function: {
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
    dangerous: false
  },
  {
    type: 'function',
    function: {
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
    dangerous: false
  },
  {
    type: 'function',
    function: {
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
    dangerous: false
  },
  {
    type: 'function',
    function: {
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
    dangerous: false
  },
  {
    type: 'function',
    function: {
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
    dangerous: true  // Always requires confirmation
  },

  // ============================================================
  // CRM / LEADS
  // ============================================================
  {
    type: 'function',
    function: {
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
    }
  },
  {
    type: 'function',
    function: {
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
    }
  },
  {
    type: 'function',
    function: {
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
    }
  },
  {
    type: 'function',
    function: {
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
    },
    dangerous: false
  },

  // ============================================================
  // WHATSAPP DIALOGS
  // ============================================================
  {
    type: 'function',
    function: {
      name: 'getDialogs',
      description: 'Получить список WhatsApp диалогов с лидами',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['active', 'inactive', 'all'],
            description: 'Фильтр по активности диалога'
          },
          limit: {
            type: 'number',
            description: 'Максимальное количество диалогов (по умолчанию 20)'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'getDialogMessages',
      description: 'Получить сообщения конкретного WhatsApp диалога',
      parameters: {
        type: 'object',
        properties: {
          contact_phone: {
            type: 'string',
            description: 'Номер телефона контакта'
          },
          limit: {
            type: 'number',
            description: 'Количество последних сообщений (по умолчанию 50)'
          }
        },
        required: ['contact_phone']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'analyzeDialog',
      description: 'Запросить AI-анализ диалога: интересы клиента, возражения, готовность к покупке, рекомендации',
      parameters: {
        type: 'object',
        properties: {
          contact_phone: {
            type: 'string',
            description: 'Номер телефона контакта'
          }
        },
        required: ['contact_phone']
      }
    }
  },

  // ============================================================
  // CREATIVES
  // ============================================================
  {
    type: 'function',
    function: {
      name: 'getCreatives',
      description: 'Получить список креативов с метриками эффективности',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['active', 'paused', 'all'],
            description: 'Фильтр по статусу'
          },
          sort_by: {
            type: 'string',
            enum: ['performance', 'date', 'spend'],
            description: 'Сортировка'
          },
          limit: {
            type: 'number',
            description: 'Количество креативов (по умолчанию 20)'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'generateCreative',
      description: 'Запустить генерацию нового креатива',
      parameters: {
        type: 'object',
        properties: {
          direction_id: {
            type: 'string',
            description: 'ID направления/продукта'
          },
          creative_type: {
            type: 'string',
            enum: ['image', 'video', 'carousel'],
            description: 'Тип креатива'
          },
          style: {
            type: 'string',
            enum: ['modern_performance', 'live_ugc', 'visual_hook', 'premium_minimal'],
            description: 'Визуальный стиль креатива'
          }
        },
        required: ['direction_id', 'creative_type']
      }
    },
    dangerous: false
  }
];

/**
 * Get only the function definitions for OpenAI API
 * (strips out our custom 'dangerous' flag)
 */
export function getToolsForOpenAI() {
  return CHAT_TOOLS.map(tool => ({
    type: tool.type,
    function: tool.function
  }));
}

/**
 * Check if a tool is marked as dangerous (requires confirmation)
 */
export function isToolDangerous(toolName) {
  const tool = CHAT_TOOLS.find(t => t.function.name === toolName);
  return tool?.dangerous === true;
}

/**
 * Get tool by name
 */
export function getTool(toolName) {
  return CHAT_TOOLS.find(t => t.function.name === toolName);
}

export default {
  CHAT_TOOLS,
  getToolsForOpenAI,
  isToolDangerous,
  getTool
};
