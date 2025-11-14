import { OpenAI } from 'openai';
import { createLogger } from './logger.js';

const log = createLogger({ module: 'promptGenerator' });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!
});

// Meta-prompt for generating personalized prompt context
const META_PROMPT = `Ты - эксперт по созданию промптов для AI-анализа WhatsApp переписок.

ЗАДАЧА: На основе брифа клиента создай ПЕРСОНАЛИЗИРОВАННЫЙ КОНТЕКСТ для промпта анализа.

БРИФ КЛИЕНТА:
- Сфера деятельности: <<<INDUSTRY>>>
- Описание бизнеса: <<<DESCRIPTION>>>
- Целевая аудитория: <<<TARGET_AUDIENCE>>>
- Этапы воронки: <<<FUNNEL_STAGES>>>
- Ключевые этапы: <<<KEY_STAGES>>>
- Критерии переходов: <<<STAGE_CRITERIA>>>
- Идеальный клиент: <<<IDEAL_CLIENT>>>
- Кто НЕ подходит: <<<NON_TARGET>>>
- Боли и запросы: <<<CLIENT_PAINS>>>
- Интерес и возражения: <<<INTEREST_OBJECTIONS>>>

СОЗДАЙ JSON с персонализированным контекстом:

{
  "business_context": "Краткое описание специфики бизнеса клиента (2-3 предложения)",
  "target_profile": "Описание идеального лида для этого бизнеса",
  "funnel_specifics": "Особенности воронки продаж в этой нише",
  "funnel_stages": ["этап1", "этап2", "этап3", ...],
  "funnel_stages_details": [
    {"name": "этап1", "is_key": false, "score": 25},
    {"name": "этап2", "is_key": true, "score": 50},
    ...
  ],
  "funnel_scoring": {
    "этап1": 25,
    "этап2": 50,
    "этап3": 75,
    "этап4": 100
  },
  "key_funnel_stages": ["этап2", "этап3"],
  "stage_transition_criteria": {
    "этап1_к_этап2": "конкретный критерий",
    "этап2_к_этап3": "конкретный критерий"
  },
  "ideal_client_profile": "описание идеального клиента из брифа",
  "non_target_profile": "кто не подходит",
  "client_pains": ["боль1", "боль2", ...],
  "positive_signals": ["фраза интереса 1", "фраза 2", ...],
  "negative_signals": ["возражение1", "возражение2", ...],
  "scoring_modifiers": {
    "bonus_keywords": ["слово1", "слово2"],
    "penalty_keywords": ["слово1", "слово2"]
  },
  "qualification_hints": "Что важно спросить для квалификации в этой нише"
}

ПРАВИЛА:
1. Контекст должен быть конкретным и релевантным нише
2. Используй ВСЕ предоставленные данные из брифа
3. Парси этапы воронки из <<<FUNNEL_STAGES>>> (разделитель: "→" или новая строка)
4. Ключевые этапы берутся из <<<KEY_STAGES>>> - это этапы где лидов НЕ нужно беспокоить рассылками
5. Парси критерии переходов из <<<STAGE_CRITERIA>>>
6. Парси идеального клиента, non-target, боли из соответствующих полей
7. Парси фразы интереса и возражения из <<<INTEREST_OBJECTIONS>>> (разделяй по ключевым словам "Интерес:", "Возражения:")

АВТОМАТИЧЕСКИЙ РАСЧЕТ СКОРИНГА:
Для funnel_scoring используй формулу: score = Math.round((100 / N) * номер_этапа)
Где N = количество этапов воронки

В funnel_stages_details указывай is_key: true для этапов из <<<KEY_STAGES>>>

Примеры:
- 3 этапа: {"этап1": 33, "этап2": 67, "этап3": 100}
- 4 этапа: {"этап1": 25, "этап2": 50, "этап3": 75, "этап4": 100}
- 5 этапов: {"этап1": 20, "этап2": 40, "этап3": 60, "этап4": 80, "этап5": 100}

8. Фразы-сигналы должны быть типичными для этого бизнеса
9. Учитывай специфику продаж в указанной сфере
10. Modifiers должны отражать ценность клиента для этого бизнеса
11. Все на русском языке

Верни ТОЛЬКО JSON, без дополнительного текста.`;

