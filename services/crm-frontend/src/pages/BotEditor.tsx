import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Save,
  Loader2,
  Bot,
  Settings2,
  Clock,
  Image,
  Bell,
  Shield,
  Zap,
  Link2,
  Smartphone,
  Unlink,
  Calendar,
  Plus,
  Trash2,
  MessagesSquare,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { aiBotApi, type LinkedInstance, type WhatsAppInstance } from '@/services/aiBotApi';
import type { AIBotConfiguration, UpdateBotRequest } from '@/types/aiBot';
import { AI_MODELS, TIMEZONES, DAYS_OF_WEEK, DEFAULT_CONSULTATION_SETTINGS } from '@/types/aiBot';
import { consultationService, type Consultant } from '@/services/consultationService';
import { BotTestChat } from '@/components/bots/BotTestChat';

const USER_ID = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b';

// Tags input component for phrases
function TagsInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder: string;
}) {
  const [inputValue, setInputValue] = useState('');

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && inputValue.trim()) {
      e.preventDefault();
      if (!value.includes(inputValue.trim())) {
        onChange([...value, inputValue.trim()]);
      }
      setInputValue('');
    }
  };

  const removeTag = (tag: string) => {
    onChange(value.filter((t) => t !== tag));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 mb-2">
        {value.map((tag) => (
          <Badge key={tag} variant="secondary" className="cursor-pointer" onClick={() => removeTag(tag)}>
            {tag} <span className="ml-1">&times;</span>
          </Badge>
        ))}
      </div>
      <Input
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
      />
      <p className="text-xs text-muted-foreground">Введите фразу и нажмите Enter</p>
    </div>
  );
}

