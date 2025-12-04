import cron from 'node-cron';
import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { sendTelegramNotification, formatDisconnectMessage } from '../lib/telegramNotifier.js';

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';

/**
 * Проверяет статус WhatsApp инстанса через Evolution API
 * Возвращает: 'connected' | 'disconnected' | 'error' (ошибка проверки, не disconnected)
 */
async function checkInstanceStatus(instanceName: string): Promise<'connected' | 'disconnected' | 'error'> {
  try {
    const url = `${EVOLUTION_API_URL}/instance/connectionState/${instanceName}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'apikey': EVOLUTION_API_KEY
      },
      signal: AbortSignal.timeout(10000) // 10 секунд таймаут
    });

    if (!response.ok) {
      // HTTP ошибка — может быть временная проблема с API
      return 'error';
    }

    const data = await response.json() as any;
    return data.state === 'open' ? 'connected' : 'disconnected';
  } catch (error: any) {
    // Сетевая ошибка или таймаут — не считаем disconnected
    return 'error';
  }
}

/**
 * Проверяет статус с повторными попытками
 * Возвращает true только если инстанс реально disconnected (подтверждено несколько раз)
 */
async function isReallyDisconnected(instanceName: string, retries: number = 3, delayMs: number = 2000): Promise<boolean> {
  let disconnectCount = 0;

  for (let i = 0; i < retries; i++) {
    const status = await checkInstanceStatus(instanceName);

    if (status === 'connected') {
      return false; // Подключен — точно не disconnected
    }

    if (status === 'disconnected') {
      disconnectCount++;
    }
    // Если 'error' — не считаем ни как connected, ни как disconnected

    if (i < retries - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  // Считаем disconnected только если получили явный disconnected хотя бы 2 раза
  return disconnectCount >= 2;
}

interface WhatsAppInstance {
  id: string;
  instance_name: string;
  phone_number: string | null;
  status: string;
  user_account_id: string;
  user_accounts: {
    id: string;
    telegram_id: string | null;
    username: string | null;
  } | null;
}

/**
 * Cron-задача для мониторинга WhatsApp инстансов
 * Запускается каждые 5 минут и проверяет все connected инстансы
 */
export function startWhatsAppMonitorCron(app: FastifyInstance) {
  app.log.info('📱 WhatsApp monitor cron started (runs every 5 minutes)');

  cron.schedule('*/5 * * * *', async () => {
    try {
      app.log.info('[WhatsApp Monitor] Checking connected instances...');

      // 1. Получаем все connected инстансы с данными пользователей
      const { data: instances, error } = await supabase
        .from('whatsapp_instances')
        .select(`
          id,
          instance_name,
          phone_number,
          status,
          user_account_id,
          account_id,
          user_accounts!inner(id, telegram_id, username)
        `)
        .eq('status', 'connected');

      if (error) {
        app.log.error({ error }, '[WhatsApp Monitor] Failed to fetch instances');
        return;
      }

      if (!instances || instances.length === 0) {
        app.log.info('[WhatsApp Monitor] No connected instances to check');
        return;
      }

      app.log.info(`[WhatsApp Monitor] Found ${instances.length} connected instance(s) to check`);

      // 2. Проверяем каждый инстанс
      for (const instance of instances) {
        const inst = instance as any;
        try {
          const isDisconnected = await isReallyDisconnected(inst.instance_name);

          if (isDisconnected) {
            app.log.warn({
              instanceName: inst.instance_name,
              phone: inst.phone_number,
              userId: inst.user_account_id,
              accountId: inst.account_id
            }, '[WhatsApp Monitor] Instance confirmed disconnected (verified with retries)');

            // 3. Обновляем статус в whatsapp_instances
            await supabase
              .from('whatsapp_instances')
              .update({ status: 'disconnected' })
              .eq('id', inst.id);

            // 4. Обновляем статус в whatsapp_phone_numbers
            await supabase
              .from('whatsapp_phone_numbers')
              .update({ connection_status: 'disconnected' })
              .eq('instance_name', inst.instance_name);

            // 5. Отправляем уведомление в Telegram
            const telegramId = inst.user_accounts?.telegram_id;
            if (telegramId) {
              const message = formatDisconnectMessage({
                phone_number: inst.phone_number || undefined,
                instance_name: inst.instance_name
              });

              const sent = await sendTelegramNotification(telegramId, message);

              if (sent) {
                app.log.info({
                  instanceName: inst.instance_name,
                  telegramId
                }, '[WhatsApp Monitor] Disconnect notification sent');
              }
            } else {
              app.log.warn({
                instanceName: inst.instance_name,
                userId: inst.user_account_id
              }, '[WhatsApp Monitor] No telegram_id for user, skipping notification');
            }
          }
        } catch (instanceError: any) {
          app.log.error({
            error: instanceError.message,
            instanceName: inst.instance_name
          }, '[WhatsApp Monitor] Error checking instance');
        }
      }

      app.log.info('[WhatsApp Monitor] Check completed');

    } catch (error: any) {
      app.log.error({ error: error.message }, '[WhatsApp Monitor] Cron error');
    }
  });
}
