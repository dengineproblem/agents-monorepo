import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DailyCampaignQueue } from '@/components/campaigns/DailyCampaignQueue';
import { TemplateManager } from '@/components/campaigns/TemplateManager';
import { CampaignSettings } from '@/components/campaigns/CampaignSettings';
import { CampaignStatsDashboard } from '@/components/campaigns/CampaignStatsDashboard';

export function ReactivationCampaigns() {
  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Кампании реактивации</h1>
      
      <Tabs defaultValue="queue" className="space-y-6">
        <TabsList>
          <TabsTrigger value="queue">Очередь на сегодня</TabsTrigger>
          <TabsTrigger value="templates">Шаблоны</TabsTrigger>
          <TabsTrigger value="settings">Настройки</TabsTrigger>
          <TabsTrigger value="stats">Статистика</TabsTrigger>
        </TabsList>

        <TabsContent value="queue">
          <DailyCampaignQueue />
        </TabsContent>
        
        <TabsContent value="templates">
          <TemplateManager />
        </TabsContent>
        
        <TabsContent value="settings">
          <CampaignSettings />
        </TabsContent>
        
        <TabsContent value="stats">
          <CampaignStatsDashboard />
        </TabsContent>
      </Tabs>
    </div>
  );
}
