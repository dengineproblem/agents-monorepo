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
  "client_name": string | null,
  "lead_tags": string[],
  "business_type": string | null,
  "is_owner": boolean | null,
  "qualification_complete": boolean,
  "funnel_stage": "not_qualified" | "qualified" | "consultation_booked" | "consultation_completed" | "deal_closed" | "deal_lost",
  "is_on_key_stage": boolean,
  "interest_level": "hot" | "warm" | "cold",
  "main_intent": "purchase" | "inquiry" | "support" | "consultation" | "other",
  "objection": string | null,
  "action": "want_call" | "want_work" | "reserve" | "none",
  "score": 0-100,
  "reasoning": string,
  "custom_fields": Record<string, any> | null,

  "last_unanswered_message": string | null,
  "drop_point": string | null,
  "hidden_objections": string[],
  "engagement_trend": "falling" | "stable" | "rising"
}

CLIENT_NAME - ВАЛИДАЦИЯ ИМЕНИ ИЗ WHATSAPP:
Имя клиента в WhatsApp (если указано ниже) нужно ВАЛИДИРОВАТЬ:

ПРАВИЛА ВАЛИДАЦИИ:
1. Если имя из WhatsApp действительно является настоящим человеческим именем - сохрани его в "client_name"
2. Если имя НЕ является настоящим именем (см. критерии ниже) - ищи реальное имя в истории переписки
3. Если имя найдено в переписке - верни его в "client_name"
4. Если имя не найдено нигде - верни null в "client_name"

КРИТЕРИИ "НЕ ЯВЛЯЕТСЯ ИМЕНЕМ":
- Длина меньше 2 символов (например: "R", "A")
- Только инициалы - 2-3 заглавные буквы подряд (например: "RS", "AB", "IVA")
- Содержит цифры (например: "User123", "Alex99")
- Содержит спецсимволы кроме дефиса и апострофа (например: "Test@", "User#1")
- Общие слова не являющиеся именами (например: "Test", "User", "Client", "Me", "Unknown")
- Набор случайных букв, не похожий на имя (например: "Abc", "Xyz", "Qwerty")

ПРИМЕРЫ ВАЛИДНЫХ ИМЕН (сохранить как есть):
- "Иван", "Мария", "Александр"
- "John", "Sarah", "Mohammed"
- "Анна-Мария", "O'Brien"

ПРИМЕРЫ НЕВАЛИДНЫХ ИМЕН (искать в переписке):
- "Rs", "AB", "IVA" (инициалы)
- "Test", "User", "Client" (общие слова)
- "User123", "Alex99" (содержат цифры)
- "R", "A", "Z" (слишком короткие)

ПОИСК ИМЕНИ В ПЕРЕПИСКЕ:
Если имя из WhatsApp невалидное, проанализируй переписку:
- Клиент мог представиться: "Меня зовут Иван", "Я Александр", "Это Мария"
- Агент мог обратиться по имени, и клиент подтвердил
- Имя могло быть упомянуто в контексте записи или документов

ВАЖНО: Если ты не уверен или в переписке нет четкого упоминания имени - лучше вернуть null.

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

КЛЮЧЕВЫЕ ЭТАПЫ (важно для отслеживания):
Если в контексте указаны КЛЮЧЕВЫЕ ЭТАПЫ ВОРОНКИ, и лид находится на одном из них, установи "is_on_key_stage": true.
Ключевые этапы - это важные моменты (например: "Запись на консультацию", "Ожидание визита"), где лида НЕ нужно беспокоить рассылками.

ДОПОЛНИТЕЛЬНЫЕ МОДИФИКАТОРЫ СКОРИНГА:
- Совпадение с идеальным профилем клиента: +10-20
- Совпадение с non-target профилем: -20-30
- Упоминание болей клиента: +5-10 за каждую
- Позитивные сигналы (фразы интереса): +5 за каждую
- Негативные сигналы (возражения): -10 за каждое
- Быстро отвечает: +5
- Долго не отвечает: -15

Interest level (финальный): HOT(75-100), WARM(40-74), COLD(0-39)

АНАЛИЗ DROP POINTS И СКРЫТЫХ ВОЗРАЖЕНИЙ (ВАЖНО!):

