import { useState, useEffect } from 'react';

interface UserAccount {
  id: string;
  username?: string;
  telegram_id?: string;
  [key: string]: unknown;
}

interface UseUserAccountsResult {
  currentAccount: UserAccount | null;
  loading: boolean;
}

export function useUserAccounts(): UseUserAccountsResult {
  const [currentAccount, setCurrentAccount] = useState<UserAccount | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadAccount = () => {
      try {
        const storedUser = localStorage.getItem('user');
        if (storedUser) {
          const userData = JSON.parse(storedUser);
          setCurrentAccount(userData);
        } else {
          setCurrentAccount(null);
        }
      } catch (e) {
        console.error('Error loading user account:', e);
        setCurrentAccount(null);
      } finally {
        setLoading(false);
      }
    };

    loadAccount();

    // Слушаем изменения в localStorage
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'user') {
        loadAccount();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  return { currentAccount, loading };
}
