import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { SidebarAwareContent } from "@/components/SidebarAwareContent";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { AppProvider } from "./context/AppContext";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import CampaignDetail from "./pages/CampaignDetail";
import Consultations from "./pages/Consultations";
import NotFound from "./pages/NotFound";
import Profile from "./pages/Profile";
import Signup from "./pages/Signup";
import { useEffect, useState } from "react";
import { useTelegramWebApp } from "./hooks/useTelegramWebApp";
import { usePageTracking } from "./hooks/usePageTracking";
import { ThemeProvider } from "next-themes";
import ROIAnalytics from './pages/ROIAnalytics';
import CreativeGeneration from './pages/CreativeGeneration';
import Creatives from './pages/Creatives';
import AdSettings from './pages/AdSettings';
import WhatsAppAnalysis from './pages/WhatsAppAnalysis';
import Privacy from './pages/Privacy';
import Terms from './pages/Terms';
import PaymentPage from './pages/PaymentPage';
import PaymentSuccess from './pages/PaymentSuccess';
import PaymentFail from './pages/PaymentFail';
import OAuthCallback from './pages/OAuthCallback';
import CarouselTest from './pages/CarouselTest';
import Competitors from './pages/Competitors';
import KnowledgeBase from './pages/KnowledgeBase';
import AdminAnalytics from './pages/AdminAnalytics';
import AdminOnboarding from './pages/AdminOnboarding';
import AdminRoute from './components/AdminRoute';
import Assistant from './pages/Assistant';
import ConversationReports from './pages/ConversationReports';
import MultiAccountDashboard from './pages/MultiAccountDashboard';
import { AdminLayout } from './components/admin';
import {
  AdminDashboard,
  AdminChats,
  AdminUsers,
  AdminSubscriptions,
  AdminAds,
  AdminLeads,
  AdminErrors,
  AdminSettings,
  AdminAdInsights,
} from './pages/admin';
import { LanguageProvider, useTranslation } from './i18n/LanguageContext';
import { FEATURES } from './config/appReview';
import { OnboardingWizard } from './components/onboarding/OnboardingWizard';
import { FacebookManualConnectModal } from './components/profile/FacebookManualConnectModal';
import { OnboardingTour } from './components/onboarding/OnboardingTour';
import { useAppContext } from './context/AppContext';
import { initSafeStorage } from './utils/safeStorage';
import { BrainProposalsProvider } from './contexts/BrainProposalsContext';

// Инициализация безопасного хранилища при старте
initSafeStorage();

const queryClient = new QueryClient();

const PUBLIC_PATHS = ['/login', '/signup', '/privacy', '/terms', '/pay'];

/**
 * Компонент для корневого роута "/" с мгновенным редиректом для мультиаккаунта.
 * Читает напрямую из localStorage для избежания задержки от context state.
 */
const HomeRoute = () => {
  // Читаем напрямую из localStorage для мгновенного решения (без ожидания context)
  const isMultiAccount = localStorage.getItem('multiAccountEnabled') === 'true';
  const storedAccounts = localStorage.getItem('adAccounts');
  let hasAccounts = false;
  if (storedAccounts) {
    try {
      const parsed = JSON.parse(storedAccounts);
      hasAccounts = Array.isArray(parsed) && parsed.length > 0;
    } catch {
      hasAccounts = false;
    }
  }
  const hasVisited = sessionStorage.getItem('hasVisitedDashboard') === 'true';

  if (isMultiAccount && hasAccounts && !hasVisited) {
    sessionStorage.setItem('hasVisitedDashboard', 'true');
    return <Navigate to="/accounts" replace />;
  }

  return <Dashboard />;
};

