import { useEffect, useState, useCallback } from 'react';
import { creativesApi, UserCreative } from '@/services/creativesApi';

export const useUserCreatives = () => {
  const [items, setItems] = useState<UserCreative[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await creativesApi.list();
    setItems(data);
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
  };
};

