/**
 * Генерация и управление слотами консультаций
 * Используется AI-ботом для показа доступного времени клиентам
 *
 * Features:
 * - Генерация доступных слотов из расписания консультантов
 * - Проверка занятости слотов
 * - Получение записей клиента
 * - Структурированное логирование
 */

import { supabase } from './supabase.js';
import { createLogger } from './logger.js';

const log = createLogger({ module: 'consultationSlots' });

export interface AvailableSlot {
  slot_id: string;        // первые 6 символов consultant_id (для GPT)
  consultant_id: string;
  consultant_name: string;
  date: string;           // YYYY-MM-DD
  start_time: string;     // HH:MM
  end_time: string;       // HH:MM
  formatted: string;      // "30 декабря в 14:00 (Иван Петров)"
}

export interface GetAvailableSlotsParams {
  consultant_ids?: string[];    // пустой = все активные консультанты
  date?: string;                // конкретная дата YYYY-MM-DD
  days_ahead?: number;          // дней вперёд (по умолчанию 7)
  limit?: number;               // максимум слотов (по умолчанию 5)
  duration_minutes: number;     // длительность консультации
  timezone?: string;            // таймзона для фильтрации (по умолчанию Asia/Yekaterinburg)
}

const DAYS_RU = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const MONTHS_RU = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/**
 * Нормализует дату в формат YYYY-MM-DD
 * Supabase может вернуть Date объект или строку в разных форматах
 */
function normalizeDate(date: any): string {
  if (!date) return '';
  if (typeof date === 'string') {
    // Если строка уже в формате YYYY-MM-DD, возвращаем как есть
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return date;
    }
    // Если строка содержит T (ISO формат), берём часть до T
    if (date.includes('T')) {
      return date.split('T')[0];
    }
    // Пробуем распарсить как дату
    const parsed = new Date(date);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }
    return date;
  }
  // Date объект
  if (date instanceof Date) {
    return date.toISOString().split('T')[0];
  }
  // Fallback
  return String(date);
}

/**
 * Нормализует время в формат HH:MM (убирает секунды)
 * БД может вернуть '09:00:00', а код генерирует '09:00'
 */
function normalizeTime(time: string): string {
  if (!time) return '';
  // Берём только первые 5 символов (HH:MM)
  return time.substring(0, 5);
}

/**
 * Форматирует дату и время для клиента
 */
function formatSlotForClient(date: string, startTime: string, consultantName: string): string {
  const slotDate = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const slotDateOnly = new Date(slotDate);
  slotDateOnly.setHours(0, 0, 0, 0);

  let dateStr: string;

  if (slotDateOnly.getTime() === today.getTime()) {
    dateStr = 'Сегодня';
  } else if (slotDateOnly.getTime() === tomorrow.getTime()) {
    dateStr = 'Завтра';
  } else {
    const day = slotDate.getDate();
    const month = MONTHS_RU[slotDate.getMonth()];
    const dayOfWeek = DAYS_RU[slotDate.getDay()];
    dateStr = `${day} ${month} (${dayOfWeek})`;
  }

  return `${dateStr} в ${startTime} — ${consultantName}`;
}

/**
 * Генерирует временные слоты из расписания консультанта на конкретную дату
 */
function generateTimeSlotsFromSchedule(
  startTime: string,
  endTime: string,
  durationMinutes: number
): { start: string; end: string }[] {
  const slots: { start: string; end: string }[] = [];

  const [startHour, startMin] = startTime.split(':').map(Number);
  const [endHour, endMin] = endTime.split(':').map(Number);

  let currentHour = startHour;
  let currentMin = startMin;

  while (true) {
    const slotEndMin = currentMin + durationMinutes;
    let slotEndHour = currentHour + Math.floor(slotEndMin / 60);
    const slotEndMinNorm = slotEndMin % 60;

    // Проверяем, не выходит ли слот за пределы рабочего дня
    if (slotEndHour > endHour || (slotEndHour === endHour && slotEndMinNorm > endMin)) {
      break;
    }

    const startStr = `${String(currentHour).padStart(2, '0')}:${String(currentMin).padStart(2, '0')}`;
    const endStr = `${String(slotEndHour).padStart(2, '0')}:${String(slotEndMinNorm).padStart(2, '0')}`;

    slots.push({ start: startStr, end: endStr });

    // Следующий слот
    currentMin += durationMinutes;
    currentHour += Math.floor(currentMin / 60);
    currentMin = currentMin % 60;
  }

  return slots;
}

