import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { WhatsAppCRM } from './pages/WhatsAppCRM';
import { ChatbotSettings } from './pages/ChatbotSettings';
import { ReactivationCampaigns } from './pages/ReactivationCampaigns';
import { Consultations } from './pages/Consultations';
import { BotsList } from './pages/BotsList';
import { BotEditor } from './pages/BotEditor';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div className="flex h-screen bg-background">
          <Sidebar />

          <main className="flex-1 overflow-y-auto bg-background">
            <Routes>
              <Route path="/" element={<WhatsAppCRM />} />
              <Route path="/consultations" element={<Consultations />} />
              <Route path="/chatbot" element={<ChatbotSettings />} />
              <Route path="/reactivation" element={<ReactivationCampaigns />} />
              <Route path="/bots" element={<BotsList />} />
              <Route path="/bots/:botId" element={<BotEditor />} />
            </Routes>
          </main>
        </div>
        <Toaster />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
