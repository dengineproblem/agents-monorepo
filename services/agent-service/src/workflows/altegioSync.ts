/**
 * Altegio Synchronization Workflows
 *
 * Handles manual synchronization of:
 * - Records (appointments) → Lead qualification
 * - Transactions (payments) → Sales for ROI
 *
 * @module workflows/altegioSync
 */

import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { getAltegioClient } from '../lib/altegioTokens.js';
import {
  normalizePhone,
  isValidRecord,
  calculateRecordTotal,
  formatRecordDatetime,
  AltegioRecord,
  AltegioTransaction,
} from '../adapters/altegio.js';

// ============================================================================
// Types
// ============================================================================

export interface SyncRecordsResult {
  total: number;
  processed: number;
  qualified: number;
  skipped: number;
  errors: number;
}

export interface SyncTransactionsResult {
  total: number;
  processed: number;
  salesCreated: number;
  salesUpdated: number;
  errors: number;
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
): Promise<{ id: number; chat_id: string; is_qualified: boolean; qualified_source: string | null } | null> {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return null;

  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, chat_id, is_qualified, qualified_source')
    .eq('user_account_id', userAccountId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error || !leads) {
    return null;
  }

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
 * Get date range for sync (default: last 30 days)
 */
function getDateRange(startDate?: string, endDate?: string): { start: string; end: string } {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  return {
    start: startDate || thirtyDaysAgo.toISOString().split('T')[0],
    end: endDate || now.toISOString().split('T')[0],
  };
}

// ============================================================================
// Record Sync
// ============================================================================

/**
 * Sync records (appointments) from Altegio
 * Finds leads by phone and qualifies them based on appointments
 */
export async function syncRecordsFromAltegio(
  userAccountId: string,
  app: FastifyInstance,
  startDate?: string,
  endDate?: string
): Promise<SyncRecordsResult> {
  const result: SyncRecordsResult = {
    total: 0,
    processed: 0,
    qualified: 0,
    skipped: 0,
    errors: 0,
  };

  app.log.info({
    msg: 'Starting Altegio records sync',
    userAccountId,
    startDate,
    endDate,
  });

  // Get Altegio client
  const altegioResult = await getAltegioClient(userAccountId);
  if (!altegioResult) {
    throw new Error('Altegio not connected');
  }

  const { client, companyId } = altegioResult;
  const dateRange = getDateRange(startDate, endDate);

  // Fetch records from Altegio
  let allRecords: AltegioRecord[] = [];
  let page = 1;
  const pageSize = 200;

  while (true) {
    const records = await client.getRecords(companyId, {
      start_date: dateRange.start,
      end_date: dateRange.end,
      page,
      count: pageSize,
    });

    if (!records || records.length === 0) break;

    allRecords = allRecords.concat(records);
    result.total += records.length;

    if (records.length < pageSize) break;
    page++;

    // Avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  app.log.info({
    msg: 'Fetched Altegio records',
    total: allRecords.length,
    userAccountId,
  });

  // Process each record
  for (const record of allRecords) {
    try {
      // Skip invalid/cancelled records
      if (!isValidRecord(record)) {
        result.skipped++;
        continue;
      }

      // Get client phone
      const clientPhone = record.client?.phone;
      if (!clientPhone) {
        result.skipped++;
        continue;
      }

      // Find matching lead
      const lead = await findLeadByPhone(userAccountId, clientPhone);

      // Calculate service info
      const serviceIds = record.services?.map((s) => s.id) || [];
      const serviceNames = record.services?.map((s) => s.title) || [];
      const totalCost = calculateRecordTotal(record);

      // Upsert record to database
      await supabase.from('altegio_records').upsert(
        {
          user_account_id: userAccountId,
          lead_id: lead?.id || null,
          altegio_record_id: record.id,
          altegio_client_id: record.client?.id || null,
          altegio_company_id: record.company_id,
          client_phone: normalizePhone(clientPhone),
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
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_account_id,altegio_record_id' }
      );

      result.processed++;

      // Qualify lead if found and not already qualified from Altegio
      if (lead && (!lead.is_qualified || lead.qualified_source !== 'altegio')) {
        await supabase
          .from('leads')
          .update({
            is_qualified: true,
            qualified_source: 'altegio',
            qualified_at: new Date().toISOString(),
            altegio_client_id: record.client?.id || null,
            altegio_record_id: record.id,
          })
          .eq('id', lead.id);

        result.qualified++;

        app.log.info({
          msg: 'Lead qualified from Altegio sync',
          leadId: lead.id,
          recordId: record.id,
        });
      }
    } catch (error: any) {
      app.log.error({
        msg: 'Error processing Altegio record',
        error: error.message,
        recordId: record.id,
      });
      result.errors++;
    }
  }

  // Log sync operation
  await supabase.from('altegio_sync_log').insert({
    user_account_id: userAccountId,
    sync_type: 'manual_sync',
    sync_status: result.errors > 0 ? 'failed' : 'success',
    webhook_data: {
      type: 'records',
      dateRange,
      result,
    },
  });

  app.log.info({
    msg: 'Altegio records sync completed',
    userAccountId,
    result,
  });

  return result;
}

// ============================================================================
// Transaction Sync
// ============================================================================

/**
 * Sync financial transactions from Altegio
 * Creates/updates sales records for ROI calculation
 */
export async function syncTransactionsFromAltegio(
  userAccountId: string,
  app: FastifyInstance,
  startDate?: string,
  endDate?: string
): Promise<SyncTransactionsResult> {
  const result: SyncTransactionsResult = {
    total: 0,
    processed: 0,
    salesCreated: 0,
    salesUpdated: 0,
    errors: 0,
  };

  app.log.info({
    msg: 'Starting Altegio transactions sync',
    userAccountId,
    startDate,
    endDate,
  });

  // Get Altegio client
  const altegioResult = await getAltegioClient(userAccountId);
  if (!altegioResult) {
    throw new Error('Altegio not connected');
  }

  const { client, companyId } = altegioResult;
  const dateRange = getDateRange(startDate, endDate);

  // Fetch income transactions from Altegio
  let allTransactions: AltegioTransaction[] = [];
  let page = 1;
  const pageSize = 200;

  while (true) {
    const transactions = await client.getTransactions(companyId, {
      start_date: dateRange.start,
      end_date: dateRange.end,
      type_id: 1, // income only
      page,
      count: pageSize,
    });

    if (!transactions || transactions.length === 0) break;

    allTransactions = allTransactions.concat(transactions);
    result.total += transactions.length;

    if (transactions.length < pageSize) break;
    page++;

    // Avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  app.log.info({
    msg: 'Fetched Altegio transactions',
    total: allTransactions.length,
    userAccountId,
  });

  // Process each transaction
  for (const transaction of allTransactions) {
    try {
      // Skip non-income transactions (double check)
      if (transaction.type_id !== 1) {
        continue;
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

          if (clientPhone) {
            const lead = await findLeadByPhone(userAccountId, clientPhone);
            leadId = lead?.id || null;
          }
        } catch (err) {
          // Client fetch failed, continue without client info
        }

        // Small delay for rate limiting
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Upsert transaction to database
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
        },
        { onConflict: 'user_account_id,altegio_transaction_id' }
      );

      result.processed++;

      // Create/update sale record for ROI
      if (clientPhone && transaction.amount > 0) {
        // Check if sale exists
        const { data: existingSale } = await supabase
          .from('sales')
          .select('id')
          .eq('altegio_transaction_id', transaction.id)
          .single();

        if (existingSale) {
          // Update existing sale
          await supabase
            .from('sales')
            .update({
              amount: transaction.amount,
              client_phone: clientPhone,
            })
            .eq('id', existingSale.id);

          result.salesUpdated++;
        } else {
          // Create new sale
          await supabase.from('sales').insert({
            user_account_id: userAccountId,
            client_phone: clientPhone,
            amount: transaction.amount,
            altegio_record_id: transaction.record_id || null,
            altegio_transaction_id: transaction.id,
            created_at: transaction.create_date || new Date().toISOString(),
          });

          result.salesCreated++;
        }

        // Update lead's sale_amount if we have a lead
        if (leadId) {
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
        }
      }
    } catch (error: any) {
      app.log.error({
        msg: 'Error processing Altegio transaction',
        error: error.message,
        transactionId: transaction.id,
      });
      result.errors++;
    }
  }

  // Log sync operation
  await supabase.from('altegio_sync_log').insert({
    user_account_id: userAccountId,
    sync_type: 'manual_sync',
    sync_status: result.errors > 0 ? 'failed' : 'success',
    webhook_data: {
      type: 'transactions',
      dateRange,
      result,
    },
  });

  app.log.info({
    msg: 'Altegio transactions sync completed',
    userAccountId,
    result,
  });

  return result;
}

/**
 * Get qualification source priority
 * Returns which CRM should be used for qualification based on connections
 */
export async function getQualificationSource(
  userAccountId: string
): Promise<'altegio' | 'amocrm' | 'bitrix24' | null> {
  const { data: account, error } = await supabase
    .from('user_accounts')
    .select('altegio_connected_at, amocrm_subdomain, bitrix24_connected_at')
    .eq('id', userAccountId)
    .single();

  if (error || !account) {
    return null;
  }

  // Priority: Altegio > AMO/Bitrix
  if (account.altegio_connected_at) {
    return 'altegio';
  }

  if (account.bitrix24_connected_at) {
    return 'bitrix24';
  }

  if (account.amocrm_subdomain) {
    return 'amocrm';
  }

  return null;
}
