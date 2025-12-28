import { useState, useEffect } from 'react';
import { Bell, Plus, Trash2, Info, Clock, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { consultationService } from '@/services/consultationService';
import {
  NotificationSettings as NotificationSettingsType,
  NotificationTemplate,
  TEMPLATE_VARIABLES,
  DEFAULT_TEMPLATES
} from '@/types/consultation';

interface NotificationSettingsProps {
  userAccountId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function NotificationSettings({ userAccountId, isOpen, onClose }: NotificationSettingsProps) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Настройки
  const [settings, setSettings] = useState<NotificationSettingsType>({
    user_account_id: userAccountId,
    confirmation_enabled: true,
    confirmation_template: DEFAULT_TEMPLATES.confirmation,
    reminder_24h_enabled: true,
    reminder_24h_template: DEFAULT_TEMPLATES.reminder_24h,
    reminder_1h_enabled: true,
    reminder_1h_template: DEFAULT_TEMPLATES.reminder_1h
  });

  // Кастомные шаблоны
  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [isAddingTemplate, setIsAddingTemplate] = useState(false);
  const [newTemplate, setNewTemplate] = useState({
    name: '',
    minutes_before: 60,
    template: ''
  });

  useEffect(() => {
    if (isOpen && userAccountId) {
      loadData();
    }
  }, [isOpen, userAccountId]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [settingsData, templatesData] = await Promise.all([
        consultationService.getNotificationSettings(userAccountId),
        consultationService.getNotificationTemplates(userAccountId)
      ]);
      setSettings(settingsData);
      setTemplates(templatesData);
    } catch (error) {
      console.error('Error loading notification settings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    setIsSaving(true);
    try {
      await consultationService.updateNotificationSettings(userAccountId, settings);
      toast({ title: 'Настройки сохранены' });
    } catch (error) {
      toast({
        title: 'Ошибка',
        description: 'Не удалось сохранить настройки',
        variant: 'destructive'
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddTemplate = async () => {
    if (!newTemplate.name || !newTemplate.template) {
      toast({
        title: 'Ошибка',
        description: 'Заполните все поля',
        variant: 'destructive'
      });
      return;
    }

    try {
      const created = await consultationService.createNotificationTemplate(userAccountId, {
        name: newTemplate.name,
        minutes_before: newTemplate.minutes_before,
        template: newTemplate.template,
        is_enabled: true
      });
      setTemplates(prev => [...prev, created]);
      setIsAddingTemplate(false);
      setNewTemplate({ name: '', minutes_before: 60, template: '' });
      toast({ title: 'Шаблон добавлен' });
    } catch (error) {
      toast({
        title: 'Ошибка',
        description: 'Не удалось создать шаблон',
        variant: 'destructive'
      });
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    try {
      await consultationService.deleteNotificationTemplate(id);
      setTemplates(prev => prev.filter(t => t.id !== id));
      toast({ title: 'Шаблон удалён' });
    } catch (error) {
      toast({
        title: 'Ошибка',
        description: 'Не удалось удалить шаблон',
        variant: 'destructive'
      });
    }
  };

  const handleToggleTemplate = async (template: NotificationTemplate) => {
    try {
      await consultationService.updateNotificationTemplate(template.id, {
        is_enabled: !template.is_enabled
      });
      setTemplates(prev => prev.map(t =>
        t.id === template.id ? { ...t, is_enabled: !t.is_enabled } : t
      ));
    } catch (error) {
      toast({
        title: 'Ошибка',
        description: 'Не удалось обновить шаблон',
        variant: 'destructive'
      });
    }
  };

  const formatMinutes = (minutes: number): string => {
    if (minutes >= 1440) {
      const days = Math.floor(minutes / 1440);
      return `${days} ${days === 1 ? 'день' : days < 5 ? 'дня' : 'дней'}`;
    }
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      return `${hours} ${hours === 1 ? 'час' : hours < 5 ? 'часа' : 'часов'}`;
    }
    return `${minutes} минут`;
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="w-5 h-5" />
            Настройки уведомлений
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">
            Загрузка...
          </div>
        ) : (
          <div className="space-y-6">
            {/* Переменные шаблона */}
            <div className="bg-muted/50 p-3 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Info className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">Доступные переменные:</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {TEMPLATE_VARIABLES.map(v => (
                  <Badge key={v.key} variant="secondary" className="font-mono text-xs">
                    {v.key} — {v.description}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Подтверждение записи */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Подтверждение записи</CardTitle>
                    <CardDescription>Отправляется сразу после создания консультации</CardDescription>
                  </div>
                  <Switch
                    checked={settings.confirmation_enabled}
                    onCheckedChange={(checked) => setSettings(prev => ({
                      ...prev,
                      confirmation_enabled: checked
                    }))}
                  />
                </div>
              </CardHeader>
              {settings.confirmation_enabled && (
                <CardContent>
                  <Textarea
                    value={settings.confirmation_template}
                    onChange={(e) => setSettings(prev => ({
                      ...prev,
                      confirmation_template: e.target.value
                    }))}
                    rows={3}
                    placeholder="Текст уведомления..."
                  />
                </CardContent>
              )}
            </Card>

            {/* Напоминание за 24 часа */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Напоминание за 24 часа</CardTitle>
                    <CardDescription>Отправляется за сутки до консультации</CardDescription>
                  </div>
                  <Switch
                    checked={settings.reminder_24h_enabled}
                    onCheckedChange={(checked) => setSettings(prev => ({
                      ...prev,
                      reminder_24h_enabled: checked
                    }))}
                  />
                </div>
              </CardHeader>
              {settings.reminder_24h_enabled && (
                <CardContent>
                  <Textarea
                    value={settings.reminder_24h_template}
                    onChange={(e) => setSettings(prev => ({
                      ...prev,
                      reminder_24h_template: e.target.value
                    }))}
                    rows={2}
                    placeholder="Текст напоминания..."
                  />
                </CardContent>
              )}
            </Card>

            {/* Напоминание за 1 час */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Напоминание за 1 час</CardTitle>
                    <CardDescription>Отправляется за час до консультации</CardDescription>
                  </div>
                  <Switch
                    checked={settings.reminder_1h_enabled}
                    onCheckedChange={(checked) => setSettings(prev => ({
                      ...prev,
                      reminder_1h_enabled: checked
                    }))}
                  />
                </div>
              </CardHeader>
              {settings.reminder_1h_enabled && (
                <CardContent>
                  <Textarea
                    value={settings.reminder_1h_template}
                    onChange={(e) => setSettings(prev => ({
                      ...prev,
                      reminder_1h_template: e.target.value
                    }))}
                    rows={2}
                    placeholder="Текст напоминания..."
                  />
                </CardContent>
              )}
            </Card>

            {/* Кнопка сохранения основных настроек */}
            <Button onClick={handleSaveSettings} disabled={isSaving} className="w-full">
              {isSaving ? 'Сохранение...' : 'Сохранить настройки'}
            </Button>

            {/* Кастомные напоминания */}
            <div className="pt-4 border-t">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-medium">Дополнительные напоминания</h3>
                  <p className="text-sm text-muted-foreground">
                    Создайте свои напоминания с любым интервалом
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsAddingTemplate(true)}
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Добавить
                </Button>
              </div>

              {templates.length === 0 && !isAddingTemplate ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Дополнительных напоминаний нет
                </p>
              ) : (
                <div className="space-y-3">
                  {templates.map(template => (
                    <Card key={template.id}>
                      <CardContent className="p-3 flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium">{template.name}</span>
                            <Badge variant="outline" className="text-xs">
                              <Clock className="w-3 h-3 mr-1" />
                              За {formatMinutes(template.minutes_before)}
                            </Badge>
                            {template.is_enabled ? (
                              <Badge variant="secondary" className="text-xs">
                                <Check className="w-3 h-3 mr-1" />
                                Активно
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs text-muted-foreground">
                                Отключено
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {template.template}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 ml-2">
                          <Switch
                            checked={template.is_enabled}
                            onCheckedChange={() => handleToggleTemplate(template)}
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteTemplate(template.id)}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}

                  {/* Форма добавления нового шаблона */}
                  {isAddingTemplate && (
                    <Card className="border-dashed">
                      <CardContent className="p-4 space-y-3">
                        <div>
                          <Label>Название</Label>
                          <Input
                            value={newTemplate.name}
                            onChange={(e) => setNewTemplate(prev => ({
                              ...prev,
                              name: e.target.value
                            }))}
                            placeholder="Например: За 3 дня до визита"
                          />
                        </div>
                        <div>
                          <Label>За сколько минут до консультации</Label>
                          <div className="flex gap-2">
                            <Input
                              type="number"
                              value={newTemplate.minutes_before}
                              onChange={(e) => setNewTemplate(prev => ({
                                ...prev,
                                minutes_before: parseInt(e.target.value) || 60
                              }))}
                              min={1}
                            />
                            <span className="text-sm text-muted-foreground self-center whitespace-nowrap">
                              = {formatMinutes(newTemplate.minutes_before)}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            Примеры: 60 = 1 час, 1440 = 1 день, 4320 = 3 дня
                          </p>
                        </div>
                        <div>
                          <Label>Текст сообщения</Label>
                          <Textarea
                            value={newTemplate.template}
                            onChange={(e) => setNewTemplate(prev => ({
                              ...prev,
                              template: e.target.value
                            }))}
                            rows={3}
                            placeholder="Используйте переменные: {{client_name}}, {{date}}, {{time}}"
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button onClick={handleAddTemplate} className="flex-1">
                            Добавить
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => {
                              setIsAddingTemplate(false);
                              setNewTemplate({ name: '', minutes_before: 60, template: '' });
                            }}
                          >
                            Отмена
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
