/**
 * Leads API Routes
 *
 * Handles lead creation from website (Tilda webhook)
 * 
 * Flow: Tilda form → webhook → leads (with source_id from ad_id) 
 *       → AmoCRM webhook (sales only) → sales table
 *
 * @module routes/leads
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { resolveCreativeAndDirection } from '../lib/creativeResolver.js';
import { eventLogger } from '../lib/eventLogger.js';
import { onROIConfigured } from '../lib/onboardingHelper.js';
import { logErrorToAdmin } from '../lib/errorLogger.js';

/**
 * Schema for creating a lead from website
 * Note: Tilda sends null for empty fields, so we use .nullable() to accept null
 * and .transform() to convert null to undefined
 */
const nullableString = z.string().nullable().optional().transform(val => val ?? undefined);
const nullableEmail = z.string().email().nullable().optional().transform(val => val ?? undefined);

const CreateLeadSchema = z.object({
  userAccountId: z.string().uuid(),
  accountId: z.string().uuid().nullable().optional().transform(val => val ?? undefined), // UUID для мультиаккаунтности
  name: z.string().min(1).max(255),
  phone: z.string().min(5).max(20),

  // UTM tracking parameters - Tilda sends null for empty fields
  utm_source: nullableString,
  utm_medium: nullableString,
  utm_campaign: nullableString,
  utm_term: nullableString,
  utm_content: nullableString, // Can contain Facebook ad_id

  // Facebook Ad ID (can be passed directly or via utm_content)
  ad_id: nullableString,

  // Optional fields
  email: nullableEmail,
  message: nullableString
});

type CreateLeadInput = z.infer<typeof CreateLeadSchema>;

/**
 * Normalize phone number to WhatsApp format
 * Converts: +7 912 345-67-89 -> 79123456789@s.whatsapp.net
 *
 * @param phone - Raw phone number
 * @returns Normalized phone in WhatsApp format
 */
function normalizePhoneForWhatsApp(phone: string): string {
  // Remove all non-digit characters except leading +
  let normalized = phone.replace(/[^\d+]/g, '');

  // If starts with 8, replace with 7 (Russia)
  if (normalized.startsWith('8')) {
    normalized = '7' + normalized.substring(1);
  }

  // If starts with +7, remove +
  if (normalized.startsWith('+7')) {
    normalized = '7' + normalized.substring(2);
  }

  // If starts with +, remove it
  if (normalized.startsWith('+')) {
    normalized = normalized.substring(1);
  }

  // Add WhatsApp suffix
  return `${normalized}@s.whatsapp.net`;
}

