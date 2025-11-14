/**
 * Prompt Builder
 * 
 * Constructs the enhanced prompt for AI message generation
 * with examples, contexts, and strategic guidance.
 */

import { StrategyType, MessageType, CampaignContext } from './strategyTypes.js';
import { formatContextsForPrompt } from './contextManager.js';
import { messageExamples, goalDescriptions, strategyRules } from './messageExamples.js';

interface Lead {
  id: string;
  contact_name: string | null;
  business_type: string | null;
  is_medical: boolean | null;
  funnel_stage: string | null;
  interest_level: string | null;
  score: number | null;
  campaign_messages_count: number;
  messages: any[] | null;
  audio_transcripts: any[] | null;
  manual_notes: string | null;
}

interface Template {
  id: string;
  title: string;
  content: string;
  template_type: string;
}

interface PromptParams {
  lead: Lead;
  strategyType: StrategyType;
  messageType: MessageType;
  businessContext: string;
  activeContexts: CampaignContext[];
  templates: Template[];
  daysSinceLastCampaign: number;
}

/**
 * Format last N messages for prompt
 */
function formatLastMessages(messages: any[] | null, count: number = 10): string {
  if (!messages || !Array.isArray(messages)) {
    return 'Нет истории переписки';
  }

  const lastMessages = messages.slice(-count);
  
  return lastMessages
    .map(msg => {
      if (msg.is_system) return `S: ${msg.text}`;
      if (msg.from_me) return `A: ${msg.text}`;
      return `C: ${msg.text}`;
    })
    .join('\n');
}

/**
 * Format audio transcripts for prompt
 */
function formatTranscripts(transcripts: any[]): string {
  if (!transcripts || transcripts.length === 0) {
    return '';
  }
  
  return transcripts
    .map((t: any, i: number) => `Звонок ${i + 1}:\n${t.transcript || t.text || 'нет текста'}`)
    .join('\n\n');
}

/**
 * Build the complete message generation prompt
 */
export function buildMessagePrompt(params: PromptParams): string {
  const { 
    lead, 
    strategyType, 
    messageType, 
    businessContext, 
    activeContexts, 
    templates, 
    daysSinceLastCampaign 
  } = params;
  
  const goal = goalDescriptions[strategyType];
  const rule = strategyRules[strategyType];
  
  return `Ты - персональный менеджер по продажам.

ЗАДАЧА:
Сгенерируй персонализированное WhatsApp сообщение для реактивации клиента.

${businessContext}

=== АКТУАЛЬНЫЙ КОНТЕКСТ (ИСПОЛЬЗУЙ, ЕСЛИ УМЕСТНО) ===

${formatContextsForPrompt(activeContexts)}

Правило: выбери НЕ БОЛЕЕ ОДНОГО актуального контекста, который лучше всего подходит этому лиду, и используй его естественно, без навязчивости.

=== КОНЕЦ АКТУАЛЬНОГО КОНТЕКСТА ===

ТИП/СТРАТЕГИЯ СООБЩЕНИЯ:

Стратегический тип: ${strategyType}
Технический тип: ${messageType}

ОПИСАНИЕ ТИПОВ:
- check_in: мягкое касание, "как у вас дела", "актуальна ли тема", без прямой продажи.
- value: полезный контент (советы, чек-лист, инсайт, короткий полезный текст).
- case: мини-кейс или история клиента с понятным результатом.
- offer: конкретная акция/спецпредложение, если есть подходящий актуальный контекст.
- direct_selling: прямое предложение перейти к следующему шагу (созвон, запись, старт работы).

ЦЕЛЬ ЭТОГО СООБЩЕНИЯ:
${goal}

КОНТЕКСТ КЛИЕНТА:
- Имя: ${lead.contact_name || 'Клиент'}
- Бизнес: ${lead.business_type || 'не указан'}
- Медицина: ${lead.is_medical ? 'да' : 'нет'}
- Этап воронки: ${lead.funnel_stage || 'не указан'}
- Теплота: ${(lead.interest_level || 'неизвестно').toUpperCase()}
- Score: ${lead.score || 0}
- Прошло дней с последней рассылки: ${daysSinceLastCampaign}
- Всего сообщений кампаний: ${lead.campaign_messages_count}

ИСТОРИЯ ПЕРЕПИСКИ (последние 10 сообщений):
${formatLastMessages(lead.messages, 10)}
${lead.audio_transcripts && lead.audio_transcripts.length > 0 ? `

ТРАНСКРИПТЫ ЗВОНКОВ (ключевые фразы, возражения, интересы):
${formatTranscripts(lead.audio_transcripts)}` : ''}
${lead.manual_notes ? `

ЗАМЕТКИ МЕНЕДЖЕРА:
${lead.manual_notes}` : ''}

ДОСТУПНЫЕ ШАБЛОНЫ И МАТЕРИАЛЫ (используй как базу, но НЕ копируй дословно):
${templates.length > 0 ? templates.map(t => `${t.title}:\n${t.content}`).join('\n\n') : 'Нет доступных шаблонов'}

=== ПРИМЕРЫ ХОРОШИХ СООБЩЕНИЙ ПО ТИПАМ (СТИЛЬ, А НЕ ШАБЛОН) ===

[Тип: check_in]
${messageExamples.check_in}

[Тип: value]
${messageExamples.value}

[Тип: case]
${messageExamples.case}

[Тип: offer]
${messageExamples.offer}

[Тип: direct_selling]
${messageExamples.direct_selling}

=== ПРАВИЛА ДЛЯ ГЕНЕРАЦИИ СООБЩЕНИЯ ===

1. Сообщение на русском, естественное, персональное.
2. Длина: 50–150 слов.
3. Обязательно учитывай ВЕСЬ контекст: этап воронки, теплоту, историю, актуальный контекст.
4. Для "${strategyType}": ${rule}
5. НЕ повторяй дословно то, что уже было сказано ранее в переписке или шаблонах.
6. Упоминай имя клиента, если оно есть.
7. Не используй эмодзи, только текст.
8. Не используй агрессивные формулировки типа "последний шанс", "только сегодня", если клиент холодный или давно не отвечал.

ВЕРНИ ЧИСТЫЙ JSON:
{
  "message": "текст сообщения",
  "reasoning": "почему ты выбрал такой тип, цель и содержание именно для этого лида"
}`;
}

