/**
 * CreativeAgent Tools - Creative Management
 * 15 tools: 10 READ + 5 WRITE
 */

export const CREATIVE_TOOLS = [
  // ============================================================
  // READ TOOLS
  // ============================================================
  {
    name: 'getCreatives',
    description: 'Получить список креативов пользователя с метриками и скорами',
    parameters: {
      type: 'object',
      properties: {
        direction_id: {
          type: 'string',
          description: 'UUID направления для фильтрации (опционально)'
        },
        status: {
          type: 'string',
          enum: ['active', 'all'],
          description: 'Фильтр по статусу креативов'
        },
        sort_by: {
          type: 'string',
          enum: ['cpl', 'leads', 'spend', 'score', 'created'],
          description: 'Сортировка результатов'
        },
        limit: {
          type: 'number',
          description: 'Лимит результатов (по умолчанию 20)'
        }
      }
    }
  },
  {
    name: 'getCreativeDetails',
    description: 'Получить детальную информацию о креативе включая привязки к ads и directions',
    parameters: {
      type: 'object',
      properties: {
        creative_id: {
          type: 'string',
          description: 'UUID креатива из user_creatives'
        }
      },
      required: ['creative_id']
    }
  },
  {
    name: 'getCreativeMetrics',
    description: 'Получить детальные метрики креатива с разбивкой по дням, включая video retention',
    parameters: {
      type: 'object',
      properties: {
        creative_id: {
          type: 'string',
          description: 'UUID креатива'
        },
        period: {
          type: 'string',
          enum: ['7d', '14d', '30d', 'all'],
          description: 'Период для агрегации метрик'
        }
      },
      required: ['creative_id']
    }
  },
  {
    name: 'getCreativeAnalysis',
    description: 'Получить последний LLM-анализ креатива (score, verdict, recommendations)',
    parameters: {
      type: 'object',
      properties: {
        creative_id: {
          type: 'string',
          description: 'UUID креатива'
        }
      },
      required: ['creative_id']
    }
  },
  {
    name: 'getTopCreatives',
    description: 'Получить топ-N лучших креативов по выбранной метрике',
    parameters: {
      type: 'object',
      properties: {
        metric: {
          type: 'string',
          enum: ['cpl', 'leads', 'ctr', 'score'],
          description: 'Метрика для сортировки (cpl — меньше лучше, остальные — больше лучше)'
        },
        direction_id: {
          type: 'string',
          description: 'UUID направления для фильтрации (опционально)'
        },
        limit: {
          type: 'number',
          description: 'Количество креативов (по умолчанию 5)'
        }
      },
      required: ['metric']
    }
  },
  {
    name: 'getWorstCreatives',
    description: 'Получить креативы с худшими показателями (высоким CPL или низким score)',
    parameters: {
      type: 'object',
      properties: {
        threshold_cpl: {
          type: 'number',
          description: 'Порог CPL в долларах (креативы выше этого значения)'
        },
        direction_id: {
          type: 'string',
          description: 'UUID направления для фильтрации (опционально)'
        },
        limit: {
          type: 'number',
          description: 'Количество креативов (по умолчанию 5)'
        }
      }
    }
  },
  {
    name: 'compareCreatives',
    description: 'Сравнить метрики двух или более креативов за выбранный период',
    parameters: {
      type: 'object',
      properties: {
        creative_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Массив UUID креативов для сравнения (2-5 штук)'
        },
        period: {
          type: 'string',
          enum: ['7d', '14d', '30d'],
          description: 'Период сравнения'
        }
      },
      required: ['creative_ids']
    }
  },
  {
    name: 'getCreativeScores',
    description: 'Получить risk scores и predictions от scoring agent',
    parameters: {
      type: 'object',
      properties: {
        level: {
          type: 'string',
          enum: ['creative', 'adset'],
          description: 'Уровень скоринга'
        },
        risk_level: {
          type: 'string',
          enum: ['High', 'Medium', 'Low', 'all'],
          description: 'Фильтр по уровню риска'
        },
        limit: {
          type: 'number',
          description: 'Количество результатов (по умолчанию 20)'
        }
      }
    }
  },
  {
    name: 'getCreativeTests',
    description: 'Получить историю A/B тестов креатива с результатами',
    parameters: {
      type: 'object',
      properties: {
        creative_id: {
          type: 'string',
          description: 'UUID креатива'
        }
      },
      required: ['creative_id']
    }
  },
  {
    name: 'getCreativeTranscript',
    description: 'Получить транскрипцию видео креатива',
    parameters: {
      type: 'object',
      properties: {
        creative_id: {
          type: 'string',
          description: 'UUID креатива'
        }
      },
      required: ['creative_id']
    }
  },

  // ============================================================
  // WRITE TOOLS
  // ============================================================
  {
    name: 'triggerCreativeAnalysis',
    description: 'Запустить LLM-анализ креатива на основе текущих метрик',
    parameters: {
      type: 'object',
      properties: {
        creative_id: {
          type: 'string',
          description: 'UUID креатива для анализа'
        }
      },
      required: ['creative_id']
    }
  },
  {
    name: 'launchCreative',
    description: 'Запустить креатив в выбранное направление (создать новое объявление). ВНИМАНИЕ: это потратит бюджет.',
    parameters: {
      type: 'object',
      properties: {
        creative_id: {
          type: 'string',
          description: 'UUID креатива для запуска'
        },
        direction_id: {
          type: 'string',
          description: 'UUID направления для запуска'
        }
      },
      required: ['creative_id', 'direction_id']
    }
  },
  {
    name: 'pauseCreative',
    description: 'Поставить все объявления креатива на паузу',
    parameters: {
      type: 'object',
      properties: {
        creative_id: {
          type: 'string',
          description: 'UUID креатива'
        },
        reason: {
          type: 'string',
          description: 'Причина паузы (для логирования)'
        }
      },
      required: ['creative_id']
    }
  },
  {
    name: 'startCreativeTest',
    description: 'Запустить A/B тест креатива (1000 показов, ~$20 бюджет)',
    parameters: {
      type: 'object',
      properties: {
        creative_id: {
          type: 'string',
          description: 'UUID креатива для тестирования'
        },
        objective: {
          type: 'string',
          enum: ['whatsapp', 'instagram_traffic', 'site_leads'],
          description: 'Цель теста (по умолчанию whatsapp)'
        }
      },
      required: ['creative_id']
    }
  },
  {
    name: 'stopCreativeTest',
    description: 'Остановить текущий A/B тест креатива',
    parameters: {
      type: 'object',
      properties: {
        creative_id: {
          type: 'string',
          description: 'UUID креатива'
        }
      },
      required: ['creative_id']
    }
  }
];

// Write tools that require confirmation in 'plan' mode
export const CREATIVE_WRITE_TOOLS = [
  'triggerCreativeAnalysis',
  'launchCreative',
  'pauseCreative',
  'startCreativeTest',
  'stopCreativeTest'
];

// Dangerous tools that ALWAYS require confirmation
export const CREATIVE_DANGEROUS_TOOLS = ['launchCreative', 'startCreativeTest'];
