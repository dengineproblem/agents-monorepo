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

/**
 * Schema for creating a lead from website
 */
const CreateLeadSchema = z.object({
  userAccountId: z.string().uuid(),
  name: z.string().min(1).max(255),
  phone: z.string().min(5).max(20),

  // UTM tracking parameters
  utm_source: z.string().optional(),
  utm_medium: z.string().optional(),
  utm_campaign: z.string().optional(),
  utm_term: z.string().optional(),
  utm_content: z.string().optional(), // Can contain Facebook ad_id

  // Facebook Ad ID (can be passed directly or via utm_content)
  ad_id: z.string().optional(),

  // Optional fields
  email: z.string().email().optional(),
  message: z.string().optional()
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
   * POST /leads
   * External URL: /api/leads (nginx adds /api/ prefix)
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
  app.post('/leads', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Tilda может отправлять поля с заглавных букв или строчных
      const body = request.body as any;

      // Нормализуем данные от Tilda (поля могут быть Name, Phone или name, phone)
      const normalizedBody = {
        userAccountId: body.userAccountId || body.user_account_id,
        name: body.name || body.Name,
        phone: body.phone || body.Phone,
        email: body.email || body.Email,
        message: body.message || body.Message,
        utm_source: body.utm_source,
        utm_medium: body.utm_medium,
        utm_campaign: body.utm_campaign,
        utm_term: body.utm_term,
        utm_content: body.utm_content,
        ad_id: body.ad_id
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
        utm_campaign: leadData.utm_campaign,
        ad_id: leadData.ad_id,
        utm_content: leadData.utm_content
      }, 'Received lead from website');

      // 2. Verify user account exists
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

      // 3. Extract ad_id from utm_content or direct parameter
      const sourceId = leadData.ad_id || leadData.utm_content || null;

      // 4. Resolve creative_id and direction_id from ad_id
      let creativeId: string | null = null;
      let directionId: string | null = null;

      if (sourceId) {
        const resolved = await resolveCreativeAndDirection(
          sourceId,
          null, // sourceUrl not needed for Tilda
          leadData.userAccountId,
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
      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });

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
      const { userAccountId, limit = '50', offset = '0' } = request.query as {
        userAccountId?: string;
        limit?: string;
        offset?: string;
      };

      if (!userAccountId) {
        return reply.code(400).send({
          error: 'missing_user_account_id',
          message: 'userAccountId query parameter is required'
        });
      }

      const { data: leads, error } = await supabase
        .from('leads')
        .select('*')
        .eq('user_account_id', userAccountId)
        .order('created_at', { ascending: false })
        .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

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
      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });
}
