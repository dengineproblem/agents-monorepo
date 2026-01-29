import React, { useState, useEffect, useMemo } from 'react';
import Header from '../components/Header';
import SummaryStats from '../components/SummaryStats';
import CampaignList from '../components/CampaignList';
import HierarchicalCampaignTable from '../components/HierarchicalCampaignTable';
import DateRangePicker from '../components/DateRangePicker';
import DirectionsTable from '../components/DirectionsTable';
import MonthlyPlanFact from '../components/MonthlyPlanFact';
import TargetologJournal from '../components/TargetologJournal';
import PageHero from '../components/common/PageHero';
import { FacebookManualConnectModal } from '../components/profile/FacebookManualConnectModal';
import { AutopilotSection } from '../components/AutopilotSection';
import { AllAccountsExecutionsSection } from '../components/AllAccountsExecutionsSection';

import { VideoUpload } from '../components/VideoUpload';
import { useAppContext } from '../context/AppContext';
import { useOptimization } from '@/hooks/useOptimization';
import { OptimizationModal } from '@/components/optimization';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Instagram, AlertCircle, Calendar } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { FEATURES } from '../config/appReview';
import { useTranslation } from '../i18n/LanguageContext';
import { HelpTooltip } from '../components/ui/help-tooltip';
import { TooltipKeys } from '../content/tooltips';

const WEBHOOK_URL = 'https://n8n.performanteaiagency.com/webhook/token';

