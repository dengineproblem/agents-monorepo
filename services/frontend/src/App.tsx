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
import { ThemeProvider } from "next-themes";
import ROIAnalytics from './pages/ROIAnalytics';
import CreativeGeneration from './pages/CreativeGeneration';
import Creatives from './pages/Creatives';
import AdSettings from './pages/AdSettings';
import WhatsAppAnalysis from './pages/WhatsAppAnalysis';
import Privacy from './pages/Privacy';
import Terms from './pages/Terms';
import OAuthCallback from './pages/OAuthCallback';
import CarouselTest from './pages/CarouselTest';
import Competitors from './pages/Competitors';
import KnowledgeBase from './pages/KnowledgeBase';
import { LanguageProvider, useTranslation } from './i18n/LanguageContext';
import { FEATURES } from './config/appReview';
import { OnboardingWizard } from './components/onboarding/OnboardingWizard';
import { FacebookManualConnectModal } from './components/profile/FacebookManualConnectModal';

const queryClient = new QueryClient();

const PUBLIC_PATHS = ['/login', '/signup', '/privacy', '/terms'];

const AppRoutes = () => {
  const location = useLocation();
  const isPublic = PUBLIC_PATHS.includes(location.pathname);
  const { t } = useTranslation();

  // Routes that don't need sidebar (e.g., WhatsApp CRM)
  const noSidebarRoutes = ['/whatsapp-analysis'];

  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  // ОТКЛЮЧЕНО: онбординг полностью выключен
  const showOnboarding = false;
  const [showFacebookManualModal, setShowFacebookManualModal] = useState(false);

  useEffect(() => {
    // Проверяем наличие пользовательских данных в localStorage
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser);
        if (parsedUser && parsedUser.username) {
          setUser(parsedUser);
          // НЕ показываем онбординг при загрузке — ждём AppContext
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

  // ОТКЛЮЧЕНО: онбординг полностью выключен
  const handleOnboardingComplete = () => {};

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
          {/* Онбординг показывается ТОЛЬКО для НЕ-мультиаккаунта если prompt1 не заполнен */}
          {showOnboarding && (
            <OnboardingWizard
              onComplete={handleOnboardingComplete}
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
        
          {isNoSidebarRoute ? (
            // Routes without sidebar (e.g., WhatsApp CRM)
            <div className="min-h-screen w-full">
              <Routes>
                <Route path="/whatsapp-analysis" element={<WhatsAppAnalysis />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </div>
          ) : (
            // Routes with sidebar
            <div className="min-h-screen w-full max-w-full overflow-x-hidden">
              <SidebarProvider>
                <div className="w-full max-w-full">
                  <AppSidebar />
                  <SidebarAwareContent>
                    <Routes>
                      <Route path="/" element={<Dashboard />} />
                      <Route path="/oauth/callback" element={<OAuthCallback />} />
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
          <Route path="/oauth/callback" element={<OAuthCallback />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      )}
    </>
  );
};

const App = () => {
  const { tg, isReady } = useTelegramWebApp();
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  
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
              <Sonner position="top-center" />
              <Toaster />
              <BrowserRouter>
                <AppRoutes />
              </BrowserRouter>
            </AppProvider>
          </LanguageProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