1. LAST_UNANSWERED_MESSAGE:
   - Если ПОСЛЕДНЕЕ сообщение в диалоге ОТ АГЕНТА (A:) и клиент НЕ ответил:
     → Укажи текст этого сообщения в "last_unanswered_message"
     → Это точка где "застряла" продажа
   - Если последнее сообщение от клиента → null

2. DROP_POINT:
   - Если есть last_unanswered_message, опиши на КАКОМ ЭТАПЕ клиент "отвалился":
     → "Вопрос о встрече - клиент не готов к офлайн контакту"
     → "Вопрос о цене - клиент ушёл думать"
     → "Запрос контактных данных - клиент не готов делиться"
     → "Предложение консультации - нет интереса"
   - Если нет drop point → null

3. HIDDEN_OBJECTIONS (массив скрытых возражений):
   Ищи следующие СКРЫТЫЕ сигналы потери интереса:

   a) ОДНОСЛОЖНЫЕ ОТВЕТЫ после важных вопросов агента:
      - "да", "ок", "понял", "хорошо" без дополнительных вопросов
      → "Односложный ответ после вопроса о [тема]"

   b) ИГНОРИРОВАНИЕ ВОПРОСОВ агента:
      - Агент задал вопрос, клиент не ответил на него напрямую
      → "Проигнорировал вопрос о [тема]"

   c) ОТСУТСТВИЕ СВОИХ ВОПРОСОВ:
      - Клиент только отвечает, не задаёт уточняющих вопросов
      → "Не задаёт вопросов - низкий интерес"

   d) ДОЛГИЕ ПАУЗЫ между сообщениями клиента (12+ часов):
      → "Долгая пауза перед ответом на [тема]"

   e) СОКРАЩЕНИЕ ДЛИНЫ ответов к концу диалога:
      → "Ответы становятся короче"

   Если нет скрытых возражений → пустой массив []

4. ENGAGEMENT_TREND:
   Определи ТРЕНД интереса клиента по ходу диалога:

   - "rising" (растёт): клиент задаёт больше вопросов, ответы становятся длиннее,
     проявляет инициативу, отвечает быстрее

   - "falling" (падает): ответы становятся короче, односложные ответы,
     долгие паузы, игнорирование вопросов

   - "stable" (стабильный): равномерная активность на протяжении диалога

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

ИМЯ КЛИЕНТА ИЗ WHATSAPP: <<<CONTACT_NAME_FROM_WHATSAPP>>>

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
  client_name: string | null;
  lead_tags: string[];
  business_type: string | null;
  is_owner: boolean | null;
  qualification_complete: boolean;
  funnel_stage: 'not_qualified' | 'qualified' | 'consultation_booked' | 'consultation_completed' | 'deal_closed' | 'deal_lost';
  interest_level: 'hot' | 'warm' | 'cold';
  main_intent: 'purchase' | 'inquiry' | 'support' | 'consultation' | 'other';
  objection: string | null;
  action: 'want_call' | 'want_work' | 'reserve' | 'none';
  score: number;
  reasoning: string;
  custom_fields: Record<string, any> | null;
  // Новые поля для расширенного анализа
  last_unanswered_message: string | null;
  drop_point: string | null;
  hidden_objections: string[];
  engagement_trend: 'falling' | 'stable' | 'rising';
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
    const phone = msg.remote_jid
      .replace('@s.whatsapp.net', '')
      .replace('@c.us', '')
      .replace('@g.us', '');  // ← Groups too!
    
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
    .replace('<<<CONTACT_NAME_FROM_WHATSAPP>>>', contact.name || 'не указано')
    .replace('<<<DIALOG>>>', dialogText);

  log.info({ phone: contact.phone, messageCount: contact.messages.length, whatsappName: contact.name }, 'Analyzing dialog');

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
 * Get list of contact phones that already exist in CRM for this instance
 * Uses pagination to fetch ALL contacts (Supabase has 1000 default limit per request)
 */
