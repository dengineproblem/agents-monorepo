import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';

// Validation schemas
const CreateServiceSchema = z.object({
  user_account_id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
  duration_minutes: z.number().int().min(15).max(480).default(60),
  price: z.number().min(0).default(0),
  currency: z.string().length(3).default('RUB'),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#3B82F6'),
  is_active: z.boolean().default(true),
  sort_order: z.number().int().default(0)
});

const UpdateServiceSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  duration_minutes: z.number().int().min(15).max(480).optional(),
  price: z.number().min(0).optional(),
  currency: z.string().length(3).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().optional()
});

const AssignServiceToConsultantSchema = z.object({
  consultant_id: z.string().uuid(),
  service_id: z.string().uuid(),
  custom_price: z.number().min(0).nullable().optional(),
  custom_duration: z.number().int().min(15).max(480).nullable().optional(),
  is_active: z.boolean().default(true)
});

const UpdateConsultantServiceSchema = z.object({
  custom_price: z.number().min(0).nullable().optional(),
  custom_duration: z.number().int().min(15).max(480).nullable().optional(),
  is_active: z.boolean().optional()
});

export async function consultationServicesRoutes(app: FastifyInstance) {

  // ==================== SERVICES CRUD ====================

  /**
   * GET /consultation-services
   * Get all services for a user account
   */
  app.get('/consultation-services', async (request, reply) => {
    try {
      const { user_account_id, include_inactive } = request.query as {
        user_account_id: string;
        include_inactive?: string;
      };

      if (!user_account_id) {
        return reply.status(400).send({ error: 'user_account_id is required' });
      }

      let query = supabase
        .from('consultation_services')
        .select('*')
        .eq('user_account_id', user_account_id)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });

      if (include_inactive !== 'true') {
        query = query.eq('is_active', true);
      }

      const { data, error } = await query;

      if (error) {
        app.log.error({ error }, 'Failed to fetch consultation services');
        return reply.status(500).send({ error: error.message });
      }

      return reply.send(data || []);
    } catch (error: any) {
      app.log.error({ error }, 'Error fetching consultation services');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /consultation-services/:id
   * Get a single service by ID
   */
  app.get('/consultation-services/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };

      const { data, error } = await supabase
        .from('consultation_services')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return reply.status(404).send({ error: 'Service not found' });
        }
        app.log.error({ error }, 'Failed to fetch consultation service');
        return reply.status(500).send({ error: error.message });
      }

      return reply.send(data);
    } catch (error: any) {
      app.log.error({ error }, 'Error fetching consultation service');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /consultation-services
   * Create a new service
   */
  app.post('/consultation-services', async (request, reply) => {
    try {
      const body = CreateServiceSchema.parse(request.body);

      const { data, error } = await supabase
        .from('consultation_services')
        .insert([body])
        .select()
        .single();

      if (error) {
        app.log.error({ error }, 'Failed to create consultation service');
        return reply.status(500).send({ error: error.message });
      }

      return reply.status(201).send(data);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.errors });
      }
      app.log.error({ error }, 'Error creating consultation service');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * PATCH /consultation-services/:id
   * Update a service
   */
  app.patch('/consultation-services/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = UpdateServiceSchema.parse(request.body);

      const { data, error } = await supabase
        .from('consultation_services')
        .update(body)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return reply.status(404).send({ error: 'Service not found' });
        }
        app.log.error({ error }, 'Failed to update consultation service');
        return reply.status(500).send({ error: error.message });
      }

      return reply.send(data);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.errors });
      }
      app.log.error({ error }, 'Error updating consultation service');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * DELETE /consultation-services/:id
   * Soft delete a service (set is_active = false)
   */
  app.delete('/consultation-services/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const { hard } = request.query as { hard?: string };

      if (hard === 'true') {
        // Hard delete
        const { error } = await supabase
          .from('consultation_services')
          .delete()
          .eq('id', id);

        if (error) {
          app.log.error({ error }, 'Failed to delete consultation service');
          return reply.status(500).send({ error: error.message });
        }
      } else {
        // Soft delete
        const { error } = await supabase
          .from('consultation_services')
          .update({ is_active: false })
          .eq('id', id);

        if (error) {
          app.log.error({ error }, 'Failed to deactivate consultation service');
          return reply.status(500).send({ error: error.message });
        }
      }

      return reply.status(204).send();
    } catch (error: any) {
      app.log.error({ error }, 'Error deleting consultation service');
      return reply.status(500).send({ error: error.message });
    }
  });

  // ==================== CONSULTANT-SERVICE ASSIGNMENTS ====================

  /**
   * GET /consultant-services/:consultantId
   * Get all services assigned to a consultant
   */
  app.get('/consultant-services/:consultantId', async (request, reply) => {
    try {
      const { consultantId } = request.params as { consultantId: string };

      const { data, error } = await supabase
        .from('consultant_services')
        .select(`
          *,
          service:consultation_services(*)
        `)
        .eq('consultant_id', consultantId)
        .eq('is_active', true);

      if (error) {
        app.log.error({ error }, 'Failed to fetch consultant services');
        return reply.status(500).send({ error: error.message });
      }

      return reply.send(data || []);
    } catch (error: any) {
      app.log.error({ error }, 'Error fetching consultant services');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /consultant-services
   * Assign a service to a consultant
   */
  app.post('/consultant-services', async (request, reply) => {
    try {
      const body = AssignServiceToConsultantSchema.parse(request.body);

      const { data, error } = await supabase
        .from('consultant_services')
        .upsert([body], { onConflict: 'consultant_id,service_id' })
        .select(`
          *,
          service:consultation_services(*)
        `)
        .single();

      if (error) {
        app.log.error({ error }, 'Failed to assign service to consultant');
        return reply.status(500).send({ error: error.message });
      }

      return reply.status(201).send(data);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.errors });
      }
      app.log.error({ error }, 'Error assigning service to consultant');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * PATCH /consultant-services/:id
   * Update a consultant-service assignment
   */
  app.patch('/consultant-services/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = UpdateConsultantServiceSchema.parse(request.body);

      const { data, error } = await supabase
        .from('consultant_services')
        .update(body)
        .eq('id', id)
        .select(`
          *,
          service:consultation_services(*)
        `)
        .single();

      if (error) {
        app.log.error({ error }, 'Failed to update consultant service');
        return reply.status(500).send({ error: error.message });
      }

      return reply.send(data);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.errors });
      }
      app.log.error({ error }, 'Error updating consultant service');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * DELETE /consultant-services/:id
   * Remove a service assignment from a consultant
   */
  app.delete('/consultant-services/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };

      const { error } = await supabase
        .from('consultant_services')
        .delete()
        .eq('id', id);

      if (error) {
        app.log.error({ error }, 'Failed to delete consultant service');
        return reply.status(500).send({ error: error.message });
      }

      return reply.status(204).send();
    } catch (error: any) {
      app.log.error({ error }, 'Error deleting consultant service');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * PUT /consultant-services/bulk/:consultantId
   * Bulk update services for a consultant
   */
  app.put('/consultant-services/bulk/:consultantId', async (request, reply) => {
    try {
      const { consultantId } = request.params as { consultantId: string };
      const { service_ids } = request.body as { service_ids: string[] };

      if (!Array.isArray(service_ids)) {
        return reply.status(400).send({ error: 'service_ids must be an array' });
      }

      // Delete existing assignments
      await supabase
        .from('consultant_services')
        .delete()
        .eq('consultant_id', consultantId);

      // Insert new assignments
      if (service_ids.length > 0) {
        const assignments = service_ids.map(service_id => ({
          consultant_id: consultantId,
          service_id,
          is_active: true
        }));

        const { data, error } = await supabase
          .from('consultant_services')
          .insert(assignments)
          .select(`
            *,
            service:consultation_services(*)
          `);

        if (error) {
          app.log.error({ error }, 'Failed to bulk update consultant services');
          return reply.status(500).send({ error: error.message });
        }

        return reply.send(data);
      }

      return reply.send([]);
    } catch (error: any) {
      app.log.error({ error }, 'Error bulk updating consultant services');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /services-by-consultant
   * Get all services grouped by consultant (for booking widget)
   */
  app.get('/services-by-consultant', async (request, reply) => {
    try {
      const { user_account_id } = request.query as { user_account_id: string };

      if (!user_account_id) {
        return reply.status(400).send({ error: 'user_account_id is required' });
      }

      // Get all active consultants
      const { data: consultants, error: consultantsError } = await supabase
        .from('consultants')
        .select('*')
        .eq('user_account_id', user_account_id)
        .eq('is_active', true)
        .order('name');

      if (consultantsError) {
        throw consultantsError;
      }

      // Get all service assignments
      const { data: assignments, error: assignmentsError } = await supabase
        .from('consultant_services')
        .select(`
          *,
          service:consultation_services!inner(*)
        `)
        .eq('is_active', true)
        .eq('service.is_active', true);

      if (assignmentsError) {
        throw assignmentsError;
      }

      // Get all active services for the account
      const { data: services, error: servicesError } = await supabase
        .from('consultation_services')
        .select('*')
        .eq('user_account_id', user_account_id)
        .eq('is_active', true)
        .order('sort_order')
        .order('name');

      if (servicesError) {
        throw servicesError;
      }

      // Group services by consultant
      const result = consultants?.map(consultant => {
        const consultantAssignments = assignments?.filter(a => a.consultant_id === consultant.id) || [];

        // If consultant has specific assignments, use those
        // Otherwise, return all services (consultant can do everything)
        const consultantServices = consultantAssignments.length > 0
          ? consultantAssignments.map(a => ({
              ...a.service,
              custom_price: a.custom_price,
              custom_duration: a.custom_duration
            }))
          : services;

        return {
          consultant,
          services: consultantServices
        };
      }) || [];

      return reply.send(result);
    } catch (error: any) {
      app.log.error({ error }, 'Error fetching services by consultant');
      return reply.status(500).send({ error: error.message });
    }
  });
}
