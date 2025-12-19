/**
 * CRMAgent Tools - Leads, Funnel & amoCRM
 * 12 tools: 10 READ + 2 WRITE
 */

export const CRM_TOOLS = [
  // ============================================================
  // READ TOOLS
  // ============================================================
  {
    name: 'getLeads',
    description: 'Получить список лидов с фильтрацией. Возвращает: name, phone, score (0-100), interest_level (hot/warm/cold), funnel_stage, creative_id, direction_id, created_at. Используй для поиска конкретных лидов или анализа базы.',
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
    description: 'Полная карточка лида: контакты (name, phone, email), текущий этап воронки, score, temperature, источник (creative, direction), история WhatsApp диалога, AI-анализ переписки. Используй для глубокого анализа конкретного лида.',
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
    description: 'Статистика воронки продаж за период: количество лидов на каждом этапе, конверсии между этапами (%), распределение по температуре. Используй для оценки эффективности воронки.',
    parameters: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          enum: ['today', 'yesterday', 'last_3d', 'last_7d', 'last_14d', 'last_30d', 'last_90d', 'last_6m', 'last_12m', 'all'],
          description: 'Период для статистики'
        }
      },
      required: ['period']
    }
  },
  {
    name: 'getRevenueStats',
    description: 'Статистика выручки: total_revenue, sales_count, avg_check, revenue_by_direction. Фильтрация по периоду и направлению. Используй для финансового анализа.',
    parameters: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          enum: ['last_3d', 'last_7d', 'last_14d', 'last_30d', 'last_90d', 'last_6m', 'last_12m', 'all'],
          description: 'Период для анализа выручки'
        },
        direction_id: {
          type: 'string',
          description: 'UUID направления для фильтрации (опционально)'
        }
      },
      required: ['period']
    }
  },
  {
    name: 'getSalesQuality',
    description: 'KPI ladder для оценки качества лидов: total_leads, qualified_leads, sales_count, revenue, avg_check, qualification_rate, CPL ladder (cost per qualified lead). Ключевой инструмент для анализа ROI рекламы.',
    parameters: {
      type: 'object',
      properties: {
        direction_id: {
          type: 'string',
          description: 'UUID направления для фильтрации (опционально)'
        },
        period: {
          type: 'string',
          enum: ['last_3d', 'last_7d', 'last_14d', 'last_30d', 'last_90d', 'last_6m', 'last_12m', 'all'],
          description: 'Период для анализа (по умолчанию last_7d)'
        }
      }
    }
  },

  // ============================================================
  // WRITE TOOLS
  // ============================================================
  {
    name: 'updateLeadStage',
    description: 'Изменить этап воронки для лида. Обновляет funnel_stage в БД, записывает в историю. Опционально указать reason для аудита. НЕ синхронизирует с amoCRM автоматически.',
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

  // ============================================================
  // AMOCRM TOOLS
  // ============================================================
  {
    name: 'getAmoCRMStatus',
    description: 'Проверить подключение amoCRM: connected (bool), subdomain, tokenValid (bool), expiresAt. ОБЯЗАТЕЛЬНО вызови перед другими amoCRM tools. Если connected=false — интеграция не настроена.',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'getAmoCRMPipelines',
    description: 'Воронки и этапы из amoCRM с маппингом квалификации. Возвращает: pipelines[{id, name, stages[{id, name, sort, is_qualified}]}]. Используй для понимания структуры CRM клиента.',
    parameters: {
      type: 'object',
      properties: {
        include_qualified_only: {
          type: 'boolean',
          description: 'Показать только этапы, отмеченные как квалификационные'
        }
      }
    }
  },
  {
    name: 'syncAmoCRMLeads',
    description: '⚠️ DANGEROUS: Синхронизировать статусы лидов из amoCRM. Обновляет: current_status, is_qualified, reached_key_stage_1/2/3. Может занять 30+ секунд. ВСЕГДА требует подтверждения пользователя. Вернёт: total, updated, errors, summary.',
    parameters: {
      type: 'object',
      properties: {
        direction_id: {
          type: 'string',
          description: 'UUID направления для синхронизации (опционально, иначе все)'
        },
        limit: {
          type: 'number',
          description: 'Максимум лидов для синхронизации (по умолчанию 100)'
        }
      }
    }
  },
  {
    name: 'getAmoCRMKeyStageStats',
    description: 'Конверсия в ключевые этапы направления: key_stage_1/2/3 с названиями, total_leads, reached_count, conversion_rate (%). Показывает глубину прохождения воронки. Требует direction_id.',
    parameters: {
      type: 'object',
      properties: {
        direction_id: {
          type: 'string',
          description: 'UUID направления'
        },
        period: {
          type: 'string',
          enum: ['last_7d', 'last_14d', 'last_30d', 'last_90d', 'last_6m', 'last_12m', 'all'],
          description: 'Период для анализа (по умолчанию last_7d)'
        }
      },
      required: ['direction_id']
    }
  },
  {
    name: 'getAmoCRMQualificationStats',
    description: 'Статистика квалификации по креативам: creative_id, name, total_leads, qualified_count, qualification_rate (%). Включает recommendations для масштабирования/оптимизации. Ключевой для оценки качества трафика.',
    parameters: {
      type: 'object',
      properties: {
        direction_id: {
          type: 'string',
          description: 'UUID направления (опционально)'
        },
        period: {
          type: 'string',
          enum: ['last_7d', 'last_14d', 'last_30d', 'last_90d', 'last_6m', 'last_12m', 'all'],
          description: 'Период для анализа (по умолчанию last_7d)'
        }
      }
    }
  },
  {
    name: 'getAmoCRMLeadHistory',
    description: 'Полная история переходов лида в amoCRM: все смены статусов с датами, от какого этапа к какому перешёл, время на каждом этапе. Используй для анализа пути клиента.',
    parameters: {
      type: 'object',
      properties: {
        lead_id: {
          type: 'string',
          description: 'ID лида (внутренний UUID)'
        }
      },
      required: ['lead_id']
    }
  }
];

// Write tools that may require confirmation
export const CRM_WRITE_TOOLS = ['updateLeadStage', 'syncAmoCRMLeads'];

// Dangerous tools that ALWAYS require confirmation
export const CRM_DANGEROUS_TOOLS = ['syncAmoCRMLeads'];

// amoCRM tools list for preflight check
export const AMOCRM_TOOLS = [
  'getAmoCRMStatus',
  'getAmoCRMPipelines',
  'syncAmoCRMLeads',
  'getAmoCRMKeyStageStats',
  'getAmoCRMQualificationStats',
  'getAmoCRMLeadHistory'
];
