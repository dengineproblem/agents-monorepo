import { toastT } from '@/utils/toastUtils';
import React from 'react';
import { ArrowLeft, Calendar, LogOut, Sun, Moon, RefreshCw, DollarSign, LayoutDashboard, TrendingUp, Target, Upload, User, CheckCircle, Users2, HelpCircle, MoreVertical } from 'lucide-react';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { Separator } from './ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
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
import { supabase } from '../integrations/supabase/client';
import { appReviewText } from '@/utils/appReviewText';
import { AdAccountSwitcher } from './ad-accounts/AdAccountSwitcher';
import NotificationBell from './NotificationBell';

interface HeaderProps { 
  onOpenDatePicker: () => void;
  title?: string;
  showBack?: boolean;
  onBack?: () => void;
  onRefresh?: () => void; // Пользовательская функция обновления (опционально)
}

const Header: React.FC<HeaderProps> = ({ 
  onOpenDatePicker, 
  title,
  showBack = false,
  onBack,
  onRefresh
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
  
  // Facebook validation state
  const [openValidation, setOpenValidation] = React.useState(false);
  const [isValidating, setIsValidating] = React.useState(false);
  const [validationResult, setValidationResult] = React.useState<{
    success: boolean;
    checks?: {
      token?: boolean;
      adAccount?: boolean;
      page?: boolean;
      campaign?: boolean;
      pageDetails?: {
        name?: string;
        link?: string;
        instagram?: {
          id?: string;
          username?: string;
        } | null;
      } | null;
    };
    error?: string;
    details?: string;
  } | null>(null);

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
      // Очищаем флаг посещения Dashboard для корректного редиректа при следующем логине
      sessionStorage.removeItem('hasVisitedDashboard');
      console.log('User signed out, localStorage and sessionStorage cleared');

      toastT.success('loggedOut');
      navigate('/login');
    } catch (error) {
      console.error('Error during sign out:', error);
      toastT.error('logoutError');
    }
  };

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const handleRefresh = () => {
    if (onRefresh) {
      // Если передана пользовательская функция обновления, используем её
      onRefresh();
    } else {
      // Иначе перезагружаем всю страницу
      window.location.reload();
    }
  };

  const handleValidateFacebook = async () => {
    setOpenValidation(true);
    setIsValidating(true);
    setValidationResult(null);

    try {
      // Загружаем данные пользователя из localStorage
      const storedUser = localStorage.getItem('user');
      if (!storedUser) {
        setValidationResult({
          success: false,
          error: appReviewText('User not authorized', 'Пользователь не авторизован'),
          details: appReviewText('No user data found in the system', 'Не найдены данные пользователя в системе')
        });
        setIsValidating(false);
        return;
      }

      const userData = JSON.parse(storedUser);
      if (!userData.id) {
        setValidationResult({
          success: false,
          error: appReviewText('Missing user ID', 'Отсутствует ID пользователя'),
          details: appReviewText('Unable to load account data', 'Невозможно загрузить данные учетной записи')
        });
        setIsValidating(false);
        return;
      }

      // Запрашиваем актуальные данные из user_accounts (без токенов)
      const { data: userAccount, error: dbError } = await supabase
        .from('user_accounts')
        .select('ad_account_id, page_id, instagram_id')
        .eq('id', userData.id)
        .single();

      if (dbError || !userAccount) {
        setValidationResult({
          success: false,
          error: appReviewText('Failed to load data', 'Ошибка загрузки данных'),
          details: dbError?.message || appReviewText('Unable to load account data', 'Не удалось загрузить данные учетной записи')
        });
        setIsValidating(false);
        return;
      }

      if (!userAccount.ad_account_id) {
        setValidationResult({
          success: false,
          error: appReviewText('Ad account not selected', 'Не выбран рекламный кабинет'),
          details: appReviewText('Select an ad account in the profile.', 'Выберите рекламный кабинет в профиле.')
        });
        setIsValidating(false);
        return;
      }

      // Вызываем backend endpoint /facebook/validate (бэкенд сам возьмёт токен из БД)
      const apiBaseUrl = import.meta.env.VITE_API_BASE_URL
        || (import.meta.env.DEV ? 'http://localhost:8082' : 'https://app.performanteaiagency.com/api');
      const response = await fetch(`${apiBaseUrl}/facebook/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userData.id,
        },
        body: JSON.stringify({
          adAccountId: userAccount.ad_account_id,
          pageId: userAccount.page_id,
        })
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('Facebook validation HTTP error:', data);
        setValidationResult({
          success: false,
          error: appReviewText('Connection error', 'Ошибка соединения'),
          details: data.error || appReviewText('Failed to connect to Facebook', 'Не удалось подключиться к Facebook')
        });
        setIsValidating(false);
        return;
      }

      // Всегда устанавливаем полный ответ от сервера (даже если success: false)
      console.log('Facebook validation result:', data);
      setValidationResult(data);
    } catch (error: any) {
      console.error('Unexpected error during Facebook validation:', error);
      setValidationResult({
        success: false,
        error: appReviewText('Unexpected error', 'Неожиданная ошибка'),
        details: error.message || appReviewText('An unexpected error occurred', 'Произошла непредвиденная ошибка')
      });
    } finally {
      setIsValidating(false);
    }
  };

  const allMobileNavItems = [
    { path: '/', icon: LayoutDashboard, label: t('menu.dashboard'), visible: true },
    { path: '/roi', icon: TrendingUp, label: t('menu.roiShort'), visible: FEATURES.SHOW_ROI_ANALYTICS },
    { path: '/creatives', icon: Target, label: t('menu.creativesShort'), visible: FEATURES.SHOW_CREATIVES },
    { path: '/videos', icon: Upload, label: t('menu.videosShort'), visible: FEATURES.SHOW_VIDEOS },
    { path: '/competitors', icon: Users2, label: t('menu.competitors'), visible: FEATURES.SHOW_COMPETITORS },
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
                title={appReviewText('Go to dashboard', 'На главную')}
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

            {/* Ad Account Switcher - полная версия на десктопе, компактная на мобилке */}
            {location.pathname !== '/dashboard' && (
              <>
                {/* Десктоп версия */}
                <AdAccountSwitcher className="hidden sm:flex ml-4" />
                {/* Мобильная компактная версия */}
                <AdAccountSwitcher className="flex sm:hidden ml-2" compact showAddButton={false} />
              </>
            )}
          </div>
        
        <TooltipProvider>
          <div className="flex items-center gap-1">
            {/* Notification Bell - всегда видно */}
            <NotificationBell />

            {/* Основные кнопки - скрыты на мобилке */}
            <div className="hidden sm:flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={handleValidateFacebook}>
                    <CheckCircle className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{appReviewText('Validate Facebook', 'Проверить Facebook')}</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={() => setOpenBudget(true)}>
                    <DollarSign className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{appReviewText('Budget', 'Бюджет')}</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={toggleTheme}>
                    {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    {theme === 'dark'
                      ? appReviewText('Light theme', 'Светлая тема')
                      : appReviewText('Dark theme', 'Тёмная тема')}
                  </p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={onOpenDatePicker}>
                    <Calendar className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{appReviewText('Select period', 'Выбрать период')}</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={handleRefresh}>
                    <RefreshCw className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{appReviewText('Refresh', 'Обновить')}</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={() => navigate('/knowledge-base')}>
                    <HelpCircle className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{appReviewText('Help', 'База знаний')}</p>
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
                  <p>{appReviewText('Log out', 'Выйти')}</p>
                </TooltipContent>
              </Tooltip>
            </div>

            {/* Мобильное меню - видно только на мобилке */}
            <div className="flex sm:hidden items-center gap-1">
              {/* Календарь - всегда видно на мобилке */}
              <Button variant="ghost" size="icon" onClick={onOpenDatePicker}>
                <Calendar className="h-5 w-5" />
              </Button>

              {/* Обновить - всегда видно на мобилке */}
              <Button variant="ghost" size="icon" onClick={handleRefresh}>
                <RefreshCw className="h-5 w-5" />
              </Button>

              {/* Dropdown с остальными опциями */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <MoreVertical className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={handleValidateFacebook}>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    {appReviewText('Validate Facebook', 'Проверить Facebook')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setOpenBudget(true)}>
                    <DollarSign className="h-4 w-4 mr-2" />
                    {appReviewText('Budget', 'Бюджет')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={toggleTheme}>
                    {theme === 'dark' ? <Sun className="h-4 w-4 mr-2" /> : <Moon className="h-4 w-4 mr-2" />}
                    {theme === 'dark'
                      ? appReviewText('Light theme', 'Светлая тема')
                      : appReviewText('Dark theme', 'Тёмная тема')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/knowledge-base')}>
                    <HelpCircle className="h-4 w-4 mr-2" />
                    {appReviewText('Help', 'База знаний')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSignOut} className="text-red-600">
                    <LogOut className="h-4 w-4 mr-2" />
                    {appReviewText('Log out', 'Выйти')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
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
                {appReviewText('No budget data', 'Нет данных по бюджету')}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={openValidation} onOpenChange={setOpenValidation}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-blue-600" />
              {appReviewText('Facebook validation', 'Проверка Facebook')}
            </DialogTitle>
            <DialogDescription>
              {appReviewText('Validating the Facebook connection', 'Валидация подключения к Facebook')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {isValidating ? (
              <div className="flex flex-col items-center justify-center p-8 space-y-4">
                <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">{appReviewText('Checking connection...', 'Проверяем подключение...')}</p>
              </div>
            ) : validationResult ? (
              <>
                {validationResult.success ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                      <CheckCircle className="h-5 w-5 text-green-600" />
                      <span className="font-semibold text-green-900 dark:text-green-100">
                        {appReviewText('All checks passed successfully', 'Все проверки пройдены успешно')}
                      </span>
                    </div>
                    {validationResult.checks && (
                      <div className="space-y-2">
                        {validationResult.checks.token && (
                          <div className="flex items-center gap-2 p-2 rounded bg-muted/50">
                            <CheckCircle className="h-4 w-4 text-green-600" />
                            <span className="text-sm">{appReviewText('Token valid', 'Токен валиден')}</span>
                          </div>
                        )}
                        {validationResult.checks.adAccount && (
                          <div className="flex items-center gap-2 p-2 rounded bg-muted/50">
                            <CheckCircle className="h-4 w-4 text-green-600" />
                            <span className="text-sm">{appReviewText('Ad account access confirmed', 'Доступ к рекламному кабинету')}</span>
                          </div>
                        )}
                        {validationResult.checks.page && (
                          <div className="flex items-center gap-2 p-2 rounded bg-muted/50">
                            <CheckCircle className="h-4 w-4 text-green-600" />
                            <span className="text-sm">{appReviewText('Page access confirmed', 'Доступ к странице')}</span>
                          </div>
                        )}
                        {validationResult.checks.campaign && (
                          <div className="flex items-center gap-2 p-2 rounded bg-muted/50">
                            <CheckCircle className="h-4 w-4 text-green-600" />
                            <span className="text-sm">{appReviewText('Test campaign created', 'Тестовая кампания создана')}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Page Details - uses pages_read_engagement permission */}
                    {validationResult.checks?.pageDetails && (
                      <div className="mt-4 p-4 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20">
                        <p className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-3">
                          {appReviewText('Facebook Page Details', 'Детали Facebook Page')}
                        </p>
                        <div className="space-y-2">
                          {validationResult.checks.pageDetails.name && (
                            <div className="flex items-start gap-2">
                              <span className="text-xs text-blue-700 dark:text-blue-300 min-w-[60px]">
                                {appReviewText('Page:', 'Страница:')}
                              </span>
                              <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
                                {validationResult.checks.pageDetails.name}
                              </span>
                            </div>
                          )}
                          {validationResult.checks.pageDetails.link && (
                            <div className="flex items-start gap-2">
                              <span className="text-xs text-blue-700 dark:text-blue-300 min-w-[60px]">
                                {appReviewText('Link:', 'Ссылка:')}
                              </span>
                              <a
                                href={validationResult.checks.pageDetails.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                              >
                                {appReviewText('View on Facebook', 'Открыть в Facebook')}
                              </a>
                            </div>
                          )}
                          {validationResult.checks.pageDetails.instagram && (
                            <div className="flex items-start gap-2">
                              <span className="text-xs text-blue-700 dark:text-blue-300 min-w-[60px]">
                                {appReviewText('Instagram:', 'Instagram:')}
                              </span>
                              <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
                                @{validationResult.checks.pageDetails.instagram.username || validationResult.checks.pageDetails.instagram.id}
                              </span>
                            </div>
                          )}
                        </div>
                        <p className="text-xs text-blue-600 dark:text-blue-400 mt-3 italic">
                          {appReviewText(
                            '✓ Retrieved using pages_read_engagement permission',
                            '✓ Получено через разрешение pages_read_engagement'
                          )}
                        </p>
                      </div>
                    )}

                    {/* Directions Validation */}
                    {validationResult.checks?.directions && validationResult.checks.directions.length > 0 && (
                      <div className="mt-4 p-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/20">
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
                          {appReviewText('Directions Validation', 'Проверка направлений')}
                        </p>
                        <div className="space-y-2">
                          {validationResult.checks.directions.map((dir: any) => (
                            <div key={dir.id} className="flex items-start gap-2 p-2 rounded bg-white dark:bg-gray-800 border">
                              {dir.success ? (
                                <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                              ) : (
                                <svg className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                  {dir.name}
                                  <span className="ml-2 text-xs text-gray-500">({dir.objective})</span>
                                </p>
                                {!dir.success && dir.error && (
                                  <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                                    {dir.errorDetails || dir.error}
                                  </p>
                                )}
                                {!dir.success && dir.errorSubcode === 2446885 && (
                                  <a
                                    href="https://business.facebook.com/wa/manage/phone-numbers/"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline mt-1 inline-block"
                                  >
                                    {appReviewText('→ Configure WhatsApp Business', '→ Настроить WhatsApp Business')}
                                  </a>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                      <svg className="h-5 w-5 text-red-600 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      <div className="flex-1">
                        <p className="font-semibold text-red-900 dark:text-red-100">
                          {validationResult.error || appReviewText('Validation error', 'Ошибка проверки')}
                        </p>
                        {validationResult.details && (
                          <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                            {validationResult.details}
                          </p>
                        )}
                      </div>
                    </div>
                    {validationResult.checks && (
                      <>
                      <div className="space-y-2">
                        <p className="text-sm font-medium">{appReviewText('Check statuses:', 'Статус проверок:')}</p>
                        {validationResult.checks.token !== undefined && (
                          <div className="flex items-center gap-2 p-2 rounded bg-muted/50">
                            {validationResult.checks.token ? (
                              <CheckCircle className="h-4 w-4 text-green-600" />
                            ) : (
                              <svg className="h-4 w-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            )}
                            <span className="text-sm">{appReviewText('Token', 'Токен')}</span>
                          </div>
                        )}
                        {validationResult.checks.adAccount !== undefined && (
                          <div className="flex items-center gap-2 p-2 rounded bg-muted/50">
                            {validationResult.checks.adAccount ? (
                              <CheckCircle className="h-4 w-4 text-green-600" />
                            ) : (
                              <svg className="h-4 w-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            )}
                            <span className="text-sm">{appReviewText('Ad account', 'Рекламный кабинет')}</span>
                          </div>
                        )}
                        {validationResult.checks.page !== undefined && (
                          <div className="flex items-center gap-2 p-2 rounded bg-muted/50">
                            {validationResult.checks.page ? (
                              <CheckCircle className="h-4 w-4 text-green-600" />
                            ) : (
                              <svg className="h-4 w-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            )}
                            <span className="text-sm">{appReviewText('Page', 'Страница')}</span>
                          </div>
                        )}
                      </div>

                    {/* Page Details - uses pages_read_engagement permission */}
                    {validationResult.checks?.pageDetails && (
                      <div className="mt-4 p-4 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20">
                        <p className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-3">
                          {appReviewText('Facebook Page Details', 'Детали Facebook Page')}
                        </p>
                        <div className="space-y-2">
                          {validationResult.checks.pageDetails.name && (
                            <div className="flex items-start gap-2">
                              <span className="text-xs text-blue-700 dark:text-blue-300 min-w-[60px]">
                                {appReviewText('Page:', 'Страница:')}
                              </span>
                              <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
                                {validationResult.checks.pageDetails.name}
                              </span>
                            </div>
                          )}
                          {validationResult.checks.pageDetails.link && (
                            <div className="flex items-start gap-2">
                              <span className="text-xs text-blue-700 dark:text-blue-300 min-w-[60px]">
                                {appReviewText('Link:', 'Ссылка:')}
                              </span>
                              <a
                                href={validationResult.checks.pageDetails.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                              >
                                {appReviewText('View on Facebook', 'Открыть в Facebook')}
                              </a>
                            </div>
                          )}
                          {validationResult.checks.pageDetails.instagram && (
                            <div className="flex items-start gap-2">
                              <span className="text-xs text-blue-700 dark:text-blue-300 min-w-[60px]">
                                {appReviewText('Instagram:', 'Instagram:')}
                              </span>
                              <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
                                @{validationResult.checks.pageDetails.instagram.username || validationResult.checks.pageDetails.instagram.id}
                              </span>
                            </div>
                          )}
                        </div>
                        <p className="text-xs text-blue-600 dark:text-blue-400 mt-3 italic">
                          {appReviewText(
                            '✓ Retrieved using pages_read_engagement permission',
                            '✓ Получено через разрешение pages_read_engagement'
                          )}
                        </p>
                      </div>
                    )}

                    {/* Directions Validation */}
                    {validationResult.checks?.directions && validationResult.checks.directions.length > 0 && (
                      <div className="mt-4 p-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/20">
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
                          {appReviewText('Directions Validation', 'Проверка направлений')}
                        </p>
                        <div className="space-y-2">
                          {validationResult.checks.directions.map((dir: any) => (
                            <div key={dir.id} className="flex items-start gap-2 p-2 rounded bg-white dark:bg-gray-800 border">
                              {dir.success ? (
                                <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                              ) : (
                                <svg className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                  {dir.name}
                                  <span className="ml-2 text-xs text-gray-500">({dir.objective})</span>
                                </p>
                                {!dir.success && (
                                  <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                                    {dir.errorDetails || dir.error}
                                  </p>
                                )}
                                {!dir.success && dir.errorSubcode === 2446885 && (
                                  <a
                                    href="https://business.facebook.com/wa/manage/phone-numbers/"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline mt-1 inline-block"
                                  >
                                    {appReviewText('→ Configure WhatsApp Business', '→ Настроить WhatsApp Business')}
                                  </a>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    </>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="text-center p-4 text-muted-foreground">
                {appReviewText('Press the button to start validation', 'Нажмите кнопку для запуска проверки')}
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
            <span className="text-xs hidden sm:inline">{item.label}</span>
          </Button>
        ))}
      </div>
    </nav>
    </>
  );
};

export default Header;
