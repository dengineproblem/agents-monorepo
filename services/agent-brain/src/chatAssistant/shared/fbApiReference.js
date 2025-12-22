/**
 * Facebook Marketing API Reference for LLM Query Generation
 * Comprehensive documentation for customFbQuery tool
 *
 * Version: v20.0
 * Last updated: 2024-12
 */

// ============================================================
// INSIGHTS FIELDS - Available metrics
// ============================================================

export const INSIGHTS_FIELDS = {
  // Basic metrics
  basic: [
    'spend',           // Total spent (in account currency)
    'impressions',     // Number of times ads were shown
    'reach',           // Unique people who saw ads
    'frequency',       // Average times each person saw ad
    'clicks',          // All clicks (link + other)
    'unique_clicks',   // Unique people who clicked
  ],

  // Click metrics
  clicks: [
    'inline_link_clicks',       // Clicks on links in ad
    'inline_link_click_ctr',    // Link click-through rate
    'outbound_clicks',          // Clicks leading off Facebook
    'unique_outbound_clicks',   // Unique outbound clicks
    'unique_inline_link_clicks', // Unique link clicks
  ],

  // Cost metrics
  costs: [
    'cpc',             // Cost per click
    'cpm',             // Cost per 1000 impressions
    'cpp',             // Cost per 1000 people reached
    'ctr',             // Click-through rate (all clicks)
    'cost_per_inline_link_click', // Cost per link click
    'cost_per_unique_click',      // Cost per unique click
    'cost_per_unique_inline_link_click', // Cost per unique link click
  ],

  // Engagement metrics
  engagement: [
    'social_spend',           // Spend on social actions
    'inline_post_engagement', // Post engagement (likes, comments, shares)
    'unique_inline_link_click_ctr', // Unique link CTR
  ],

  // Video metrics
  video: [
    'video_30_sec_watched_actions',  // 30-sec video views
    'video_p25_watched_actions',     // 25% video views
    'video_p50_watched_actions',     // 50% video views
    'video_p75_watched_actions',     // 75% video views
    'video_p100_watched_actions',    // 100% video views
    'video_avg_time_watched_actions', // Average watch time
    'video_play_actions',            // Video plays
  ],

  // Conversion tracking (requires actions field)
  conversions: [
    'actions',                 // All conversion actions (IMPORTANT!)
    'action_values',           // Monetary values of actions
    'cost_per_action_type',    // Cost per each action type
    'conversions',             // Attributed conversions
    'conversion_values',       // Conversion monetary values
    'cost_per_conversion',     // Cost per conversion
  ],

  // Quality metrics
  quality: [
    'quality_ranking',              // Quality vs competitors
    'engagement_rate_ranking',      // Engagement vs competitors
    'conversion_rate_ranking',      // Conversion vs competitors
  ],
};

// ============================================================
// ACTION TYPES - Values in 'actions' array
// ============================================================

export const ACTION_TYPES = {
  // Messaging actions (WhatsApp, Messenger, Instagram Direct)
  messaging: [
    'onsite_conversion.messaging_first_reply',                    // First message from user
    'onsite_conversion.messaging_conversation_started_7d',        // Conversation started
    'onsite_conversion.total_messaging_connection',               // Total messaging connections
    'onsite_conversion.messaging_user_depth_2_message_send',      // User sent 2+ messages (QUALITY!)
    'onsite_conversion.messaging_user_depth_3_message_send',      // User sent 3+ messages
    'onsite_conversion.messaging_block',                          // User blocked
  ],

  // Lead form actions
  leadForms: [
    'lead',                          // Lead form submission
    'leadgen_grouped',               // Grouped lead gen
    'onsite_conversion.lead_grouped', // On-site lead grouped
  ],

  // Pixel/conversion actions
  pixel: [
    'offsite_conversion.fb_pixel_lead',           // Pixel lead event
    'offsite_conversion.fb_pixel_purchase',       // Pixel purchase
    'offsite_conversion.fb_pixel_add_to_cart',    // Add to cart
    'offsite_conversion.fb_pixel_initiate_checkout', // Checkout started
    'offsite_conversion.fb_pixel_complete_registration', // Registration
    'offsite_conversion.fb_pixel_view_content',   // Content view
    'offsite_conversion.fb_pixel_search',         // Search
    'offsite_conversion.fb_pixel_add_payment_info', // Payment info added
    'offsite_conversion.fb_pixel_custom',         // Custom conversions
  ],

  // App actions
  app: [
    'app_install',                   // App installs
    'app_use',                       // App uses
    'mobile_app_install',            // Mobile app install
    'app_custom_event',              // Custom app event
  ],

  // Engagement actions
  engagement: [
    'post_engagement',               // Post engagement total
    'page_engagement',               // Page engagement
    'post_reaction',                 // Post reactions
    'comment',                       // Comments
    'post',                          // Shares
    'link_click',                    // Link clicks
    'video_view',                    // Video views
    'photo_view',                    // Photo views
  ],

  // Page actions
  page: [
    'like',                          // Page likes
    'page_like',                     // Same as above
    'unlike',                        // Page unlikes
  ],
};

