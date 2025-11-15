import { OpenAI } from 'openai';
import { supabase } from './supabase.js';
import { createLogger } from './logger.js';
import { getDefaultContext, formatContextForPrompt } from './promptGenerator.js';

const log = createLogger({ module: 'reanalyzeWithContext' });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!
});

// Базовый промпт для переанализа с учетом дополнительного контекста (универсальный)
const REANALYSIS_PROMPT = `Ты — менеджер по продажам, анализирующий WhatsApp переписку.

Проанализируй диалог WhatsApp с учетом ДОПОЛНИТЕЛЬНОГО КОНТЕКСТА. Формат:

C: — клиент
A: — агент
S: — системное сообщение

Верни JSON (только JSON, без дополнительного текста):

{
  "client_name": string | null,
  "lead_tags": string[],
  "business_type": string | null,
  "is_owner": boolean | null,
  "qualification_complete": boolean,
  "funnel_stage": "not_qualified" | "qualified" | "consultation_booked" | "consultation_completed" | "deal_closed" | "deal_lost",
  "interest_level": "hot" | "warm" | "cold",
  "main_intent": "purchase" | "inquiry" | "support" | "consultation" | "other",
  "objection": string | null,
  "next_message": string,
  "action": "want_call" | "want_work" | "reserve" | "none",
  "score": 0-100,
  "reasoning": string,
  "custom_fields": Record<string, any> | null
}

CLIENT_NAME - ВАЛИДАЦИЯ ИМЕНИ:
Если имя из WhatsApp (указано ниже) не является настоящим именем (инициалы типа "Rs", "AB", короткие символы, цифры, общие слова "Test", "User") - ищи реальное имя в переписке.
Если имя найдено в переписке - верни его. Если нет - верни null.

LEAD_TAGS - ВАЖНО:
Сгенерируй 2-3 ключевых тега которые характеризуют этого лида. Теги должны быть универсальными и подходить для любой ниши бизнеса.

ЭТАПЫ ВОРОНКИ И СКОРИНГ:
Используй этапы воронки, скоринг и критерии из ПЕРСОНАЛИЗИРОВАННОГО КОНТЕКСТА клиента ниже.
Определи на каком этапе находится лид и присвой соответствующий базовый score из funnel_scoring.

ДОПОЛНИТЕЛЬНЫЕ МОДИФИКАТОРЫ СКОРИНГА:
- Совпадение с идеальным профилем клиента: +10-20
- Совпадение с non-target профилем: -20-30
- Упоминание болей клиента: +5-10 за каждую
- Позитивные сигналы (фразы интереса): +5 за каждую
- Негативные сигналы (возражения): -10 за каждое
- Быстро отвечает: +5
- Долго не отвечает: -15

<<<PERSONALIZED_CONTEXT>>>

<<<ADDITIONAL_CONTEXT>>>

ИМЯ КЛИЕНТА ИЗ WHATSAPP: <<<CONTACT_NAME_FROM_WHATSAPP>>>

ИСТОРИЯ ПЕРЕПИСКИ:
<<<DIALOG>>>

Пересчитай score, interest_level, funnel_stage, reasoning с учетом ПОЛНОГО контекста (переписка + аудио + заметки).`;

interface AnalysisResult {
  client_name: string | null;
  business_type: string | null;
  is_owner: boolean | null;
  qualification_complete: boolean;
  funnel_stage: 'not_qualified' | 'qualified' | 'consultation_booked' | 'consultation_completed' | 'deal_closed' | 'deal_lost';
  interest_level: 'hot' | 'warm' | 'cold';
  main_intent: 'purchase' | 'inquiry' | 'support' | 'consultation' | 'other';
  objection: string | null;
  next_message: string;
  action: 'want_call' | 'want_work' | 'reserve' | 'none';
  score: number;
  reasoning: string;
  custom_fields: Record<string, any> | null;
}

/**
 * Format messages in compact format for LLM
 */
function formatMessages(messages: any[]): string {
  if (!messages || !Array.isArray(messages)) {
    return 'Нет истории переписки';
  }

  return messages
    .map(msg => {
      if (msg.is_system) {
        return `S: ${msg.text}`;
      }
      if (msg.from_me) {
        return `A: ${msg.text}`;
      }
      return `C: ${msg.text}`;
    })
    .join('\n');
}

/**
 * Reanalyze lead with audio transcript context
 */
