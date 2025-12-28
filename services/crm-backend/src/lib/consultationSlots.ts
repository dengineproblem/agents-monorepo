/**
 * Генерация и управление слотами консультаций
 * Используется AI-ботом для показа доступного времени клиентам
 */

import { supabase } from './supabase.js';

export interface AvailableSlot {
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
}

const DAYS_RU = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const MONTHS_RU = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

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
    duration_minutes
  } = params;

  // 1. Получаем консультантов
  let consultantsQuery = supabase
    .from('consultants')
    .select('id, name')
    .eq('is_active', true);

  if (consultant_ids.length > 0) {
    consultantsQuery = consultantsQuery.in('id', consultant_ids);
  }

  const { data: consultants, error: consultantsError } = await consultantsQuery;

  if (consultantsError || !consultants?.length) {
    return [];
  }

  const consultantMap = new Map(consultants.map(c => [c.id, c.name]));
  const consultantIds = consultants.map(c => c.id);

  // 2. Получаем расписание всех консультантов
  const { data: schedules, error: schedulesError } = await supabase
    .from('working_schedules')
    .select('*')
    .in('consultant_id', consultantIds)
    .eq('is_active', true);

  if (schedulesError || !schedules?.length) {
    return [];
  }

  // Группируем расписание по консультанту и дню недели
  const scheduleMap = new Map<string, Map<number, { start: string; end: string }>>();
  for (const schedule of schedules) {
    if (!scheduleMap.has(schedule.consultant_id)) {
      scheduleMap.set(schedule.consultant_id, new Map());
    }
    scheduleMap.get(schedule.consultant_id)!.set(schedule.day_of_week, {
      start: schedule.start_time,
      end: schedule.end_time
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
    endDate.setDate(endDate.getDate() + days_ahead);
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
    console.error('Error fetching existing consultations:', consultationsError);
  }

  // Создаём set занятых слотов
  const busySlots = new Set<string>();
  for (const consultation of existingConsultations || []) {
    const key = `${consultation.consultant_id}|${consultation.date}|${consultation.start_time}`;
    busySlots.add(key);
  }

  // 5. Генерируем доступные слоты
  const availableSlots: AvailableSlot[] = [];
  const currentDate = new Date(startDate);
  const now = new Date();

  while (currentDate <= endDate && availableSlots.length < limit) {
    const dateStr = currentDate.toISOString().split('T')[0];
    const dayOfWeek = currentDate.getDay(); // 0 = Sunday

    for (const consultantId of consultantIds) {
      if (availableSlots.length >= limit) break;

      const consultantSchedule = scheduleMap.get(consultantId);
      if (!consultantSchedule) continue;

      const daySchedule = consultantSchedule.get(dayOfWeek);
      if (!daySchedule) continue;

      // Генерируем слоты на этот день
      const timeSlots = generateTimeSlotsFromSchedule(
        daySchedule.start,
        daySchedule.end,
        duration_minutes
      );

      for (const slot of timeSlots) {
        if (availableSlots.length >= limit) break;

        const slotKey = `${consultantId}|${dateStr}|${slot.start}`;

        // Пропускаем занятые слоты
        if (busySlots.has(slotKey)) continue;

        // Пропускаем прошедшие слоты (для сегодняшнего дня)
        if (dateStr === now.toISOString().split('T')[0]) {
          const [slotHour, slotMin] = slot.start.split(':').map(Number);
          const slotTime = new Date(currentDate);
          slotTime.setHours(slotHour, slotMin, 0, 0);

          // Добавляем буфер 30 минут
          const bufferTime = new Date(now);
          bufferTime.setMinutes(bufferTime.getMinutes() + 30);

          if (slotTime <= bufferTime) continue;
        }

        const consultantName = consultantMap.get(consultantId) || 'Консультант';

        availableSlots.push({
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

  // Сортируем по дате и времени
  availableSlots.sort((a, b) => {
    if (a.date !== b.date) {
      return a.date.localeCompare(b.date);
    }
    return a.start_time.localeCompare(b.start_time);
  });

  return availableSlots.slice(0, limit);
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

  if (scheduleError || !schedule) {
    return false;
  }

  // Проверяем, попадает ли слот в рабочее время
  const [startHour, startMin] = startTime.split(':').map(Number);
  const endMin = startMin + durationMinutes;
  const endHour = startHour + Math.floor(endMin / 60);
  const endMinNorm = endMin % 60;
  const endTime = `${String(endHour).padStart(2, '0')}:${String(endMinNorm).padStart(2, '0')}`;

  if (startTime < schedule.start_time || endTime > schedule.end_time) {
    return false;
  }

  // Проверяем, нет ли пересечений с существующими консультациями
  const { data: existing, error: existingError } = await supabase
    .from('consultations')
    .select('id')
    .eq('consultant_id', consultantId)
    .eq('date', date)
    .in('status', ['scheduled', 'confirmed'])
    .or(`and(start_time.lt.${endTime},end_time.gt.${startTime})`);

  if (existingError) {
    console.error('Error checking slot availability:', existingError);
    return false;
  }

  return !existing || existing.length === 0;
}

/**
 * Получает консультации клиента (лида)
 */
export async function getClientConsultations(dialogAnalysisId: string): Promise<any[]> {
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
    console.error('Error fetching client consultations:', error);
    return [];
  }

  return (data || []).map(c => ({
    ...c,
    consultant_name: c.consultant?.name || 'Консультант',
    formatted: formatSlotForClient(c.date, c.start_time, c.consultant?.name || 'Консультант')
  }));
}
