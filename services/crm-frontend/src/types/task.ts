/**
 * Типы для системы задач консультантов
 */

export interface Task {
  id: string;
  consultant_id: string;
  lead_id?: string;
  title: string;
  description?: string;
  status: 'pending' | 'completed' | 'cancelled';
  due_date: string; // YYYY-MM-DD
  result_notes?: string;
  completed_at?: string;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;

  // Joined data
  lead?: {
    contact_name?: string;
    contact_phone: string;
  };
  created_by?: {
    username: string;
  };
}

export interface CreateTaskData {
  title: string;
  description?: string;
  due_date: string;
  lead_id?: string;
  consultantId?: string; // Для админа
}

export interface UpdateTaskData {
  title?: string;
  description?: string;
  status?: 'pending' | 'completed' | 'cancelled';
  due_date?: string;
  result_notes?: string;
}

export interface TasksStats {
  tasks_total: number;
  tasks_overdue: number;
  tasks_today: number;
}
