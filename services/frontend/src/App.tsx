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
import Privacy from './pages/Privacy';
import Terms from './pages/Terms';
import { LanguageProvider } from './i18n/LanguageContext';
import { FEATURES } from './config/appReview';

const queryClient = new QueryClient();

const PUBLIC_PATHS = ['/login', '/signup', '/privacy', '/terms'];

const AppRoutes = () => {
  const location = useLocation();
  const isPublic = PUBLIC_PATHS.includes(location.pathname);

  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true); // Всегда загружаем пользователя

  useEffect(() => {
    // Проверяем наличие пользовательских данных в localStorage
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser);
        if (parsedUser && parsedUser.username) {
          setUser(parsedUser);
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

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Загрузка...</div>;
  }

  const isPublicRoute = isPublic;

  return (
    <>
      {user && !isPublicRoute ? (
        <div className="min-h-screen w-full max-w-full overflow-x-hidden">
          <SidebarProvider>
            <div className="w-full max-w-full">
              <AppSidebar />
              <SidebarAwareContent>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/campaign/:id" element={<CampaignDetail />} />
                  {FEATURES.SHOW_CONSULTATIONS && <Route path="/consultations" element={<Consultations />} />}
                  {FEATURES.SHOW_ROI_ANALYTICS && <Route path="/roi" element={<ROIAnalytics />} />}
                  {FEATURES.SHOW_CREATIVES && <Route path="/creatives" element={<CreativeGeneration />} />}
                  {FEATURES.SHOW_CREATIVES && <Route path="/videos" element={<Creatives />} />}
                  <Route path="/profile" element={<Profile />} />
                  {FEATURES.SHOW_DIRECTIONS && <Route path="/ad-settings" element={<AdSettings />} />}
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </SidebarAwareContent>
            </div>
          </SidebarProvider>
        </div>
      ) : (
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
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
