import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type UserRole = 'admin' | 'consultant' | 'manager';

export interface User {
  id: string;
  username: string;
  role: UserRole;
  is_tech_admin: boolean;
  consultantId?: string; // для роли consultant
  consultantName?: string; // имя консультанта для отображения
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  isAuthenticated: boolean;
  isConsultant: boolean;
  isAdmin: boolean;
  isManager: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Загрузить пользователя из localStorage при монтировании
  useEffect(() => {
    const loadUser = () => {
      try {
        const storedUser = localStorage.getItem('user');
        if (storedUser) {
          const parsedUser = JSON.parse(storedUser);
          setUser(parsedUser);
        }
      } catch (error) {
        console.error('Failed to load user from localStorage:', error);
        localStorage.removeItem('user');
      } finally {
        setLoading(false);
      }
    };

    loadUser();
  }, []);

  const login = async (username: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      // 1. СНАЧАЛА проверяем consultant_accounts (для консультантов)
      const { data: consultantAccount } = await supabase
        .from('consultant_accounts')
        .select('id, consultant_id, username, role')
        .eq('username', username)
        .eq('password', password)
        .maybeSingle();

      if (consultantAccount) {
        // Получить данные консультанта
        const { data: consultant, error: consultantError } = await supabase
          .from('consultants')
          .select('id, name, is_active')
          .eq('id', consultantAccount.consultant_id)
          .single();

        if (consultantError || !consultant || !consultant.is_active) {
          return {
            success: false,
            error: 'Профиль консультанта не найден или неактивен'
          };
        }

        // Сохраняем в session
        const sessionUser: User = {
          id: consultantAccount.id,  // ID из consultant_accounts
          username: consultantAccount.username,
          role: 'consultant',
          is_tech_admin: false,
          consultantId: consultant.id,
          consultantName: consultant.name,
        };

        localStorage.setItem('user', JSON.stringify(sessionUser));
        setUser(sessionUser);
        return { success: true };
      }

      // 2. Если не найдено в consultant_accounts - проверяем user_accounts (админы/менеджеры)
      const { data: userAccount, error: userError } = await supabase
        .from('user_accounts')
        .select('id, username, role, is_tech_admin')
        .eq('username', username)
        .eq('password', password)
        .maybeSingle();

      if (userError || !userAccount) {
        return { success: false, error: 'Неверный логин или пароль' };
      }

      // Определяем роль (is_tech_admin как fallback)
      const role: UserRole = userAccount.is_tech_admin
        ? 'admin'
        : (userAccount.role || 'admin');

      let consultantId: string | undefined;
      let consultantName: string | undefined;

      // Если роль consultant в user_accounts - получаем consultantId (legacy)
      if (role === 'consultant') {
        const { data: consultant, error: consultantError } = await supabase
          .from('consultants')
          .select('id, name')
          .eq('parent_user_account_id', userAccount.id)
          .eq('is_active', true)
          .maybeSingle();

        if (consultantError || !consultant) {
          return {
            success: false,
            error: 'Профиль консультанта не найден или неактивен'
          };
        }

        consultantId = consultant.id;
        consultantName = consultant.name;
      }

      const sessionUser: User = {
        id: userAccount.id,
        username: userAccount.username,
        role,
        is_tech_admin: userAccount.is_tech_admin || false,
        consultantId,
        consultantName
      };

      localStorage.setItem('user', JSON.stringify(sessionUser));
      setUser(sessionUser);

      return { success: true };
    } catch (error: any) {
      console.error('Login error:', error);
      return { success: false, error: 'Ошибка при входе' };
    }
  };

  const logout = () => {
    localStorage.removeItem('user');
    setUser(null);
  };

  const value: AuthContextType = {
    user,
    loading,
    login,
    logout,
    isAuthenticated: !!user,
    isConsultant: user?.role === 'consultant',
    isAdmin: user?.role === 'admin' || user?.is_tech_admin === true,
    isManager: user?.role === 'manager',
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
