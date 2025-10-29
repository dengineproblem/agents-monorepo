import { useState, useEffect, useCallback } from 'react';
import { whatsappApi, WhatsAppNumber } from '@/services/whatsappApi';

export const useWhatsAppNumbers = (userAccountId: string | null) => {
  const [numbers, setNumbers] = useState<WhatsAppNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadNumbers = useCallback(async () => {
    if (!userAccountId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const data = await whatsappApi.getNumbers(userAccountId);
      setNumbers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load numbers');
      console.error('Error loading WhatsApp numbers:', err);
    } finally {
      setLoading(false);
    }
  }, [userAccountId]);

  useEffect(() => {
    loadNumbers();
  }, [loadNumbers]);

  return {
    numbers,
    loading,
    error,
    refresh: loadNumbers,
  };
};
