import { OpenAI } from 'openai';
import { supabase } from './supabase.js';
import { createLogger } from './logger.js';

const log = createLogger({ module: 'reanalyzeWithContext' });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!
});

// Базовый промпт для переанализа (упрощенная версия из analyzeDialogs.ts)
const REANALYSIS_PROMPT = `Ты — Динар, менеджер Performante (маркетинг для клиник).

Проанализируй диалог WhatsApp с учетом ДОПОЛНИТЕЛЬНОГО КОНТЕКСТА. Формат:

C: — клиент
A: — агент
S: — системное сообщение

Верни JSON (только JSON, без дополнительного текста):

{
  "business_type": string | null,
  "is_medical": boolean,
  "is_owner": boolean | null,
  "uses_ads_now": boolean | null,
  "has_sales_dept": boolean | null,
  "ad_budget": string | null,
  "qualification_complete": boolean,
  "has_booking": boolean,
  "sent_instagram": boolean,
  "instagram_url": string | null,
  "funnel_stage": "not_qualified" | "qualified" | "consultation_booked" | "consultation_completed" | "deal_closed" | "deal_lost",
  "interest_level": "hot" | "warm" | "cold",
  "main_intent": "clinic_lead" | "ai_targetolog" | "marketing_analysis" | "other",
  "objection": string | null,
  "next_message": string,
  "action": "want_call" | "want_work" | "reserve" | "none",
  "score": 0-100,
  "reasoning": string
}

СИСТЕМА СКОРИНГА:
- Базовый score по этапу воронки: new_lead(5), not_qualified(15), qualified(30), consultation_booked(40), consultation_completed(55), deal_closed(75), deal_lost(0)
- Модификаторы ниши: Медицина(+15), Инфобизнес(+10), Салоны(+10), Таргетологи(-30)
- Модификаторы поведения: Владелец(+10), Бюджет указан(+10), Записался(+20), "Подумаю"(-20)
- Interest level: HOT(75-100), WARM(40-74), COLD(0-39)

<<<ADDITIONAL_CONTEXT>>>

ИСТОРИЯ ПЕРЕПИСКИ:
<<<DIALOG>>>

Пересчитай score, interest_level, funnel_stage, reasoning с учетом ПОЛНОГО контекста (переписка + аудио + заметки).`;

interface AnalysisResult {
  business_type: string | null;
  is_medical: boolean;
  is_owner: boolean | null;
  uses_ads_now: boolean | null;
  has_sales_dept: boolean | null;
  ad_budget: string | null;
  qualification_complete: boolean;
  has_booking: boolean;
  sent_instagram: boolean;
  instagram_url: string | null;
  funnel_stage: 'not_qualified' | 'qualified' | 'consultation_booked' | 'consultation_completed' | 'deal_closed' | 'deal_lost';
  interest_level: 'hot' | 'warm' | 'cold';
  main_intent: 'clinic_lead' | 'ai_targetolog' | 'marketing_analysis' | 'other';
  objection: string | null;
  next_message: string;
  action: 'want_call' | 'want_work' | 'reserve' | 'none';
  score: number;
  reasoning: string;
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

    // Build additional context
    const additionalContext = `ДОПОЛНИТЕЛЬНЫЙ КОНТЕКСТ ИЗ АУДИОЗАПИСИ ЗВОНКА:
${transcript}

${lead.manual_notes ? `ЗАМЕТКИ МЕНЕДЖЕРА:
${lead.manual_notes}` : ''}`;

    // Format dialog
    const dialogText = formatMessages(lead.messages);

    // Build prompt
    const prompt = REANALYSIS_PROMPT
      .replace('<<<ADDITIONAL_CONTEXT>>>', additionalContext)
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
      .replace('<<<ADDITIONAL_CONTEXT>>>', additionalContext)
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

