import { supabase } from './supabase.js';
import { sendWhatsAppMessage } from './whatsapp.js';
import { format } from 'date-fns';
import ru from 'date-fns/locale/ru/index.js';

/**
 * Очистить телефон от невидимых unicode символов
 */
function sanitizePhoneNumber(phone: string): string {
  // Удаляем все невидимые символы (RTL marks, zero-width spaces, и т.д.)
  // Оставляем только цифры, +, -, (, ), пробелы
  return phone
    .replace(/[\u200B-\u200D\uFEFF\u202A-\u202E]/g, '') // Удаляем невидимые символы
    .replace(/[^\d+\-() ]/g, '') // Оставляем только допустимые символы
    .trim();
}

/**
 * Получить WhatsApp instance для отправки
 * @exported используется также в consultantMessages.ts
 */
export async function getInstanceName(
  userAccountId: string,
  dialogAnalysisId?: string
): Promise<string | null> {
  // Если есть dialog_analysis_id - берём инстанс оттуда
  if (dialogAnalysisId) {
    const { data: dialog } = await supabase
      .from('dialog_analysis')
      .select('instance_name')
      .eq('id', dialogAnalysisId)
      .single();

    if (dialog?.instance_name) {
      return dialog.instance_name;
    }
  }

  // Fallback: первый активный connected инстанс пользователя
  const { data: instance } = await supabase
    .from('whatsapp_instances')
    .select('instance_name')
    .eq('user_account_id', userAccountId)
    .eq('status', 'connected')
    .limit(1)
    .single();

  return instance?.instance_name || null;
}

/**
 * Отправляет WhatsApp уведомление консультанту о новой консультации
 */
export async function notifyConsultantAboutNewConsultation(
  consultationId: string
): Promise<void> {
  try {
    process.stderr.write(`[CONSULTANT_NOTIFICATION] START: consultationId=${consultationId}\n`);

    // 1. Получить полную информацию о консультации
    const { data: consultation, error: consultationError } = await supabase
      .from('consultations')
      .select(`
        *,
        consultant:consultants!inner(id, name, phone, parent_user_account_id),
        service:consultation_services(name)
      `)
      .eq('id', consultationId)
      .single();

    if (consultationError || !consultation) {
      process.stderr.write(`[CONSULTANT_NOTIFICATION] ERROR: Consultation not found: ${JSON.stringify(consultationError)}\n`);
      return;
    }

    process.stderr.write(`[CONSULTANT_NOTIFICATION] Consultation loaded\n`);

    const consultant = consultation.consultant;
    const consultantPhone = consultant?.phone;

    if (!consultantPhone) {
      process.stderr.write(`[CONSULTANT_NOTIFICATION] SKIP: No consultant phone\n`);
      return;
    }

    // Очищаем телефон от невидимых символов
    const cleanPhone = sanitizePhoneNumber(consultantPhone);

    process.stderr.write(`[CONSULTANT_NOTIFICATION] Consultant phone: ${consultantPhone} -> cleaned: ${cleanPhone}\n`);

    // 2. Получить WhatsApp instance для отправки
    const instanceName = await getInstanceName(
      consultant.parent_user_account_id,
      consultation.dialog_analysis_id
    );

    if (!instanceName) {
      process.stderr.write(`[CONSULTANT_NOTIFICATION] ERROR: No WhatsApp instance found\n`);
      return;
    }

    process.stderr.write(`[CONSULTANT_NOTIFICATION] Instance name: ${instanceName}\n`);

    // 3. Форматировать сообщение (используем данные из consultations напрямую)
    const clientName = consultation.client_name || 'Клиент';
    const clientPhone = consultation.client_phone || 'Не указан';
    const serviceName = consultation.service?.name || 'Консультация';
    const date = format(new Date(consultation.date), 'dd MMMM yyyy', { locale: ru });
    const startTime = consultation.start_time;

    const message = `🔔 Новая консультация!

Клиент: ${clientName}
Телефон: ${clientPhone}
Дата: ${date} в ${startTime}
Услуга: ${serviceName}

Подробности в личном кабинете: https://crm.example.com/c/${consultant.id}`;

    process.stderr.write(`[CONSULTANT_NOTIFICATION] Sending WhatsApp message...\n`);

    // 4. Отправить уведомление через Evolution API
    await sendWhatsAppMessage({
      instanceName,
      phone: cleanPhone,
      message,
    });

    process.stderr.write(`[CONSULTANT_NOTIFICATION] SUCCESS: Notification sent to ${consultant.name} (${cleanPhone})\n`);
  } catch (error) {
    process.stderr.write(`[CONSULTANT_NOTIFICATION] EXCEPTION: ${error}\n`);
    // Не пробрасываем ошибку, чтобы не блокировать создание консультации
  }
}

