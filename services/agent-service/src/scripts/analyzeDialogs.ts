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
  "is_owner": boolean | null,
  "uses_ads_now": boolean | null,
  "has_sales_dept": boolean | null,
  "has_booking": boolean,
  "sent_instagram": boolean,
  "interest_level": "hot" | "warm" | "cold",
  "main_intent": "clinic_lead" | "ai_targetolog" | "marketing_analysis" | "other",
  "objection": string | null,
  "next_message": string,
  "action": "want_call" | "want_work" | "reserve" | "none",
  "score": 0-100,
  "reasoning": string
}

Обращай внимание на:
- Тип бизнеса: стоматология/косметология/реабилитация
- Ключевые слова: запись, консультация, цена, стоимость, Instagram
- Возражения: дорого, не подходит, подумаю
- Готовность: записался/спросил когда = hot

next_message: учитывай контекст диалога, персонализируй (до 50 слов), побуждай к действию.

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
  is_owner: boolean | null;
  uses_ads_now: boolean | null;
  has_sales_dept: boolean | null;
  has_booking: boolean;
  sent_instagram: boolean;
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
    const fromMe = msg.from_me === 'true' || msg.from_me === true;
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
      temperature: 0.3,
    });

    const content = response.content || response.choices[0]?.message?.content;
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
      is_owner: analysis.is_owner,
      uses_ads_now: analysis.uses_ads_now,
      has_sales_dept: analysis.has_sales_dept,
      has_booking: analysis.has_booking,
      sent_instagram: analysis.sent_instagram,
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

  log.info({ phone: contact.phone }, 'Analysis saved');
}

/**
 * Main function: Analyze all dialogs for an instance
 */
export async function analyzeDialogs(params: {
  instanceName: string;
  userAccountId: string;
  minIncoming?: number;
}) {
  const { instanceName, userAccountId, minIncoming = 3 } = params;

  log.info({ instanceName, userAccountId, minIncoming }, 'Starting dialog analysis');

  try {
    // 1. Get all messages from Evolution PostgreSQL
    const messages = await getInstanceMessages(instanceName);
    log.info({ messageCount: messages.length }, 'Retrieved messages from Evolution DB');

    // 2. Group by contact
    const contacts = groupMessagesByContact(messages);
    log.info({ contactCount: contacts.size }, 'Grouped messages by contact');

    // 3. Filter contacts with enough incoming messages
    const filteredContacts = Array.from(contacts.values()).filter(
      contact => contact.incoming_count >= minIncoming
    );
    log.info({ 
      totalContacts: contacts.size, 
      filteredContacts: filteredContacts.length,
      minIncoming 
    }, 'Filtered contacts');

    // 4. Analyze each contact
    const stats = {
      total: filteredContacts.length,
      analyzed: 0,
      hot: 0,
      warm: 0,
      cold: 0,
      errors: 0,
    };

    for (const contact of filteredContacts) {
      try {
        const analysis = await analyzeDialog(contact);
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

  if (!instanceName || !userAccountId) {
    console.error('Usage: tsx src/scripts/analyzeDialogs.ts <instanceName> <userAccountId> [minIncoming]');
    process.exit(1);
  }

  analyzeDialogs({ instanceName, userAccountId, minIncoming })
    .then(stats => {
      console.log('✅ Analysis completed:', stats);
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Analysis failed:', error);
      process.exit(1);
    });
}