async function getExistingContactPhones(instanceName: string): Promise<string[]> {
  const startTime = Date.now();
  const PAGE_SIZE = 1000;
  let allPhones: string[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    
    const { data, error, count } = await supabase
      .from('dialog_analysis')
      .select('contact_phone', { count: page === 0 ? 'exact' : undefined })
      .eq('instance_name', instanceName)
      .range(from, to);

    if (error) {
      log.error({ error: error.message, page }, 'Failed to get existing contacts');
      break;
    }

    if (data && data.length > 0) {
      allPhones.push(...data.map(row => row.contact_phone));
      hasMore = data.length === PAGE_SIZE;
      page++;
      
      if (page === 1 && count) {
        log.info({ 
          totalInDb: count,
          estimatedPages: Math.ceil(count / PAGE_SIZE) 
        }, 'Starting pagination of existing contacts');
      }
    } else {
      hasMore = false;
    }
  }

  const duration = Date.now() - startTime;
  log.info({ 
    count: allPhones.length,
    pages: page,
    duration: `${duration}ms`
  }, 'Retrieved ALL existing contact phones from CRM');
  
  return allPhones;
}

/**
 * Helper to chunk array into smaller arrays
 */
function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Analyze and save a single contact (for parallel processing)
 */
async function analyzeAndSaveContact(
  contact: Contact,
  instanceName: string,
  userAccountId: string,
  personalizedContext: string,
  businessProfileContext: string,
  keyFunnelStages: string[] = []
): Promise<{
  success: boolean;
  phone: string;
  analysis?: AnalysisResult;
  error?: string;
}> {
  try {
    let analysis = await analyzeDialog(contact, personalizedContext, businessProfileContext);
    
    // Post-processing: Check if should be qualified
    if (
      analysis.qualification_complete &&
      analysis.is_owner !== null &&
      analysis.funnel_stage === 'not_qualified'
    ) {
      analysis.funnel_stage = 'qualified';
      log.info({ phone: contact.phone }, 'Auto-upgraded to qualified stage');
    }
    
    await saveAnalysisResult(instanceName, userAccountId, contact, analysis, keyFunnelStages);
    
    return {
      success: true,
      phone: contact.phone,
      analysis
    };
  } catch (error: any) {
    log.error({ error: error.message, phone: contact.phone }, 'Failed to analyze contact');
    return {
      success: false,
      phone: contact.phone,
      error: error.message
    };
  }
}

/**
 * Save analysis result to Supabase
 */
