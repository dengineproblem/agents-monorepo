import { MessageSquare, Bot, Send, ChevronLeft, ChevronRight, Cpu } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';

export function Sidebar() {
  const location = useLocation();
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebar-collapsed');
    return saved === 'true';
  });
  
  const navItems = [
    { path: '/', icon: MessageSquare, label: 'CRM' },
    { path: '/bots', icon: Cpu, label: 'AI-боты' },
    { path: '/chatbot', icon: Bot, label: 'Настройки бота' },
    { path: '/reactivation', icon: Send, label: 'Рассылки' }
  ];
  
  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', String(isCollapsed));
  }, [isCollapsed]);
  
  const toggleSidebar = () => {
    setIsCollapsed(!isCollapsed);
  };
  
  return (
    <aside 
      className={`bg-sidebar text-sidebar-foreground p-4 transition-all duration-300 ease-in-out relative border-r ${
        isCollapsed ? 'w-20' : 'w-64'
      }`}
    >
      {/* Toggle Button */}
      <button
        onClick={toggleSidebar}
        className="absolute -right-3 top-8 bg-background hover:bg-accent rounded-full p-1.5 border-2 transition-all shadow-md z-10"
        aria-label={isCollapsed ? 'Развернуть меню' : 'Свернуть меню'}
      >
        {isCollapsed ? (
          <ChevronRight className="w-4 h-4" />
        ) : (
          <ChevronLeft className="w-4 h-4" />
        )}
      </button>

      {/* Logo/Title */}
      <div className="mb-8 overflow-hidden">
        {isCollapsed ? (
          <div className="text-2xl font-bold text-center">🔥</div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-2xl">🔥</span>
            <h1 className="text-xl font-bold text-primary">
              HotLeads
            </h1>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="space-y-2">
        {navItems.map(({ path, icon: Icon, label }) => (
          <Link
            key={path}
            to={path}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
              location.pathname === path 
                ? 'bg-accent' 
                : 'hover:bg-accent/50'
            }`}
            title={isCollapsed ? label : undefined}
          >
            <Icon className="w-5 h-5 flex-shrink-0" />
            {!isCollapsed && <span className="font-medium">{label}</span>}
          </Link>
        ))}
      </nav>
    </aside>
  );
}