export default async function leadsRoutes(app: FastifyInstance) {
  /**
   * POST /leads/:userAccountId? (optional userAccountId in URL)
   * External URL: /api/leads or /api/leads/:userAccountId (nginx adds /api/ prefix)
   *
   * Create a new lead from website (Tilda webhook)
   * 
   * Maps leads to creatives using Facebook ad_id from UTM parameters.
   * AmoCRM sync is DISABLED - leads are NOT automatically sent to AmoCRM.
   * AmoCRM is used only for receiving sales data via webhook.
   *
   * Body:
   *   - userAccountId: UUID of user account
   *   - name: Lead's name
   *   - phone: Lead's phone number
   *   - utm_source, utm_medium, utm_campaign, utm_term, utm_content: UTM parameters
   *   - ad_id (optional): Facebook Ad ID (alternative to utm_content)
   *   - email (optional): Lead's email
   *   - message (optional): Additional message from lead
   *
   * Returns: { success: true, leadId: number }
   */
  // Handler для обоих вариантов: /leads и /leads/:userAccountId
  const handleLeadCreation = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Извлекаем userAccountId из URL параметра (если есть)
      const params = request.params as { userAccountId?: string };
      const urlUserAccountId = params.userAccountId;

      // Tilda может отправлять поля с заглавных букв или строчных
      const body = request.body as any;

      // Логируем ВСЕ поля для отладки
      app.log.info({
        urlUserAccountId,
        allBodyFields: body,
        bodyKeys: Object.keys(body)
      }, 'Received webhook data from Tilda');

      // Если это тестовый запрос от Tilda - возвращаем успех
      if (body.test === 'test') {
        app.log.info('Tilda test webhook received - returning success');
        return reply.send({
          success: true,
          message: 'Test webhook received successfully'
        });
      }

      // Парсим UTM из TILDAUTM cookie (если передано)
      // Формат TILDAUTM: utm_source=value|||utm_campaign=value|||utm_content=value
      let utmParams: any = {};
      let fbcAdId: string | null = null;

      if (body.COOKIES) {
        // 1. Парсим TILDAUTM cookie
        const tildaUtm = body.COOKIES.match(/TILDAUTM=([^;]+)/);
        if (tildaUtm) {
          try {
            const decoded = decodeURIComponent(tildaUtm[1]);
            // TILDAUTM использует ||| как разделитель между параметрами
            const parts = decoded.split('|||');
            for (const part of parts) {
              const [key, value] = part.split('=');
              if (key && value) {
                utmParams[key] = value;
              }
            }
            app.log.info({ utmParams, decoded }, 'Parsed TILDAUTM cookie');
          } catch (e) {
            app.log.warn({ error: e, cookies: body.COOKIES }, 'Failed to parse TILDAUTM cookie');
          }
        }

        // 2. Парсим _fbc cookie (Facebook Click ID) - содержит ad_id
        // Формат: fb.1.timestamp.encoded_data (где encoded_data содержит ad_id в base64)
        const fbcMatch = body.COOKIES.match(/_fbc=([^;]+)/);
        if (fbcMatch) {
          try {
            const fbcValue = fbcMatch[1];
            // _fbc содержит закодированные данные, попробуем извлечь ad_id
            // Формат новый: fb.1.timestamp.PAZXh0bg... (base64 с ad данными)
            const parts = fbcValue.split('.');
            if (parts.length >= 4) {
              const encodedPart = parts.slice(3).join('.');
              // Попробуем декодировать base64
              try {
                const decoded = Buffer.from(encodedPart, 'base64').toString('utf-8');
                // Ищем ad_id в декодированных данных (может быть в формате adid=XXX)
                const adIdMatch = decoded.match(/adid[^\d]*(\d+)/i);
                if (adIdMatch) {
                  fbcAdId = adIdMatch[1];
                  app.log.info({ fbcAdId, decoded }, 'Extracted ad_id from _fbc cookie');
                }
              } catch (decodeErr) {
                // base64 декодирование не удалось, это нормально для старого формата
              }
            }
            app.log.info({ fbcValue, fbcAdId }, 'Parsed _fbc cookie');
          } catch (e) {
            app.log.warn({ error: e }, 'Failed to parse _fbc cookie');
          }
        }
      }

      // Нормализуем данные от Tilda (поля могут быть Name, Phone или name, phone)
      // Приоритет userAccountId: URL > body.userAccountId > body.user_account_id
      // Используем || undefined чтобы null превращался в undefined (для Zod .optional())
      const normalizedBody = {
        userAccountId: urlUserAccountId || body.userAccountId || body.user_account_id,
        accountId: body.accountId || body.account_id || undefined,  // UUID для мультиаккаунтности
        name: body.name || body.Name,
        phone: body.phone || body.Phone,
        email: body.email || body.Email || undefined,
        message: body.message || body.Message || body.Comments || undefined,
        // Приоритет: прямые параметры > UTM из cookies
        utm_source: body.utm_source || utmParams.utm_source || undefined,
        utm_medium: body.utm_medium || utmParams.utm_medium || undefined,
        utm_campaign: body.utm_campaign || utmParams.utm_campaign || undefined,
        utm_term: body.utm_term || utmParams.utm_term || undefined,
        utm_content: body.utm_content || utmParams.utm_content || undefined,
        // ad_id: прямой параметр > из _fbc cookie
        ad_id: body.ad_id || fbcAdId || undefined
      };

      // 1. Validate request body
      const parsed = CreateLeadSchema.safeParse(normalizedBody);

      if (!parsed.success) {
        app.log.error({
          body: request.body,
          normalized: normalizedBody,
          errors: parsed.error.flatten()
        }, 'Lead validation failed');

        return reply.code(400).send({
          error: 'validation_error',
          issues: parsed.error.flatten()
        });
      }

      const leadData = parsed.data;

      app.log.info({
        userAccountId: leadData.userAccountId,
        name: leadData.name,
        phone: leadData.phone,
        utm_source: leadData.utm_source,
        utm_medium: leadData.utm_medium,
        utm_campaign: leadData.utm_campaign,
        ad_id: leadData.ad_id,
        utm_content: leadData.utm_content
      }, 'Received lead from website');

      // 2. Load user account and tilda_utm_field setting
      // Check multi-account mode: if accountId is provided, load from ad_accounts
      let tildaUtmField: 'utm_source' | 'utm_medium' | 'utm_campaign' = 'utm_medium'; // default

      if (leadData.accountId) {
        // Multi-account mode: load from ad_accounts
        const { data: adAccount, error: adError } = await supabase
          .from('ad_accounts')
          .select('id, tilda_utm_field')
          .eq('id', leadData.accountId)
          .single();

        if (adError || !adAccount) {
          app.log.warn({ accountId: leadData.accountId }, 'Ad account not found, using default tilda_utm_field');
        } else if (adAccount.tilda_utm_field) {
          tildaUtmField = adAccount.tilda_utm_field as typeof tildaUtmField;
        }

        // Also verify user account exists
        const { data: userAccount, error: userError } = await supabase
          .from('user_accounts')
          .select('id')
          .eq('id', leadData.userAccountId)
          .single();

        if (userError || !userAccount) {
          return reply.code(404).send({
            error: 'user_account_not_found',
            message: 'User account not found'
          });
        }
      } else {
        // Legacy mode: load from user_accounts
        const { data: userAccount, error: userError } = await supabase
          .from('user_accounts')
          .select('id, tilda_utm_field')
          .eq('id', leadData.userAccountId)
          .single();

        if (userError || !userAccount) {
          return reply.code(404).send({
            error: 'user_account_not_found',
            message: 'User account not found'
          });
        }

        if (userAccount.tilda_utm_field) {
          tildaUtmField = userAccount.tilda_utm_field as typeof tildaUtmField;
        }
      }

      app.log.info({ tildaUtmField }, 'Using tilda_utm_field setting');

      // 3. Get ad_id value from the configured UTM field
      const utmFieldValue = leadData[tildaUtmField] || null;

      // Фильтрация: пропускаем только лидов с числовым ad_id в настроенном UTM-поле
      // Наши лиды имеют числовой ad_id, остальные (organic, cpc, etc.) игнорируем
      const isNumericAdId = utmFieldValue && /^\d+$/.test(utmFieldValue);
      if (!isNumericAdId) {
        app.log.info({
          name: leadData.name,
          phone: leadData.phone,
          tildaUtmField,
          utmFieldValue
        }, `Skipping lead: ${tildaUtmField} is not a numeric ad_id (not our lead)`);

        return reply.send({
          success: true,
          message: `Lead skipped: not from our ads (${tildaUtmField} is not ad_id)`
        });
      }

      // 4. Extract ad_id from multiple sources (priority order)
      // ad_id (direct) > configured UTM field > utm_term > utm_content
      const sourceId = leadData.ad_id || utmFieldValue || leadData.utm_term || leadData.utm_content || null;

      // 5. Resolve creative_id and direction_id from ad_id
      let creativeId: string | null = null;
      let directionId: string | null = null;

      if (sourceId) {
        const resolved = await resolveCreativeAndDirection(
          sourceId,
          null, // sourceUrl not needed for Tilda
          leadData.userAccountId,
          leadData.accountId || null,  // UUID для мультиаккаунтности
          app
        );
        
        creativeId = resolved.creativeId;
        directionId = resolved.directionId;
        
        app.log.info({
          sourceId,
          creativeId,
          directionId
        }, 'Resolved creative from ad_id for Tilda lead');
      } else {
        app.log.warn('No ad_id or utm_content provided for lead');
      }

      // 6. Insert lead into database
      const { data: lead, error: insertError } = await supabase
        .from('leads')
        .insert({
          user_account_id: leadData.userAccountId,
          account_id: leadData.accountId || null,  // UUID для мультиаккаунтности

          // Website lead fields
          name: leadData.name,
          phone: leadData.phone,
          email: leadData.email || null,
          message: leadData.message || null,
          source_type: 'website',

          // chat_id is NULL for website leads (only used for WhatsApp)
          chat_id: null,

          // Facebook Ad tracking
          source_id: sourceId,
          creative_id: creativeId,
          direction_id: directionId,

          // UTM tracking
          utm_source: leadData.utm_source || null,
          utm_medium: leadData.utm_medium || null,
          utm_campaign: leadData.utm_campaign || null,
          utm_term: leadData.utm_term || null,
          utm_content: leadData.utm_content || null,

          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select('id')
        .single();

      if (insertError || !lead) {
        app.log.error({ error: insertError }, 'Failed to insert lead into database');
        return reply.code(500).send({
          error: 'database_error',
          message: 'Failed to create lead'
        });
      }

      const leadId = lead.id;

      app.log.info({
        leadId,
        name: leadData.name,
        phone: leadData.phone,
        sourceId,
        creativeId,
        directionId
      }, 'Lead created in database');

      // Log business event for analytics
      await eventLogger.logBusinessEvent(
        leadData.userAccountId,
        'lead_received',
        {
          leadId,
          source: leadData.utm_source,
          directionId,
          creativeId
        },
        leadData.accountId
      );

      // Обновляем этап онбординга: первый лид с Tilda
      onROIConfigured(leadData.userAccountId).catch(err => {
        app.log.warn({ err, userId: leadData.userAccountId }, 'Failed to update onboarding stage for Tilda lead');
      });

      // 7. Respond to webhook
      // NOTE: AmoCRM sync is DISABLED. Leads are NOT automatically sent to AmoCRM.
      // AmoCRM is used only for receiving sales data via webhook.
      reply.send({
        success: true,
        leadId,
        message: 'Lead received successfully'
      });

    } catch (error: any) {
      app.log.error({ error }, 'Error processing lead creation');

      logErrorToAdmin({
        user_account_id: (request.body as any)?.userAccountId || (request.body as any)?.user_account_id,
        error_type: 'webhook',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'create_lead_webhook',
        endpoint: '/leads',
        request_data: { name: (request.body as any)?.name, phone: (request.body as any)?.phone },
        severity: 'critical'
      }).catch(() => {});

      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  };

  // Регистрируем оба роута
  app.post('/leads', handleLeadCreation);
  app.post('/leads/:userAccountId', handleLeadCreation);

  /**
   * GET /leads/:id
   * External URL: /api/leads/:id (nginx adds /api/ prefix)
   *
   * Get lead by ID
   *
   * Params:
   *   - id: Lead ID
   *
   * Query:
   *   - userAccountId: UUID of user account (for authorization)
   *
   * Returns: Lead object
   */
  app.get('/leads/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const { userAccountId } = request.query as { userAccountId?: string };

      if (!userAccountId) {
        return reply.code(400).send({
          error: 'missing_user_account_id',
          message: 'userAccountId query parameter is required'
        });
      }

      const { data: lead, error } = await supabase
        .from('leads')
        .select('*')
        .eq('id', parseInt(id))
        .eq('user_account_id', userAccountId)
        .single();

      if (error || !lead) {
        return reply.code(404).send({
          error: 'lead_not_found',
          message: 'Lead not found'
        });
      }

      return reply.send(lead);

    } catch (error: any) {
      app.log.error({ error }, 'Error fetching lead');

      logErrorToAdmin({
        error_type: 'api',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'get_lead_by_id',
        endpoint: '/leads/:id',
        severity: 'warning'
      }).catch(() => {});

      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });

  /**
   * GET /leads
   * External URL: /api/leads (nginx adds /api/ prefix)
   *
   * List all leads for a user account
   *
   * Query:
   *   - userAccountId: UUID of user account
   *   - limit (optional): Number of leads to return (default: 50)
   *   - offset (optional): Offset for pagination (default: 0)
   *
   * Returns: Array of leads
   */
  app.get('/leads', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userAccountId, accountId, limit = '50', offset = '0' } = request.query as {
        userAccountId?: string;
        accountId?: string;  // UUID для мультиаккаунтности
        limit?: string;
        offset?: string;
      };

      if (!userAccountId) {
        return reply.code(400).send({
          error: 'missing_user_account_id',
          message: 'userAccountId query parameter is required'
        });
      }

      let dbQuery = supabase
        .from('leads')
        .select('*')
        .eq('user_account_id', userAccountId)
        .order('created_at', { ascending: false })
        .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

      // Фильтр по account_id для мультиаккаунтности
      if (accountId) {
        dbQuery = dbQuery.eq('account_id', accountId);
      }

      const { data: leads, error } = await dbQuery;

      if (error) {
        app.log.error({ error }, 'Failed to fetch leads');
        return reply.code(500).send({
          error: 'database_error',
          message: 'Failed to fetch leads'
        });
      }

      return reply.send({
        leads: leads || [],
        count: leads?.length || 0
      });

    } catch (error: any) {
      app.log.error({ error }, 'Error fetching leads');

      logErrorToAdmin({
        user_account_id: (request.query as any)?.userAccountId,
        error_type: 'api',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'list_leads',
        endpoint: '/leads',
        severity: 'warning'
      }).catch(() => {});

      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });
}
