import { useState, useEffect, useCallback } from 'react';
import { directionsApi } from '@/services/directionsApi';
import type { Direction, CreateDirectionPayload, UpdateDirectionPayload } from '@/types/direction';

export const useDirections = (userAccountId: string | null) => {
  const [directions, setDirections] = useState<Direction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Загрузка направлений
  const loadDirections = useCallback(async () => {
    if (!userAccountId) {
      setDirections([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await directionsApi.list(userAccountId);
      setDirections(data);
    } catch (err) {
      console.error('Ошибка при загрузке направлений:', err);
      setError('Не удалось загрузить направления');
    } finally {
      setLoading(false);
    }
  }, [userAccountId]);

  // Создание направления
  const createDirection = useCallback(
    async (payload: Omit<CreateDirectionPayload, 'userAccountId'>) => {
      if (!userAccountId) {
        return { success: false, error: 'User account ID отсутствует' };
      }

      const result = await directionsApi.create({
        ...payload,
        userAccountId,
      });

      if (result.success) {
        await loadDirections();
      }

      return result;
    },
    [userAccountId, loadDirections]
  );

  // Обновление направления
  const updateDirection = useCallback(
    async (id: string, payload: UpdateDirectionPayload) => {
      const result = await directionsApi.update(id, payload);

      if (result.success) {
        await loadDirections();
      }

      return result;
    },
    [loadDirections]
  );

  // Удаление направления
  const deleteDirection = useCallback(
    async (id: string) => {
      const result = await directionsApi.delete(id);

      if (result.success) {
        await loadDirections();
      }

      return result;
    },
    [loadDirections]
  );

  // Загружаем направления при монтировании
  useEffect(() => {
    loadDirections();
  }, [loadDirections]);

  return {
    directions,
    loading,
    error,
    reload: loadDirections,
    createDirection,
    updateDirection,
    deleteDirection,
  };
};

