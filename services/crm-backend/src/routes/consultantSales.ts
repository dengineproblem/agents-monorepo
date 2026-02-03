import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { z } from 'zod';
import { ConsultantAuthRequest } from '../middleware/consultantAuth.js';

// ==================== SCHEMAS ====================

const CreateSaleSchema = z.object({
  lead_id: z.string().uuid().optional(),
  client_name: z.string().min(1).optional(),
  client_phone: z.string().min(1).optional(),
  amount: z.number().positive(),
  product_name: z.string().min(1),
  sale_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  comment: z.string().optional()
});

const UpdateSaleSchema = z.object({
  amount: z.number().positive().optional(),
  product_name: z.string().min(1).optional(),
  sale_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  comment: z.string().optional()
});

const SetSalesPlanSchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020).max(2100),
  plan_amount: z.number().positive()
});

/**
 * Routes для системы продаж консультантов
 */
export async function consultantSalesRoutes(app: FastifyInstance) {

  // ==================== CONSULTANT ROUTES ====================

  /**
   * GET /consultant/sales
   * Получить продажи консультанта
   */
  app.get('/consultant/sales', async (request: ConsultantAuthRequest, reply) => {
    try {
      const consultantId = (request.query as any)?.consultantId as string;
      const dateFrom = (request.query as any)?.date_from as string | undefined;
      const dateTo = (request.query as any)?.date_to as string | undefined;
      const search = (request.query as any)?.search as string | undefined;
      const productName = (request.query as any)?.product_name as string | undefined;
      const limit = parseInt((request.query as any)?.limit as string || '50');
      const offset = parseInt((request.query as any)?.offset as string || '0');

      if (!consultantId) {
        return reply.status(400).send({ error: 'consultantId is required' });
      }

      let query = supabase
        .from('purchases')
        .select('*')
        .eq('consultant_id', consultantId)
        .order('purchase_date', { ascending: false });

      if (dateFrom) {
        query = query.gte('purchase_date', dateFrom);
      }
      if (dateTo) {
        query = query.lte('purchase_date', dateTo);
      }
      if (search) {
        query = query.or(`client_name.ilike.%${search}%,client_phone.ilike.%${search}%`);
      }
      if (productName) {
        query = query.ilike('product_name', `%${productName}%`);
      }

      query = query.range(offset, offset + limit - 1);

      const { data, error, count } = await query;

      if (error) {
        app.log.error({ error }, 'Failed to fetch consultant sales');
        return reply.status(500).send({ error: error.message });
      }

      return reply.send({
        sales: data || [],
        total: count || 0
      });
    } catch (error: any) {
      app.log.error({ error }, 'Error fetching consultant sales');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /consultant/sales
   * Добавить продажу
   */
  app.post('/consultant/sales', async (request: ConsultantAuthRequest, reply) => {
    try {
      const consultantId = (request.query as any)?.consultantId as string;

      if (!consultantId) {
        return reply.status(400).send({ error: 'consultantId is required' });
      }

      const body = CreateSaleSchema.parse(request.body);

      let clientName = body.client_name || '';
      let clientPhone = body.client_phone || '';

      // Если указан lead_id, получаем данные из лида
      if (body.lead_id) {
        const { data: lead, error: leadError } = await supabase
          .from('dialog_analysis')
          .select('contact_name, contact_phone, chat_id')
          .eq('id', body.lead_id)
          .single();

        if (leadError || !lead) {
          return reply.status(404).send({ error: 'Lead not found' });
        }

        clientName = lead.contact_name || '';
        clientPhone = lead.chat_id || lead.contact_phone || '';
      }

      // Проверяем что есть хотя бы имя или телефон клиента
      if (!clientName && !clientPhone) {
        return reply.status(400).send({
          error: 'Client name or phone is required. Provide either lead_id or client_name/client_phone.'
        });
      }

      // Создаём продажу
      const { data: sale, error: saleError } = await supabase
        .from('purchases')
        .insert({
          consultant_id: consultantId,
          client_name: clientName,
          client_phone: clientPhone,
          amount: body.amount,
          product_name: body.product_name,
          purchase_date: body.sale_date,
          comment: body.comment,
          currency: 'KZT'
        })
        .select()
        .single();

      if (saleError) {
        app.log.error({ error: saleError }, 'Failed to create sale');
        return reply.status(500).send({ error: saleError.message });
      }

      app.log.info({
        consultantId,
        leadId: body.lead_id,
        amount: body.amount,
        productName: body.product_name
      }, 'Sale created by consultant');

      return reply.send(sale);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: error.errors });
      }
      app.log.error({ error }, 'Error creating sale');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * PUT /consultant/sales/:saleId
   * Редактировать продажу
   */
  app.put('/consultant/sales/:saleId', async (request: ConsultantAuthRequest, reply) => {
    try {
      const { saleId } = request.params as { saleId: string };
      const consultantId = (request.query as any)?.consultantId as string;

      if (!consultantId) {
        return reply.status(400).send({ error: 'consultantId is required' });
      }

      const body = UpdateSaleSchema.parse(request.body);

      // Проверяем что продажа принадлежит этому консультанту
      const { data: existingSale, error: checkError } = await supabase
        .from('purchases')
        .select('id')
        .eq('id', saleId)
        .eq('consultant_id', consultantId)
        .single();

      if (checkError || !existingSale) {
        return reply.status(404).send({ error: 'Sale not found or access denied' });
      }

      const updateData: any = {};
      if (body.amount !== undefined) updateData.amount = body.amount;
      if (body.product_name !== undefined) updateData.product_name = body.product_name;
      if (body.sale_date !== undefined) updateData.purchase_date = body.sale_date;
      if (body.comment !== undefined) updateData.comment = body.comment;

      const { data: sale, error: updateError } = await supabase
        .from('purchases')
        .update(updateData)
        .eq('id', saleId)
        .select()
        .single();

      if (updateError) {
        app.log.error({ error: updateError }, 'Failed to update sale');
        return reply.status(500).send({ error: updateError.message });
      }

      return reply.send(sale);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: error.errors });
      }
      app.log.error({ error }, 'Error updating sale');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * DELETE /consultant/sales/:saleId
   * Удалить продажу
   */
  app.delete('/consultant/sales/:saleId', async (request: ConsultantAuthRequest, reply) => {
    try {
      const { saleId } = request.params as { saleId: string };
      const consultantId = (request.query as any)?.consultantId as string;

      if (!consultantId) {
        return reply.status(400).send({ error: 'consultantId is required' });
      }

      // Проверяем что продажа принадлежит этому консультанту
      const { data: existingSale, error: checkError } = await supabase
        .from('purchases')
        .select('id')
        .eq('id', saleId)
        .eq('consultant_id', consultantId)
        .single();

      if (checkError || !existingSale) {
        return reply.status(404).send({ error: 'Sale not found or access denied' });
      }

      const { error: deleteError } = await supabase
        .from('purchases')
        .delete()
        .eq('id', saleId);

      if (deleteError) {
        app.log.error({ error: deleteError }, 'Failed to delete sale');
        return reply.status(500).send({ error: deleteError.message });
      }

      return reply.send({ success: true });
    } catch (error: any) {
      app.log.error({ error }, 'Error deleting sale');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /consultant/sales/stats
   * Получить статистику и прогресс к плану
   */
  app.get('/consultant/sales/stats', async (request: ConsultantAuthRequest, reply) => {
    try {
      const consultantId = (request.query as any)?.consultantId as string;
      const month = parseInt((request.query as any)?.month as string) || new Date().getMonth() + 1;
      const year = parseInt((request.query as any)?.year as string) || new Date().getFullYear();

      if (!consultantId) {
        return reply.status(400).send({ error: 'consultantId is required' });
      }

      // Получаем статистику из view
      const { data: stats, error: statsError } = await supabase
        .from('consultant_sales_stats')
        .select('*')
        .eq('consultant_id', consultantId)
        .single();

      if (statsError && statsError.code !== 'PGRST116') { // PGRST116 = no rows
        app.log.error({ error: statsError }, 'Failed to fetch sales stats');
        return reply.status(500).send({ error: statsError.message });
      }

      // Получаем план на указанный месяц
      const { data: plan, error: planError } = await supabase
        .from('sales_plans')
        .select('*')
        .eq('consultant_id', consultantId)
        .eq('period_year', year)
        .eq('period_month', month)
        .maybeSingle();

      app.log.info({
        consultantId,
        year,
        month,
        plan,
        planError
      }, 'Sales plan query result');

      // Если план не на текущий месяц, пересчитываем статистику
      let monthStats = stats || {
        total_sales_count: 0,
        total_sales_amount: 0,
        current_month_sales_count: 0,
        current_month_sales_amount: 0
      };

      // Если запрашивается не текущий месяц, пересчитываем
      const now = new Date();
      if (month !== now.getMonth() + 1 || year !== now.getFullYear()) {
        const startDate = `${year}-${month.toString().padStart(2, '0')}-01`;
        const endDate = new Date(year, month, 0).toISOString().split('T')[0];

        const { data: monthlySales, error: monthlyError } = await supabase
          .from('purchases')
          .select('id, amount')
          .eq('consultant_id', consultantId)
          .gte('purchase_date', startDate)
          .lte('purchase_date', endDate);

        if (!monthlyError && monthlySales) {
          monthStats = {
            ...monthStats,
            current_month_sales_count: monthlySales.length,
            current_month_sales_amount: monthlySales.reduce((sum, s) => sum + (s.amount || 0), 0)
          };
        }
      }

      const planAmount = plan?.plan_amount || 0;
      const currentMonthAmount = monthStats.current_month_sales_amount || 0;
      const progressPercent = planAmount > 0
        ? Math.round((currentMonthAmount / planAmount) * 100 * 10) / 10
        : 0;

      return reply.send({
        total_sales: monthStats.total_sales_count || 0,
        total_amount: monthStats.total_sales_amount || 0,
        plan_amount: planAmount,
        progress_percent: progressPercent,
        sales_count: monthStats.current_month_sales_count || 0,
        current_month_amount: currentMonthAmount
      });
    } catch (error: any) {
      app.log.error({ error }, 'Error fetching sales stats');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /consultant/sales/chart
   * Получить данные для графика продаж
   */
  app.get('/consultant/sales/chart', async (request: ConsultantAuthRequest, reply) => {
    try {
      const consultantId = (request.query as any)?.consultantId as string;
      const period = ((request.query as any)?.period as string) || 'month';
      const dateFrom = (request.query as any)?.date_from as string | undefined;
      const dateTo = (request.query as any)?.date_to as string | undefined;

      if (!consultantId) {
        return reply.status(400).send({ error: 'consultantId is required' });
      }

      // Определяем даты по умолчанию
      const now = new Date();
      const defaultDateTo = now.toISOString().split('T')[0];
      const defaultDateFrom = period === 'week'
        ? new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        : new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];

      const startDate = dateFrom || defaultDateFrom;
      const endDate = dateTo || defaultDateTo;

      const { data: sales, error } = await supabase
        .from('purchases')
        .select('purchase_date, amount')
        .eq('consultant_id', consultantId)
        .gte('purchase_date', startDate)
        .lte('purchase_date', endDate)
        .order('purchase_date');

      if (error) {
        app.log.error({ error }, 'Failed to fetch chart data');
        return reply.status(500).send({ error: error.message });
      }

      // Группируем по дням
      const grouped = (sales || []).reduce((acc: any, sale: any) => {
        const date = sale.purchase_date;
        if (!acc[date]) {
          acc[date] = { date, amount: 0, count: 0 };
        }
        acc[date].amount += sale.amount || 0;
        acc[date].count += 1;
        return acc;
      }, {});

      const chartData = Object.values(grouped);

      return reply.send(chartData);
    } catch (error: any) {
      app.log.error({ error }, 'Error fetching chart data');
      return reply.status(500).send({ error: error.message });
    }
  });

  // ==================== ADMIN ROUTES ====================

  /**
   * PUT /admin/consultants/:consultantId/sales-plan
   * Установить/обновить план продаж для консультанта (только админ)
   */
  app.put('/admin/consultants/:consultantId/sales-plan', async (request: ConsultantAuthRequest, reply) => {
    try {
      const { consultantId } = request.params as { consultantId: string };
      const userAccountId = request.headers['x-user-id'] as string;

      // Проверяем что пользователь - админ
      const { data: userAccount, error: userError } = await supabase
        .from('user_accounts')
        .select('role, is_tech_admin')
        .eq('id', userAccountId)
        .single();

      if (userError || (!userAccount?.is_tech_admin && userAccount?.role !== 'admin')) {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      const body = SetSalesPlanSchema.parse(request.body);

      // Проверяем что консультант существует
      const { data: consultant, error: consultantError } = await supabase
        .from('consultants')
        .select('id, name')
        .eq('id', consultantId)
        .single();

      if (consultantError || !consultant) {
        return reply.status(404).send({ error: 'Consultant not found' });
      }

      // Создаём или обновляем план
      const { data: plan, error: planError } = await supabase
        .from('sales_plans')
        .upsert({
          consultant_id: consultantId,
          period_year: body.year,
          period_month: body.month,
          plan_amount: body.plan_amount,
          currency: 'KZT'
        }, {
          onConflict: 'consultant_id,period_year,period_month'
        })
        .select()
        .single();

      if (planError) {
        app.log.error({ error: planError }, 'Failed to set sales plan');
        return reply.status(500).send({ error: planError.message });
      }

      app.log.info({
        consultantId,
        consultantName: consultant.name,
        month: body.month,
        year: body.year,
        planAmount: body.plan_amount,
        adminId: userAccountId
      }, 'Sales plan set by admin');

      return reply.send({
        success: true,
        plan,
        message: `План продаж установлен для ${consultant.name}`
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: error.errors });
      }
      app.log.error({ error }, 'Error setting sales plan');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /admin/sales/all
   * Получить продажи всех консультантов (только админ)
   */
  app.get('/admin/sales/all', async (request: ConsultantAuthRequest, reply) => {
    try {
      const userAccountId = request.headers['x-user-id'] as string;

      // Проверяем что пользователь - админ
      const { data: userAccount, error: userError } = await supabase
        .from('user_accounts')
        .select('role, is_tech_admin')
        .eq('id', userAccountId)
        .single();

      if (userError || (!userAccount?.is_tech_admin && userAccount?.role !== 'admin')) {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      const consultantId = (request.query as any)?.consultant_id as string | undefined;
      const dateFrom = (request.query as any)?.date_from as string | undefined;
      const dateTo = (request.query as any)?.date_to as string | undefined;

      let query = supabase
        .from('purchases')
        .select(`
          *,
          consultants (
            id,
            name
          )
        `)
        .not('consultant_id', 'is', null)
        .order('purchase_date', { ascending: false });

      if (consultantId) {
        query = query.eq('consultant_id', consultantId);
      }
      if (dateFrom) {
        query = query.gte('purchase_date', dateFrom);
      }
      if (dateTo) {
        query = query.lte('purchase_date', dateTo);
      }

      const { data, error } = await query;

      if (error) {
        app.log.error({ error }, 'Failed to fetch all consultant sales');
        return reply.status(500).send({ error: error.message });
      }

      return reply.send(data || []);
    } catch (error: any) {
      app.log.error({ error }, 'Error fetching all consultant sales');
      return reply.status(500).send({ error: error.message });
    }
  });
}