// ============================================================
// BREAKDOWNS - Segment data by dimensions
// ============================================================

export const BREAKDOWNS = {
  // Time breakdowns (mutually exclusive)
  time: [
    // Note: use time_increment parameter instead for daily/weekly breakdown
  ],

  // Delivery breakdowns
  delivery: [
    'age',                    // Age groups (18-24, 25-34, etc.)
    'gender',                 // male, female, unknown
    'country',                // ISO country codes
    'region',                 // Region/state
    'dma',                    // Designated Market Area (US)
    'impression_device',      // Device type: desktop, mobile, tablet
    'device_platform',        // android, ios, desktop, mobile_web
    'platform_position',      // feed, stories, reels, etc.
    'publisher_platform',     // facebook, instagram, audience_network, messenger
    'place_page_id',          // Page ID where ad was shown
  ],

  // Action breakdowns (for actions field)
  action: [
    'action_type',            // Type of action (REQUIRED for actions breakdown)
    'action_target_id',       // Target of action
    'action_destination',     // Where action led
    'action_device',          // Device where action occurred
    'action_reaction',        // Reaction type
    'action_video_type',      // Video type
  ],

  // Product breakdowns
  product: [
    'product_id',             // Product catalog ID
  ],

  // Common combinations
  commonCombinations: [
    ['age', 'gender'],                           // Demographics
    ['publisher_platform', 'platform_position'], // Placement details
    ['device_platform', 'impression_device'],    // Device details
    ['country', 'region'],                       // Geography
  ],

  // Restrictions
  restrictions: {
    maxBreakdowns: 2, // Maximum 2 breakdowns at once (except action_type)
    incompatible: [
      ['age', 'dma'],           // Can't combine
      ['region', 'dma'],        // Can't combine
    ],
  },
};

// ============================================================
// DATE PRESETS - Pre-defined date ranges
// ============================================================

export const DATE_PRESETS = [
  'today',
  'yesterday',
  'this_week_sun_today',    // This week (Sunday start)
  'this_week_mon_today',    // This week (Monday start)
  'last_3d',
  'last_7d',
  'last_14d',
  'last_28d',
  'last_30d',
  'last_90d',
  'this_month',
  'last_month',
  'this_quarter',
  'last_quarter',
  'this_year',
  'last_year',
  'lifetime',               // All time
  'maximum',                // Same as lifetime
];

// ============================================================
// TIME INCREMENTS - For daily/weekly data
// ============================================================

export const TIME_INCREMENTS = [
  1,      // Daily
  7,      // Weekly
  28,     // 4-weekly
  'monthly',
  'all_days', // Each day as separate row
];

// ============================================================
// LEVELS - Aggregation level
// ============================================================

export const LEVELS = [
  'account',    // Ad account level
  'campaign',   // Campaign level
  'adset',      // Ad set level
  'ad',         // Individual ad level
];

// ============================================================
// FILTERING - Filter results
// ============================================================

export const FILTERING = {
  operators: [
    'EQUAL',
    'NOT_EQUAL',
    'GREATER_THAN',
    'GREATER_THAN_OR_EQUAL',
    'LESS_THAN',
    'LESS_THAN_OR_EQUAL',
    'IN',
    'NOT_IN',
    'CONTAIN',
    'NOT_CONTAIN',
    'IN_RANGE',
    'NOT_IN_RANGE',
  ],

  // Common filter fields
  fields: [
    'campaign.id',
    'campaign.name',
    'campaign.effective_status',
    'adset.id',
    'adset.name',
    'adset.effective_status',
    'ad.id',
    'ad.name',
    'ad.effective_status',
    'impressions',
    'spend',
    'clicks',
  ],

  // Example filters
  examples: [
    { field: 'campaign.effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED'] },
    { field: 'spend', operator: 'GREATER_THAN', value: 100 },
    { field: 'impressions', operator: 'GREATER_THAN', value: 0 },
  ],
};

