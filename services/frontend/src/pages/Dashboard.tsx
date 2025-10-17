import React, { useState, useEffect, useMemo } from 'react';
import Header from '../components/Header';
import SummaryStats from '../components/SummaryStats';
import CampaignList from '../components/CampaignList';
import DateRangePicker from '../components/DateRangePicker';
import DirectionsTable from '../components/DirectionsTable';
import MonthlyPlanFact from '../components/MonthlyPlanFact';
import TargetologJournal from '../components/TargetologJournal';
import DashboardHero from '../components/dashboard/DashboardHero';

import { VideoUpload } from '../components/VideoUpload';
import { useAppContext } from '../context/AppContext';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Bot, ChevronDown, Instagram, AlertCircle, Calendar } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

const WEBHOOK_URL = 'https://n8n.performanteaiagency.com/webhook/token';

const Dashboard: React.FC = () => {
  const {
    loading,
    accountStatus,
    aiAutopilot,
    toggleAiAutopilot,
    aiAutopilotLoading,
    optimization,
    updateOptimization,
    platform,
    setPlatform,
    tiktokConnected,
    checkTikTokConnected,
    dateRange,
  } = useAppContext();
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [webhookResult, setWebhookResult] = useState<string>('');
  const [loadingWebhook, setLoadingWebhook] = useState(false);
  const [adAccounts, setAdAccounts] = useState<any[]>([]);
  const [showAdAccounts, setShowAdAccounts] = useState(false);
  const [selectedAdAccount, setSelectedAdAccount] = useState<string | null>(null);
  const [userTarif, setUserTarif] = useState<string | null>(null);
  const [hideDebtBanner, setHideDebtBanner] = useState<boolean>(false);
  const [userName, setUserName] = useState<string | null>(null);

  // Проверка на блокировку кабинета (account_status === 3)
  const isPaymentFailed = accountStatus && Number(accountStatus.account_status) === 3;

  // Сохраняем/читаем скрытие баннера из localStorage
  useEffect(() => {
    const v = localStorage.getItem('hideDebtBanner');
    setHideDebtBanner(v === '1');
  }, []);

  // Если задолженность исчезла — очищаем флаг скрытия
  useEffect(() => {
    if (!isPaymentFailed) {
      localStorage.removeItem('hideDebtBanner');
      setHideDebtBanner(false);
    }
  }, [isPaymentFailed]);

  // Получаем telegram_id из query
  const params = new URLSearchParams(window.location.search);
  const telegram_id = params.get('telegram_id');

  // Загружаем тариф пользователя
  useEffect(() => {
    const loadUserTarif = async () => {
      try {
        const userData = localStorage.getItem('user');
        if (userData) {
          const user = JSON.parse(userData);
          if (user?.username) {
            setUserName(user.username);
          }

          const { data, error } = await supabase
            .from('user_accounts')
            .select('tarif, username, page_name')
            .eq('id', user.id)
            .single();

          if (error) {
            console.error('Ошибка загрузки тарифа:', error);
            return;
          }

          setUserTarif(data?.tarif || null);
          if (data?.page_name) {
            setUserName(data.page_name);
          } else if (data?.username) {
            setUserName(data.username);
          }
        }
      } catch (error) {
        console.error('Ошибка парсинга данных пользователя:', error);
      }
    };

    loadUserTarif();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code) {
      setWebhookResult('');
      setLoadingWebhook(true);
      const form = new FormData();
      form.append('code', code);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', WEBHOOK_URL, true);
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const resp = JSON.parse(xhr.responseText);
            if (resp && Array.isArray(resp.data)) {
              setAdAccounts(resp.data);
              setShowAdAccounts(true);
              setWebhookResult('');
            } else {
              setWebhookResult('Успех: ' + xhr.responseText);
            }
          } catch (e) {
            setWebhookResult('Успех: ' + xhr.responseText);
          }
        } else {
          setWebhookResult('Ошибка: ' + xhr.status + ' ' + xhr.responseText);
        }
        setLoadingWebhook(false);
      };
      xhr.onerror = function () {
        setWebhookResult('Ошибка сети при отправке на webhook');
        setLoadingWebhook(false);
      };
      xhr.send(form);

      // Удаляем параметр code из URL, чтобы не отправлять повторно
      params.delete('code');
      const newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
      window.history.replaceState({}, '', newUrl);
    }
  }, [window.location.search]);

  const handleSelectAdAccount = (account: any) => {
    localStorage.setItem('selected_ad_account', JSON.stringify(account));
    setShowAdAccounts(false);
    setSelectedAdAccount(account.id);
    // Отправляем id выбранного кабинета на отдельный вебхук
    const form = new FormData();
    form.append('ad_account_id', account.id);
    fetch('https://n8n.performanteaiagency.com/webhook/adaccount', {
      method: 'POST',
      body: form
    })
      .then(res => res.text())
      .then(data => {
        setWebhookResult('Кабинет выбран и отправлен: ' + data);
      })
      .catch(err => {
        setWebhookResult('Ошибка при отправке выбранного кабинета: ' + err);
      });
  };

  if (showAdAccounts) {
    if (loadingWebhook) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background">
          <Card className="w-full max-w-sm shadow-sm">
            <CardContent className="p-8 text-center">
          <div className="text-lg font-medium">Загрузка кабинетов...</div>
            </CardContent>
          </Card>
        </div>
      );
    }
    if (adAccounts.length > 0) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4">
          <div className="w-full max-w-2xl">
            <div className="mb-6 text-center">
              <h2 className="text-2xl font-bold mb-2">Выберите рекламный кабинет</h2>
              <p className="text-muted-foreground">Выберите кабинет для продолжения работы</p>
            </div>
            <Card className="shadow-sm">
              <CardContent className="p-4">
                <ul className="flex flex-col gap-3">
            {adAccounts.map(acc => (
                    <li key={acc.id}>
                      <Card className="hover:shadow-md transition-all border-muted cursor-pointer" onClick={() => handleSelectAdAccount(acc)}>
                        <CardContent className="p-4 flex items-center justify-between">
                          <div className="flex-1">
                            <div className="font-semibold text-base mb-1">{acc.name}</div>
                  <div className="text-xs text-muted-foreground">ID: {acc.id}</div>
                  <div className="text-xs text-muted-foreground">Account ID: {acc.account_id}</div>
                </div>
                          <Button
                            variant="outline"
                            className="ml-4 border-gray-200 hover:bg-gray-50 hover:border-gray-300 shadow-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectAdAccount(acc);
                            }}
                >
                  Выбрать
                          </Button>
                        </CardContent>
                      </Card>
              </li>
            ))}
          </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      );
    }
  }

  // После выбора кабинета — финальный экран
  if (selectedAdAccount) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="shadow-sm w-full max-w-md">
          <CardContent className="p-8 flex flex-col gap-4 items-center text-center">
            <div className="h-16 w-16 rounded-full bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center shadow-lg">
              <svg className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
        </div>
            <h2 className="text-2xl font-bold">Регистрация завершена!</h2>
            <p className="text-muted-foreground">Спасибо! Ваш аккаунт успешно зарегистрирован.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const formattedDateRange = useMemo(() => {
    if (!dateRange?.since || !dateRange?.until) return null;
    try {
      const since = format(new Date(dateRange.since), 'dd.MM.yyyy');
      const until = format(new Date(dateRange.until), 'dd.MM.yyyy');
      if (since === until) {
        return since;
      }
      return `${since} — ${until}`;
    } catch (error) {
      console.error('Не удалось форматировать период дат:', error);
      return null;
    }
  }, [dateRange]);

  return (
    <div className="bg-background w-full max-w-full overflow-x-hidden">
      <Header 
        onOpenDatePicker={() => setDatePickerOpen(true)}
      />
      
      <div className="container mx-auto py-6 px-4 pt-[76px] max-w-full">
        <DashboardHero 
          title={userName || (userTarif === 'target' ? 'Панель таргетолога' : 'Панель управления')}
          subtitle={userTarif === 'target' ? 'Ваши направления и планы' : 'Управление рекламными кампаниями и аналитика'}
        />

        {formattedDateRange && (
          <div className="mb-6">
            <Badge variant="secondary" className="rounded-full px-3 py-1 text-sm font-medium flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              <span>Статистика за {formattedDateRange}</span>
            </Badge>
          </div>
        )}

        {/* Переключатель платформы и подключение TikTok */}
        {(() => {
          const stored = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
          const u = stored ? JSON.parse(stored) : null;
          const isTtConnected = tiktokConnected || !!u?.tiktok_business_id;
          const openTikTokAuth = () => {
            const uid = u?.id || '';
            const statePayload = { user_id: uid, ts: Date.now() };
            let state = '';
            try {
              state = encodeURIComponent(btoa(JSON.stringify(statePayload)));
            } catch {
              state = encodeURIComponent(JSON.stringify(statePayload));
            }
            const redirect = encodeURIComponent('https://performanteaiagency.com/oauth/callback');
            const authUrl = `https://business-api.tiktok.com/portal/auth?app_id=7527489318093668353&state=${state}&redirect_uri=${redirect}`;
            window.open(authUrl, '_blank', 'noopener,noreferrer');
          };
          
          // TikTok icon SVG
          const TikTokIcon = () => (
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/>
            </svg>
          );
          
          return (
            <Card className="mb-6 shadow-sm">
              <CardContent className="p-4">
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-muted-foreground">Платформа:</span>
                    <div className="flex gap-2">
                      <Button
                        variant={platform === 'instagram' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setPlatform('instagram')}
                        className={cn(
                          "gap-2 transition-all duration-200",
                          platform === 'instagram' 
                            ? "bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white border-0 shadow-md dark:from-transparent dark:to-transparent dark:bg-accent dark:border-2 dark:border-foreground" 
                            : "border-purple-200 text-purple-600 hover:bg-purple-50 hover:border-purple-300 dark:border dark:text-foreground dark:hover:bg-accent"
                        )}
                      >
                        <Instagram className="h-4 w-4" />
                        Instagram
                      </Button>
                      <Button
                        variant={platform === 'tiktok' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setPlatform('tiktok')}
                        className={cn(
                          "gap-2 transition-all duration-200",
                          platform === 'tiktok' 
                            ? "bg-gradient-to-r from-black to-gray-900 hover:from-gray-900 hover:to-black text-white border-0 shadow-md dark:from-transparent dark:to-transparent dark:bg-accent dark:border-2 dark:border-foreground" 
                            : "border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400 dark:border dark:text-foreground dark:hover:bg-accent"
                        )}
                      >
                        <TikTokIcon />
                        TikTok
                      </Button>
                    </div>
                  </div>
                  {platform === 'tiktok' && !isTtConnected && (
                    <div className="p-3 rounded-lg border bg-gradient-to-r from-gray-50 to-slate-50 dark:from-transparent dark:to-transparent text-gray-700 dark:text-foreground flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 flex-1">
                        <AlertCircle className="h-4 w-4 flex-shrink-0" />
                        <span className="text-sm">Для просмотра статистики TikTok требуется подключение аккаунта.</span>
                      </div>
                      <Button 
                        variant="outline"
                        size="sm"
                        onClick={openTikTokAuth}
                        className="border-gray-200 bg-gradient-to-r from-gray-50 to-slate-50 text-gray-700 hover:from-gray-100 hover:to-slate-100 hover:border-gray-300 shadow-sm flex-shrink-0 transition-all duration-200"
                      >
                        Подключить
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })()}
        {platform === 'instagram' && isPaymentFailed && !hideDebtBanner && (
          <Card className="mb-6 shadow-sm border-red-200">
            <CardContent className="relative p-4 bg-gradient-to-r from-red-50 to-rose-50">
              <div className="flex items-center gap-3">
                <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
                <p className="text-sm font-medium text-red-900">
                  Оплата не прошла, ваш рекламный кабинет временно отключен. Пополните баланс.
                </p>
              </div>
              <button
                aria-label="Скрыть уведомление"
                className="absolute right-3 top-3 text-red-600/70 hover:text-red-900 transition-colors text-xl leading-none"
                onClick={() => { setHideDebtBanner(true); localStorage.setItem('hideDebtBanner', '1'); }}
              >
                ×
              </button>
            </CardContent>
          </Card>
        )}
        <SummaryStats showTitle={userTarif === 'target'} />
        
        {userTarif === 'target' ? (
          <>
            {/* Дашборд для тарифа Target */}
            <div className="space-y-6">
              {/* Таблица по направлениям */}
              <DirectionsTable />
              
              {/* План/Факт анализ за месяц */}
              <MonthlyPlanFact />
              
              {/* Журнал действий таргетолога */}
              <TargetologJournal />
            </div>
          </>
        ) : (
          <>
            {/* Стандартный дашборд (AI автопилот + кампании) */}
        {/* AI автопилот - только для Instagram */}
            {platform === 'instagram' && (
              <Card className="mb-6 shadow-sm overflow-hidden">
                <CardHeader className="pb-3 bg-gradient-to-r from-gray-50 to-slate-50 dark:from-transparent dark:to-transparent">
            <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-gray-600 to-slate-700 dark:from-gray-700/50 dark:to-slate-800/50 flex items-center justify-center shadow-sm">
                        <Bot className="h-5 w-5 text-white dark:text-gray-300" />
                      </div>
                      <div>
                        <CardTitle className="text-lg">AI автопилот</CardTitle>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Автоматическое управление кампаниями
                        </p>
                      </div>
              </div>
              <div className="flex items-center gap-2">
                      <span 
                        className={`inline-block w-2.5 h-2.5 rounded-full transition-all ${
                          aiAutopilot ? 'bg-gradient-to-br from-green-400 to-emerald-500 dark:from-green-500/70 dark:to-emerald-500/70 shadow-sm' : 'bg-gray-300 dark:bg-gray-600'
                        }`}
                        title={aiAutopilot ? 'Автопилот включен' : 'Автопилот выключен'}
                      />
                <Switch 
                  checked={aiAutopilot} 
                  onCheckedChange={toggleAiAutopilot}
                  disabled={aiAutopilotLoading}
                />
              </div>
            </div>
                </CardHeader>
                <CardContent className="pt-4">
                  <p className="text-sm text-muted-foreground mb-4">
                    Оптимизация бюджета и управление ставками с помощью искусственного интеллекта для достижения максимальной эффективности
            </p>
            
            {/* Выпадающий список оптимизации - показывается только когда автопилот включен */}
            {aiAutopilot && (
                    <div className="pt-3 border-t">
                <div className="flex items-center gap-3">
                        <span className="text-sm font-medium text-muted-foreground">Режим оптимизации:</span>
                  <Select value={optimization} onValueChange={updateOptimization}>
                          <SelectTrigger className="w-auto min-w-[200px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="lead_cost">По стоимости лида</SelectItem>
                      <SelectItem value="qual_lead">По стоимости качественного лида</SelectItem>
                      <SelectItem value="roi">По ROI</SelectItem>
                            <SelectItem value="agent2">Agent 2</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
                </CardContent>
              </Card>
            )}
        
        {/* Секция действий */}
            <div className="mb-6">
          <VideoUpload platform={platform} />
        </div>
        
            <div className="mb-6">
              <h2 className="text-xl font-semibold mb-4">Рекламные кампании</h2>
          <CampaignList />
        </div>
          </>
        )}
      </div>
      
      <DateRangePicker open={datePickerOpen} onOpenChange={setDatePickerOpen} />
    </div>
  );
};

export default Dashboard;
