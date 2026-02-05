import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { consultantAuthMiddleware, ConsultantAuthRequest } from '../middleware/consultantAuth.js';
import { normalizePeriodInput } from '../lib/periodUtils.js';
import { notifyConsultantAboutNewConsultation } from '../lib/consultantNotifications.js';

/**
 * Routes для dashboard консультанта
 */
export async function consultantDashboardRoutes(app: FastifyInstance) {
  // Применяем middleware ко всем роутам
  app.addHook('preHandler', consultantAuthMiddleware);

  /**
   * GET /consultant/dashboard
   * Получить статистику для dashboard консультанта
   */
  app.get('/consultant/dashboard', async (request: ConsultantAuthRequest, reply) => {
    const startTime = Date.now();

    try {
      const consultantId = request.consultant?.id;
      const isAdmin = request.userRole === 'admin';
      const userId = request.userAccountId;

      // Для админа нужно передать consultant_id в query
      const targetConsultantId = isAdmin
        ? (request.query as any).consultantId || consultantId
        : consultantId;

      if (!targetConsultantId) {
        app.log.warn({ userId, isAdmin }, 'GET /consultant/dashboard: Missing consultant ID');
        return reply.status(400).send({ error: 'Consultant ID required' });
      }

      const { periodType, periodStart, periodEnd, startIso, endIso } = normalizePeriodInput(
        (request.query as any)?.period_type,
        (request.query as any)?.period_start
      );

      app.log.info({
        userId,
        consultantId: targetConsultantId,
        isAdmin,
        periodType,
        periodStart,
        periodEnd
      }, 'GET /consultant/dashboard: Starting query');

      // Получить статистику задач эффективно через SQL агрегацию
      const today = new Date().toISOString().split('T')[0];
      const tasksQueryStart = Date.now();

      // ОПТИМИЗИРОВАНО: Используем три параллельных count запроса вместо загрузки в память
      const tasksStats = await Promise.all([
        // Всего активных задач
        supabase
          .from('consultant_tasks')
          .select('id', { count: 'exact', head: true })
          .eq('consultant_id', targetConsultantId)
          .eq('status', 'pending'),
        // Просроченные задачи
        supabase
          .from('consultant_tasks')
          .select('id', { count: 'exact', head: true })
          .eq('consultant_id', targetConsultantId)
          .eq('status', 'pending')
          .lt('due_date', today),
        // Задачи на сегодня
        supabase
          .from('consultant_tasks')
          .select('id', { count: 'exact', head: true })
          .eq('consultant_id', targetConsultantId)
          .eq('status', 'pending')
          .eq('due_date', today)
      ]);

      const tasksQueryDuration = Date.now() - tasksQueryStart;

      // Извлекаем результаты из параллельных запросов
      const [totalResult, overdueResult, todayResult] = tasksStats;
      const tasks_total = totalResult?.count || 0;
      const tasks_overdue = overdueResult?.count || 0;
      const tasks_today = todayResult?.count || 0;

      // Получить лиды за период
      const leadsQueryStart = Date.now();
      const countLeads = (interestLevel?: 'hot' | 'warm' | 'cold') => {
        let query = supabase
          .from('dialog_analysis')
          .select('id', { count: 'exact', head: true })
          .eq('assigned_consultant_id', targetConsultantId)
          .gte('created_at', startIso)
          .lte('created_at', endIso);

        if (interestLevel) {
          query = query.eq('interest_level', interestLevel);
        }

        return query;
      };

      const [totalLeadsResult, hotLeadsResult, warmLeadsResult, coldLeadsResult] = await Promise.all([
        countLeads(),
        countLeads('hot'),
        countLeads('warm'),
        countLeads('cold')
      ]);

      const leadsQueryDuration = Date.now() - leadsQueryStart;

      const leadsErrors = [
        totalLeadsResult.error,
        hotLeadsResult.error,
        warmLeadsResult.error,
        coldLeadsResult.error
      ].filter(Boolean);

      if (leadsErrors.length > 0) {
        app.log.error({ errors: leadsErrors }, 'GET /consultant/dashboard: Failed to fetch leads stats');
        return reply.status(500).send({ error: 'Failed to fetch leads stats' });
      }

      const total_leads = totalLeadsResult.count || 0;
      const hot_leads = hotLeadsResult.count || 0;
      const warm_leads = warmLeadsResult.count || 0;
      const cold_leads = coldLeadsResult.count || 0;

      // Получить консультации за период
      const consultationsQueryStart = Date.now();
      const countConsultations = (status?: string) => {
        let query = supabase
          .from('consultations')
          .select('id', { count: 'exact', head: true })
          .eq('consultant_id', targetConsultantId)
          .gte('date', periodStart)
          .lte('date', periodEnd);

        if (status) {
          query = query.eq('status', status);
        }

        return query;
      };

      const [
        totalConsultationsResult,
        scheduledResult,
        confirmedResult,
        completedResult,
        cancelledResult,
        noShowResult
      ] = await Promise.all([
        countConsultations(),
        countConsultations('scheduled'),
        countConsultations('confirmed'),
        countConsultations('completed'),
        countConsultations('cancelled'),
        countConsultations('no_show')
      ]);

      const consultationsQueryDuration = Date.now() - consultationsQueryStart;

      const consultationsErrors = [
        totalConsultationsResult.error,
        scheduledResult.error,
        confirmedResult.error,
        completedResult.error,
        cancelledResult.error,
        noShowResult.error
      ].filter(Boolean);

      if (consultationsErrors.length > 0) {
        app.log.error({ errors: consultationsErrors }, 'GET /consultant/dashboard: Failed to fetch consultations stats');
        return reply.status(500).send({ error: 'Failed to fetch consultations stats' });
      }

      const total_consultations = totalConsultationsResult.count || 0;
      const scheduled = scheduledResult.count || 0;
      const confirmed = confirmedResult.count || 0;
      const completed = completedResult.count || 0;
      const cancelled = cancelledResult.count || 0;
      const no_show = noShowResult.count || 0;

      // Получить количество уникальных лидов с консультациями
      const bookedLeadsQueryStart = Date.now();
      const { data: consultationsWithLeads, error: consultationsLeadsError } = await supabase
        .from('consultations')
        .select('dialog_analysis_id')
        .eq('consultant_id', targetConsultantId)
        .gte('date', periodStart)
        .lte('date', periodEnd)
        .not('dialog_analysis_id', 'is', null);

      const bookedLeadsQueryDuration = Date.now() - bookedLeadsQueryStart;

      if (consultationsLeadsError) {
        app.log.error({
          error: consultationsLeadsError,
          consultantId: targetConsultantId,
          duration: bookedLeadsQueryDuration
        }, 'GET /consultant/dashboard: Failed to fetch booked leads count');
      }

      const unique_leads_with_consultations = new Set(
        (consultationsWithLeads || []).map(c => c.dialog_analysis_id).filter(Boolean)
      ).size;

      // Получить количество и сумму продаж за период
      const salesQueryStart = Date.now();
      const { data: salesData, error: salesError } = await supabase
        .from('purchases')
        .select('amount')
        .eq('consultant_id', targetConsultantId)
        .gte('purchase_date', startIso)
        .lte('purchase_date', endIso);

      const salesQueryDuration = Date.now() - salesQueryStart;
      const sales_count = salesData?.length || 0;
      const sales_amount = (salesData || []).reduce((sum, sale) => sum + (sale.amount || 0), 0);

      if (salesError) {
        app.log.error({
          error: salesError,
          consultantId: targetConsultantId,
          duration: salesQueryDuration
        }, 'GET /consultant/dashboard: Failed to fetch sales');
      }

      const completion_rate = total_consultations > 0
        ? Math.round((completed / total_consultations) * 100)
        : 0;

      // Рассчитать конверсии
      const lead_to_booked_rate = total_leads > 0
        ? Math.round((unique_leads_with_consultations / total_leads) * 100)
        : 0;

      const booked_to_completed_rate = completion_rate;

      const completed_to_sales_rate = completed > 0
        ? Math.round((sales_count / completed) * 100)
        : 0;

      const totalDuration = Date.now() - startTime;

      app.log.info({
        userId,
        consultantId: targetConsultantId,
        stats: {
          leads: total_leads,
          leads_with_consultations: unique_leads_with_consultations,
          consultations: total_consultations,
          tasks: tasks_total,
          sales: sales_count,
          sales_amount: sales_amount
        },
        leadsQueryDuration,
        consultationsQueryDuration,
        tasksQueryDuration,
        salesQueryDuration,
        bookedLeadsQueryDuration,
        totalDuration
      }, 'GET /consultant/dashboard: Success');

      // Получить плановые показатели для периода
      const { data: targets, error: targetsError } = await supabase
        .from('consultant_targets')
        .select(`
          target_lead_to_booked_rate,
          target_booked_to_completed_rate,
          target_completed_to_sales_rate,
          target_sales_amount,
          target_sales_count
        `)
        .eq('consultant_id', targetConsultantId)
        .eq('period_type', periodType)
        .eq('period_start', periodStart)
        .maybeSingle();

      if (targetsError) {
        app.log.error({ error: targetsError }, 'GET /consultant/dashboard: Failed to fetch targets');
      }

      return reply.send({
        consultant_id: targetConsultantId,
        period_type: periodType,
        period_start: periodStart,
        period_end: periodEnd,
        total_leads,
        hot_leads,
        warm_leads,
        cold_leads,
        booked_leads: unique_leads_with_consultations,
        total_consultations,
        scheduled,
        confirmed,
        completed,
        cancelled,
        no_show,
        total_revenue: 0,
        completion_rate,
        // Добавляем статистику задач
        tasks_total,
        tasks_overdue,
        tasks_today,
        // Добавляем продажи и конверсии
        sales_count,
        sales_amount,
        lead_to_booked_rate,
        booked_to_completed_rate,
        completed_to_sales_rate,
        // Плановые показатели
        target_lead_to_booked_rate: targets?.target_lead_to_booked_rate ?? null,
        target_booked_to_completed_rate: targets?.target_booked_to_completed_rate ?? null,
        target_completed_to_sales_rate: targets?.target_completed_to_sales_rate ?? null,
        target_sales_amount: targets?.target_sales_amount ?? null,
        target_sales_count: targets?.target_sales_count ?? null
      });
    } catch (error: any) {
      const totalDuration = Date.now() - startTime;

      app.log.error({
        error,
        userId: request.userAccountId,
        duration: totalDuration
      }, 'GET /consultant/dashboard: Unexpected error');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /consultant/targets
   * Получить плановые показатели консультанта на период
   */
  app.get('/consultant/targets', async (request: ConsultantAuthRequest, reply) => {
    try {
      const consultantId = request.consultant?.id;
      const isAdmin = request.userRole === 'admin';

      const targetConsultantId = isAdmin
        ? (request.query as any).consultantId || consultantId
        : consultantId;

      if (!targetConsultantId) {
        return reply.status(400).send({ error: 'Consultant ID required' });
      }

      const { periodType, periodStart, periodEnd } = normalizePeriodInput(
        (request.query as any)?.period_type,
        (request.query as any)?.period_start
      );

      const { data: targets, error } = await supabase
        .from('consultant_targets')
        .select(`
          target_lead_to_booked_rate,
          target_booked_to_completed_rate,
          target_completed_to_sales_rate,
          target_sales_amount,
          target_sales_count
        `)
        .eq('consultant_id', targetConsultantId)
        .eq('period_type', periodType)
        .eq('period_start', periodStart)
        .maybeSingle();

      if (error) {
        app.log.error({ error }, 'GET /consultant/targets: Failed to fetch targets');
        return reply.status(500).send({ error: error.message });
      }

      return reply.send({
        consultant_id: targetConsultantId,
        period_type: periodType,
        period_start: periodStart,
        period_end: periodEnd,
        target_lead_to_booked_rate: targets?.target_lead_to_booked_rate ?? null,
        target_booked_to_completed_rate: targets?.target_booked_to_completed_rate ?? null,
        target_completed_to_sales_rate: targets?.target_completed_to_sales_rate ?? null,
        target_sales_amount: targets?.target_sales_amount ?? null,
        target_sales_count: targets?.target_sales_count ?? null
      });
    } catch (error: any) {
      app.log.error({ error }, 'GET /consultant/targets: Unexpected error');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /consultant/leads
   * Получить лидов консультанта
   */
  app.get('/consultant/leads', async (request: ConsultantAuthRequest, reply) => {
    try {
      const {
        status,
        is_booked,
        consultantId: queryConsultantId,
        limit = 50,
        offset = 0
      } = request.query as {
        status?: string;
        is_booked?: string;
        consultantId?: string;
        limit?: number;
        offset?: number;
      };

      const consultantId = request.consultant?.id;
      const isAdmin = request.userRole === 'admin';

      // Определяем ID консультанта для фильтрации
      // Приоритет: query параметр (для админов) > авторизованный консультант
      const targetConsultantId = isAdmin && queryConsultantId
        ? queryConsultantId
        : consultantId;

      // ВСЕГДА требуем consultantId для фильтрации
      if (!targetConsultantId) {
        return reply.status(400).send({
          error: 'Consultant ID required. Leads must be filtered by consultant.'
        });
      }

      let query = supabase
        .from('dialog_analysis')
        .select('*', { count: 'exact' })
        .eq('assigned_consultant_id', targetConsultantId) // ВСЕГДА фильтруем по консультанту
        .order('last_message', { ascending: false });

      if (status) {
        query = query.eq('funnel_stage', status);
      }

      // Фильтр по статусу записи
      if (is_booked === 'false' || is_booked === 'true') {
        // Получаем ID лидов у которых когда-либо была консультация (любой статус)
        const { data: bookedLeads } = await supabase
          .from('consultations')
          .select('dialog_analysis_id');

        const bookedLeadIds = (bookedLeads || [])
          .map(c => c.dialog_analysis_id)
          .filter(Boolean);

        if (is_booked === 'false') {
          // Не записан - исключаем записанных
          if (bookedLeadIds.length > 0) {
            query = query.not('id', 'in', `(${bookedLeadIds.join(',')})`);
          }
        } else {
          // Записан - только записанные
          if (bookedLeadIds.length > 0) {
            query = query.in('id', bookedLeadIds);
          } else {
            // Если нет записанных, возвращаем пустой массив
            return reply.send({ leads: [], total: 0, limit, offset });
          }
        }
      }

      query = query.range(offset, offset + limit - 1);

      const { data, error, count } = await query;

      if (error) {
        app.log.error({ error }, 'Failed to fetch leads');
        return reply.status(500).send({ error: error.message });
      }

      const leads = data || [];

      // Добавляем теги consultation_status и has_sale для каждого лида
      const leadsWithTags = await Promise.all(
        leads.map(async (lead) => {
          // Получаем статус последней консультации
          const { data: consultations } = await supabase
            .from('consultations')
            .select('status')
            .eq('dialog_analysis_id', lead.id)
            .order('created_at', { ascending: false })
            .limit(1);

          const consultation_status = consultations && consultations.length > 0
            ? consultations[0].status
            : null;

          // Проверяем наличие продажи
          const { data: purchases } = await supabase
            .from('purchases')
            .select('id')
            .eq('client_phone', lead.contact_phone)
            .eq('consultant_id', targetConsultantId)
            .limit(1);

          const has_sale = (purchases || []).length > 0;

          return {
            ...lead,
            consultation_status,
            has_sale
          };
        })
      );

      return reply.send({
        leads: leadsWithTags,
        total: count || 0,
        limit,
        offset
      });
    } catch (error: any) {
      app.log.error({ error }, 'Error fetching leads');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * PATCH /consultant/leads/:leadId/notes
   * Обновить примечание по лиду (консультант или админ)
   */
  app.patch('/consultant/leads/:leadId/notes', async (request: ConsultantAuthRequest, reply) => {
    try {
      const { leadId } = request.params as { leadId: string };
      const { notes } = request.body as { notes?: string | null };

      if (notes === undefined) {
        return reply.status(400).send({ error: 'notes field is required' });
      }

      const isAdmin = request.userRole === 'admin';
      const consultantId = request.consultant?.id;
      const userAccountId = request.userAccountId;

      const { data: lead, error: leadError } = await supabase
        .from('dialog_analysis')
        .select('id, assigned_consultant_id, user_account_id')
        .eq('id', leadId)
        .single();

      if (leadError || !lead) {
        return reply.status(404).send({ error: 'Lead not found' });
      }

      if (!isAdmin) {
        if (!consultantId || lead.assigned_consultant_id !== consultantId) {
          return reply.status(403).send({ error: 'Access denied' });
        }
      } else if (userAccountId && lead.user_account_id !== userAccountId) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      if (typeof notes === 'string' && notes.length > 5000) {
        return reply.status(400).send({ error: 'notes is too длинное (max 5000)' });
      }

      const { error: updateError } = await supabase
        .from('dialog_analysis')
        .update({
          manual_notes: notes,
          updated_at: new Date().toISOString()
        })
        .eq('id', leadId);

      if (updateError) {
        app.log.error({ error: updateError }, 'Failed to update lead notes');
        return reply.status(500).send({ error: updateError.message });
      }

      return reply.send({ success: true });
    } catch (error: any) {
      app.log.error({ error }, 'Error updating lead notes');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /consultant/consultations
   * Получить консультации консультанта
   */
  app.get('/consultant/consultations', async (request: ConsultantAuthRequest, reply) => {
    try {
      const { date, status, from_date, to_date, consultantId: queryConsultantId } = request.query as {
        date?: string;
        status?: string;
        from_date?: string;
        to_date?: string;
        consultantId?: string;
      };

      const consultantId = request.consultant?.id;
      const isAdmin = request.userRole === 'admin';

      // Для админа можно передать consultantId в query, иначе берём из токена
      const targetConsultantId = isAdmin && queryConsultantId
        ? queryConsultantId
        : consultantId;

      // ВСЕГДА фильтруем по consultantId (обязательно!)
      if (!targetConsultantId) {
        return reply.status(400).send({ error: 'Consultant ID required' });
      }

      let query = supabase
        .from('consultations')
        .select(`
          *,
          consultant:consultants(name, phone)
        `)
        .eq('consultant_id', targetConsultantId)  // ← ИСПРАВЛЕНО: всегда фильтруем
        .order('date', { ascending: true })
        .order('start_time', { ascending: true });

      if (date) {
        query = query.eq('date', date);
      }

      if (from_date && to_date) {
        query = query.gte('date', from_date).lte('date', to_date);
      }

      if (status) {
        query = query.eq('status', status);
      }

      const { data, error } = await query;

      if (error) {
        app.log.error({ error }, 'Failed to fetch consultations');
        return reply.status(500).send({ error: error.message });
      }

      return reply.send(data || []);
    } catch (error: any) {
      app.log.error({ error }, 'Error fetching consultations');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /consultant/schedule
   * Получить расписание консультанта
   */
  app.get('/consultant/schedule', async (request: ConsultantAuthRequest, reply) => {
    try {
      const consultantId = request.consultant?.id;
      const isAdmin = request.userRole === 'admin';

      // Для админа нужно передать consultantId в query
      const targetConsultantId = isAdmin
        ? (request.query as any).consultantId || consultantId
        : consultantId;

      if (!targetConsultantId) {
        return reply.status(400).send({ error: 'Consultant ID required' });
      }

      const { data, error } = await supabase
        .from('working_schedules')
        .select('*')
        .eq('consultant_id', targetConsultantId)
        .order('day_of_week');

      if (error) {
        app.log.error({ error }, 'Failed to fetch schedule');
        return reply.status(500).send({ error: error.message });
      }

      return reply.send(data || []);
    } catch (error: any) {
      app.log.error({ error }, 'Error fetching schedule');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * PUT /consultant/schedule
   * Обновить расписание консультанта
   */
  app.put('/consultant/schedule', async (request: ConsultantAuthRequest, reply) => {
    try {
      const consultantId = request.consultant?.id;

      if (!consultantId) {
        return reply.status(403).send({ error: 'Consultant only' });
      }

      const { schedules } = request.body as { schedules: any[] };

      // Удаляем старое расписание
      await supabase
        .from('working_schedules')
        .delete()
        .eq('consultant_id', consultantId);

      // Вставляем новое
      if (schedules && schedules.length > 0) {
        const schedulesWithConsultant = schedules.map(s => ({
          consultant_id: consultantId,
          day_of_week: s.day_of_week,
          start_time: s.start_time,
          end_time: s.end_time,
          is_active: s.is_active !== undefined ? s.is_active : true
        }));

        const { data, error } = await supabase
          .from('working_schedules')
          .insert(schedulesWithConsultant)
          .select();

        if (error) {
          app.log.error({ error }, 'Failed to update schedule');
          return reply.status(500).send({ error: error.message });
        }

        return reply.send(data);
      }

      return reply.send([]);
    } catch (error: any) {
      app.log.error({ error }, 'Error updating schedule');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /consultant/services
   * Получить услуги консультанта
   */
  app.get('/consultant/services', async (request: ConsultantAuthRequest, reply) => {
    try {
      const consultantId = request.consultant?.id;
      const isAdmin = request.userRole === 'admin';

      // Для админа нужно передать consultantId в query
      const targetConsultantId = isAdmin
        ? (request.query as any).consultantId || consultantId
        : consultantId;

      if (!targetConsultantId) {
        return reply.status(400).send({ error: 'Consultant ID required' });
      }

      // Получаем все услуги аккаунта
      const { data: allServices, error: servicesError } = await supabase
        .from('consultation_services')
        .select('*')
        .eq('user_account_id', request.userAccountId!)
        .eq('is_active', true)
        .order('sort_order');

      if (servicesError) {
        app.log.error({ error: servicesError }, 'Failed to fetch services');
        return reply.status(500).send({ error: servicesError.message });
      }

      // Получаем услуги консультанта
      const { data: consultantServices } = await supabase
        .from('consultant_services')
        .select('*')
        .eq('consultant_id', targetConsultantId)
        .eq('is_active', true);

      const consultantServiceMap = new Map(
        (consultantServices || []).map(cs => [cs.service_id, cs])
      );

      // Объединяем данные
      const services = (allServices || []).map(service => ({
        ...service,
        consultant_service: consultantServiceMap.get(service.id) || null,
        is_provided: consultantServiceMap.has(service.id)
      }));

      return reply.send(services);
    } catch (error: any) {
      app.log.error({ error }, 'Error fetching services');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * PUT /consultant/services
   * Обновить список услуг консультанта
   */
  app.put('/consultant/services', async (request: ConsultantAuthRequest, reply) => {
    try {
      const consultantId = request.consultant?.id;
      const isAdmin = request.userRole === 'admin';

      // Для админа нужно передать consultantId в body
      const targetConsultantId = isAdmin
        ? (request.body as any).consultantId || consultantId
        : consultantId;

      if (!targetConsultantId) {
        return reply.status(400).send({ error: 'Consultant ID required' });
      }

      const { services } = request.body as {
        services: Array<{
          service_id: string;
          custom_price?: number;
          custom_duration?: number;
          is_active: boolean;
        }>;
      };

      // Удаляем старые связи
      await supabase
        .from('consultant_services')
        .delete()
        .eq('consultant_id', targetConsultantId);

      // Создаем новые (только активные)
      const activeServices = services
        .filter(s => s.is_active)
        .map(s => ({
          consultant_id: targetConsultantId,
          service_id: s.service_id,
          custom_price: s.custom_price,
          custom_duration: s.custom_duration,
          is_active: true
        }));

      if (activeServices.length > 0) {
        const { data, error } = await supabase
          .from('consultant_services')
          .insert(activeServices)
          .select();

        if (error) {
          app.log.error({ error }, 'Failed to update services');
          return reply.status(500).send({ error: error.message });
        }

        return reply.send(data);
      }

      return reply.send([]);
    } catch (error: any) {
      app.log.error({ error }, 'Error updating services');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /consultant/call-log
   * Отметить прозвон лида
   */
  app.post('/consultant/call-log', async (request: ConsultantAuthRequest, reply) => {
    try {
      const consultantId = request.consultant?.id;

      if (!consultantId) {
        return reply.status(403).send({ error: 'Consultant only' });
      }

      const { lead_id, result, notes, next_follow_up } = request.body as {
        lead_id: string;
        result: string;
        notes?: string;
        next_follow_up?: string;
      };

      const { data, error } = await supabase
        .from('consultant_call_logs')
        .insert({
          consultant_id: consultantId,
          lead_id,
          result,
          notes,
          next_follow_up
        })
        .select()
        .single();

      if (error) {
        app.log.error({ error }, 'Failed to create call log');
        return reply.status(500).send({ error: error.message });
      }

      return reply.status(201).send(data);
    } catch (error: any) {
      app.log.error({ error }, 'Error creating call log');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /consultant/call-logs/:leadId
   * Получить историю прозвонов лида
   */
  app.get('/consultant/call-logs/:leadId', async (request: ConsultantAuthRequest, reply) => {
    try {
      const { leadId } = request.params as { leadId: string };
      const consultantId = request.consultant?.id;

      let query = supabase
        .from('consultant_call_logs')
        .select('*')
        .eq('lead_id', leadId)
        .order('called_at', { ascending: false });

      // Консультант видит только свои звонки
      if (consultantId && request.userRole !== 'admin') {
        query = query.eq('consultant_id', consultantId);
      }

      const { data, error } = await query;

      if (error) {
        app.log.error({ error }, 'Failed to fetch call logs');
        return reply.status(500).send({ error: error.message });
      }

      return reply.send(data || []);
    } catch (error: any) {
      app.log.error({ error }, 'Error fetching call logs');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /consultant/profile
   * Получить профиль консультанта
   */
  app.get('/consultant/profile', async (request: ConsultantAuthRequest, reply) => {
    try {
      const consultantId = request.consultant?.id;
      const isAdmin = request.userRole === 'admin';
      const targetConsultantId = isAdmin
        ? (request.query as any).consultantId || consultantId
        : consultantId;

      if (!targetConsultantId) {
        return reply.status(400).send({ error: 'Consultant ID required' });
      }

      const { data, error } = await supabase
        .from('consultants')
        .select('id, name, phone, email, specialization, parent_user_account_id')
        .eq('id', targetConsultantId)
        .single();

      if (error) {
        app.log.error({ error }, 'Failed to fetch profile');
        return reply.status(500).send({ error: error.message });
      }

      return reply.send(data);
    } catch (error: any) {
      app.log.error({ error }, 'Error fetching profile');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * PUT /consultant/profile
   * Обновить профиль консультанта
   */
  app.put('/consultant/profile', async (request: ConsultantAuthRequest, reply) => {
    try {
      const consultantId = request.consultant?.id;

      if (!consultantId) {
        return reply.status(403).send({ error: 'Consultant only' });
      }

      const { name, phone, email, specialization } = request.body as {
        name?: string;
        phone?: string;
        email?: string;
        specialization?: string;
      };

      const { data, error } = await supabase
        .from('consultants')
        .update({
          name,
          phone,
          email,
          specialization
        })
        .eq('id', consultantId)
        .select()
        .single();

      if (error) {
        app.log.error({ error }, 'Failed to update profile');
        return reply.status(500).send({ error: error.message });
      }

      return reply.send(data);
    } catch (error: any) {
      app.log.error({ error }, 'Error updating profile');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /consultant/consultation/create
   * Создать консультацию вручную
   */
  app.post('/consultant/consultation/create', async (request: ConsultantAuthRequest, reply) => {
    try {
      const consultantId = request.consultant?.id;

      if (!consultantId) {
        return reply.status(403).send({ error: 'Consultant only' });
      }

      const {
        service_id,
        date,
        start_time,
        end_time,
        lead_id,
        client_name,
        client_phone,
        notes
      } = request.body as {
        service_id: string;
        date: string;
        start_time: string;
        end_time: string;
        lead_id?: string;
        client_name?: string;
        client_phone?: string;
        notes?: string;
      };

      // Создаем консультацию
      const { data: consultation, error } = await supabase
        .from('consultations')
        .insert({
          consultant_id: consultantId,
          service_id,
          date,
          start_time,
          end_time,
          dialog_analysis_id: lead_id,
          client_name: client_name || null,
          client_phone: client_phone || null,
          notes,
          status: 'scheduled',
          user_account_id: request.userAccountId
        })
        .select()
        .single();

      if (error) {
        app.log.error({ error }, 'Failed to create consultation');
        return reply.status(500).send({ error: error.message });
      }

      // Если лид выбран - обновить funnel_stage
      if (lead_id) {
        await supabase
          .from('dialog_analysis')
          .update({ funnel_stage: 'consultation_booked' })
          .eq('id', lead_id);
      }

      // Отправить WhatsApp уведомление консультанту
      await notifyConsultantAboutNewConsultation(consultation.id);

      return reply.status(201).send(consultation);
    } catch (error: any) {
      app.log.error({ error }, 'Error creating consultation');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * PUT /consultant/consultation/:id
   * Обновить консультацию
   */
  app.put('/consultant/consultation/:id', async (request: ConsultantAuthRequest, reply) => {
    try {
      const { id } = request.params as { id: string };
      const consultantId = request.consultant?.id;

      if (!consultantId) {
        return reply.status(403).send({ error: 'Consultant only' });
      }

      const { status, notes, start_time, end_time, date } = request.body as {
        status?: string;
        notes?: string;
        start_time?: string;
        end_time?: string;
        date?: string;
      };

      // Проверяем что консультация принадлежит консультанту
      const { data: existing, error: existingError } = await supabase
        .from('consultations')
        .select('consultant_id')
        .eq('id', id)
        .single();

      if (existingError || !existing) {
        return reply.status(404).send({ error: 'Consultation not found' });
      }

      if (existing.consultant_id !== consultantId && request.userRole !== 'admin') {
        return reply.status(403).send({ error: 'Not your consultation' });
      }

      const { data, error } = await supabase
        .from('consultations')
        .update({
          status,
          notes,
          start_time,
          end_time,
          date
        })
        .eq('id', id)
        .select()
        .single();

      if (error) {
        app.log.error({ error }, 'Failed to update consultation');
        return reply.status(500).send({ error: error.message });
      }

      return reply.send(data);
    } catch (error: any) {
      app.log.error({ error }, 'Error updating consultation');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * PUT /consultant/change-password
   * Сменить пароль консультанта
   */
  app.put('/consultant/change-password', async (request: ConsultantAuthRequest, reply) => {
    try {
      const userAccountId = request.userAccountId;
      const { current_password, new_password } = request.body as {
        current_password: string;
        new_password: string;
      };

      if (!current_password || !new_password) {
        return reply.status(400).send({ error: 'Current and new password required' });
      }

      // Проверяем текущий пароль
      const { data: user, error: userError } = await supabase
        .from('user_accounts')
        .select('password')
        .eq('id', userAccountId)
        .single();

      if (userError || !user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      if (user.password !== current_password) {
        return reply.status(400).send({ error: 'Current password incorrect' });
      }

      // Обновляем пароль
      const { error } = await supabase
        .from('user_accounts')
        .update({ password: new_password })
        .eq('id', userAccountId);

      if (error) {
        app.log.error({ error }, 'Failed to change password');
        return reply.status(500).send({ error: error.message });
      }

      return reply.send({ success: true, message: 'Password changed successfully' });
    } catch (error: any) {
      app.log.error({ error }, 'Error changing password');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /consultant/unread-count
   * Получить количество лидов с непрочитанными сообщениями
   */
  app.get('/consultant/unread-count', async (request: ConsultantAuthRequest, reply) => {
    try {
      const consultantId = request.consultant?.id;

      if (!consultantId) {
        return reply.status(403).send({ error: 'Consultant only' });
      }

      const { count, error } = await supabase
        .from('dialog_analysis')
        .select('*', { count: 'exact', head: true })
        .eq('assigned_consultant_id', consultantId)
        .eq('has_unread', true);

      if (error) {
        app.log.error({
          error,
          consultantId: consultantId.substring(0, 8) + '...'
        }, 'Failed to get unread count');
        return reply.status(500).send({ error: error.message });
      }

      app.log.debug({
        consultantId: consultantId.substring(0, 8) + '...',
        unreadCount: count || 0
      }, 'Successfully fetched unread count');

      return reply.send({ unreadCount: count || 0 });
    } catch (error: any) {
      app.log.error({ error }, 'Error getting unread count');
      return reply.status(500).send({ error: error.message });
    }
  });
}