// ============================================================
// ATTRIBUTION SETTINGS
// ============================================================

export const ATTRIBUTION = {
  windows: [
    '1d_click',
    '7d_click',
    '28d_click',
    '1d_view',
    '7d_view',
    '28d_view',
    '1d_click_1d_view',
    '7d_click_1d_view',
    '28d_click_1d_view',
  ],

  actionReportTime: [
    'impression',   // When ad was shown
    'conversion',   // When conversion happened
  ],
};

// ============================================================
// FEW-SHOT EXAMPLES - Successful queries
// ============================================================

export const FEW_SHOT_EXAMPLES = [
  {
    userRequest: 'покажи расходы по возрастам за последнюю неделю',
    query: {
      endpoint: 'act_{{AD_ACCOUNT_ID}}/insights',
      fields: 'spend,impressions,clicks,ctr',
      params: {
        date_preset: 'last_7d',
        breakdowns: 'age',
        level: 'account'
      },
      explanation: 'Получаем insights с разбивкой по возрастным группам'
    }
  },
  {
    userRequest: 'сколько лидов из мессенджеров за месяц',
    query: {
      endpoint: 'act_{{AD_ACCOUNT_ID}}/insights',
      fields: 'spend,actions,cost_per_action_type',
      params: {
        date_preset: 'last_30d',
        action_breakdowns: 'action_type',
        level: 'account'
      },
      explanation: 'Получаем actions с разбивкой по типам, ищем onsite_conversion.messaging_first_reply'
    }
  },
  {
    userRequest: 'CPL по дням за последние 2 недели',
    query: {
      endpoint: 'act_{{AD_ACCOUNT_ID}}/insights',
      fields: 'spend,actions,cost_per_action_type,impressions',
      params: {
        date_preset: 'last_14d',
        time_increment: 1,
        action_breakdowns: 'action_type',
        level: 'account'
      },
      explanation: 'Ежедневные данные с actions для расчёта CPL'
    }
  },
  {
    userRequest: 'разбивка по устройствам и платформам',
    query: {
      endpoint: 'act_{{AD_ACCOUNT_ID}}/insights',
      fields: 'spend,impressions,clicks,ctr,actions',
      params: {
        date_preset: 'last_7d',
        breakdowns: 'device_platform,publisher_platform',
        level: 'account'
      },
      explanation: 'Разбивка по устройствам (ios/android/desktop) и платформам (facebook/instagram)'
    }
  },
  {
    userRequest: 'статистика по конкретной кампании',
    query: {
      endpoint: '{{CAMPAIGN_ID}}/insights',
      fields: 'campaign_name,spend,impressions,clicks,actions,cost_per_action_type',
      params: {
        date_preset: 'last_7d',
        action_breakdowns: 'action_type',
        level: 'campaign'
      },
      explanation: 'Insights для конкретной кампании с breakdown по типам действий'
    }
  },
  {
    userRequest: 'качественные лиды (2+ сообщения) по адсетам',
    query: {
      endpoint: 'act_{{AD_ACCOUNT_ID}}/insights',
      fields: 'adset_id,adset_name,spend,actions,cost_per_action_type',
      params: {
        date_preset: 'last_14d',
        level: 'adset',
        action_breakdowns: 'action_type'
      },
      explanation: 'По адсетам с actions, ищем onsite_conversion.messaging_user_depth_2_message_send'
    }
  },
  {
    userRequest: 'demographics - пол и возраст',
    query: {
      endpoint: 'act_{{AD_ACCOUNT_ID}}/insights',
      fields: 'spend,impressions,clicks,reach,actions',
      params: {
        date_preset: 'last_7d',
        breakdowns: 'age,gender',
        level: 'account'
      },
      explanation: 'Демографическая разбивка по полу и возрасту'
    }
  },
  {
    userRequest: 'конверсии с сайта (pixel events)',
    query: {
      endpoint: 'act_{{AD_ACCOUNT_ID}}/insights',
      fields: 'spend,actions,action_values,cost_per_action_type',
      params: {
        date_preset: 'last_30d',
        action_breakdowns: 'action_type',
        level: 'account'
      },
      explanation: 'Все actions включая pixel events (offsite_conversion.fb_pixel_*)'
    }
  },
  {
    userRequest: 'видео метрики - досмотры',
    query: {
      endpoint: 'act_{{AD_ACCOUNT_ID}}/insights',
      fields: 'spend,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions,video_avg_time_watched_actions',
      params: {
        date_preset: 'last_7d',
        level: 'account'
      },
      explanation: 'Метрики досмотра видео на разных процентах'
    }
  },
  {
    userRequest: 'сравнить Facebook и Instagram',
    query: {
      endpoint: 'act_{{AD_ACCOUNT_ID}}/insights',
      fields: 'spend,impressions,clicks,ctr,actions,cost_per_action_type',
      params: {
        date_preset: 'last_7d',
        breakdowns: 'publisher_platform',
        action_breakdowns: 'action_type',
        level: 'account'
      },
      explanation: 'Разбивка по publisher_platform даст facebook vs instagram'
    }
  },
  {
    userRequest: 'placement performance - где показывается реклама',
    query: {
      endpoint: 'act_{{AD_ACCOUNT_ID}}/insights',
      fields: 'spend,impressions,clicks,ctr,reach',
      params: {
        date_preset: 'last_7d',
        breakdowns: 'publisher_platform,platform_position',
        level: 'account'
      },
      explanation: 'Детальная разбивка по плейсментам (feed, stories, reels и т.д.)'
    }
  },
  {
    userRequest: 'активные кампании с расходом больше $100',
    query: {
      endpoint: 'act_{{AD_ACCOUNT_ID}}/insights',
      fields: 'campaign_id,campaign_name,spend,impressions,clicks,actions',
      params: {
        date_preset: 'last_7d',
        level: 'campaign',
        filtering: JSON.stringify([
          { field: 'campaign.effective_status', operator: 'IN', value: ['ACTIVE'] },
          { field: 'spend', operator: 'GREATER_THAN', value: 100 }
        ])
      },
      explanation: 'Фильтруем только активные кампании с расходом > $100'
    }
  },
];