/**
 * Отправляет консультанту уведомление о переназначении лида
 */
export async function notifyConsultantAboutNewLead(
  consultantId: string,
  leadId: string
): Promise<void> {
  try {
    // Получить информацию о консультанте и лиде
    const { data: consultant, error: consultantError } = await supabase
      .from('consultants')
      .select('id, name, phone, parent_user_account_id')
      .eq('id', consultantId)
      .single();

    if (consultantError || !consultant?.phone) {
      console.error('Consultant not found:', consultantError);
      return;
    }

    // Очищаем телефон от невидимых символов
    const cleanPhone = sanitizePhoneNumber(consultant.phone);

    const { data: lead, error: leadError } = await supabase
      .from('dialog_analysis')
      .select('contact_name, contact_phone, interest_level, instance_name')
      .eq('id', leadId)
      .single();

    if (leadError || !lead) {
      console.error('Lead not found:', leadError);
      return;
    }

    const instanceName = await getInstanceName(
      consultant.parent_user_account_id,
      leadId
    );

    if (!instanceName) {
      console.error('No WhatsApp instance found for consultant');
      return;
    }

    const interestLabels: Record<string, string> = {
      hot: 'Горячий',
      warm: 'Теплый',
      cold: 'Холодный',
    };

    const message = `👤 Новый лид назначен вам!

Имя: ${lead.contact_name || 'Не указано'}
Телефон: ${lead.contact_phone}
Интерес: ${interestLabels[lead.interest_level || ''] || lead.interest_level || 'Не определён'}

Посмотреть в личном кабинете: https://crm.example.com/c/${consultant.id}`;

    await sendWhatsAppMessage({
      instanceName,
      phone: cleanPhone,
      message,
    });

    console.log(`New lead notification sent to consultant ${consultant.name}`);
  } catch (error) {
    console.error('Failed to send new lead notification:', error);
  }
}

/**
 * Отправляет консультанту напоминание о консультации (за N минут до начала)
 */
export async function sendConsultationReminder(
  consultationId: string,
  minutesBefore: number = 60
): Promise<void> {
  try {
    const { data: consultation, error } = await supabase
      .from('consultations')
      .select(`
        *,
        consultant:consultants!inner(id, name, phone, parent_user_account_id),
        service:consultation_services(name)
      `)
      .eq('id', consultationId)
      .single();

    if (error || !consultation) {
      console.error('Consultation not found:', error);
      return;
    }

    const consultant = consultation.consultant;
    const consultantPhone = consultant?.phone;

    if (!consultantPhone) {
      console.warn('Consultant phone not found, skipping reminder');
      return;
    }

    // Очищаем телефон от невидимых символов
    const cleanPhone = sanitizePhoneNumber(consultantPhone);

    const instanceName = await getInstanceName(
      consultant.parent_user_account_id,
      consultation.dialog_analysis_id
    );

    if (!instanceName) {
      console.error('No WhatsApp instance found for consultant');
      return;
    }

    const clientName = consultation.client_name || 'Клиент';
    const serviceName = consultation.service?.name || 'Консультация';
    const startTime = consultation.start_time;

    const message = `⏰ Напоминание о консультации через ${minutesBefore} минут!

Клиент: ${clientName}
Услуга: ${serviceName}
Начало: ${startTime}

Подготовьтесь к встрече 😊`;

    await sendWhatsAppMessage({
      instanceName,
      phone: cleanPhone,
      message,
    });

    console.log(`Reminder sent to consultant ${consultant.name}`);
  } catch (error) {
    console.error('Failed to send consultation reminder:', error);
  }
}
