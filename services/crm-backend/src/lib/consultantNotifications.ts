import { supabase } from './supabase.js';
import { sendWhatsAppMessage } from './whatsapp.js';
import { format } from 'date-fns';
import ru from 'date-fns/locale/ru/index.js';

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
        service:consultation_services(name),
        lead:dialog_analysis(contact_name, contact_phone)
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

    process.stderr.write(`[CONSULTANT_NOTIFICATION] Consultant phone: ${consultantPhone}\n`);

    // 2. Получить instance_name для Evolution API
    const { data: userAccount, error: userAccountError } = await supabase
      .from('user_accounts')
      .select('instance_name')
      .eq('id', consultant.parent_user_account_id)
      .single();

    if (userAccountError || !userAccount?.instance_name) {
      process.stderr.write(`[CONSULTANT_NOTIFICATION] ERROR: User account not found: ${JSON.stringify(userAccountError)}\n`);
      return;
    }

    process.stderr.write(`[CONSULTANT_NOTIFICATION] Instance name: ${userAccount.instance_name}\n`);

    // 3. Форматировать сообщение
    const clientName = consultation.lead?.contact_name || 'Клиент';
    const clientPhone = consultation.lead?.contact_phone || 'Не указан';
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
      instanceName: userAccount.instance_name,
      phone: consultantPhone,
      message,
    });

    process.stderr.write(`[CONSULTANT_NOTIFICATION] SUCCESS: Notification sent to ${consultant.name} (${consultantPhone})\n`);
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
      .select('id, name, phone, user_account_id')
      .eq('id', consultantId)
      .single();

    if (consultantError || !consultant?.phone) {
      console.error('Consultant not found:', consultantError);
      return;
    }

    const { data: lead, error: leadError } = await supabase
      .from('dialog_analysis')
      .select('contact_name, contact_phone, interest_level')
      .eq('id', leadId)
      .single();

    if (leadError || !lead) {
      console.error('Lead not found:', leadError);
      return;
    }

    const { data: userAccount, error: userAccountError } = await supabase
      .from('user_accounts')
      .select('instance_name')
      .eq('id', consultant.user_account_id)
      .single();

    if (userAccountError || !userAccount?.instance_name) {
      console.error('User account or instance not found:', userAccountError);
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
      instanceName: userAccount.instance_name,
      phone: consultant.phone,
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
        service:consultation_services(name),
        lead:dialog_analysis(contact_name, contact_phone)
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

    const { data: userAccount, error: userAccountError } = await supabase
      .from('user_accounts')
      .select('instance_name')
      .eq('id', consultant.parent_user_account_id)
      .single();

    if (userAccountError || !userAccount?.instance_name) {
      console.error('User account or instance not found:', userAccountError);
      return;
    }

    const clientName = consultation.lead?.contact_name || 'Клиент';
    const serviceName = consultation.service?.name || 'Консультация';
    const startTime = consultation.start_time;

    const message = `⏰ Напоминание о консультации через ${minutesBefore} минут!

Клиент: ${clientName}
Услуга: ${serviceName}
Начало: ${startTime}

Подготовьтесь к встрече 😊`;

    await sendWhatsAppMessage({
      instanceName: userAccount.instance_name,
      phone: consultantPhone,
      message,
    });

    console.log(`Reminder sent to consultant ${consultant.name}`);
  } catch (error) {
    console.error('Failed to send consultation reminder:', error);
  }
}
