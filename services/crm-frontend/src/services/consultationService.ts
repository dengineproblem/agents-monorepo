import {
  Consultant,
  Consultation,
  ConsultationWithDetails,
  CreateConsultantData,
  CreateConsultationData,
  UpdateConsultationData,
  ConsultationStats
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
  }
};
