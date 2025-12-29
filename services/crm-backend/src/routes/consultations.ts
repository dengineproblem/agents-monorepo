import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import {
  sendConfirmationNotification,
  scheduleReminderNotifications,
  cancelPendingNotifications
} from '../lib/consultationNotifications.js';
import {
  getAvailableSlots,
  isSlotAvailable,
  getClientConsultations
} from '../lib/consultationSlots.js';
import { summarizeDialog, getClientInfo } from '../lib/dialogSummarizer.js';

// Validation schemas
const CreateConsultantSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  specialization: z.string().optional(),
  user_account_id: z.string().uuid().optional()
});

const UpdateConsultantSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  specialization: z.string().optional(),
  is_active: z.boolean().optional()
});

const CreateConsultationSchema = z.object({
  consultant_id: z.string().uuid(),
  slot_id: z.string().uuid().optional(),
  client_phone: z.string().min(1),
  client_name: z.string().optional(),
  client_chat_id: z.string().optional(),
  dialog_analysis_id: z.string().uuid().optional(),
  user_account_id: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  end_time: z.string().regex(/^\d{2}:\d{2}$/),
  status: z.enum(['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show']).optional().default('scheduled'),
  notes: z.string().optional(),
  consultation_type: z.string().optional().default('general')
});

const UpdateConsultationSchema = z.object({
  status: z.enum(['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show']).optional(),
  notes: z.string().optional(),
  client_name: z.string().optional(),
  is_sale_closed: z.boolean().optional()
});

const BookFromLeadSchema = z.object({
  dialog_analysis_id: z.string().uuid(),
  consultant_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  end_time: z.string().regex(/^\d{2}:\d{2}$/),
  notes: z.string().optional()
});

// ===== Schemas for Bot Integration =====

const GetAvailableSlotsSchema = z.object({
  consultant_ids: z.array(z.string().uuid()).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  days_ahead: z.coerce.number().int().min(1).max(30).optional(),
  limit: z.coerce.number().int().min(1).max(20).optional(),
  duration_minutes: z.coerce.number().int().min(15).max(240)
});

const BookFromBotSchema = z.object({
  dialog_analysis_id: z.string().uuid(),
  consultant_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  duration_minutes: z.number().int().min(15).max(240),
  client_name: z.string().optional(),
  auto_summarize: z.boolean().optional().default(true)
});

const CancelFromBotSchema = z.object({
  dialog_analysis_id: z.string().uuid(),
  consultation_id: z.string().uuid().optional(),
  reason: z.string().optional()
});

const RescheduleFromBotSchema = z.object({
  dialog_analysis_id: z.string().uuid(),
  consultation_id: z.string().uuid().optional(),
  new_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  new_start_time: z.string().regex(/^\d{2}:\d{2}$/),
  duration_minutes: z.number().int().min(15).max(240).optional()
});

const WorkingScheduleSchema = z.object({
  day_of_week: z.number().int().min(0).max(6),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  end_time: z.string().regex(/^\d{2}:\d{2}$/),
  is_active: z.boolean().optional().default(true)
});

const UpdateWorkingSchedulesSchema = z.object({
  schedules: z.array(WorkingScheduleSchema)
});

