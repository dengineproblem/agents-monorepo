/**
 * Admin Route Protection
 *
 * Компонент для защиты админских роутов.
 * Проверяет is_tech_admin в localStorage и редиректит на главную если нет доступа.
 *
 * @module components/AdminRoute
 */

import React from 'react';
import { Navigate } from 'react-router-dom';

interface AdminRouteProps {
  children: React.ReactNode;
}

/**
 * Проверяет, является ли текущий пользователь техадмином
 */
export const isUserAdmin = (): boolean => {
  try {
    const storedUser = localStorage.getItem('user');
    if (!storedUser) return false;

    const user = JSON.parse(storedUser);
    return user.is_tech_admin === true;
  } catch {
    return false;
  }
};

/**
 * Обёртка для защиты админских роутов
 * Редиректит на / если пользователь не техадмин
 */
const AdminRoute: React.FC<AdminRouteProps> = ({ children }) => {
  if (!isUserAdmin()) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

export default AdminRoute;
