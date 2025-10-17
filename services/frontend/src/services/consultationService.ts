// Сервис консультаций с подключением к Supabase

import { supabase } from '@/integrations/supabase/client';
import {
  Consultant,
  WorkingSchedule,
  ConsultationSlot,
  Consultation,
  ConsultantWithSchedule,
  ConsultationWithDetails,
  CreateConsultantData,
  CreateWorkingScheduleData,
  CreateConsultationData,
  UpdateConsultationData,
  ConsultationFilters,
  DEFAULT_SLOT_DURATION,
  ConsultationStats
} from '@/types/consultation';

// Функция генерации UUID для совместимости
const generateUUID = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback для старых браузеров
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

// Получение списка консультантов
export const getConsultants = async (): Promise<Consultant[]> => {
  try {
    const { data, error } = await supabase
      .from('consultants')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (error) {
      console.error('Ошибка получения консультантов:', error);
      throw error;
    }
    
    return data || [];
  } catch (error) {
    console.error('Ошибка подключения к Supabase:', error);
    throw error;
  }
};

export const getConsultations = async (date?: string): Promise<ConsultationWithDetails[]> => {
  try {
    let query = supabase
      .from('consultations')
      .select(`
        *,
        consultant:consultants!inner(*),
        service:services(*)
      `)
      .order('date', { ascending: true })
      .order('start_time', { ascending: true });

    if (date) {
      query = query.eq('date', date);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Ошибка получения консультаций:', error);
      throw error;
    }
    
    // Преобразуем данные в нужный формат
    const consultations = (data || []).map(item => {
      return {
        ...item,
        status: item.status as 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show',
        consultant: Array.isArray(item.consultant) ? item.consultant[0] : item.consultant,
        service: item.service || undefined,
        slot: {
          id: item.slot_id,
          consultant_id: item.consultant_id,
          date: item.date,
          start_time: item.start_time,
          end_time: item.end_time,
          is_available: false,
          is_blocked: false,
          created_at: item.created_at,
          updated_at: item.updated_at
        }
      };
    });
    
    return consultations;
  } catch (error) {
    console.error('Ошибка подключения к Supabase:', error);
    throw error;
  }
};

export const getConsultationStats = async (): Promise<ConsultationStats> => {
  try {
    const { data, error } = await supabase
      .from('consultations')
      .select('status');

    if (error) {
      console.error('Ошибка получения статистики:', error);
      throw error;
    }

    const stats = {
      total: data?.length || 0,
      scheduled: data?.filter(c => c.status === 'scheduled').length || 0,
      confirmed: data?.filter(c => c.status === 'confirmed').length || 0,
      completed: data?.filter(c => c.status === 'completed').length || 0,
      cancelled: data?.filter(c => c.status === 'cancelled').length || 0,
      no_show: data?.filter(c => c.status === 'no_show').length || 0
    };

    return stats;
  } catch (error) {
    console.error('Ошибка подключения к Supabase:', error);
    throw error;
  }
};

export const createConsultation = async (consultation: CreateConsultationData): Promise<Consultation> => {
  try {
    const consultationData: any = {
      consultant_id: consultation.consultant_id,
      client_phone: consultation.client_phone,
      client_name: consultation.client_name,
      client_chat_id: consultation.client_chat_id || '',
      date: consultation.date,
      start_time: consultation.start_time,
      end_time: consultation.end_time,
      status: consultation.status || 'scheduled',
      consultation_type: consultation.consultation_type || 'general',
      notes: consultation.notes,
      service_id: consultation.service_id || null,
      actual_duration_minutes: consultation.actual_duration_minutes || null,
      is_sale_closed: consultation.is_sale_closed || false
    };

    // Добавляем slot_id только если он передан и не пустой
    if (consultation.slot_id) {
      consultationData.slot_id = consultation.slot_id;
    }

    const { data, error } = await supabase
      .from('consultations')
      .insert([consultationData])
      .select()
      .single();

    if (error) {
      console.error('Ошибка создания консультации:', error);
      throw error;
    }
    
    return {
      ...data,
      status: data.status as 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'
    };
  } catch (error) {
    console.error('Ошибка подключения к Supabase:', error);
    throw error;
  }
};

export const updateConsultation = async (id: string, updates: Partial<Consultation>): Promise<Consultation> => {
  try {
    const { data, error } = await supabase
      .from('consultations')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Ошибка обновления консультации:', error);
      throw error;
    }
    
    return {
      ...data,
      status: data.status as 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'
    };
  } catch (error) {
    console.error('Ошибка подключения к Supabase:', error);
    throw error;
  }
};

export const cancelConsultation = async (consultationId: string): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('consultations')
      .update({ status: 'cancelled' })
      .eq('id', consultationId);

    if (error) {
      console.error('Ошибка отмены консультации:', error);
      throw error;
    }
    
    return true;
  } catch (error) {
    console.error('Ошибка подключения к Supabase:', error);
    throw error;
  }
};

// Остальные функции для будущего развития
export const getConsultantWithSchedule = async (consultantId: string): Promise<ConsultantWithSchedule | null> => {
  // TODO: Реализовать когда понадобится
  return null;
};

export const createConsultant = async (data: CreateConsultantData): Promise<Consultant | null> => {
  try {
    const { data: result, error } = await supabase
      .from('consultants')
      .insert([data])
      .select()
      .single();

    if (error) {
      console.error('Ошибка создания консультанта:', error);
      throw error;
    }
    
    return result;
  } catch (error) {
    console.error('Ошибка подключения к Supabase:', error);
    throw error;
  }
};

export const getWorkingSchedules = async (consultantId: string): Promise<WorkingSchedule[]> => {
  // TODO: Реализовать когда понадобится
  return [];
};

export const createWorkingSchedule = async (data: CreateWorkingScheduleData): Promise<WorkingSchedule | null> => {
  // TODO: Реализовать когда понадобится
  return null;
};

export const updateWorkingSchedule = async (
  scheduleId: string, 
  data: Partial<CreateWorkingScheduleData>
): Promise<boolean> => {
  // TODO: Реализовать когда понадобится
  return false;
};

export const generateSlotsForDate = async (
  consultantId: string, 
  date: string
): Promise<ConsultationSlot[]> => {
  // TODO: Реализовать когда понадобится
  return [];
};

export const getAvailableSlots = async (consultantId: string, date: string): Promise<ConsultationSlot[]> => {
  // TODO: Реализовать когда понадобится
  return [];
};

export const blockSlot = async (slotId: string, isBlocked: boolean = true): Promise<boolean> => {
  // TODO: Реализовать когда понадобится
  return false;
};

export const getConsultationsByDateRange = async (
  consultantId: string,
  startDate: string,
  endDate: string
): Promise<Consultation[]> => {
  try {
    const { data, error } = await supabase
      .from('consultations')
      .select('*')
      .eq('consultant_id', consultantId)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true })
      .order('start_time', { ascending: true });

    if (error) {
      console.error('Ошибка получения консультаций по диапазону дат:', error);
      throw error;
    }
    
    return (data || []).map(item => ({
      ...item,
      status: item.status as 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'
    }));
  } catch (error) {
    console.error('Ошибка подключения к Supabase:', error);
    throw error;
  }
}; 