export async function consultationsRoutes(app: FastifyInstance) {

  // ==================== CONSULTANTS ====================

  /**
   * GET /consultants
   * Get all active consultants
   */
  app.get('/consultants', async (request, reply) => {
    try {
      const { data, error } = await supabase
        .from('consultants')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (error) {
        app.log.error({ error }, 'Failed to fetch consultants');
        return reply.status(500).send({ error: error.message });
      }

      return reply.send(data || []);
    } catch (error: any) {
      app.log.error({ error }, 'Error fetching consultants');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /consultants
   * Create a new consultant
   */
  app.post('/consultants', async (request, reply) => {
    try {
      const body = CreateConsultantSchema.parse(request.body);

      const { data, error } = await supabase
        .from('consultants')
        .insert([body])
        .select()
        .single();

      if (error) {
        app.log.error({ error }, 'Failed to create consultant');
        return reply.status(500).send({ error: error.message });
      }

      return reply.status(201).send(data);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.errors });
      }
      app.log.error({ error }, 'Error creating consultant');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * PATCH /consultants/:id
   * Update consultant
   */
  app.patch('/consultants/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = UpdateConsultantSchema.parse(request.body);

      const { data, error } = await supabase
        .from('consultants')
        .update(body)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        app.log.error({ error }, 'Failed to update consultant');
        return reply.status(500).send({ error: error.message });
      }

      return reply.send(data);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.errors });
      }
      app.log.error({ error }, 'Error updating consultant');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * DELETE /consultants/:id
   * Soft delete consultant (set is_active = false)
   */
  app.delete('/consultants/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };

      const { error } = await supabase
        .from('consultants')
        .update({ is_active: false })
        .eq('id', id);

      if (error) {
        app.log.error({ error }, 'Failed to delete consultant');
        return reply.status(500).send({ error: error.message });
      }

      return reply.status(204).send();
    } catch (error: any) {
      app.log.error({ error }, 'Error deleting consultant');
      return reply.status(500).send({ error: error.message });
    }
  });

  // ==================== WORKING SCHEDULES ====================

  /**
   * GET /consultants/:id/schedules
   * Get working schedules for a consultant
   */
  app.get('/consultants/:id/schedules', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };

      const { data, error } = await supabase
        .from('working_schedules')
        .select('*')
        .eq('consultant_id', id)
        .order('day_of_week');

      if (error) {
        app.log.error({ error }, 'Failed to fetch working schedules');
        return reply.status(500).send({ error: error.message });
      }

      return reply.send(data || []);
    } catch (error: any) {
      app.log.error({ error }, 'Error fetching working schedules');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * PUT /consultants/:id/schedules
   * Update all working schedules for a consultant (replace)
   */
  app.put('/consultants/:id/schedules', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = UpdateWorkingSchedulesSchema.parse(request.body);

      // Delete existing schedules
      await supabase
        .from('working_schedules')
        .delete()
        .eq('consultant_id', id);

      // Insert new schedules
      if (body.schedules.length > 0) {
        const schedulesWithConsultant = body.schedules.map(s => ({
          ...s,
          consultant_id: id
        }));

        const { data, error } = await supabase
          .from('working_schedules')
          .insert(schedulesWithConsultant)
          .select();

        if (error) {
          app.log.error({ error }, 'Failed to update working schedules');
          return reply.status(500).send({ error: error.message });
        }

        return reply.send(data);
      }

      return reply.send([]);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.errors });
      }
      app.log.error({ error }, 'Error updating working schedules');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /schedules/all
   * Get all working schedules for all active consultants
   */
  app.get('/schedules/all', async (request, reply) => {
    try {
      const { data, error } = await supabase
        .from('working_schedules')
        .select(`
          *,
          consultant:consultants!inner(id, name, is_active)
        `)
        .eq('consultant.is_active', true)
        .order('consultant_id')
        .order('day_of_week');

      if (error) {
        app.log.error({ error }, 'Failed to fetch all working schedules');
        return reply.status(500).send({ error: error.message });
      }

      return reply.send(data || []);
    } catch (error: any) {
      app.log.error({ error }, 'Error fetching all working schedules');
      return reply.status(500).send({ error: error.message });
    }
  });

  // ==================== CONSULTATIONS ====================

  /**
   * GET /consultations
   * Get consultations with optional date filter
   */
  app.get('/consultations', async (request, reply) => {
    try {
      const { date } = request.query as { date?: string };

      let query = supabase
        .from('consultations')
        .select(`
          *,
          consultant:consultants(*)
        `)
        .order('date', { ascending: true })
        .order('start_time', { ascending: true });

      if (date) {
        query = query.eq('date', date);
      }

      const { data, error } = await query;

      if (error) {
        app.log.error({ error }, 'Failed to fetch consultations');
        return reply.status(500).send({ error: error.message });
      }

      // Transform data to match expected format
      const consultations = (data || []).map(item => ({
        ...item,
        consultant: Array.isArray(item.consultant) ? item.consultant[0] : item.consultant,
        slot: item.slot_id ? {
          id: item.slot_id,
          consultant_id: item.consultant_id,
          date: item.date,
          start_time: item.start_time,
          end_time: item.end_time,
          is_available: false,
          is_blocked: false
        } : null
      }));

      return reply.send(consultations);
    } catch (error: any) {
      app.log.error({ error }, 'Error fetching consultations');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /consultations/range
   * Get consultations by date range for a consultant
   */
  app.get('/consultations/range', async (request, reply) => {
    try {
      const { consultantId, startDate, endDate } = request.query as {
        consultantId: string;
        startDate: string;
        endDate: string;
      };

      const { data, error } = await supabase
        .from('consultations')
        .select('*')
        .eq('consultant_id', consultantId)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true })
        .order('start_time', { ascending: true });

      if (error) {
        app.log.error({ error }, 'Failed to fetch consultations by range');
        return reply.status(500).send({ error: error.message });
      }

      return reply.send(data || []);
    } catch (error: any) {
      app.log.error({ error }, 'Error fetching consultations by range');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /consultations/stats
   * Get consultation statistics
   */
  app.get('/consultations/stats', async (request, reply) => {
    try {
      const { data, error } = await supabase
        .from('consultations')
        .select('status');

      if (error) {
        app.log.error({ error }, 'Failed to fetch consultation stats');
        return reply.status(500).send({ error: error.message });
      }

      const stats = {
        total: data?.length || 0,
        scheduled: data?.filter(c => c.status === 'scheduled').length || 0,
        confirmed: data?.filter(c => c.status === 'confirmed').length || 0,
        completed: data?.filter(c => c.status === 'completed').length || 0,
        cancelled: data?.filter(c => c.status === 'cancelled').length || 0,
        no_show: data?.filter(c => c.status === 'no_show').length || 0
      };

      return reply.send(stats);
    } catch (error: any) {
      app.log.error({ error }, 'Error fetching consultation stats');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /consultations
   * Create a new consultation
   */
  app.post('/consultations', async (request, reply) => {
    try {
      const body = CreateConsultationSchema.parse(request.body);

      // Get user_account_id from consultant if not provided
      let userAccountId = body.user_account_id;
      if (!userAccountId) {
        const { data: consultant } = await supabase
          .from('consultants')
          .select('user_account_id')
          .eq('id', body.consultant_id)
          .single();
        userAccountId = consultant?.user_account_id;
      }

      const consultationData: any = {
        consultant_id: body.consultant_id,
        client_phone: body.client_phone,
        client_name: body.client_name || null,
        client_chat_id: body.client_chat_id || null,
        dialog_analysis_id: body.dialog_analysis_id || null,
        user_account_id: userAccountId || null,
        date: body.date,
        start_time: body.start_time,
        end_time: body.end_time,
        status: body.status,
        consultation_type: body.consultation_type,
        notes: body.notes || null
      };

      if (body.slot_id) {
        consultationData.slot_id = body.slot_id;
      }

      const { data, error } = await supabase
        .from('consultations')
        .insert([consultationData])
        .select()
        .single();

      if (error) {
        app.log.error({ error }, 'Failed to create consultation');
        return reply.status(500).send({ error: error.message });
      }

      // If linked to a lead, update the lead's funnel_stage
      if (body.dialog_analysis_id) {
        await supabase
          .from('dialog_analysis')
          .update({ funnel_stage: 'consultation_booked' })
          .eq('id', body.dialog_analysis_id);
      }

      // Send confirmation notification and schedule reminders (async, don't block response)
      if (data && userAccountId) {
        const consultation = {
          id: data.id,
          consultant_id: data.consultant_id,
          user_account_id: userAccountId,
          client_phone: data.client_phone,
          client_name: data.client_name,
          dialog_analysis_id: data.dialog_analysis_id,
          date: data.date,
          start_time: data.start_time,
          end_time: data.end_time
        };

        // Fire and forget - don't wait for notifications
        sendConfirmationNotification(consultation).catch(err => {
          app.log.error({ error: err.message }, 'Failed to send confirmation notification');
        });

        scheduleReminderNotifications(consultation).catch(err => {
          app.log.error({ error: err.message }, 'Failed to schedule reminder notifications');
        });
      }

      return reply.status(201).send(data);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.errors });
      }
      app.log.error({ error }, 'Error creating consultation');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * PATCH /consultations/:id
   * Update consultation
   */
  app.patch('/consultations/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = UpdateConsultationSchema.parse(request.body);

      const { data, error } = await supabase
        .from('consultations')
        .update(body)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        app.log.error({ error }, 'Failed to update consultation');
        return reply.status(500).send({ error: error.message });
      }

      // If status changed to completed, update linked lead
      if (body.status === 'completed' && data.dialog_analysis_id) {
        await supabase
          .from('dialog_analysis')
          .update({ funnel_stage: 'consultation_completed' })
          .eq('id', data.dialog_analysis_id);
      }

      // If status changed to cancelled, cancel pending notifications
      if (body.status === 'cancelled') {
        cancelPendingNotifications(id).catch(err => {
          app.log.error({ error: err.message, consultationId: id }, 'Failed to cancel pending notifications');
        });
      }

      return reply.send(data);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.errors });
      }
      app.log.error({ error }, 'Error updating consultation');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * DELETE /consultations/:id
   * Delete consultation
   */
  app.delete('/consultations/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };

      const { error } = await supabase
        .from('consultations')
        .delete()
        .eq('id', id);

      if (error) {
        app.log.error({ error }, 'Failed to delete consultation');
        return reply.status(500).send({ error: error.message });
      }

      return reply.status(204).send();
    } catch (error: any) {
      app.log.error({ error }, 'Error deleting consultation');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /consultations/book-from-lead
   * Book consultation from a lead (dialog_analysis)
   */
  app.post('/consultations/book-from-lead', async (request, reply) => {
    try {
      const body = BookFromLeadSchema.parse(request.body);

      // Get lead info
      const { data: lead, error: leadError } = await supabase
        .from('dialog_analysis')
        .select('contact_phone, contact_name, id, user_account_id, instance_name')
        .eq('id', body.dialog_analysis_id)
        .single();

      if (leadError || !lead) {
        return reply.status(404).send({ error: 'Lead not found' });
      }

      // Get user_account_id from consultant or lead
      let userAccountId = lead.user_account_id;
      if (!userAccountId) {
        const { data: consultant } = await supabase
          .from('consultants')
          .select('user_account_id')
          .eq('id', body.consultant_id)
          .single();
        userAccountId = consultant?.user_account_id;
      }

      // Create consultation
      const consultationData = {
        consultant_id: body.consultant_id,
        client_phone: lead.contact_phone,
        client_name: lead.contact_name || null,
        dialog_analysis_id: body.dialog_analysis_id,
        user_account_id: userAccountId || null,
        date: body.date,
        start_time: body.start_time,
        end_time: body.end_time,
        status: 'scheduled',
        consultation_type: 'from_lead',
        notes: body.notes || null
      };

      const { data: consultation, error: consultationError } = await supabase
        .from('consultations')
        .insert([consultationData])
        .select()
        .single();

      if (consultationError) {
        app.log.error({ error: consultationError }, 'Failed to create consultation from lead');
        return reply.status(500).send({ error: consultationError.message });
      }

      // Update lead's funnel_stage
      await supabase
        .from('dialog_analysis')
        .update({ funnel_stage: 'consultation_booked' })
        .eq('id', body.dialog_analysis_id);

      // Send confirmation notification and schedule reminders
      if (consultation && userAccountId) {
        const consultationForNotification = {
          id: consultation.id,
          consultant_id: consultation.consultant_id,
          user_account_id: userAccountId,
          client_phone: consultation.client_phone,
          client_name: consultation.client_name,
          dialog_analysis_id: consultation.dialog_analysis_id,
          date: consultation.date,
          start_time: consultation.start_time,
          end_time: consultation.end_time
        };

        sendConfirmationNotification(consultationForNotification).catch(err => {
          app.log.error({ error: err.message }, 'Failed to send confirmation notification');
        });

        scheduleReminderNotifications(consultationForNotification).catch(err => {
          app.log.error({ error: err.message }, 'Failed to schedule reminder notifications');
        });
      }

      return reply.status(201).send(consultation);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.errors });
      }
      app.log.error({ error }, 'Error booking consultation from lead');
      return reply.status(500).send({ error: error.message });
    }
  });

  // ==================== BOT INTEGRATION ====================

  /**
   * GET /consultations/available-slots
   * Get available slots for booking (used by AI bot)
   */
  app.get('/consultations/available-slots', async (request, reply) => {
    try {
      const query = request.query as Record<string, any>;

      // Parse consultant_ids from comma-separated string or array
      let consultantIds: string[] | undefined;
      if (query.consultant_ids) {
        if (typeof query.consultant_ids === 'string') {
          consultantIds = query.consultant_ids.split(',').filter(Boolean);
        } else if (Array.isArray(query.consultant_ids)) {
          consultantIds = query.consultant_ids;
        }
      }

      const params = GetAvailableSlotsSchema.parse({
        ...query,
        consultant_ids: consultantIds
      });

      const slots = await getAvailableSlots({
        consultant_ids: params.consultant_ids,
        date: params.date,
        days_ahead: params.days_ahead || 7,
        limit: params.limit || 5,
        duration_minutes: params.duration_minutes
      });

      return reply.send({ slots });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.errors });
      }
      app.log.error({ error }, 'Error getting available slots');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /consultations/book-from-bot
   * Book consultation from AI bot
   */
  app.post('/consultations/book-from-bot', async (request, reply) => {
    try {
      const body = BookFromBotSchema.parse(request.body);

      // Get client info from lead
      const clientInfo = await getClientInfo(body.dialog_analysis_id);

      if (!clientInfo.phone) {
        return reply.status(400).send({ error: 'Client phone not found in dialog_analysis' });
      }

      // Calculate end time
      const [startHour, startMin] = body.start_time.split(':').map(Number);
      const endMinTotal = startHour * 60 + startMin + body.duration_minutes;
      const endHour = Math.floor(endMinTotal / 60);
      const endMin = endMinTotal % 60;
      const endTime = `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;

      // Check slot availability
      const available = await isSlotAvailable(
        body.consultant_id,
        body.date,
        body.start_time,
        body.duration_minutes
      );

      if (!available) {
        return reply.status(409).send({
          error: 'Slot not available',
          message: 'К сожалению, это время уже занято. Пожалуйста, выберите другое время.'
        });
      }

      // Get or create summary
      let notes = '';
      if (body.auto_summarize) {
        notes = await summarizeDialog(body.dialog_analysis_id);
      }

      // Get consultant name for response
      const { data: consultant } = await supabase
        .from('consultants')
        .select('name, user_account_id')
        .eq('id', body.consultant_id)
        .single();

      const consultantName = consultant?.name || 'консультант';
      const userAccountId = clientInfo.userAccountId || consultant?.user_account_id;

      // Create consultation
      const consultationData = {
        consultant_id: body.consultant_id,
        client_phone: clientInfo.phone,
        client_name: body.client_name || clientInfo.name || null,
        client_chat_id: clientInfo.chatId || null,
        dialog_analysis_id: body.dialog_analysis_id,
        user_account_id: userAccountId || null,
        date: body.date,
        start_time: body.start_time,
        end_time: endTime,
        status: 'scheduled',
        consultation_type: 'from_bot',
        notes
      };

      const { data: consultation, error: consultationError } = await supabase
        .from('consultations')
        .insert([consultationData])
        .select()
        .single();

      if (consultationError) {
        app.log.error({ error: consultationError }, 'Failed to create consultation from bot');
        return reply.status(500).send({ error: consultationError.message });
      }

      // Update lead's funnel_stage
      await supabase
        .from('dialog_analysis')
        .update({ funnel_stage: 'consultation_booked' })
        .eq('id', body.dialog_analysis_id);

      // Format date for confirmation message
      const slotDate = new Date(body.date);
      const day = slotDate.getDate();
      const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                      'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
      const month = months[slotDate.getMonth()];

      const confirmationMessage = `Отлично! Вы записаны на консультацию ${day} ${month} в ${body.start_time} к специалисту ${consultantName}. Мы пришлём вам напоминание!`;

      // Send notifications
      if (consultation && userAccountId) {
        const consultationForNotification = {
          id: consultation.id,
          consultant_id: consultation.consultant_id,
          user_account_id: userAccountId,
          client_phone: consultation.client_phone,
          client_name: consultation.client_name,
          dialog_analysis_id: consultation.dialog_analysis_id,
          date: consultation.date,
          start_time: consultation.start_time,
          end_time: consultation.end_time
        };

        sendConfirmationNotification(consultationForNotification).catch(err => {
          app.log.error({ error: err.message }, 'Failed to send confirmation notification');
        });

        scheduleReminderNotifications(consultationForNotification).catch(err => {
          app.log.error({ error: err.message }, 'Failed to schedule reminder notifications');
        });
      }

      return reply.status(201).send({
        success: true,
        consultation,
        confirmation_message: confirmationMessage
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.errors });
      }
      app.log.error({ error }, 'Error booking consultation from bot');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /consultations/cancel-from-bot
   * Cancel consultation from AI bot
   */
  app.post('/consultations/cancel-from-bot', async (request, reply) => {
    try {
      const body = CancelFromBotSchema.parse(request.body);

      // Find consultation
      let consultationId = body.consultation_id;

      if (!consultationId) {
        // Find the latest active consultation for this lead
        const { data: consultations } = await supabase
          .from('consultations')
          .select('id')
          .eq('dialog_analysis_id', body.dialog_analysis_id)
          .in('status', ['scheduled', 'confirmed'])
          .order('date', { ascending: true })
          .order('start_time', { ascending: true })
          .limit(1);

        if (!consultations?.length) {
          return reply.status(404).send({
            error: 'No active consultation found',
            message: 'У вас нет активных записей на консультацию.'
          });
        }

        consultationId = consultations[0].id;
      }

      // Update consultation status
      const updateData: any = { status: 'cancelled' };
      if (body.reason) {
        // Append reason to notes
        const { data: existing } = await supabase
          .from('consultations')
          .select('notes')
          .eq('id', consultationId)
          .single();

        updateData.notes = existing?.notes
          ? `${existing.notes}\n\nПричина отмены: ${body.reason}`
          : `Причина отмены: ${body.reason}`;
      }

      const { data: consultation, error } = await supabase
        .from('consultations')
        .update(updateData)
        .eq('id', consultationId)
        .select()
        .single();

      if (error) {
        app.log.error({ error }, 'Failed to cancel consultation');
        return reply.status(500).send({ error: error.message });
      }

      // Cancel pending notifications
      if (consultationId) {
        cancelPendingNotifications(consultationId).catch(err => {
          app.log.error({ error: err.message }, 'Failed to cancel pending notifications');
        });
      }

      return reply.send({
        success: true,
        message: 'Ваша запись на консультацию отменена. Если вы захотите записаться снова, просто напишите мне!',
        consultation
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.errors });
      }
      app.log.error({ error }, 'Error cancelling consultation from bot');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /consultations/reschedule-from-bot
   * Reschedule consultation from AI bot
   */
  app.post('/consultations/reschedule-from-bot', async (request, reply) => {
    try {
      const body = RescheduleFromBotSchema.parse(request.body);

      // Find consultation
      let consultationId = body.consultation_id;
      let currentConsultation: any;

      if (!consultationId) {
        // Find the latest active consultation for this lead
        const { data: consultations } = await supabase
          .from('consultations')
          .select('*')
          .eq('dialog_analysis_id', body.dialog_analysis_id)
          .in('status', ['scheduled', 'confirmed'])
          .order('date', { ascending: true })
          .order('start_time', { ascending: true })
          .limit(1);

        if (!consultations?.length) {
          return reply.status(404).send({
            error: 'No active consultation found',
            message: 'У вас нет активных записей на консультацию для переноса.'
          });
        }

        currentConsultation = consultations[0];
        consultationId = currentConsultation.id;
      } else {
        const { data } = await supabase
          .from('consultations')
          .select('*')
          .eq('id', consultationId)
          .single();
        currentConsultation = data;
      }

      if (!currentConsultation) {
        return reply.status(404).send({ error: 'Consultation not found' });
      }

      // Calculate duration from current consultation or use provided
      let durationMinutes = body.duration_minutes;
      if (!durationMinutes) {
        const [startH, startM] = currentConsultation.start_time.split(':').map(Number);
        const [endH, endM] = currentConsultation.end_time.split(':').map(Number);
        durationMinutes = (endH * 60 + endM) - (startH * 60 + startM);
      }

      // Check new slot availability
      const available = await isSlotAvailable(
        currentConsultation.consultant_id,
        body.new_date,
        body.new_start_time,
        durationMinutes
      );

      if (!available) {
        return reply.status(409).send({
          error: 'Slot not available',
          message: 'К сожалению, это время уже занято. Пожалуйста, выберите другое время.'
        });
      }

      // Calculate new end time
      const [startHour, startMin] = body.new_start_time.split(':').map(Number);
      const endMinTotal = startHour * 60 + startMin + durationMinutes;
      const endHour = Math.floor(endMinTotal / 60);
      const endMin = endMinTotal % 60;
      const newEndTime = `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;

      // Update consultation
      const { data: consultation, error } = await supabase
        .from('consultations')
        .update({
          date: body.new_date,
          start_time: body.new_start_time,
          end_time: newEndTime
        })
        .eq('id', consultationId)
        .select()
        .single();

      if (error) {
        app.log.error({ error }, 'Failed to reschedule consultation');
        return reply.status(500).send({ error: error.message });
      }

      // Cancel old notifications and schedule new ones
      if (consultationId) {
        cancelPendingNotifications(consultationId).catch(err => {
          app.log.error({ error: err.message }, 'Failed to cancel pending notifications');
        });
      }

      if (consultation && currentConsultation.user_account_id) {
        const consultationForNotification = {
          id: consultation.id,
          consultant_id: consultation.consultant_id,
          user_account_id: currentConsultation.user_account_id,
          client_phone: consultation.client_phone,
          client_name: consultation.client_name,
          dialog_analysis_id: consultation.dialog_analysis_id,
          date: consultation.date,
          start_time: consultation.start_time,
          end_time: consultation.end_time
        };

        scheduleReminderNotifications(consultationForNotification).catch(err => {
          app.log.error({ error: err.message }, 'Failed to schedule reminder notifications');
        });
      }

      // Format date for message
      const slotDate = new Date(body.new_date);
      const day = slotDate.getDate();
      const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                      'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
      const month = months[slotDate.getMonth()];

      return reply.send({
        success: true,
        message: `Ваша консультация перенесена на ${day} ${month} в ${body.new_start_time}. Мы пришлём вам напоминание!`,
        consultation
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.errors });
      }
      app.log.error({ error }, 'Error rescheduling consultation from bot');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /consultations/by-lead/:dialogAnalysisId
   * Get consultations for a specific lead (used by AI bot)
   */
  app.get('/consultations/by-lead/:dialogAnalysisId', async (request, reply) => {
    try {
      const { dialogAnalysisId } = request.params as { dialogAnalysisId: string };

      const consultations = await getClientConsultations(dialogAnalysisId);

      if (consultations.length === 0) {
        return reply.send({
          has_consultations: false,
          message: 'У вас пока нет записей на консультацию.',
          consultations: []
        });
      }

      return reply.send({
        has_consultations: true,
        consultations
      });
    } catch (error: any) {
      app.log.error({ error }, 'Error getting consultations by lead');
      return reply.status(500).send({ error: error.message });
    }
  });
}
