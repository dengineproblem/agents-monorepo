import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, Bot, MoreVertical, Power, Copy, Trash2, Edit, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { aiBotApi } from '@/services/aiBotApi';
import type { AIBotConfiguration } from '@/types/aiBot';
import { AI_MODELS } from '@/types/aiBot';

const USER_ID = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b';

export function BotsList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [botToDelete, setBotToDelete] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['ai-bots', USER_ID],
    queryFn: () => aiBotApi.getBots(USER_ID),
  });

  const createMutation = useMutation({
    mutationFn: () => aiBotApi.createBot({ userAccountId: USER_ID }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['ai-bots'] });
      toast({ title: 'Бот создан', description: 'Перенаправление на редактирование...' });
      navigate(`/bots/${data.bot.id}`);
    },
    onError: () => {
      toast({ title: 'Ошибка', description: 'Не удалось создать бота', variant: 'destructive' });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (botId: string) => aiBotApi.toggleBot(botId),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['ai-bots'] });
      toast({
        title: data.bot.isActive ? 'Бот активирован' : 'Бот деактивирован',
      });
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: (botId: string) => aiBotApi.duplicateBot(botId),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['ai-bots'] });
      toast({ title: 'Бот скопирован', description: 'Создана копия бота' });
      navigate(`/bots/${data.bot.id}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (botId: string) => aiBotApi.deleteBot(botId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-bots'] });
      toast({ title: 'Бот удалён' });
      setDeleteDialogOpen(false);
      setBotToDelete(null);
    },
  });

  const handleDelete = (botId: string) => {
    setBotToDelete(botId);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (botToDelete) {
      deleteMutation.mutate(botToDelete);
    }
  };

  const getModelName = (modelId: string) => {
    const model = AI_MODELS.find(m => m.id === modelId);
    return model?.name || modelId;
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center text-red-500">
          Ошибка загрузки ботов. Попробуйте обновить страницу.
        </div>
      </div>
    );
  }

  const bots = data?.bots || [];

  return (
    <div className="container mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">AI-боты WhatsApp</h1>
          <p className="text-muted-foreground mt-1">
            Создавайте и настраивайте ботов для автоматических ответов
          </p>
        </div>
        <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
          {createMutation.isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Plus className="w-4 h-4 mr-2" />
          )}
          Создать бота
        </Button>
      </div>

      {bots.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Bot className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Нет ботов</h3>
            <p className="text-muted-foreground text-center mb-4">
              Создайте своего первого AI-бота для автоматизации ответов в WhatsApp
            </p>
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
              <Plus className="w-4 h-4 mr-2" />
              Создать бота
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {bots.map((bot: AIBotConfiguration) => (
            <Card
              key={bot.id}
              className={`cursor-pointer transition-all hover:shadow-md ${
                !bot.isActive ? 'opacity-60' : ''
              }`}
              onClick={() => navigate(`/bots/${bot.id}`)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={`p-2 rounded-lg ${
                        bot.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      <Bot className="w-5 h-5" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">{bot.name}</CardTitle>
                      <CardDescription className="text-sm">
                        {getModelName(bot.model)}
                      </CardDescription>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/bots/${bot.id}`);
                        }}
                      >
                        <Edit className="w-4 h-4 mr-2" />
                        Редактировать
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleMutation.mutate(bot.id);
                        }}
                      >
                        <Power className="w-4 h-4 mr-2" />
                        {bot.isActive ? 'Деактивировать' : 'Активировать'}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          duplicateMutation.mutate(bot.id);
                        }}
                      >
                        <Copy className="w-4 h-4 mr-2" />
                        Дублировать
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-red-600"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(bot.id);
                        }}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Удалить
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2 mb-3">
                  <Badge variant={bot.isActive ? 'default' : 'secondary'}>
                    {bot.isActive ? 'Активен' : 'Неактивен'}
                  </Badge>
                  {bot.voiceRecognitionEnabled && (
                    <Badge variant="outline">Голос</Badge>
                  )}
                  {bot.imageRecognitionEnabled && (
                    <Badge variant="outline">Изображения</Badge>
                  )}
                  {bot.scheduleEnabled && (
                    <Badge variant="outline">По расписанию</Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {bot.systemPrompt
                    ? bot.systemPrompt.substring(0, 100) + (bot.systemPrompt.length > 100 ? '...' : '')
                    : 'Промпт не задан'}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить бота?</AlertDialogTitle>
            <AlertDialogDescription>
              Это действие нельзя отменить. Бот и все его настройки будут удалены навсегда.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : null}
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
