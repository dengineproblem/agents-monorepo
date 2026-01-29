/**
 * Admin Settings
 *
 * Настройки админ-панели
 *
 * @module pages/admin/AdminSettings
 */

import React, { useState, useEffect } from 'react';
import {
  Settings,
  Bell,
  MessageSquare,
  Clock,
  Save,
  RefreshCw,
  Server,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { API_BASE_URL } from '@/config/api';
import { useToast } from '@/hooks/use-toast';

interface NotificationSettings {
  messages_enabled: boolean;
  registrations_enabled: boolean;
  system_enabled: boolean;
  errors_enabled: boolean;
  daily_limit: number;
  weekly_limit: number;
  cooldown_minutes: number;
}

interface CronStatus {
  name: string;
  status: 'running' | 'stopped' | 'error';
  lastRun?: string;
  nextRun?: string;
}

const AdminSettings: React.FC = () => {
  const { toast } = useToast();

  const [settings, setSettings] = useState<NotificationSettings>({
    messages_enabled: true,
    registrations_enabled: true,
    system_enabled: true,
    errors_enabled: true,
    daily_limit: 100,
    weekly_limit: 500,
    cooldown_minutes: 5,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cronStatuses, setCronStatuses] = useState<CronStatus[]>([]);

  useEffect(() => {
    fetchSettings();
    fetchCronStatuses();
  }, []);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/admin/settings`);
      if (res.ok) {
        const data = await res.json();
        if (data.notifications) {
          setSettings(data.notifications);
        }
      }
    } catch (err) {

    } finally {
      setLoading(false);
    }
  };

  const fetchCronStatuses = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/admin/cron/status`);
      if (res.ok) {
        const data = await res.json();
        setCronStatuses(data.crons || []);
      }
    } catch (err) {

    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/admin/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ notifications: settings }),
      });

      if (res.ok) {
        toast({
          title: 'Настройки сохранены',
          description: 'Изменения успешно применены',
        });
      } else {
        throw new Error('Failed to save');
      }
    } catch (err) {
      toast({
        title: 'Ошибка',
        description: 'Не удалось сохранить настройки',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const getCronStatusColor = (status: CronStatus['status']) => {
    switch (status) {
      case 'running':
        return 'text-green-500';
      case 'stopped':
        return 'text-yellow-500';
      case 'error':
        return 'text-red-500';
    }
  };

  const getCronStatusIcon = (status: CronStatus['status']) => {
    switch (status) {
      case 'running':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'stopped':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case 'error':
        return <XCircle className="h-4 w-4 text-red-500" />;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Настройки</h1>
        <p className="text-muted-foreground">Конфигурация админ-панели</p>
      </div>

      {/* Notifications Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Уведомления
          </CardTitle>
          <CardDescription>
            Настройки уведомлений для админов
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Toggle Switches */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Сообщения от пользователей</Label>
                <p className="text-sm text-muted-foreground">
                  Уведомления о новых сообщениях в чатах
                </p>
              </div>
              <Switch
                checked={settings.messages_enabled}
                onCheckedChange={(v) => setSettings({ ...settings, messages_enabled: v })}
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Новые регистрации</Label>
                <p className="text-sm text-muted-foreground">
                  Уведомления о новых пользователях
                </p>
              </div>
              <Switch
                checked={settings.registrations_enabled}
                onCheckedChange={(v) => setSettings({ ...settings, registrations_enabled: v })}
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Системные уведомления</Label>
                <p className="text-sm text-muted-foreground">
                  Достижения пользователей, изменения статусов
                </p>
              </div>
              <Switch
                checked={settings.system_enabled}
                onCheckedChange={(v) => setSettings({ ...settings, system_enabled: v })}
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Ошибки</Label>
                <p className="text-sm text-muted-foreground">
                  Уведомления о критических ошибках
                </p>
              </div>
              <Switch
                checked={settings.errors_enabled}
                onCheckedChange={(v) => setSettings({ ...settings, errors_enabled: v })}
              />
            </div>
          </div>

          <Separator />

          {/* Limits */}
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Дневной лимит</Label>
              <Input
                type="number"
                value={settings.daily_limit}
                onChange={(e) =>
                  setSettings({ ...settings, daily_limit: parseInt(e.target.value) || 0 })
                }
              />
              <p className="text-xs text-muted-foreground">Максимум уведомлений в день</p>
            </div>

            <div className="space-y-2">
              <Label>Недельный лимит</Label>
              <Input
                type="number"
                value={settings.weekly_limit}
                onChange={(e) =>
                  setSettings({ ...settings, weekly_limit: parseInt(e.target.value) || 0 })
                }
              />
              <p className="text-xs text-muted-foreground">Максимум уведомлений в неделю</p>
            </div>

            <div className="space-y-2">
              <Label>Cooldown (мин)</Label>
              <Input
                type="number"
                value={settings.cooldown_minutes}
                onChange={(e) =>
                  setSettings({ ...settings, cooldown_minutes: parseInt(e.target.value) || 0 })
                }
              />
              <p className="text-xs text-muted-foreground">Пауза между уведомлениями</p>
            </div>
          </div>

          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Сохранить настройки
          </Button>
        </CardContent>
      </Card>

      {/* System Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Система
          </CardTitle>
          <CardDescription>
            Информация о системе и CRON задачах
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Version Info */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
            <span className="text-sm">Версия</span>
            <Badge variant="outline">v1.0.0</Badge>
          </div>

          <Separator />

          {/* CRON Statuses */}
          <div>
            <Label className="mb-3 block">CRON задачи</Label>
            <div className="space-y-2">
              {cronStatuses.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Нет данных о CRON задачах
                </p>
              ) : (
                cronStatuses.map((cron) => (
                  <div
                    key={cron.name}
                    className="flex items-center justify-between p-3 rounded-lg border"
                  >
                    <div className="flex items-center gap-3">
                      {getCronStatusIcon(cron.status)}
                      <div>
                        <p className="text-sm font-medium">{cron.name}</p>
                        {cron.lastRun && (
                          <p className="text-xs text-muted-foreground">
                            Последний запуск: {cron.lastRun}
                          </p>
                        )}
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={getCronStatusColor(cron.status)}
                    >
                      {cron.status === 'running'
                        ? 'Работает'
                        : cron.status === 'stopped'
                        ? 'Остановлен'
                        : 'Ошибка'}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </div>

          <Button variant="outline" onClick={fetchCronStatuses}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Обновить статус
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminSettings;
