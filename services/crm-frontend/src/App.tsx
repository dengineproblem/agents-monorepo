import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { WhatsAppCRM } from './pages/WhatsAppCRM';
import { ReactivationCampaigns } from './pages/ReactivationCampaigns';
import { Consultations } from './pages/Consultations';
import { BotsList } from './pages/BotsList';
import { BotEditor } from './pages/BotEditor';
import { PublicBooking } from './pages/PublicBooking';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';

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

function AppRoutes() {
  const location = useLocation();

  // Public routes without sidebar
  if (location.pathname.startsWith('/book/')) {
    return (
      <Routes>
        <Route path="/book/:userAccountId" element={<PublicBooking />} />
      </Routes>
    );
  }

  // Main app with sidebar
  return (
    <MainLayout>
      <Routes>
        <Route path="/" element={<WhatsAppCRM />} />
        <Route path="/consultations" element={<Consultations />} />
        <Route path="/reactivation" element={<ReactivationCampaigns />} />
        <Route path="/bots" element={<BotsList />} />
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
