import { useEffect, useState, useCallback } from 'react';
import { creativesApi, UserCreative, CreativeTestStatus } from '@/services/creativesApi';
import { supabase } from '@/integrations/supabase/client';

export const useUserCreatives = () => {
  const [items, setItems] = useState<UserCreative[]>([]);
  const [loading, setLoading] = useState(false);
  const [testStatuses, setTestStatuses] = useState<Record<string, CreativeTestStatus>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const data = await creativesApi.list();
    setItems(data);
    
    // Загружаем статусы тестов для всех креативов
    if (data.length > 0) {
      const creativeIds = data.map(c => c.id);
      const statuses = await creativesApi.getCreativeTestStatuses(creativeIds);
      setTestStatuses(statuses);
    }
    
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Realtime подписка на изменения статусов тестов
  useEffect(() => {
    // Получаем user_id из localStorage
    const storedUser = localStorage.getItem('user');
    if (!storedUser) {
      console.warn('[useUserCreatives] User not found in localStorage, skipping realtime subscription');
      return;
    }

    const userData = JSON.parse(storedUser);
    const userId = userData.id;

    if (!userId) {
      console.warn('[useUserCreatives] User ID not found, skipping realtime subscription');
      return;
    }

    console.log('[useUserCreatives] Setting up Realtime subscription for user:', userId);

    // Создаём подписку на таблицу creative_tests
    const channel = supabase
      .channel('creative_tests_changes')
      .on(
        'postgres_changes',
        {
          event: '*', // Слушаем все события: INSERT, UPDATE, DELETE
          schema: 'public',
          table: 'creative_tests',
          filter: `user_id=eq.${userId}`, // Только тесты текущего пользователя
        },
        (payload) => {
          console.log('[useUserCreatives] Received realtime update:', payload);

          const { eventType, new: newRecord, old: oldRecord } = payload;

          if (eventType === 'INSERT' || eventType === 'UPDATE') {
            // Обновляем или добавляем статус теста
            const test = newRecord as any;
            const creativeId = test.user_creative_id;

            setTestStatuses((prev) => ({
              ...prev,
              [creativeId]: {
                status: test.status,
                started_at: test.started_at,
                completed_at: test.completed_at,
                impressions: test.impressions || 0,
              },
            }));

            console.log('[useUserCreatives] Updated test status for creative:', creativeId, test.status);
          } else if (eventType === 'DELETE') {
            // Удаляем статус теста
            const test = oldRecord as any;
            const creativeId = test.user_creative_id;

            setTestStatuses((prev) => {
              const newStatuses = { ...prev };
              delete newStatuses[creativeId];
              return newStatuses;
            });

            console.log('[useUserCreatives] Deleted test status for creative:', creativeId);
          }
        }
      )
      .subscribe((status) => {
        console.log('[useUserCreatives] Subscription status:', status);
      });

    // Cleanup при размонтировании
    return () => {
      console.log('[useUserCreatives] Cleaning up Realtime subscription');
      supabase.removeChannel(channel);
    };
  }, []); // Пустой массив зависимостей - подписка создаётся один раз

  const toggleActive = async (id: string, active: boolean) => {
    const ok = await creativesApi.toggleActive(id, active);
    if (ok) {
      setItems(prev => prev.map(i => i.id === id ? { ...i, is_active: active } : i));
    }
  };

  return {
    items,
    loading,
    reload: load,
    toggleActive,
    testStatuses,
  };
};

