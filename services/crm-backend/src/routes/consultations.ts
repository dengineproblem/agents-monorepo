import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';

// Validation schemas
const CreateConsultantSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  specialization: z.string().optional()
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

      const consultationData: any = {
        consultant_id: body.consultant_id,
        client_phone: body.client_phone,
        client_name: body.client_name || null,
        client_chat_id: body.client_chat_id || null,
        dialog_analysis_id: body.dialog_analysis_id || null,
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
        .select('contact_phone, contact_name, id')
        .eq('id', body.dialog_analysis_id)
        .single();

      if (leadError || !lead) {
        return reply.status(404).send({ error: 'Lead not found' });
      }

      // Create consultation
      const consultationData = {
        consultant_id: body.consultant_id,
        client_phone: lead.contact_phone,
        client_name: lead.contact_name || null,
        dialog_analysis_id: body.dialog_analysis_id,
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

      return reply.status(201).send(consultation);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.errors });
      }
      app.log.error({ error }, 'Error booking consultation from lead');
      return reply.status(500).send({ error: error.message });
    }
  });
}
