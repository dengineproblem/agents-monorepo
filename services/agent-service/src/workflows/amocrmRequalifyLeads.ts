/**
 * AmoCRM Leads Requalification
 *
 * Перепроверяет квалификацию существующих лидов по настроенным полям AmoCRM.
 * Позволяет задним числом обновить is_qualified для лидов, созданных до настройки квалификации.
 *
 * @module workflows/amocrmRequalifyLeads
 */

import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { getValidAmoCRMToken } from '../lib/amocrmTokens.js';
import { normalizePhone, checkQualification, QualificationFieldConfig } from './amocrmLeadsSync.js';
import { findLeadsByPhone, getLead, getContact } from '../adapters/amocrm.js';

/**
 * Опции для перепроверки квалификации
 */
export interface RequalifyOptions {
  batchSize?: number;           // По умолчанию 50
  dryRun?: boolean;             // По умолчанию false (тестовый режим)
  startDate?: string;           // YYYY-MM-DD (опционально)
  endDate?: string;             // YYYY-MM-DD (опционально)
}

/**
 * Результат перепроверки квалификации
 */
export interface RequalifyResult {
  total: number;                // Всего лидов для обработки
  processed: number;            // Успешно обработано
  qualified: number;            // Стали квалифицированными
  notQualified: number;         // Не квалифицированы
  notFoundInAmo: number;        // Не найдено в AmoCRM
  errors: number;               // Ошибок при обработке
  errorDetails: Array<{         // Детали ошибок (первые 10)
    leadId: string;
    phone: string;
    error: string;
  }>;
  durationMs: number;           // Время выполнения
}

/**
 * Перепроверить квалификацию существующих лидов
 *
 * Логика:
 * 1. Загрузить настройки квалификации
 * 2. Загрузить лиды из БД (с фильтрацией по датам если указано)
 * 3. Для каждого лида:
 *    - Найти в AmoCRM по телефону или amocrm_lead_id
 *    - Проверить квалификацию по custom fields
 *    - Обновить is_qualified в БД (если не dry-run)
 * 4. Вернуть статистику
 *
 * @param userAccountId - UUID пользователя
 * @param app - Fastify instance для логирования
 * @param accountId - Optional ad_account UUID для мультиаккаунтности
 * @param options - Опции перепроверки
 * @returns Результат перепроверки
 */
