import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { WhatsAppCRM } from './pages/WhatsAppCRM';
import { ChatbotSettings } from './pages/ChatbotSettings';
import { ReactivationCampaigns } from './pages/ReactivationCampaigns';

function App() {
  return (
    <BrowserRouter>
      <div className="flex h-screen bg-slate-50">
        <Sidebar />
        
        <main className="flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<WhatsAppCRM />} />
            <Route path="/chatbot" element={<ChatbotSettings />} />
            <Route path="/reactivation" element={<ReactivationCampaigns />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;