const AppRoutes = () => {
  const location = useLocation();
  const isPublic = PUBLIC_PATHS.some(
    (path) => location.pathname === path || location.pathname.startsWith(`${path}/`)
  );
  const { t } = useTranslation();
  const { adAccounts, multiAccountEnabled } = useAppContext();

  // Автоматический трекинг page views
  usePageTracking();

  // Routes that don't need sidebar (e.g., WhatsApp CRM, Admin panel)
  const noSidebarRoutes = ['/whatsapp-analysis'];

  // Check if current path is admin route
  const isAdminRoute = location.pathname.startsWith('/admin');

  // Синхронная инициализация user из localStorage для мгновенного рендера без "моргания"
  const [user, setUser] = useState<any>(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser);
        if (parsedUser && parsedUser.username) {
          return parsedUser;
        }
      } catch {
        // ignore
      }
    }
    return null;
  });
  const [loading, setLoading] = useState(false); // Сразу false, т.к. user уже прочитан синхронно
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showFacebookManualModal, setShowFacebookManualModal] = useState(false);

  // Определяем, подключён ли Facebook (одобрен тех.специалистом)
  const isFbConnected = (() => {
    let result = false;
    if (multiAccountEnabled) {
      // Мультиаккаунт: проверяем connection_status активного аккаунта
      const currentAccount = adAccounts.find(acc => acc.is_active !== false);
      result = currentAccount?.connection_status === 'connected';
      console.log('[isFbConnected] MultiAccount mode:', {
        adAccountsCount: adAccounts.length,
        currentAccount: currentAccount?.id,
        connectionStatus: currentAccount?.connection_status,
        result,
      });
    } else {
      // Legacy: проверяем access_token в user
      const storedUser = localStorage.getItem('user');
      if (storedUser) {
        try {
          const parsed = JSON.parse(storedUser);
          result = !!(parsed.access_token && parsed.ad_account_id);
          console.log('[isFbConnected] Legacy mode:', {
            hasAccessToken: !!parsed.access_token,
            hasAdAccountId: !!parsed.ad_account_id,
            result,
          });
        } catch {
          result = false;
        }
      }
    }
    return result;
  })();

  useEffect(() => {
    // Проверяем наличие пользовательских данных в localStorage
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser);
        if (parsedUser && parsedUser.username) {
          setUser(parsedUser);
          // НЕ показываем онбординг при загрузке — ждём multiAccountLoaded
        } else {
          localStorage.removeItem('user');
          setUser(null);
        }
      } catch (error) {
        localStorage.removeItem('user');
        setUser(null);
      }
    } else {
      setUser(null);
    }
    setLoading(false);
  }, [location.pathname]);

  // Слушаем событие multiAccountLoaded от AppContext
  useEffect(() => {
    const handleMultiAccountLoaded = () => {
      const isMultiAccount = localStorage.getItem('multiAccountEnabled') === 'true';
      const storedUser = localStorage.getItem('user');
      console.log('[Onboarding Debug] multiAccountLoaded:', {
        isMultiAccount,
        multiAccountEnabledRaw: localStorage.getItem('multiAccountEnabled'),
        hasUser: !!storedUser,
        userPrompt1: storedUser ? JSON.parse(storedUser).prompt1 : null,
      });

      // Онбординг ТОЛЬКО для НЕ-мультиаккаунта без prompt1
      const wasDismissed = localStorage.getItem('onboardingDismissed') === 'true';

      if (isMultiAccount) {
        console.log('[Onboarding Debug] Multi-account mode - NOT showing onboarding');
        setShowOnboarding(false);
      } else if (!wasDismissed) {
        if (storedUser) {
          try {
            const parsedUser = JSON.parse(storedUser);
            if (!parsedUser.prompt1) {
              console.log('[Onboarding Debug] Legacy mode, no prompt1 - SHOWING onboarding');
              setShowOnboarding(true);
            }
          } catch {}
        }
      } else {
        console.log('[Onboarding Debug] Onboarding was dismissed - NOT showing');
      }
    };

    window.addEventListener('multiAccountLoaded', handleMultiAccountLoaded);
    return () => window.removeEventListener('multiAccountLoaded', handleMultiAccountLoaded);
  }, []);

  // Слушаем событие openOnboarding для добавления нового аккаунта в мультиаккаунтном режиме
  useEffect(() => {
    const handleOpenOnboarding = () => {
      console.log('[Onboarding Debug] openOnboarding event - SHOWING onboarding');
      // Сбрасываем флаг, т.к. пользователь явно хочет добавить аккаунт
      localStorage.removeItem('onboardingDismissed');
      setShowOnboarding(true);
    };

    window.addEventListener('openOnboarding', handleOpenOnboarding);
    return () => window.removeEventListener('openOnboarding', handleOpenOnboarding);
  }, []);

  useEffect(() => {
    const handleStorageChange = () => {
      const storedUser = localStorage.getItem('user');
      if (storedUser) {
        try {
          const parsedUser = JSON.parse(storedUser);
          setUser(parsedUser);
        } catch (error) {
          setUser(null);
        }
      } else {
        setUser(null);
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const handleOnboardingComplete = () => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser);
        setUser(parsedUser);
        setShowOnboarding(false);

        window.dispatchEvent(new CustomEvent('reloadAdAccounts'));

        const isMultiAccount = localStorage.getItem('multiAccountEnabled') === 'true';

        if (isMultiAccount) {
          // В мультиаккаунтном режиме показываем модалку подключения Facebook
          // с небольшой задержкой, чтобы дать время на загрузку нового аккаунта
          setTimeout(() => {
            setShowFacebookManualModal(true);
          }, 500);
        } else {
          // Legacy режим: проверяем есть ли подключение в user
          const hasFacebookConnection = parsedUser.access_token && parsedUser.access_token !== '';
          const isPendingReview = parsedUser.fb_connection_status === 'pending_review';

          if (!hasFacebookConnection && !isPendingReview) {
            setShowFacebookManualModal(true);
          }
        }
      } catch (error) {
        console.error('Ошибка при обновлении user после онбординга:', error);
      }
    }
  };

  const handleFacebookModalComplete = () => {
    setShowFacebookManualModal(false);
    // Обновляем user из localStorage
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser);
        setUser(parsedUser);
      } catch (error) {
        console.error('Ошибка при обновлении user после Facebook подключения:', error);
      }
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">{t('common.loading')}</div>;
  }

  const isPublicRoute = isPublic;
  const isNoSidebarRoute = noSidebarRoutes.includes(location.pathname);

  return (
    <>
      {user && !isPublicRoute ? (
        <>
          {/* Онбординг показывается для НЕ-мультиаккаунта если prompt1 не заполнен,
              или в мультиаккаунтном режиме при добавлении нового аккаунта */}
          {showOnboarding && (
            <OnboardingWizard
              onComplete={handleOnboardingComplete}
              onClose={() => {
                setShowOnboarding(false);
                localStorage.setItem('onboardingDismissed', 'true');
              }}
            />
          )}

          {/* Модалка ручного подключения Facebook показывается после онбординга */}
          <FacebookManualConnectModal
            open={showFacebookManualModal}
            onOpenChange={setShowFacebookManualModal}
            onComplete={handleFacebookModalComplete}
            onSkip={() => setShowFacebookManualModal(false)}
            showSkipButton={true}
          />

          {/* Онбординг-тур показывается после одобрения Facebook тех.специалистом */}
          <OnboardingTour isFbConnected={isFbConnected} />

          {isAdminRoute ? (
            // Admin Panel with its own layout
            <Routes>
              <Route path="/admin" element={<AdminRoute><AdminLayout /></AdminRoute>}>
                <Route index element={<AdminDashboard />} />
                <Route path="chats" element={<AdminChats />} />
                <Route path="chats/:userId" element={<AdminChats />} />
                <Route path="users" element={<AdminUsers />} />
                <Route path="subscriptions" element={<AdminSubscriptions />} />
                <Route path="onboarding" element={<AdminOnboarding />} />
                <Route path="ads" element={<AdminAds />} />
                <Route path="leads" element={<AdminLeads />} />
                <Route path="errors" element={<AdminErrors />} />
                <Route path="settings" element={<AdminSettings />} />
                <Route path="analytics" element={<AdminAnalytics />} />
                <Route path="ad-insights" element={<AdminAdInsights />} />
              </Route>
            </Routes>
          ) : isNoSidebarRoute ? (
            // Routes without sidebar (e.g., WhatsApp CRM)
            <div className="min-h-screen w-full">
              <Routes>
                <Route path="/whatsapp-analysis" element={<WhatsAppAnalysis />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </div>
          ) : (
            // Routes with sidebar (user app)
            <div className="min-h-screen w-full max-w-full overflow-x-hidden">
              <SidebarProvider>
                <div className="w-full max-w-full">
                  <AppSidebar />
                  <SidebarAwareContent>
                    <Routes>
                      <Route path="/" element={<HomeRoute />} />
                      <Route path="/accounts" element={<MultiAccountDashboard />} />
                      <Route path="/oauth/callback" element={<OAuthCallback />} />
                      <Route path="/oauth/tiktok/callback" element={<OAuthCallback />} />
                      <Route path="/campaign/:id" element={<CampaignDetail />} />
                      {FEATURES.SHOW_CONSULTATIONS && <Route path="/consultations" element={<Consultations />} />}
                      {FEATURES.SHOW_ROI_ANALYTICS && <Route path="/roi" element={<ROIAnalytics />} />}
                      {FEATURES.SHOW_CREATIVES && <Route path="/creatives" element={<CreativeGeneration />} />}
                      {FEATURES.SHOW_CREATIVES && <Route path="/videos" element={<Creatives />} />}
                      {FEATURES.SHOW_CREATIVES && <Route path="/carousel-test" element={<CarouselTest />} />}
                      {FEATURES.SHOW_COMPETITORS && <Route path="/competitors" element={<Competitors />} />}
                      <Route path="/profile" element={<Profile />} />
                      {FEATURES.SHOW_DIRECTIONS && <Route path="/ad-settings" element={<AdSettings />} />}
                      <Route path="/knowledge-base" element={<KnowledgeBase />} />
                      <Route path="/knowledge-base/:chapterId" element={<KnowledgeBase />} />
                      <Route path="/knowledge-base/:chapterId/:sectionId" element={<KnowledgeBase />} />
                      <Route path="/assistant" element={<Assistant />} />
                      <Route path="/conversation-reports" element={<ConversationReports />} />
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </SidebarAwareContent>
                </div>
              </SidebarProvider>
            </div>
          )}
        </>
      ) : (
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/pay/success" element={<PaymentSuccess />} />
          <Route path="/pay/fail" element={<PaymentFail />} />
          <Route path="/pay" element={<PaymentPage />} />
          <Route path="/pay/:plan" element={<PaymentPage />} />
          <Route path="/oauth/callback" element={<OAuthCallback />} />
          <Route path="/oauth/tiktok/callback" element={<OAuthCallback />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      )}
    </>
  );
};

const App = () => {
  const { tg, isReady } = useTelegramWebApp();
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  
  useEffect(() => {
    if (isReady && tg.colorScheme) {
      setTheme(tg.colorScheme);
    }
  }, [isReady, tg.colorScheme]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme={theme} enableSystem={false}>
        <TooltipProvider>
          <LanguageProvider>
            <AppProvider>
              <BrainProposalsProvider>
                <Sonner position="top-center" />
                <Toaster />
                <BrowserRouter>
                  <AppRoutes />
                </BrowserRouter>
              </BrainProposalsProvider>
            </AppProvider>
          </LanguageProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
