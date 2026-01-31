/**
 * API клиент для работы с consultant endpoints
 */

const API_BASE_URL = import.meta.env.VITE_CRM_BACKEND_URL || 'http://localhost:8084';

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

// Типы данных
export interface DashboardStats {
  consultant_id: string;
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
  completion_rate: number;
}

export interface Lead {
  id: string;
  contact_phone: string;
  contact_name?: string;
  interest_level?: string;
  funnel_stage?: string;
  last_message?: string;
  assigned_consultant_id?: string;
}

export interface Consultation {
  id: string;
  consultant_id: string;
  dialog_analysis_id?: string;
  date: string;
  start_time: string;
  end_time: string;
  status: 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
  service_name?: string;
  price?: number;
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

// API методы

export const consultantApi = {
  // Dashboard
  getDashboard: async (consultantId?: string): Promise<DashboardStats> => {
    const query = consultantId ? `?consultantId=${consultantId}` : '';
    return fetchWithAuth(`/consultant/dashboard${query}`);
  },

  // Leads
  getLeads: async (params?: {
    status?: string;
    interest_level?: string;
    is_booked?: string;
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
};
