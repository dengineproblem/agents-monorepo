import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

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
      const response = await fetch('/api/crm/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error || 'Неверный логин или пароль' };
      }

      const sessionUser: User = {
        id: data.id,
        username: data.username,
        role: data.role as UserRole,
        is_tech_admin: data.is_tech_admin || false,
        consultantId: data.consultantId,
        consultantName: data.consultantName,
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
