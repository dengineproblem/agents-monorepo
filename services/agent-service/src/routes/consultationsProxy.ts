/**
 * Consultations Proxy Routes
 *
 * Проксирует запросы к Supabase для работы с консультациями и консультантами.
 * Все операции защищены IDOR через x-user-id.
 *
 * @module routes/consultationsProxy
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger({ module: 'consultationsProxyRoutes' });

export default async function consultationsProxyRoutes(app: FastifyInstance) {

  // ========================================
  // CONSULTANTS
  // ========================================

  /**
   * GET /consultations/consultants
   * Получение списка активных консультантов
   */
  app.get('/consultations/consultants', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      if (!userId) {
        return reply.status(401).send({ error: 'x-user-id header is required' });
      }

      // IDOR: фильтруем консультантов по parent_user_account_id
      const { data, error } = await supabase
        .from('consultants')
        .select('*')
        .eq('parent_user_account_id', userId)
        .eq('is_active', true)
        .order('name');

      if (error) {
        log.error({ error, userId }, 'Failed to fetch consultants');
        return reply.status(500).send({ error: 'Failed to fetch consultants' });
      }

      return data || [];
    } catch (error: any) {
      log.error({ error }, 'Error fetching consultants');
      return reply.status(500).send({ error: 'internal_error', message: error.message });
    }
  });

  /**
   * POST /consultations/consultants
   * Создание нового консультанта
   */
  app.post('/consultations/consultants', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      if (!userId) {
        return reply.status(401).send({ error: 'x-user-id header is required' });
      }

      const body = req.body as {
        name: string;
        email: string;
        phone?: string;
        specialization?: string;
      };

      if (!body.name || !body.email) {
        return reply.status(400).send({ error: 'name and email are required' });
      }

      // IDOR: привязываем консультанта к пользователю
      const { data, error } = await supabase
        .from('consultants')
        .insert([{
          name: body.name,
          email: body.email,
          phone: body.phone || null,
          specialization: body.specialization || null,
          parent_user_account_id: userId,
        }])
        .select()
        .single();

      if (error) {
        log.error({ error, userId }, 'Failed to create consultant');
        return reply.status(500).send({ error: 'Failed to create consultant' });
      }

      return data;
    } catch (error: any) {
      log.error({ error }, 'Error creating consultant');
      return reply.status(500).send({ error: 'internal_error', message: error.message });
    }
  });

  // ========================================
  // CONSULTATIONS
  // ========================================

  /**
   * GET /consultations
   * Получение списка консультаций (с опциональным фильтром по дате)
   * Query params: date (optional, формат YYYY-MM-DD)
   */
  app.get('/consultations', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      if (!userId) {
        return reply.status(401).send({ error: 'x-user-id header is required' });
      }

      const { date } = req.query as { date?: string };

      // IDOR: фильтруем консультации по user_account_id
      let query = supabase
        .from('consultations')
        .select(`
          *,
          consultant:consultants!inner(*),
          service:services(*)
        `)
        .eq('user_account_id', userId)
        .order('date', { ascending: true })
        .order('start_time', { ascending: true });

      if (date) {
        query = query.eq('date', date);
      }

      const { data, error } = await query;

      if (error) {
        log.error({ error, userId }, 'Failed to fetch consultations');
        return reply.status(500).send({ error: 'Failed to fetch consultations' });
      }

      return data || [];
    } catch (error: any) {
      log.error({ error }, 'Error fetching consultations');
      return reply.status(500).send({ error: 'internal_error', message: error.message });
    }
  });

  /**
   * GET /consultations/stats
   * Получение статистики по консультациям
   */
  app.get('/consultations/stats', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      if (!userId) {
        return reply.status(401).send({ error: 'x-user-id header is required' });
      }

      // IDOR: фильтруем статистику по user_account_id
      const { data, error } = await supabase
        .from('consultations')
        .select('status')
        .eq('user_account_id', userId);

      if (error) {
        log.error({ error, userId }, 'Failed to fetch consultation stats');
        return reply.status(500).send({ error: 'Failed to fetch consultation stats' });
      }

      const stats = {
        total: data?.length || 0,
        scheduled: data?.filter((c: any) => c.status === 'scheduled').length || 0,
        confirmed: data?.filter((c: any) => c.status === 'confirmed').length || 0,
        completed: data?.filter((c: any) => c.status === 'completed').length || 0,
        cancelled: data?.filter((c: any) => c.status === 'cancelled').length || 0,
        no_show: data?.filter((c: any) => c.status === 'no_show').length || 0,
      };

      return stats;
    } catch (error: any) {
      log.error({ error }, 'Error fetching consultation stats');
      return reply.status(500).send({ error: 'internal_error', message: error.message });
    }
  });

  /**
   * GET /consultations/by-date-range
   * Получение консультаций по диапазону дат и консультанту
   * Query params: consultantId, startDate, endDate
   */
  app.get('/consultations/by-date-range', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      if (!userId) {
        return reply.status(401).send({ error: 'x-user-id header is required' });
      }

      const { consultantId, startDate, endDate } = req.query as {
        consultantId?: string;
        startDate?: string;
        endDate?: string;
      };

      if (!consultantId || !startDate || !endDate) {
        return reply.status(400).send({ error: 'consultantId, startDate, and endDate are required' });
      }

      // IDOR: фильтруем по user_account_id
      const { data, error } = await supabase
        .from('consultations')
        .select('*')
        .eq('user_account_id', userId)
        .eq('consultant_id', consultantId)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true })
        .order('start_time', { ascending: true });

      if (error) {
        log.error({ error, userId }, 'Failed to fetch consultations by date range');
        return reply.status(500).send({ error: 'Failed to fetch consultations by date range' });
      }

      return data || [];
    } catch (error: any) {
      log.error({ error }, 'Error fetching consultations by date range');
      return reply.status(500).send({ error: 'internal_error', message: error.message });
    }
  });

  /**
   * POST /consultations
   * Создание новой консультации
   */
  app.post('/consultations', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      if (!userId) {
        return reply.status(401).send({ error: 'x-user-id header is required' });
      }

      const body = req.body as {
        consultant_id: string;
        slot_id?: string;
        client_phone: string;
        client_name?: string;
        client_chat_id?: string;
        date: string;
        start_time: string;
        end_time: string;
        status?: string;
        notes?: string;
        consultation_type?: string;
        service_id?: string;
        actual_duration_minutes?: number;
        is_sale_closed?: boolean;
      };

      if (!body.consultant_id || !body.client_phone || !body.date || !body.start_time || !body.end_time) {
        return reply.status(400).send({ error: 'consultant_id, client_phone, date, start_time, end_time are required' });
      }

      // IDOR: привязываем консультацию к пользователю
      const consultationData: Record<string, any> = {
        consultant_id: body.consultant_id,
        client_phone: body.client_phone,
        client_name: body.client_name || null,
        client_chat_id: body.client_chat_id || '',
        date: body.date,
        start_time: body.start_time,
        end_time: body.end_time,
        status: body.status || 'scheduled',
        consultation_type: body.consultation_type || 'general',
        notes: body.notes || null,
        service_id: body.service_id || null,
        actual_duration_minutes: body.actual_duration_minutes || null,
        is_sale_closed: body.is_sale_closed || false,
        user_account_id: userId,
      };

      // Добавляем slot_id только если он передан и не пустой
      if (body.slot_id) {
        consultationData.slot_id = body.slot_id;
      }

      const { data, error } = await supabase
        .from('consultations')
        .insert([consultationData])
        .select()
        .single();

      if (error) {
        log.error({ error, userId }, 'Failed to create consultation');
        return reply.status(500).send({ error: 'Failed to create consultation' });
      }

      return data;
    } catch (error: any) {
      log.error({ error }, 'Error creating consultation');
      return reply.status(500).send({ error: 'internal_error', message: error.message });
    }
  });

  /**
   * PATCH /consultations/:id
   * Обновление консультации
   */
  app.patch('/consultations/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      if (!userId) {
        return reply.status(401).send({ error: 'x-user-id header is required' });
      }

      const { id } = req.params;
      const updates = req.body as Record<string, any>;

      if (!id) {
        return reply.status(400).send({ error: 'Consultation id is required' });
      }

      // IDOR: обновляем только консультации пользователя
      const { data, error } = await supabase
        .from('consultations')
        .update(updates)
        .eq('id', id)
        .eq('user_account_id', userId)
        .select()
        .single();

      if (error) {
        log.error({ error, userId, consultationId: id }, 'Failed to update consultation');
        return reply.status(500).send({ error: 'Failed to update consultation' });
      }

      return data;
    } catch (error: any) {
      log.error({ error }, 'Error updating consultation');
      return reply.status(500).send({ error: 'internal_error', message: error.message });
    }
  });

  /**
   * PATCH /consultations/:id/cancel
   * Отмена консультации (установка статуса cancelled)
   */
  app.patch('/consultations/:id/cancel', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      if (!userId) {
        return reply.status(401).send({ error: 'x-user-id header is required' });
      }

      const { id } = req.params;

      if (!id) {
        return reply.status(400).send({ error: 'Consultation id is required' });
      }

      // IDOR: отменяем только консультации пользователя
      const { error } = await supabase
        .from('consultations')
        .update({ status: 'cancelled' })
        .eq('id', id)
        .eq('user_account_id', userId);

      if (error) {
        log.error({ error, userId, consultationId: id }, 'Failed to cancel consultation');
        return reply.status(500).send({ error: 'Failed to cancel consultation' });
      }

      return { success: true };
    } catch (error: any) {
      log.error({ error }, 'Error cancelling consultation');
      return reply.status(500).send({ error: 'internal_error', message: error.message });
    }
  });
}
