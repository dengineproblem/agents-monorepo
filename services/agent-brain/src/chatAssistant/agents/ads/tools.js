/**
 * AdsAgent Tools - Facebook/Instagram Advertising
 * 29 tools: 14 READ + 15 WRITE
 */

export const ADS_TOOLS = [
  // ============================================================
  // READ TOOLS - Campaigns & AdSets
  // ============================================================
  {
    name: 'getCampaigns',
    description: `Получить список FB кампаний с метриками за период.

ВОЗВРАЩАЕТ:
- campaigns[]: id, name, status, objective, daily_budget ($/день), spend ($), leads, cpl ($), impressions, clicks
- total: общее количество кампаний
- period: указанный период

ИСПОЛЬЗУЙ когда нужно:
- Узнать общую картину по рекламным кампаниям
- Найти кампании с высоким/низким CPL
- Проверить статусы (ACTIVE/PAUSED) кампаний
- Получить расходы по всем кампаниям`,
    parameters: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          enum: ['today', 'yesterday', 'last_7d', 'last_30d'],
          description: 'Период для метрик. today/yesterday - за 1 день, last_7d/last_30d - за неделю/месяц'
        },
        status: {
          type: 'string',
          enum: ['ACTIVE', 'PAUSED', 'all'],
          description: 'Фильтр по статусу. all - все кампании включая остановленные'
        }
      },
      required: ['period']
    }
  },
  {
    name: 'getCampaignDetails',
    description: `Получить СТРУКТУРУ кампании: адсеты и объявления внутри.

ВОЗВРАЩАЕТ:
- campaign: id, name, status, objective, daily_budget, created_time
- campaign.adsets[]: id, name, status, daily_budget - все адсеты кампании
- campaign.ads[]: id, name, status, creative_id - все объявления кампании

ИСПОЛЬЗУЙ когда нужно:
- Увидеть иерархию: кампания → адсеты → объявления
- Узнать сколько адсетов/объявлений в кампании
- Найти конкретный адсет или объявление по имени
- НЕ возвращает метрики (spend, leads) - для метрик используй getCampaigns или getAdSets`,
    parameters: {
      type: 'object',
      properties: {
        campaign_id: {
          type: 'string',
          description: 'ID кампании в Facebook (числовой, например 120212345678901234)'
        }
      },
      required: ['campaign_id']
    }
  },
  {
    name: 'getAdSets',
    description: `Получить адсеты конкретной кампании С МЕТРИКАМИ.

ВОЗВРАЩАЕТ:
- adsets[]: id, name, status, daily_budget ($/день), spend ($), leads, cpl ($)

ИСПОЛЬЗУЙ когда нужно:
- Сравнить эффективность адсетов внутри одной кампании
- Найти адсеты с плохим CPL для оптимизации
- Узнать распределение бюджета между адсетами
- Нужен campaign_id - сначала используй getCampaigns чтобы его получить`,
    parameters: {
      type: 'object',
      properties: {
        campaign_id: {
          type: 'string',
          description: 'ID кампании в Facebook. Получи через getCampaigns'
        },
        period: {
          type: 'string',
          enum: ['today', 'yesterday', 'last_7d', 'last_30d'],
          description: 'Период для метрик (по умолчанию last_7d)'
        }
      },
      required: ['campaign_id']
    }
  },
  {
    name: 'getAds',
    description: `Получить статистику на уровне ОБЪЯВЛЕНИЙ (ads level) с метриками.

ВОЗВРАЩАЕТ:
- ads[]: id, name, status, spend ($), leads, cpl ($), impressions, clicks
- totals: общий spend, leads, cpl

ИСПОЛЬЗУЙ когда нужно:
- Статистика по объявлениям (ads level insights)
- Сравнить эффективность разных объявлений
- Найти объявления с плохим CPL
- Сгруппировать по названию объявления (ad_name)
- Получить spend и CPL по каждому объявлению

ПАРАМЕТРЫ:
- campaign_id (опционально) - ограничить объявлениями конкретной кампании
- period или date_from/date_to для указания периода`,
    parameters: {
      type: 'object',
      properties: {
        campaign_id: {
          type: 'string',
          description: 'ID кампании (опционально). Если не указан - все объявления аккаунта'
        },
        period: {
          type: 'string',
          enum: ['today', 'yesterday', 'last_7d', 'last_14d', 'last_30d', 'this_month', 'last_month'],
          description: 'Период для метрик (по умолчанию last_7d)'
        },
        date_from: {
          type: 'string',
          description: 'Начальная дата (YYYY-MM-DD). Альтернатива period'
        },
        date_to: {
          type: 'string',
          description: 'Конечная дата (YYYY-MM-DD). Альтернатива period'
        }
      },
      required: []
    }
  },
  {
    name: 'getSpendReport',
    description: `Отчёт по расходам с разбивкой по дням или кампаниям.

ВОЗВРАЩАЕТ:
- data[]: объекты с метриками (spend, leads, impressions, clicks)
  - При group_by='day': date, spend, leads, messagingLeads, siteLeads
  - При group_by='campaign': campaign_id, campaign_name, spend, leads
- totals: spend, leads, messagingLeads, siteLeads, cpl (агрегат)
- period: указанный период

ИСПОЛЬЗУЙ когда нужно:
- Узнать динамику расходов по дням (group_by='day')
- Сравнить расходы между кампаниями (group_by='campaign')
- Получить общий расход за период (totals.spend)
- Разделить лиды по типу: WhatsApp (messagingLeads) vs сайт (siteLeads)`,
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
          description: 'Группировка: day - по дням, campaign - по кампаниям (по умолчанию day)'
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
    description: `Получить список НАПРАВЛЕНИЙ (наших внутренних рекламных вертикалей).

ВАЖНО: 1 направление = 1 FB кампания. Направление - это наша бизнес-сущность.

ВОЗВРАЩАЕТ:
- directions[]: id (UUID), name, status (is_active), campaign_status (FB), budget_per_day ($), target_cpl ($), objective, campaign_id (FB), created_at
- total: количество направлений

ИСПОЛЬЗУЙ когда нужно:
- Узнать какие рекламные направления есть у пользователя
- Получить UUID направления для других tools (getDirectionCreatives, getDirectionMetrics)
- Проверить связь направления с FB кампанией (campaign_id)
- Узнать целевой CPL (target_cpl) для оценки эффективности`,
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['active', 'paused', 'all'],
          description: 'Фильтр: active - только активные, paused - на паузе, all - все'
        },
        period: {
          type: 'string',
          enum: ['today', 'yesterday', 'last_7d', 'last_30d'],
          description: 'Период для метрик (сейчас не используется, зарезервировано)'
        }
      }
    }
  },
  {
    name: 'getDirectionCreatives',
    description: `Получить КРЕАТИВЫ направления (изображения/видео для рекламы).

ВОЗВРАЩАЕТ:
- creatives[]: id (UUID), name, status (ready/pending/rejected/archived), media_type (video/image), risk_score, performance_tier, created_at
- total: количество креативов
- status_counts: { ready, pending, rejected, archived } - разбивка по статусам
- direction_id, direction_name: информация о направлении

ИСПОЛЬЗУЙ когда нужно:
- Узнать какие креативы есть для запуска
- Найти готовые креативы (status='ready') для createAdSet
- Проверить сколько креативов отклонено (rejected)
- Оценить "риск" креатива (risk_score) перед запуском`,
    parameters: {
      type: 'object',
      properties: {
        direction_id: {
          type: 'string',
          description: 'UUID направления. Получи через getDirections'
        }
      },
      required: ['direction_id']
    }
  },
  {
    name: 'getDirectionMetrics',
    description: `Получить ЕЖЕДНЕВНЫЕ метрики направления за период.

ВОЗВРАЩАЕТ:
- daily[]: date, spend, leads, impressions, clicks, cpl, ctr, cpm, active_creatives, active_ads, spend_delta (%), leads_delta (%), cpl_delta (%)
- totals: spend, leads, impressions, clicks, cpl, ctr - агрегированные за период
- source: 'rollup' (из предрасчитанной таблицы) или 'fallback_aggregation'

ИСПОЛЬЗУЙ когда нужно:
- Увидеть динамику метрик направления по дням
- Оценить тренды: растёт CPL или падает (delta поля)
- Проанализировать активность: сколько креативов/объявлений крутилось каждый день
- Это основной источник для анализа эффективности направления`,
    parameters: {
      type: 'object',
      properties: {
        direction_id: {
          type: 'string',
          description: 'UUID направления. Получи через getDirections'
        },
        period: {
          type: 'string',
          enum: ['7d', '14d', '30d'],
          description: 'Период: 7d - неделя, 14d - 2 недели, 30d - месяц'
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
    description: `ROI отчёт по креативам с РАЗДЕЛЕНИЕМ по платформам (Facebook и TikTok).

ВАЖНО — ВАЛЮТЫ:
- Facebook: spend в USD (конвертируется в KZT для общих итогов)
- TikTok: spend в KZT (тенге)
- Общие итоги (totalSpend_kzt) — всё приведено к KZT

ВОЗВРАЩАЕТ:
- platforms.facebook: { totalSpend (USD), campaigns[], avgCPL (USD), totalLeads }
- platforms.tiktok: { totalSpend (KZT), campaigns[], avgCPL (KZT), totalLeads }
- campaigns[].spend_currency — валюта расхода ("USD" или "KZT")
- campaigns[].cpl, cpl_currency — CPL в нативной валюте
- totalSpend_kzt — общий расход в KZT по всем платформам
- recommendations[] — автоматические рекомендации

ВАЖНО: ВСЕГДА передавай date_from/date_to или period. По умолчанию 7 дней.
Для "за неделю" используй date_from (понедельник) и date_to (воскресенье).`,
    parameters: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          enum: ['today', 'yesterday', 'last_3d', 'last_7d', 'last_14d', 'last_30d', 'last_90d', 'all'],
          description: 'Период (используй date_from/date_to для точных дат)'
        },
        date_from: {
          type: 'string',
          description: 'Начало периода YYYY-MM-DD (приоритет над period)'
        },
        date_to: {
          type: 'string',
          description: 'Конец периода YYYY-MM-DD'
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
      }
    }
  },
  {
    name: 'getROIComparison',
    description: `Сравнение ROI между сущностями (креативами или направлениями).

ВОЗВРАЩАЕТ:
- items[]: id, name, spend, revenue, roi (%), leads - отсортированные по ROI desc
- period: период сравнения
- compare_by: тип группировки

РЕЖИМЫ:
- compare_by='creative': ROI каждого креатива отдельно
- compare_by='direction': ROI агрегированный по направлениям

ИСПОЛЬЗУЙ когда нужно:
- Найти ТОП креативы по окупаемости для масштабирования
- Сравнить эффективность направлений между собой
- Определить куда перераспределить бюджет`,
    parameters: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          enum: ['all', 'last_7d', 'last_30d', 'last_90d'],
          description: 'Период сравнения. all - за всё время (лучше для ROI)'
        },
        compare_by: {
          type: 'string',
          enum: ['creative', 'direction'],
          description: 'Группировка: creative - по креативам, direction - по направлениям'
        },
        top_n: {
          type: 'number',
          description: 'Сколько позиций вернуть (по умолчанию 5)'
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
    description: `Проверить СТАТУС рекламного аккаунта Facebook.

ВОЗВРАЩАЕТ:
- status: ACTIVE, DISABLED, PAYMENT_REQUIRED, REVIEW, ERROR
- can_run_ads: boolean - может ли аккаунт запускать рекламу
- blocking_reasons[]: { code, message } - причины блокировки (ACCOUNT_DISABLED, BILLING, REVIEW, SPEND_LIMIT)
- limits: { spend_cap, amount_spent, currency } - лимиты расхода
- account: { id, name } - данные аккаунта

ИСПОЛЬЗУЙ как PRE-CHECK перед:
- Созданием адсетов/объявлений
- Изменением бюджетов
- Любыми write-операциями
- Диагностикой почему реклама не крутится`,
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'getDirectionInsights',
    description: `Аналитика направления С СРАВНЕНИЕМ vs предыдущий период.

ВОЗВРАЩАЕТ:
- current: spend, leads, impressions, clicks, cpl, ctr, cpm, cpc - текущий период
- previous: те же метрики за предыдущий период (если compare='previous_same')
- delta: spend_pct, leads_pct, cpl_pct, ctr_pct, cpm_pct - изменение в %
- analysis: { target_cpl, cpl_vs_target_pct, cpl_status (normal/high/low), is_small_sample }

ИСПОЛЬЗУЙ когда нужно:
- Понять тренд: стало лучше или хуже vs прошлый период
- Сравнить CPL с целевым показателем (target_cpl)
- Получить готовую аналитику с delta-показателями
- ОТЛИЧИЕ от getDirectionMetrics: здесь агрегат + сравнение, там - по дням`,
    parameters: {
      type: 'object',
      properties: {
        direction_id: {
          type: 'string',
          description: 'UUID направления. Получи через getDirections'
        },
        period: {
          type: 'string',
          enum: ['last_3d', 'last_7d', 'last_14d', 'last_30d'],
          description: 'Период для метрик (по умолчанию last_3d)'
        },
        compare: {
          type: 'string',
          enum: ['previous_same', 'previous_7d'],
          description: 'previous_same - сравнить с таким же периодом до текущего'
        }
      },
      required: ['direction_id']
    }
  },
  {
    name: 'getLeadsEngagementRate',
    description: `Качество лидов: сколько % отправили 2+ сообщения. Использует FB метрику onsite_conversion.messaging_user_depth_2_message_send.

ВОЗВРАЩАЕТ:
- leads_total: всего лидов за период (FB метрика messaging_first_reply)
- leads_with_2plus_msgs: лидов с 2+ сообщениями (FB метрика messaging_user_depth_2_message_send)
- engagement_rate: % вовлечённости

ИСПОЛЬЗУЙ для расчёта QCPL (качественный CPL):
- QCPL = spend / leads_with_2plus_msgs
- Высокий engagement = качественные лиды
- Это чисто FB запрос, WhatsApp интеграция НЕ нужна`,
    parameters: {
      type: 'object',
      properties: {
        direction_id: {
          type: 'string',
          description: 'UUID направления (опционально - без него по всему аккаунту)'
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
    description: `История действий Brain Agent (автоматической оптимизации).

ИСТОЧНИК: таблица brain_executions - логи всех запусков Brain Agent

ВОЗВРАЩАЕТ:
- actions[]: id, name, type (budget_change/pause/resume/launch), action_label, details: { old_budget, new_budget, reason, score, metrics }, executed_at, execution_id, execution_mode, status
- total: общее количество действий
- summary: { budget_changes, pauses, resumes, launches } - сводка по типам
- executions_count: количество запусков Brain Agent

ИСПОЛЬЗУЙ когда нужно:
- Узнать что делал Brain Agent автоматически
- Проверить какие бюджеты менялись и почему (reason)
- Найти паузы/возобновления адсетов
- Проанализировать эффективность автооптимизации`,
    parameters: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          enum: ['last_1d', 'last_3d', 'last_7d'],
          description: 'Preset период (игнорируется если указаны date_from/date_to)'
        },
        date_from: {
          type: 'string',
          description: 'Начало периода YYYY-MM-DD (приоритет над period)'
        },
        date_to: {
          type: 'string',
          description: 'Конец периода YYYY-MM-DD'
        },
        limit: {
          type: 'number',
          description: 'Макс. действий в ответе (по умолчанию 20)'
        },
        action_type: {
          type: 'string',
          enum: ['all', 'budget_change', 'pause', 'resume', 'launch'],
          description: 'Фильтр по типу: budget_change, pause, resume, launch или all'
        }
      }
    }
  },
  {
    name: 'triggerBrainOptimizationRun',
    description: `⚠️ DANGEROUS: Запустить Brain Agent для анализа и оптимизации СЕЙЧАС.

РЕЖИМЫ:
1. dry_run=true: показать что БУДЕТ оптимизировано (preview)
2. dry_run=false или не указан: INTERACTIVE MODE - генерирует proposals без автовыполнения

INTERACTIVE MODE ВОЗВРАЩАЕТ:
- mode: 'interactive'
- proposals[]: предложения Brain Agent
  - Каждый proposal: { type, entity_type, entity_id, entity_name, action, reason, metrics, current_value, proposed_value }
- context: данные использованные для анализа
- instructions: как выполнить предложенные действия

ПОСЛЕ ПОЛУЧЕНИЯ proposals:
- LLM анализирует предложения и объясняет пользователю
- Для выполнения использует: pauseAdSet, updateBudget, createAdSet и т.д.

НЕ ВЫПОЛНЯЕТ действия автоматически - только предлагает!`,
    parameters: {
      type: 'object',
      properties: {
        direction_id: {
          type: 'string',
          description: 'UUID направления (опционально - без него анализирует весь аккаунт)'
        },
        dry_run: {
          type: 'boolean',
          description: 'true = только preview, false/не указан = interactive mode с proposals'
        },
        reason: {
          type: 'string',
          description: 'Причина запуска для логов'
        }
      }
    }
  },

  // ============================================================
  // WRITE TOOLS - AdSets & Ads
  // ============================================================
  {
    name: 'pauseAdSet',
    description: `⚠️ DANGEROUS: Поставить адсет на паузу (status → PAUSED).

ВЫПОЛНЯЕТ: FB Graph API POST /{adset_id} с status=PAUSED

ВОЗВРАЩАЕТ:
- verification: { verified, before, after, warning }
  - verified: true если статус успешно изменён
  - before/after: статус до и после
  - warning: если статус не подтверждён

dry_run=true ВОЗВРАЩАЕТ:
- preview: { adset_id, current_status, action, new_status }
- warning: что будет сделано

ИСПОЛЬЗУЙ когда:
- Адсет показывает плохие метрики (высокий CPL)
- Нужно остановить трату бюджета
- Brain Agent рекомендовал паузу`,
    parameters: {
      type: 'object',
      properties: {
        adset_id: {
          type: 'string',
          description: 'FB ID адсета (числовой). Получи через getAdSets или getCampaignDetails'
        },
        reason: {
          type: 'string',
          description: 'Причина паузы для логов (рекомендуется указать)'
        },
        dry_run: {
          type: 'boolean',
          description: 'true = только показать что будет сделано'
        }
      },
      required: ['adset_id']
    }
  },
  {
    name: 'resumeAdSet',
    description: `Возобновить адсет (status → ACTIVE).

ВЫПОЛНЯЕТ: FB Graph API POST /{adset_id} с status=ACTIVE

ВОЗВРАЩАЕТ:
- verification: { verified, before, after, warning }
  - verified: true если статус успешно изменён на ACTIVE
  - before/after: статус до и после

ИСПОЛЬЗУЙ когда:
- Нужно включить ранее остановленный адсет
- Brain Agent рекомендовал возобновить
- После исправления проблем с креативами/таргетингом`,
    parameters: {
      type: 'object',
      properties: {
        adset_id: {
          type: 'string',
          description: 'FB ID адсета. Получи через getAdSets или getCampaignDetails'
        }
      },
      required: ['adset_id']
    }
  },
  {
    name: 'pauseAd',
    description: `⚠️ DANGEROUS: Поставить ОБЪЯВЛЕНИЕ (ad) на паузу.

ОТЛИЧИЕ от pauseAdSet:
- pauseAdSet останавливает весь адсет (все объявления внутри)
- pauseAd останавливает ОДНО конкретное объявление

ВЫПОЛНЯЕТ: FB Graph API POST /{ad_id} с status=PAUSED

ВОЗВРАЩАЕТ:
- verification: { verified, before, after, warning }

ИСПОЛЬЗУЙ когда:
- Нужно остановить конкретный креатив внутри адсета
- Объявление отклонено Facebook (rejected)
- Креатив показывает плохие метрики, но адсет в целом ОК`,
    parameters: {
      type: 'object',
      properties: {
        ad_id: {
          type: 'string',
          description: 'FB ID объявления. Получи через getCampaignDetails'
        },
        reason: {
          type: 'string',
          description: 'Причина паузы для логов'
        },
        dry_run: {
          type: 'boolean',
          description: 'true = только preview'
        }
      },
      required: ['ad_id']
    }
  },
  {
    name: 'resumeAd',
    description: `Возобновить объявление (status → ACTIVE).

ВЫПОЛНЯЕТ: FB Graph API POST /{ad_id} с status=ACTIVE

ВОЗВРАЩАЕТ:
- verification: { verified, before, after, warning }

ИСПОЛЬЗУЙ когда:
- Нужно включить ранее остановленное объявление
- После исправления проблем с креативом`,
    parameters: {
      type: 'object',
      properties: {
        ad_id: {
          type: 'string',
          description: 'FB ID объявления. Получи через getCampaignDetails'
        }
      },
      required: ['ad_id']
    }
  },
  {
    name: 'updateBudget',
    description: `⚠️ DANGEROUS: Изменить дневной бюджет АДСЕТА.

ВЫПОЛНЯЕТ: FB Graph API POST /{adset_id} с daily_budget=new_budget_cents

ОГРАНИЧЕНИЯ:
- Минимум: 300 центов ($3) — ниже будет применён фолбэк на минимум
- Изменение > 50% от текущего выдаёт warning

ВОЗВРАЩАЕТ:
- verification: { verified, before ($X.XX), after ($X.XX), warning }

dry_run=true ВОЗВРАЩАЕТ:
- preview: { adset_id, current_budget, new_budget, change_percent }
- warnings: если изменение > 50%

ИСПОЛЬЗУЙ когда:
- Brain Agent рекомендовал изменить бюджет
- Нужно масштабировать успешный адсет
- Нужно снизить расходы на неэффективный адсет`,
    parameters: {
      type: 'object',
      properties: {
        adset_id: {
          type: 'string',
          description: 'FB ID адсета'
        },
        new_budget_cents: {
          type: 'number',
          description: 'Новый бюджет в ЦЕНТАХ (1000 = $10, минимум 300 = $3)'
        },
        dry_run: {
          type: 'boolean',
          description: 'true = только preview с расчётом изменения'
        }
      },
      required: ['adset_id', 'new_budget_cents']
    }
  },
  {
    name: 'createAdSet',
    description: `⚠️ DANGEROUS: Создать НОВЫЙ адсет с объявлениями в кампании направления.

ЛОГИКА:
1. Берёт campaign_id из direction.fb_campaign_id
2. Берёт таргетинг из default_ad_settings (cities, gender, objective)
3. Создаёт адсет через FB Graph API
4. Для каждого креатива создаёт объявление внутри адсета
5. Сохраняет маппинг в ad_creative_mapping для трекинга лидов

ВОЗВРАЩАЕТ:
- adset_id: FB ID созданного адсета
- adset_name: название
- daily_budget: бюджет в $
- ads_created: количество объявлений
- ads[]: { ad_id, name, creative_id, creative_title }

dry_run=true ВОЗВРАЩАЕТ:
- preview: { campaign_id, direction_id, adset_name, daily_budget, targeting, creatives[] }

ТРЕБОВАНИЯ:
- У направления должен быть fb_campaign_id
- Должны быть настроены default_ad_settings
- Креативы должны быть status='ready'`,
    parameters: {
      type: 'object',
      properties: {
        direction_id: {
          type: 'string',
          description: 'UUID направления. Получи через getDirections'
        },
        creative_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'UUID креативов. Получи через getDirectionCreatives (только status=ready)'
        },
        daily_budget_cents: {
          type: 'number',
          description: 'Бюджет в центах (опционально - по умолчанию из настроек направления)'
        },
        adset_name: {
          type: 'string',
          description: 'Название (опционально - генерируется как "Direction - YYYY-MM-DD")'
        },
        dry_run: {
          type: 'boolean',
          description: 'true = только preview'
        }
      },
      required: ['direction_id', 'creative_ids']
    }
  },
  {
    name: 'createAd',
    description: `⚠️ DANGEROUS: Создать ОДНО объявление в существующем адсете.

ОТЛИЧИЕ от createAdSet:
- createAdSet создаёт адсет + все объявления сразу
- createAd добавляет объявление в УЖЕ существующий адсет

ЛОГИКА:
1. Проверяет креатив (status='ready')
2. Определяет objective адсета (через optimization_goal)
3. Выбирает нужный fb_creative_id (whatsapp/instagram_traffic/site_leads)
4. Создаёт объявление через FB Graph API
5. Сохраняет маппинг в ad_creative_mapping

ВОЗВРАЩАЕТ:
- ad_id: FB ID созданного объявления
- ad_name: название
- adset_id, adset_name: родительский адсет
- creative_id, creative_title: использованный креатив

ИСПОЛЬЗУЙ когда:
- Нужно добавить новый креатив в работающий адсет
- После создания нового креатива`,
    parameters: {
      type: 'object',
      properties: {
        adset_id: {
          type: 'string',
          description: 'FB ID адсета. Получи через getAdSets или getCampaignDetails'
        },
        creative_id: {
          type: 'string',
          description: 'UUID креатива. Получи через getDirectionCreatives (status=ready)'
        },
        ad_name: {
          type: 'string',
          description: 'Название (опционально - генерируется как "Ad - {creative_title}")'
        },
        dry_run: {
          type: 'boolean',
          description: 'true = только preview'
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
    description: `⚠️ DANGEROUS: Изменить бюджет НАПРАВЛЕНИЯ (и связанной FB кампании).

ВЫПОЛНЯЕТ:
1. Обновляет daily_budget_cents в таблице account_directions
2. Обновляет daily_budget в FB кампании через Graph API

ВОЗВРАЩАЕТ:
- direction: { id, name, old_budget, new_budget }
- campaign: { id, budget_updated }
- verification: { db_updated, fb_updated }

ИСПОЛЬЗУЙ когда:
- Нужно изменить бюджет на уровне направления (а не адсета)
- Это влияет на ВСЕ адсеты внутри кампании направления`,
    parameters: {
      type: 'object',
      properties: {
        direction_id: {
          type: 'string',
          description: 'UUID направления. Получи через getDirections'
        },
        new_budget: {
          type: 'number',
          description: 'Новый бюджет в ДОЛЛАРАХ (50 = $50/день)'
        },
        dry_run: {
          type: 'boolean',
          description: 'true = только preview'
        }
      },
      required: ['direction_id', 'new_budget']
    }
  },
  {
    name: 'updateDirectionTargetCPL',
    description: `Изменить целевой CPL направления (только в БД, не в FB).

ВЫПОЛНЯЕТ: UPDATE account_directions SET target_cpl_cents = X

ЗАЧЕМ target_cpl:
- Brain Agent использует для оценки эффективности адсетов
- getDirectionInsights сравнивает текущий CPL с целевым
- Влияет на рекомендации по оптимизации

ВОЗВРАЩАЕТ:
- direction: { id, name, old_target_cpl, new_target_cpl }

НЕ DANGEROUS: изменяет только настройку в БД, не влияет на FB`,
    parameters: {
      type: 'object',
      properties: {
        direction_id: {
          type: 'string',
          description: 'UUID направления. Получи через getDirections'
        },
        target_cpl: {
          type: 'number',
          description: 'Целевой CPL в ДОЛЛАРАХ (15.50 = $15.50 за лид)'
        }
      },
      required: ['direction_id', 'target_cpl']
    }
  },
  {
    name: 'pauseDirection',
    description: `⚠️ DANGEROUS: Поставить НАПРАВЛЕНИЕ на паузу (останавливает FB кампанию).

ВЫПОЛНЯЕТ:
1. UPDATE account_directions SET is_active = false
2. FB Graph API POST /{campaign_id} с status=PAUSED

ВАЖНО: Останавливает ВСЮ кампанию со ВСЕМИ адсетами внутри!

ВОЗВРАЩАЕТ:
- direction: { id, name, is_active: false }
- campaign: { id, status: 'PAUSED' }
- verification: { db_updated, fb_updated }

ИСПОЛЬЗУЙ когда:
- Нужно полностью остановить рекламу по направлению
- Проблемы с качеством лидов
- Бюджет исчерпан`,
    parameters: {
      type: 'object',
      properties: {
        direction_id: {
          type: 'string',
          description: 'UUID направления. Получи через getDirections'
        },
        reason: {
          type: 'string',
          description: 'Причина паузы для логов'
        },
        dry_run: {
          type: 'boolean',
          description: 'true = только preview'
        }
      },
      required: ['direction_id']
    }
  },
  {
    name: 'resumeDirection',
    description: `Возобновить НАПРАВЛЕНИЕ (включает FB кампанию).

ВЫПОЛНЯЕТ:
1. UPDATE account_directions SET is_active = true
2. FB Graph API POST /{campaign_id} с status=ACTIVE

ВОЗВРАЩАЕТ:
- direction: { id, name, is_active: true }
- campaign: { id, status: 'ACTIVE' }
- verification: { db_updated, fb_updated }

ИСПОЛЬЗУЙ когда:
- Нужно возобновить ранее остановленное направление
- После решения проблем`,
    parameters: {
      type: 'object',
      properties: {
        direction_id: {
          type: 'string',
          description: 'UUID направления. Получи через getDirections'
        }
      },
      required: ['direction_id']
    }
  },

  // ============================================================
  // INSIGHTS BREAKDOWN
  // ============================================================
  {
    name: 'getInsightsBreakdown',
    description: `Метрики с разбивкой (breakdown) по возрасту, полу, устройству, площадке, стране.

ВОЗВРАЩАЕТ:
- data[]: breakdown values + spend, impressions, clicks, cpm, cpc, ctr, reach, leads, cpl
- total_rows: количество строк

РАЗБИВКИ:
- age: 18-24, 25-34, 35-44, 45-54, 55-64, 65+
- gender: male, female, unknown
- age,gender: комбинация возраста и пола
- country: по странам (KZ, RU, US...)
- region: по регионам
- device_platform: mobile_app, desktop, mobile_web
- publisher_platform: facebook, instagram, audience_network
- platform_position: feed, story, reels, right_column

ИСПОЛЬЗУЙ когда:
- "покажи статистику по возрасту/полу/устройствам/площадкам"
- "какой CTR по площадкам?"
- "разбивка по странам за месяц"`,
    parameters: {
      type: 'object',
      properties: {
        breakdown: {
          type: 'string',
          enum: ['age', 'gender', 'age,gender', 'country', 'region', 'device_platform', 'publisher_platform', 'platform_position'],
          description: 'Тип разбивки'
        },
        entity_type: {
          type: 'string',
          enum: ['account', 'campaign', 'adset'],
          description: 'Уровень (по умолчанию account)'
        },
        entity_id: {
          type: 'string',
          description: 'ID кампании или адсета (для account не нужен)'
        },
        period: {
          type: 'string',
          enum: ['today', 'yesterday', 'last_7d', 'last_14d', 'last_30d'],
          description: 'Период'
        },
        date_from: { type: 'string', description: 'Начало YYYY-MM-DD' },
        date_to: { type: 'string', description: 'Конец YYYY-MM-DD' }
      },
      required: ['breakdown']
    }
  },

  // ============================================================
  // DIRECT FB ENTITY MODIFICATIONS
  // ============================================================
  {
    name: 'updateTargeting',
    description: `⚠️ DANGEROUS: Изменить таргетинг адсета.

ИЗМЕНЯЕТ: возраст, пол, гео (страны, города).
Для интересов и кастомных аудиторий используй customFbQuery.

ВОЗВРАЩАЕТ:
- before/after: таргетинг до и после изменения
- dry_run=true: показывает proposed_targeting без применения`,
    parameters: {
      type: 'object',
      properties: {
        adset_id: { type: 'string', description: 'Facebook AdSet ID' },
        age_min: { type: 'number', description: 'Мин. возраст (13-65)' },
        age_max: { type: 'number', description: 'Макс. возраст (13-65)' },
        genders: { type: 'array', items: { type: 'number' }, description: '0=все, 1=мужчины, 2=женщины' },
        countries: { type: 'array', items: { type: 'string' }, description: 'Коды стран (KZ, RU, US)' },
        cities: { type: 'array', items: { type: 'object' }, description: 'Города [{key, radius, distance_unit}]' },
        dry_run: { type: 'boolean', description: 'true = только preview' }
      },
      required: ['adset_id']
    }
  },
  {
    name: 'updateSchedule',
    description: `⚠️ DANGEROUS: Изменить расписание адсета (start_time, end_time).

ВОЗВРАЩАЕТ:
- before/after: расписание до и после
- dry_run=true: показывает proposed без применения`,
    parameters: {
      type: 'object',
      properties: {
        adset_id: { type: 'string', description: 'Facebook AdSet ID' },
        start_time: { type: 'string', description: 'Время начала ISO 8601 (2024-01-15T00:00:00+0500)' },
        end_time: { type: 'string', description: 'Время окончания ISO 8601 (null = без ограничения)' },
        dry_run: { type: 'boolean', description: 'true = только preview' }
      },
      required: ['adset_id']
    }
  },
  {
    name: 'updateBidStrategy',
    description: `⚠️ DANGEROUS: Изменить стратегию ставок адсета.

СТРАТЕГИИ:
- LOWEST_COST_WITHOUT_CAP: минимальная стоимость без ограничения
- LOWEST_COST_WITH_BID_CAP: минимальная стоимость с лимитом ставки
- COST_CAP: целевая стоимость результата

ВОЗВРАЩАЕТ:
- before/after: стратегия и сумма до и после`,
    parameters: {
      type: 'object',
      properties: {
        adset_id: { type: 'string', description: 'Facebook AdSet ID' },
        bid_strategy: { type: 'string', enum: ['LOWEST_COST_WITHOUT_CAP', 'LOWEST_COST_WITH_BID_CAP', 'COST_CAP'], description: 'Стратегия' },
        bid_amount: { type: 'number', description: 'Ставка в центах (для BID_CAP и COST_CAP)' },
        dry_run: { type: 'boolean', description: 'true = только preview' }
      },
      required: ['adset_id']
    }
  },
  {
    name: 'renameEntity',
    description: `⚠️ DANGEROUS: Переименовать кампанию, адсет или объявление.

ВОЗВРАЩАЕТ:
- old_name, new_name: имя до и после`,
    parameters: {
      type: 'object',
      properties: {
        entity_id: { type: 'string', description: 'Facebook ID (campaign, adset или ad)' },
        entity_type: { type: 'string', enum: ['campaign', 'adset', 'ad'], description: 'Тип сущности' },
        new_name: { type: 'string', description: 'Новое название' }
      },
      required: ['entity_id', 'entity_type', 'new_name']
    }
  },
  {
    name: 'updateCampaignBudget',
    description: `⚠️ DANGEROUS: Изменить бюджет кампании (для CBO кампаний).

ОТЛИЧИЕ от updateBudget: updateBudget меняет бюджет АДСЕТА, а этот tool — бюджет КАМПАНИИ.

ВОЗВРАЩАЕТ:
- before/after: daily_budget и lifetime_budget до и после`,
    parameters: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string', description: 'Facebook Campaign ID' },
        daily_budget: { type: 'number', description: 'Суточный бюджет в центах ($1 = 100)' },
        lifetime_budget: { type: 'number', description: 'Бюджет за всё время в центах' },
        dry_run: { type: 'boolean', description: 'true = только preview' }
      },
      required: ['campaign_id']
    }
  },

  // ============================================================
  // CUSTOM FB API QUERY (direct executor)
  // ============================================================
  {
    name: 'customFbQuery',
    description: `Выполнить произвольный запрос к Facebook Graph API.

Передай готовые endpoint, fields и params. Handler выполнит запрос напрямую через fbGraph().
Для account-level: используй 'account/insights' — 'account' заменится на act_xxx.

ВОЗВРАЩАЕТ:
- data: результат FB API

ИСПОЛЬЗУЙ когда ни один стандартный tool не подходит. Используй web search чтобы найти правильные FB API endpoint и fields.`,
    parameters: {
      type: 'object',
      properties: {
        endpoint: {
          type: 'string',
          description: 'FB API endpoint (account/insights, {campaign_id}/adsets, act_xxx/insights)'
        },
        method: {
          type: 'string',
          enum: ['GET', 'POST'],
          description: 'HTTP метод (по умолчанию GET)'
        },
        fields: {
          type: 'string',
          description: 'Поля через запятую (spend,impressions,clicks,ctr)'
        },
        params: {
          type: 'object',
          description: 'Дополнительные параметры (breakdowns, time_range, filtering и т.д.)'
        }
      },
      required: ['endpoint']
    }
  },

  // ============================================================
  // DIRECT FB CAMPAIGN MANAGEMENT
  // ============================================================
  {
    name: 'pauseCampaign',
    description: `Поставить FB кампанию на паузу НАПРЯМУЮ через FB Graph API.
НЕ требует direction — работает с любой кампанией в аккаунте.
Сначала вызови getCampaigns для получения campaign_id.`,
    parameters: {
      type: 'object',
      properties: {
        campaign_id: {
          type: 'string',
          description: 'Facebook Campaign ID (числовой). Получи через getCampaigns'
        },
        reason: {
          type: 'string',
          description: 'Причина паузы'
        }
      },
      required: ['campaign_id']
    }
  },
  {
    name: 'resumeCampaign',
    description: `Включить FB кампанию НАПРЯМУЮ через FB Graph API.
НЕ требует direction — работает с любой кампанией в аккаунте.
Сначала вызови getCampaigns для получения campaign_id.`,
    parameters: {
      type: 'object',
      properties: {
        campaign_id: {
          type: 'string',
          description: 'Facebook Campaign ID (числовой). Получи через getCampaigns'
        }
      },
      required: ['campaign_id']
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
  'pauseCampaign',
  'resumeCampaign',
  'triggerBrainOptimizationRun',
  'updateTargeting',
  'updateSchedule',
  'updateBidStrategy',
  'renameEntity',
  'updateCampaignBudget',
  'customFbQuery',
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
  'triggerBrainOptimizationRun',
  'updateTargeting',
  'updateSchedule',
  'updateBidStrategy',
  'renameEntity',
  'updateCampaignBudget',
  'customFbQuery',
];