async function saveAnalysisResult(
  instanceName: string,
  userAccountId: string,
  contact: Contact,
  analysis: AnalysisResult,
  keyFunnelStages: string[] = []
) {
  // Get existing record to track stage changes
  const { data: existingLead } = await supabase
    .from('dialog_analysis')
    .select('funnel_stage, is_on_key_stage, key_stage_entered_at, key_stage_left_at, funnel_stage_history')
    .eq('instance_name', instanceName)
    .eq('contact_phone', contact.phone)
    .maybeSingle();

  const oldStage = existingLead?.funnel_stage;
  const newStage = analysis.funnel_stage;
  const now = new Date().toISOString();

  // Determine if on key stage
  const isOnKeyStage = keyFunnelStages.includes(newStage);
  
  // Track stage transitions
  let keyStageEnteredAt = existingLead?.key_stage_entered_at;
  let keyStageLeftAt = existingLead?.key_stage_left_at;
  let funnelStageHistory = existingLead?.funnel_stage_history || [];

  // If stage changed, update history and key stage tracking
  if (oldStage && oldStage !== newStage) {
    // Add to history
    funnelStageHistory = [
      ...funnelStageHistory,
      { stage: newStage, timestamp: now, previous_stage: oldStage }
    ];

    const wasOnKeyStage = keyFunnelStages.includes(oldStage);
    
    // Entering a key stage
    if (isOnKeyStage && !wasOnKeyStage) {
      keyStageEnteredAt = now;
      keyStageLeftAt = null;
    }
    // Leaving a key stage
    else if (!isOnKeyStage && wasOnKeyStage) {
      keyStageLeftAt = now;
      keyStageEnteredAt = null;
    }
  }
  // First time on key stage
  else if (!oldStage && isOnKeyStage) {
    keyStageEnteredAt = now;
  }

  const { error } = await supabase
    .from('dialog_analysis')
    .upsert({
      instance_name: instanceName,
      user_account_id: userAccountId,
      contact_phone: contact.phone,
      contact_name: analysis.client_name, // Use validated name from LLM
      incoming_count: contact.incoming_count,
      outgoing_count: contact.outgoing_count,
      first_message: contact.first_message.toISOString(),
      last_message: contact.last_message.toISOString(),
      
      // Analysis results
      lead_tags: analysis.lead_tags || [],
      business_type: analysis.business_type,
      is_owner: analysis.is_owner,
      qualification_complete: analysis.qualification_complete,
      funnel_stage: newStage,
      is_on_key_stage: isOnKeyStage,
      key_stage_entered_at: keyStageEnteredAt,
      key_stage_left_at: keyStageLeftAt,
      funnel_stage_history: funnelStageHistory,
      interest_level: analysis.interest_level.toLowerCase() as 'hot' | 'warm' | 'cold',
      main_intent: analysis.main_intent,
      objection: analysis.objection,
      action: analysis.action,
      score: analysis.score,
      reasoning: analysis.reasoning,
      custom_fields: analysis.custom_fields || null,

      // Новые поля для расширенного анализа
      last_unanswered_message: analysis.last_unanswered_message || null,
      drop_point: analysis.drop_point || null,
      hidden_objections: analysis.hidden_objections || [],
      engagement_trend: analysis.engagement_trend || null,

      // Store full conversation
      messages: contact.messages,

      analyzed_at: now,
    }, {
      onConflict: 'instance_name,contact_phone',
      ignoreDuplicates: false  // Allow updates
    });

  if (error) {
    log.error({ error: error.message, phone: contact.phone }, 'Failed to save analysis');
    throw error;
  }

  log.info({ 
    phone: contact.phone,
    whatsappName: contact.name,
    validatedName: analysis.client_name,
    funnel_stage: newStage,
    is_on_key_stage: isOnKeyStage,
    stage_changed: oldStage !== newStage
  }, 'Analysis saved');
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
  startDate?: Date;
  endDate?: Date;
}) {
  const { instanceName, userAccountId, minIncoming = 3, maxDialogs, maxContacts, startDate, endDate } = params;

  log.info({ instanceName, userAccountId, minIncoming, maxDialogs, maxContacts }, 'Starting dialog analysis');

  try {
    // Get business profile for personalized context
    const { data: profile } = await supabase
      .from('business_profile')
      .select('*')
      .eq('user_account_id', userAccountId)
      .maybeSingle();

    let personalizedContext = '';
    let keyFunnelStages: string[] = [];
    
    if (profile?.personalized_context) {
      personalizedContext = formatContextForPrompt(profile.personalized_context as PersonalizedContext);
      keyFunnelStages = profile.key_funnel_stages || [];
      log.info({ userAccountId, keyStagesCount: keyFunnelStages.length }, 'Using personalized context from profile');
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

    // 🔍 Get list of already existing contacts in CRM to exclude them
    const existingPhones = await getExistingContactPhones(instanceName);
    
    // ⚠️ IMPORTANT: Evolution DB stores phones with suffixes:
    // - Individual: "77xxx@s.whatsapp.net" or "77xxx@c.us"
    // - Group chats: "120363313310752475@g.us"
    // We store them WITHOUT suffix in Supabase, so need to convert for SQL matching!
    const existingPhonesWithSuffix = existingPhones.flatMap(phone => [
      `${phone}@s.whatsapp.net`,
      `${phone}@c.us`,
      `${phone}@g.us`  // ← Groups!
    ]);
    
    log.info({ 
      existingCount: existingPhones.length,
      withSuffixes: existingPhonesWithSuffix.length  // x3 for each suffix type
    }, '🔍 Excluding existing contacts (individuals + groups) from analysis');

    // ⚡ OPTIMIZED: Get already filtered dialogs from Evolution PostgreSQL
    // Filtering is done at SQL level (10-20x faster than JS)
    // EXCLUDES already analyzed contacts
    const messages = await getFilteredDialogsForAnalysis(instanceName, minIncoming, maxDialogs, existingPhonesWithSuffix, startDate, endDate);
    log.info({ messageCount: messages.length }, '⚡ Retrieved pre-filtered messages from Evolution DB');

    // 📥 Get ONLY NEW leads (< minIncoming messages) to save without analysis
    // EXCLUDES leads that already exist in CRM - saves time and DB operations!
    const newLeadMessages = await getNewLeads(instanceName, minIncoming, existingPhonesWithSuffix);
    log.info({ messageCount: newLeadMessages.length }, '📥 Retrieved NEW leads only from Evolution DB');

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

    // 3. Save new leads without LLM analysis in batches (FAST!)
    const BATCH_SIZE = 100;
    let savedCount = 0;
    
    for (let i = 0; i < newLeadsToSave.length; i += BATCH_SIZE) {
      const batch = newLeadsToSave.slice(i, i + BATCH_SIZE);
      
      try {
        const records = batch.map(contact => ({
          instance_name: instanceName,
          user_account_id: userAccountId,
          contact_phone: contact.phone,
          contact_name: contact.name,
          incoming_count: contact.incoming_count,
          outgoing_count: contact.outgoing_count,
          first_message: contact.first_message.toISOString(),
          last_message: contact.last_message.toISOString(),
          funnel_stage: 'new_lead',
          score: 0,
          messages: contact.messages,
          analyzed_at: new Date().toISOString(),
        }));

        const { error } = await supabase
          .from('dialog_analysis')
          .upsert(records, {
            onConflict: 'instance_name,contact_phone',
            ignoreDuplicates: true
          });

        if (error) {
          log.error({ error: error.message, batchSize: batch.length }, 'Failed to save batch of new leads');
        } else {
          savedCount += batch.length;
          log.info({ 
            batchNumber: Math.floor(i / BATCH_SIZE) + 1,
            batchSize: batch.length,
            totalSaved: savedCount,
            remaining: newLeadsToSave.length - savedCount
          }, 'Batch of new leads saved');
        }
      } catch (error: any) {
        log.error({ error: error.message, batchSize: batch.length }, 'Exception saving new leads batch');
      }
    }
    
    log.info({ totalSaved: savedCount, total: newLeadsToSave.length }, '✅ All new leads saved in batches');

    // 4. Analyze contacts in parallel (MUCH FASTER!)
    const stats = {
      total: contactsToAnalyze.length,
      analyzed: 0,
      new_leads: savedCount,
      hot: 0,
      warm: 0,
      cold: 0,
      errors: 0,
    };

    const PARALLEL_LIMIT = 5; // Process 5 contacts simultaneously
    const chunks = chunkArray(contactsToAnalyze, PARALLEL_LIMIT);
    
    log.info({ 
      totalContacts: contactsToAnalyze.length, 
      parallelLimit: PARALLEL_LIMIT,
      chunks: chunks.length 
    }, '🚀 Starting parallel analysis');

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      
      log.info({ 
        chunkNumber: chunkIndex + 1, 
        totalChunks: chunks.length,
        chunkSize: chunk.length 
      }, 'Processing chunk in parallel');

      // Process chunk in parallel
      const promises = chunk.map(contact => 
        analyzeAndSaveContact(
          contact,
          instanceName,
          userAccountId,
          personalizedContext,
          businessProfileContext,
          keyFunnelStages
        )
      );

      const results = await Promise.allSettled(promises);

      // Process results
      for (const result of results) {
        if (result.status === 'fulfilled') {
          const { success, analysis, error } = result.value;
          
          if (success && analysis) {
            stats.analyzed++;
            if (analysis.interest_level === 'hot') stats.hot++;
            if (analysis.interest_level === 'warm') stats.warm++;
            if (analysis.interest_level === 'cold') stats.cold++;
          } else {
            stats.errors++;
          }
        } else {
          stats.errors++;
          log.error({ error: result.reason }, 'Promise rejected in parallel analysis');
        }
      }

      log.info({ 
        chunkNumber: chunkIndex + 1,
        analyzed: stats.analyzed,
        errors: stats.errors,
        remaining: contactsToAnalyze.length - stats.analyzed - stats.errors
      }, 'Chunk completed');
    }

    log.info(stats, '✅ Dialog analysis completed (parallel)');
    return stats;
  } catch (error: any) {
    log.error({ error: error.message }, 'Dialog analysis failed');
    throw error;
  }
}

