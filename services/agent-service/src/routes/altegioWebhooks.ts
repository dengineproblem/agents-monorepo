/**
 * Altegio Webhooks Handler
 *
 * Processes webhook events from Altegio:
 * - record_create: Client booked appointment → qualify lead
 * - record_update: Appointment updated → check cancellation
 * - finances_operation_create: Payment received → add to sales for ROI
 *
 * Qualification priority: Altegio (appointment) > AMO/Bitrix (custom field)
 *
 * @module routes/altegioWebhooks
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { getAltegioClient } from '../lib/altegioTokens.js';
import {
  normalizePhone,
  isValidRecord,
  calculateRecordTotal,
  formatRecordDatetime,
  AltegioRecord,
  AltegioWebhookPayload,
} from '../adapters/altegio.js';

// ============================================================================
// Types
// ============================================================================

interface WebhookQueryParams {
  user_id?: string;
  account_id?: string; // For multi-account mode
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Find lead by phone number
 */
async function findLeadByPhone(
  userAccountId: string,
  phone: string
): Promise<{ id: number; chat_id: string; is_qualified: boolean } | null> {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return null;

  // Search for lead with matching phone (chat_id contains phone)
  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, chat_id, is_qualified')
    .eq('user_account_id', userAccountId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error || !leads) {
    console.error('Error finding leads:', error);
    return null;
  }

  // Find lead with matching phone
  for (const lead of leads) {
    const leadPhone = normalizePhone(lead.chat_id);
    if (leadPhone && leadPhone.endsWith(normalizedPhone)) {
      return lead;
    }
    if (leadPhone && normalizedPhone.endsWith(leadPhone)) {
      return lead;
    }
  }

  return null;
}

/**
 * Qualify lead from Altegio appointment
 */
async function qualifyLeadFromAltegio(
  userAccountId: string,
  leadId: number,
  record: AltegioRecord,
  app: FastifyInstance
): Promise<void> {
  const now = new Date().toISOString();

  // Update lead with Altegio data and qualification
  const { error } = await supabase
    .from('leads')
    .update({
      is_qualified: true,
      qualified_source: 'altegio',
      qualified_at: now,
      altegio_client_id: record.client?.id || null,
      altegio_record_id: record.id,
    })
    .eq('id', leadId);

  if (error) {
    app.log.error({
      msg: 'Failed to qualify lead from Altegio',
      leadId,
      recordId: record.id,
      error: error.message,
    });
    throw error;
  }

  app.log.info({
    msg: 'Lead qualified from Altegio appointment',
    leadId,
    recordId: record.id,
    clientId: record.client?.id,
  });
}

/**
 * Save Altegio record to database
 */
