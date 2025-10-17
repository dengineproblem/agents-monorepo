import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Menu, X, LayoutDashboard, Target, TrendingUp, Video, User } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';

const Sidebar: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const menuItems = [
    {
      path: '/',
      label: 'Главная',
      icon: <LayoutDashboard className="h-5 w-5" />,
    },
    {
      path: '/roi',
      label: 'ROI',
      icon: <TrendingUp className="h-5 w-5" />,
    },
    {
      path: '/creatives',
      label: 'Креативы',
      icon: <Target className="h-5 w-5" />,
    },
    {
      path: '/videos',
      label: 'Видео',
      icon: <Video className="h-5 w-5" />,
    },
    {
      path: '/profile',
      label: 'Личный кабинет',
      icon: <User className="h-5 w-5" />,
    },
  ];

  const handleNavigate = (path: string) => {
    navigate(path);
    setIsOpen(false);
  };

  return (
    <>
      {/* Кнопка бургера */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setIsOpen(!isOpen)}
        className="z-50"
      >
        {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </Button>

      {/* Оверлей */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 transition-opacity"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Боковое меню */}
      <div
        className={cn(
          'fixed top-0 left-0 h-full w-64 bg-card border-r shadow-lg z-50 transition-transform duration-300 ease-in-out',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex flex-col h-full">
          {/* Заголовок */}
          <div className="p-4 border-b">
            <h2 className="text-lg font-semibold">Навигация</h2>
          </div>

          {/* Пункты меню */}
          <nav className="flex-1 overflow-y-auto p-2">
            <div className="space-y-1">
              {menuItems.map((item) => (
                <button
                  key={item.path}
                  onClick={() => handleNavigate(item.path)}
                  className={cn(
                    'w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-all duration-200',
                    location.pathname === item.path
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  )}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </nav>

          {/* Футер */}
          <div className="p-4 border-t">
            <p className="text-xs text-muted-foreground text-center">
              CRM для таргетологов
            </p>
          </div>
        </div>
      </div>
    </>
  );
};

export default Sidebar;

