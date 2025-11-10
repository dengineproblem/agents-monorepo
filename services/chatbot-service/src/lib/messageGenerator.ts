import { OpenAI } from 'openai';
import { supabase } from './supabase.js';
import { createLogger } from './logger.js';

const log = createLogger({ module: 'messageGenerator' });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!
});

type MessageType = 'selling' | 'useful' | 'reminder';

interface Lead {
  id: string;
  contact_name: string | null;
  contact_phone: string;
  business_type: string | null;
  is_medical: boolean | null;
  funnel_stage: string | null;
  interest_level: string | null;
  score: number | null;
  last_message: string | null;
  last_campaign_message_at: string | null;
  campaign_messages_count: number;
  messages: any[] | null;
  audio_transcripts: any[] | null;
  manual_notes: string | null;
}

interface Template {
  id: string;
  title: string;
  content: string;
  template_type: MessageType;
  is_active?: boolean;
}

interface GeneratedMessage {
  message: string;
  type: MessageType;
  reasoning: string;
}

interface CampaignMessage {
  message_type: MessageType;
  created_at: string;
}

/**
 * Calculate days since a date
 */
function calculateDaysSince(date: string | null): number {
  if (!date) return 999;
  
  const now = new Date();
  const past = new Date(date);
  const diffTime = Math.abs(now.getTime() - past.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays;
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
 * Get last N campaign messages for a lead
 */
async function getLastCampaignMessages(
  leadId: string,
  count: number = 3
): Promise<CampaignMessage[]> {
  const { data, error } = await supabase
    .from('campaign_messages')
    .select('message_type, created_at')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(count);

  if (error) {
    log.error({ error: error.message, leadId }, 'Failed to fetch campaign messages');
    return [];
  }

  return data || [];
}

/**
 * Determine message type based on history and lead characteristics
 */
async function determineMessageType(lead: Lead): Promise<MessageType> {
  try {
    // Get last campaign messages
    const lastMessages = await getLastCampaignMessages(lead.id, 3);
    
    // If no history, start with reminder for cold/warm, selling for hot
    if (lastMessages.length === 0) {
      if (lead.interest_level === 'hot') return 'selling';
      return 'reminder';
    }

    // Count message types in last 3
    const lastTypes = lastMessages.map(m => m.message_type);
    const sellingCount = lastTypes.filter(t => t === 'selling').length;
    const usefulCount = lastTypes.filter(t => t === 'useful').length;
    const reminderCount = lastTypes.filter(t => t === 'reminder').length;

    // If last 2 were selling → useful
    if (sellingCount >= 2) {
      return 'useful';
    }

    // If cold lead and hasn't been contacted in a long time → reminder
    const daysSinceLastCampaign = calculateDaysSince(lead.last_campaign_message_at);
    if (lead.interest_level === 'cold' && daysSinceLastCampaign > 14) {
      return 'reminder';
    }

    // Hot leads → more selling
    if (lead.interest_level === 'hot') {
      return 'selling';
    }

    // Default rotation: selling → useful → reminder → selling
    const lastType = lastMessages[0]?.message_type;
    if (lastType === 'selling') return 'useful';
    if (lastType === 'useful') return 'reminder';
    return 'selling';
  } catch (error: any) {
    log.error({ error: error.message, leadId: lead.id }, 'Failed to determine message type');
    // Default to reminder on error
    return 'reminder';
  }
}

/**
 * Generate personalized message for a lead using AI
 */
export async function generatePersonalizedMessage(
  lead: Lead,
  templates: Template[],
  businessContext?: string
): Promise<GeneratedMessage> {
  try {
    log.info({ leadId: lead.id, leadName: lead.contact_name }, 'Generating personalized message');

    // 1. Determine message type
    const messageType = await determineMessageType(lead);

    // 2. Get relevant templates
    const relevantTemplates = templates.filter(
      t => t.template_type === messageType && t.is_active !== false
    );

    // 3. Build prompt
    const daysSinceLastCampaign = calculateDaysSince(lead.last_campaign_message_at);
    
    const prompt = `Ты - персональный менеджер по продажам.

ЗАДАЧА: Сгенерируй персонализированное WhatsApp сообщение для реактивации клиента.

${businessContext || ''}

ТИП СООБЩЕНИЯ: ${messageType}
- "selling": Продающее (предложение консультации, услуг, кейсы, результаты)
- "useful": Полезное (статья, совет, чек-лист, инсайт, тренды)
- "reminder": Напоминающее (как дела, что нового, мягкое касание)

КОНТЕКСТ КЛИЕНТА:
- Имя: ${lead.contact_name || 'Клиент'}
- Бизнес: ${lead.business_type || 'не указан'}
- Медицина: ${lead.is_medical ? 'да' : 'нет'}
- Этап воронки: ${lead.funnel_stage}
- Теплота: ${lead.interest_level?.toUpperCase()}
- Score: ${lead.score}
- Прошло дней с последней рассылки: ${daysSinceLastCampaign}
- Всего сообщений кампаний: ${lead.campaign_messages_count}

ИСТОРИЯ ПЕРЕПИСКИ (последние 10 сообщений):
${formatLastMessages(lead.messages, 10)}

${lead.audio_transcripts && lead.audio_transcripts.length > 0 ? `
ТРАНСКРИПТЫ ЗВОНКОВ:
${lead.audio_transcripts.map((t: any) => t.transcript).join('\n\n')}
` : ''}

${lead.manual_notes ? `
ЗАМЕТКИ МЕНЕДЖЕРА:
${lead.manual_notes}
` : ''}

${relevantTemplates.length > 0 ? `
ДОСТУПНЫЕ ШАБЛОНЫ И МАТЕРИАЛЫ (используй как базу):
${relevantTemplates.map(t => `${t.title}: ${t.content}`).join('\n\n')}
` : ''}

ПРАВИЛА:
1. Сообщение на русском, естественное, персональное
2. Длина: 50-150 слов (не более!)
3. Обязательно учитывай всю историю общения и контекст
4. Для "selling": мягкая продажа, value proposition, конкретные результаты
5. Для "useful": конкретная польза, ссылка/материал из шаблонов если есть
6. Для "reminder": легкое касание, не давить, естественный разговор
7. НЕ повторяй то, что уже было сказано ранее
8. Адаптируй под теплоту лида (HOT=более прямолинейно, COLD=мягче)
9. Упоминай имя клиента если оно есть
10. НЕ используй эмодзи, только текст

Верни JSON:
{
  "message": "текст сообщения",
  "reasoning": "почему выбран этот тип и содержание"
}`;

    // 4. Call OpenAI
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a helpful assistant that generates personalized WhatsApp messages for lead reactivation.' },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.8, // Higher creativity for personalized messages
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from OpenAI');
    }

    const result = JSON.parse(content);
    
    log.info({ 
      leadId: lead.id, 
      messageType,
      messageLength: result.message.length 
    }, 'Message generated successfully');

    return {
      message: result.message,
      type: messageType,
      reasoning: result.reasoning
    };
  } catch (error: any) {
    log.error({ error: error.message, leadId: lead.id }, 'Failed to generate message');
    
    // Fallback message
    return {
      message: `Добрый день${lead.contact_name ? ', ' + lead.contact_name : ''}! Как дела? Есть новости по вашей клинике?`,
      type: 'reminder',
      reasoning: 'Fallback message due to error'
    };
  }
}

/**
 * Generate messages for multiple leads in batch
 */
export async function generateBatchMessages(
  leads: Lead[],
  userAccountId: string
): Promise<Map<string, GeneratedMessage>> {
  try {
    log.info({ userAccountId, leadsCount: leads.length }, 'Generating batch messages');

    // Get business profile with personalized context
    const { data: profile } = await supabase
      .from('business_profile')
      .select('personalized_context')
      .eq('user_account_id', userAccountId)
      .maybeSingle();

    let businessContext = '';
    if (profile?.personalized_context) {
      const ctx = profile.personalized_context as any;
      businessContext = `
=== ПЕРСОНАЛИЗИРОВАННЫЙ КОНТЕКСТ БИЗНЕСА ===

СПЕЦИФИКА БИЗНЕСА:
${ctx.business_context || ''}

ИДЕАЛЬНЫЙ ПРОФИЛЬ ЛИДА:
${ctx.target_profile || ''}

ОСОБЕННОСТИ ВОРОНКИ:
${ctx.funnel_specifics || ''}

${ctx.funnel_stages && ctx.funnel_stages.length > 0 ? `
ЭТАПЫ ВОРОНКИ:
${ctx.funnel_stages.map((s: string, i: number) => `${i + 1}. ${s}`).join('\n')}
` : ''}

ПОЗИТИВНЫЕ СИГНАЛЫ:
${ctx.positive_signals ? ctx.positive_signals.map((s: string) => `- "${s}"`).join('\n') : 'не указано'}

НЕГАТИВНЫЕ СИГНАЛЫ:
${ctx.negative_signals ? ctx.negative_signals.map((s: string) => `- "${s}"`).join('\n') : 'не указано'}

МОДИФИКАТОРЫ ПРИОРИТЕТА:
- Повышают: ${ctx.scoring_modifiers?.bonus_keywords?.join(', ') || 'не указано'}
- Понижают: ${ctx.scoring_modifiers?.penalty_keywords?.join(', ') || 'не указано'}

=== КОНЕЦ ПЕРСОНАЛИЗИРОВАННОГО КОНТЕКСТА ===
`;
      log.info({ userAccountId }, 'Using personalized business context for message generation');
    }

    // Get all active templates for user
    const { data: templates, error: templatesError } = await supabase
      .from('campaign_templates')
      .select('*')
      .eq('user_account_id', userAccountId)
      .eq('is_active', true);

    if (templatesError) {
      log.error({ error: templatesError.message }, 'Failed to fetch templates');
    }

    const userTemplates = templates || [];

    // Generate messages for each lead
    const results = new Map<string, GeneratedMessage>();

    for (const lead of leads) {
      try {
        const generatedMessage = await generatePersonalizedMessage(lead, userTemplates, businessContext);
        results.set(lead.id, generatedMessage);
      } catch (error: any) {
        log.error({ error: error.message, leadId: lead.id }, 'Failed to generate message for lead');
        // Continue with other leads
      }
    }

    log.info({ 
      userAccountId, 
      successCount: results.size, 
      totalLeads: leads.length 
    }, 'Batch message generation completed');

    return results;
  } catch (error: any) {
    log.error({ error: error.message, userAccountId }, 'Failed to generate batch messages');
    throw error;
  }
}

