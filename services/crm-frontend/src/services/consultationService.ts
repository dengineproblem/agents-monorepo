import {
  Consultant,
  Consultation,
  ConsultationWithDetails,
  CreateConsultantData,
  CreateConsultationData,
  UpdateConsultationData,
  ConsultationStats,
  WorkingSchedule,
  WorkingScheduleInput,
  NotificationSettings,
  NotificationTemplate,
  CreateNotificationTemplate,
  NotificationHistory,
  ConsultationService,
  ConsultantService,
  CreateServiceData,
  UpdateServiceData,
  ExtendedStats
} from '@/types/consultation';

export type { Consultant } from '@/types/consultation';

const API_BASE_URL = import.meta.env.VITE_CRM_BACKEND_URL || '/api/crm';

export const consultationService = {
  // Получение списка консультантов
  async getConsultants(): Promise<Consultant[]> {
    const response = await fetch(`${API_BASE_URL}/consultants`);
    if (!response.ok) throw new Error('Failed to fetch consultants');
    return response.json();
  },

  // Создание консультанта
  async createConsultant(userAccountId: string, data: CreateConsultantData): Promise<Consultant> {
    const response = await fetch(`${API_BASE_URL}/consultants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, user_account_id: userAccountId })
    });
    if (!response.ok) throw new Error('Failed to create consultant');
    return response.json();
  },

  // Обновление консультанта
  async updateConsultant(id: string, data: Partial<CreateConsultantData>): Promise<Consultant> {
    const response = await fetch(`${API_BASE_URL}/consultants/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Failed to update consultant');
    return response.json();
  },

  // Удаление консультанта
  async deleteConsultant(id: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/consultants/${id}`, {
      method: 'DELETE'
    });
    if (!response.ok) throw new Error('Failed to delete consultant');
  },

  // Получение консультаций
  async getConsultations(date?: string): Promise<ConsultationWithDetails[]> {
    const params = new URLSearchParams();
    if (date) params.append('date', date);

    const response = await fetch(`${API_BASE_URL}/consultations?${params}`);
    if (!response.ok) throw new Error('Failed to fetch consultations');
    return response.json();
  },

  // Получение консультаций по диапазону дат
  async getConsultationsByDateRange(
    consultantId: string,
    startDate: string,
    endDate: string
  ): Promise<Consultation[]> {
    const params = new URLSearchParams({
      consultantId,
      startDate,
      endDate
    });

    const response = await fetch(`${API_BASE_URL}/consultations/range?${params}`);
    if (!response.ok) throw new Error('Failed to fetch consultations by range');
    return response.json();
  },

  // Создание консультации
  async createConsultation(data: CreateConsultationData): Promise<Consultation> {
    const response = await fetch(`${API_BASE_URL}/consultations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Failed to create consultation');
    return response.json();
  },

  // Обновление консультации
  async updateConsultation(id: string, data: UpdateConsultationData): Promise<Consultation> {
    const response = await fetch(`${API_BASE_URL}/consultations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Failed to update consultation');
    return response.json();
  },

  // Отмена консультации
  async cancelConsultation(id: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/consultations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' })
    });
    if (!response.ok) throw new Error('Failed to cancel consultation');
  },

  // Удаление консультации
  async deleteConsultation(id: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/consultations/${id}`, {
      method: 'DELETE'
    });
    if (!response.ok) throw new Error('Failed to delete consultation');
  },

  // Получение статистики
  async getStats(): Promise<ConsultationStats> {
    const response = await fetch(`${API_BASE_URL}/consultations/stats`);
    if (!response.ok) throw new Error('Failed to fetch stats');
    return response.json();
  },

  // Запись лида на консультацию (связь с CRM)
  async bookFromLead(
    dialogAnalysisId: string,
    data: {
      consultant_id: string;
      date: string;
      start_time: string;
      end_time: string;
      notes?: string;
    }
  ): Promise<Consultation> {
    const response = await fetch(`${API_BASE_URL}/consultations/book-from-lead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dialog_analysis_id: dialogAnalysisId,
        ...data
      })
    });
    if (!response.ok) throw new Error('Failed to book consultation from lead');
    return response.json();
  },

  // ==================== WORKING SCHEDULES ====================

  // Получение расписания консультанта
  async getSchedules(consultantId: string): Promise<WorkingSchedule[]> {
    const response = await fetch(`${API_BASE_URL}/consultants/${consultantId}/schedules`);
    if (!response.ok) throw new Error('Failed to fetch schedules');
    return response.json();
  },

  // Обновление расписания консультанта (полная замена)
  async updateSchedules(consultantId: string, schedules: WorkingScheduleInput[]): Promise<WorkingSchedule[]> {
    const response = await fetch(`${API_BASE_URL}/consultants/${consultantId}/schedules`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schedules })
    });
    if (!response.ok) throw new Error('Failed to update schedules');
    return response.json();
  },

  // Получение всех расписаний всех консультантов
  async getAllSchedules(): Promise<WorkingSchedule[]> {
    const response = await fetch(`${API_BASE_URL}/schedules/all`);
    if (!response.ok) throw new Error('Failed to fetch all schedules');
    return response.json();
  },

  // ==================== NOTIFICATION SETTINGS ====================

  // Получение настроек уведомлений
  async getNotificationSettings(userAccountId: string): Promise<NotificationSettings> {
    const response = await fetch(`${API_BASE_URL}/consultation-notifications/settings?userAccountId=${userAccountId}`);
    if (!response.ok) throw new Error('Failed to fetch notification settings');
    return response.json();
  },

  // Обновление настроек уведомлений
  async updateNotificationSettings(userAccountId: string, data: Partial<NotificationSettings>): Promise<NotificationSettings> {
    const response = await fetch(`${API_BASE_URL}/consultation-notifications/settings?userAccountId=${userAccountId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Failed to update notification settings');
    return response.json();
  },

  // ==================== CUSTOM TEMPLATES ====================

  // Получение кастомных шаблонов
  async getNotificationTemplates(userAccountId: string): Promise<NotificationTemplate[]> {
    const response = await fetch(`${API_BASE_URL}/consultation-notifications/templates?userAccountId=${userAccountId}`);
    if (!response.ok) throw new Error('Failed to fetch notification templates');
    return response.json();
  },

  // Создание кастомного шаблона
  async createNotificationTemplate(userAccountId: string, data: CreateNotificationTemplate): Promise<NotificationTemplate> {
    const response = await fetch(`${API_BASE_URL}/consultation-notifications/templates?userAccountId=${userAccountId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Failed to create notification template');
    return response.json();
  },

  // Обновление кастомного шаблона
  async updateNotificationTemplate(id: string, data: Partial<CreateNotificationTemplate>): Promise<NotificationTemplate> {
    const response = await fetch(`${API_BASE_URL}/consultation-notifications/templates/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Failed to update notification template');
    return response.json();
  },

  // Удаление кастомного шаблона
  async deleteNotificationTemplate(id: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/consultation-notifications/templates/${id}`, {
      method: 'DELETE'
    });
    if (!response.ok) throw new Error('Failed to delete notification template');
  },

  // ==================== NOTIFICATION HISTORY ====================

  // Получение истории уведомлений для консультации
  async getNotificationHistory(consultationId: string): Promise<NotificationHistory[]> {
    const response = await fetch(`${API_BASE_URL}/consultation-notifications/history/${consultationId}`);
    if (!response.ok) throw new Error('Failed to fetch notification history');
    return response.json();
  },

  // ==================== CONSULTATION SERVICES ====================

  // Получение списка услуг
  async getServices(userAccountId: string, includeInactive = false): Promise<ConsultationService[]> {
    const params = new URLSearchParams({ user_account_id: userAccountId });
    if (includeInactive) params.append('include_inactive', 'true');

    const response = await fetch(`${API_BASE_URL}/consultation-services?${params}`);
    if (!response.ok) throw new Error('Failed to fetch services');
    return response.json();
  },

  // Получение одной услуги
  async getService(id: string): Promise<ConsultationService> {
    const response = await fetch(`${API_BASE_URL}/consultation-services/${id}`);
    if (!response.ok) throw new Error('Failed to fetch service');
    return response.json();
  },

  // Создание услуги
  async createService(data: CreateServiceData): Promise<ConsultationService> {
    const response = await fetch(`${API_BASE_URL}/consultation-services`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Failed to create service');
    return response.json();
  },

  // Обновление услуги
  async updateService(id: string, data: UpdateServiceData): Promise<ConsultationService> {
    const response = await fetch(`${API_BASE_URL}/consultation-services/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Failed to update service');
    return response.json();
  },

  // Удаление услуги
  async deleteService(id: string, hard = false): Promise<void> {
    const params = hard ? '?hard=true' : '';
    const response = await fetch(`${API_BASE_URL}/consultation-services/${id}${params}`, {
      method: 'DELETE'
    });
    if (!response.ok) throw new Error('Failed to delete service');
  },

  // ==================== CONSULTANT-SERVICE ASSIGNMENTS ====================

  // Получение услуг консультанта
  async getConsultantServices(consultantId: string): Promise<ConsultantService[]> {
    const response = await fetch(`${API_BASE_URL}/consultant-services/${consultantId}`);
    if (!response.ok) throw new Error('Failed to fetch consultant services');
    return response.json();
  },

  // Назначение услуги консультанту
  async assignServiceToConsultant(data: {
    consultant_id: string;
    service_id: string;
    custom_price?: number;
    custom_duration?: number;
  }): Promise<ConsultantService> {
    const response = await fetch(`${API_BASE_URL}/consultant-services`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Failed to assign service to consultant');
    return response.json();
  },

  // Массовое обновление услуг консультанта
  async bulkUpdateConsultantServices(consultantId: string, serviceIds: string[]): Promise<ConsultantService[]> {
    const response = await fetch(`${API_BASE_URL}/consultant-services/bulk/${consultantId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service_ids: serviceIds })
    });
    if (!response.ok) throw new Error('Failed to bulk update consultant services');
    return response.json();
  },

  // Удаление назначения услуги
  async removeServiceFromConsultant(assignmentId: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/consultant-services/${assignmentId}`, {
      method: 'DELETE'
    });
    if (!response.ok) throw new Error('Failed to remove service from consultant');
  },

  // ==================== EXTENDED STATISTICS ====================

  // Получение расширенной статистики
  async getExtendedStats(params?: {
    period?: 'week' | 'month' | 'quarter' | 'year';
    user_account_id?: string;
  }): Promise<ExtendedStats> {
    const searchParams = new URLSearchParams();
    if (params?.period) searchParams.append('period', params.period);
    if (params?.user_account_id) searchParams.append('user_account_id', params.user_account_id);

    const response = await fetch(`${API_BASE_URL}/consultations/stats/extended?${searchParams}`);
    if (!response.ok) throw new Error('Failed to fetch extended stats');
    return response.json();
  },

  // ==================== BLOCKED SLOTS (BREAKS) ====================

  // Получение заблокированных слотов
  async getBlockedSlots(params?: {
    date?: string;
    consultant_id?: string;
    start_date?: string;
    end_date?: string;
  }): Promise<BlockedSlot[]> {
    const searchParams = new URLSearchParams();
    if (params?.date) searchParams.append('date', params.date);
    if (params?.consultant_id) searchParams.append('consultant_id', params.consultant_id);
    if (params?.start_date) searchParams.append('start_date', params.start_date);
    if (params?.end_date) searchParams.append('end_date', params.end_date);

    const response = await fetch(`${API_BASE_URL}/blocked-slots?${searchParams}`);
    if (!response.ok) throw new Error('Failed to fetch blocked slots');
    return response.json();
  },

  // Создание блокировки слота (перерыв)
  async createBlockedSlot(data: CreateBlockedSlotData): Promise<BlockedSlot> {
    const response = await fetch(`${API_BASE_URL}/blocked-slots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Failed to create blocked slot' }));
      throw new Error(error.message || 'Failed to create blocked slot');
    }
    return response.json();
  },

  // Удаление блокировки слота
  async deleteBlockedSlot(id: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/blocked-slots/${id}`, {
      method: 'DELETE'
    });
    if (!response.ok) throw new Error('Failed to delete blocked slot');
  }
};

// ==================== BLOCKED SLOTS TYPES ====================

export interface BlockedSlot {
  id: string;
  consultant_id: string;
  date: string;
  start_time: string;
  end_time: string;
  reason: string;
  created_at: string;
  consultant?: {
    id: string;
    name: string;
  };
}

export interface CreateBlockedSlotData {
  consultant_id: string;
  date: string;
  start_time: string;
  end_time: string;
  reason?: string;
}
