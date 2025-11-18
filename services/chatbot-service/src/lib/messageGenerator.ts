import { OpenAI } from 'openai';
import { supabase } from './supabase.js';
import { createLogger } from './logger.js';
import { StrategyType, InterestLevel, MessageType } from './strategyTypes.js';
import { determineStrategyType } from './strategySelector.js';
import { getActiveContexts, incrementContextUsage } from './contextManager.js';
import { buildMessagePrompt } from './promptBuilder.js';

const log = createLogger({ module: 'messageGenerator' });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!
});

interface Lead {
  id: string;
  user_account_id?: string;
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
  strategy_type?: StrategyType | null;
  is_active?: boolean;
}

interface GeneratedMessage {
  message: string;
  type: MessageType;
  strategyType: StrategyType;
  reasoning: string;
  contextId?: string;
  goalDescription?: string;
}

interface CampaignMessage {
  message_type: MessageType;
  strategy_type?: StrategyType | null;
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
 * (moved to promptBuilder.ts, kept here for compatibility)
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
    .select('message_type, strategy_type, created_at')
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
 * DEPRECATED: Old message type determination - replaced by strategy-based system
 * Kept for backward compatibility
 */
async function determineMessageType_OLD(lead: Lead): Promise<MessageType> {
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
 * Generate personalized message for a lead using AI with strategy-based system
 */
export async function generatePersonalizedMessage(
  lead: Lead,
  templates: Template[],
  businessContext?: string,
  userAccountId?: string
): Promise<GeneratedMessage> {
  try {
    log.info({ leadId: lead.id, leadName: lead.contact_name }, 'Generating personalized message with strategy system');

    // 1. Get active contexts for this lead
    const activeContexts = await getActiveContexts(
      userAccountId || lead.user_account_id || '',
      lead.funnel_stage,
      lead.interest_level as InterestLevel
    );

    // 2. Get last strategy types (prefer strategy_type over message_type)
    const lastMessages = await getLastCampaignMessages(lead.id, 3);
    const lastStrategyTypes = lastMessages
      .map(m => m.strategy_type)
      .filter(Boolean) as StrategyType[];

    // 3. Determine strategy type using new system
    const { strategyType, messageType, selectedContext } = await determineStrategyType({
      lead: {
        id: lead.id,
        funnel_stage: lead.funnel_stage,
        interest_level: lead.interest_level as InterestLevel,
        campaign_messages_count: lead.campaign_messages_count
      },
      lastMessageTypes: lastStrategyTypes,
      activeContexts
    }, userAccountId || lead.user_account_id || '');

    // 4. Get relevant templates (filter by strategy_type if available, else by message_type)
    const relevantTemplates = templates.filter(t => {
      if (t.strategy_type) {
        return t.strategy_type === strategyType && t.is_active !== false;
      }
      return t.template_type === messageType && t.is_active !== false;
    });

    // 5. Build enhanced prompt
    const daysSinceLastCampaign = calculateDaysSince(lead.last_campaign_message_at);
    
    // Pass only the selected context to the prompt, not all contexts
    const contextsForPrompt = selectedContext ? [selectedContext] : [];
    
    const prompt = buildMessagePrompt({
      lead,
      strategyType,
      messageType,
      businessContext: businessContext || '',
      activeContexts: contextsForPrompt,
      templates: relevantTemplates,
      daysSinceLastCampaign
    });
    
    // DEBUG: Log contexts being sent to GPT
    if (activeContexts && activeContexts.length > 0) {
      log.info({
        leadId: lead.id,
        contextsCount: activeContexts.length,
        contexts: activeContexts.map(c => ({
          title: c.title,
          type: c.type,
          contentPreview: c.content.substring(0, 200)
        }))
      }, 'DEBUG: Contexts in prompt');
    }

    // 6. Call OpenAI
    const response = await openai.chat.completions.create({
      model: 'gpt-5-mini',
      messages: [
        { role: 'system', content: 'You are a helpful assistant that generates personalized WhatsApp messages for lead reactivation.' },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' },
      // temperature: 1 is the default and only supported value for gpt-5-mini
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from OpenAI');
    }

    const result = JSON.parse(content);
    
    // 7. Increment context usage if context was used
    if (selectedContext) {
      await incrementContextUsage(selectedContext.id);
    }
    
    log.info({ 
      leadId: lead.id, 
      strategyType,
      messageType,
      messageLength: result.message.length,
      contextUsed: !!selectedContext
    }, 'Message generated successfully with strategy system');

    return {
      message: result.message,
      type: messageType,
      strategyType,
      reasoning: result.reasoning,
      contextId: selectedContext?.id,
      goalDescription: `Strategy: ${strategyType}`
    };
  } catch (error: any) {
    log.error({ error: error.message, leadId: lead.id }, 'Failed to generate message');
    
    // Fallback message
    return {
      message: lead.contact_name 
        ? `Добрый день, ${lead.contact_name}! Как дела? Есть новости по вашей клинике?`
        : 'Здравствуйте! Напоминаю о себе. Актуальна ли ещё тема по настройке рекламы?',
      type: 'reminder',
      strategyType: 'check_in',
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

    // Generate messages for each lead in parallel (with concurrency limit)
    const results = new Map<string, GeneratedMessage>();
    
    // Process in batches to avoid overwhelming OpenAI API (20 concurrent requests)
    const BATCH_SIZE = 20;
    
    for (let i = 0; i < leads.length; i += BATCH_SIZE) {
      const batch = leads.slice(i, i + BATCH_SIZE);
      
      log.info({ 
        userAccountId, 
        batchNumber: Math.floor(i / BATCH_SIZE) + 1,
        batchSize: batch.length,
        totalLeads: leads.length 
      }, 'Processing batch of leads');
      
      const promises = batch.map(async (lead) => {
        try {
          const generatedMessage = await generatePersonalizedMessage(lead, userTemplates, businessContext, userAccountId);
          return { leadId: lead.id, message: generatedMessage };
        } catch (error: any) {
          log.error({ error: error.message, leadId: lead.id }, 'Failed to generate message for lead');
          return null;
        }
      });
      
      const batchResults = await Promise.all(promises);
      
      // Add successful results to map
      for (const result of batchResults) {
        if (result) {
          results.set(result.leadId, result.message);
        }
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