async function saveAltegioRecord(
  userAccountId: string,
  record: AltegioRecord,
  leadId: number | null,
  webhookData: any
): Promise<void> {
  const serviceIds = record.services?.map((s) => s.id) || [];
  const serviceNames = record.services?.map((s) => s.title) || [];
  const totalCost = calculateRecordTotal(record);

  await supabase.from('altegio_records').upsert(
    {
      user_account_id: userAccountId,
      lead_id: leadId,
      altegio_record_id: record.id,
      altegio_client_id: record.client?.id || null,
      altegio_company_id: record.company_id,
      client_phone: record.client?.phone ? normalizePhone(record.client.phone) : null,
      client_name: record.client?.name || null,
      staff_id: record.staff_id,
      staff_name: record.staff?.name || null,
      service_ids: serviceIds,
      service_names: serviceNames,
      total_cost: totalCost,
      record_datetime: formatRecordDatetime(record.datetime).toISOString(),
      seance_length: record.seance_length,
      attendance: record.attendance,
      confirmed: record.confirmed || false,
      webhook_data: webhookData,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_account_id,altegio_record_id' }
  );
}

/**
 * Log sync operation
 */
async function logSyncOperation(
  userAccountId: string,
  syncType: string,
  data: {
    leadId?: number | null;
    recordId?: number;
    transactionId?: number;
    clientId?: number;
    webhookData?: any;
    error?: string;
  }
): Promise<void> {
  await supabase.from('altegio_sync_log').insert({
    user_account_id: userAccountId,
    lead_id: data.leadId || null,
    altegio_record_id: data.recordId || null,
    altegio_transaction_id: data.transactionId || null,
    altegio_client_id: data.clientId || null,
    sync_type: syncType,
    sync_status: data.error ? 'failed' : 'success',
    webhook_data: data.webhookData || null,
    error_message: data.error || null,
  });
}

// ============================================================================
// Webhook Handlers
// ============================================================================

/**
 * Handle record (appointment) created
 */
async function handleRecordCreated(
  userAccountId: string,
  payload: AltegioWebhookPayload,
  app: FastifyInstance,
  accountId?: string
): Promise<void> {
  const recordId = payload.resource_id;

  app.log.info({
    msg: 'Altegio record created webhook',
    userAccountId,
    accountId,
    recordId,
    companyId: payload.company_id,
  });

  try {
    // Get Altegio client
    const altegioResult = await getAltegioClient(userAccountId, accountId);
    if (!altegioResult) {
      throw new Error('Altegio not connected');
    }

    const { client, companyId } = altegioResult;

    // Fetch full record data
    const record = await client.getRecord(companyId, recordId);

    // Check if record is valid (not cancelled)
    if (!isValidRecord(record)) {
      app.log.info({
        msg: 'Skipping invalid/cancelled record',
        recordId,
        attendance: record.attendance,
      });
      await logSyncOperation(userAccountId, 'record_created', {
        recordId,
        webhookData: payload,
        error: 'Record is cancelled or deleted',
      });
      return;
    }

    // Get client phone
    const clientPhone = record.client?.phone;
    if (!clientPhone) {
      app.log.info({ msg: 'Record has no client phone', recordId });
      await logSyncOperation(userAccountId, 'record_created', {
        recordId,
        webhookData: payload,
        error: 'No client phone',
      });
      return;
    }

    // Find matching lead
    const lead = await findLeadByPhone(userAccountId, clientPhone);

    // Save record to database
    await saveAltegioRecord(userAccountId, record, lead?.id || null, payload);

    if (lead) {
      // Qualify the lead (Altegio has priority)
      await qualifyLeadFromAltegio(userAccountId, lead.id, record, app);

      await logSyncOperation(userAccountId, 'qualification_set', {
        leadId: lead.id,
        recordId,
        clientId: record.client?.id,
        webhookData: payload,
      });
    } else {
      app.log.info({
        msg: 'No matching lead found for Altegio record',
        recordId,
        clientPhone: normalizePhone(clientPhone),
      });

      await logSyncOperation(userAccountId, 'record_created', {
        recordId,
        clientId: record.client?.id,
        webhookData: payload,
      });
    }
  } catch (error: any) {
    app.log.error({
      msg: 'Error processing Altegio record webhook',
      error: error.message,
      recordId,
      userAccountId,
    });

    await logSyncOperation(userAccountId, 'record_created', {
      recordId,
      webhookData: payload,
      error: error.message,
    });
  }
}

/**
 * Handle record (appointment) updated
 */
async function handleRecordUpdated(
  userAccountId: string,
  payload: AltegioWebhookPayload,
  app: FastifyInstance,
  accountId?: string
): Promise<void> {
  const recordId = payload.resource_id;

  app.log.info({
    msg: 'Altegio record updated webhook',
    userAccountId,
    accountId,
    recordId,
  });

  try {
    const altegioResult = await getAltegioClient(userAccountId, accountId);
    if (!altegioResult) {
      throw new Error('Altegio not connected');
    }

    const { client, companyId } = altegioResult;
    const record = await client.getRecord(companyId, recordId);

    // Find existing record in our database
    const { data: existingRecord } = await supabase
      .from('altegio_records')
      .select('lead_id')
      .eq('user_account_id', userAccountId)
      .eq('altegio_record_id', recordId)
      .single();

    // Update record in database
    await saveAltegioRecord(userAccountId, record, existingRecord?.lead_id || null, payload);

    // If record was cancelled and we had a lead, we might want to update qualification
    // But per requirements, we keep historical qualification data
    // So we just log the update

    await logSyncOperation(userAccountId, 'record_updated', {
      leadId: existingRecord?.lead_id,
      recordId,
      webhookData: payload,
    });
  } catch (error: any) {
    app.log.error({
      msg: 'Error processing Altegio record update webhook',
      error: error.message,
      recordId,
    });

    await logSyncOperation(userAccountId, 'record_updated', {
      recordId,
      webhookData: payload,
      error: error.message,
    });
  }
}

/**
 * Handle financial transaction created (for ROI)
 */
async function handleTransactionCreated(
  userAccountId: string,
  payload: AltegioWebhookPayload,
  app: FastifyInstance,
  accountId?: string
): Promise<void> {
  const transactionId = payload.resource_id;

  app.log.info({
    msg: 'Altegio transaction created webhook',
    userAccountId,
    accountId,
    transactionId,
  });

  try {
    const altegioResult = await getAltegioClient(userAccountId, accountId);
    if (!altegioResult) {
      throw new Error('Altegio not connected');
    }

    const { client, companyId } = altegioResult;
    const transaction = await client.getTransaction(companyId, transactionId);

    // Only process income transactions (payments)
    if (transaction.type_id !== 1) {
      app.log.info({
        msg: 'Skipping non-income transaction',
        transactionId,
        typeId: transaction.type_id,
      });
      return;
    }

    // Get client info if available
    let clientPhone: string | null = null;
    let clientName: string | null = null;
    let leadId: number | null = null;

    if (transaction.client_id) {
      try {
        const clientData = await client.getClient(companyId, transaction.client_id);
        clientPhone = normalizePhone(clientData.phone);
        clientName = clientData.name;

        // Find matching lead
        if (clientPhone) {
          const lead = await findLeadByPhone(userAccountId, clientPhone);
          leadId = lead?.id || null;
        }
      } catch (err) {
        app.log.warn({
          msg: 'Could not fetch client for transaction',
          clientId: transaction.client_id,
        });
      }
    }

    // Save transaction to altegio_transactions
    await supabase.from('altegio_transactions').upsert(
      {
        user_account_id: userAccountId,
        lead_id: leadId,
        altegio_transaction_id: transaction.id,
        altegio_record_id: transaction.record_id || null,
        altegio_client_id: transaction.client_id || null,
        altegio_company_id: companyId,
        client_phone: clientPhone,
        client_name: clientName,
        amount: transaction.amount,
        transaction_type: transaction.type_id,
        payment_type: transaction.account_id,
        webhook_data: payload,
      },
      { onConflict: 'user_account_id,altegio_transaction_id' }
    );

    // Create or update sale record for ROI calculation
    if (clientPhone && transaction.amount > 0) {
      await supabase.from('sales').upsert(
        {
          user_account_id: userAccountId,
          client_phone: clientPhone,
          amount: transaction.amount,
          altegio_record_id: transaction.record_id || null,
          altegio_transaction_id: transaction.id,
          created_at: transaction.create_date || new Date().toISOString(),
        },
        {
          onConflict: 'altegio_transaction_id',
          ignoreDuplicates: false,
        }
      );

      // Update lead's sale_amount if we have a lead
      if (leadId) {
        // Get total sales for this lead
        const { data: sales } = await supabase
          .from('sales')
          .select('amount')
          .eq('user_account_id', userAccountId)
          .eq('client_phone', clientPhone);

        const totalSales = sales?.reduce((sum, s) => sum + (s.amount || 0), 0) || 0;

        await supabase
          .from('leads')
          .update({ sale_amount: totalSales })
          .eq('id', leadId);

        app.log.info({
          msg: 'Updated lead sale_amount from Altegio transaction',
          leadId,
          totalSales,
          transactionAmount: transaction.amount,
        });
      }
    }

    await logSyncOperation(userAccountId, 'transaction_created', {
      leadId,
      transactionId: transaction.id,
      recordId: transaction.record_id,
      clientId: transaction.client_id,
      webhookData: payload,
    });
  } catch (error: any) {
    app.log.error({
      msg: 'Error processing Altegio transaction webhook',
      error: error.message,
      transactionId,
    });

    await logSyncOperation(userAccountId, 'transaction_created', {
      transactionId,
      webhookData: payload,
      error: error.message,
    });
  }
}

// ============================================================================
// Route Registration
// ============================================================================

export async function altegioWebhooksRoutes(app: FastifyInstance) {
  /**
   * POST /webhooks/altegio
   * Main webhook endpoint for Altegio events
   * Supports both legacy mode (user_id) and multi-account mode (account_id)
   */
  app.post('/webhooks/altegio', async (request: FastifyRequest, reply: FastifyReply) => {
    const { user_id: userAccountId, account_id: accountId } = request.query as WebhookQueryParams;

    if (!userAccountId) {
      app.log.warn('Altegio webhook received without user_id');
      return reply.status(400).send({ error: 'user_id query parameter is required' });
    }

    const payload = request.body as AltegioWebhookPayload;

    app.log.info({
      msg: 'Altegio webhook received',
      userAccountId,
      accountId,
      resource: payload.resource,
      status: payload.status,
      resourceId: payload.resource_id,
      companyId: payload.company_id,
    });

    // Respond immediately to prevent timeout
    reply.send({ success: true });

    // Process webhook asynchronously
    setImmediate(async () => {
      try {
        const resource = payload.resource;
        const status = payload.status;

        if (resource === 'record') {
          if (status === 'create') {
            await handleRecordCreated(userAccountId, payload, app, accountId);
          } else if (status === 'update') {
            await handleRecordUpdated(userAccountId, payload, app, accountId);
          }
          // 'delete' status can be handled if needed
        } else if (resource === 'finances_operation' || resource === 'goods_transaction') {
          if (status === 'create') {
            await handleTransactionCreated(userAccountId, payload, app, accountId);
          }
        } else if (resource === 'client') {
          // Client webhooks can be handled if needed
          app.log.info({
            msg: 'Altegio client webhook received (not processed)',
            status,
            clientId: payload.resource_id,
          });
        }
      } catch (error: any) {
        app.log.error({
          msg: 'Error processing Altegio webhook',
          error: error.message,
          stack: error.stack,
          payload,
        });
      }
    });
  });
}

export default altegioWebhooksRoutes;