// ============================================================
// SYSTEM PROMPT BUILDER
// ============================================================

export function buildCustomFbQuerySystemPrompt(adAccountId) {
  return `Ты эксперт по Facebook Marketing API v20.0.

Твоя задача: построить ТОЧНЫЙ запрос к FB Graph API на основе вопроса пользователя.

## ФОРМАТ ОТВЕТА (только JSON, без markdown):
{
  "endpoint": "<entity_id>/insights или act_<id>/insights",
  "fields": "spend,impressions,clicks,...",
  "params": {
    "date_preset": "last_7d",
    "breakdowns": "age,gender",
    "action_breakdowns": "action_type",
    "level": "account",
    "time_increment": 1,
    "filtering": "[{...}]"
  },
  "explanation": "Краткое объяснение запроса"
}

## ПРАВИЛА:

### Endpoints:
- Account insights: act_${adAccountId}/insights
- Campaign insights: {campaign_id}/insights
- AdSet insights: {adset_id}/insights
- Ad insights: {ad_id}/insights

### Обязательные fields для лидов/конверсий:
- ВСЕГДА добавляй "actions,cost_per_action_type" если нужны лиды, конверсии, сообщения
- БЕЗ actions ты НЕ получишь данные о лидах!

### Breakdowns:
- Максимум 2 breakdown одновременно
- action_breakdowns: "action_type" — для разбивки по типам действий
- Популярные: age, gender, device_platform, publisher_platform, platform_position, country

### Date presets:
today, yesterday, last_3d, last_7d, last_14d, last_28d, last_30d, last_90d,
this_month, last_month, this_quarter, last_quarter, lifetime

### Time increment (для дневных данных):
- time_increment: 1 — ежедневные данные
- time_increment: 7 — еженедельные

### Level:
- account — весь аккаунт
- campaign — по кампаниям
- adset — по адсетам
- ad — по объявлениям

### Типы лидов (в поле actions):
- onsite_conversion.messaging_first_reply — первое сообщение (мессенджер лид)
- onsite_conversion.messaging_user_depth_2_message_send — 2+ сообщения (КАЧЕСТВЕННЫЙ лид)
- onsite_conversion.total_messaging_connection — всего мессенджер подключений
- offsite_conversion.fb_pixel_lead — лид с пикселя (сайт)
- lead — лид форма

### Filtering (JSON строка):
[{"field": "spend", "operator": "GREATER_THAN", "value": 0}]

## ПРИМЕРЫ УСПЕШНЫХ ЗАПРОСОВ:

${FEW_SHOT_EXAMPLES.slice(0, 6).map((ex, i) => `
### Пример ${i + 1}:
Запрос: "${ex.userRequest}"
Ответ: ${JSON.stringify(ex.query, null, 2)}
`).join('\n')}

## ЧАСТЫЕ ОШИБКИ (избегай!):
1. НЕ забывай actions поле для любых конверсий/лидов
2. НЕ используй несуществующие поля
3. НЕ комбинируй несовместимые breakdowns
4. time_range должен быть JSON строкой: "{\\"since\\":\\"YYYY-MM-DD\\",\\"until\\":\\"YYYY-MM-DD\\"}"
5. filtering должен быть JSON строкой массива

Отвечай ТОЛЬКО валидным JSON без markdown блоков.`;
}

