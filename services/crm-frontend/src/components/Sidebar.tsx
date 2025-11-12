import { MessageSquare, Bot, Send } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

export function Sidebar() {
  const location = useLocation();
  
  const navItems = [
    { path: '/', icon: MessageSquare, label: 'CRM' },
    { path: '/chatbot', icon: Bot, label: 'Настройки бота' },
    { path: '/reactivation', icon: Send, label: 'Рассылки' }
  ];
  
  return (
    <aside className="w-64 bg-slate-900 text-white p-4">
      <h1 className="text-xl font-bold mb-8">WhatsApp CRM</h1>
      <nav className="space-y-2">
        {navItems.map(({ path, icon: Icon, label }) => (
          <Link
            key={path}
            to={path}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-slate-800 transition-colors ${
              location.pathname === path ? 'bg-slate-800' : ''
            }`}
          >
            <Icon className="w-5 h-5" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}



