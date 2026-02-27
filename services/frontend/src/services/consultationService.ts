// Сервис консультаций — проксирование через backend API

import { API_BASE_URL } from '@/config/api';
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

function getUserId(): string {
  const raw = localStorage.getItem('user');
  if (!raw) throw new Error('User not found in localStorage');
  const user = JSON.parse(raw);
  return user.id;
}

// Получение списка консультантов
export const getConsultants = async (): Promise<Consultant[]> => {
  try {
    const userId = getUserId();
    const res = await fetch(`${API_BASE_URL}/consultations/consultants`, {
      headers: { 'x-user-id': userId },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('Ошибка получения консультантов:', err);
      throw new Error(err.error || 'Failed to fetch consultants');
    }

    return await res.json();
  } catch (error) {
    console.error('Ошибка получения консультантов:', error);
    throw error;
  }
};

export const getConsultations = async (date?: string): Promise<ConsultationWithDetails[]> => {
  try {
    const userId = getUserId();
    const params = new URLSearchParams();
    if (date) params.set('date', date);

    const url = `${API_BASE_URL}/consultations${params.toString() ? '?' + params.toString() : ''}`;
    const res = await fetch(url, {
      headers: { 'x-user-id': userId },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('Ошибка получения консультаций:', err);
      throw new Error(err.error || 'Failed to fetch consultations');
    }

    const data = await res.json();

    // Преобразуем данные в нужный формат
    const consultations = (data || []).map((item: any) => {
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
    console.error('Ошибка получения консультаций:', error);
    throw error;
  }
};

export const getConsultationStats = async (): Promise<ConsultationStats> => {
  try {
    const userId = getUserId();
    const res = await fetch(`${API_BASE_URL}/consultations/stats`, {
      headers: { 'x-user-id': userId },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('Ошибка получения статистики:', err);
      throw new Error(err.error || 'Failed to fetch consultation stats');
    }

    return await res.json();
  } catch (error) {
    console.error('Ошибка получения статистики:', error);
    throw error;
  }
};

export const createConsultation = async (consultation: CreateConsultationData): Promise<Consultation> => {
  try {
    const userId = getUserId();
    const res = await fetch(`${API_BASE_URL}/consultations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': userId,
      },
      body: JSON.stringify({
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
        is_sale_closed: consultation.is_sale_closed || false,
        slot_id: consultation.slot_id || undefined,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('Ошибка создания консультации:', err);
      throw new Error(err.error || 'Failed to create consultation');
    }

    const data = await res.json();
    return {
      ...data,
      status: data.status as 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'
    };
  } catch (error) {
    console.error('Ошибка создания консультации:', error);
    throw error;
  }
};

export const updateConsultation = async (id: string, updates: Partial<Consultation>): Promise<Consultation> => {
  try {
    const userId = getUserId();
    const res = await fetch(`${API_BASE_URL}/consultations/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': userId,
      },
      body: JSON.stringify(updates),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('Ошибка обновления консультации:', err);
      throw new Error(err.error || 'Failed to update consultation');
    }

    const data = await res.json();
    return {
      ...data,
      status: data.status as 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'
    };
  } catch (error) {
    console.error('Ошибка обновления консультации:', error);
    throw error;
  }
};

export const cancelConsultation = async (consultationId: string): Promise<boolean> => {
  try {
    const userId = getUserId();
    const res = await fetch(`${API_BASE_URL}/consultations/${consultationId}/cancel`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': userId,
      },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('Ошибка отмены консультации:', err);
      throw new Error(err.error || 'Failed to cancel consultation');
    }

    return true;
  } catch (error) {
    console.error('Ошибка отмены консультации:', error);
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
    const userId = getUserId();
    const res = await fetch(`${API_BASE_URL}/consultations/consultants`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': userId,
      },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('Ошибка создания консультанта:', err);
      throw new Error(err.error || 'Failed to create consultant');
    }

    return await res.json();
  } catch (error) {
    console.error('Ошибка создания консультанта:', error);
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
    const userId = getUserId();
    const params = new URLSearchParams({
      consultantId,
      startDate,
      endDate,
    });

    const res = await fetch(`${API_BASE_URL}/consultations/by-date-range?${params.toString()}`, {
      headers: { 'x-user-id': userId },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('Ошибка получения консультаций по диапазону дат:', err);
      throw new Error(err.error || 'Failed to fetch consultations by date range');
    }

    const data = await res.json();
    return (data || []).map((item: any) => ({
      ...item,
      status: item.status as 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'
    }));
  } catch (error) {
    console.error('Ошибка получения консультаций по диапазону дат:', error);
    throw error;
  }
};
