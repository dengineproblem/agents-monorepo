import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { WhatsAppCRM } from './pages/WhatsAppCRM';
import { ReactivationCampaigns } from './pages/ReactivationCampaigns';
import { Consultations } from './pages/Consultations';
import { ConsultantsPage } from './pages/ConsultantsPage';
import { ServicesPage } from './pages/ServicesPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { BotsList } from './pages/BotsList';
import { BotEditor } from './pages/BotEditor';
import { ChatsPage } from './pages/ChatsPage';
import { PublicBooking } from './pages/PublicBooking';
import Login from './pages/Login';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { initTheme } from './hooks/useTheme';

// Инициализация темы до рендера
initTheme();

const queryClient = new QueryClient();

// Layout with sidebar for authenticated pages
function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-y-auto bg-background">
        {children}
      </main>
    </div>
  );
}

const PUBLIC_PATHS = ['/login'];

function AppRoutes() {
  const location = useLocation();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAuth = () => {
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
    };

    checkAuth();

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'user') {
        checkAuth();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [location.pathname]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Public booking route - no auth required
  if (location.pathname.startsWith('/book/')) {
    return (
      <Routes>
        <Route path="/book/:userAccountId" element={<PublicBooking />} />
      </Routes>
    );
  }

  const isPublicRoute = PUBLIC_PATHS.includes(location.pathname);

  // Not authenticated - show login
  if (!user && !isPublicRoute) {
    return <Navigate to="/login" replace />;
  }

  // Authenticated user on login page - redirect to home
  if (user && isPublicRoute) {
    return <Navigate to="/" replace />;
  }

  // Public routes
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
      </Routes>
    );
  }

  // Main app with sidebar (authenticated)
  return (
    <MainLayout>
      <Routes>
        <Route path="/" element={<WhatsAppCRM />} />
        <Route path="/consultations" element={<Consultations />} />
        <Route path="/consultations/consultants" element={<ConsultantsPage />} />
        <Route path="/consultations/services" element={<ServicesPage />} />
        <Route path="/consultations/analytics" element={<AnalyticsPage />} />
        <Route path="/reactivation" element={<ReactivationCampaigns />} />
        <Route path="/bots" element={<BotsList />} />
        <Route path="/bots/chats" element={<ChatsPage />} />
        <Route path="/bots/:botId" element={<BotEditor />} />
      </Routes>
    </MainLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
        <Toaster />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