export async function reanalyzeWithAudioContext(
  leadId: string,
  transcript: string
): Promise<Partial<AnalysisResult>> {
  try {
    log.info({ leadId }, 'Reanalyzing with audio context');

    // Get current lead data
    const { data: lead, error } = await supabase
      .from('dialog_analysis')
      .select('*')
      .eq('id', leadId)
      .single();

    if (error || !lead) {
      throw new Error(`Lead not found: ${leadId}`);
    }

    // Get business profile for personalized context
    const { data: profile } = await supabase
      .from('business_profile')
      .select('*')
      .eq('user_account_id', lead.user_account_id)
      .maybeSingle();

    let personalizedContext = '';
    if (profile?.personalized_context) {
      personalizedContext = formatContextForPrompt(profile.personalized_context);
    } else {
      personalizedContext = formatContextForPrompt(getDefaultContext());
    }

    // Build additional context
    const additionalContext = `ДОПОЛНИТЕЛЬНЫЙ КОНТЕКСТ ИЗ АУДИОЗАПИСИ ЗВОНКА:
${transcript}

${lead.manual_notes ? `ЗАМЕТКИ МЕНЕДЖЕРА:
${lead.manual_notes}` : ''}`;

    // Format dialog
    const dialogText = formatMessages(lead.messages);

    // Build prompt
    const prompt = REANALYSIS_PROMPT
      .replace('<<<PERSONALIZED_CONTEXT>>>', personalizedContext)
      .replace('<<<ADDITIONAL_CONTEXT>>>', additionalContext)
      .replace('<<<CONTACT_NAME_FROM_WHATSAPP>>>', lead.contact_name || 'не указано')
      .replace('<<<DIALOG>>>', dialogText);

    // Call OpenAI
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a helpful assistant that analyzes WhatsApp dialogs and returns structured JSON.' },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from OpenAI');
    }

    const result = JSON.parse(content) as AnalysisResult;
    
    log.info({ 
      leadId, 
      oldScore: lead.score, 
      newScore: result.score,
      oldInterest: lead.interest_level,
      newInterest: result.interest_level
    }, 'Lead reanalyzed with audio context');

    return result;
  } catch (error: any) {
    log.error({ error: error.message, leadId }, 'Failed to reanalyze with audio context');
    throw error;
  }
}

/**
 * Reanalyze lead with manual notes
 */
export async function reanalyzeWithNotes(
  leadId: string,
  notes: string
): Promise<Partial<AnalysisResult>> {
  try {
    log.info({ leadId }, 'Reanalyzing with notes');

    // Get current lead data
    const { data: lead, error } = await supabase
      .from('dialog_analysis')
      .select('*')
      .eq('id', leadId)
      .single();

    if (error || !lead) {
      throw new Error(`Lead not found: ${leadId}`);
    }

    // Get business profile for personalized context
    const { data: profile } = await supabase
      .from('business_profile')
      .select('*')
      .eq('user_account_id', lead.user_account_id)
      .maybeSingle();

    let personalizedContext = '';
    if (profile?.personalized_context) {
      personalizedContext = formatContextForPrompt(profile.personalized_context);
    } else {
      personalizedContext = formatContextForPrompt(getDefaultContext());
    }

    // Build additional context
    let additionalContext = `ЗАМЕТКИ МЕНЕДЖЕРА:
${notes}`;

    // Include audio transcripts if available
    if (lead.audio_transcripts && Array.isArray(lead.audio_transcripts) && lead.audio_transcripts.length > 0) {
      const transcripts = lead.audio_transcripts
        .map((t: any) => t.transcript)
        .join('\n\n');
      additionalContext += `\n\nТРАНСКРИПТЫ ЗВОНКОВ:\n${transcripts}`;
    }

    // Format dialog
    const dialogText = formatMessages(lead.messages);

    // Build prompt
    const prompt = REANALYSIS_PROMPT
      .replace('<<<PERSONALIZED_CONTEXT>>>', personalizedContext)
      .replace('<<<ADDITIONAL_CONTEXT>>>', additionalContext)
      .replace('<<<CONTACT_NAME_FROM_WHATSAPP>>>', lead.contact_name || 'не указано')
      .replace('<<<DIALOG>>>', dialogText);

    // Call OpenAI
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a helpful assistant that analyzes WhatsApp dialogs and returns structured JSON.' },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from OpenAI');
    }

    const result = JSON.parse(content) as AnalysisResult;
    
    log.info({ 
      leadId, 
      oldScore: lead.score, 
      newScore: result.score,
      oldInterest: lead.interest_level,
      newInterest: result.interest_level
    }, 'Lead reanalyzed with notes');

    return result;
  } catch (error: any) {
    log.error({ error: error.message, leadId }, 'Failed to reanalyze with notes');
    throw error;
  }
}

