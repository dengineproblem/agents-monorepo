import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { campaignApi, CampaignMessage, GenerateQueueResponse } from '@/services/campaignApi';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { Copy, Send, Loader2, ChevronLeft, ChevronRight, RefreshCw, Trash2, Play, AlertCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';

const USER_ACCOUNT_ID = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b';

const strategyLabels: Record<string, string> = {
  check_in: '✓ Check-in',
  value: '💡 Value',
  case: '📊 Case',
  offer: '🎁 Offer',
  direct_selling: '🎯 Direct'
};

const getStrategyLabel = (strategy: string): string => {
  return strategyLabels[strategy] || strategy;
};

export function DailyCampaignQueue() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const pageSize = 20;
  const [showQueueDialog, setShowQueueDialog] = useState(false);
  const [queueDecision, setQueueDecision] = useState<GenerateQueueResponse | null>(null);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [scheduleInfo, setScheduleInfo] = useState<any>(null);

  // Fetch today's queue
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['campaign-queue', page],
    queryFn: () => campaignApi.getTodayQueue(USER_ACCOUNT_ID, pageSize, page * pageSize, 'pending'),
  });

  // Generate queue mutation
  const generateMutation = useMutation({
    mutationFn: async (action?: 'replace' | 'merge') => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000);
      
      try {
        const result = await campaignApi.generateQueueWithAction(USER_ACCOUNT_ID, action);
        clearTimeout(timeoutId);
        return result;
      } catch (error: any) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
          throw new Error('Запрос прерван: превышено время ожидания (2 минуты)');
        }
        throw error;
      }
    },
    onSuccess: (result) => {
      if (result.needsDecision) {
        // Show dialog for user decision
        setQueueDecision(result);
        setShowQueueDialog(true);
      } else {
        queryClient.invalidateQueries({ queryKey: ['campaign-queue'] });
        const message = result.merged 
          ? `Очередь обновлена (${result.queueSize} сообщений)`
          : `Создано ${result.messagesGenerated} сообщений для ${result.queueSize} лидов`;
        toast({ 
          title: 'Очередь сформирована', 
          description: message 
        });
      }
    },
    onError: (error: Error) => toast({ 
      title: 'Ошибка при формировании очереди', 
      description: error.message,
      variant: 'destructive' 
    }),
  });

  // Manual send mutation
  const manualSendMutation = useMutation({
    mutationFn: () => campaignApi.startManualSend(USER_ACCOUNT_ID),
    onSuccess: (result) => {
      setScheduleInfo(result);
      setShowScheduleDialog(true);
      queryClient.invalidateQueries({ queryKey: ['campaign-queue'] });
    },
    onError: (error: Error) => toast({ 
      title: 'Ошибка при запуске отправки', 
      description: error.message,
      variant: 'destructive' 
    }),
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

  // Clear queue mutation
  const clearMutation = useMutation({
    mutationFn: () => campaignApi.clearCampaignQueue(USER_ACCOUNT_ID),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['campaign-queue'] });
      toast({ 
        title: 'Очередь очищена', 
        description: `Удалено ${result.deletedCount} сообщений` 
      });
    },
    onError: (error: any) => toast({ 
      title: 'Ошибка очистки', 
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
              onClick={() => clearMutation.mutate()} 
              disabled={clearMutation.isPending || !data?.total}
              variant="outline"
              size="sm"
            >
              {clearMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Очистить очередь
            </Button>
            <Button 
              onClick={() => generateMutation.mutate()} 
              disabled={generateMutation.isPending}
              variant="outline"
              size="sm"
            >
              {generateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Сформировать очередь
            </Button>
            <Button 
              onClick={() => manualSendMutation.mutate()} 
              disabled={manualSendMutation.isPending || !data?.total}
              size="sm"
            >
              {manualSendMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Запустить отправку
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
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            Нет сообщений в очереди. Нажмите "Сформировать очередь" для создания.
          </div>
        ) : (
          <div className="space-y-4">
            {data.messages.map((msg: CampaignMessage) => (
              <div key={msg.id} className="border rounded-lg p-4">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <p className="font-semibold">{msg.lead?.contact_name || 'Без имени'}</p>
                    <p className="text-sm text-gray-600 dark:text-gray-300">{msg.lead?.contact_phone}</p>
                    <div className="flex gap-2 mt-2 flex-wrap">
                      <Badge variant={getInterestBadgeVariant(msg.lead?.interest_level || '')}>
                        {msg.lead?.interest_level?.toUpperCase()}
                      </Badge>
                      <Badge variant={getTypeBadgeVariant(msg.message_type)}>
                        {msg.message_type}
                      </Badge>
                      {(msg as any).strategy_type && (
                        <Badge variant="secondary">
                          {getStrategyLabel((msg as any).strategy_type)}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">
                      Score: {msg.lead?.score || 0}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{msg.lead?.business_type || ''}</p>
                  </div>
                </div>

                <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded mb-3">
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

      {/* Dialog for existing queue decision */}
      <Dialog open={showQueueDialog} onOpenChange={setShowQueueDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <AlertCircle className="h-5 w-5 inline mr-2 text-yellow-500" />
              Обнаружена существующая очередь
            </DialogTitle>
            <DialogDescription>
              В очереди уже есть {queueDecision?.existingQueue?.count} сообщений, 
              созданных {new Date(queueDecision?.existingQueue?.createdAt || '').toLocaleString('ru-RU')}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <Alert>
              <AlertTitle>Что сделать?</AlertTitle>
              <AlertDescription className="space-y-2 mt-2">
                <div className="flex items-start gap-2">
                  <span className="font-semibold">Заменить:</span>
                  <span className="text-sm">Старые сообщения будут удалены, создастся новая очередь</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="font-semibold">Добавить:</span>
                  <span className="text-sm">Новые лиды добавятся к существующим (дубли пропустятся)</span>
                </div>
              </AlertDescription>
            </Alert>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setShowQueueDialog(false)}
            >
              Отмена
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setShowQueueDialog(false);
                generateMutation.mutate('merge');
              }}
            >
              Добавить к существующей
            </Button>
            <Button
              onClick={() => {
                setShowQueueDialog(false);
                generateMutation.mutate('replace');
              }}
            >
              Заменить старую очередь
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog for send schedule info */}
      <Dialog open={showScheduleDialog} onOpenChange={setShowScheduleDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {scheduleInfo?.mode === 'immediate' ? '⚡ Отправка началась' : '⏰ Отправка запланирована'}
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {scheduleInfo?.mode === 'immediate' ? (
              <Alert>
                <AlertTitle>Сообщения отправляются прямо сейчас</AlertTitle>
                <AlertDescription className="space-y-2 mt-2">
                  <div>Сообщений в очереди: <strong>{scheduleInfo.queueSize}</strong></div>
                  <div>Скорость: <strong>~{scheduleInfo.messagesPerHour} сообщений/час</strong></div>
                  <div>Ожидаемая длительность: <strong>{scheduleInfo.estimatedDuration}</strong></div>
                </AlertDescription>
              </Alert>
            ) : (
              <Alert>
                <AlertTitle>Отправка начнётся в рабочее время</AlertTitle>
                <AlertDescription className="space-y-2 mt-2">
                  <div>Начало: <strong>{scheduleInfo?.nextWorkingTime}</strong></div>
                  <div>Сообщений: <strong>{scheduleInfo?.queueSize}</strong></div>
                  <div>Скорость: <strong>~{scheduleInfo?.messagesPerHour} сообщений/час</strong></div>
                  <div>Длительность: <strong>{scheduleInfo?.estimatedDuration}</strong></div>
                </AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button onClick={() => setShowScheduleDialog(false)}>
              Понятно
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

