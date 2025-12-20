/**
 * Altegio API Routes
 *
 * Provides endpoints for:
 * - Manual sync of records and transactions
 * - Getting qualified leads stats
 * - Viewing sync logs
 *
 * @module routes/altegioApi
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { getAltegioClient } from '../lib/altegioTokens.js';
import { syncRecordsFromAltegio, syncTransactionsFromAltegio } from '../workflows/altegioSync.js';

// ============================================================================
// Route Registration
// ============================================================================

export async function altegioApiRoutes(app: FastifyInstance) {
  /**
   * POST /altegio/sync-records
   * Manually sync records (appointments) from Altegio
   * This will find and qualify leads based on appointments
   * Supports both legacy mode (userAccountId) and multi-account mode (accountId)
   */
  app.post('/altegio/sync-records', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userAccountId, accountId, startDate, endDate } = request.body as {
      userAccountId: string;
      accountId?: string;
      startDate?: string;
      endDate?: string;
    };

    if (!userAccountId) {
      return reply.status(400).send({ error: 'userAccountId is required' });
    }

    try {
      const result = await syncRecordsFromAltegio(userAccountId, app, startDate, endDate, accountId);

      return reply.send({
        success: true,
        ...result,
      });
    } catch (error: any) {
      app.log.error({
        msg: 'Failed to sync Altegio records',
        error: error.message,
        userAccountId,
        accountId,
      });

      return reply.status(500).send({
        error: error.message || 'Failed to sync records',
      });
    }
  });

  /**
   * POST /altegio/sync-transactions
   * Manually sync financial transactions from Altegio
   * This will update sales data for ROI calculation
   * Supports both legacy mode (userAccountId) and multi-account mode (accountId)
   */
  app.post('/altegio/sync-transactions', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userAccountId, accountId, startDate, endDate } = request.body as {
      userAccountId: string;
      accountId?: string;
      startDate?: string;
      endDate?: string;
    };

    if (!userAccountId) {
      return reply.status(400).send({ error: 'userAccountId is required' });
    }

    try {
      const result = await syncTransactionsFromAltegio(userAccountId, app, startDate, endDate, accountId);

      return reply.send({
        success: true,
        ...result,
      });
    } catch (error: any) {
      app.log.error({
        msg: 'Failed to sync Altegio transactions',
        error: error.message,
        userAccountId,
        accountId,
      });

      return reply.status(500).send({
        error: error.message || 'Failed to sync transactions',
      });
    }
  });

  /**
   * POST /altegio/sync-all
   * Sync both records and transactions
   * Supports both legacy mode (userAccountId) and multi-account mode (accountId)
   */
  app.post('/altegio/sync-all', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userAccountId, accountId, startDate, endDate } = request.body as {
      userAccountId: string;
      accountId?: string;
      startDate?: string;
      endDate?: string;
    };

    if (!userAccountId) {
      return reply.status(400).send({ error: 'userAccountId is required' });
    }

    try {
      const [recordsResult, transactionsResult] = await Promise.all([
        syncRecordsFromAltegio(userAccountId, app, startDate, endDate, accountId),
        syncTransactionsFromAltegio(userAccountId, app, startDate, endDate, accountId),
      ]);

      return reply.send({
        success: true,
        records: recordsResult,
        transactions: transactionsResult,
      });
    } catch (error: any) {
      app.log.error({
        msg: 'Failed to sync Altegio data',
        error: error.message,
        userAccountId,
        accountId,
      });

      return reply.status(500).send({
        error: error.message || 'Failed to sync',
      });
    }
  });

  /**
   * GET /altegio/records
   * Get synced Altegio records for a user
   */
  app.get('/altegio/records', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userAccountId, limit, offset } = request.query as {
      userAccountId: string;
      limit?: string;
      offset?: string;
    };

    if (!userAccountId) {
      return reply.status(400).send({ error: 'userAccountId is required' });
    }

    const { data, error, count } = await supabase
      .from('altegio_records')
      .select('*', { count: 'exact' })
      .eq('user_account_id', userAccountId)
      .order('record_datetime', { ascending: false })
      .range(
        parseInt(offset || '0'),
        parseInt(offset || '0') + parseInt(limit || '50') - 1
      );

    if (error) {
      return reply.status(500).send({ error: error.message });
    }

    return reply.send({
      records: data,
      total: count,
    });
  });

  /**
   * GET /altegio/transactions
   * Get synced Altegio transactions for a user
   */
  app.get('/altegio/transactions', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userAccountId, limit, offset } = request.query as {
      userAccountId: string;
      limit?: string;
      offset?: string;
    };

    if (!userAccountId) {
      return reply.status(400).send({ error: 'userAccountId is required' });
    }

    const { data, error, count } = await supabase
      .from('altegio_transactions')
      .select('*', { count: 'exact' })
      .eq('user_account_id', userAccountId)
      .order('created_at', { ascending: false })
      .range(
        parseInt(offset || '0'),
        parseInt(offset || '0') + parseInt(limit || '50') - 1
      );

    if (error) {
      return reply.status(500).send({ error: error.message });
    }

    return reply.send({
      transactions: data,
      total: count,
    });
  });

  /**
   * GET /altegio/sync-log
   * Get Altegio sync log entries
   */
  app.get('/altegio/sync-log', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userAccountId, limit, syncType } = request.query as {
      userAccountId: string;
      limit?: string;
      syncType?: string;
    };

    if (!userAccountId) {
      return reply.status(400).send({ error: 'userAccountId is required' });
    }

    let query = supabase
      .from('altegio_sync_log')
      .select('*')
      .eq('user_account_id', userAccountId)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit || '100'));

    if (syncType) {
      query = query.eq('sync_type', syncType);
    }

    const { data, error } = await query;

    if (error) {
      return reply.status(500).send({ error: error.message });
    }

    return reply.send({ logs: data });
  });

  /**
   * GET /altegio/qualified-leads
   * Get leads qualified via Altegio
   */
  app.get('/altegio/qualified-leads', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userAccountId, dateFrom, dateTo } = request.query as {
      userAccountId: string;
      dateFrom?: string;
      dateTo?: string;
    };

    if (!userAccountId) {
      return reply.status(400).send({ error: 'userAccountId is required' });
    }

    let query = supabase
      .from('leads')
      .select('id, chat_id, is_qualified, qualified_source, qualified_at, altegio_client_id, altegio_record_id, created_at')
      .eq('user_account_id', userAccountId)
      .eq('qualified_source', 'altegio')
      .eq('is_qualified', true);

    if (dateFrom) {
      query = query.gte('qualified_at', dateFrom);
    }
    if (dateTo) {
      query = query.lte('qualified_at', dateTo);
    }

    const { data, error, count } = await query
      .order('qualified_at', { ascending: false });

    if (error) {
      return reply.status(500).send({ error: error.message });
    }

    return reply.send({
      leads: data,
      count: data?.length || 0,
    });
  });

  /**
   * GET /altegio/stats
   * Get Altegio integration statistics
   */
  app.get('/altegio/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userAccountId, dateFrom, dateTo } = request.query as {
      userAccountId: string;
      dateFrom?: string;
      dateTo?: string;
    };

    if (!userAccountId) {
      return reply.status(400).send({ error: 'userAccountId is required' });
    }

    // Build date filter
    const dateFilter: any = {};
    if (dateFrom) dateFilter.gte = dateFrom;
    if (dateTo) dateFilter.lte = dateTo;

    // Get counts in parallel
    const [
      qualifiedLeadsResult,
      totalRecordsResult,
      totalTransactionsResult,
      totalRevenueResult,
    ] = await Promise.all([
      // Qualified leads count
      supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('user_account_id', userAccountId)
        .eq('qualified_source', 'altegio')
        .eq('is_qualified', true),

      // Total records count
      supabase
        .from('altegio_records')
        .select('id', { count: 'exact', head: true })
        .eq('user_account_id', userAccountId),

      // Total transactions count
      supabase
        .from('altegio_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('user_account_id', userAccountId)
        .eq('transaction_type', 1), // income only

      // Total revenue
      supabase
        .from('altegio_transactions')
        .select('amount')
        .eq('user_account_id', userAccountId)
        .eq('transaction_type', 1),
    ]);

    const totalRevenue = totalRevenueResult.data?.reduce(
      (sum, t) => sum + (t.amount || 0),
      0
    ) || 0;

    return reply.send({
      qualifiedLeads: qualifiedLeadsResult.count || 0,
      totalRecords: totalRecordsResult.count || 0,
      totalTransactions: totalTransactionsResult.count || 0,
      totalRevenue,
    });
  });

  /**
   * GET /altegio/company
   * Get connected Altegio company info
   * Supports both legacy mode (userAccountId) and multi-account mode (accountId)
   */
  app.get('/altegio/company', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userAccountId, accountId } = request.query as { userAccountId: string; accountId?: string };

    if (!userAccountId) {
      return reply.status(400).send({ error: 'userAccountId is required' });
    }

    const altegioResult = await getAltegioClient(userAccountId, accountId);

    if (!altegioResult) {
      return reply.status(404).send({ error: 'Altegio not connected' });
    }

    try {
      const company = await altegioResult.client.getCompany(altegioResult.companyId);

      return reply.send({
        id: company.id,
        title: company.title,
        publicTitle: company.public_title,
        city: company.city,
        address: company.address,
        phone: company.phone,
        email: company.email,
        timezone: company.timezone_name,
      });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });
}

export default altegioApiRoutes;
