import { API_BASE_URL } from '@/config/api';

// Типы для работы с планами
export interface UserDirection {
  id: number;
  user_id: string;
  main_direction: string;
  sub_direction: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlannedMetric {
  id: number;
  user_direction_id: number;
  metric_type: 'leads' | 'spend';
  planned_daily_value: number;
  created_at: string;
  updated_at: string;
}

export interface DirectionWithPlans {
  direction: UserDirection;
  leadsPlanned: number;
  spendPlanned: number;
}

export interface DirectionPlanInput {
  mainDirection: string;
  subDirection?: string | null;
  monthlyLeadsPlan: number;
  monthlySpendPlan: number;
}

/**
 * Получить все направления пользователя с их планами
 */
export async function getUserDirectionsWithPlans(userId: string): Promise<DirectionWithPlans[]> {
  try {
    const params = new URLSearchParams({ userId });
    const res = await fetch(`${API_BASE_URL}/user-plans/directions?${params}`, {
      headers: { 'x-user-id': userId },
    });

    if (!res.ok) throw new Error('Failed to fetch directions');

    const { directions, metrics } = await res.json();

    if (!directions || directions.length === 0) return [];

    return directions.map((direction: any) => {
      const directionMetrics = (metrics || []).filter((m: any) => m.user_direction_id === direction.id);
      const leadsMetric = directionMetrics.find((m: any) => m.metric_type === 'leads');
      const spendMetric = directionMetrics.find((m: any) => m.metric_type === 'spend');

      return {
        direction,
        leadsPlanned: leadsMetric?.planned_daily_value || 0,
        spendPlanned: spendMetric?.planned_daily_value || 0,
      };
    });
  } catch (error) {
    console.error('Ошибка в getUserDirectionsWithPlans:', error);
    throw error;
  }
}

/**
 * Создать или обновить направления и их планы для пользователя
 */
export async function saveUserDirectionPlans(
  userId: string,
  plans: DirectionPlanInput[]
): Promise<void> {
  try {
    const res = await fetch(`${API_BASE_URL}/user-plans/save-all`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': userId,
      },
      body: JSON.stringify({ plans }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to save direction plans');
    }

    console.log(`Успешно сохранено ${plans.length} направлений с планами для пользователя ${userId}`);
  } catch (error) {
    console.error('Ошибка в saveUserDirectionPlans:', error);
    throw error;
  }
}

/**
 * Обновить отдельную метрику плана
 */
function getUserId(): string | null {
  try {
    const stored = localStorage.getItem('user');
    if (stored) {
      const parsed = JSON.parse(stored);
      return parsed.id || null;
    }
  } catch {}
  return null;
}

export async function updatePlannedMetric(
  directionId: number,
  metricType: 'leads' | 'spend',
  value: number
): Promise<void> {
  const userId = getUserId();
  if (!userId) throw new Error('User not authenticated');

  try {
    const res = await fetch(`${API_BASE_URL}/user-plans/metrics`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': userId,
      },
      body: JSON.stringify({
        user_direction_id: directionId,
        metric_type: metricType,
        planned_daily_value: value,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to update metric');
    }
  } catch (error) {
    console.error('Ошибка в updatePlannedMetric:', error);
    throw error;
  }
}

/**
 * Удалить направление со всеми его планами
 */
export async function deleteUserDirection(directionId: number): Promise<void> {
  const userId = getUserId();
  if (!userId) throw new Error('User not authenticated');

  try {
    const res = await fetch(`${API_BASE_URL}/user-plans/directions/${directionId}`, {
      method: 'DELETE',
      headers: { 'x-user-id': userId },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to delete direction');
    }
  } catch (error) {
    console.error('Ошибка в deleteUserDirection:', error);
    throw error;
  }
}