/**
 * Получает свободные слоты для записи на консультацию
 */
export async function getAvailableSlots(params: GetAvailableSlotsParams): Promise<AvailableSlot[]> {
  const {
    consultant_ids = [],
    date,
    days_ahead = 7,
    limit = 5,
    duration_minutes,
    timezone = 'Asia/Yekaterinburg'
  } = params;

  // Валидация входных параметров
  if (!duration_minutes || duration_minutes < 1) {
    log.error({
      duration_minutes,
      params
    }, '[getAvailableSlots] Invalid duration_minutes parameter');
    return [];
  }

  // Нормализация параметров
  const safeDaysAhead = Math.min(Math.max(days_ahead || 7, 1), 30); // от 1 до 30 дней
  const safeLimit = Math.min(Math.max(limit || 5, 1), 50); // от 1 до 50 слотов

  log.info({
    consultant_ids: consultant_ids.length,
    date: date || 'not specified',
    days_ahead: safeDaysAhead,
    limit: safeLimit,
    duration_minutes,
    timezone
  }, '[getAvailableSlots] Request received');

  // 1. Получаем консультантов
  let consultantsQuery = supabase
    .from('consultants')
    .select('id, name')
    .eq('is_active', true);

  if (consultant_ids.length > 0) {
    consultantsQuery = consultantsQuery.in('id', consultant_ids);
  }

  const { data: consultants, error: consultantsError } = await consultantsQuery;

  if (consultantsError) {
    log.error({
      error: consultantsError,
      consultant_ids
    }, '[getAvailableSlots] Error fetching consultants');
    return [];
  }

  if (!consultants?.length) {
    log.warn({
      consultant_ids,
      requestedIds: consultant_ids.length
    }, '[getAvailableSlots] No active consultants found');
    return [];
  }

  log.debug({
    foundConsultants: consultants.length,
    consultantNames: consultants.map(c => c.name)
  }, '[getAvailableSlots] Consultants loaded');

  const consultantMap = new Map(consultants.map(c => [c.id, c.name]));
  const consultantIds = consultants.map(c => c.id);

  // 2. Получаем расписание всех консультантов
  const { data: schedules, error: schedulesError } = await supabase
    .from('working_schedules')
    .select('*')
    .in('consultant_id', consultantIds)
    .eq('is_active', true);

  if (schedulesError) {
    log.error({
      error: schedulesError,
      consultantIds
    }, '[getAvailableSlots] Error fetching schedules');
    return [];
  }

  if (!schedules?.length) {
    log.warn({
      consultantIds,
      consultantCount: consultantIds.length
    }, '[getAvailableSlots] No working schedules found for consultants');
    return [];
  }

  log.debug({
    schedulesCount: schedules.length,
    schedulesByConsultant: Object.fromEntries(
      [...new Set(schedules.map(s => s.consultant_id))].map(id => [
        id,
        schedules.filter(s => s.consultant_id === id).map(s => `day${s.day_of_week}`)
      ])
    )
  }, '[getAvailableSlots] Schedules loaded');

  // Группируем расписание по консультанту и дню недели
  const scheduleMap = new Map<string, Map<number, { start: string; end: string }>>();
  for (const schedule of schedules) {
    if (!scheduleMap.has(schedule.consultant_id)) {
      scheduleMap.set(schedule.consultant_id, new Map());
    }
    // Нормализуем время из БД
    scheduleMap.get(schedule.consultant_id)!.set(schedule.day_of_week, {
      start: normalizeTime(schedule.start_time),
      end: normalizeTime(schedule.end_time)
    });
  }

  // 3. Определяем диапазон дат
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let startDate: Date;
  let endDate: Date;

  if (date) {
    // Конкретная дата
    startDate = new Date(date);
    endDate = new Date(date);
  } else {
    // Ближайшие N дней
    startDate = new Date(today);
    endDate = new Date(today);
    endDate.setDate(endDate.getDate() + safeDaysAhead);
  }

  // 4. Получаем существующие консультации в этом диапазоне
  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];

  const { data: existingConsultations, error: consultationsError } = await supabase
    .from('consultations')
    .select('consultant_id, date, start_time, end_time')
    .in('consultant_id', consultantIds)
    .gte('date', startDateStr)
    .lte('date', endDateStr)
    .in('status', ['scheduled', 'confirmed']);

  if (consultationsError) {
    log.error({
      error: consultationsError,
      consultantIds: consultantIds.length,
      dateRange: `${startDateStr} - ${endDateStr}`
    }, '[getAvailableSlots] Error fetching existing consultations');
  }

  // Создаём set занятых слотов с нормализованными ключами
  const busySlots = new Set<string>();
  for (const consultation of existingConsultations || []) {
    // ВАЖНО: нормализуем дату и время, т.к. Supabase может вернуть разные форматы
    const normalizedDate = normalizeDate(consultation.date);
    const normalizedTime = normalizeTime(consultation.start_time);
    const key = `${consultation.consultant_id}|${normalizedDate}|${normalizedTime}`;
    busySlots.add(key);
  }

  log.debug({
    busySlotsCount: busySlots.size,
    busySlots: Array.from(busySlots).slice(0, 10), // первые 10 для отладки
    existingConsultationsCount: existingConsultations?.length || 0
  }, '[getAvailableSlots] Busy slots created');

  // 5. Генерируем доступные слоты
  const availableSlots: AvailableSlot[] = [];
  const currentDate = new Date(startDate);

  // Получаем текущее время в указанной таймзоне
  const nowInTimezone = new Date().toLocaleString('en-US', { timeZone: timezone });
  const nowTz = new Date(nowInTimezone);
  const todayInTimezone = nowTz.toISOString().split('T')[0];
  const currentHourInTz = nowTz.getHours();
  const currentMinInTz = nowTz.getMinutes();

  log.debug({
    timezone,
    todayInTimezone,
    currentTime: `${currentHourInTz}:${currentMinInTz}`,
    utcNow: new Date().toISOString()
  }, '[getAvailableSlots] Timezone filtering setup');

  // Если запрошена конкретная дата — показываем ВСЕ слоты на эту дату (до 100)
  // Для ближайших слотов — используем переданный лимит
  const effectiveLimit = date ? 100 : safeLimit;

  log.info({
    requestedDate: date || 'none',
    originalLimit: safeLimit,
    effectiveLimit,
    dateRange: `${startDateStr} - ${endDateStr}`,
    consultantCount: consultantIds.length
  }, '[getAvailableSlots] Slot generation started');

  // Счётчики для детального логирования
  let totalSlotsGenerated = 0;
  let skippedBusy = 0;
  let skippedPast = 0;
  let skippedNoSchedule = 0;

  while (currentDate <= endDate && availableSlots.length < effectiveLimit) {
    const dateStr = currentDate.toISOString().split('T')[0];
    const dayOfWeek = currentDate.getDay(); // 0 = Sunday

    for (const consultantId of consultantIds) {
      if (availableSlots.length >= effectiveLimit) break;

      const consultantSchedule = scheduleMap.get(consultantId);
      if (!consultantSchedule) {
        skippedNoSchedule++;
        continue;
      }

      const daySchedule = consultantSchedule.get(dayOfWeek);
      if (!daySchedule) {
        skippedNoSchedule++;
        continue;
      }

      // Генерируем слоты на этот день
      const timeSlots = generateTimeSlotsFromSchedule(
        daySchedule.start,
        daySchedule.end,
        duration_minutes
      );

      for (const slot of timeSlots) {
        if (availableSlots.length >= effectiveLimit) break;

        totalSlotsGenerated++;
        const slotKey = `${consultantId}|${dateStr}|${slot.start}`;

        // Пропускаем занятые слоты
        if (busySlots.has(slotKey)) {
          skippedBusy++;
          log.debug({
            slotKey,
            date: dateStr,
            time: slot.start,
            consultant: consultantMap.get(consultantId)
          }, '[getAvailableSlots] Slot skipped - already booked');
          continue;
        }

        // Пропускаем прошедшие слоты (для сегодняшнего дня в таймзоне клиента)
        if (dateStr === todayInTimezone) {
          const [slotHour, slotMin] = slot.start.split(':').map(Number);

          // Сравниваем время слота с текущим временем + 30 минут буфера
          const bufferMinutes = 30;
          const currentMinutesTotal = currentHourInTz * 60 + currentMinInTz + bufferMinutes;
          const slotMinutesTotal = slotHour * 60 + slotMin;

          if (slotMinutesTotal <= currentMinutesTotal) {
            skippedPast++;
            log.debug({
              date: dateStr,
              slotTime: slot.start,
              currentTime: `${currentHourInTz}:${currentMinInTz}`,
              bufferMinutes
            }, '[getAvailableSlots] Slot skipped - time already passed');
            continue;
          }
        }

        const consultantName = consultantMap.get(consultantId) || 'Консультант';

        availableSlots.push({
          slot_id: consultantId.substring(0, 6),  // первые 6 символов UUID для GPT
          consultant_id: consultantId,
          consultant_name: consultantName,
          date: dateStr,
          start_time: slot.start,
          end_time: slot.end,
          formatted: formatSlotForClient(dateStr, slot.start, consultantName)
        });
      }
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  log.info({
    totalSlotsGenerated,
    skippedBusy,
    skippedPast,
    skippedNoSchedule,
    availableCount: availableSlots.length
  }, '[getAvailableSlots] Slot filtering summary');

  // Сортируем по дате и времени
  availableSlots.sort((a, b) => {
    if (a.date !== b.date) {
      return a.date.localeCompare(b.date);
    }
    return a.start_time.localeCompare(b.start_time);
  });

  const resultSlots = availableSlots.slice(0, effectiveLimit);

  log.info({
    totalGenerated: availableSlots.length,
    effectiveLimit,
    returning: resultSlots.length,
    slots: resultSlots.map(s => `${s.date} ${s.start_time}`)
  }, '[getAvailableSlots] Slot generation completed');

  return resultSlots;
}

/**
 * Проверяет, свободен ли конкретный слот
 */
export async function isSlotAvailable(
  consultantId: string,
  date: string,
  startTime: string,
  durationMinutes: number
): Promise<boolean> {
  log.debug({
    consultantId,
    date,
    startTime,
    durationMinutes
  }, '[isSlotAvailable] Checking slot availability');

  // Валидация входных параметров
  if (!consultantId || !date || !startTime || !durationMinutes) {
    log.warn({
      consultantId: !!consultantId,
      date: !!date,
      startTime: !!startTime,
      durationMinutes: !!durationMinutes
    }, '[isSlotAvailable] Missing required parameters');
    return false;
  }

  // Нормализуем входное время
  const normalizedStartTime = normalizeTime(startTime);

  // Проверяем, есть ли расписание на этот день
  const slotDate = new Date(date);
  const dayOfWeek = slotDate.getDay();

  const { data: schedule, error: scheduleError } = await supabase
    .from('working_schedules')
    .select('start_time, end_time')
    .eq('consultant_id', consultantId)
    .eq('day_of_week', dayOfWeek)
    .eq('is_active', true)
    .single();

  if (scheduleError) {
    log.warn({
      error: scheduleError,
      consultantId,
      dayOfWeek
    }, '[isSlotAvailable] No schedule found for this day');
    return false;
  }

  if (!schedule) {
    log.warn({
      consultantId,
      dayOfWeek
    }, '[isSlotAvailable] Empty schedule returned');
    return false;
  }

  // Нормализуем время из БД
  const scheduleStart = normalizeTime(schedule.start_time);
  const scheduleEnd = normalizeTime(schedule.end_time);

  // Проверяем, попадает ли слот в рабочее время
  const [startHour, startMin] = normalizedStartTime.split(':').map(Number);
  const endMin = startMin + durationMinutes;
  const endHour = startHour + Math.floor(endMin / 60);
  const endMinNorm = endMin % 60;
  const endTime = `${String(endHour).padStart(2, '0')}:${String(endMinNorm).padStart(2, '0')}`;

  if (normalizedStartTime < scheduleStart || endTime > scheduleEnd) {
    log.debug({
      slotStart: normalizedStartTime,
      slotEnd: endTime,
      scheduleStart,
      scheduleEnd
    }, '[isSlotAvailable] Slot outside working hours');
    return false;
  }

  // Проверяем, нет ли пересечений с существующими консультациями
  const { data: existing, error: existingError } = await supabase
    .from('consultations')
    .select('id, start_time, end_time')
    .eq('consultant_id', consultantId)
    .eq('date', date)
    .in('status', ['scheduled', 'confirmed'])
    .or(`and(start_time.lt.${endTime},end_time.gt.${normalizedStartTime})`);

  if (existingError) {
    log.error({
      error: existingError,
      consultantId,
      date,
      startTime: normalizedStartTime
    }, '[isSlotAvailable] Error checking slot availability');
    return false;
  }

  const isAvailable = !existing || existing.length === 0;

  log.debug({
    consultantId,
    date,
    startTime: normalizedStartTime,
    endTime,
    existingCount: existing?.length || 0,
    isAvailable
  }, '[isSlotAvailable] Availability check completed');

  return isAvailable;
}

/**
 * Получает консультации клиента (лида)
 */
export async function getClientConsultations(dialogAnalysisId: string): Promise<any[]> {
  log.debug({
    dialogAnalysisId
  }, '[getClientConsultations] Fetching client consultations');

  if (!dialogAnalysisId) {
    log.warn('[getClientConsultations] Missing dialogAnalysisId parameter');
    return [];
  }

  const { data, error } = await supabase
    .from('consultations')
    .select(`
      *,
      consultant:consultants(name)
    `)
    .eq('dialog_analysis_id', dialogAnalysisId)
    .in('status', ['scheduled', 'confirmed'])
    .order('date', { ascending: true })
    .order('start_time', { ascending: true });

  if (error) {
    log.error({
      error,
      dialogAnalysisId
    }, '[getClientConsultations] Error fetching client consultations');
    return [];
  }

  const consultations = (data || []).map(c => {
    // Нормализуем дату и время из БД
    const normalizedDate = normalizeDate(c.date);
    const normalizedStartTime = normalizeTime(c.start_time);
    const consultantName = c.consultant?.name || 'Консультант';

    return {
      ...c,
      date: normalizedDate,
      start_time: normalizedStartTime,
      end_time: normalizeTime(c.end_time),
      consultant_name: consultantName,
      formatted: formatSlotForClient(normalizedDate, normalizedStartTime, consultantName)
    };
  });

  log.debug({
    dialogAnalysisId,
    foundCount: consultations.length
  }, '[getClientConsultations] Consultations fetched');

  return consultations;
}