/**
 * Reanalyze a single lead with fresh data from Evolution DB
 * This forcefully updates the lead, even if it already exists
 */
export async function reanalyzeSingleLead(params: {
  leadId: string;
  userAccountId: string;
}): Promise<{
  success: boolean;
  lead?: any;
  error?: string;
}> {
  const { leadId, userAccountId } = params;
  
  log.info({ leadId, userAccountId }, 'Starting single lead reanalysis');

  try {
    // 1. Get lead from CRM
    const { data: lead, error: leadError } = await supabase
      .from('dialog_analysis')
      .select('*')
      .eq('id', leadId)
      .eq('user_account_id', userAccountId)
      .single();

    if (leadError || !lead) {
      log.error({ leadId, error: leadError?.message }, 'Lead not found');
      return {
        success: false,
        error: 'Lead not found or access denied'
      };
    }

    // 2. Get business profile for personalized context
    const { data: profile } = await supabase
      .from('business_profile')
      .select('*')
      .eq('user_account_id', userAccountId)
      .maybeSingle();

    let personalizedContext = '';
    if (profile?.personalized_context) {
      personalizedContext = formatContextForPrompt(profile.personalized_context as PersonalizedContext);
    } else {
      const defaultContext = getDefaultContext();
      personalizedContext = formatContextForPrompt(defaultContext);
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

    // 3. Get fresh messages from Evolution DB
    const { getInstanceMessages } = await import('../lib/evolutionDb.js');
    const allMessages = await getInstanceMessages(lead.instance_name);
    
    // Filter messages for this specific contact
    const contactMessages = allMessages.filter((msg: any) => {
      const phone = msg.remote_jid
        .replace('@s.whatsapp.net', '')
        .replace('@c.us', '')
        .replace('@g.us', '');
      return phone === lead.contact_phone;
    });

    if (contactMessages.length === 0) {
      log.warn({ leadId, phone: lead.contact_phone }, 'No messages found in Evolution DB');
      return {
        success: false,
        error: 'No messages found for this contact in Evolution DB'
      };
    }

    // 4. Group and format messages
    const contacts = groupMessagesByContact(contactMessages);
    const contact = contacts.get(lead.contact_phone);

    if (!contact) {
      return {
        success: false,
        error: 'Failed to process contact messages'
      };
    }

    // 5. Analyze dialog
    const analysis = await analyzeDialog(contact, personalizedContext, businessProfileContext);

    // Post-processing: Check if should be qualified
    if (
      analysis.qualification_complete &&
      analysis.is_owner !== null &&
      analysis.funnel_stage === 'not_qualified'
    ) {
      analysis.funnel_stage = 'qualified';
      log.info({ phone: contact.phone }, 'Auto-upgraded to qualified stage');
    }

    // 6. Update lead in CRM (force update with ignoreDuplicates: false)
    const { error: updateError } = await supabase
      .from('dialog_analysis')
      .update({
        contact_name: analysis.client_name, // Use validated name from LLM
        incoming_count: contact.incoming_count,
        outgoing_count: contact.outgoing_count,
        first_message: contact.first_message.toISOString(),
        last_message: contact.last_message.toISOString(),
        
        // Analysis results
        lead_tags: analysis.lead_tags || [],
        business_type: analysis.business_type,
        is_owner: analysis.is_owner,
        qualification_complete: analysis.qualification_complete,
        funnel_stage: analysis.funnel_stage,
        interest_level: analysis.interest_level.toLowerCase() as 'hot' | 'warm' | 'cold',
        main_intent: analysis.main_intent,
        objection: analysis.objection,
        action: analysis.action,
        score: analysis.score,
        reasoning: analysis.reasoning,
        custom_fields: analysis.custom_fields || null,
        
        // Store full conversation
        messages: contact.messages,
        
        analyzed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', leadId);

    if (updateError) {
      log.error({ error: updateError.message, leadId }, 'Failed to update lead');
      throw updateError;
    }

    log.info({ 
      leadId, 
      phone: lead.contact_phone,
      whatsappName: contact.name,
      validatedName: analysis.client_name,
      oldScore: lead.score,
      newScore: analysis.score,
      oldStage: lead.funnel_stage,
      newStage: analysis.funnel_stage
    }, 'Lead reanalyzed successfully');

    return {
      success: true,
      lead: {
        id: leadId,
        contact_phone: lead.contact_phone,
        contact_name: analysis.client_name,
        funnel_stage: analysis.funnel_stage,
        interest_level: analysis.interest_level,
        score: analysis.score,
      }
    };
  } catch (error: any) {
    log.error({ error: error.message, leadId }, 'Lead reanalysis failed');
    return {
      success: false,
      error: error.message
    };
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


