/**
 * API клиент для работы с consultant endpoints
 */

const API_BASE_URL = import.meta.env.VITE_CRM_BACKEND_URL || '/api/crm';

// Получить userId из localStorage
const getUserId = (): string => {
  const user = localStorage.getItem('user');
  if (!user) throw new Error('User not authenticated');
  const parsed = JSON.parse(user);
  return parsed.id;
};

// Базовая функция для запросов с авторизацией
async function fetchWithAuth(url: string, options: RequestInit = {}) {
  const userId = getUserId();

  const response = await fetch(`${API_BASE_URL}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': userId,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || error.message || 'API request failed');
  }

  return response.json();
}

// Импорт типов задач
import type { Task, CreateTaskData, UpdateTaskData } from '@/types/task';

// Типы данных
export interface DashboardStats {
  consultant_id: string;
  period_type?: 'week' | 'month';
  period_start?: string;
  period_end?: string;
  total_leads: number;
  hot_leads: number;
  warm_leads: number;
  cold_leads: number;
  booked_leads: number;
  total_consultations: number;
  scheduled: number;
  confirmed: number;
  completed: number;
  cancelled: number;
  no_show: number;
  total_revenue: number;
  // Статистика задач
  tasks_total?: number;
  tasks_overdue?: number;
  tasks_today?: number;
  completion_rate: number;
  // Продажи и конверсии
  sales_count?: number;
  sales_amount?: number;
  lead_to_booked_rate?: number;
  booked_to_completed_rate?: number;
  completed_to_sales_rate?: number;
  // Плановые показатели
  target_lead_to_booked_rate?: number | null;
  target_booked_to_completed_rate?: number | null;
  target_completed_to_sales_rate?: number | null;
  target_sales_amount?: number | null;
  target_sales_count?: number | null;
}

export interface ConsultantTargets {
  consultant_id: string;
  period_type: 'week' | 'month';
  period_start: string;
  period_end: string;
  target_lead_to_booked_rate: number | null;
  target_booked_to_completed_rate: number | null;
  target_completed_to_sales_rate: number | null;
  target_sales_amount: number | null;
  target_sales_count: number | null;
}

export interface Lead {
  id: string;
  contact_phone: string;
  contact_name?: string;
  interest_level?: string;
  funnel_stage?: string;
  last_message?: string;
  assigned_consultant_id?: string;
  has_unread?: boolean; // Флаг наличия непрочитанных сообщений
  consultation_status?: 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show' | null; // Статус консультации
  has_sale?: boolean; // Есть ли продажа по клиенту
}

export interface Consultation {
  id: string;
  consultant_id: string;
  dialog_analysis_id?: string;
  client_name?: string;
  client_phone?: string;
  date: string;
  start_time: string;
  end_time: string;
  status: 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
  service_name?: string;
  price?: number;
  notes?: string;
  consultant?: {
    name: string;
    phone: string;
  };
  lead?: {
    contact_name: string;
    contact_phone: string;
    interest_level: string;
  };
}

export interface WorkingSchedule {
  id?: string;
  consultant_id: string;
  day_of_week: number; // 0-6
  start_time: string;
  end_time: string;
  is_active: boolean;
}

export interface Service {
  id: string;
  name: string;
  description?: string;
  duration_minutes: number;
  price: number;
  is_active: boolean;
  consultant_service?: {
    custom_price?: number;
    custom_duration?: number;
    is_active: boolean;
  };
  is_provided: boolean;
}

export interface CallLog {
  id: string;
  consultant_id: string;
  lead_id: string;
  called_at: string;
  result: string; // 'answered', 'no_answer', 'busy', 'scheduled'
  notes?: string;
  next_follow_up?: string;
}

export interface Sale {
  id: string;
  consultant_id: string;
  client_name?: string;
  client_phone?: string;
  amount: number;
  currency: string;
  product_name?: string;
  purchase_date: string;
  notes?: string;
  created_at: string;
}

// API методы

export const consultantApi = {
  // Dashboard
  getDashboard: async (params?: {
    consultantId?: string;
    period_type?: 'week' | 'month';
    period_start?: string;
  }): Promise<DashboardStats> => {
    const query = new URLSearchParams();
    if (params?.consultantId) query.append('consultantId', params.consultantId);
    if (params?.period_type) query.append('period_type', params.period_type);
    if (params?.period_start) query.append('period_start', params.period_start);
    const queryString = query.toString();
    return fetchWithAuth(`/consultant/dashboard${queryString ? `?${queryString}` : ''}`);
  },

  // Targets
  getTargets: async (params?: {
    consultantId?: string;
    period_type?: 'week' | 'month';
    period_start?: string;
  }): Promise<ConsultantTargets> => {
    const query = new URLSearchParams();
    if (params?.consultantId) query.append('consultantId', params.consultantId);
    if (params?.period_type) query.append('period_type', params.period_type);
    if (params?.period_start) query.append('period_start', params.period_start);
    const queryString = query.toString();
    return fetchWithAuth(`/consultant/targets${queryString ? `?${queryString}` : ''}`);
  },

  setTargets: async (data: {
    consultant_id: string;
    period_type: 'week' | 'month';
    period_start: string;
    target_lead_to_booked_rate?: number | null;
    target_booked_to_completed_rate?: number | null;
    target_completed_to_sales_rate?: number | null;
    target_sales_amount?: number | null;
    target_sales_count?: number | null;
  }): Promise<{ success: boolean; targets: ConsultantTargets }> => {
    return fetchWithAuth('/admin/consultant-targets', {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },

  // Leads
  getLeads: async (params?: {
    status?: string;
    interest_level?: string;
    is_booked?: string;
    consultantId?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ leads: Lead[]; total: number; limit: number; offset: number }> => {
    const query = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) query.append(key, String(value));
      });
    }
    return fetchWithAuth(`/consultant/leads?${query}`);
  },

  // Consultations
  getConsultations: async (params?: {
    date?: string;
    status?: string;
    from_date?: string;
    to_date?: string;
    consultantId?: string;
  }): Promise<Consultation[]> => {
    const query = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) query.append(key, String(value));
      });
    }
    return fetchWithAuth(`/consultant/consultations?${query}`);
  },

  // Schedule
  getSchedule: async (consultantId?: string): Promise<WorkingSchedule[]> => {
    const query = consultantId ? `?consultantId=${consultantId}` : '';
    return fetchWithAuth(`/consultant/schedule${query}`);
  },

  updateSchedule: async (schedules: Omit<WorkingSchedule, 'id' | 'consultant_id'>[]): Promise<WorkingSchedule[]> => {
    return fetchWithAuth('/consultant/schedule', {
      method: 'PUT',
      body: JSON.stringify({ schedules }),
    });
  },

  // Services
  getServices: async (consultantId?: string): Promise<Service[]> => {
    const query = consultantId ? `?consultantId=${consultantId}` : '';
    return fetchWithAuth(`/consultant/services${query}`);
  },

  updateServices: async (
    services: Array<{
      service_id: string;
      custom_price?: number;
      custom_duration?: number;
      is_active: boolean;
    }>,
    consultantId?: string
  ): Promise<any> => {
    const body: any = { services };
    if (consultantId) {
      body.consultantId = consultantId;
    }
    return fetchWithAuth('/consultant/services', {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  },

  // Profile
  getProfile: async (consultantId?: string): Promise<{
    id: string;
    name: string;
    phone?: string;
    email?: string;
    specialization?: string;
    user_account_id: string;
  }> => {
    const query = consultantId ? `?consultantId=${consultantId}` : '';
    return fetchWithAuth(`/consultant/profile${query}`);
  },

  updateProfile: async (data: {
    name?: string;
    phone?: string;
    email?: string;
    specialization?: string;
  }): Promise<any> => {
    return fetchWithAuth('/consultant/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  changePassword: async (currentPassword: string, newPassword: string): Promise<{ success: boolean; message: string }> => {
    return fetchWithAuth('/consultant/change-password', {
      method: 'PUT',
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    });
  },

  // Call logs
  createCallLog: async (data: {
    lead_id: string;
    result: string;
    notes?: string;
    next_follow_up?: string;
  }): Promise<CallLog> => {
    return fetchWithAuth('/consultant/call-log', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  getCallLogs: async (leadId: string): Promise<CallLog[]> => {
    return fetchWithAuth(`/consultant/call-logs/${leadId}`);
  },

  // Messages
  sendMessage: async (leadId: string, message: string): Promise<{ success: boolean; messageId?: string }> => {
    return fetchWithAuth('/consultant/send-message', {
      method: 'POST',
      body: JSON.stringify({ leadId, message }),
    });
  },

  getMessages: async (leadId: string): Promise<{
    leadId: string;
    contactName: string;
    contactPhone: string;
    messages: Array<{
      text: string;
      timestamp: string;
      from_me: boolean;
      is_system: boolean;
    }>;
  }> => {
    return fetchWithAuth(`/consultant/messages/${leadId}`);
  },

  releaseLead: async (leadId: string): Promise<{ success: boolean; message: string }> => {
    return fetchWithAuth(`/consultant/release-lead/${leadId}`, {
      method: 'POST',
    });
  },

  // Tasks
  getTasks: async (params?: {
    consultantId?: string;
    status?: string;
    due_date_from?: string;
    due_date_to?: string;
    lead_id?: string;
    search?: string;
  }): Promise<{ tasks: Task[]; total: number }> => {
    const query = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          query.append(key, String(value));
        }
      });
    }
    return fetchWithAuth(`/consultant/tasks?${query}`);
  },

  createTask: async (data: CreateTaskData): Promise<Task> => {
    return fetchWithAuth('/consultant/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateTask: async (taskId: string, data: UpdateTaskData): Promise<Task> => {
    return fetchWithAuth(`/consultant/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  deleteTask: async (taskId: string): Promise<void> => {
    return fetchWithAuth(`/consultant/tasks/${taskId}`, {
      method: 'DELETE',
    });
  },

  // Sales
  getSales: async (params: {
    consultantId: string;
    search?: string;
    date_from?: string;
    date_to?: string;
    product_name?: string;
    limit?: string;
    offset?: string;
  }): Promise<{ sales: Sale[]; total: number }> => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== '') {
        query.append(key, String(value));
      }
    });
    return fetchWithAuth(`/consultant/sales?${query}`);
  },

  createSale: async (data: {
    consultantId: string;
    amount: number;
    product_name: string;
    sale_date: string;
    comment?: string;
    client_name?: string;
    client_phone?: string;
    lead_id?: string;
  }): Promise<Sale> => {
    const { consultantId, ...body } = data;
    return fetchWithAuth(`/consultant/sales?consultantId=${consultantId}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  // Получить количество непрочитанных сообщений
  getUnreadCount: async (): Promise<{ unreadCount: number }> => {
    return fetchWithAuth('/consultant/unread-count');
  },
};
