import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { consultantAuthMiddleware, ConsultantAuthRequest } from '../middleware/consultantAuth.js';

// ==================== VALIDATION SCHEMAS ====================

const CreateSaleSchema = z.object({
  lead_id: z.string().uuid(),
  amount: z.number().min(0),
  product_name: z.string().min(1),
  sale_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  comment: z.string().optional()
});

const UpdateSaleSchema = z.object({
  amount: z.number().min(0).optional(),
  product_name: z.string().min(1).optional(),
  sale_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  comment: z.string().optional()
});

const SetSalesPlanSchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020).max(2100),
  plan_amount: z.number().min(0)
});

// ==================== CONSULTANT SALES ROUTES ====================

export async function consultantSalesRoutes(app: FastifyInstance) {
  // Применяем middleware ко всем роутам
  app.addHook('preHandler', consultantAuthMiddleware);

  /**
   * GET /consultant/sales
   * Получить список продаж консультанта
   */
  app.get('/consultant/sales', async (request: ConsultantAuthRequest, reply) => {
    try {
      const isAdmin = request.userRole === 'admin';
      const consultantIdFromQuery = (request.query as any).consultantId;

      // Для админа берём consultantId из query, для консультанта из request.consultant
      const consultantId = isAdmin
        ? consultantIdFromQuery || request.consultant?.id
        : request.consultant?.id;

      if (!consultantId) {
        return reply.status(403).send({ error: 'Consultant authentication required' });
      }

      const query = request.query as {
        date_from?: string;
        date_to?: string;
        search?: string;
        product_name?: string;
        limit?: string;
        offset?: string;
      };

      // Базовый запрос
      let dbQuery = supabase
        .from('purchases')
        .select(`
          id,
          consultant_id,
          client_phone,
          amount,
          notes,
          purchase_date
        `)
        .eq('consultant_id', consultantId)
        .order('purchase_date', { ascending: false });

      // Фильтр по дате от
      if (query.date_from) {
        dbQuery = dbQuery.gte('purchase_date', query.date_from);
      }

      // Фильтр по дате до
      if (query.date_to) {
        dbQuery = dbQuery.lte('purchase_date', query.date_to);
      }

      // Поиск по телефону клиента
      if (query.search) {
        dbQuery = dbQuery.ilike('client_phone', `%${query.search}%`);
      }

      // Фильтр по notes
      if (query.product_name) {
        dbQuery = dbQuery.ilike('notes', `%${query.product_name}%`);
      }

      // Пагинация
      const limit = query.limit ? parseInt(query.limit) : 100;
      const offset = query.offset ? parseInt(query.offset) : 0;
      dbQuery = dbQuery.range(offset, offset + limit - 1);

      const { data, error, count } = await dbQuery;

      if (error) {
        app.log.error({ error }, 'Failed to fetch consultant sales');
        return reply.status(500).send({ error: error.message });
      }

      // Получаем общее количество записей
      const { count: totalCount } = await supabase
        .from('purchases')
        .select('*', { count: 'exact', head: true })
        .eq('consultant_id', consultantId);

      return reply.send({
        sales: data || [],
        total: totalCount || 0
      });
    } catch (error: any) {
      app.log.error({ error }, 'Error fetching consultant sales');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /consultant/sales
   * Добавить новую продажу
   */
  app.post('/consultant/sales', async (request: ConsultantAuthRequest, reply) => {
    try {
      const consultantId = request.consultant?.id;

      if (!consultantId) {
        return reply.status(403).send({ error: 'Consultant authentication required' });
      }

      const body = CreateSaleSchema.parse(request.body);

      // Получаем информацию о лиде
      const { data: lead, error: leadError } = await supabase
        .from('dialog_analysis')
        .select('contact_name, contact_phone, chat_id')
        .eq('id', body.lead_id)
        .single();

      if (leadError || !lead) {
        return reply.status(404).send({ error: 'Lead not found' });
      }

      // Создаём продажу
      const { data: sale, error: saleError } = await supabase
        .from('purchases')
        .insert({
          consultant_id: consultantId,
          client_phone: lead.contact_phone || lead.chat_id,
          amount: body.amount,
          notes: body.product_name // Используем notes для хранения названия продукта
        })
        .select()
        .single();

      if (saleError) {
        app.log.error({ error: saleError }, 'Failed to create sale');
        return reply.status(500).send({ error: saleError.message });
      }

      app.log.info({
        consultantId,
        saleId: sale.id,
        leadId: body.lead_id,
        amount: body.amount
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
   * Обновить продажу
   */
  app.put('/consultant/sales/:saleId', async (request: ConsultantAuthRequest, reply) => {
    try {
      const consultantId = request.consultant?.id;
      const { saleId } = request.params as { saleId: string };

      if (!consultantId) {
        return reply.status(403).send({ error: 'Consultant authentication required' });
      }

      const body = UpdateSaleSchema.parse(request.body);

      // Проверяем что продажа принадлежит консультанту
      const { data: existingSale, error: checkError } = await supabase
        .from('purchases')
        .select('id, consultant_id')
        .eq('id', saleId)
        .single();

      if (checkError || !existingSale) {
        return reply.status(404).send({ error: 'Sale not found' });
      }

      if (existingSale.consultant_id !== consultantId) {
        return reply.status(403).send({ error: 'You can only edit your own sales' });
      }

      // Обновляем продажу
      const updateData: any = {};
      if (body.amount !== undefined) updateData.amount = body.amount;
      if (body.product_name !== undefined) updateData.notes = body.product_name;

      const { data: updatedSale, error: updateError } = await supabase
        .from('purchases')
        .update(updateData)
        .eq('id', saleId)
        .select()
        .single();

      if (updateError) {
        app.log.error({ error: updateError }, 'Failed to update sale');
        return reply.status(500).send({ error: updateError.message });
      }

      app.log.info({
        consultantId,
        saleId,
        updatedFields: Object.keys(updateData)
      }, 'Sale updated by consultant');

      return reply.send(updatedSale);
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
      const consultantId = request.consultant?.id;
      const { saleId } = request.params as { saleId: string };

      if (!consultantId) {
        return reply.status(403).send({ error: 'Consultant authentication required' });
      }

      // Проверяем что продажа принадлежит консультанту
      const { data: existingSale, error: checkError } = await supabase
        .from('purchases')
        .select('id, consultant_id')
        .eq('id', saleId)
        .single();

      if (checkError || !existingSale) {
        return reply.status(404).send({ error: 'Sale not found' });
      }

      if (existingSale.consultant_id !== consultantId) {
        return reply.status(403).send({ error: 'You can only delete your own sales' });
      }

      // Удаляем продажу
      const { error: deleteError } = await supabase
        .from('purchases')
        .delete()
        .eq('id', saleId);

      if (deleteError) {
        app.log.error({ error: deleteError }, 'Failed to delete sale');
        return reply.status(500).send({ error: deleteError.message });
      }

      app.log.info({
        consultantId,
        saleId
      }, 'Sale deleted by consultant');

      return reply.send({ success: true, message: 'Sale deleted successfully' });
    } catch (error: any) {
      app.log.error({ error }, 'Error deleting sale');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /consultant/sales/stats
   * Получить статистику продаж консультанта
   */
  app.get('/consultant/sales/stats', async (request: ConsultantAuthRequest, reply) => {
    try {
      const isAdmin = request.userRole === 'admin';
      const consultantIdFromQuery = (request.query as any).consultantId;

      // Для админа берём consultantId из query, для консультанта из request.consultant
      const consultantId = isAdmin
        ? consultantIdFromQuery || request.consultant?.id
        : request.consultant?.id;

      if (!consultantId) {
        return reply.status(403).send({ error: 'Consultant authentication required' });
      }

      const query = request.query as {
        month?: string;
        year?: string;
      };

      const currentDate = new Date();
      const month = query.month ? parseInt(query.month) : currentDate.getMonth() + 1;
      const year = query.year ? parseInt(query.year) : currentDate.getFullYear();

      // Получаем статистику из view
      const { data: viewStats, error: viewError } = await supabase
        .from('consultant_sales_stats')
        .select('*')
        .eq('consultant_id', consultantId)
        .single();

      if (viewError && viewError.code !== 'PGRST116') { // PGRST116 = no rows
        app.log.error({ error: viewError }, 'Failed to fetch consultant stats from view');
      }

      // Если нужны данные за конкретный месяц (не текущий), делаем отдельный запрос
      let monthStats = null;
      if (month !== currentDate.getMonth() + 1 || year !== currentDate.getFullYear()) {
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const endDate = new Date(year, month, 0);
        const endDateStr = `${year}-${String(month).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;

        const { data: salesData, error: salesError } = await supabase
          .from('purchases')
          .select('amount')
          .eq('consultant_id', consultantId)
          .gte('purchase_date', startDate)
          .lte('purchase_date', endDateStr);

        if (!salesError && salesData) {
          const totalAmount = salesData.reduce((sum, sale) => sum + (sale.amount || 0), 0);
          monthStats = {
            sales_count: salesData.length,
            total_amount: totalAmount
          };
        }
      }

      // Получаем план на указанный месяц
      const { data: plan, error: planError } = await supabase
        .from('sales_plans')
        .select('plan_amount')
        .eq('consultant_id', consultantId)
        .eq('period_year', year)
        .eq('period_month', month)
        .maybeSingle();

      app.log.info({
        consultantId,
        year,
        month,
        plan: plan,
        planError: planError
      }, 'Sales plan query result');

      if (planError && planError.code !== 'PGRST116') {
        app.log.error({ error: planError }, 'Failed to fetch sales plan');
      }

      // Формируем ответ
      const stats = monthStats || {
        sales_count: viewStats?.current_month_sales_count || 0,
        total_amount: viewStats?.current_month_sales_amount || 0
      };

      const planAmount = plan?.plan_amount || 0;
      const progressPercent = planAmount > 0
        ? Math.round((stats.total_amount / planAmount) * 100 * 10) / 10
        : 0;

      return reply.send({
        total_sales: viewStats?.total_sales_count || 0,
        total_amount: stats.total_amount,
        plan_amount: planAmount,
        progress_percent: progressPercent,
        sales_count: stats.sales_count
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
      const isAdmin = request.userRole === 'admin';
      const consultantIdFromQuery = (request.query as any).consultantId;

      // Для админа берём consultantId из query, для консультанта из request.consultant
      const consultantId = isAdmin
        ? consultantIdFromQuery || request.consultant?.id
        : request.consultant?.id;

      if (!consultantId) {
        return reply.status(403).send({ error: 'Consultant authentication required' });
      }

      const query = request.query as {
        period: 'week' | 'month';
        date_from?: string;
        date_to?: string;
      };

      const period = query.period || 'month';
      let dateFrom = query.date_from;
      let dateTo = query.date_to;

      // Если даты не указаны, устанавливаем по умолчанию
      if (!dateFrom || !dateTo) {
        const now = new Date();
        dateTo = now.toISOString().split('T')[0];

        if (period === 'week') {
          const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          dateFrom = weekAgo.toISOString().split('T')[0];
        } else {
          const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
          dateFrom = monthAgo.toISOString().split('T')[0];
        }
      }

      // Получаем продажи за период
      const { data: sales, error } = await supabase
        .from('purchases')
        .select('purchase_date, amount')
        .eq('consultant_id', consultantId)
        .gte('purchase_date', dateFrom)
        .lte('purchase_date', dateTo)
        .order('purchase_date', { ascending: true });

      if (error) {
        app.log.error({ error }, 'Failed to fetch sales for chart');
        return reply.status(500).send({ error: error.message });
      }

      // Группируем по датам
      const chartData: { [key: string]: { amount: number; count: number } } = {};

      (sales || []).forEach(sale => {
        const date = sale.purchase_date;
        if (!chartData[date]) {
          chartData[date] = { amount: 0, count: 0 };
        }
        chartData[date].amount += sale.amount || 0;
        chartData[date].count += 1;
      });

      // Преобразуем в массив
      const result = Object.entries(chartData).map(([date, data]) => ({
        date,
        amount: data.amount,
        count: data.count
      }));

      return reply.send(result);
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

      const query = request.query as {
        consultant_id?: string;
        date_from?: string;
        date_to?: string;
        limit?: string;
        offset?: string;
      };

      // Базовый запрос
      let dbQuery = supabase
        .from('purchases')
        .select(`
          id,
          consultant_id,
          client_phone,
          amount,
          notes,
          purchase_date,
          consultants (
            id,
            name
          )
        `)
        .not('consultant_id', 'is', null)
        .order('purchase_date', { ascending: false });

      // Фильтр по консультанту
      if (query.consultant_id) {
        dbQuery = dbQuery.eq('consultant_id', query.consultant_id);
      }

      // Фильтр по дате от
      if (query.date_from) {
        dbQuery = dbQuery.gte('purchase_date', query.date_from);
      }

      // Фильтр по дате до
      if (query.date_to) {
        dbQuery = dbQuery.lte('purchase_date', query.date_to);
      }

      // Пагинация
      const limit = query.limit ? parseInt(query.limit) : 100;
      const offset = query.offset ? parseInt(query.offset) : 0;
      dbQuery = dbQuery.range(offset, offset + limit - 1);

      const { data, error } = await dbQuery;

      if (error) {
        app.log.error({ error }, 'Failed to fetch all consultant sales');
        return reply.status(500).send({ error: error.message });
      }

      return reply.send(data || []);
    } catch (error: any) {
      app.log.error({ error }, 'Error fetching all sales');
      return reply.status(500).send({ error: error.message });
    }
  });
}
