import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import {
  sendConfirmationNotification,
  scheduleReminderNotifications
} from '../lib/consultationNotifications.js';
import { getAvailableSlots, isSlotAvailable } from '../lib/consultationSlots.js';

/**
 * Публичные endpoints для виджета онлайн-записи.
 * Не требуют авторизации, но работают только с определённым user_account_id.
 */

const PublicBookingSchema = z.object({
  user_account_id: z.string().uuid(),
  consultant_id: z.string().uuid(),
  service_id: z.string().uuid().optional(),
  client_name: z.string().min(1),
  client_phone: z.string().min(10).max(20),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  notes: z.string().optional()
});

export async function publicBookingRoutes(app: FastifyInstance) {

  /**
   * GET /public/booking/:userAccountId/config
   * Get booking widget configuration (services, consultants, settings)
   */
  app.get('/public/booking/:userAccountId/config', async (request, reply) => {
    try {
      const { userAccountId } = request.params as { userAccountId: string };

      // Get active consultants
      const { data: consultants, error: consultantsError } = await supabase
        .from('consultants')
        .select('id, name, specialization')
        .eq('user_account_id', userAccountId)
        .eq('is_active', true)
        .order('name');

      if (consultantsError) {
        throw consultantsError;
      }

      // Get active services
      const { data: services, error: servicesError } = await supabase
        .from('consultation_services')
        .select('id, name, description, duration_minutes, price, currency, color')
        .eq('user_account_id', userAccountId)
        .eq('is_active', true)
        .order('sort_order')
        .order('name');

      if (servicesError) {
        throw servicesError;
      }

      // Get business profile for branding (optional)
      const { data: profile } = await supabase
        .from('business_profiles')
        .select('company_name, logo_url')
        .eq('user_account_id', userAccountId)
        .single();

      return reply.send({
        consultants: consultants || [],
        services: services || [],
        business: profile || null,
        settings: {
          days_ahead: 14,
          min_booking_notice_hours: 2
        }
      });
    } catch (error: any) {
      app.log.error({ error }, 'Error fetching public booking config');
      return reply.status(500).send({ error: 'Failed to load booking configuration' });
    }
  });

  /**
   * GET /public/booking/:userAccountId/slots
   * Get available slots for booking
   */
  app.get('/public/booking/:userAccountId/slots', async (request, reply) => {
    try {
      const { userAccountId } = request.params as { userAccountId: string };
      const query = request.query as {
        consultant_id?: string;
        service_id?: string;
        date?: string;
        days_ahead?: string;
        timezone?: string;
      };

      // Get duration from service or default
      let durationMinutes = 60;
      if (query.service_id) {
        const { data: service } = await supabase
          .from('consultation_services')
          .select('duration_minutes')
          .eq('id', query.service_id)
          .single();
        if (service) {
          durationMinutes = service.duration_minutes;
        }
      }

      // Get consultant IDs for this user account
      let consultantIds: string[] | undefined;
      if (query.consultant_id) {
        consultantIds = [query.consultant_id];
      } else {
        const { data: consultants } = await supabase
          .from('consultants')
          .select('id')
          .eq('user_account_id', userAccountId)
          .eq('is_active', true);
        consultantIds = consultants?.map(c => c.id);
      }

      if (!consultantIds?.length) {
        return reply.send({ slots: [] });
      }

      const slots = await getAvailableSlots({
        consultant_ids: consultantIds,
        date: query.date,
        days_ahead: query.days_ahead ? parseInt(query.days_ahead) : 14,
        limit: 50,
        duration_minutes: durationMinutes,
        timezone: query.timezone || 'Asia/Yekaterinburg'
      });

      return reply.send({ slots });
    } catch (error: any) {
      app.log.error({ error }, 'Error fetching public booking slots');
      return reply.status(500).send({ error: 'Failed to load available slots' });
    }
  });

  /**
   * POST /public/booking
   * Create a booking from the public widget
   */
  app.post('/public/booking', async (request, reply) => {
    try {
      const body = PublicBookingSchema.parse(request.body);

      // Validate consultant belongs to user account
      const { data: consultant, error: consultantError } = await supabase
        .from('consultants')
        .select('id, name, user_account_id')
        .eq('id', body.consultant_id)
        .eq('user_account_id', body.user_account_id)
        .eq('is_active', true)
        .single();

      if (consultantError || !consultant) {
        return reply.status(400).send({ error: 'Консультант не найден или недоступен' });
      }

      // Get service details if provided
      let durationMinutes = 60;
      let price: number | null = null;
      if (body.service_id) {
        const { data: service } = await supabase
          .from('consultation_services')
          .select('duration_minutes, price')
          .eq('id', body.service_id)
          .eq('user_account_id', body.user_account_id)
          .eq('is_active', true)
          .single();

        if (service) {
          durationMinutes = service.duration_minutes;
          price = service.price;
        }
      }

      // Calculate end time
      const [startHour, startMin] = body.start_time.split(':').map(Number);
      const endMinTotal = startHour * 60 + startMin + durationMinutes;
      const endHour = Math.floor(endMinTotal / 60);
      const endMin = endMinTotal % 60;
      const endTime = `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;

      // Check slot availability
      const available = await isSlotAvailable(
        body.consultant_id,
        body.date,
        body.start_time,
        durationMinutes
      );

      if (!available) {
        return reply.status(409).send({
          error: 'Выбранное время уже занято',
          message: 'К сожалению, это время уже занято. Пожалуйста, выберите другое время.'
        });
      }

      // Normalize phone number
      const normalizedPhone = body.client_phone.replace(/\D/g, '');

      // Create consultation
      const consultationData = {
        consultant_id: body.consultant_id,
        service_id: body.service_id || null,
        user_account_id: body.user_account_id,
        client_phone: normalizedPhone,
        client_name: body.client_name,
        date: body.date,
        start_time: body.start_time,
        end_time: endTime,
        status: 'scheduled',
        consultation_type: 'online_booking',
        notes: body.notes || null,
        price
      };

      const { data: consultation, error: consultationError } = await supabase
        .from('consultations')
        .insert([consultationData])
        .select()
        .single();

      if (consultationError) {
        app.log.error({ error: consultationError }, 'Failed to create consultation from public booking');
        return reply.status(500).send({ error: 'Не удалось создать запись' });
      }

      // Send notifications
      if (consultation) {
        const consultationForNotification = {
          id: consultation.id,
          consultant_id: consultation.consultant_id,
          user_account_id: body.user_account_id,
          client_phone: consultation.client_phone,
          client_name: consultation.client_name,
          dialog_analysis_id: null,
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

      // Format response message
      const slotDate = new Date(body.date);
      const day = slotDate.getDate();
      const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                      'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
      const month = months[slotDate.getMonth()];

      return reply.status(201).send({
        success: true,
        consultation_id: consultation.id,
        message: `Вы успешно записаны на ${day} ${month} в ${body.start_time} к специалисту ${consultant.name}. Мы отправим вам напоминание!`
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Проверьте правильность введённых данных', details: error.errors });
      }
      app.log.error({ error }, 'Error creating public booking');
      return reply.status(500).send({ error: 'Произошла ошибка при записи' });
    }
  });

  /**
   * GET /public/booking/:userAccountId/consultant/:consultantId
   * Get consultant details with available services
   */
  app.get('/public/booking/:userAccountId/consultant/:consultantId', async (request, reply) => {
    try {
      const { userAccountId, consultantId } = request.params as {
        userAccountId: string;
        consultantId: string;
      };

      // Get consultant
      const { data: consultant, error: consultantError } = await supabase
        .from('consultants')
        .select('id, name, specialization, phone, email')
        .eq('id', consultantId)
        .eq('user_account_id', userAccountId)
        .eq('is_active', true)
        .single();

      if (consultantError || !consultant) {
        return reply.status(404).send({ error: 'Консультант не найден' });
      }

      // Get consultant's services
      const { data: assignments } = await supabase
        .from('consultant_services')
        .select(`
          custom_price,
          custom_duration,
          service:consultation_services!inner(
            id, name, description, duration_minutes, price, currency, color
          )
        `)
        .eq('consultant_id', consultantId)
        .eq('is_active', true);

      // If no specific assignments, get all services for the account
      let services;
      if (assignments && assignments.length > 0) {
        services = assignments.map(a => ({
          ...a.service,
          price: a.custom_price ?? (a.service as any).price,
          duration_minutes: a.custom_duration ?? (a.service as any).duration_minutes
        }));
      } else {
        const { data: allServices } = await supabase
          .from('consultation_services')
          .select('id, name, description, duration_minutes, price, currency, color')
          .eq('user_account_id', userAccountId)
          .eq('is_active', true)
          .order('sort_order')
          .order('name');
        services = allServices || [];
      }

      return reply.send({
        consultant: {
          id: consultant.id,
          name: consultant.name,
          specialization: consultant.specialization
        },
        services
      });
    } catch (error: any) {
      app.log.error({ error }, 'Error fetching consultant details');
      return reply.status(500).send({ error: 'Failed to load consultant details' });
    }
  });
}
