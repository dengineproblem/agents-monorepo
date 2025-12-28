import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Save,
  Loader2,
  Bot,
  MessageSquare,
  Settings2,
  Clock,
  Mic,
  Image,
  FileText,
  Bell,
  Shield,
  Zap,
  Link2,
  Smartphone,
  Unlink,
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
import { aiBotApi, type LinkedInstance } from '@/services/aiBotApi';
import type { AIBotConfiguration, UpdateBotRequest } from '@/types/aiBot';
import { AI_MODELS, TIMEZONES, DAYS_OF_WEEK } from '@/types/aiBot';

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
        <TabsList className="grid w-full grid-cols-5 lg:grid-cols-9">
          <TabsTrigger value="general" className="flex items-center gap-1">
            <Bot className="w-4 h-4" />
            <span className="hidden lg:inline">Основное</span>
          </TabsTrigger>
          <TabsTrigger value="instances" className="flex items-center gap-1">
            <Smartphone className="w-4 h-4" />
            <span className="hidden lg:inline">WhatsApp</span>
          </TabsTrigger>
          <TabsTrigger value="prompt" className="flex items-center gap-1">
            <MessageSquare className="w-4 h-4" />
            <span className="hidden lg:inline">Промпт</span>
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-1">
            <Settings2 className="w-4 h-4" />
            <span className="hidden lg:inline">История</span>
          </TabsTrigger>
          <TabsTrigger value="operator" className="flex items-center gap-1">
            <Shield className="w-4 h-4" />
            <span className="hidden lg:inline">Оператор</span>
          </TabsTrigger>
          <TabsTrigger value="schedule" className="flex items-center gap-1">
            <Clock className="w-4 h-4" />
            <span className="hidden lg:inline">Время</span>
          </TabsTrigger>
          <TabsTrigger value="media" className="flex items-center gap-1">
            <Image className="w-4 h-4" />
            <span className="hidden lg:inline">Медиа</span>
          </TabsTrigger>
          <TabsTrigger value="delayed" className="flex items-center gap-1">
            <Bell className="w-4 h-4" />
            <span className="hidden lg:inline">Отложенные</span>
          </TabsTrigger>
          <TabsTrigger value="advanced" className="flex items-center gap-1">
            <Zap className="w-4 h-4" />
            <span className="hidden lg:inline">Дополнительно</span>
          </TabsTrigger>
        </TabsList>

        {/* General Tab */}
        <TabsContent value="general">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Основные настройки</CardTitle>
                <CardDescription>Имя бота и выбор модели</CardDescription>
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

            <Card>
              <CardHeader>
                <CardTitle>Выбор языковой модели</CardTitle>
                <CardDescription>Выберите AI модель для генерации ответов</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {AI_MODELS.map((model) => (
                    <div
                      key={model.id}
                      className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                        formData.model === model.id
                          ? 'border-primary bg-primary/5'
                          : 'border-transparent bg-muted/50 hover:bg-muted'
                      }`}
                      onClick={() => updateField('model', model.id)}
                    >
                      <div className="font-medium">{model.name}</div>
                      <div className="text-sm text-muted-foreground">{model.description}</div>
                      <div className="text-xs text-muted-foreground mt-2">
                        Вход: {model.inputCost} / Выход: {model.outputCost} Botcoin/1000 токенов
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Температура</CardTitle>
                <CardDescription>
                  Контролирует креативность ответов. Низкая температура = предсказуемые ответы.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Значение: {Math.round((formData.temperature || 0.24) * 100)}%</span>
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
          </div>
        </TabsContent>

        {/* Instances Tab */}
        <TabsContent value="instances">
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
                  <p className="text-muted-foreground">
                    Нет привязанных WhatsApp инстансов
                  </p>
                  <p className="text-sm text-muted-foreground mt-2">
                    Привяжите этого бота к WhatsApp инстансу на странице настройки инстансов
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {linkedInstances.map((instance: LinkedInstance) => (
                    <div
                      key={instance.id}
                      className="flex items-center justify-between p-4 rounded-lg border bg-muted/30"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-full bg-green-100 text-green-700">
                          <Smartphone className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="font-medium">{instance.instanceName}</div>
                          {instance.phoneNumber && (
                            <div className="text-sm text-muted-foreground">
                              {instance.phoneNumber}
                            </div>
                          )}
                        </div>
                      </div>
                      <Badge variant={instance.status === 'connected' ? 'default' : 'secondary'}>
                        {instance.status === 'connected' ? 'Подключён' : instance.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}

              <Separator className="my-6" />

              <div className="bg-muted/50 rounded-lg p-4">
                <h4 className="font-medium mb-2">Как привязать бота к WhatsApp?</h4>
                <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                  <li>Перейдите в раздел "WhatsApp" в меню</li>
                  <li>Выберите нужный инстанс</li>
                  <li>В настройках инстанса выберите этого бота</li>
                </ol>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Prompt Tab */}
        <TabsContent value="prompt">
          <Card>
            <CardHeader>
              <CardTitle>Инструкция для ИИ-агента</CardTitle>
              <CardDescription>
                Системный промпт определяет поведение и знания бота
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                value={formData.systemPrompt || ''}
                onChange={(e) => updateField('systemPrompt', e.target.value)}
                placeholder="Опишите роль бота, его знания, правила ответов..."
                className="min-h-[400px] font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground mt-2">
                Символов: {(formData.systemPrompt || '').length}
              </p>
            </CardContent>
          </Card>

          <Card className="mt-6">
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
                  rows={3}
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
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle>Оптимизация истории диалога</CardTitle>
              <CardDescription>
                Ограничьте объем контекста для экономии токенов
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Ограничение по токенам</Label>
                    <p className="text-sm text-muted-foreground">
                      Максимальное количество токенов в контексте
                    </p>
                  </div>
                </div>
                <Input
                  type="number"
                  value={formData.historyTokenLimit || 10000}
                  onChange={(e) => updateField('historyTokenLimit', parseInt(e.target.value) || 10000)}
                  min={0}
                  max={128000}
                />
              </div>

              <Separator />

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Ограничение по количеству сообщений</Label>
                    <p className="text-sm text-muted-foreground">
                      Оставьте пустым для отключения
                    </p>
                  </div>
                </div>
                <Input
                  type="number"
                  value={formData.historyMessageLimit || ''}
                  onChange={(e) => updateField('historyMessageLimit', e.target.value ? parseInt(e.target.value) : null)}
                  min={1}
                  max={100}
                  placeholder="Без ограничения"
                />
              </div>

              <Separator />

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Ограничение по времени (часы)</Label>
                    <p className="text-sm text-muted-foreground">
                      Учитывать только сообщения за последние N часов
                    </p>
                  </div>
                </div>
                <Input
                  type="number"
                  value={formData.historyTimeLimitHours || ''}
                  onChange={(e) => updateField('historyTimeLimitHours', e.target.value ? parseInt(e.target.value) : null)}
                  min={1}
                  max={168}
                  placeholder="Без ограничения"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Буфер сообщений</CardTitle>
              <CardDescription>
                Склеивает несколько быстрых сообщений в одно перед ответом
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span>Время ожидания: {formData.messageBufferSeconds || 7} сек</span>
                </div>
                <Slider
                  value={[formData.messageBufferSeconds || 7]}
                  onValueChange={([value]) => updateField('messageBufferSeconds', value)}
                  min={1}
                  max={60}
                  step={1}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Operator Tab */}
        <TabsContent value="operator">
          <Card>
            <CardHeader>
              <CardTitle>Контроль вмешательства оператора</CardTitle>
              <CardDescription>
                Настройте поведение бота при вмешательстве менеджера
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Пауза при вмешательстве</Label>
                  <p className="text-sm text-muted-foreground">
                    Бот приостанавливается когда оператор пишет в диалог
                  </p>
                </div>
                <Switch
                  checked={formData.operatorPauseEnabled ?? true}
                  onCheckedChange={(checked) => updateField('operatorPauseEnabled', checked)}
                />
              </div>

              {formData.operatorPauseEnabled && (
                <>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Игнорировать первое сообщение</Label>
                      <p className="text-sm text-muted-foreground">
                        Полезно для рассылок
                      </p>
                    </div>
                    <Switch
                      checked={formData.operatorPauseIgnoreFirstMessage || false}
                      onCheckedChange={(checked) => updateField('operatorPauseIgnoreFirstMessage', checked)}
                    />
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <Label>Автовозобновление работы агента</Label>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-sm">Часы</Label>
                        <Input
                          type="number"
                          value={formData.operatorAutoResumeHours || 1}
                          onChange={(e) => updateField('operatorAutoResumeHours', parseInt(e.target.value) || 0)}
                          min={0}
                          max={72}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm">Минуты</Label>
                        <Input
                          type="number"
                          value={formData.operatorAutoResumeMinutes || 0}
                          onChange={(e) => updateField('operatorAutoResumeMinutes', parseInt(e.target.value) || 0)}
                          min={0}
                          max={59}
                        />
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <Label>Фразы-исключения</Label>
                    <p className="text-sm text-muted-foreground">
                      Бот не встанет на паузу, если сообщение оператора содержит эти фразы
                    </p>
                    <TagsInput
                      value={formData.operatorPauseExceptions || []}
                      onChange={(tags) => updateField('operatorPauseExceptions', tags)}
                      placeholder="Например: продолжай"
                    />
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Управление по ключевым фразам</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <Label>Фразы для остановки бота</Label>
                <TagsInput
                  value={formData.stopPhrases || []}
                  onChange={(tags) => updateField('stopPhrases', tags)}
                  placeholder="Например: стоп"
                />
              </div>
              <div className="space-y-4">
                <Label>Фразы для возобновления</Label>
                <TagsInput
                  value={formData.resumePhrases || []}
                  onChange={(tags) => updateField('resumePhrases', tags)}
                  placeholder="Например: продолжай"
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Schedule Tab */}
        <TabsContent value="schedule">
          <Card>
            <CardHeader>
              <CardTitle>Дата и время</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Передавать текущую дату</Label>
                  <p className="text-sm text-muted-foreground">
                    Бот будет знать текущее время для записи и консультаций
                  </p>
                </div>
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
                      <SelectItem key={tz.value} value={tz.value}>
                        {tz.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Расписание работы агента</CardTitle>
              <CardDescription>
                Ограничьте время работы бота определёнными часами
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Включить расписание</Label>
                  <p className="text-sm text-muted-foreground">
                    Бот будет работать только в указанное время
                  </p>
                </div>
                <Switch
                  checked={formData.scheduleEnabled || false}
                  onCheckedChange={(checked) => updateField('scheduleEnabled', checked)}
                />
              </div>

              {formData.scheduleEnabled && (
                <>
                  <Separator />
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

                  <div className="space-y-2">
                    <Label>Рабочие дни</Label>
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
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Media Tab */}
        <TabsContent value="media">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mic className="w-5 h-5" />
                Голосовые сообщения
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Распознавать голосовые</Label>
                  <p className="text-sm text-muted-foreground">
                    Конвертировать голос в текст через Whisper
                  </p>
                </div>
                <Switch
                  checked={formData.voiceRecognitionEnabled ?? true}
                  onCheckedChange={(checked) => updateField('voiceRecognitionEnabled', checked)}
                />
              </div>

              {!formData.voiceRecognitionEnabled && (
                <div className="space-y-2">
                  <Label>Ответ на голосовое</Label>
                  <Textarea
                    value={formData.voiceDefaultResponse || ''}
                    onChange={(e) => updateField('voiceDefaultResponse', e.target.value)}
                    rows={2}
                  />
                </div>
              )}

              <Separator />

              <div className="space-y-2">
                <Label>Голосовой ответ</Label>
                <Select
                  value={formData.voiceResponseMode || 'never'}
                  onValueChange={(value: any) => updateField('voiceResponseMode', value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="never">Никогда</SelectItem>
                    <SelectItem value="on_voice">На голосовые сообщения</SelectItem>
                    <SelectItem value="always">На любые сообщения</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Image className="w-5 h-5" />
                Изображения
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Распознавать изображения</Label>
                  <p className="text-sm text-muted-foreground">
                    Анализировать изображения через Vision API
                  </p>
                </div>
                <Switch
                  checked={formData.imageRecognitionEnabled ?? true}
                  onCheckedChange={(checked) => updateField('imageRecognitionEnabled', checked)}
                />
              </div>

              {!formData.imageRecognitionEnabled && (
                <div className="space-y-2">
                  <Label>Ответ на изображение</Label>
                  <Textarea
                    value={formData.imageDefaultResponse || ''}
                    onChange={(e) => updateField('imageDefaultResponse', e.target.value)}
                    rows={2}
                  />
                </div>
              )}

              <Separator />

              <div className="flex items-center justify-between">
                <div>
                  <Label>Отправлять изображения из ссылок</Label>
                  <p className="text-sm text-muted-foreground">
                    Автоматически отправлять изображения если бот вставил ссылку
                  </p>
                </div>
                <Switch
                  checked={formData.imageSendFromLinks || false}
                  onCheckedChange={(checked) => updateField('imageSendFromLinks', checked)}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Документы
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Распознавать документы</Label>
                  <p className="text-sm text-muted-foreground">
                    PDF, DOCX, TXT и другие форматы
                  </p>
                </div>
                <Switch
                  checked={formData.documentRecognitionEnabled || false}
                  onCheckedChange={(checked) => updateField('documentRecognitionEnabled', checked)}
                />
              </div>

              {!formData.documentRecognitionEnabled && (
                <div className="space-y-2">
                  <Label>Ответ на документ</Label>
                  <Textarea
                    value={formData.documentDefaultResponse || ''}
                    onChange={(e) => updateField('documentDefaultResponse', e.target.value)}
                    rows={2}
                  />
                </div>
              )}

              <Separator />

              <div className="flex items-center justify-between">
                <div>
                  <Label>Отправлять документы из ссылок</Label>
                </div>
                <Switch
                  checked={formData.documentSendFromLinks || false}
                  onCheckedChange={(checked) => updateField('documentSendFromLinks', checked)}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Файлы</CardTitle>
              <CardDescription>Реакция на другие типы файлов</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Select
                value={formData.fileHandlingMode || 'ignore'}
                onValueChange={(value: any) => updateField('fileHandlingMode', value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ignore">Ничего не делать</SelectItem>
                  <SelectItem value="respond">Ответить стандартным сообщением</SelectItem>
                </SelectContent>
              </Select>

              {formData.fileHandlingMode === 'respond' && (
                <div className="space-y-2">
                  <Label>Стандартный ответ</Label>
                  <Textarea
                    value={formData.fileDefaultResponse || ''}
                    onChange={(e) => updateField('fileDefaultResponse', e.target.value)}
                    rows={2}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Delayed Tab */}
        <TabsContent value="delayed">
          <Card>
            <CardHeader>
              <CardTitle>Отложенная отправка</CardTitle>
              <CardDescription>
                Автоматическая отправка напоминаний через заданное время
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-center py-8">
                Функция отложенной отправки будет доступна в следующем обновлении
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Advanced Tab */}
        <TabsContent value="advanced">
          <Card>
            <CardHeader>
              <CardTitle>Деление сообщений</CardTitle>
              <CardDescription>
                Разделять длинные сообщения на части для естественного общения
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Включить деление</Label>
                </div>
                <Switch
                  checked={formData.splitMessages || false}
                  onCheckedChange={(checked) => updateField('splitMessages', checked)}
                />
              </div>

              {formData.splitMessages && (
                <div className="space-y-2">
                  <Label>Максимальная длина части</Label>
                  <Input
                    type="number"
                    value={formData.splitMaxLength || 500}
                    onChange={(e) => updateField('splitMaxLength', parseInt(e.target.value) || 500)}
                    min={100}
                    max={2000}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Форматирование текста</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Адаптивное форматирование</Label>
                  <p className="text-sm text-muted-foreground">
                    Автоматически адаптировать под мессенджер
                  </p>
                </div>
                <Switch
                  checked={formData.adaptiveFormatting || false}
                  onCheckedChange={(checked) => updateField('adaptiveFormatting', checked)}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Очистка Markdown</Label>
                  <p className="text-sm text-muted-foreground">
                    Удалять символы **, *, _, ` из ответов
                  </p>
                </div>
                <Switch
                  checked={formData.cleanMarkdown ?? true}
                  onCheckedChange={(checked) => updateField('cleanMarkdown', checked)}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Лимиты расходов</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label>Лимит на агента (центы/день)</Label>
                <Input
                  type="number"
                  value={formData.dailyCostLimitCents || ''}
                  onChange={(e) => updateField('dailyCostLimitCents', e.target.value ? parseInt(e.target.value) : null)}
                  min={0}
                  placeholder="Без ограничения"
                />
              </div>

              <div className="space-y-2">
                <Label>Лимит на пользователя (центы)</Label>
                <Input
                  type="number"
                  value={formData.userCostLimitCents || ''}
                  onChange={(e) => updateField('userCostLimitCents', e.target.value ? parseInt(e.target.value) : null)}
                  min={0}
                  placeholder="Без ограничения"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Свой OpenAI API Key</CardTitle>
              <CardDescription>
                Используйте свой ключ для снижения стоимости
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Input
                type="password"
                value={formData.customOpenaiApiKey || ''}
                onChange={(e) => updateField('customOpenaiApiKey', e.target.value || null)}
                placeholder="sk-..."
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
