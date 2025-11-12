import { OpenAI } from 'openai';
import { getFilteredDialogsForAnalysis, getNewLeads } from '../lib/evolutionDb.js';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { getDefaultContext, formatContextForPrompt, type PersonalizedContext } from '../lib/promptGenerator.js';

const log = createLogger({ module: 'analyzeDialogs' });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!
});

// Базовый промпт (общий для всех)
const BASE_ANALYSIS_PROMPT = `Ты — менеджер по продажам, анализирующий WhatsApp переписку.

Проанализируй диалог WhatsApp. Формат:

C: — клиент
A: — агент
S: — системное сообщение

Верни JSON (только JSON, без дополнительного текста):

{
  "lead_tags": string[],
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
  "action": "want_call" | "want_work" | "reserve" | "none",
  "score": 0-100,
  "reasoning": string
}

LEAD_TAGS - ВАЖНО:
Сгенерируй 2-3 ключевых тега которые характеризуют этого лида. Теги должны быть универсальными и подходить для любой ниши бизнеса.
Примеры тегов:
- География: "Москва", "Санкт-Петербург", "Удаленно"
- Бюджет: "До 50к", "50-100к", "100к+"
- Срочность: "Срочно", "В течение недели", "Планирует"
- Интерес/Потребность: "Хочет консультацию", "Интересуется ценой", "Сравнивает варианты"
- Категория/Проблема: специфичные для ниши теги
- Статус: "Готов к покупке", "Изучает", "Сомневается"

Выбирай только самые важные характеристики лида. Теги должны быть краткими (1-3 слова).

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

Interest level (финальный): HOT(75-100), WARM(40-74), COLD(0-39)

ФОРМАТ REASONING - ОБЯЗАТЕЛЬНО:
Представь reasoning в структурированном виде. Каждая строка должна начинаться с + или - и содержать количество баллов:
+ Причина (баллы: +X)
- Причина (баллы: -Y)

Пример:
+ Базовый этап — первый контакт (баллы: +20)
+ Владелец бизнеса, соответствует идеальному профилю (баллы: +10)
+ Задает много технических вопросов (баллы: +5)
- Нет четкого запроса на встречу (баллы: -5)

<<<PERSONALIZED_CONTEXT>>>

<<<BUSINESS_PROFILE_CONTEXT>>>

ИСТОРИЯ ПЕРЕПИСКИ:
<<<DIALOG>>>

Пересчитай score, interest_level, funnel_stage с учетом ВСЕГО контекста.`;

interface Message {
  remote_jid: string;
  contact_name: string | null;
  from_me: string; // 'true' or 'false' as string
  message_data: any;
  timestamp: string;
  key_data: any;
}

interface Contact {
  phone: string;
  name: string | null;
  messages: Array<{
    text: string;
    from_me: boolean;
    timestamp: Date;
    is_system: boolean;
  }>;
  incoming_count: number;
  outgoing_count: number;
  first_message: Date;
  last_message: Date;
}

interface AnalysisResult {
  lead_tags: string[];
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
  action: 'want_call' | 'want_work' | 'reserve' | 'none';
  score: number;
  reasoning: string;
}

/**
 * Extract text from WhatsApp message object
 */
function extractMessageText(messageData: any): { text: string; isSystem: boolean } {
  if (!messageData) return { text: '', isSystem: false };

  // Regular text messages
  if (messageData.conversation) {
    return { text: messageData.conversation, isSystem: false };
  }

  // Extended text (with context/reply)
  if (messageData.extendedTextMessage?.text) {
    return { text: messageData.extendedTextMessage.text, isSystem: false };
  }

  // System messages
  if (messageData.protocolMessage) {
    return { text: '[System message]', isSystem: true };
  }

  // Media messages
  if (messageData.imageMessage) {
    return { text: '[Image]' + (messageData.imageMessage.caption ? ': ' + messageData.imageMessage.caption : ''), isSystem: false };
  }

  if (messageData.videoMessage) {
    return { text: '[Video]' + (messageData.videoMessage.caption ? ': ' + messageData.videoMessage.caption : ''), isSystem: false };
  }

  if (messageData.audioMessage) {
    return { text: '[Voice message]', isSystem: false };
  }

  if (messageData.documentMessage) {
    return { text: '[Document]', isSystem: false };
  }

  return { text: '[Unknown message type]', isSystem: false };
}

