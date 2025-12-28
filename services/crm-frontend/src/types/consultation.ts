export interface Consultant {
  id: string;
  name: string;
  email: string;
  phone?: string;
  specialization?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorkingSchedule {
  id: string;
  consultant_id: string;
  day_of_week: number; // 0 = воскресенье, 1 = понедельник, и т.д.
  start_time: string; // формат HH:MM
  end_time: string; // формат HH:MM
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorkingScheduleInput {
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_active?: boolean;
}

export interface ConsultationSlot {
  id: string;
  consultant_id: string;
  date: string; // формат YYYY-MM-DD
  start_time: string; // формат HH:MM
  end_time: string; // формат HH:MM
  is_available: boolean;
  is_blocked: boolean;
  created_at: string;
  updated_at: string;
}

export interface Consultation {
  id: string;
  consultant_id: string;
  slot_id?: string;
  client_phone: string;
  client_name?: string;
  client_chat_id?: string;
  dialog_analysis_id?: string; // связь с лидом из CRM
  date: string; // формат YYYY-MM-DD
  start_time: string; // формат HH:MM
  end_time: string; // формат HH:MM
  status: ConsultationStatus;
  notes?: string;
  consultation_type: string;
  actual_duration_minutes?: number;
  is_sale_closed?: boolean;
  created_at: string;
  updated_at: string;
}

export type ConsultationStatus = 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';

// Расширенные типы для UI
export interface ConsultantWithSchedule extends Consultant {
  working_schedules: WorkingSchedule[];
}

export interface ConsultationWithDetails extends Consultation {
  consultant?: Consultant;
  slot?: ConsultationSlot;
}

export interface DaySchedule {
  date: string;
  day_of_week: number;
  slots: ConsultationSlot[];
  consultations: Consultation[];
}

// Типы для создания/обновления
export interface CreateConsultantData {
  name: string;
  email: string;
  phone?: string;
  specialization?: string;
}

export interface CreateConsultationData {
  consultant_id: string;
  slot_id?: string;
  client_phone: string;
  client_name?: string;
  client_chat_id?: string;
  dialog_analysis_id?: string;
  date: string;
  start_time: string;
  end_time: string;
  status?: ConsultationStatus;
  notes?: string;
  consultation_type?: string;
}

export interface UpdateConsultationData {
  status?: ConsultationStatus;
  notes?: string;
  client_name?: string;
  is_sale_closed?: boolean;
}

// Утилитарные типы
export interface TimeSlot {
  start_time: string;
  end_time: string;
  is_available: boolean;
  is_booked: boolean;
  consultation?: Consultation;
}

export interface ConsultationFilters {
  consultant_id?: string;
  date_from?: string;
  date_to?: string;
  status?: ConsultationStatus;
  client_phone?: string;
}

// Константы
export const CONSULTATION_STATUSES: Record<ConsultationStatus, { label: string; color: string }> = {
  scheduled: { label: 'Запланирована', color: 'bg-blue-500' },
  confirmed: { label: 'Подтверждена', color: 'bg-green-500' },
  completed: { label: 'Завершена', color: 'bg-purple-500' },
  cancelled: { label: 'Отменена', color: 'bg-red-500' },
  no_show: { label: 'Не явился', color: 'bg-gray-500' }
};

export const DAYS_OF_WEEK: Record<number, string> = {
  0: 'Воскресенье',
  1: 'Понедельник',
  2: 'Вторник',
  3: 'Среда',
  4: 'Четверг',
  5: 'Пятница',
  6: 'Суббота'
};

export const DEFAULT_SLOT_DURATION = 60; // минуты
export const DEFAULT_WORKING_HOURS = {
  start: '09:00',
  end: '21:00'
};

export interface ConsultationStats {
  total: number;
  scheduled: number;
  confirmed: number;
  completed: number;
  cancelled: number;
  no_show: number;
}