export interface FunnelStage {
  id: string;
  name: string;
  order: number;
}

export interface BusinessProfile {
  business_industry: string;
  business_description: string;
  target_audience: string;
  funnel_stages_description?: string;
  funnel_stages_structured?: FunnelStage[];
  key_funnel_stages?: string[];
  stage_transition_criteria?: string;
  ideal_client_profile?: string;
  non_target_profile?: string;
  client_pains?: string;
  interest_and_objections?: string;
}

export interface FunnelStageDetail {
  name: string;
  is_key: boolean;
  score: number;
}

export interface PersonalizedContext {
  business_context: string;
  target_profile: string;
  funnel_specifics: string;
  funnel_stages?: string[];
  funnel_stages_details?: FunnelStageDetail[];
  funnel_scoring?: Record<string, number>;
  key_funnel_stages?: string[];
  stage_transition_criteria?: Record<string, string>;
  ideal_client_profile?: string;
  non_target_profile?: string;
  client_pains?: string[];
  positive_signals: string[];
  negative_signals: string[];
  scoring_modifiers: {
    bonus_keywords: string[];
    penalty_keywords: string[];
  };
  qualification_hints: string;
}

/**
 * Generate personalized context for analysis prompt
 */
export async function generatePersonalizedPromptContext(
  profile: BusinessProfile
): Promise<PersonalizedContext> {
  try {
    log.info({ industry: profile.business_industry }, 'Generating personalized prompt context');

    // Prepare funnel stages string
    let funnelStagesStr = profile.funnel_stages_description || 'не указано';
    if (profile.funnel_stages_structured && profile.funnel_stages_structured.length > 0) {
      funnelStagesStr = profile.funnel_stages_structured
        .sort((a, b) => a.order - b.order)
        .map(s => s.name)
        .join(' → ');
    }

    // Prepare key stages string
    const keyStagesStr = profile.key_funnel_stages && profile.key_funnel_stages.length > 0
      ? profile.key_funnel_stages.join(', ')
      : 'не указано';

    // Fill meta-prompt with brief data
    const prompt = META_PROMPT
      .replace('<<<INDUSTRY>>>', profile.business_industry)
      .replace('<<<DESCRIPTION>>>', profile.business_description)
      .replace('<<<TARGET_AUDIENCE>>>', profile.target_audience)
      .replace('<<<FUNNEL_STAGES>>>', funnelStagesStr)
      .replace('<<<KEY_STAGES>>>', keyStagesStr)
      .replace('<<<STAGE_CRITERIA>>>', profile.stage_transition_criteria || 'не указано')
      .replace('<<<IDEAL_CLIENT>>>', profile.ideal_client_profile || 'не указано')
      .replace('<<<NON_TARGET>>>', profile.non_target_profile || 'не указано')
      .replace('<<<CLIENT_PAINS>>>', profile.client_pains || 'не указано')
      .replace('<<<INTEREST_OBJECTIONS>>>', profile.interest_and_objections || 'не указано');

    // Call GPT to generate context
    const response = await openai.chat.completions.create({
      model: 'gpt-5-mini',
      messages: [
        { role: 'system', content: 'You are an expert prompt engineer specializing in sales analysis.' },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from OpenAI');
    }

    const context = JSON.parse(content) as PersonalizedContext;
    
    log.info({ industry: profile.business_industry }, 'Personalized context generated');
    
    return context;
  } catch (error: any) {
    log.error({ error: error.message }, 'Failed to generate personalized context');
    
    // Return default context on error
    return getDefaultContext();
  }
}

/**
 * Default context (generic for all)
 */
export function getDefaultContext(): PersonalizedContext {
  return {
    business_context: "Бизнес в сфере услуг, работающий с лидами через WhatsApp.",
    target_profile: "Владелец бизнеса или лицо, принимающее решения о маркетинге.",
    funnel_specifics: "Стандартная воронка: квалификация -> консультация -> сделка.",
    positive_signals: [
      "хочу узнать подробнее",
      "интересно",
      "какие результаты",
      "сколько стоит",
      "когда можем начать"
    ],
    negative_signals: [
      "дорого",
      "не подходит",
      "подумаю",
      "не интересно",
      "нет бюджета"
    ],
    scoring_modifiers: {
      bonus_keywords: ["владелец", "бюджет", "срочно", "готов"],
      penalty_keywords: ["сотрудник", "не решаю", "передам", "потом"]
    },
    qualification_hints: "Важно выяснить: роль в компании, текущие маркетинговые активности, бюджет."
  };
}

/**
 * Format context to text for adding to prompt
 */
export function formatContextForPrompt(context: PersonalizedContext): string {
  let formatted = `
=== ПЕРСОНАЛИЗИРОВАННЫЙ КОНТЕКСТ КЛИЕНТА ===

СПЕЦИФИКА БИЗНЕСА:
${context.business_context}

ИДЕАЛЬНЫЙ ПРОФИЛЬ ЛИДА:
${context.target_profile}

ОСОБЕННОСТИ ВОРОНКИ:
${context.funnel_specifics}
`;

  // Add funnel stages with scoring
  if (context.funnel_stages && context.funnel_stages.length > 0) {
    formatted += `
ЭТАПЫ ВОРОНКИ И СКОРИНГ:
`;
    context.funnel_stages.forEach((stage, i) => {
      const score = context.funnel_scoring?.[stage] || ((i + 1) * Math.round(100 / context.funnel_stages!.length));
      const isKey = context.key_funnel_stages?.includes(stage);
      const keyMarker = isKey ? ' [КЛЮЧЕВОЙ]' : '';
      formatted += `${i + 1}. ${stage} → ${score} баллов${keyMarker}\n`;
    });
  }

  // Add key stages info
  if (context.key_funnel_stages && context.key_funnel_stages.length > 0) {
    formatted += `
КЛЮЧЕВЫЕ ЭТАПЫ ВОРОНКИ (не трогать для рассылок):
${context.key_funnel_stages.map(s => `- ${s}`).join('\n')}

ВАЖНО: Лидов на ключевых этапах НЕ нужно беспокоить автоматическими рассылками.
Они уже записаны/ждут встречи/выполняют важное действие.
`;
  }

  // Add stage transition criteria if available
  if (context.stage_transition_criteria) {
    formatted += `
КРИТЕРИИ ПЕРЕХОДОВ МЕЖДУ ЭТАПАМИ:
${Object.entries(context.stage_transition_criteria).map(([key, value]) => `- ${key}: ${value}`).join('\n')}
`;
  }

  // Add ideal client profile
  if (context.ideal_client_profile) {
    formatted += `
ИДЕАЛЬНЫЙ КЛИЕНТ:
${context.ideal_client_profile}
`;
  }

  // Add non-target profile
  if (context.non_target_profile) {
    formatted += `
КТО НЕ ПОДХОДИТ:
${context.non_target_profile}
`;
  }

  // Add client pains
  if (context.client_pains && context.client_pains.length > 0) {
    formatted += `
ТИПИЧНЫЕ БОЛИ И ЗАПРОСЫ:
${context.client_pains.map(p => `- "${p}"`).join('\n')}
`;
  }

  formatted += `
ПОЗИТИВНЫЕ СИГНАЛЫ (фразы интереса):
${context.positive_signals.map(s => `- "${s}"`).join('\n')}

НЕГАТИВНЫЕ СИГНАЛЫ (возражения):
${context.negative_signals.map(s => `- "${s}"`).join('\n')}

МОДИФИКАТОРЫ СКОРИНГА:
- Повышают приоритет (бонус): ${context.scoring_modifiers.bonus_keywords.join(', ')}
- Понижают приоритет (штраф): ${context.scoring_modifiers.penalty_keywords.join(', ')}
- Совпадение с идеальным профилем: +10-20
- Совпадение с non-target: -20-30
- Упоминание боли клиента: +5-10 за каждую

КВАЛИФИКАЦИЯ:
${context.qualification_hints}

=== КОНЕЦ ПЕРСОНАЛИЗИРОВАННОГО КОНТЕКСТА ===
`;

  return formatted;
}

