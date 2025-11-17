/**
 * AmoCRM Webhook Management
 * 
 * Управление вебхуками AmoCRM для автоматической синхронизации статусов лидов
 * 
 * @module lib/amocrmWebhook
 */

import { subscribeWebhook, getWebhooks, unsubscribeWebhook } from '../adapters/amocrm.js';

/**
 * Зарегистрировать вебхук AmoCRM для пользователя
 * 
 * Автоматически проверяет существующие вебхуки и регистрирует новый,
 * если вебхук для данного пользователя еще не зарегистрирован
 * 
 * @param userAccountId - UUID аккаунта пользователя
 * @param subdomain - Поддомен AmoCRM
 * @param accessToken - Access token для API AmoCRM
 */
export async function registerAmoCRMWebhook(
  userAccountId: string,
  subdomain: string,
  accessToken: string
): Promise<void> {
  const webhookUrl = `${process.env.APP_URL}/api/webhooks/amocrm?user_id=${userAccountId}`;
  
  if (!process.env.APP_URL) {
    throw new Error('APP_URL environment variable is not set');
  }
  
  // Проверить существующие вебхуки
  const existingWebhooks = await getWebhooks(subdomain, accessToken);
  const ourWebhook = existingWebhooks.find(w => w.destination === webhookUrl);
  
  if (ourWebhook) {
    // Вебхук уже зарегистрирован
    return;
  }
  
  // Зарегистрировать вебхук для событий изменения статуса лидов
  // События AmoCRM API v4:
  // - add_lead: Создание лида
  // - update_lead: Обновление лида
  // - status_lead: Изменение статуса лида (важно для аналитики воронки)
  await subscribeWebhook(
    webhookUrl,
    ['add_lead', 'update_lead', 'status_lead'],
    subdomain,
    accessToken
  );
}

/**
 * Получить статус вебхука AmoCRM для пользователя
 * 
 * @param subdomain - Поддомен AmoCRM
 * @param accessToken - Access token для API AmoCRM
 * @param userAccountId - UUID аккаунта пользователя
 * @returns Статус регистрации вебхука
 */
export async function getWebhookStatus(
  subdomain: string,
  accessToken: string,
  userAccountId: string
): Promise<{ registered: boolean; webhookUrl?: string }> {
  const webhookUrl = `${process.env.APP_URL}/api/webhooks/amocrm?user_id=${userAccountId}`;
  
  try {
    const webhooks = await getWebhooks(subdomain, accessToken);
    const ourWebhook = webhooks.find(w => w.destination === webhookUrl);
    
    return {
      registered: !!ourWebhook,
      webhookUrl: ourWebhook?.destination
    };
  } catch (error: any) {
    console.error('Failed to get webhook status:', error);
    return {
      registered: false
    };
  }
}

/**
 * Отменить регистрацию вебхука AmoCRM для пользователя
 * 
 * @param subdomain - Поддомен AmoCRM
 * @param accessToken - Access token для API AmoCRM
 * @param userAccountId - UUID аккаунта пользователя
 */
export async function unregisterAmoCRMWebhook(
  subdomain: string,
  accessToken: string,
  userAccountId: string
): Promise<void> {
  const webhookUrl = `${process.env.APP_URL}/api/webhooks/amocrm?user_id=${userAccountId}`;
  
  const webhooks = await getWebhooks(subdomain, accessToken);
  const ourWebhook = webhooks.find(w => w.destination === webhookUrl);
  
  if (ourWebhook) {
    await unsubscribeWebhook(ourWebhook.id, subdomain, accessToken);
  }
}