// ============================================================
// VALIDATION HELPERS
// ============================================================

const VALID_FIELDS = new Set([
  ...INSIGHTS_FIELDS.basic,
  ...INSIGHTS_FIELDS.clicks,
  ...INSIGHTS_FIELDS.costs,
  ...INSIGHTS_FIELDS.engagement,
  ...INSIGHTS_FIELDS.video,
  ...INSIGHTS_FIELDS.conversions,
  ...INSIGHTS_FIELDS.quality,
  'campaign_id', 'campaign_name',
  'adset_id', 'adset_name',
  'ad_id', 'ad_name',
  'objective', 'date_start', 'date_stop',
]);

const VALID_BREAKDOWNS = new Set([
  ...BREAKDOWNS.delivery,
  ...BREAKDOWNS.action,
]);

export function validateQueryPlan(plan) {
  const errors = [];
  const warnings = [];

  // Check endpoint
  if (!plan.endpoint) {
    errors.push('endpoint обязателен');
  } else if (!plan.endpoint.includes('/')) {
    errors.push('endpoint должен содержать путь (например: act_123/insights)');
  }

  // Check fields
  if (!plan.fields) {
    errors.push('fields обязателен');
  } else {
    const fields = plan.fields.split(',').map(f => f.trim());
    for (const field of fields) {
      if (!VALID_FIELDS.has(field) && !field.includes('_id') && !field.includes('_name')) {
        warnings.push(`Поле '${field}' может не существовать`);
      }
    }

    // Check if asking for conversions without actions
    if (plan.endpoint.includes('insights')) {
      const hasActions = fields.includes('actions') || fields.includes('cost_per_action_type');
      if (!hasActions && plan.params?.action_breakdowns) {
        errors.push('action_breakdowns требует поле actions');
      }
    }
  }

  // Check breakdowns
  if (plan.params?.breakdowns) {
    const breakdowns = plan.params.breakdowns.split(',').map(b => b.trim());
    if (breakdowns.length > 2) {
      errors.push('Максимум 2 breakdowns одновременно');
    }
    for (const bd of breakdowns) {
      if (!VALID_BREAKDOWNS.has(bd)) {
        warnings.push(`Breakdown '${bd}' может не существовать`);
      }
    }
  }

  // Check date params
  if (plan.params?.date_preset && plan.params?.time_range) {
    warnings.push('Указаны и date_preset и time_range — будет использован time_range');
  }

  // Check level
  if (plan.params?.level && !LEVELS.includes(plan.params.level)) {
    errors.push(`Недопустимый level: ${plan.params.level}. Допустимые: ${LEVELS.join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export default {
  INSIGHTS_FIELDS,
  ACTION_TYPES,
  BREAKDOWNS,
  DATE_PRESETS,
  TIME_INCREMENTS,
  LEVELS,
  FILTERING,
  ATTRIBUTION,
  FEW_SHOT_EXAMPLES,
  buildCustomFbQuerySystemPrompt,
  validateQueryPlan,
};
