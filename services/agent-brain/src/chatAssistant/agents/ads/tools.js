/**
 * AdsAgent Tools - Facebook/Instagram Advertising
 * 23 tools: 13 READ + 10 WRITE
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
    name: 'getDirectionCreatives',
    description: 'Получить список креативов направления с их статусами и метриками',
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
  // READ TOOLS - ROI Analytics
  // ============================================================
  {
    name: 'getROIReport',
    description: 'Получить отчёт по ROI (окупаемости) креативов за период. Показывает расходы, выручку, ROI%, лиды и конверсии',
    parameters: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          enum: ['last_7d', 'last_30d', 'last_90d', 'all'],
          description: 'Период для анализа ROI'
        },
        direction_id: {
          type: 'string',
          description: 'UUID направления для фильтрации (опционально)'
        },
        media_type: {
          type: 'string',
          enum: ['video', 'image', 'carousel'],
          description: 'Тип креатива для фильтрации (опционально)'
        }
      },
      required: ['period']
    }
  },
  {
    name: 'getROIComparison',
    description: 'Сравнить ROI между креативами или направлениями. Показывает топ N по окупаемости. По умолчанию за всё время.',
    parameters: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          enum: ['all', 'last_7d', 'last_30d', 'last_90d'],
          description: 'Период для сравнения (по умолчанию all - за всё время)'
        },
        compare_by: {
          type: 'string',
          enum: ['creative', 'direction'],
          description: 'Группировка: по креативам или по направлениям'
        },
        top_n: {
          type: 'number',
          description: 'Количество топ позиций для вывода (по умолчанию 5)'
        }
      },
      required: ['compare_by']
    }
  },

  // ============================================================
  // READ TOOLS - Pre-checks & Insights (Hybrid MCP)
  // ============================================================
  {
    name: 'getAdAccountStatus',
    description: 'Проверить статус рекламного аккаунта: может ли крутить рекламу, причины блокировки, лимиты. Используй как pre-check перед анализом.',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'getDirectionInsights',
    description: 'Получить метрики направления с сравнением vs предыдущий период. Включает CPL, CTR, CPM, CPC и delta.',
    parameters: {
      type: 'object',
      properties: {
        direction_id: {
          type: 'string',
          description: 'UUID направления'
        },
        period: {
          type: 'string',
          enum: ['last_3d', 'last_7d', 'last_14d', 'last_30d'],
          description: 'Период для метрик (по умолчанию last_3d)'
        },
        compare: {
          type: 'string',
          enum: ['previous_same', 'previous_7d'],
          description: 'Сравнить с предыдущим периодом той же длины'
        }
      },
      required: ['direction_id']
    }
  },
  {
    name: 'getLeadsEngagementRate',
    description: 'Получить показатель вовлечённости лидов (2+ сообщения в WhatsApp). Высокий engagement = качественные лиды. Используй для оценки качества трафика из WhatsApp.',
    parameters: {
      type: 'object',
      properties: {
        direction_id: {
          type: 'string',
          description: 'UUID направления для фильтрации (опционально)'
        },
        period: {
          type: 'string',
          enum: ['last_3d', 'last_7d', 'last_14d', 'last_30d'],
          description: 'Период для анализа'
        }
      },
      required: ['period']
    }
  },

  // ============================================================
  // BRAIN AGENT TOOLS
  // ============================================================
  {
    name: 'getAgentBrainActions',
    description: 'Получить историю действий Brain Agent: изменения бюджетов, паузы адсетов, запуски креативов. Используй для анализа автоматической оптимизации.',
    parameters: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          enum: ['last_1d', 'last_3d', 'last_7d'],
          description: 'Предустановленный период (если не указаны date_from/date_to)'
        },
        date_from: {
          type: 'string',
          description: 'Начало периода в формате YYYY-MM-DD'
        },
        date_to: {
          type: 'string',
          description: 'Конец периода в формате YYYY-MM-DD'
        },
        limit: {
          type: 'number',
          description: 'Максимум действий для возврата (по умолчанию 20)'
        },
        action_type: {
          type: 'string',
          enum: ['all', 'budget_change', 'pause', 'resume', 'launch'],
          description: 'Фильтр по типу действия'
        }
      }
    }
  },
  {
    name: 'triggerBrainOptimizationRun',
    description: '⚠️ DANGEROUS: Запустить принудительный цикл Brain Agent оптимизации ПРЯМО СЕЙЧАС. Агент может изменить бюджеты, остановить или запустить адсеты.',
    parameters: {
      type: 'object',
      properties: {
        direction_id: {
          type: 'string',
          description: 'UUID направления для оптимизации (опционально — если не указано, оптимизирует весь аккаунт)'
        },
        dry_run: {
          type: 'boolean',
          description: 'Preview mode — показать что будет сделано без выполнения'
        },
        reason: {
          type: 'string',
          description: 'Причина запуска (для логирования)'
        }
      }
    }
  },

  // ============================================================
  // WRITE TOOLS - AdSets & Ads
  // ============================================================
  {
    name: 'pauseAdSet',
    description: '⚠️ DANGEROUS: Поставить адсет на паузу',
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
        },
        dry_run: {
          type: 'boolean',
          description: 'Preview mode — показать что будет изменено без выполнения'
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
    name: 'pauseAd',
    description: '⚠️ DANGEROUS: Поставить конкретное объявление на паузу',
    parameters: {
      type: 'object',
      properties: {
        ad_id: {
          type: 'string',
          description: 'ID объявления в Facebook'
        },
        reason: {
          type: 'string',
          description: 'Причина паузы'
        },
        dry_run: {
          type: 'boolean',
          description: 'Preview mode — показать что будет изменено без выполнения'
        }
      },
      required: ['ad_id']
    }
  },
  {
    name: 'resumeAd',
    description: 'Возобновить приостановленное объявление',
    parameters: {
      type: 'object',
      properties: {
        ad_id: {
          type: 'string',
          description: 'ID объявления для возобновления'
        }
      },
      required: ['ad_id']
    }
  },
  {
    name: 'updateBudget',
    description: '⚠️ DANGEROUS: Изменить дневной бюджет адсета. Изменение бюджета > 50% требует подтверждения.',
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
        },
        dry_run: {
          type: 'boolean',
          description: 'Preview mode — показать что будет изменено без выполнения'
        }
      },
      required: ['adset_id', 'new_budget_cents']
    }
  },
  {
    name: 'createAdSet',
    description: '⚠️ DANGEROUS: Создать новый адсет в кампании направления. Использует настройки таргетинга из direction settings. Автоматически создаёт объявления для указанных креативов.',
    parameters: {
      type: 'object',
      properties: {
        direction_id: {
          type: 'string',
          description: 'UUID направления (для получения campaign_id и настроек таргетинга)'
        },
        creative_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Массив UUID креативов для запуска в адсете'
        },
        daily_budget_cents: {
          type: 'number',
          description: 'Дневной бюджет адсета в центах (если не указан — используется default из настроек направления)'
        },
        adset_name: {
          type: 'string',
          description: 'Название адсета (опционально — генерируется автоматически)'
        },
        dry_run: {
          type: 'boolean',
          description: 'Preview mode — показать что будет создано без выполнения'
        }
      },
      required: ['direction_id', 'creative_ids']
    }
  },
  {
    name: 'createAd',
    description: '⚠️ DANGEROUS: Создать объявление в существующем адсете с указанным креативом.',
    parameters: {
      type: 'object',
      properties: {
        adset_id: {
          type: 'string',
          description: 'ID адсета в Facebook'
        },
        creative_id: {
          type: 'string',
          description: 'UUID креатива из таблицы creatives'
        },
        ad_name: {
          type: 'string',
          description: 'Название объявления (опционально — генерируется автоматически)'
        },
        dry_run: {
          type: 'boolean',
          description: 'Preview mode — показать что будет создано без выполнения'
        }
      },
      required: ['adset_id', 'creative_id']
    }
  },

  // ============================================================
  // WRITE TOOLS - Directions (1 направление = 1 FB кампания)
  // ============================================================
  {
    name: 'updateDirectionBudget',
    description: '⚠️ DANGEROUS: Изменить суточный бюджет направления.',
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
        },
        dry_run: {
          type: 'boolean',
          description: 'Preview mode — показать что будет изменено без выполнения'
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
    description: '⚠️ DANGEROUS: Поставить направление на паузу. Паузит привязанную FB кампанию и все адсеты.',
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
        },
        dry_run: {
          type: 'boolean',
          description: 'Preview mode — показать что будет изменено без выполнения'
        }
      },
      required: ['direction_id']
    }
  },
  {
    name: 'resumeDirection',
    description: 'Возобновить направление. Включает привязанную FB кампанию.',
    parameters: {
      type: 'object',
      properties: {
        direction_id: {
          type: 'string',
          description: 'UUID направления'
        }
      },
      required: ['direction_id']
    }
  },

  // ============================================================
  // CUSTOM FB API QUERY (LLM-powered)
  // ============================================================
  {
    name: 'customFbQuery',
    description: 'Выполнить кастомный запрос к Facebook API для нестандартных метрик. LLM строит API запрос, отправляет в FB, при ошибке пробует исправить до 3 раз.',
    parameters: {
      type: 'object',
      properties: {
        user_request: {
          type: 'string',
          description: 'Описание того, что хочет узнать пользователь (на естественном языке)'
        },
        entity_type: {
          type: 'string',
          enum: ['account', 'campaign', 'adset', 'ad'],
          description: 'Уровень сущности для запроса (по умолчанию account)'
        },
        entity_id: {
          type: 'string',
          description: 'ID сущности (campaign_id, adset_id, ad_id). Если не указан — используется ad_account'
        },
        period: {
          type: 'string',
          description: 'Период для метрик (today, yesterday, last_7d, last_30d или конкретная дата)'
        }
      },
      required: ['user_request']
    }
  }
];

// Write tools that require confirmation in 'plan' mode
export const ADS_WRITE_TOOLS = [
  'pauseAdSet',
  'resumeAdSet',
  'pauseAd',
  'resumeAd',
  'updateBudget',
  'createAdSet',
  'createAd',
  'updateDirectionBudget',
  'updateDirectionTargetCPL',
  'pauseDirection',
  'resumeDirection',
  'triggerBrainOptimizationRun'
];

// Dangerous tools that ALWAYS require confirmation
export const ADS_DANGEROUS_TOOLS = [
  'updateBudget',
  'createAdSet',
  'createAd',
  'updateDirectionBudget',
  'pauseDirection',
  'pauseAdSet',
  'pauseAd',
  'triggerBrainOptimizationRun'
];
