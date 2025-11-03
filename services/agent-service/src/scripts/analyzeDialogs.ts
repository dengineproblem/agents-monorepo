import { OpenAI } from 'openai';
import { getInstanceMessages } from '../lib/evolutionDb.js';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger({ module: 'analyzeDialogs' });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!
});

// Промпт для GPT-5-mini
const ANALYSIS_PROMPT = `Ты — Динар, менеджер Performante (маркетинг для клиник).

Проанализируй диалог WhatsApp. Формат:

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

КВАЛИФИКАЦИОННЫЕ ВОПРОСЫ (4 вопроса):
1. is_owner - Владелец бизнеса?
2. has_sales_dept - Есть отдел продаж?
3. uses_ads_now - Запускает ли рекламу?
4. ad_budget - Бюджет на рекламу (текст: "50000", "100-200к", "не сказал" или null)

qualification_complete = true ТОЛЬКО если ВСЕ 4 поля выше заполнены (не null).

ЭТАПЫ ВОРОНКИ (определи правильный этап):
- "not_qualified" - НЕ ответил на все 4 квалификационных вопроса
- "qualified" - ОТВЕТИЛ на все 4 вопроса, но еще не записан
- "consultation_booked" - Записан на консультацию (есть дата/время или подтверждение)
- "consultation_completed" - Консультация состоялась
- "deal_closed" - Согласился работать, подписал договор, оплатил
- "deal_lost" - Отказался, не подошло, пропал, не отвечает

СИСТЕМА СКОРИНГА (строго следуй правилам):

=== БАЗОВЫЙ SCORE по этапу воронки ===
- new_lead: 5 баллов (базовый)
- not_qualified: 15 баллов (+10)
- qualified: 30 баллов (+15)
- consultation_booked: 40 баллов (+10)
- consultation_completed: 55 баллов (+15)
- deal_closed: 75 баллов (+20)
- deal_lost: 0 баллов

=== ОПРЕДЕЛЕНИЕ МЕДИЦИНСКОЙ НИШИ (is_medical) ===

is_medical = true если бизнес относится к:
- Стоматология, стоматологические клиники
- Косметология, косметологические клиники
- Медицинские клиники любого профиля
- Медицинские центры
- Реабилитационные центры
- Физиотерапия
- Wellness центры с медицинским уклоном
- Пластическая хирургия
- Лазерная медицина
- Любые медицинские услуги

is_medical = false для всех остальных (салоны красоты, SPA, фитнес, инфобизнес и т.д.)

=== МОДИФИКАТОРЫ НИШИ (критично важно!) ===

ЦЕЛЕВЫЕ НИШИ (+баллы):
+ Медицина (is_medical = true): +15
+ Инфобизнес (курсы, обучение, коучинг, тренинги): +10
+ Салоны красоты, SPA, фитнес: +10

НЕ ЦЕЛЕВЫЕ НИШИ (-баллы):
- Таргетологи, SMM-специалисты, маркетологи: -30 (НЕ наша аудитория!)
- Агентства (конкуренты): -25
- Фриланс услуги (дизайн, разработка, копирайтинг): -15
- Розничная торговля товарами: -10

=== МОДИФИКАТОРЫ ПОВЕДЕНИЯ ===

ПЛЮСЫ (+баллы):
+ Владелец бизнеса (is_owner = true): +10
+ Указал бюджет (ad_budget): +10
+ Бюджет >100к: +5 дополнительно
+ Активно задает вопросы про результаты/кейсы: +10
+ Отправил Instagram: +5
+ Быстро отвечает (<1 часа между сообщениями): +5
+ Говорит "хочу записаться", "когда можно", называет время: +20
+ Спрашивает про гарантии/как работаете: +5

МИНУСЫ (-баллы):
- Возражения ("дорого", "не подходит", "не уверен"): -15
- "Подумаю", "потом перезвоню", "посоветуюсь": -20
- Не владелец, есть отдел продаж: -5
- Нет бюджета на рекламу: -10
- Долго не отвечает (>24 часа): -15
- Односложные ответы ("да", "ок"): -10
- Игнорирует вопросы агента: -20
- Просто спрашивает цены: 0 (нейтрально, базовый вопрос)

=== INTEREST LEVEL (по итоговому score) ===

HOT (75-100): 
ТОЛЬКО если записан на консультацию ИЛИ прямо сейчас готов записаться ИЛИ сделка закрыта.
Признаки: конкретные действия, называет время, подтверждает встречу.

WARM (40-74):
Есть интерес, но НЕ готов записаться. Задает вопросы, но откладывает решение.
"Подумаю", "перезвоню" = максимум WARM.

COLD (0-39):
Слабый интерес, не целевая ниша, возражения, пропал, отказался.
Таргетолог/агентство = автоматически максимум WARM (даже если интерес есть).

=== ПРАВИЛА ===
1. HOT ТОЛЬКО если ЗАПИСАЛСЯ или ПРЯМО СЕЙЧАС готов
2. Вопрос про цены = 0 баллов (нейтрально)
3. Таргетолог/SMM = максимум WARM, даже с интересом
4. "Подумаю" = НИКОГДА не HOT
5. Нет конкретных действий = не HOT

ПРИМЕРЫ РАСЧЕТА SCORE:

Пример 1: Стоматология, прошел консультацию, владелец
= 55 (consultation_completed) + 15 (is_medical) + 10 (is_owner) = 80 → HOT

Пример 2: Салон красоты, прошел консультацию
= 55 (consultation_completed) + 10 (салон) = 65 → WARM

Пример 3: Инфобизнес, записан на консультацию
= 40 (consultation_booked) + 10 (инфобизнес) = 50 → WARM

Пример 4: Таргетолог, квалифицирован
= 30 (qualified) - 30 (таргетолог) = 0 → COLD

ИНСТРУКЦИИ:
- instagram_url: извлеки ссылку (instagram.com/username, @username)
- ad_budget: извлеки сумму ("50 тысяч", "100-200к")
- Определи этап воронки
- Рассчитай score: базовый + модификаторы ниши + модификаторы поведения
- interest_level определи строго по итоговому score
- next_message: персонализируй (до 50 слов), побуждай к следующему шагу

Диалог:

<<<DIALOG>>>`;

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
async function analyzeDialog(contact: Contact): Promise<AnalysisResult> {
  const dialogText = formatDialogCompact(contact);
  const prompt = ANALYSIS_PROMPT.replace('<<<DIALOG>>>', dialogText);

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
      next_message: 'Новый лид, требуется первый контакт',
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
      interest_level: analysis.interest_level,
      main_intent: analysis.main_intent,
      objection: analysis.objection,
      next_message: analysis.next_message,
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
    // 1. Get messages from Evolution PostgreSQL (limited to top N most active contacts)
    const messages = await getInstanceMessages(instanceName, maxContacts);
    log.info({ messageCount: messages.length, maxContacts }, 'Retrieved messages from Evolution DB');

    // 2. Group by contact
    const contacts = groupMessagesByContact(messages);
    log.info({ contactCount: contacts.size }, 'Grouped messages by contact');

    // 3. Separate new leads (< minIncoming) and contacts to analyze (>= minIncoming)
    const allContacts = Array.from(contacts.values());
    const newLeads = allContacts.filter(contact => contact.incoming_count < minIncoming);
    let contactsToAnalyze = allContacts.filter(contact => contact.incoming_count >= minIncoming);
    
    // Limit number of dialogs if maxDialogs is specified
    if (maxDialogs && maxDialogs > 0) {
      contactsToAnalyze = contactsToAnalyze.slice(0, maxDialogs);
      log.info({ maxDialogs }, 'Limiting analysis to specified number of dialogs');
    }
    
    log.info({ 
      totalContacts: contacts.size,
      newLeads: newLeads.length,
      toAnalyze: contactsToAnalyze.length,
      minIncoming,
      maxDialogs: maxDialogs || 'unlimited'
    }, 'Contacts categorized');

    // 4. Save new leads without LLM analysis
    for (const contact of newLeads) {
      try {
        await saveNewLead(instanceName, userAccountId, contact);
      } catch (error: any) {
        log.error({ error: error.message, phone: contact.phone }, 'Failed to save new lead');
      }
    }

    // 5. Analyze contacts with enough messages
    const stats = {
      total: contactsToAnalyze.length,
      analyzed: 0,
      new_leads: newLeads.length,
      hot: 0,
      warm: 0,
      cold: 0,
      errors: 0,
    };

    for (const contact of contactsToAnalyze) {
      try {
        let analysis = await analyzeDialog(contact);
        
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

