import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { consultantAuthMiddleware, ConsultantAuthRequest } from '../middleware/consultantAuth.js';
import { z } from 'zod';

// ==============================================
// Zod Schemas для валидации
// ==============================================

// Валидация даты: формат YYYY-MM-DD и реальная дата
const dateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)')
  .refine((val) => {
    const date = new Date(val);
    return !isNaN(date.getTime());
  }, 'Invalid date value');

const CreateTaskSchema = z.object({
  title: z.string().min(1, 'Title is required').max(500, 'Title too long'),
  description: z.string().max(5000, 'Description too long').optional(),
  due_date: dateSchema,
  lead_id: z.string().uuid('Invalid lead ID').optional(),
  consultantId: z.string().uuid('Invalid consultant ID').optional() // Для админа
});

const UpdateTaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional(),
  status: z.enum(['pending', 'completed', 'cancelled']).optional(),
  due_date: dateSchema.optional(),
  result_notes: z.string().max(5000).optional()
});

// Утилита для санитизации поискового запроса
function sanitizeSearchQuery(search: string): string {
  // Удаляем специальные символы Postgres для ILIKE
  return search.replace(/[%_\\]/g, '\\$&').trim();
}

// ==============================================
// Routes
// ==============================================

export async function consultantTasksRoutes(app: FastifyInstance) {
  // Применяем middleware ко всем маршрутам
  app.addHook('preHandler', consultantAuthMiddleware);

  /**
   * GET /consultant/tasks
   * Получить задачи консультанта с фильтрацией
   */
  app.get('/consultant/tasks', async (request: ConsultantAuthRequest, reply) => {
    const startTime = Date.now();

    try {
      const {
        consultantId: queryConsultantId,
        status,
        due_date_from,
        due_date_to,
        lead_id,
        search
      } = request.query as any;

      const isAdmin = request.userRole === 'admin';
      const consultantId = request.consultant?.id;
      const userId = request.userAccountId;

      // Админ может просматривать задачи любого консультанта
      const targetConsultantId = isAdmin && queryConsultantId
        ? queryConsultantId
        : consultantId;

      if (!targetConsultantId) {
        app.log.warn({ userId, isAdmin }, 'GET /consultant/tasks: Missing consultant ID');
        return reply.status(400).send({ error: 'Consultant ID required' });
      }

      app.log.info({
        userId,
        consultantId: targetConsultantId,
        isAdmin,
        filters: { status, due_date_from, due_date_to, lead_id, hasSearch: !!search }
      }, 'GET /consultant/tasks: Starting query');

      // Построение запроса с join'ами
      let query = supabase
        .from('consultant_tasks')
        .select(`
          *,
          lead:dialog_analysis!lead_id(contact_name, contact_phone),
          created_by:user_accounts!created_by_user_id(username)
        `)
        .eq('consultant_id', targetConsultantId);

      // Применение фильтров
      if (status) {
        query = query.eq('status', status);
      }
      if (due_date_from) {
        query = query.gte('due_date', due_date_from);
      }
      if (due_date_to) {
        query = query.lte('due_date', due_date_to);
      }
      if (lead_id) {
        query = query.eq('lead_id', lead_id);
      }

      // БЕЗОПАСНЫЙ поиск с санитизацией
      if (search) {
        const sanitizedSearch = sanitizeSearchQuery(search as string);
        if (sanitizedSearch.length > 0) {
          query = query.or(`title.ilike.%${sanitizedSearch}%,description.ilike.%${sanitizedSearch}%`);
          app.log.debug({ originalSearch: search, sanitizedSearch }, 'Search query sanitized');
        }
      }

      // Сортировка: просроченные первые, затем по дате
      query = query.order('due_date', { ascending: true });

      const queryStartTime = Date.now();
      const { data, error } = await query;
      const queryDuration = Date.now() - queryStartTime;

      if (error) {
        app.log.error({
          error,
          userId,
          consultantId: targetConsultantId,
          filters: { status, due_date_from, due_date_to, lead_id }
        }, 'GET /consultant/tasks: Query failed');
        return reply.status(500).send({ error: error.message });
      }

      const totalDuration = Date.now() - startTime;

      app.log.info({
        userId,
        consultantId: targetConsultantId,
        resultsCount: data?.length || 0,
        queryDuration,
        totalDuration
      }, 'GET /consultant/tasks: Success');

      return reply.send({
        tasks: data || [],
        total: data?.length || 0
      });
    } catch (error: any) {
      const totalDuration = Date.now() - startTime;
      app.log.error({
        error,
        userId: request.userAccountId,
        duration: totalDuration
      }, 'GET /consultant/tasks: Unexpected error');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /consultant/tasks
   * Создать задачу
   */
  app.post('/consultant/tasks', async (request: ConsultantAuthRequest, reply) => {
    const startTime = Date.now();

    try {
      const body = CreateTaskSchema.parse(request.body);
      const isAdmin = request.userRole === 'admin';
      const userId = request.userAccountId;

      app.log.info({
        userId,
        isAdmin,
        title: body.title,
        dueDate: body.due_date,
        hasLead: !!body.lead_id,
        targetConsultantId: body.consultantId
      }, 'POST /consultant/tasks: Starting task creation');

      // Админ может создавать задачи для любого консультанта
      const targetConsultantId = isAdmin && body.consultantId
        ? body.consultantId
        : request.consultant?.id;

      if (!targetConsultantId) {
        app.log.warn({ userId, isAdmin }, 'POST /consultant/tasks: Missing consultant ID');
        return reply.status(403).send({ error: 'Consultant only' });
      }

      // Получить user_account_id консультанта
      const consultantQueryStart = Date.now();
      const { data: consultant, error: consultantError } = await supabase
        .from('consultants')
        .select('parent_user_account_id')
        .eq('id', targetConsultantId)
        .single();
      const consultantQueryDuration = Date.now() - consultantQueryStart;

      if (consultantError || !consultant) {
        app.log.error({
          error: consultantError,
          consultantId: targetConsultantId,
          duration: consultantQueryDuration
        }, 'POST /consultant/tasks: Consultant not found');
        return reply.status(404).send({ error: 'Consultant not found' });
      }

      // Валидация лида (если указан)
      if (body.lead_id) {
        const leadQueryStart = Date.now();
        const { data: lead, error: leadError } = await supabase
          .from('dialog_analysis')
          .select('id')
          .eq('id', body.lead_id)
          .single();
        const leadQueryDuration = Date.now() - leadQueryStart;

        if (leadError || !lead) {
          app.log.warn({
            error: leadError,
            leadId: body.lead_id,
            duration: leadQueryDuration
          }, 'POST /consultant/tasks: Lead not found');
          return reply.status(404).send({ error: 'Lead not found' });
        }
      }

      // Вставка задачи
      const insertStartTime = Date.now();
      const { data, error } = await supabase
        .from('consultant_tasks')
        .insert({
          consultant_id: targetConsultantId,
          user_account_id: consultant.parent_user_account_id,
          created_by_user_id: consultant.parent_user_account_id, // Консультант создает задачу для себя
          title: body.title,
          description: body.description,
          due_date: body.due_date,
          lead_id: body.lead_id,
          status: 'pending'
        })
        .select(`
          *,
          lead:dialog_analysis!lead_id(contact_name, contact_phone),
          created_by:user_accounts!created_by_user_id(username)
        `)
        .single();
      const insertDuration = Date.now() - insertStartTime;

      if (error) {
        app.log.error({
          error,
          userId,
          consultantId: targetConsultantId,
          duration: insertDuration
        }, 'POST /consultant/tasks: Insert failed');
        return reply.status(500).send({ error: error.message });
      }

      const totalDuration = Date.now() - startTime;

      app.log.info({
        taskId: data.id,
        consultantId: targetConsultantId,
        createdBy: request.userAccountId,
        hasLead: !!body.lead_id,
        insertDuration,
        totalDuration
      }, 'POST /consultant/tasks: Task created successfully');

      return reply.status(201).send(data);
    } catch (error: any) {
      const totalDuration = Date.now() - startTime;

      if (error instanceof z.ZodError) {
        app.log.warn({
          userId: request.userAccountId,
          validationErrors: error.errors,
          duration: totalDuration
        }, 'POST /consultant/tasks: Validation failed');
        return reply.status(400).send({
          error: 'Validation error',
          details: error.errors
        });
      }

      app.log.error({
        error,
        userId: request.userAccountId,
        duration: totalDuration
      }, 'POST /consultant/tasks: Unexpected error');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * PUT /consultant/tasks/:taskId
   * Обновить задачу
   */
  app.put('/consultant/tasks/:taskId', async (request: ConsultantAuthRequest, reply) => {
    const startTime = Date.now();

    try {
      const { taskId } = request.params as { taskId: string };
      const body = UpdateTaskSchema.parse(request.body);
      const consultantId = request.consultant?.id;
      const isAdmin = request.userRole === 'admin';
      const userId = request.userAccountId;

      app.log.info({
        userId,
        taskId,
        isAdmin,
        updatedFields: Object.keys(body),
        statusChange: body.status
      }, 'PUT /consultant/tasks/:taskId: Starting update');

      if (!consultantId && !isAdmin) {
        app.log.warn({ userId, taskId }, 'PUT /consultant/tasks/:taskId: Unauthorized');
        return reply.status(403).send({ error: 'Consultant only' });
      }

      // Проверка владения задачей
      const checkStartTime = Date.now();
      const { data: existing, error: checkError } = await supabase
        .from('consultant_tasks')
        .select('consultant_id, status, title')
        .eq('id', taskId)
        .single();
      const checkDuration = Date.now() - checkStartTime;

      if (checkError || !existing) {
        app.log.warn({
          error: checkError,
          taskId,
          userId,
          duration: checkDuration
        }, 'PUT /consultant/tasks/:taskId: Task not found');
        return reply.status(404).send({ error: 'Task not found' });
      }

      // Консультант может редактировать только свои задачи, админ - любые
      if (existing.consultant_id !== consultantId && !isAdmin) {
        app.log.warn({
          taskId,
          userId,
          taskOwnerId: existing.consultant_id,
          requestConsultantId: consultantId
        }, 'PUT /consultant/tasks/:taskId: Access denied - not task owner');
        return reply.status(403).send({ error: 'Not your task' });
      }

      // Подготовка данных для обновления
      const updateData: any = { ...body };

      // Если меняем статус на completed - установить completed_at
      if (body.status === 'completed' && existing.status !== 'completed') {
        updateData.completed_at = new Date().toISOString();
        app.log.debug({ taskId, previousStatus: existing.status }, 'Task marked as completed');
      }

      // Если отменяем completed - убрать completed_at
      if (body.status && body.status !== 'completed' && existing.status === 'completed') {
        updateData.completed_at = null;
        app.log.debug({ taskId, newStatus: body.status }, 'Task completion reverted');
      }

      // Обновление задачи
      const updateStartTime = Date.now();
      const { data, error } = await supabase
        .from('consultant_tasks')
        .update(updateData)
        .eq('id', taskId)
        .select(`
          *,
          lead:dialog_analysis!lead_id(contact_name, contact_phone),
          created_by:user_accounts!created_by_user_id(username)
        `)
        .single();
      const updateDuration = Date.now() - updateStartTime;

      if (error) {
        app.log.error({
          error,
          taskId,
          userId,
          duration: updateDuration
        }, 'PUT /consultant/tasks/:taskId: Update failed');
        return reply.status(500).send({ error: error.message });
      }

      const totalDuration = Date.now() - startTime;

      app.log.info({
        taskId,
        consultantId: existing.consultant_id,
        updatedFields: Object.keys(body),
        statusChange: existing.status !== body.status ? `${existing.status} -> ${body.status}` : undefined,
        updateDuration,
        totalDuration
      }, 'PUT /consultant/tasks/:taskId: Task updated successfully');

      return reply.send(data);
    } catch (error: any) {
      const totalDuration = Date.now() - startTime;

      if (error instanceof z.ZodError) {
        app.log.warn({
          userId: request.userAccountId,
          taskId: (request.params as any).taskId,
          validationErrors: error.errors,
          duration: totalDuration
        }, 'PUT /consultant/tasks/:taskId: Validation failed');
        return reply.status(400).send({
          error: 'Validation error',
          details: error.errors
        });
      }

      app.log.error({
        error,
        userId: request.userAccountId,
        taskId: (request.params as any).taskId,
        duration: totalDuration
      }, 'PUT /consultant/tasks/:taskId: Unexpected error');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * DELETE /consultant/tasks/:taskId
   * Удалить задачу
   */
  app.delete('/consultant/tasks/:taskId', async (request: ConsultantAuthRequest, reply) => {
    const startTime = Date.now();

    try {
      const { taskId } = request.params as { taskId: string };
      const consultantId = request.consultant?.id;
      const isAdmin = request.userRole === 'admin';
      const userId = request.userAccountId;

      app.log.info({
        userId,
        taskId,
        isAdmin
      }, 'DELETE /consultant/tasks/:taskId: Starting deletion');

      if (!consultantId && !isAdmin) {
        app.log.warn({ userId, taskId }, 'DELETE /consultant/tasks/:taskId: Unauthorized');
        return reply.status(403).send({ error: 'Consultant only' });
      }

      // Проверка владения задачей
      const checkStartTime = Date.now();
      const { data: existing, error: checkError } = await supabase
        .from('consultant_tasks')
        .select('consultant_id, title, status')
        .eq('id', taskId)
        .single();
      const checkDuration = Date.now() - checkStartTime;

      if (checkError || !existing) {
        app.log.warn({
          error: checkError,
          taskId,
          userId,
          duration: checkDuration
        }, 'DELETE /consultant/tasks/:taskId: Task not found');
        return reply.status(404).send({ error: 'Task not found' });
      }

      // Консультант может удалять только свои задачи, админ - любые
      if (existing.consultant_id !== consultantId && !isAdmin) {
        app.log.warn({
          taskId,
          userId,
          taskOwnerId: existing.consultant_id,
          requestConsultantId: consultantId
        }, 'DELETE /consultant/tasks/:taskId: Access denied - not task owner');
        return reply.status(403).send({ error: 'Not your task' });
      }

      // Удаление задачи
      const deleteStartTime = Date.now();
      const { error } = await supabase
        .from('consultant_tasks')
        .delete()
        .eq('id', taskId);
      const deleteDuration = Date.now() - deleteStartTime;

      if (error) {
        app.log.error({
          error,
          taskId,
          userId,
          duration: deleteDuration
        }, 'DELETE /consultant/tasks/:taskId: Deletion failed');
        return reply.status(500).send({ error: error.message });
      }

      const totalDuration = Date.now() - startTime;

      app.log.info({
        taskId,
        consultantId: existing.consultant_id,
        taskTitle: existing.title,
        taskStatus: existing.status,
        deleteDuration,
        totalDuration
      }, 'DELETE /consultant/tasks/:taskId: Task deleted successfully');

      return reply.send({ success: true });
    } catch (error: any) {
      const totalDuration = Date.now() - startTime;

      app.log.error({
        error,
        userId: request.userAccountId,
        taskId: (request.params as any).taskId,
        duration: totalDuration
      }, 'DELETE /consultant/tasks/:taskId: Unexpected error');
      return reply.status(500).send({ error: error.message });
    }
  });
}
