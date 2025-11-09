import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { chatbotApi } from '@/services/chatbotApi';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { RefreshCw, Save, Loader2 } from 'lucide-react';

export function PromptEditor() {
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState('');

  // Fetch current configuration
  const { data: config, isLoading } = useQuery({
    queryKey: ['chatbot-config'],
    queryFn: () => chatbotApi.getConfiguration(),
  });

  // Set prompt when config loads
  useEffect(() => {
    if (config?.systemPrompt) {
      setPrompt(config.systemPrompt);
    }
  }, [config]);

  // Update configuration mutation
  const updateConfigMutation = useMutation({
    mutationFn: (systemPrompt: string) =>
      chatbotApi.updateConfiguration({ systemPrompt }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chatbot-config'] });
      toast({ title: 'Промпт сохранён' });
    },
    onError: () => {
      toast({ title: 'Ошибка при сохранении промпта', variant: 'destructive' });
    },
  });

  // Regenerate prompt mutation
  const regenerateMutation = useMutation({
    mutationFn: () => chatbotApi.regeneratePrompt(),
    onSuccess: (data) => {
      setPrompt(data.systemPrompt);
      queryClient.invalidateQueries({ queryKey: ['chatbot-config'] });
      toast({ title: 'Промпт регенерирован из документов' });
    },
    onError: () => {
      toast({ title: 'Ошибка при регенерации промпта', variant: 'destructive' });
    },
  });

  const handleSave = () => {
    updateConfigMutation.mutate(prompt);
  };

  const handleRegenerate = () => {
    if (confirm('Регенерировать промпт из загруженных документов? Текущий промпт будет заменён.')) {
      regenerateMutation.mutate();
    }
  };

  if (isLoading) {
    return (
      <div className="text-center py-8">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Системный промпт</CardTitle>
        <CardDescription>
          Промпт, который определяет поведение и знания чатбота
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Введите системный промпт для чатбота..."
          rows={15}
          className="font-mono text-sm"
        />

        <div className="flex gap-2 justify-end">
          <Button
            onClick={handleRegenerate}
            disabled={regenerateMutation.isPending}
            variant="outline"
          >
            {regenerateMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Регенерировать из документов
          </Button>
          <Button
            onClick={handleSave}
            disabled={updateConfigMutation.isPending}
          >
            {updateConfigMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Сохранить
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

