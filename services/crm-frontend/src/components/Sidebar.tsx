import { MessageSquare, Send, ChevronLeft, ChevronRight, ChevronDown, Calendar, Cpu, Users, Settings, BarChart3 } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';

interface NavItem {
  path: string;
  icon: React.ElementType;
  label: string;
  children?: { path: string; icon: React.ElementType; label: string }[];
}

export function Sidebar() {
  const location = useLocation();
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebar-collapsed');
    return saved === 'true';
  });
  const [expandedItems, setExpandedItems] = useState<string[]>(() => {
    // Auto-expand if we're on a child route
    if (location.pathname.startsWith('/consultations')) {
      return ['/consultations'];
    }
    return [];
  });

  const navItems: NavItem[] = [
    { path: '/', icon: MessageSquare, label: 'CRM' },
    {
      path: '/consultations',
      icon: Calendar,
      label: 'Консультации',
      children: [
        { path: '/consultations', icon: Calendar, label: 'Календарь' },
        { path: '/consultations/consultants', icon: Users, label: 'Консультанты' },
        { path: '/consultations/services', icon: Settings, label: 'Услуги' },
        { path: '/consultations/analytics', icon: BarChart3, label: 'Аналитика' },
      ]
    },
    { path: '/bots', icon: Cpu, label: 'AI-боты' },
    { path: '/reactivation', icon: Send, label: 'Рассылки' }
  ];

  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', String(isCollapsed));
  }, [isCollapsed]);

  // Auto-expand parent when navigating to child
  useEffect(() => {
    if (location.pathname.startsWith('/consultations') && !expandedItems.includes('/consultations')) {
      setExpandedItems(prev => [...prev, '/consultations']);
    }
  }, [location.pathname]);

  const toggleSidebar = () => {
    setIsCollapsed(!isCollapsed);
  };

  const toggleExpanded = (path: string) => {
    setExpandedItems(prev =>
      prev.includes(path)
        ? prev.filter(p => p !== path)
        : [...prev, path]
    );
  };

  const isActive = (path: string) => {
    if (path === '/consultations') {
      return location.pathname === '/consultations';
    }
    return location.pathname === path;
  };

  const isParentActive = (item: NavItem) => {
    if (!item.children) return false;
    return location.pathname.startsWith(item.path);
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
      <nav className="space-y-1">
        {navItems.map((item) => {
          const { path, icon: Icon, label, children } = item;
          const hasChildren = children && children.length > 0;
          const isExpanded = expandedItems.includes(path);
          const parentActive = isParentActive(item);

          if (hasChildren) {
            return (
              <div key={path}>
                <button
                  onClick={() => toggleExpanded(path)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                    parentActive
                      ? 'bg-accent'
                      : 'hover:bg-accent/50'
                  }`}
                  title={isCollapsed ? label : undefined}
                >
                  <Icon className="w-5 h-5 flex-shrink-0" />
                  {!isCollapsed && (
                    <>
                      <span className="font-medium flex-1 text-left">{label}</span>
                      <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </>
                  )}
                </button>

                {!isCollapsed && isExpanded && (
                  <div className="ml-4 mt-1 space-y-1 border-l-2 border-border pl-2">
                    {children.map(({ path: childPath, icon: ChildIcon, label: childLabel }) => (
                      <Link
                        key={childPath}
                        to={childPath}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all text-sm ${
                          isActive(childPath)
                            ? 'bg-accent/70 text-foreground'
                            : 'text-muted-foreground hover:bg-accent/30 hover:text-foreground'
                        }`}
                      >
                        <ChildIcon className="w-4 h-4 flex-shrink-0" />
                        <span>{childLabel}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          }

          return (
            <Link
              key={path}
              to={path}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                isActive(path)
                  ? 'bg-accent'
                  : 'hover:bg-accent/50'
              }`}
              title={isCollapsed ? label : undefined}
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              {!isCollapsed && <span className="font-medium">{label}</span>}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
