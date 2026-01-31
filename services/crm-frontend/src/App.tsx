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
import { ConsultantPage } from './pages/ConsultantPage';
import { useAuth } from './contexts/AuthContext';
import { initTheme } from './hooks/useTheme';

// Инициализация темы до рендера
initTheme();

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
  const { user, loading, isAuthenticated, isConsultant } = useAuth();

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
  if (!isAuthenticated && !isPublicRoute) {
    return <Navigate to="/login" replace />;
  }

  // Authenticated consultant on non-consultant page - redirect to consultant page
  if (isConsultant && user?.consultantId && !location.pathname.startsWith('/c/') && !isPublicRoute) {
    return <Navigate to={`/c/${user.consultantId}`} replace />;
  }

  // Authenticated user on login page - redirect to appropriate home
  if (isAuthenticated && isPublicRoute) {
    if (isConsultant && user?.consultantId) {
      return <Navigate to={`/c/${user.consultantId}`} replace />;
    }
    return <Navigate to="/" replace />;
  }

  // Public routes
  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
      </Routes>
    );
  }

  // Consultant page - no sidebar for both consultants and admins viewing consultant page
  if (location.pathname.startsWith('/c/')) {
    return (
      <Routes>
        <Route path="/c/:consultantId" element={<ConsultantPage />} />
      </Routes>
    );
  }

  // Consultant routes - simplified layout without full sidebar
  if (isConsultant) {
    return (
      <Routes>
        <Route path="/c/:consultantId" element={<ConsultantPage />} />
      </Routes>
    );
  }

  // Main app with sidebar (authenticated admin/manager)
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
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

export default App;