/**
 * Group messages by contact
 */
function groupMessagesByContact(messages: Message[]): Map<string, Contact> {
  const contacts = new Map<string, Contact>();

  for (const msg of messages) {
    const phone = msg.remote_jid.replace('@s.whatsapp.net', '').replace('@c.us', '');
    
    if (!contacts.has(phone)) {
      contacts.set(phone, {
        phone,
        name: msg.contact_name,
        messages: [],
        incoming_count: 0,
        outgoing_count: 0,
        first_message: new Date(parseInt(msg.timestamp) * 1000),
        last_message: new Date(parseInt(msg.timestamp) * 1000),
      });
    }

    const contact = contacts.get(phone)!;
    const { text, isSystem } = extractMessageText(msg.message_data);
    const fromMe = String(msg.from_me) === 'true';
    const timestamp = new Date(parseInt(msg.timestamp) * 1000);

    contact.messages.push({
      text,
      from_me: fromMe,
      timestamp,
      is_system: isSystem,
    });

    if (fromMe) {
      contact.outgoing_count++;
    } else {
      contact.incoming_count++;
    }

    // Update name if not set
    if (!contact.name && msg.contact_name) {
      contact.name = msg.contact_name;
    }

    // Update first/last message timestamps
    if (timestamp < contact.first_message) {
      contact.first_message = timestamp;
    }
    if (timestamp > contact.last_message) {
      contact.last_message = timestamp;
    }
  }

  return contacts;
}

/**
 * Format dialog in compact format for LLM
 */
function formatDialogCompact(contact: Contact): string {
  return contact.messages
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
 * Analyze single dialog with GPT-5-mini
 */
async function analyzeDialog(
  contact: Contact,
  personalizedContext: string,
  businessProfileContext: string
): Promise<AnalysisResult> {
  const dialogText = formatDialogCompact(contact);
  
  // Build final prompt with personalized context
  const prompt = BASE_ANALYSIS_PROMPT
    .replace('<<<PERSONALIZED_CONTEXT>>>', personalizedContext)
    .replace('<<<BUSINESS_PROFILE_CONTEXT>>>', businessProfileContext)
    .replace('<<<DIALOG>>>', dialogText);

  log.info({ phone: contact.phone, messageCount: contact.messages.length }, 'Analyzing dialog');

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-5-mini',
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
    log.info({ phone: contact.phone, interest_level: result.interest_level, score: result.score }, 'Dialog analyzed');
    
    return result;
  } catch (error: any) {
    log.error({ error: error.message, phone: contact.phone }, 'Failed to analyze dialog');
    throw error;
  }
}

/**
 * Save new lead (< minIncoming messages) to Supabase without LLM analysis
 */
async function saveNewLead(
  instanceName: string,
  userAccountId: string,
  contact: Contact
) {
  const { error } = await supabase
    .from('dialog_analysis')
    .upsert({
      instance_name: instanceName,
      user_account_id: userAccountId,
      contact_phone: contact.phone,
      contact_name: contact.name,
      incoming_count: contact.incoming_count,
      outgoing_count: contact.outgoing_count,
      first_message: contact.first_message.toISOString(),
      last_message: contact.last_message.toISOString(),
      
      // Set as new lead
      funnel_stage: 'new_lead',
      score: 0,
      
      // Store full conversation
      messages: contact.messages,
      
      analyzed_at: new Date().toISOString(),
    }, {
      onConflict: 'instance_name,contact_phone'
    });

  if (error) {
    log.error({ error: error.message, phone: contact.phone }, 'Failed to save new lead');
    throw error;
  }

  log.info({ phone: contact.phone }, 'New lead saved');
}

