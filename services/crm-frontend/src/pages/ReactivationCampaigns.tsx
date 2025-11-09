import { BotStatsDashboard } from '@/components/chatbot/BotStatsDashboard';
import { ReactivationQueue } from '@/components/chatbot/ReactivationQueue';

export function ReactivationCampaigns() {
  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Кампании реактивации</h1>
      
      <div className="space-y-6">
        {/* Bot Stats */}
        <BotStatsDashboard />
        
        {/* Reactivation Queue */}
        <ReactivationQueue />
      </div>
    </div>
  );
}
