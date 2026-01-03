import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';

/**
 * Routes for managing consultation services and consultant-service assignments.
 *
 * Услуги консультаций:
 * - CRUD для услуг (consultation_services)
 * - Назначение услуг консультантам (consultant_services)
 * - Поддержка кастомных цен и длительности для консультантов
 */

// Helper: Generate request ID for tracing
const generateRequestId = () => `svc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

// Validation schemas
const UUIDSchema = z.string().uuid();

const CreateServiceSchema = z.object({
  user_account_id: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  duration_minutes: z.number().int().min(15).max(480).default(60),
  price: z.number().min(0).max(1000000).default(0),
  currency: z.string().length(3).default('RUB'),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#3B82F6'),
  is_active: z.boolean().default(true),
  sort_order: z.number().int().min(0).max(1000).default(0)
});

const UpdateServiceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  duration_minutes: z.number().int().min(15).max(480).optional(),
  price: z.number().min(0).max(1000000).optional(),
  currency: z.string().length(3).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(1000).optional()
});

const AssignServiceToConsultantSchema = z.object({
  consultant_id: z.string().uuid(),
  service_id: z.string().uuid(),
  custom_price: z.number().min(0).max(1000000).nullable().optional(),
  custom_duration: z.number().int().min(15).max(480).nullable().optional(),
  is_active: z.boolean().default(true)
});

const UpdateConsultantServiceSchema = z.object({
  custom_price: z.number().min(0).max(1000000).nullable().optional(),
  custom_duration: z.number().int().min(15).max(480).nullable().optional(),
  is_active: z.boolean().optional()
});

const BulkUpdateSchema = z.object({
  service_ids: z.array(z.string().uuid()).max(50)
});

export async function consultationServicesRoutes(app: FastifyInstance) {

  // ==================== SERVICES CRUD ====================

  /**
   * GET /consultation-services
   * Get all services for a user account
   */
  app.get('/consultation-services', async (request, reply) => {
    const requestId = generateRequestId();
    const startTime = Date.now();

    try {
      const { user_account_id, include_inactive } = request.query as {
        user_account_id: string;
        include_inactive?: string;
      };

      if (!user_account_id) {
        app.log.warn({ requestId }, 'Missing user_account_id parameter');
        return reply.status(400).send({ error: 'user_account_id is required' });
      }

      // Validate UUID
      const uuidResult = UUIDSchema.safeParse(user_account_id);
      if (!uuidResult.success) {
        app.log.warn({ requestId, user_account_id }, 'Invalid user_account_id format');
        return reply.status(400).send({ error: 'Invalid user_account_id format' });
      }

      app.log.info({
        requestId,
        userAccountId: user_account_id,
        includeInactive: include_inactive === 'true'
      }, 'Fetching consultation services');

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
        app.log.error({ requestId, error: error.message, code: error.code }, 'Failed to fetch consultation services');
        return reply.status(500).send({ error: error.message });
      }

      const duration = Date.now() - startTime;
      app.log.info({
        requestId,
        count: data?.length || 0,
        durationMs: duration
      }, 'Consultation services fetched successfully');

      return reply.send(data || []);
    } catch (error: any) {
      app.log.error({ requestId, error: error.message, stack: error.stack }, 'Error fetching consultation services');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /consultation-services/:id
   * Get a single service by ID
   */
  app.get('/consultation-services/:id', async (request, reply) => {
    const requestId = generateRequestId();

    try {
      const { id } = request.params as { id: string };

      // Validate UUID
      const uuidResult = UUIDSchema.safeParse(id);
      if (!uuidResult.success) {
        app.log.warn({ requestId, id }, 'Invalid service ID format');
        return reply.status(400).send({ error: 'Invalid service ID format' });
      }

      app.log.info({ requestId, serviceId: id }, 'Fetching consultation service');

      const { data, error } = await supabase
        .from('consultation_services')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          app.log.warn({ requestId, serviceId: id }, 'Service not found');
          return reply.status(404).send({ error: 'Service not found' });
        }
        app.log.error({ requestId, error: error.message }, 'Failed to fetch consultation service');
        return reply.status(500).send({ error: error.message });
      }

      app.log.info({ requestId, serviceId: id, serviceName: data.name }, 'Service fetched successfully');
      return reply.send(data);
    } catch (error: any) {
      app.log.error({ requestId, error: error.message, stack: error.stack }, 'Error fetching consultation service');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /consultation-services
   * Create a new service
   */
  app.post('/consultation-services', async (request, reply) => {
    const requestId = generateRequestId();

    try {
      const parseResult = CreateServiceSchema.safeParse(request.body);
      if (!parseResult.success) {
        app.log.warn({ requestId, errors: parseResult.error.errors }, 'Service creation validation failed');
        return reply.status(400).send({ error: 'Validation error', details: parseResult.error.errors });
      }

      const body = parseResult.data;

      app.log.info({
        requestId,
        userAccountId: body.user_account_id,
        serviceName: body.name,
        durationMinutes: body.duration_minutes,
        price: body.price
      }, 'Creating consultation service');

      const { data, error } = await supabase
        .from('consultation_services')
        .insert([body])
        .select()
        .single();

      if (error) {
        app.log.error({ requestId, error: error.message, code: error.code }, 'Failed to create consultation service');
        return reply.status(500).send({ error: error.message });
      }

      app.log.info({
        requestId,
        serviceId: data.id,
        serviceName: data.name
      }, 'Consultation service created successfully');

      return reply.status(201).send(data);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        app.log.warn({ requestId, errors: error.errors }, 'Service creation validation failed');
        return reply.status(400).send({ error: 'Validation error', details: error.errors });
      }
      app.log.error({ requestId, error: error.message, stack: error.stack }, 'Error creating consultation service');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * PATCH /consultation-services/:id
   * Update a service
   */
  app.patch('/consultation-services/:id', async (request, reply) => {
    const requestId = generateRequestId();

    try {
      const { id } = request.params as { id: string };

      // Validate UUID
      const uuidResult = UUIDSchema.safeParse(id);
      if (!uuidResult.success) {
        app.log.warn({ requestId, id }, 'Invalid service ID format');
        return reply.status(400).send({ error: 'Invalid service ID format' });
      }

      const parseResult = UpdateServiceSchema.safeParse(request.body);
      if (!parseResult.success) {
        app.log.warn({ requestId, errors: parseResult.error.errors }, 'Service update validation failed');
        return reply.status(400).send({ error: 'Validation error', details: parseResult.error.errors });
      }

      const body = parseResult.data;

      app.log.info({
        requestId,
        serviceId: id,
        updates: Object.keys(body)
      }, 'Updating consultation service');

      const { data, error } = await supabase
        .from('consultation_services')
        .update(body)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          app.log.warn({ requestId, serviceId: id }, 'Service not found for update');
          return reply.status(404).send({ error: 'Service not found' });
        }
        app.log.error({ requestId, error: error.message }, 'Failed to update consultation service');
        return reply.status(500).send({ error: error.message });
      }

      app.log.info({
        requestId,
        serviceId: id,
        serviceName: data.name
      }, 'Consultation service updated successfully');

      return reply.send(data);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        app.log.warn({ requestId, errors: error.errors }, 'Service update validation failed');
        return reply.status(400).send({ error: 'Validation error', details: error.errors });
      }
      app.log.error({ requestId, error: error.message, stack: error.stack }, 'Error updating consultation service');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * DELETE /consultation-services/:id
   * Soft delete a service (set is_active = false) or hard delete with ?hard=true
   */
  app.delete('/consultation-services/:id', async (request, reply) => {
    const requestId = generateRequestId();

    try {
      const { id } = request.params as { id: string };
      const { hard } = request.query as { hard?: string };

      // Validate UUID
      const uuidResult = UUIDSchema.safeParse(id);
      if (!uuidResult.success) {
        app.log.warn({ requestId, id }, 'Invalid service ID format');
        return reply.status(400).send({ error: 'Invalid service ID format' });
      }

      const isHardDelete = hard === 'true';

      app.log.info({
        requestId,
        serviceId: id,
        hardDelete: isHardDelete
      }, 'Deleting consultation service');

      if (isHardDelete) {
        // Check for existing consultations using this service
        const { data: consultations } = await supabase
          .from('consultations')
          .select('id')
          .eq('service_id', id)
          .limit(1);

        if (consultations && consultations.length > 0) {
          app.log.warn({ requestId, serviceId: id }, 'Cannot hard delete service with existing consultations');
          return reply.status(409).send({
            error: 'Cannot delete service with existing consultations. Use soft delete instead.'
          });
        }

        const { error } = await supabase
          .from('consultation_services')
          .delete()
          .eq('id', id);

        if (error) {
          app.log.error({ requestId, error: error.message }, 'Failed to hard delete consultation service');
          return reply.status(500).send({ error: error.message });
        }

        app.log.info({ requestId, serviceId: id }, 'Consultation service hard deleted');
      } else {
        // Soft delete
        const { error } = await supabase
          .from('consultation_services')
          .update({ is_active: false })
          .eq('id', id);

        if (error) {
          app.log.error({ requestId, error: error.message }, 'Failed to deactivate consultation service');
          return reply.status(500).send({ error: error.message });
        }

        app.log.info({ requestId, serviceId: id }, 'Consultation service deactivated (soft delete)');
      }

      return reply.status(204).send();
    } catch (error: any) {
      app.log.error({ requestId, error: error.message, stack: error.stack }, 'Error deleting consultation service');
      return reply.status(500).send({ error: error.message });
    }
  });

  // ==================== CONSULTANT-SERVICE ASSIGNMENTS ====================

  /**
   * GET /consultant-services/:consultantId
   * Get all services assigned to a consultant
   */
  app.get('/consultant-services/:consultantId', async (request, reply) => {
    const requestId = generateRequestId();
    const startTime = Date.now();

    try {
      const { consultantId } = request.params as { consultantId: string };

      // Validate UUID
      const uuidResult = UUIDSchema.safeParse(consultantId);
      if (!uuidResult.success) {
        app.log.warn({ requestId, consultantId }, 'Invalid consultant ID format');
        return reply.status(400).send({ error: 'Invalid consultant ID format' });
      }

      app.log.info({ requestId, consultantId }, 'Fetching consultant services');

      // Простой запрос без join - frontend сам имеет список услуг
      const { data, error } = await supabase
        .from('consultant_services')
        .select('*')
        .eq('consultant_id', consultantId)
        .eq('is_active', true);

      if (error) {
        app.log.error({ requestId, error: error.message }, 'Failed to fetch consultant services');
        return reply.status(500).send({ error: error.message });
      }

      const duration = Date.now() - startTime;
      app.log.info({
        requestId,
        consultantId,
        count: data?.length || 0,
        durationMs: duration
      }, 'Consultant services fetched successfully');

      return reply.send(data || []);
    } catch (error: any) {
      app.log.error({ requestId, error: error.message, stack: error.stack }, 'Error fetching consultant services');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /consultant-services
   * Assign a service to a consultant
   */
  app.post('/consultant-services', async (request, reply) => {
    const requestId = generateRequestId();

    try {
      const parseResult = AssignServiceToConsultantSchema.safeParse(request.body);
      if (!parseResult.success) {
        app.log.warn({ requestId, errors: parseResult.error.errors }, 'Assignment validation failed');
        return reply.status(400).send({ error: 'Validation error', details: parseResult.error.errors });
      }

      const body = parseResult.data;

      app.log.info({
        requestId,
        consultantId: body.consultant_id,
        serviceId: body.service_id,
        customPrice: body.custom_price,
        customDuration: body.custom_duration
      }, 'Assigning service to consultant');

      const { data, error } = await supabase
        .from('consultant_services')
        .upsert([body], { onConflict: 'consultant_id,service_id' })
        .select('*')
        .single();

      if (error) {
        app.log.error({ requestId, error: error.message }, 'Failed to assign service to consultant');
        return reply.status(500).send({ error: error.message });
      }

      app.log.info({
        requestId,
        assignmentId: data.id,
        consultantId: body.consultant_id,
        serviceId: body.service_id
      }, 'Service assigned to consultant successfully');

      return reply.status(201).send(data);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        app.log.warn({ requestId, errors: error.errors }, 'Assignment validation failed');
        return reply.status(400).send({ error: 'Validation error', details: error.errors });
      }
      app.log.error({ requestId, error: error.message, stack: error.stack }, 'Error assigning service to consultant');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * PATCH /consultant-services/:id
   * Update a consultant-service assignment
   */
  app.patch('/consultant-services/:id', async (request, reply) => {
    const requestId = generateRequestId();

    try {
      const { id } = request.params as { id: string };

      // Validate UUID
      const uuidResult = UUIDSchema.safeParse(id);
      if (!uuidResult.success) {
        app.log.warn({ requestId, id }, 'Invalid assignment ID format');
        return reply.status(400).send({ error: 'Invalid assignment ID format' });
      }

      const parseResult = UpdateConsultantServiceSchema.safeParse(request.body);
      if (!parseResult.success) {
        app.log.warn({ requestId, errors: parseResult.error.errors }, 'Assignment update validation failed');
        return reply.status(400).send({ error: 'Validation error', details: parseResult.error.errors });
      }

      const body = parseResult.data;

      app.log.info({
        requestId,
        assignmentId: id,
        updates: Object.keys(body)
      }, 'Updating consultant service assignment');

      const { data, error } = await supabase
        .from('consultant_services')
        .update(body)
        .eq('id', id)
        .select('*')
        .single();

      if (error) {
        app.log.error({ requestId, error: error.message }, 'Failed to update consultant service');
        return reply.status(500).send({ error: error.message });
      }

      app.log.info({ requestId, assignmentId: id }, 'Consultant service assignment updated successfully');

      return reply.send(data);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        app.log.warn({ requestId, errors: error.errors }, 'Assignment update validation failed');
        return reply.status(400).send({ error: 'Validation error', details: error.errors });
      }
      app.log.error({ requestId, error: error.message, stack: error.stack }, 'Error updating consultant service');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * DELETE /consultant-services/:id
   * Remove a service assignment from a consultant
   */
  app.delete('/consultant-services/:id', async (request, reply) => {
    const requestId = generateRequestId();

    try {
      const { id } = request.params as { id: string };

      // Validate UUID
      const uuidResult = UUIDSchema.safeParse(id);
      if (!uuidResult.success) {
        app.log.warn({ requestId, id }, 'Invalid assignment ID format');
        return reply.status(400).send({ error: 'Invalid assignment ID format' });
      }

      app.log.info({ requestId, assignmentId: id }, 'Deleting consultant service assignment');

      const { error } = await supabase
        .from('consultant_services')
        .delete()
        .eq('id', id);

      if (error) {
        app.log.error({ requestId, error: error.message }, 'Failed to delete consultant service');
        return reply.status(500).send({ error: error.message });
      }

      app.log.info({ requestId, assignmentId: id }, 'Consultant service assignment deleted successfully');

      return reply.status(204).send();
    } catch (error: any) {
      app.log.error({ requestId, error: error.message, stack: error.stack }, 'Error deleting consultant service');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * PUT /consultant-services/bulk/:consultantId
   * Bulk update services for a consultant (replace all)
   */
  app.put('/consultant-services/bulk/:consultantId', async (request, reply) => {
    const requestId = generateRequestId();
    const startTime = Date.now();

    try {
      const { consultantId } = request.params as { consultantId: string };

      // Validate consultant UUID
      const consultantUuidResult = UUIDSchema.safeParse(consultantId);
      if (!consultantUuidResult.success) {
        app.log.warn({ requestId, consultantId }, 'Invalid consultant ID format');
        return reply.status(400).send({ error: 'Invalid consultant ID format' });
      }

      const parseResult = BulkUpdateSchema.safeParse(request.body);
      if (!parseResult.success) {
        app.log.warn({ requestId, errors: parseResult.error.errors }, 'Bulk update validation failed');
        return reply.status(400).send({ error: 'Validation error', details: parseResult.error.errors });
      }

      const { service_ids } = parseResult.data;

      app.log.info({
        requestId,
        consultantId,
        serviceCount: service_ids.length,
        serviceIds: service_ids
      }, 'Bulk updating consultant services');

      // Verify all service IDs exist before proceeding
      if (service_ids.length > 0) {
        const { data: existingServices, error: verifyError } = await supabase
          .from('consultation_services')
          .select('id')
          .in('id', service_ids);

        app.log.info({
          requestId,
          existingServicesCount: existingServices?.length || 0,
          existingServiceIds: existingServices?.map(s => s.id) || [],
          requestedServiceIds: service_ids
        }, 'Validation check result');

        if (verifyError) {
          app.log.error({ requestId, error: verifyError.message }, 'Failed to verify service IDs');
          return reply.status(500).send({ error: verifyError.message });
        }

        const existingIds = new Set(existingServices?.map(s => s.id) || []);
        const invalidIds = service_ids.filter(id => !existingIds.has(id));

        if (invalidIds.length > 0) {
          app.log.warn({ requestId, invalidIds }, 'Some service IDs do not exist');
          return reply.status(400).send({
            error: 'Some service IDs do not exist',
            invalidIds
          });
        }

        app.log.info({ requestId }, 'All service IDs validated successfully');
      }

      // Delete existing assignments
      const { error: deleteError } = await supabase
        .from('consultant_services')
        .delete()
        .eq('consultant_id', consultantId);

      if (deleteError) {
        app.log.error({ requestId, error: deleteError.message }, 'Failed to delete existing assignments');
        return reply.status(500).send({ error: deleteError.message });
      }

      // Insert new assignments (upsert to handle race conditions)
      if (service_ids.length > 0) {
        const assignments = service_ids.map(service_id => ({
          consultant_id: consultantId,
          service_id,
          is_active: true
        }));

        const { data, error } = await supabase
          .from('consultant_services')
          .upsert(assignments, { onConflict: 'consultant_id,service_id' })
          .select('*');

        if (error) {
          app.log.error({ requestId, error: error.message }, 'Failed to bulk insert consultant services');
          return reply.status(500).send({ error: error.message });
        }

        const duration = Date.now() - startTime;
        app.log.info({
          requestId,
          consultantId,
          assignedCount: data?.length || 0,
          durationMs: duration
        }, 'Consultant services bulk updated successfully');

        return reply.send(data);
      }

      const duration = Date.now() - startTime;
      app.log.info({
        requestId,
        consultantId,
        durationMs: duration
      }, 'All consultant services removed (bulk update with empty list)');

      return reply.send([]);
    } catch (error: any) {
      app.log.error({ requestId, error: error.message, stack: error.stack }, 'Error bulk updating consultant services');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /services-by-consultant
   * Get all services grouped by consultant (for booking widget)
   */
  app.get('/services-by-consultant', async (request, reply) => {
    const requestId = generateRequestId();
    const startTime = Date.now();

    try {
      const { user_account_id } = request.query as { user_account_id: string };

      if (!user_account_id) {
        app.log.warn({ requestId }, 'Missing user_account_id parameter');
        return reply.status(400).send({ error: 'user_account_id is required' });
      }

      // Validate UUID
      const uuidResult = UUIDSchema.safeParse(user_account_id);
      if (!uuidResult.success) {
        app.log.warn({ requestId, user_account_id }, 'Invalid user_account_id format');
        return reply.status(400).send({ error: 'Invalid user_account_id format' });
      }

      app.log.info({ requestId, userAccountId: user_account_id }, 'Fetching services by consultant');

      // Get all active consultants
      const { data: consultants, error: consultantsError } = await supabase
        .from('consultants')
        .select('*')
        .eq('user_account_id', user_account_id)
        .eq('is_active', true)
        .order('name');

      if (consultantsError) {
        app.log.error({ requestId, error: consultantsError.message }, 'Failed to fetch consultants');
        throw consultantsError;
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
        app.log.error({ requestId, error: servicesError.message }, 'Failed to fetch services');
        throw servicesError;
      }

      // Get all service assignments (без join)
      const { data: assignments, error: assignmentsError } = await supabase
        .from('consultant_services')
        .select('*')
        .eq('is_active', true);

      if (assignmentsError) {
        app.log.error({ requestId, error: assignmentsError.message }, 'Failed to fetch service assignments');
        throw assignmentsError;
      }

      // Create services map for quick lookup
      const servicesMap = new Map(services?.map(s => [s.id, s]) || []);

      // Group services by consultant
      const result = consultants?.map(consultant => {
        const consultantAssignments = assignments?.filter(a => a.consultant_id === consultant.id) || [];

        // If consultant has specific assignments, use those
        // Otherwise, return all services (consultant can do everything)
        let consultantServices;
        if (consultantAssignments.length > 0) {
          consultantServices = consultantAssignments
            .map(a => {
              const service = servicesMap.get(a.service_id);
              if (!service || !service.is_active) return null;
              return {
                ...service,
                custom_price: a.custom_price,
                custom_duration: a.custom_duration
              };
            })
            .filter(Boolean);
        } else {
          consultantServices = services;
        }

        return {
          consultant,
          services: consultantServices
        };
      }) || [];

      const duration = Date.now() - startTime;
      app.log.info({
        requestId,
        consultantsCount: consultants?.length || 0,
        servicesCount: services?.length || 0,
        durationMs: duration
      }, 'Services by consultant fetched successfully');

      return reply.send(result);
    } catch (error: any) {
      app.log.error({ requestId, error: error.message, stack: error.stack }, 'Error fetching services by consultant');
      return reply.status(500).send({ error: error.message });
    }
  });
}