/**
 * Save analysis result to Supabase
 */
async function saveAnalysisResult(
  instanceName: string,
  userAccountId: string,
  contact: Contact,
  analysis: AnalysisResult
) {
  const { error } = await supabase
    .from('dialog_analysis')
    .upsert({
      instance_name: instanceName,
      user_account_id: userAccountId,
      contact_phone: contact.phone,
      contact_name: contact.name,
      incoming_count: contact.incoming_count,
      outgoing_count: contact.outgoing_count,
      first_message: contact.first_message.toISOString(),
      last_message: contact.last_message.toISOString(),
      
      // Analysis results
      lead_tags: analysis.lead_tags || [],
      business_type: analysis.business_type,
      is_medical: analysis.is_medical,
      is_owner: analysis.is_owner,
      uses_ads_now: analysis.uses_ads_now,
      has_sales_dept: analysis.has_sales_dept,
      ad_budget: analysis.ad_budget,
      qualification_complete: analysis.qualification_complete,
      has_booking: analysis.has_booking,
      sent_instagram: analysis.sent_instagram,
      instagram_url: analysis.instagram_url,
      funnel_stage: analysis.funnel_stage,
      interest_level: analysis.interest_level.toLowerCase() as 'hot' | 'warm' | 'cold',
      main_intent: analysis.main_intent,
      objection: analysis.objection,
      action: analysis.action,
      score: analysis.score,
      reasoning: analysis.reasoning,
      
      // Store full conversation
      messages: contact.messages,
      
      analyzed_at: new Date().toISOString(),
    }, {
      onConflict: 'instance_name,contact_phone'
    });

  if (error) {
    log.error({ error: error.message, phone: contact.phone }, 'Failed to save analysis');
    throw error;
  }

  log.info({ phone: contact.phone, funnel_stage: analysis.funnel_stage }, 'Analysis saved');
}

/**
 * Main function: Analyze all dialogs for an instance
 */
