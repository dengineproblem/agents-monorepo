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
  NotificationHistory
} from '@/types/consultation';

const API_BASE_URL = import.meta.env.VITE_CRM_BACKEND_URL || '/api/crm';

export const consultationService = {
  // Получение списка консультантов
  async getConsultants(): Promise<Consultant[]> {
    const response = await fetch(`${API_BASE_URL}/consultants`);
    if (!response.ok) throw new Error('Failed to fetch consultants');
    return response.json();
  },

  // Создание консультанта
  async createConsultant(data: CreateConsultantData): Promise<Consultant> {
    const response = await fetch(`${API_BASE_URL}/consultants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
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
  }
};
