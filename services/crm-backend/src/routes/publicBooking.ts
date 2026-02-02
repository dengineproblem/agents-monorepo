import { FastifyInstance, FastifyRequest } from 'fastify';
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
 *
 * ВАЖНО: Эти endpoints публичны, поэтому применяются дополнительные меры безопасности:
 * - Валидация всех входных данных
 * - Проверка на бронирование в прошлом
 * - Rate limiting (рекомендуется настроить на уровне nginx/proxy)
 * - Санитизация пользовательского ввода
 * - Подробное логирование для мониторинга
 */

// Helper: Generate request ID for tracing
const generateRequestId = () => `pub_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

// Helper: Sanitize string input (remove potential XSS vectors)
const sanitizeString = (str: string): string => {
  return str
    .replace(/[<>]/g, '') // Remove angle brackets
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, '') // Remove event handlers
    .trim();
};

// Helper: Validate and normalize phone number
const normalizePhone = (phone: string): string | null => {
  // Remove all non-digit characters except leading +
  const cleaned = phone.replace(/[^\d+]/g, '');

  // Handle Russian numbers
  if (cleaned.startsWith('+7') && cleaned.length === 12) {
    return cleaned;
  }
  if (cleaned.startsWith('8') && cleaned.length === 11) {
    return '+7' + cleaned.slice(1);
  }
  if (cleaned.startsWith('7') && cleaned.length === 11) {
    return '+' + cleaned;
  }
  // Return cleaned number if it looks reasonable
  if (cleaned.length >= 10 && cleaned.length <= 15) {
    return cleaned.startsWith('+') ? cleaned : '+' + cleaned;
  }
  return null;
};

// Validation schemas
const UUIDSchema = z.string().uuid();

const PublicBookingSchema = z.object({
  user_account_id: z.string().uuid(),
  consultant_id: z.string().uuid(),
  service_id: z.string().uuid().optional(),
  client_name: z.string()
    .min(2, 'Имя должно содержать минимум 2 символа')
    .max(100, 'Имя слишком длинное')
    .transform(sanitizeString),
  client_phone: z.string()
    .min(10, 'Некорректный номер телефона')
    .max(20, 'Некорректный номер телефона'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Некорректный формат даты'),
  start_time: z.string().regex(/^\d{2}:\d{2}$/, 'Некорректный формат времени'),
  notes: z.string()
    .max(500, 'Примечание слишком длинное')
    .optional()
    .transform(val => val ? sanitizeString(val) : undefined)
});

const GetSlotsQuerySchema = z.object({
  consultant_id: z.string().uuid().optional(),
  service_id: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  days_ahead: z.coerce.number().int().min(1).max(30).optional(),
  timezone: z.string().max(50).optional()
});

export async function publicBookingRoutes(app: FastifyInstance) {

  /**
   * GET /public/booking/:userAccountId/config
   * Get booking widget configuration (services, consultants, settings)
   */
  app.get('/public/booking/:userAccountId/config', async (request, reply) => {
    const requestId = generateRequestId();
    const startTime = Date.now();

    try {
      const { userAccountId } = request.params as { userAccountId: string };

      // Validate UUID format
      const parseResult = UUIDSchema.safeParse(userAccountId);
      if (!parseResult.success) {
        app.log.warn({ requestId, userAccountId }, 'Invalid userAccountId format');
        return reply.status(400).send({ error: 'Некорректный идентификатор' });
      }

      app.log.info({ requestId, userAccountId }, 'Fetching public booking config');

      // Get active consultants
      const { data: consultants, error: consultantsError } = await supabase
        .from('consultants')
        .select('id, name, specialization')
        .eq('parent_user_account_id', userAccountId)
        .eq('is_active', true)
        .eq('accepts_new_leads', true)
        .order('name');

      if (consultantsError) {
        app.log.error({ requestId, error: consultantsError }, 'Failed to fetch consultants');
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
        app.log.error({ requestId, error: servicesError }, 'Failed to fetch services');
        throw servicesError;
      }

      // Get business profile for branding (optional)
      const { data: profile } = await supabase
        .from('business_profiles')
        .select('company_name, logo_url')
        .eq('user_account_id', userAccountId)
        .single();

      const duration = Date.now() - startTime;
      app.log.info({
        requestId,
        userAccountId,
        consultantsCount: consultants?.length || 0,
        servicesCount: services?.length || 0,
        durationMs: duration
      }, 'Public booking config loaded successfully');

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
      app.log.error({ requestId, error: error.message, stack: error.stack }, 'Error fetching public booking config');
      return reply.status(500).send({ error: 'Не удалось загрузить конфигурацию' });
    }
  });

  /**
   * GET /public/booking/:userAccountId/slots
   * Get available slots for booking
   */
  app.get('/public/booking/:userAccountId/slots', async (request, reply) => {
    const requestId = generateRequestId();
    const startTime = Date.now();

    try {
      const { userAccountId } = request.params as { userAccountId: string };

      // Validate UUID format
      const uuidResult = UUIDSchema.safeParse(userAccountId);
      if (!uuidResult.success) {
        app.log.warn({ requestId, userAccountId }, 'Invalid userAccountId format');
        return reply.status(400).send({ error: 'Некорректный идентификатор' });
      }

      // Validate query params
      const queryResult = GetSlotsQuerySchema.safeParse(request.query);
      if (!queryResult.success) {
        app.log.warn({ requestId, errors: queryResult.error.errors }, 'Invalid query params');
        return reply.status(400).send({ error: 'Некорректные параметры запроса' });
      }

      const query = queryResult.data;

      app.log.info({
        requestId,
        userAccountId,
        consultantId: query.consultant_id,
        serviceId: query.service_id,
        date: query.date
      }, 'Fetching available slots');

      // Get duration from service or default
      let durationMinutes = 60;
      if (query.service_id) {
        const { data: service, error: serviceError } = await supabase
          .from('consultation_services')
          .select('duration_minutes')
          .eq('id', query.service_id)
          .single();

        if (serviceError) {
          app.log.warn({ requestId, serviceId: query.service_id, error: serviceError }, 'Service not found');
        } else if (service) {
          durationMinutes = service.duration_minutes;
        }
      }

      // Get consultant IDs for this user account
      let consultantIds: string[] | undefined;
      if (query.consultant_id) {
        // Verify consultant belongs to this account
        const { data: consultant, error: consultantError } = await supabase
          .from('consultants')
          .select('id')
          .eq('id', query.consultant_id)
          .eq('parent_user_account_id', userAccountId)
          .eq('is_active', true)
          .eq('accepts_new_leads', true)
          .single();

        if (consultantError || !consultant) {
          app.log.warn({ requestId, consultantId: query.consultant_id }, 'Consultant not found or not active');
          return reply.send({ slots: [] });
        }
        consultantIds = [query.consultant_id];
      } else {
        const { data: consultants } = await supabase
          .from('consultants')
          .select('id')
          .eq('parent_user_account_id', userAccountId)
          .eq('is_active', true)
          .eq('accepts_new_leads', true);
        consultantIds = consultants?.map(c => c.id);
      }

      if (!consultantIds?.length) {
        app.log.info({ requestId, userAccountId }, 'No active consultants found');
        return reply.send({ slots: [] });
      }

      const slots = await getAvailableSlots({
        consultant_ids: consultantIds,
        date: query.date,
        days_ahead: query.days_ahead || 14,
        limit: 200,
        duration_minutes: durationMinutes,
        timezone: query.timezone || 'Europe/Moscow'
      });

      const duration = Date.now() - startTime;
      app.log.info({
        requestId,
        slotsCount: slots?.length || 0,
        durationMs: duration
      }, 'Slots fetched successfully');

      return reply.send({ slots });
    } catch (error: any) {
      app.log.error({ requestId, error: error.message, stack: error.stack }, 'Error fetching public booking slots');
      return reply.status(500).send({ error: 'Не удалось загрузить доступные слоты' });
    }
  });

  /**
   * POST /public/booking
   * Create a booking from the public widget
   *
   * Security considerations:
   * - Rate limit recommended: 5 requests per minute per IP
   * - Phone validation and normalization
   * - Date validation (not in past, not too far in future)
   * - Double-booking protection
   */
  app.post('/public/booking', async (request, reply) => {
    const requestId = generateRequestId();
    const startTime = Date.now();
    const clientIp = request.ip;

    app.log.info({ requestId, clientIp }, 'New public booking request');

    try {
      // Validate request body
      const parseResult = PublicBookingSchema.safeParse(request.body);
      if (!parseResult.success) {
        app.log.warn({
          requestId,
          errors: parseResult.error.errors,
          clientIp
        }, 'Booking validation failed');
        return reply.status(400).send({
          error: 'Проверьте правильность введённых данных',
          details: parseResult.error.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
        });
      }

      const body = parseResult.data;

      // Validate and normalize phone
      const normalizedPhone = normalizePhone(body.client_phone);
      if (!normalizedPhone) {
        app.log.warn({ requestId, phone: body.client_phone }, 'Invalid phone number format');
        return reply.status(400).send({
          error: 'Некорректный формат телефона',
          message: 'Пожалуйста, введите номер в формате +7 (XXX) XXX-XX-XX'
        });
      }

      // Validate date is not in the past
      const bookingDate = new Date(body.date + 'T' + body.start_time + ':00');
      const now = new Date();
      const minBookingTime = new Date(now.getTime() + 2 * 60 * 60 * 1000); // +2 hours minimum notice

      if (bookingDate < minBookingTime) {
        app.log.warn({
          requestId,
          bookingDate: body.date,
          bookingTime: body.start_time
        }, 'Booking date is in the past or too soon');
        return reply.status(400).send({
          error: 'Невозможно записаться на это время',
          message: 'Запись возможна минимум за 2 часа до начала консультации'
        });
      }

      // Validate date is not too far in the future (max 60 days)
      const maxBookingDate = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
      if (bookingDate > maxBookingDate) {
        app.log.warn({ requestId, bookingDate: body.date }, 'Booking date is too far in the future');
        return reply.status(400).send({
          error: 'Слишком далёкая дата',
          message: 'Запись доступна не более чем на 60 дней вперёд'
        });
      }

      app.log.info({
        requestId,
        userAccountId: body.user_account_id,
        consultantId: body.consultant_id,
        serviceId: body.service_id,
        date: body.date,
        time: body.start_time,
        clientName: body.client_name.substring(0, 20) // Log only first 20 chars for privacy
      }, 'Processing booking request');

      // Validate consultant belongs to user account
      const { data: consultant, error: consultantError } = await supabase
        .from('consultants')
        .select('id, name, parent_user_account_id')
        .eq('id', body.consultant_id)
        .eq('parent_user_account_id', body.user_account_id)
        .eq('is_active', true)
        .eq('accepts_new_leads', true)
        .single();

      if (consultantError || !consultant) {
        app.log.warn({
          requestId,
          consultantId: body.consultant_id,
          userAccountId: body.user_account_id
        }, 'Consultant not found or not available');
        // Generic error to prevent enumeration
        return reply.status(400).send({ error: 'Выбранный специалист недоступен' });
      }

      // Get service details if provided
      let durationMinutes = 60;
      let price: number | null = null;
      let serviceName: string | null = null;

      if (body.service_id) {
        const { data: service, error: serviceError } = await supabase
          .from('consultation_services')
          .select('duration_minutes, price, name')
          .eq('id', body.service_id)
          .eq('user_account_id', body.user_account_id)
          .eq('is_active', true)
          .single();

        if (serviceError || !service) {
          app.log.warn({ requestId, serviceId: body.service_id }, 'Service not found');
          return reply.status(400).send({ error: 'Выбранная услуга недоступна' });
        }

        durationMinutes = service.duration_minutes;
        price = service.price;
        serviceName = service.name;
      }

      // Calculate end time
      const [startHour, startMin] = body.start_time.split(':').map(Number);
      const endMinTotal = startHour * 60 + startMin + durationMinutes;
      const endHour = Math.floor(endMinTotal / 60);
      const endMin = endMinTotal % 60;
      const endTime = `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;

      // Check slot availability (double-booking protection)
      app.log.debug({ requestId }, 'Checking slot availability');
      const available = await isSlotAvailable(
        body.consultant_id,
        body.date,
        body.start_time,
        durationMinutes
      );

      if (!available) {
        app.log.warn({
          requestId,
          consultantId: body.consultant_id,
          date: body.date,
          time: body.start_time
        }, 'Slot is not available (already booked)');
        return reply.status(409).send({
          error: 'Выбранное время уже занято',
          message: 'К сожалению, это время уже забронировано. Пожалуйста, выберите другое время.'
        });
      }

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
        app.log.error({
          requestId,
          error: consultationError.message,
          code: consultationError.code
        }, 'Failed to create consultation');
        return reply.status(500).send({ error: 'Не удалось создать запись' });
      }

      app.log.info({
        requestId,
        consultationId: consultation.id,
        consultantId: body.consultant_id,
        date: body.date,
        time: body.start_time
      }, 'Consultation created successfully');

      // Send notifications (async, don't block response)
      if (consultation) {
        const consultationForNotification = {
          id: consultation.id,
          consultant_id: consultation.consultant_id,
          user_account_id: body.user_account_id,
          client_phone: consultation.client_phone,
          client_name: consultation.client_name,
          dialog_analysis_id: undefined,
          date: consultation.date,
          start_time: consultation.start_time,
          end_time: consultation.end_time
        };

        sendConfirmationNotification(consultationForNotification).catch(err => {
          app.log.error({
            requestId,
            consultationId: consultation.id,
            error: err.message
          }, 'Failed to send confirmation notification');
        });

        scheduleReminderNotifications(consultationForNotification).catch(err => {
          app.log.error({
            requestId,
            consultationId: consultation.id,
            error: err.message
          }, 'Failed to schedule reminder notifications');
        });
      }

      // Format response message
      const slotDate = new Date(body.date);
      const day = slotDate.getDate();
      const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                      'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
      const month = months[slotDate.getMonth()];

      const duration = Date.now() - startTime;
      app.log.info({
        requestId,
        consultationId: consultation.id,
        durationMs: duration,
        clientIp
      }, 'Public booking completed successfully');

      return reply.status(201).send({
        success: true,
        consultation_id: consultation.id,
        message: `Вы успешно записаны на ${day} ${month} в ${body.start_time} к специалисту ${consultant.name}. Мы отправим вам напоминание!`,
        details: {
          date: body.date,
          time: body.start_time,
          consultant: consultant.name,
          service: serviceName,
          duration_minutes: durationMinutes
        }
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        app.log.warn({ requestId, errors: error.errors }, 'Booking validation failed');
        return reply.status(400).send({
          error: 'Проверьте правильность введённых данных',
          details: error.errors
        });
      }
      app.log.error({
        requestId,
        error: error.message,
        stack: error.stack,
        clientIp
      }, 'Error creating public booking');
      return reply.status(500).send({ error: 'Произошла ошибка при записи' });
    }
  });

  /**
   * GET /public/booking/:userAccountId/consultant/:consultantId
   * Get consultant details with available services
   */
  app.get('/public/booking/:userAccountId/consultant/:consultantId', async (request, reply) => {
    const requestId = generateRequestId();
    const startTime = Date.now();

    try {
      const { userAccountId, consultantId } = request.params as {
        userAccountId: string;
        consultantId: string;
      };

      // Validate UUID formats
      const userAccountResult = UUIDSchema.safeParse(userAccountId);
      const consultantResult = UUIDSchema.safeParse(consultantId);

      if (!userAccountResult.success || !consultantResult.success) {
        app.log.warn({ requestId, userAccountId, consultantId }, 'Invalid UUID format');
        return reply.status(400).send({ error: 'Некорректный идентификатор' });
      }

      app.log.info({ requestId, userAccountId, consultantId }, 'Fetching consultant details');

      // Get consultant
      const { data: consultant, error: consultantError } = await supabase
        .from('consultants')
        .select('id, name, specialization')
        .eq('id', consultantId)
        .eq('parent_user_account_id', userAccountId)
        .eq('is_active', true)
        .eq('accepts_new_leads', true)
        .single();

      if (consultantError || !consultant) {
        app.log.warn({ requestId, consultantId }, 'Consultant not found');
        return reply.status(404).send({ error: 'Специалист не найден' });
      }

      // Get consultant's services
      const { data: assignments, error: assignmentsError } = await supabase
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

      if (assignmentsError) {
        app.log.error({ requestId, error: assignmentsError }, 'Failed to fetch consultant services');
      }

      // If no specific assignments, get all services for the account
      let services;
      if (assignments && assignments.length > 0) {
        services = assignments.map(a => ({
          ...a.service,
          price: a.custom_price ?? (a.service as any).price,
          duration_minutes: a.custom_duration ?? (a.service as any).duration_minutes
        }));
      } else {
        const { data: allServices, error: servicesError } = await supabase
          .from('consultation_services')
          .select('id, name, description, duration_minutes, price, currency, color')
          .eq('user_account_id', userAccountId)
          .eq('is_active', true)
          .order('sort_order')
          .order('name');

        if (servicesError) {
          app.log.error({ requestId, error: servicesError }, 'Failed to fetch all services');
        }
        services = allServices || [];
      }

      const duration = Date.now() - startTime;
      app.log.info({
        requestId,
        consultantId,
        servicesCount: services?.length || 0,
        durationMs: duration
      }, 'Consultant details fetched successfully');

      return reply.send({
        consultant: {
          id: consultant.id,
          name: consultant.name,
          specialization: consultant.specialization
        },
        services
      });
    } catch (error: any) {
      app.log.error({ requestId, error: error.message, stack: error.stack }, 'Error fetching consultant details');
      return reply.status(500).send({ error: 'Не удалось загрузить информацию о специалисте' });
    }
  });
}