export async function analyzeDialogs(params: {
  instanceName: string;
  userAccountId: string;
  minIncoming?: number;
  maxDialogs?: number;
  maxContacts?: number;
}) {
  const { instanceName, userAccountId, minIncoming = 3, maxDialogs, maxContacts } = params;

  log.info({ instanceName, userAccountId, minIncoming, maxDialogs, maxContacts }, 'Starting dialog analysis');

  try {
    // Get business profile for personalized context
    const { data: profile } = await supabase
      .from('business_profile')
      .select('*')
      .eq('user_account_id', userAccountId)
      .maybeSingle();

    let personalizedContext = '';
    if (profile?.personalized_context) {
      personalizedContext = formatContextForPrompt(profile.personalized_context as PersonalizedContext);
      log.info({ userAccountId }, 'Using personalized context from profile');
    } else {
      // Use default context
      const defaultContext = getDefaultContext();
      personalizedContext = formatContextForPrompt(defaultContext);
      log.info({ userAccountId }, 'Using default context (no profile found)');
    }

    let businessProfileContext = '';
    if (profile) {
      businessProfileContext = `
КОНТЕКСТ БИЗНЕСА ПОЛЬЗОВАТЕЛЯ:
- Сфера: ${profile.business_industry}
- Описание: ${profile.business_description}
- Целевая аудитория: ${profile.target_audience}
- Задачи: ${profile.main_challenges}
`;
    }

    // ⚡ OPTIMIZED: Get already filtered dialogs from Evolution PostgreSQL
    // Filtering is done at SQL level (10-20x faster than JS)
    const messages = await getFilteredDialogsForAnalysis(instanceName, minIncoming, maxDialogs);
    log.info({ messageCount: messages.length }, '⚡ Retrieved pre-filtered messages from Evolution DB');

    // 📥 Get ALL new leads (< minIncoming messages) to save without analysis
    // БЕЗ ЛИМИТА - это быстро (без GPT анализа), все new leads попадают в CRM
    const newLeadMessages = await getNewLeads(instanceName, minIncoming);
    log.info({ messageCount: newLeadMessages.length }, '📥 Retrieved ALL new leads from Evolution DB');

    // 2. Group by contact
    const contacts = groupMessagesByContact(messages);
    const contactsToAnalyze = Array.from(contacts.values());
    
    const newLeadContacts = groupMessagesByContact(newLeadMessages);
    const newLeadsToSave = Array.from(newLeadContacts.values());
    
    log.info({ 
      contactCount: contacts.size,
      toAnalyze: contactsToAnalyze.length,
      newLeads: newLeadsToSave.length,
      minIncoming,
      maxDialogs: maxDialogs || 'unlimited'
    }, '✅ Dialogs ready for analysis (pre-filtered in SQL)');

    // 3. Save new leads without LLM analysis (fast!)
    for (const contact of newLeadsToSave) {
      try {
        await saveNewLead(instanceName, userAccountId, contact);
      } catch (error: any) {
        log.error({ error: error.message, phone: contact.phone }, 'Failed to save new lead');
      }
    }

    // 4. Analyze contacts (already filtered in SQL)
    const stats = {
      total: contactsToAnalyze.length,
      analyzed: 0,
      new_leads: newLeadsToSave.length,
      hot: 0,
      warm: 0,
      cold: 0,
      errors: 0,
    };

    for (const contact of contactsToAnalyze) {
      try {
        let analysis = await analyzeDialog(contact, personalizedContext, businessProfileContext);
        
        // Post-processing: Check if should be qualified
        if (
          analysis.qualification_complete &&
          analysis.is_owner !== null &&
          analysis.has_sales_dept !== null &&
          analysis.uses_ads_now !== null &&
          analysis.ad_budget !== null &&
          analysis.funnel_stage === 'not_qualified'
        ) {
          analysis.funnel_stage = 'qualified';
          log.info({ phone: contact.phone }, 'Auto-upgraded to qualified stage');
        }
        
        await saveAnalysisResult(instanceName, userAccountId, contact, analysis);
        
        stats.analyzed++;
        if (analysis.interest_level === 'hot') stats.hot++;
        if (analysis.interest_level === 'warm') stats.warm++;
        if (analysis.interest_level === 'cold') stats.cold++;
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error: any) {
        log.error({ error: error.message, phone: contact.phone }, 'Failed to analyze contact');
        stats.errors++;
      }
    }

    log.info(stats, 'Dialog analysis completed');
    return stats;
  } catch (error: any) {
    log.error({ error: error.message }, 'Dialog analysis failed');
    throw error;
  }
}

// CLI execution support
if (import.meta.url === `file://${process.argv[1]}`) {
  const instanceName = process.argv[2];
  const userAccountId = process.argv[3];
  const minIncoming = parseInt(process.argv[4] || '3', 10);
  const maxDialogs = process.argv[5] ? parseInt(process.argv[5], 10) : undefined;
  const maxContacts = process.argv[6] ? parseInt(process.argv[6], 10) : undefined;

  if (!instanceName || !userAccountId) {
    console.error('Usage: tsx src/scripts/analyzeDialogs.ts <instanceName> <userAccountId> [minIncoming] [maxDialogs] [maxContacts]');
    console.error('Example: tsx src/scripts/analyzeDialogs.ts instance_name user_uuid 3 10 100');
    console.error('  - minIncoming: minimum incoming messages to analyze (default: 3)');
    console.error('  - maxDialogs: max dialogs to analyze (default: unlimited)');
    console.error('  - maxContacts: max contacts to load from DB (default: 100)');
    process.exit(1);
  }

  analyzeDialogs({ instanceName, userAccountId, minIncoming, maxDialogs, maxContacts })
    .then(stats => {
      console.log('✅ Analysis completed:', stats);
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Analysis failed:', error);
      process.exit(1);
    });
}


