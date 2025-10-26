import { useEffect, useState, useCallback } from 'react';
import { creativesApi, UserCreative, CreativeTestStatus } from '@/services/creativesApi';

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

