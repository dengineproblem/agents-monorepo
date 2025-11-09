import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PromptEditor } from '@/components/chatbot/PromptEditor';
import { DocumentUploader } from '@/components/chatbot/DocumentUploader';
import { TriggersManager } from '@/components/chatbot/TriggersManager';

export function ChatbotSettings() {
  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Настройки чатбота</h1>
      
      <Tabs defaultValue="prompt" className="space-y-6">
        <TabsList>
          <TabsTrigger value="prompt">Промпт</TabsTrigger>
          <TabsTrigger value="documents">Документы</TabsTrigger>
          <TabsTrigger value="triggers">Триггеры</TabsTrigger>
        </TabsList>

        <TabsContent value="prompt" className="space-y-4">
          <PromptEditor />
        </TabsContent>

        <TabsContent value="documents" className="space-y-4">
          <DocumentUploader />
        </TabsContent>

        <TabsContent value="triggers" className="space-y-4">
          <TriggersManager />
        </TabsContent>
      </Tabs>
    </div>
  );
}