export function BotEditor() {
  const { botId } = useParams<{ botId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [formData, setFormData] = useState<Partial<AIBotConfiguration>>({});
  const [hasChanges, setHasChanges] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['ai-bot', botId],
    queryFn: () => aiBotApi.getBot(botId!),
    enabled: !!botId,
  });

  // Fetch linked WhatsApp instances
  const { data: linkedInstancesData } = useQuery({
    queryKey: ['ai-bot-linked-instances', botId],
    queryFn: () => aiBotApi.getLinkedInstances(botId!),
    enabled: !!botId,
  });

  const linkedInstances = linkedInstancesData?.instances || [];

  // Fetch all user's WhatsApp instances
  const { data: allInstancesData } = useQuery({
    queryKey: ['whatsapp-instances', USER_ID],
    queryFn: () => aiBotApi.getWhatsAppInstances(USER_ID),
  });

  const allInstances = allInstancesData?.instances || [];
  const unlinkedInstances = allInstances.filter(
    (inst) => inst.status === 'connected' && (!inst.aiBotId || inst.aiBotId !== botId)
  );

  // Consultants for integrations
  const { data: consultantsData } = useQuery({
    queryKey: ['consultants'],
    queryFn: () => consultationService.getConsultants(USER_ID),
  });
  const consultants = consultantsData || [];

  // Link/unlink bot to instance mutation
  const linkMutation = useMutation({
    mutationFn: ({ instanceId, newBotId }: { instanceId: string; newBotId: string | null }) =>
      aiBotApi.linkBotToInstance(instanceId, newBotId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['ai-bot-linked-instances', botId] });
      queryClient.invalidateQueries({ queryKey: ['whatsapp-instances'] });
      toast({
        title: variables.newBotId ? 'Инстанс привязан' : 'Инстанс отвязан',
        description: variables.newBotId
          ? 'Бот теперь будет отвечать в этом WhatsApp'
          : 'Бот больше не отвечает в этом WhatsApp',
      });
    },
    onError: () => {
      toast({ title: 'Ошибка', description: 'Не удалось изменить привязку', variant: 'destructive' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (updates: UpdateBotRequest) => aiBotApi.updateBot(botId!, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-bot', botId] });
      queryClient.invalidateQueries({ queryKey: ['ai-bots'] });
      toast({ title: 'Сохранено', description: 'Настройки бота обновлены' });
      setHasChanges(false);
    },
    onError: () => {
      toast({ title: 'Ошибка', description: 'Не удалось сохранить', variant: 'destructive' });
    },
  });

  useEffect(() => {
    if (data?.bot) {
      setFormData(data.bot);
    }
  }, [data]);

  const updateField = <K extends keyof AIBotConfiguration>(key: K, value: AIBotConfiguration[K]) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleSave = () => {
    const updates: UpdateBotRequest = { ...formData };
    delete (updates as any).id;
    delete (updates as any).userAccountId;
    delete (updates as any).createdAt;
    delete (updates as any).updatedAt;
    updateMutation.mutate(updates);
  };

  const toggleConsultant = (consultantId: string) => {
    const settings = formData.consultationSettings || DEFAULT_CONSULTATION_SETTINGS;
    const currentIds = settings.consultantIds || [];
    if (currentIds.includes(consultantId)) {
      updateField('consultationSettings', { ...settings, consultantIds: currentIds.filter(id => id !== consultantId) });
    } else {
      updateField('consultationSettings', { ...settings, consultantIds: [...currentIds, consultantId] });
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data?.bot) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center text-red-500">Бот не найден</div>
      </div>
    );
  }

  const consultationSettings = formData.consultationSettings || DEFAULT_CONSULTATION_SETTINGS;

  return (
    <div className="container mx-auto p-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/bots')}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Bot className="w-6 h-6" />
              {formData.name || 'Настройка бота'}
            </h1>
            <p className="text-muted-foreground">
              {formData.isActive ? 'Активен' : 'Неактивен'} • {AI_MODELS.find(m => m.id === formData.model)?.name}
            </p>
          </div>
        </div>
        <Button onClick={handleSave} disabled={!hasChanges || updateMutation.isPending}>
          {updateMutation.isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Save className="w-4 h-4 mr-2" />
          )}
          Сохранить
        </Button>
      </div>

      <Tabs defaultValue="general" className="space-y-6">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="general" className="flex items-center gap-1">
            <Bot className="w-4 h-4" />
            <span className="hidden sm:inline">Основное</span>
          </TabsTrigger>
          <TabsTrigger value="whatsapp" className="flex items-center gap-1">
            <Smartphone className="w-4 h-4" />
            <span className="hidden sm:inline">WhatsApp</span>
          </TabsTrigger>
          <TabsTrigger value="behavior" className="flex items-center gap-1">
            <Settings2 className="w-4 h-4" />
            <span className="hidden sm:inline">Поведение</span>
          </TabsTrigger>
          <TabsTrigger value="integrations" className="flex items-center gap-1">
            <Zap className="w-4 h-4" />
            <span className="hidden sm:inline">Интеграции</span>
          </TabsTrigger>
          <TabsTrigger value="test" className="flex items-center gap-1">
            <MessagesSquare className="w-4 h-4" />
            <span className="hidden sm:inline">Тест</span>
          </TabsTrigger>
        </TabsList>

        {/* ===== TAB 1: GENERAL - Основное ===== */}
        <TabsContent value="general">
          <div className="space-y-6">
            {/* Имя и статус */}
            <Card>
              <CardHeader>
                <CardTitle>Основные настройки</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="name">Имя агента</Label>
                    <Input
                      id="name"
                      value={formData.name || ''}
                      onChange={(e) => updateField('name', e.target.value)}
                      placeholder="Мой бот"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Статус</Label>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={formData.isActive || false}
                        onCheckedChange={(checked) => updateField('isActive', checked)}
                      />
                      <span>{formData.isActive ? 'Активен' : 'Неактивен'}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Модель */}
            <Card>
              <CardHeader>
                <CardTitle>Языковая модель</CardTitle>
              </CardHeader>
              <CardContent>
                <Select
                  value={formData.model}
                  onValueChange={(value) => updateField('model', value as AIBotConfiguration['model'])}
                >
                  <SelectTrigger className="w-full max-w-xs">
                    <SelectValue placeholder="Выберите модель" />
                  </SelectTrigger>
                  <SelectContent>
                    {AI_MODELS.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        <div className="flex flex-col">
                          <span>{model.name}</span>
                          <span className="text-xs text-muted-foreground">{model.description}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>

            {/* Температура */}
            <Card>
              <CardHeader>
                <CardTitle>Температура</CardTitle>
                <CardDescription>Контролирует креативность ответов</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between text-sm">
                    <span>Значение: {Math.round((formData.temperature || 0.24) * 100)}%</span>
                  </div>
                  <Slider
                    value={[(formData.temperature || 0.24) * 100]}
                    onValueChange={([value]) => updateField('temperature', value / 100)}
                    max={100}
                    step={1}
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Предсказуемый</span>
                    <span>Креативный</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Системный промпт */}
            <Card>
              <CardHeader>
                <CardTitle>Инструкция для ИИ-агента</CardTitle>
                <CardDescription>Системный промпт определяет поведение и знания бота</CardDescription>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={formData.systemPrompt || ''}
                  onChange={(e) => updateField('systemPrompt', e.target.value)}
                  placeholder="Опишите роль бота, его знания, правила ответов..."
                  className="min-h-[300px] font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground mt-2">
                  Символов: {(formData.systemPrompt || '').length}
                </p>
              </CardContent>
            </Card>

            {/* Сообщения */}
            <Card>
              <CardHeader>
                <CardTitle>Сообщения</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Стартовое сообщение</Label>
                  <Textarea
                    value={formData.startMessage || ''}
                    onChange={(e) => updateField('startMessage', e.target.value)}
                    placeholder="Сообщение при начале диалога (оставьте пустым, если не нужно)"
                    rows={2}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Сообщение об ошибке</Label>
                  <Textarea
                    value={formData.errorMessage || ''}
                    onChange={(e) => updateField('errorMessage', e.target.value)}
                    placeholder="Сообщение при ошибке сервиса"
                    rows={2}
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ===== TAB 2: WHATSAPP ===== */}
        <TabsContent value="whatsapp">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Link2 className="w-5 h-5" />
                Привязанные WhatsApp инстансы
              </CardTitle>
              <CardDescription>
                Этот бот автоматически отвечает на сообщения в следующих WhatsApp аккаунтах
              </CardDescription>
            </CardHeader>
            <CardContent>
              {linkedInstances.length === 0 ? (
                <div className="text-center py-8">
                  <Smartphone className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">Нет привязанных WhatsApp инстансов</p>
                  <p className="text-sm text-muted-foreground mt-2">
                    Выберите инстанс ниже, чтобы привязать к этому боту
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {linkedInstances.map((instance: LinkedInstance) => (
                    <div
                      key={instance.id}
                      className="flex items-center justify-between p-4 rounded-lg border bg-green-50 dark:bg-green-950/30"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-full bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                          <Smartphone className="w-4 h-4" />
                        </div>
                        <div className="font-medium">
                          {instance.phoneNumber || instance.instanceName}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => linkMutation.mutate({ instanceId: instance.id, newBotId: null })}
                        disabled={linkMutation.isPending}
                      >
                        <Unlink className="w-4 h-4 mr-1" />
                        Отвязать
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {unlinkedInstances.length > 0 && (
                <>
                  <Separator className="my-6" />
                  <div>
                    <h4 className="font-medium mb-3">Доступные для привязки</h4>
                    <div className="space-y-3">
                      {unlinkedInstances.map((instance: WhatsAppInstance) => (
                        <div
                          key={instance.id}
                          className="flex items-center justify-between p-4 rounded-lg border bg-muted/30"
                        >
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                              <Smartphone className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="font-medium">
                                {instance.phoneNumber || instance.instanceName}
                              </div>
                              {instance.linkedBot && (
                                <div className="text-xs text-orange-600 dark:text-orange-400">
                                  Привязан к: {instance.linkedBot.name}
                                </div>
                              )}
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => linkMutation.mutate({ instanceId: instance.id, newBotId: botId! })}
                            disabled={linkMutation.isPending}
                          >
                            <Link2 className="w-4 h-4 mr-1" />
                            Привязать
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== TAB 3: BEHAVIOR - Поведение ===== */}
        <TabsContent value="behavior">
          <div className="space-y-6">
            {/* История и буфер */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings2 className="w-5 h-5" />
                  История диалога
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Лимит токенов</Label>
                    <Input
                      type="number"
                      value={formData.historyTokenLimit || 10000}
                      onChange={(e) => updateField('historyTokenLimit', parseInt(e.target.value) || 10000)}
                      min={0}
                      max={128000}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Лимит сообщений</Label>
                    <Input
                      type="number"
                      value={formData.historyMessageLimit || ''}
                      onChange={(e) => updateField('historyMessageLimit', e.target.value ? parseInt(e.target.value) : null)}
                      placeholder="Без лимита"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Лимит часов</Label>
                    <Input
                      type="number"
                      value={formData.historyTimeLimitHours || ''}
                      onChange={(e) => updateField('historyTimeLimitHours', e.target.value ? parseInt(e.target.value) : null)}
                      placeholder="Без лимита"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Буфер сообщений: {formData.messageBufferSeconds || 7} сек</Label>
                  <Slider
                    value={[formData.messageBufferSeconds || 7]}
                    onValueChange={([value]) => updateField('messageBufferSeconds', value)}
                    min={1}
                    max={60}
                    step={1}
                  />
                  <p className="text-xs text-muted-foreground">Склеивает несколько быстрых сообщений в одно</p>
                </div>
              </CardContent>
            </Card>

            {/* Оператор */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="w-5 h-5" />
                  Контроль оператора
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Пауза при вмешательстве</Label>
                    <p className="text-sm text-muted-foreground">Бот приостанавливается когда оператор пишет</p>
                  </div>
                  <Switch
                    checked={formData.operatorPauseEnabled ?? true}
                    onCheckedChange={(checked) => updateField('operatorPauseEnabled', checked)}
                  />
                </div>
                {formData.operatorPauseEnabled && (
                  <>
                    <div className="flex items-center justify-between">
                      <Label>Игнорировать первое сообщение</Label>
                      <Switch
                        checked={formData.operatorPauseIgnoreFirstMessage || false}
                        onCheckedChange={(checked) => updateField('operatorPauseIgnoreFirstMessage', checked)}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Автовозобновление (часы)</Label>
                        <Input
                          type="number"
                          value={formData.operatorAutoResumeHours ?? 1}
                          onChange={(e) => {
                            const val = e.target.value === '' ? 0 : parseInt(e.target.value);
                            updateField('operatorAutoResumeHours', isNaN(val) ? 0 : Math.min(72, Math.max(0, val)));
                          }}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Минуты</Label>
                        <Input
                          type="number"
                          value={formData.operatorAutoResumeMinutes ?? 0}
                          onChange={(e) => {
                            const val = e.target.value === '' ? 0 : parseInt(e.target.value);
                            updateField('operatorAutoResumeMinutes', isNaN(val) ? 0 : Math.min(59, Math.max(0, val)));
                          }}
                        />
                      </div>
                    </div>
                  </>
                )}
                <Separator />
                <div className="space-y-2">
                  <Label>Фразы для остановки бота</Label>
                  <TagsInput
                    value={formData.stopPhrases || []}
                    onChange={(tags) => updateField('stopPhrases', tags)}
                    placeholder="Например: стоп"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Фразы для возобновления</Label>
                  <TagsInput
                    value={formData.resumePhrases || []}
                    onChange={(tags) => updateField('resumePhrases', tags)}
                    placeholder="Например: продолжай"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Время */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="w-5 h-5" />
                  Расписание
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label>Передавать текущую дату боту</Label>
                  <Switch
                    checked={formData.passCurrentDatetime ?? true}
                    onCheckedChange={(checked) => updateField('passCurrentDatetime', checked)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Часовой пояс</Label>
                  <Select
                    value={formData.timezone || 'Asia/Yekaterinburg'}
                    onValueChange={(value) => updateField('timezone', value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIMEZONES.map((tz) => (
                        <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Включить расписание</Label>
                    <p className="text-sm text-muted-foreground">Бот работает только в указанное время</p>
                  </div>
                  <Switch
                    checked={formData.scheduleEnabled || false}
                    onCheckedChange={(checked) => updateField('scheduleEnabled', checked)}
                  />
                </div>
                {formData.scheduleEnabled && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Начало (час)</Label>
                        <Input
                          type="number"
                          value={formData.scheduleHoursStart ?? 9}
                          onChange={(e) => updateField('scheduleHoursStart', parseInt(e.target.value) || 0)}
                          min={0}
                          max={23}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Конец (час)</Label>
                        <Input
                          type="number"
                          value={formData.scheduleHoursEnd ?? 19}
                          onChange={(e) => updateField('scheduleHoursEnd', parseInt(e.target.value) || 0)}
                          min={0}
                          max={23}
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {DAYS_OF_WEEK.map((day) => (
                        <Badge
                          key={day.value}
                          variant={(formData.scheduleDays || [1,2,3,4,5,6,7]).includes(day.value) ? 'default' : 'outline'}
                          className="cursor-pointer"
                          onClick={() => {
                            const current = formData.scheduleDays || [1,2,3,4,5,6,7];
                            const newDays = current.includes(day.value)
                              ? current.filter((d) => d !== day.value)
                              : [...current, day.value].sort();
                            updateField('scheduleDays', newDays);
                          }}
                        >
                          {day.label}
                        </Badge>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Медиа */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Image className="w-5 h-5" />
                  Медиа
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Распознавать голосовые</Label>
                    <p className="text-sm text-muted-foreground">Через Whisper</p>
                  </div>
                  <Switch
                    checked={formData.voiceRecognitionEnabled ?? true}
                    onCheckedChange={(checked) => updateField('voiceRecognitionEnabled', checked)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Распознавать изображения</Label>
                    <p className="text-sm text-muted-foreground">Через Vision API</p>
                  </div>
                  <Switch
                    checked={formData.imageRecognitionEnabled ?? true}
                    onCheckedChange={(checked) => updateField('imageRecognitionEnabled', checked)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Распознавать документы</Label>
                    <p className="text-sm text-muted-foreground">PDF, DOCX, TXT</p>
                  </div>
                  <Switch
                    checked={formData.documentRecognitionEnabled || false}
                    onCheckedChange={(checked) => updateField('documentRecognitionEnabled', checked)}
                  />
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <Label>Очистка Markdown</Label>
                  <Switch
                    checked={formData.cleanMarkdown ?? true}
                    onCheckedChange={(checked) => updateField('cleanMarkdown', checked)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label>Деление длинных сообщений</Label>
                  <Switch
                    checked={formData.splitMessages || false}
                    onCheckedChange={(checked) => updateField('splitMessages', checked)}
                  />
                </div>
                {formData.splitMessages && (
                  <div className="space-y-2">
                    <Label>Максимальная длина сообщения (символов)</Label>
                    <Input
                      type="number"
                      min={100}
                      max={2000}
                      value={formData.splitMaxLength || 500}
                      onChange={(e) => updateField('splitMaxLength', parseInt(e.target.value) || 500)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Сообщения длиннее будут разделены на части (100-2000)
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ===== TAB 4: INTEGRATIONS ===== */}
        <TabsContent value="integrations">
          <div className="space-y-6">
            {/* Консультации */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="w-5 h-5" />
                  Запись на консультации
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Включить интеграцию</Label>
                    <p className="text-sm text-muted-foreground">Бот сможет записывать клиентов</p>
                  </div>
                  <Switch
                    checked={formData.consultationIntegrationEnabled ?? false}
                    onCheckedChange={(enabled) => {
                      updateField('consultationIntegrationEnabled', enabled);
                      // При включении устанавливаем дефолтные настройки если их нет
                      if (enabled && !formData.consultationSettings) {
                        updateField('consultationSettings', DEFAULT_CONSULTATION_SETTINGS);
                      }
                    }}
                  />
                </div>
                {formData.consultationIntegrationEnabled && (
                  <>
                    <div className="space-y-2">
                      <Label>Консультанты</Label>
                      <div className="flex flex-wrap gap-2">
                        {consultants.length === 0 ? (
                          <p className="text-sm text-muted-foreground">Нет консультантов</p>
                        ) : (
                          consultants.map((consultant: Consultant) => (
                            <Badge
                              key={consultant.id}
                              variant={consultationSettings.consultantIds?.includes(consultant.id) ? 'default' : 'outline'}
                              className="cursor-pointer"
                              onClick={() => toggleConsultant(consultant.id)}
                            >
                              {consultant.name}
                            </Badge>
                          ))
                        )}
                      </div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Длительность (мин)</Label>
                        <Select
                          value={String(consultationSettings.defaultDurationMinutes || 60)}
                          onValueChange={(v) => updateField('consultationSettings', { ...consultationSettings, defaultDurationMinutes: Number(v) })}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="30">30 минут</SelectItem>
                            <SelectItem value="60">1 час</SelectItem>
                            <SelectItem value="90">1.5 часа</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Слотов показывать</Label>
                        <Select
                          value={String(consultationSettings.slotsToShow || 5)}
                          onValueChange={(v) => updateField('consultationSettings', { ...consultationSettings, slotsToShow: Number(v) })}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="3">3</SelectItem>
                            <SelectItem value="5">5</SelectItem>
                            <SelectItem value="7">7</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Follow-up */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="w-5 h-5" />
                  Follow-up сообщения
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Включить follow-up</Label>
                    <p className="text-sm text-muted-foreground">Напоминание если клиент не ответил</p>
                  </div>
                  <Switch
                    checked={formData.delayedScheduleEnabled || false}
                    onCheckedChange={(checked) => updateField('delayedScheduleEnabled', checked)}
                  />
                </div>
                {formData.delayedScheduleEnabled && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Рабочие часы: начало</Label>
                        <Input
                          type="number"
                          value={formData.delayedScheduleHoursStart ?? 9}
                          onChange={(e) => updateField('delayedScheduleHoursStart', parseInt(e.target.value) || 9)}
                          min={0}
                          max={23}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Конец</Label>
                        <Input
                          type="number"
                          value={formData.delayedScheduleHoursEnd ?? 19}
                          onChange={(e) => updateField('delayedScheduleHoursEnd', parseInt(e.target.value) || 19)}
                          min={0}
                          max={23}
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <Label>Цепочка follow-up (до 3)</Label>
                      {(formData.delayedMessages?.length || 0) < 3 && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const current = formData.delayedMessages || [];
                            updateField('delayedMessages', [
                              ...current,
                              { hours: 0, minutes: 30, prompt: '', repeatCount: 1, offHoursBehavior: 'next_day_at_time' }
                            ]);
                          }}
                        >
                          <Plus className="w-4 h-4 mr-1" />
                          Добавить
                        </Button>
                      )}
                    </div>
                    {formData.delayedMessages?.map((msg, index) => (
                      <div key={index} className="p-4 border rounded-lg space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">Follow-up #{index + 1}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              const current = formData.delayedMessages || [];
                              updateField('delayedMessages', current.filter((_, i) => i !== index));
                            }}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>Часы (0-23)</Label>
                            <Input
                              type="number"
                              value={msg.hours ?? 0}
                              onChange={(e) => {
                                const value = Math.min(23, Math.max(0, parseInt(e.target.value) || 0));
                                const current = formData.delayedMessages || [];
                                const updated = [...current];
                                updated[index] = { ...updated[index], hours: value };
                                updateField('delayedMessages', updated);
                              }}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Минуты (0-59)</Label>
                            <Input
                              type="number"
                              value={msg.minutes ?? 0}
                              onChange={(e) => {
                                const value = Math.min(59, Math.max(0, parseInt(e.target.value) || 0));
                                const current = formData.delayedMessages || [];
                                const updated = [...current];
                                updated[index] = { ...updated[index], minutes: value };
                                updateField('delayedMessages', updated);
                              }}
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label>Промпт</Label>
                          <Textarea
                            value={msg.prompt}
                            onChange={(e) => {
                              const current = formData.delayedMessages || [];
                              const updated = [...current];
                              updated[index] = { ...updated[index], prompt: e.target.value };
                              updateField('delayedMessages', updated);
                            }}
                            placeholder="Напомни клиенту о себе..."
                            rows={2}
                          />
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </CardContent>
            </Card>

            {/* Лимиты и API */}
            <Card>
              <CardHeader>
                <CardTitle>Лимиты и API</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Лимит на агента (центы/день)</Label>
                    <Input
                      type="number"
                      value={formData.dailyCostLimitCents || ''}
                      onChange={(e) => updateField('dailyCostLimitCents', e.target.value ? parseInt(e.target.value) : null)}
                      placeholder="Без лимита"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Лимит на пользователя (центы)</Label>
                    <Input
                      type="number"
                      value={formData.userCostLimitCents || ''}
                      onChange={(e) => updateField('userCostLimitCents', e.target.value ? parseInt(e.target.value) : null)}
                      placeholder="Без лимита"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Свой OpenAI API Key</Label>
                  <Input
                    type="password"
                    value={formData.customOpenaiApiKey || ''}
                    onChange={(e) => updateField('customOpenaiApiKey', e.target.value || null)}
                    placeholder="sk-..."
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ===== TAB 5: TEST ===== */}
        <TabsContent value="test">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessagesSquare className="w-5 h-5" />
                Тестирование бота
              </CardTitle>
              <CardDescription>
                Протестируйте бота в реальном времени с учётом всех настроек
              </CardDescription>
            </CardHeader>
            <CardContent>
              <BotTestChat botId={botId || ''} botName={formData.name} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
