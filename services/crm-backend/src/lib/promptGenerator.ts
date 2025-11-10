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
- Главные задачи: <<<CHALLENGES>>>
- Этапы воронки: <<<FUNNEL_STAGES>>>
- Критерии переходов: <<<STAGE_CRITERIA>>>
- Позитивные сигналы: <<<POSITIVE_SIGNALS>>>
- Негативные сигналы: <<<NEGATIVE_SIGNALS>>>

СОЗДАЙ JSON с персонализированным контекстом:

{
  "business_context": "Краткое описание специфики бизнеса клиента (2-3 предложения)",
  "target_profile": "Описание идеального лида для этого бизнеса",
  "funnel_specifics": "Особенности воронки продаж в этой нише",
  "funnel_stages": ["этап1", "этап2", ...],
  "stage_transition_criteria": {
    "этап1_к_этап2": "конкретный критерий",
    "этап2_к_этап3": "конкретный критерий"
  },
  "positive_signals": ["фраза 1", "фраза 2", ...],
  "negative_signals": ["фраза 1", "фраза 2", ...],
  "scoring_modifiers": {
    "bonus_keywords": ["слово1", "слово2"],
    "penalty_keywords": ["слово1", "слово2"]
  },
  "qualification_hints": "Что важно спросить для квалификации в этой нише"
}

ПРАВИЛА:
1. Контекст должен быть конкретным и релевантным нише
2. Используй ВСЕ предоставленные данные из брифа
3. Если клиент указал этапы воронки - используй их, иначе предложи стандартные
4. Если клиент указал позитивные/негативные сигналы - включи их в массивы
5. Фразы-сигналы должны быть типичными для этого бизнеса
6. Учитывай специфику продаж в указанной сфере
7. Modifiers должны отражать ценность клиента для этого бизнеса
8. Все на русском языке

Верни ТОЛЬКО JSON, без дополнительного текста.`;

export interface BusinessProfile {
  business_industry: string;
  business_description: string;
  target_audience: string;
  main_challenges: string;
  funnel_stages_description?: string;
  stage_transition_criteria?: string;
  positive_signals?: string;
  negative_signals?: string;
}

export interface PersonalizedContext {
  business_context: string;
  target_profile: string;
  funnel_specifics: string;
  funnel_stages?: string[];
  stage_transition_criteria?: Record<string, string>;
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

    // Fill meta-prompt with brief data
    const prompt = META_PROMPT
      .replace('<<<INDUSTRY>>>', profile.business_industry)
      .replace('<<<DESCRIPTION>>>', profile.business_description)
      .replace('<<<TARGET_AUDIENCE>>>', profile.target_audience)
      .replace('<<<CHALLENGES>>>', profile.main_challenges)
      .replace('<<<FUNNEL_STAGES>>>', profile.funnel_stages_description || 'не указано')
      .replace('<<<STAGE_CRITERIA>>>', profile.stage_transition_criteria || 'не указано')
      .replace('<<<POSITIVE_SIGNALS>>>', profile.positive_signals || 'не указано')
      .replace('<<<NEGATIVE_SIGNALS>>>', profile.negative_signals || 'не указано');

    // Call GPT to generate context
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
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

  // Add funnel stages if available
  if (context.funnel_stages && context.funnel_stages.length > 0) {
    formatted += `
ЭТАПЫ ВОРОНКИ:
${context.funnel_stages.map((s, i) => `${i + 1}. ${s}`).join('\n')}
`;
  }

  // Add stage transition criteria if available
  if (context.stage_transition_criteria) {
    formatted += `
КРИТЕРИИ ПЕРЕХОДОВ МЕЖДУ ЭТАПАМИ:
${Object.entries(context.stage_transition_criteria).map(([key, value]) => `- ${key}: ${value}`).join('\n')}
`;
  }

  formatted += `
ПОЗИТИВНЫЕ СИГНАЛЫ (признаки заинтересованности):
${context.positive_signals.map(s => `- "${s}"`).join('\n')}

НЕГАТИВНЫЕ СИГНАЛЫ (возражения):
${context.negative_signals.map(s => `- "${s}"`).join('\n')}

МОДИФИКАТОРЫ СКОРИНГА:
- Повышают приоритет: ${context.scoring_modifiers.bonus_keywords.join(', ')}
- Понижают приоритет: ${context.scoring_modifiers.penalty_keywords.join(', ')}

КВАЛИФИКАЦИЯ:
${context.qualification_hints}

=== КОНЕЦ ПЕРСОНАЛИЗИРОВАННОГО КОНТЕКСТА ===
`;

  return formatted;
}

