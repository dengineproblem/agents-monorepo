import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

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
    // Получаем направления пользователя
    const { data: directions, error: directionsError } = await supabase
      .from('user_directions')
      .select('*')
      .eq('user_id', userId);

    if (directionsError) {

      throw new Error(`Не удалось загрузить направления: ${directionsError.message}`);
    }

    if (!directions || directions.length === 0) return [];

    // Получаем ID всех направлений
    const directionIds = directions.map(d => d.id);

    // Получаем метрики для этих направлений
    const { data: metrics, error: metricsError } = await supabase
      .from('planned_metrics')
      .select('*')
      .in('user_direction_id', directionIds);

    if (metricsError) {

      throw new Error(`Не удалось загрузить метрики: ${metricsError.message}`);
    }

    // Соединяем данные
    return directions.map(direction => {
      const directionMetrics = metrics?.filter(m => m.user_direction_id === direction.id) || [];
      const leadsMetric = directionMetrics.find(m => m.metric_type === 'leads');
      const spendMetric = directionMetrics.find(m => m.metric_type === 'spend');

      return {
        direction,
        leadsPlanned: leadsMetric?.planned_daily_value || 0,
        spendPlanned: spendMetric?.planned_daily_value || 0
      };
    });
  } catch (error) {

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
    // Сначала получаем существующие направления пользователя
    const { data: existingDirections, error: getError } = await supabase
      .from('user_directions')
      .select('id')
      .eq('user_id', userId);

    if (getError) {

      throw new Error(`Не удалось получить существующие направления: ${getError.message}`);
    }

    // Если есть существующие направления, удаляем их метрики сначала
    if (existingDirections && existingDirections.length > 0) {
      const directionIds = existingDirections.map(d => d.id);
      
      // Удаляем метрики
      const { error: deleteMetricsError } = await supabase
        .from('planned_metrics')
        .delete()
        .in('user_direction_id', directionIds);

      if (deleteMetricsError) {

        throw new Error(`Не удалось удалить старые метрики: ${deleteMetricsError.message}`);
      }

      // Теперь удаляем направления
      const { error: deleteDirectionsError } = await supabase
        .from('user_directions')
        .delete()
        .eq('user_id', userId);

      if (deleteDirectionsError) {

        throw new Error(`Не удалось удалить старые направления: ${deleteDirectionsError.message}`);
      }
    }

    // Создаем новые направления и их планы
    for (const plan of plans) {
      // 1. Создаем направление
      const { data: direction, error: directionError } = await supabase
        .from('user_directions')
        .insert({
          user_id: userId,
          main_direction: plan.mainDirection,
          sub_direction: plan.subDirection || null
        })
        .select()
        .single();

      if (directionError || !direction) {

        throw new Error(`Не удалось создать направление: ${directionError?.message}`);
      }

      // 2. Создаем метрики для этого направления



      // Создаем метрики по одной для лучшей отладки
      const { error: leadsError } = await supabase
        .from('planned_metrics')
        .insert({
          user_direction_id: direction.id,
          metric_type: 'leads',
          planned_daily_value: plan.monthlyLeadsPlan || 0
        });

      if (leadsError) {

        throw new Error(`Не удалось создать метрику лидов: ${leadsError.message}`);
      }

      const { error: spendError } = await supabase
        .from('planned_metrics')
        .insert({
          user_direction_id: direction.id,
          metric_type: 'spend',
          planned_daily_value: plan.monthlySpendPlan || 0
        });

      if (spendError) {

        throw new Error(`Не удалось создать метрику затрат: ${spendError.message}`);
      }


    }

  } catch (error) {

    throw error;
  }
}

/**
 * Обновить отдельную метрику плана
 */
export async function updatePlannedMetric(
  directionId: number,
  metricType: 'leads' | 'spend',
  value: number
): Promise<void> {
  try {
    const { error } = await supabase
      .from('planned_metrics')
      .upsert({
        user_direction_id: directionId,
        metric_type: metricType,
        planned_daily_value: value
      });

    if (error) {

      throw new Error(`Не удалось обновить метрику: ${error.message}`);
    }
  } catch (error) {

    throw error;
  }
}

/**
 * Удалить направление со всеми его планами
 */
export async function deleteUserDirection(directionId: number): Promise<void> {
  try {
    const { error } = await supabase
      .from('user_directions')
      .delete()
      .eq('id', directionId);

    if (error) {

      throw new Error(`Не удалось удалить направление: ${error.message}`);
    }
  } catch (error) {

    throw error;
  }
}