export async function requalifyLeads(
  userAccountId: string,
  app: FastifyInstance,
  accountId?: string | null,
  options?: RequalifyOptions
): Promise<RequalifyResult> {
  const log = app.log;
  const startTime = Date.now();

  const batchSize = options?.batchSize || 50;
  const dryRun = options?.dryRun || false;
  const startDate = options?.startDate;
  const endDate = options?.endDate;

  const result: RequalifyResult = {
    total: 0,
    processed: 0,
    qualified: 0,
    notQualified: 0,
    notFoundInAmo: 0,
    errors: 0,
    errorDetails: [],
    durationMs: 0
  };

  try {
    log.info({
      userAccountId,
      accountId,
      batchSize,
      dryRun,
      startDate,
      endDate
    }, 'Starting AmoCRM leads requalification');

    // 1. Получить настройки квалификации из ad_accounts или user_accounts
    let qualificationFieldsData: any = null;
    if (accountId) {
      const { data: adAccount } = await supabase
        .from('ad_accounts')
        .select('amocrm_qualification_fields')
        .eq('id', accountId)
        .maybeSingle();
      qualificationFieldsData = adAccount;
    }

    // Fallback to user_accounts
    if (!qualificationFieldsData) {
      const { data: userAccount } = await supabase
        .from('user_accounts')
        .select('amocrm_qualification_fields')
        .eq('id', userAccountId)
        .maybeSingle();
      qualificationFieldsData = userAccount;
    }

    const qualificationFields: QualificationFieldConfig[] =
      qualificationFieldsData?.amocrm_qualification_fields || [];

    if (qualificationFields.length === 0) {
      throw new Error('Qualification fields are not configured. Please configure qualification fields first.');
    }

    log.info({
      qualificationFieldsCount: qualificationFields.length,
      fields: qualificationFields.map(f => ({
        id: f.field_id,
        name: f.field_name,
        type: f.field_type,
        enumId: f.enum_id
      }))
    }, 'Qualification fields loaded');

    // 2. Получить токен AmoCRM (с автоматическим обновлением)
    const { accessToken, subdomain } = await getValidAmoCRMToken(userAccountId, accountId);

    // 3. Загрузить лиды из БД с фильтрацией
    let query = supabase
      .from('leads')
      .select('id, phone, chat_id, amocrm_lead_id, is_qualified')
      .eq('user_account_id', userAccountId);

    // Фильтрация по accountId для мультиаккаунтности
    if (accountId) {
      query = query.eq('account_id', accountId);
    }

    // Фильтрация по датам
    if (startDate) {
      query = query.gte('created_at', `${startDate}T00:00:00Z`);
    }
    if (endDate) {
      query = query.lte('created_at', `${endDate}T23:59:59Z`);
    }

    query = query.order('created_at', { ascending: false });

    const { data: leads, error: leadsError } = await query;

    if (leadsError) {
      throw new Error(`Failed to fetch leads: ${leadsError.message}`);
    }

    if (!leads || leads.length === 0) {
      log.info({ userAccountId, accountId, startDate, endDate }, 'No leads found to requalify');
      return result;
    }

    result.total = leads.length;
    log.info({ totalLeads: leads.length }, 'Leads loaded for requalification');

    // 4. Batch обработка лидов
    for (let i = 0; i < leads.length; i += batchSize) {
      const batch = leads.slice(i, i + batchSize);
      log.info({
        batch: Math.floor(i / batchSize) + 1,
        totalBatches: Math.ceil(leads.length / batchSize),
        batchSize: batch.length
      }, 'Processing batch');

      // Обработка каждого лида в батче
      for (const localLead of batch) {
        try {
          // a) Нормализовать телефон
          const rawPhone = localLead.phone || localLead.chat_id;
          const normalizedPhone = normalizePhone(rawPhone);

          if (!normalizedPhone) {
            log.debug({ leadId: localLead.id }, 'Lead has no phone number, skipping');
            continue;
          }

          // b) Найти лид в AmoCRM
          let amocrmLead: any = null;

          // Если есть amocrm_lead_id - попробовать получить напрямую
          if (localLead.amocrm_lead_id) {
            try {
              amocrmLead = await getLead(localLead.amocrm_lead_id, subdomain, accessToken);
            } catch (error: any) {
              // Если не найден по ID - попробуем по телефону
              log.debug({
                leadId: localLead.id,
                amocrmLeadId: localLead.amocrm_lead_id,
                error: error.message
              }, 'Failed to get lead by amocrm_lead_id, will try by phone');
            }
          }

          // Если не нашли по ID или ID не было - ищем по телефону
          if (!amocrmLead) {
            try {
              const amocrmLeads = await findLeadsByPhone(rawPhone, subdomain, accessToken);

              if (amocrmLeads && amocrmLeads.length > 0) {
                // Берем самый свежий лид
                const sortedLeads = amocrmLeads.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
                amocrmLead = sortedLeads[0];
              }
            } catch (error: any) {
              log.debug({
                leadId: localLead.id,
                phone: normalizedPhone,
                error: error.message
              }, 'Error searching lead by phone in AmoCRM');
            }
          }

          // Если не найден в AmoCRM
          if (!amocrmLead) {
            result.notFoundInAmo++;
            log.debug({
              leadId: localLead.id,
              phone: normalizedPhone
            }, 'Lead not found in AmoCRM');
            continue;
          }

          result.processed++;

          // c) Получить полные данные контактов
          const linkedContacts = amocrmLead._embedded?.contacts || [];
          const contactsWithFields: any[] = [];

          if (linkedContacts.length > 0) {
            for (const contactRef of linkedContacts) {
              try {
                const fullContact = await getContact(contactRef.id, subdomain, accessToken);
                if (fullContact?.custom_fields_values) {
                  contactsWithFields.push(fullContact);
                }
              } catch (e: any) {
                log.debug({
                  leadId: localLead.id,
                  contactId: contactRef.id,
                  error: e.message
                }, 'Failed to fetch contact, skipping');
              }
            }
          }

          // Создать enriched lead object с полными данными контактов
          const enrichedLead = {
            ...amocrmLead,
            _embedded: {
              ...amocrmLead._embedded,
              contacts: contactsWithFields
            }
          };

          // d) Проверить квалификацию
          const isQualified = checkQualification(enrichedLead, qualificationFields);

          if (isQualified) {
            result.qualified++;
          } else {
            result.notQualified++;
          }

          log.debug({
            leadId: localLead.id,
            amocrmLeadId: amocrmLead.id,
            isQualified,
            oldIsQualified: localLead.is_qualified,
            changed: localLead.is_qualified !== isQualified
          }, 'Qualification check completed');

          // e) Обновить БД (если не dry-run и значение изменилось)
          if (!dryRun && localLead.is_qualified !== isQualified) {
            const updateData: any = {
              is_qualified: isQualified,
              updated_at: new Date().toISOString()
            };

            // Сохранить amocrm_lead_id если ещё не был сохранён
            if (!localLead.amocrm_lead_id && amocrmLead.id) {
              updateData.amocrm_lead_id = amocrmLead.id;
            }

            const { error: updateError } = await supabase
              .from('leads')
              .update(updateData)
              .eq('id', localLead.id);

            if (updateError) {
              throw new Error(`Failed to update lead: ${updateError.message}`);
            }

            log.debug({
              leadId: localLead.id,
              isQualified,
              amocrmLeadId: amocrmLead.id
            }, 'Lead qualification updated in database');
          }

          // Rate limiting: 100ms задержка между запросами (макс 10 req/sec)
          await new Promise(resolve => setTimeout(resolve, 100));

        } catch (error: any) {
          result.errors++;

          // Сохранить детали ошибки (первые 10)
          if (result.errorDetails.length < 10) {
            result.errorDetails.push({
              leadId: localLead.id,
              phone: localLead.phone || localLead.chat_id || 'unknown',
              error: error.message
            });
          }

          log.error({
            leadId: localLead.id,
            error: error.message
          }, 'Error processing lead');

          // Продолжаем обработку следующих лидов
          continue;
        }
      }
    }

    // 5. Логирование в amocrm_sync_log
    const syncStatus = result.errors > 0 && result.processed === 0
      ? 'failed'
      : result.errors > 0
        ? 'partial'
        : 'success';

    await supabase
      .from('amocrm_sync_log')
      .insert({
        user_account_id: userAccountId,
        account_id: accountId || null,
        sync_type: 'lead_requalification' as any, // Будет работать после миграции
        sync_status: syncStatus as any,
        request_json: {
          userAccountId,
          accountId,
          options: { batchSize, dryRun, startDate, endDate }
        },
        response_json: result
      });

    result.durationMs = Date.now() - startTime;

    log.info({
      userAccountId,
      accountId,
      dryRun,
      total: result.total,
      processed: result.processed,
      qualified: result.qualified,
      notQualified: result.notQualified,
      notFoundInAmo: result.notFoundInAmo,
      errors: result.errors,
      durationMs: result.durationMs
    }, 'AmoCRM leads requalification completed');

    return result;

  } catch (error: any) {
    log.error({
      error: error.message,
      userAccountId,
      accountId
    }, 'AmoCRM leads requalification failed');

    result.durationMs = Date.now() - startTime;
    result.errors++;

    if (result.errorDetails.length < 10) {
      result.errorDetails.push({
        leadId: 'N/A',
        phone: 'N/A',
        error: error.message
      });
    }

    throw error;
  }
}
