import { createClient, SupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import pg from 'pg';
import { pino } from 'pino';

const { Pool } = pg;
const log = pino({ name: 'qualification-sync' });

let supabase: SupabaseClient;
let evoPool: pg.Pool | null = null;

function getSupabase(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    );
  }
  return supabase;
}

function getEvoPool(): pg.Pool | null {
  if (!process.env.EVOLUTION_DB_PASSWORD) return null;
  if (!evoPool) {
    evoPool = new Pool({
      host: process.env.EVOLUTION_DB_HOST || 'evolution-postgres',
      port: parseInt(process.env.EVOLUTION_DB_PORT || '5432', 10),
      user: process.env.EVOLUTION_DB_USER || 'evolution',
      password: process.env.EVOLUTION_DB_PASSWORD,
      database: process.env.EVOLUTION_DB_NAME || 'evolution',
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }
  return evoPool;
}

/**
 * Получить сообщения контакта из Evolution DB (фоллбэк когда messages=null в dialog_analysis).
 */
async function fetchMessagesFromEvolution(
  instanceName: string,
  contactPhone: string
): Promise<DialogToAnalyze['messages']> {
  const pool = getEvoPool();
  if (!pool) return [];

  const remoteJid = `${contactPhone.replace(/\D/g, '')}@s.whatsapp.net`;

  try {
    const result = await pool.query(`
      SELECT
        "key"->>'fromMe' as from_me,
        "message" as message_data,
        "messageTimestamp" as timestamp
      FROM "Message"
      WHERE "instanceId" = (SELECT id FROM "Instance" WHERE name = $1)
        AND "key"->>'remoteJid' = $2
      ORDER BY "messageTimestamp" ASC
      LIMIT 50
    `, [instanceName, remoteJid]);

    return result.rows.map(row => {
      const msgData = row.message_data;
      let content = '';

      if (msgData?.conversation) content = msgData.conversation;
      else if (msgData?.extendedTextMessage?.text) content = msgData.extendedTextMessage.text;
      else if (msgData?.imageMessage?.caption) content = `[Фото] ${msgData.imageMessage.caption}`;
      else if (msgData?.audioMessage) content = '[Голосовое сообщение]';
      else if (msgData?.videoMessage) content = '[Видео]';
      else content = '[Медиа]';

      return {
        role: row.from_me === 'true' ? 'assistant' : 'user',
        content,
        from_me: row.from_me === 'true',
        timestamp: new Date(parseInt(row.timestamp, 10) * 1000).toISOString(),
      };
    });
  } catch (err: any) {
    log.error({ instanceName, contactPhone, err: err.message }, 'Failed to fetch messages from Evolution DB');
    return [];
  }
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 30000,
});

const QUALIFIED_CONFIDENCE_THRESHOLD = parseFloat(process.env.QUALIFIED_CONFIDENCE_THRESHOLD || '0.7');
const PAID_CONFIDENCE_THRESHOLD = parseFloat(process.env.PAID_CONFIDENCE_THRESHOLD || '0.8');
const INTEREST_MSG_THRESHOLD = parseInt(process.env.INTEREST_MSG_THRESHOLD || '3');

interface DialogToAnalyze {
  id: string;
  user_account_id: string;
  account_id: string | null;
  instance_name: string;
  contact_phone: string;
  incoming_count: number;
  outgoing_count: number;
  messages: Array<{ sender?: string; role?: string; content?: string; text?: string; from_me?: boolean; timestamp?: string }>;
  funnel_stage: string | null;
}

interface QualificationResult {
  is_qualified: boolean;
  is_paid: boolean;
  confidence: number;
  paid_confidence: number;
  reasoning: string;
}

/**
 * Получить prompt2 (критерии квалификации) для аккаунта.
 */
async function getQualificationPrompt(userAccountId: string, accountId?: string | null): Promise<string | null> {
  const db = getSupabase();

  if (accountId) {
    const { data } = await db.from('ad_accounts').select('prompt2').eq('id', accountId).single();
    if (data?.prompt2) return data.prompt2;
  }

  const { data } = await db.from('user_accounts').select('prompt2').eq('id', userAccountId).single();
  return data?.prompt2 || null;
}

/**
 * Дефолтный промпт квалификации.
 */
function getDefaultPrompt(): string {
  return `Ты — AI-агент для квалификации лидов в WhatsApp.

Твоя задача — анализировать переписку и определять ДВА статуса:

1. КВАЛИФИКАЦИЯ (is_qualified): клиент ответил на ключевые вопросы и подходит как потенциальный клиент

ПРИЗНАКИ КВАЛИФИЦИРОВАННОГО ЛИДА:
- Ответил на вопрос о своей проблеме/потребности
- Указал, когда хочет получить услугу (сроки)
- Готов обсуждать детали/цены
- Не отказался явно

2. ОПЛАТА (is_paid): клиент оплатил, забронировал или записался на ключевой этап воронки

ПРИЗНАКИ ОПЛАТЫ:
- Клиент прислал скриншот оплаты / чек
- Клиент написал "оплатил", "перевёл", "забронировал"
- Менеджер подтвердил получение оплаты
- Клиент назначил точную дату/время визита и подтвердил запись
- Есть явное подтверждение сделки от обеих сторон

ВАЖНО:
- Будь консервативен — только если есть явные признаки
- is_paid требует БОЛЕЕ строгих доказательств чем is_qualified
- Если клиент только обсуждает цену — это НЕ оплата`;
}

/**
 * Форматирует сообщения для LLM анализа.
 */
function formatMessages(messages: DialogToAnalyze['messages']): string {
  if (!messages || messages.length === 0) return '(пустая переписка)';

  return messages.map(m => {
    // Поддерживаем разные форматы сообщений из dialog_analysis
    let role: string;
    if (m.sender === 'user' || m.role === 'user' || m.from_me === false) {
      role = 'Клиент';
    } else {
      role = 'Менеджер/Бот';
    }

    const text = m.content || m.text || '';
    return `${role}: ${text}`;
  }).join('\n');
}

/**
 * Анализирует один диалог через GPT-4o-mini.
 */
async function analyzeDialog(dialog: DialogToAnalyze): Promise<QualificationResult | null> {
  const customPrompt = await getQualificationPrompt(dialog.user_account_id, dialog.account_id);
  const isCustom = !!customPrompt;
  // Если есть кастомный промпт — оборачиваем его, добавляя инструкцию про is_paid
  const systemPrompt = customPrompt
    ? `${customPrompt}\n\nДОПОЛНИТЕЛЬНО — определи факт оплаты (is_paid):\n- is_paid = true если клиент оплатил, забронировал или подтвердил запись\n- Признаки: скриншот оплаты, "оплатил"/"перевёл"/"забронировал", подтверждение менеджера, точная дата визита\n- Будь строг — только явные доказательства оплаты`
    : getDefaultPrompt();

  log.debug({
    dialogId: dialog.id,
    contactPhone: dialog.contact_phone,
    promptType: isCustom ? 'custom+paid_addon' : 'default',
    messageCount: dialog.messages?.length ?? 0,
  }, 'Analyzing dialog');

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Проанализируй следующую WhatsApp-переписку и определи квалификацию лида и факт оплаты:

ИСТОРИЯ ПЕРЕПИСКИ:
${formatMessages(dialog.messages)}

СТАТИСТИКА:
- Сообщений от клиента: ${dialog.incoming_count}
- Сообщений от менеджера/бота: ${dialog.outgoing_count}
- Текущий этап воронки: ${dialog.funnel_stage || 'new_lead'}

Верни JSON:
{
  "is_qualified": boolean,
  "is_paid": boolean,
  "confidence": number,
  "paid_confidence": number,
  "reasoning": string
}

ВАЖНО: Возвращай ТОЛЬКО JSON, без дополнительного текста.`,
        },
      ],
      temperature: 0.1,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content);
    // Fallback для обратной совместимости: если GPT не вернул is_paid (старый prompt2)
    const result: QualificationResult = {
      is_qualified: parsed.is_qualified ?? false,
      is_paid: parsed.is_paid ?? false,
      confidence: parsed.confidence ?? 0,
      paid_confidence: parsed.paid_confidence ?? 0,
      reasoning: parsed.reasoning ?? '',
    };

    log.info({
      dialogId: dialog.id,
      contactPhone: dialog.contact_phone,
      isQualified: result.is_qualified,
      isPaid: result.is_paid,
      confidence: result.confidence,
      paidConfidence: result.paid_confidence,
      reasoning: result.reasoning,
      tokens: response.usage?.total_tokens,
    }, 'Qualification analysis complete');

    return result;
  } catch (err: any) {
    log.error({ dialogId: dialog.id, err: err.message }, 'LLM qualification failed');
    return null;
  }
}

/**
 * Получить все диалоги с активностью за последние 24 часа для аккаунта.
 */
async function getRecentDialogs(userAccountId: string): Promise<DialogToAnalyze[]> {
  const db = getSupabase();
  const hours = parseInt(process.env.QUALIFICATION_WINDOW_HOURS || '48', 10);
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const { data, error } = await db
    .from('dialog_analysis')
    .select('id, user_account_id, account_id, instance_name, contact_phone, incoming_count, outgoing_count, messages, funnel_stage')
    .eq('user_account_id', userAccountId)
    .gte('last_message', since)
    .gt('incoming_count', 0); // Только диалоги с входящими

  if (error) {
    log.error({ userAccountId, error: error.message }, 'Failed to fetch recent dialogs');
    return [];
  }

  return (data || []) as DialogToAnalyze[];
}

/**
 * Обновить is_qualified и is_paid в leads на основе результата анализа.
 * ВАЖНО: is_paid=true необратим — если лид уже оплачен, не понижаем статус.
 * Это защищает от ситуации когда повторный анализ переписки "забывает" факт оплаты.
 */
async function updateLeadStatus(
  userAccountId: string,
  contactPhone: string,
  isQualified: boolean,
  isPaid: boolean
): Promise<void> {
  const db = getSupabase();

  // Если GPT определил is_paid=false, проверяем текущий статус — не понижаем
  if (!isPaid) {
    const { data: existing } = await db
      .from('leads')
      .select('is_paid')
      .eq('user_account_id', userAccountId)
      .eq('chat_id', contactPhone)
      .eq('source_type', 'whatsapp')
      .single();

    if (existing?.is_paid) {
      log.info({ userAccountId, contactPhone }, 'Lead already marked as paid — keeping is_paid=true (irreversible)');
      isPaid = true;
    }
  }

  const { error } = await db
    .from('leads')
    .update({ is_qualified: isQualified, is_paid: isPaid })
    .eq('user_account_id', userAccountId)
    .eq('chat_id', contactPhone)
    .eq('source_type', 'whatsapp');

  if (error) {
    log.error({ userAccountId, contactPhone, error: error.message }, 'Failed to update lead status');
  } else {
    log.debug({ userAccountId, contactPhone, isQualified, isPaid }, 'Lead status updated');
  }
}

/**
 * Прогнать квалификацию для одного аккаунта.
 * Возвращает количество обновлённых лидов.
 */
export async function qualifyAccountDialogs(userAccountId: string): Promise<{ analyzed: number; qualified: number; paid: number }> {
  const dialogs = await getRecentDialogs(userAccountId);

  if (dialogs.length === 0) {
    log.info({ userAccountId }, 'No recent dialogs to analyze');
    return { analyzed: 0, qualified: 0, paid: 0 };
  }

  log.info({ userAccountId, dialogCount: dialogs.length }, 'Starting qualification analysis');

  let analyzed = 0;
  let qualified = 0;
  let paid = 0;

  for (const dialog of dialogs) {
    // Если messages пусто — фоллбэк на Evolution DB
    if (!dialog.messages || dialog.messages.length === 0) {
      if (dialog.instance_name) {
        log.info({ dialogId: dialog.id, contactPhone: dialog.contact_phone }, 'Messages empty, fetching from Evolution DB');
        dialog.messages = await fetchMessagesFromEvolution(dialog.instance_name, dialog.contact_phone);
      }
    }

    if (!dialog.messages || dialog.messages.length === 0) continue;

    const result = await analyzeDialog(dialog);
    if (!result) continue;

    analyzed++;

    const isQualified = result.is_qualified && result.confidence >= QUALIFIED_CONFIDENCE_THRESHOLD;
    const isPaid = result.is_paid && result.paid_confidence >= PAID_CONFIDENCE_THRESHOLD;

    await updateLeadStatus(dialog.user_account_id, dialog.contact_phone, isQualified, isPaid);

    if (isQualified) qualified++;
    if (isPaid) paid++;

    // Пауза между запросами к OpenAI (rate limit)
    await new Promise(r => setTimeout(r, 500));
  }

  log.info({ userAccountId, analyzed, qualified, paid, total: dialogs.length }, 'Qualification analysis complete');
  return { analyzed, qualified, paid };
}

/**
 * Прогнать квалификацию для всех аккаунтов с wwebjs.
 */
export async function runQualificationSync(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    log.warn('OPENAI_API_KEY not set — qualification sync disabled');
    return;
  }

  const db = getSupabase();

  // Обратная совместимость: ищем аккаунты с новым ИЛИ старым полем
  const { data: accounts, error } = await db
    .from('user_accounts')
    .select('id')
    .or('wwebjs_label_id.not.is.null,wwebjs_label_id_lead.not.is.null');

  if (error || !accounts?.length) {
    if (error) log.error({ error: error.message }, 'Failed to fetch accounts');
    log.info('No wwebjs-enabled accounts for qualification');
    return;
  }

  log.info({ accountCount: accounts.length }, 'Starting qualification sync for all accounts');

  let totalAnalyzed = 0;
  let totalQualified = 0;
  let totalPaid = 0;

  for (const account of accounts) {
    try {
      const result = await qualifyAccountDialogs(account.id);
      totalAnalyzed += result.analyzed;
      totalQualified += result.qualified;
      totalPaid += result.paid;
    } catch (err: any) {
      log.error({ userAccountId: account.id, err: err.message }, 'Account qualification failed');
    }
  }

  log.info({ totalAnalyzed, totalQualified, totalPaid, accountCount: accounts.length }, 'Qualification sync finished');
}
