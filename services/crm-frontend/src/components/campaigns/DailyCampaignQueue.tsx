import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { campaignApi, CampaignMessage } from '@/services/campaignApi';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { Copy, Send, Loader2, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';

const USER_ACCOUNT_ID = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b';

export function DailyCampaignQueue() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const pageSize = 20;

  // Fetch today's queue
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['campaign-queue', page],
    queryFn: () => campaignApi.getTodayQueue(USER_ACCOUNT_ID, pageSize, page * pageSize, 'pending'),
  });

  // Generate queue mutation
  const generateMutation = useMutation({
    mutationFn: () => campaignApi.generateCampaignQueue(USER_ACCOUNT_ID),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['campaign-queue'] });
      toast({ 
        title: 'Очередь сформирована', 
        description: `Создано ${result.messagesGenerated} сообщений для ${result.queueSize} лидов` 
      });
    },
    onError: () => toast({ title: 'Ошибка при формировании очереди', variant: 'destructive' }),
  });

  // Mark as copied mutation
  const copyMutation = useMutation({
    mutationFn: (messageId: string) => campaignApi.markMessageAsCopied(messageId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaign-queue'] });
      toast({ title: 'Отмечено как скопировано' });
    },
  });

  // Send auto mutation
  const sendMutation = useMutation({
    mutationFn: (messageId: string) => campaignApi.sendMessageAuto(messageId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaign-queue'] });
      toast({ title: 'Сообщение отправлено!' });
    },
    onError: (error: any) => toast({ 
      title: 'Ошибка отправки', 
      description: error.message, 
      variant: 'destructive' 
    }),
  });

  const handleCopy = (message: CampaignMessage) => {
    navigator.clipboard.writeText(message.message_text);
    copyMutation.mutate(message.id);
  };

  const getInterestBadgeVariant = (level: string) => {
    if (level === 'hot') return 'destructive';
    if (level === 'warm') return 'default';
    return 'secondary';
  };

  const getTypeBadgeVariant = (type: string) => {
    if (type === 'selling') return 'default';
    if (type === 'useful') return 'outline';
    return 'secondary';
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
          <div>
            <CardTitle>Очередь на сегодня</CardTitle>
            <CardDescription>
              Персонализированные сообщения готовы к отправке ({data?.total || 0} сообщений)
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => refetch()} variant="outline" size="sm">
              <RefreshCw className="h-4 w-4 mr-2" />
              Обновить
            </Button>
            <Button 
              onClick={() => generateMutation.mutate()} 
              disabled={generateMutation.isPending}
              size="sm"
            >
              {generateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Сформировать очередь
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          </div>
        ) : !data?.messages || data.messages.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            Нет сообщений в очереди. Нажмите "Сформировать очередь" для создания.
          </div>
        ) : (
          <div className="space-y-4">
            {data.messages.map((msg: CampaignMessage) => (
              <div key={msg.id} className="border rounded-lg p-4">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <p className="font-semibold">{msg.lead?.contact_name || 'Без имени'}</p>
                    <p className="text-sm text-gray-600">{msg.lead?.contact_phone}</p>
                    <div className="flex gap-2 mt-2">
                      <Badge variant={getInterestBadgeVariant(msg.lead?.interest_level || '')}>
                        {msg.lead?.interest_level?.toUpperCase()}
                      </Badge>
                      <Badge variant={getTypeBadgeVariant(msg.message_type)}>
                        {msg.message_type}
                      </Badge>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">
                      Score: {msg.lead?.reactivation_score?.toFixed(1) || msg.lead?.score || 0}
                    </p>
                    <p className="text-xs text-gray-500">{msg.lead?.business_type || ''}</p>
                  </div>
                </div>

                <div className="bg-gray-50 p-3 rounded mb-3">
                  <p className="text-sm whitespace-pre-wrap">{msg.message_text}</p>
                </div>

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleCopy(msg)}
                    disabled={copyMutation.isPending}
                  >
                    <Copy className="h-4 w-4 mr-1" />
                    Скопировать
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => sendMutation.mutate(msg.id)}
                    disabled={sendMutation.isPending}
                  >
                    {sendMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4 mr-1" />
                    )}
                    Отправить сейчас
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {data && data.total > pageSize && (
          <div className="flex justify-between items-center mt-4 pt-4 border-t">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Назад
            </Button>
            <span className="text-sm text-gray-600">
              Страница {page + 1} из {Math.ceil(data.total / pageSize)}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => p + 1)}
              disabled={(page + 1) * pageSize >= data.total}
            >
              Далее
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

