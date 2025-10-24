import React from 'react';
import { ArrowLeft, Calendar, LogOut, Sun, Moon, RefreshCw, DollarSign, LayoutDashboard, TrendingUp, Target, Video, User } from 'lucide-react';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { Separator } from './ui/separator';
import logoPlaceholder from '@/assets/logo-placeholder.svg';
import { toast } from 'sonner';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTheme } from 'next-themes';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { useAppContext } from '../context/AppContext';
import { facebookApi } from '../services/facebookApi';
import { addDays, format } from 'date-fns';
import { useTranslation } from '../i18n/LanguageContext';
import { FEATURES } from '../config/appReview';

interface HeaderProps { 
  onOpenDatePicker: () => void;
  title?: string;
  showBack?: boolean;
  onBack?: () => void;
}

const Header: React.FC<HeaderProps> = ({ 
  onOpenDatePicker, 
  title,
  showBack = false,
  onBack
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, setTheme } = useTheme();
  const { accountStatus, accountStatusError } = useAppContext();
  const { t } = useTranslation();
  
  const statusMap: Record<number, string> = {
    1: t('budget.active'),
    2: t('budget.inactive'),
    3: t('budget.disabled'),
    7: t('budget.inactive'),
  };
  const [openBudget, setOpenBudget] = React.useState(false);
  const [dailySpend, setDailySpend] = React.useState<number | null>(null);
  const [loadingSpend, setLoadingSpend] = React.useState(false);
  const [predictedDate, setPredictedDate] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!openBudget) return;
    setLoadingSpend(true);
    facebookApi.getCurrentDailySpend()
      .then((spend) => {
        setDailySpend(spend);
        // Прогноз даты списания
        if (accountStatus && spend && accountStatus.billing_threshold && accountStatus.balance) {
          const left = Number(accountStatus.billing_threshold) - Number(accountStatus.balance);
          if (left > 0 && spend > 0) {
            const days = left / spend;
            const date = addDays(new Date(), Math.ceil(days));
            setPredictedDate(format(date, 'dd.MM.yyyy'));
          } else {
            setPredictedDate(null);
          }
        } else {
          setPredictedDate(null);
        }
      })
      .catch(() => {
        setDailySpend(null);
        setPredictedDate(null);
      })
      .finally(() => setLoadingSpend(false));
  }, [openBudget, accountStatus]);
  
  const handleSignOut = async () => {
    try {
      localStorage.removeItem('user');
      console.log('User signed out, localStorage cleared');
      
      toast.success('Вы успешно вышли из системы');
      navigate('/login');
    } catch (error) {
      console.error('Error during sign out:', error);
      toast.error('Ошибка при выходе из системы');
    }
  };

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const handleRefresh = () => {
    window.location.reload();
  };

  const allMobileNavItems = [
    { path: '/', icon: LayoutDashboard, label: t('menu.dashboard'), visible: true },
    { path: '/roi', icon: TrendingUp, label: t('menu.roi'), visible: FEATURES.SHOW_ROI_ANALYTICS },
    { path: '/creatives', icon: Target, label: t('menu.creatives'), visible: FEATURES.SHOW_CREATIVES },
    { path: '/videos', icon: Video, label: t('menu.videos'), visible: FEATURES.SHOW_VIDEOS },
    { path: '/profile', icon: User, label: t('menu.profile'), visible: true },
  ];

  const mobileNavItems = allMobileNavItems.filter(item => item.visible);

  return (
    <>
      <header className="border-b fixed top-0 left-0 right-0 z-50 bg-background w-full max-w-full overflow-x-hidden">
        <div className="px-4 py-3 flex items-center justify-between w-full max-w-full">
          <div className="flex items-center gap-3">
            {showBack && onBack ? (
              <Button variant="ghost" size="icon" onClick={onBack} className="mr-1">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            ) : null}
            {title ? (
              <h1 className="text-xl font-semibold">{title}</h1>
            ) : (
              // Логотип и название - всегда показываем
              <button 
                onClick={() => navigate('/')}
                className="flex items-center gap-2 hover:opacity-80 transition-opacity duration-200 cursor-pointer"
                title="На главную"
              >
                <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center shadow-sm overflow-hidden">
                  <img 
                    src="/logo.png"
                    alt="Performante" 
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.currentTarget.src = logoPlaceholder;
                    }}
                  />
                </div>
                <h1 className="text-xl font-semibold hidden sm:block">performante.ai</h1>
              </button>
            )}
          </div>
        
        <TooltipProvider>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={() => setOpenBudget(true)}>
                  <DollarSign className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Бюджет</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={toggleTheme}>
                  {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={onOpenDatePicker}>
                  <Calendar className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Выбрать период</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={handleRefresh}>
                  <RefreshCw className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Обновить</p>
              </TooltipContent>
            </Tooltip>

            <Separator orientation="vertical" className="h-6 mx-1" />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={handleSignOut}>
                  <LogOut className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Выйти</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>
      <Dialog open={openBudget} onOpenChange={setOpenBudget}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-green-600" />
              {t('budget.budgetInfo')}
            </DialogTitle>
            <DialogDescription>
              {t('budget.currentAccountStatus')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {accountStatus ? (
              <>
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <span className="text-sm text-muted-foreground">{t('budget.accountStatus')}</span>
                  <span className="font-semibold">{statusMap[Number(accountStatus.account_status)] || accountStatus.account_status}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <span className="text-sm text-muted-foreground">{t('budget.toBeCharged')}</span>
                  <span className="font-semibold text-green-600">
                    {accountStatus.balance !== undefined ? `$${(Number(accountStatus.balance) / 100).toFixed(2)}` : '—'}
                  </span>
                </div>
              </>
            ) : (
              <div className="text-center p-4 text-muted-foreground">
                Нет данных по бюджету
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </header>
    
    {/* Мобильная навигация - только на мобилке */}
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-background border-t w-full max-w-full overflow-x-hidden">
      <div className="flex items-center justify-around px-2 py-2 w-full max-w-full">
        {mobileNavItems.map((item) => (
          <Button
            key={item.path}
            variant="ghost"
            size="sm"
            onClick={() => navigate(item.path)}
            className={`flex flex-col items-center gap-1 h-auto py-2 ${
              location.pathname === item.path ? 'text-primary' : 'text-muted-foreground'
            }`}
          >
            <item.icon className="h-5 w-5" />
            <span className="text-xs">{item.label}</span>
          </Button>
        ))}
      </div>
    </nav>
    </>
  );
};

export default Header;