const Dashboard: React.FC = () => {
  const { t } = useTranslation();
  const {
    loading,
    accountStatus,
    aiAutopilot,
    toggleAiAutopilot,
    aiAutopilotLoading,
    aiAutopilotTiktok,
    toggleAiAutopilotTiktok,
    aiAutopilotTiktokLoading,
    platform,
    setPlatform,
    tiktokConnected,
    checkTikTokConnected,
    dateRange,
    multiAccountEnabled,
    adAccounts: contextAdAccounts,
    currentAdAccountId,
  } = useAppContext();

  // Optimization hook for Brain Mini
  const optimization = useOptimization();

  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [webhookResult, setWebhookResult] = useState<string>('');
  const [loadingWebhook, setLoadingWebhook] = useState(false);
  const [adAccounts, setAdAccounts] = useState<any[]>([]);
  const [showAdAccounts, setShowAdAccounts] = useState(false);
  const [selectedAdAccount, setSelectedAdAccount] = useState<string | null>(null);
  const [userTarif, setUserTarif] = useState<string | null>(null);
  const [hideDebtBanner, setHideDebtBanner] = useState<boolean>(false);
  const [userName, setUserName] = useState<string | null>(null);
  const [showFacebookConnectModal, setShowFacebookConnectModal] = useState(false);
  const [userAccountId, setUserAccountId] = useState<string | null>(null);

  // Проверка на блокировку кабинета (account_status === 3)
  const isPaymentFailed = accountStatus && Number(accountStatus.account_status) === 3;

  // ВАЖНО: useMemo должен быть ДО всех условных return, иначе будет ошибка React Hooks
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

      return null;
    }
  }, [dateRange]);

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

  // Загружаем тариф пользователя и userAccountId
  useEffect(() => {
    const loadUserTarif = async () => {
      try {
        const userData = localStorage.getItem('user');
        if (userData) {
          const user = JSON.parse(userData);
          if (user?.id) {
            setUserAccountId(user.id);
          }
          if (user?.username) {
            setUserName(user.username);
          }

          const { data, error } = await supabase
            .from('user_accounts')
            .select('tarif, username, page_name')
            .eq('id', user.id)
            .single();

          if (error) {

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

  // Мультиаккаунтный режим без аккаунтов — показываем экран с кнопкой
  if (multiAccountEnabled && contextAdAccounts.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="shadow-sm w-full max-w-lg">
          <CardContent className="p-8 flex flex-col gap-6 items-center text-center">
            <div className="h-20 w-20 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
              <svg className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <div>
              <h2 className="text-2xl font-bold mb-2">Добро пожаловать!</h2>
              <p className="text-muted-foreground">
                Для начала работы добавьте ваш первый рекламный аккаунт.
                Мы зададим несколько вопросов о вашем бизнесе.
              </p>
            </div>
            <Button
              size="lg"
              className="gap-2 px-8"
              onClick={() => {
                // Открываем онбординг через глобальное событие
                window.dispatchEvent(new CustomEvent('openOnboarding'));
              }}
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Добавить рекламный аккаунт
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="bg-background w-full max-w-full overflow-x-hidden">
      <Header 
        onOpenDatePicker={() => setDatePickerOpen(true)}
      />
      
      <div className="container mx-auto py-6 px-4 pt-[76px] max-w-full" data-tour="dashboard-content">
        <PageHero
          title={(() => {
            // В мультиаккаунтном режиме показываем имя текущего ad_account
            if (multiAccountEnabled && contextAdAccounts && contextAdAccounts.length > 0) {
              const currentAcc = contextAdAccounts.find((a: any) => a.id === currentAdAccountId) || contextAdAccounts[0];
              return currentAcc?.name || userName || t('dashboard.title');
            }
            return userName || (userTarif === 'target' ? t('dashboard.targetologPanel') : t('dashboard.title'));
          })()}
          subtitle={userTarif === 'target' ? t('dashboard.yourDirectionsAndPlans') : t('campaign.management')}
        />

        {formattedDateRange && (
          <div className="mb-6">
            <Badge variant="secondary" className="rounded-full px-3 py-1 text-sm font-medium flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              <span>{t('dashboard.statsFor')} {formattedDateRange}</span>
            </Badge>
          </div>
        )}

        {/* Уведомления о подключении Facebook и TikTok */}
        {(() => {
          const stored = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
          const u = stored ? JSON.parse(stored) : null;

          // Проверка подключения Facebook с учётом мультиаккаунтного режима
          let isFbConnected = false;
          if (multiAccountEnabled && contextAdAccounts && contextAdAccounts.length > 0) {
            // В мультиаккаунтном режиме проверяем данные в текущем выбранном ad_account
            const currentAcc = contextAdAccounts.find((a: any) => a.id === currentAdAccountId) || contextAdAccounts[0];
            // Для manual-connect достаточно ad_account_id (access_token получается позже через Business Portfolio)
            isFbConnected = !!currentAcc?.ad_account_id && currentAcc?.ad_account_id !== '';
          } else {
            // Legacy режим — проверяем в user_accounts
            isFbConnected = !!u?.access_token && u?.access_token !== '' && !!u?.ad_account_id && u?.ad_account_id !== '';
          }
          const isTtConnected = tiktokConnected || !!u?.tiktok_business_id;

          const openFacebookConnect = () => {
            setShowFacebookConnectModal(true);
          };
          
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
                    <span className="text-sm font-medium text-muted-foreground">{t('dashboard.platform')}</span>
                    <Tabs
                      value={platform}
                      onValueChange={(value) => setPlatform(value as 'instagram' | 'tiktok')}
                    >
                      <TabsList className="h-auto bg-transparent p-0 gap-2">
                        <div className="flex items-center gap-1">
                          <TabsTrigger
                            value="instagram"
                            className={cn(
                              "gap-2 transition-all duration-200",
                              "data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-500 data-[state=active]:to-pink-500 data-[state=active]:hover:from-purple-600 data-[state=active]:hover:to-pink-600 data-[state=active]:text-white data-[state=active]:border-0 data-[state=active]:shadow-md data-[state=active]:dark:from-transparent data-[state=active]:dark:to-transparent data-[state=active]:dark:bg-accent data-[state=active]:dark:border-2 data-[state=active]:dark:border-foreground",
                              "data-[state=inactive]:border data-[state=inactive]:border-purple-200 data-[state=inactive]:text-purple-600 data-[state=inactive]:hover:bg-purple-50 data-[state=inactive]:hover:border-purple-300 data-[state=inactive]:dark:border data-[state=inactive]:dark:text-foreground data-[state=inactive]:dark:hover:bg-accent"
                            )}
                          >
                            <Instagram className="h-4 w-4" />
                            Instagram
                          </TabsTrigger>
                          <HelpTooltip tooltipKey={TooltipKeys.PLATFORM_INSTAGRAM} iconSize="sm" />
                        </div>
                        {FEATURES.SHOW_TIKTOK && (
                          <div className="flex items-center gap-1">
                            <TabsTrigger
                              value="tiktok"
                              className={cn(
                                "gap-2 transition-all duration-200",
                                "data-[state=active]:bg-gradient-to-r data-[state=active]:from-black data-[state=active]:to-gray-900 data-[state=active]:hover:from-gray-900 data-[state=active]:hover:to-black data-[state=active]:text-white data-[state=active]:border-0 data-[state=active]:shadow-md data-[state=active]:dark:from-transparent data-[state=active]:dark:to-transparent data-[state=active]:dark:bg-accent data-[state=active]:dark:border-2 data-[state=active]:dark:border-foreground",
                                "data-[state=inactive]:border data-[state=inactive]:border-gray-300 data-[state=inactive]:text-gray-700 data-[state=inactive]:hover:bg-gray-50 data-[state=inactive]:hover:border-gray-400 data-[state=inactive]:dark:border data-[state=inactive]:dark:text-foreground data-[state=inactive]:dark:hover:bg-accent"
                              )}
                            >
                              <TikTokIcon />
                              TikTok
                            </TabsTrigger>
                            <HelpTooltip tooltipKey={TooltipKeys.PLATFORM_TIKTOK} iconSize="sm" />
                          </div>
                        )}
                      </TabsList>
                    </Tabs>
                  </div>
                  {platform === 'instagram' && !isFbConnected && (
                    <div className="p-3 rounded-lg border bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-transparent dark:to-transparent text-blue-700 dark:text-foreground flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 flex-1">
                        <AlertCircle className="h-4 w-4 flex-shrink-0" />
                        <span className="text-sm">{t('dashboard.connectFacebookDescription')}</span>
                        <HelpTooltip tooltipKey={TooltipKeys.FACEBOOK_CONNECT_BANNER} iconSize="sm" />
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={openFacebookConnect}
                        className="border-blue-200 dark:border-blue-700 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/30 dark:to-indigo-900/30 text-blue-700 dark:text-blue-300 hover:from-blue-100 hover:to-indigo-100 dark:hover:from-blue-800/40 dark:hover:to-indigo-800/40 hover:border-blue-300 dark:hover:border-blue-600 shadow-sm flex-shrink-0 transition-all duration-200"
                      >
                        {t('profile.connect')}
                      </Button>
                    </div>
                  )}
                  {FEATURES.SHOW_TIKTOK && platform === 'tiktok' && !isTtConnected && (
                    <div className="p-3 rounded-lg border bg-gradient-to-r from-gray-50 to-slate-50 dark:from-transparent dark:to-transparent text-gray-700 dark:text-foreground flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 flex-1">
                        <AlertCircle className="h-4 w-4 flex-shrink-0" />
                        <span className="text-sm">Для просмотра статистики TikTok требуется подключение аккаунта.</span>
                        <HelpTooltip tooltipKey={TooltipKeys.TIKTOK_CONNECT_BANNER} iconSize="sm" />
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
          <Card className="mb-6 shadow-sm border-red-200 dark:border-red-700">
            <CardContent className="relative p-4 bg-gradient-to-r from-red-50 to-rose-50 dark:from-red-900/50 dark:to-rose-900/50">
              <div className="flex items-center gap-3">
                <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0" />
                <p className="text-sm font-medium text-red-900 dark:text-red-200">
                  {t('dashboard.paymentFailedMessage')}
                </p>
                <HelpTooltip tooltipKey={TooltipKeys.PAYMENT_FAILED_BANNER} iconSize="sm" />
              </div>
              <button
                aria-label={t('action.close')}
                className="absolute right-3 top-3 text-red-600/70 hover:text-red-900 dark:text-red-400/70 dark:hover:text-red-200 transition-colors text-xl leading-none"
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
              {platform === 'instagram' && <MonthlyPlanFact />}
              
              {/* Журнал действий таргетолога */}
              {platform === 'instagram' && <TargetologJournal />}
            </div>
          </>
        ) : (
          <>
            {/* Стандартный дашборд (AI автопилот + кампании) */}
            {/* AI автопилот - для Instagram */}
            {platform === 'instagram' && FEATURES.SHOW_AI_AUTOPILOT && userAccountId && (
              <AutopilotSection
                aiAutopilot={aiAutopilot}
                toggleAiAutopilot={toggleAiAutopilot}
                aiAutopilotLoading={aiAutopilotLoading}
                userAccountId={userAccountId}
                currentAdAccountId={currentAdAccountId}
                isMultiAccountMode={multiAccountEnabled}
              />
            )}

            {/* AI автопилот - для TikTok */}
            {platform === 'tiktok' && FEATURES.SHOW_AI_AUTOPILOT && userAccountId && (
              <AutopilotSection
                aiAutopilot={aiAutopilotTiktok}
                toggleAiAutopilot={toggleAiAutopilotTiktok}
                aiAutopilotLoading={aiAutopilotTiktokLoading}
                userAccountId={userAccountId}
                currentAdAccountId={currentAdAccountId}
                isMultiAccountMode={multiAccountEnabled}
              />
            )}
        
        {/* Секция действий */}
            <div className="mb-6">
          <VideoUpload platform={platform} />
        </div>

            {/* Отчёты и действия */}
            {userAccountId && (
              <div className="mb-6">
                <AllAccountsExecutionsSection
                  userAccountId={userAccountId}
                  adAccounts={contextAdAccounts || []}
                  onOptimize={optimization.startOptimization}
                />
              </div>
            )}

            <div className="mb-6">
              <h2 className="text-xl font-semibold mb-4">{t('campaign.adCampaigns')}</h2>
              <HierarchicalCampaignTable
                accountId={currentAdAccountId || undefined}
                accountName={contextAdAccounts?.find(a => a.id === currentAdAccountId)?.name}
                onOptimize={optimization.startOptimization}
              />
            </div>
          </>
        )}
      </div>
      
      <DateRangePicker open={datePickerOpen} onOpenChange={setDatePickerOpen} />

      {/* Facebook Manual Connect Modal */}
      <FacebookManualConnectModal
        open={showFacebookConnectModal}
        onOpenChange={setShowFacebookConnectModal}
        onComplete={() => {
          setShowFacebookConnectModal(false);
          window.location.reload();
        }}
      />

      {/* Brain Mini Optimization Modal */}
      <OptimizationModal
        open={optimization.state.isOpen}
        onClose={optimization.close}
        scope={optimization.state.scope}
        streamingState={optimization.state.streamingState}
        plan={optimization.state.plan}
        content={optimization.state.content}
        isLoading={optimization.state.isLoading}
        error={optimization.state.error}
        onApprove={optimization.approveSelected}
        onReject={optimization.reject}
        isExecuting={optimization.state.isExecuting}
        progressMessage={optimization.state.progressMessage}
      />
    </div>
  );
};

export default Dashboard;
