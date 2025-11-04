/**
 * AmoCRM Webhooks Handler
 *
 * Receives webhooks from AmoCRM when leads/deals are created or updated
 * Processes deal closures for sales analytics
 *
 * @module routes/amocrmWebhooks
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { processDealWebhook } from '../workflows/amocrmSync.js';

/**
 * AmoCRM webhook payload structure
 * https://www.amocrm.ru/developers/content/crm_platform/webhooks
 */
interface AmoCRMWebhookPayload {
  account_id?: number;
  leads?: {
    add?: Array<{
      id: number;
      name: string;
      status_id: number;
      price: number;
      responsible_user_id: number;
      created_at: number;
      updated_at: number;
      custom_fields_values?: any[];
      _embedded?: {
        contacts?: any[];
        tags?: any[];
      };
    }>;
    update?: any[];
    delete?: any[];
    status?: any[];
  };
  contacts?: {
    add?: any[];
    update?: any[];
    delete?: any[];
  };
  // Note: AmoCRM uses "leads" for what we might call "deals"
  // The terminology is confusing but that's how AmoCRM API works
  [key: string]: any;
}

export default async function amocrmWebhooks(app: FastifyInstance) {
  /**
   * AmoCRM webhook endpoint
   * Receives notifications when leads/deals are created or updated
   *
   * URL format: /api/webhooks/amocrm?user_id={uuid}
   *
   * The user_id query parameter identifies which user account owns the AmoCRM account
   * This should be configured in AmoCRM webhook settings
   */
  app.post('/api/webhooks/amocrm', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = request.body as AmoCRMWebhookPayload;
      const userAccountId = (request.query as any)['user_id'] as string | undefined;

      app.log.info({
        accountId: payload.account_id,
        hasLeads: !!payload.leads,
        hasContacts: !!payload.contacts,
        userAccountId,
        leadsAddCount: payload.leads?.add?.length || 0,
        leadsUpdateCount: payload.leads?.update?.length || 0
      }, 'AmoCRM webhook received');

      // Validate user_id parameter
      if (!userAccountId) {
        app.log.error('Missing user_id query parameter in AmoCRM webhook');
        return reply.status(400).send({
          success: false,
          error: 'Missing user_id query parameter'
        });
      }

      // Validate webhook signature (if configured)
      const webhookSecret = process.env.AMOCRM_WEBHOOK_SECRET;
      if (webhookSecret) {
        const signature = request.headers['x-amocrm-signature'] as string;

        if (!signature) {
          app.log.warn('AmoCRM webhook received without signature');
        } else {
          // TODO: Implement signature validation
          // AmoCRM sends signature in X-AmoCRM-Signature header
          // Validate using HMAC-SHA256
        }
      }

      // Acknowledge webhook immediately (respond before processing)
      reply.send({ success: true, message: 'Webhook received, processing in background' });

      // Process webhook asynchronously
      processAmoCRMWebhook(payload, userAccountId, app).catch(error => {
        app.log.error({
          error: error.message,
          stack: error.stack,
          userAccountId,
          accountId: payload.account_id
        }, 'Error processing AmoCRM webhook');
      });

    } catch (error: any) {
      app.log.error({
        error: error.message,
        stack: error.stack
      }, 'Error handling AmoCRM webhook');

      return reply.status(500).send({
        success: false,
        error: 'Internal server error'
      });
    }
  });
}

/**
 * Process AmoCRM webhook payload asynchronously
 *
 * Handles different event types:
 * - leads.add: New lead created (treat as deal in our system)
 * - leads.update: Lead updated
 * - leads.status: Lead status changed (e.g., won/lost)
 *
 * @param payload - Webhook payload from AmoCRM
 * @param userAccountId - User account UUID
 * @param app - Fastify instance for logging
 */
async function processAmoCRMWebhook(
  payload: AmoCRMWebhookPayload,
  userAccountId: string,
  app: FastifyInstance
): Promise<void> {
  try {
    // Process new leads (deals)
    if (payload.leads?.add && payload.leads.add.length > 0) {
      app.log.info({
        count: payload.leads.add.length,
        userAccountId
      }, 'Processing new AmoCRM leads');

      for (const lead of payload.leads.add) {
        try {
          await processDealWebhook(lead, userAccountId, app);
        } catch (error: any) {
          app.log.error({
            error: error.message,
            leadId: lead.id,
            userAccountId
          }, 'Failed to process individual lead');
          // Continue processing other leads even if one fails
        }
      }
    }

    // Process lead updates
    if (payload.leads?.update && payload.leads.update.length > 0) {
      app.log.info({
        count: payload.leads.update.length,
        userAccountId
      }, 'Processing updated AmoCRM leads');

      for (const lead of payload.leads.update) {
        try {
          await processDealWebhook(lead, userAccountId, app);
        } catch (error: any) {
          app.log.error({
            error: error.message,
            leadId: lead.id,
            userAccountId
          }, 'Failed to process lead update');
        }
      }
    }

    // Process status changes (important for won/lost deals)
    if (payload.leads?.status && payload.leads.status.length > 0) {
      app.log.info({
        count: payload.leads.status.length,
        userAccountId
      }, 'Processing AmoCRM lead status changes');

      for (const lead of payload.leads.status) {
        try {
          await processDealWebhook(lead, userAccountId, app);
        } catch (error: any) {
          app.log.error({
            error: error.message,
            leadId: lead.id,
            userAccountId
          }, 'Failed to process lead status change');
        }
      }
    }

    app.log.info({ userAccountId }, 'AmoCRM webhook processing completed');

  } catch (error: any) {
    app.log.error({
      error: error.message,
      stack: error.stack,
      userAccountId
    }, 'Error in AmoCRM webhook processing');
    throw error;
  }
}
