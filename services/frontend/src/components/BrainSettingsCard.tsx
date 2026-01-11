/**
 * Brain Settings Card Component
 *
 * Карточка настроек Brain для single-account режима.
 * Позволяет настроить режим работы AI-оптимизатора, время запуска и часовой пояс.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Brain, Clock, Globe, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Label } from './ui/label';
import { Button } from './ui/button';
import { toast } from 'sonner';
import { adAccountsApi } from '@/services/adAccountsApi';
import type { AdAccount } from '@/types/adAccount';
import { BRAIN_MODE_LABELS, BRAIN_MODE_DESCRIPTIONS, BRAIN_TIMEZONES } from '@/types/adAccount';

interface BrainSettingsCardProps {
  className?: string;
}

export function BrainSettingsCard({ className }: BrainSettingsCardProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [account, setAccount] = useState<AdAccount | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Form state
  const [brainMode, setBrainMode] = useState<'autopilot' | 'report' | 'semi_auto'>('report');
  const [scheduleHour, setScheduleHour] = useState(8);
  const [timezone, setTimezone] = useState('Asia/Almaty');

  const getUserId = useCallback(() => {
    try {
      const userData = localStorage.getItem('user');
      if (!userData) return null;
      return JSON.parse(userData).id;
    } catch {
      return null;
    }
  }, []);

  // Load account
  useEffect(() => {
    const loadAccount = async () => {
      const userId = getUserId();
      if (!userId) {
        setLoading(false);
        return;
      }

      try {
        const response = await adAccountsApi.list(userId);
        const accounts = response.ad_accounts || [];

        if (accounts.length > 0) {
          const acc = accounts[0];
          setAccount(acc);
          setBrainMode(acc.brain_mode || 'report');
          setScheduleHour(acc.brain_schedule_hour ?? 8);
          setTimezone(acc.brain_timezone || 'Asia/Almaty');
        }
      } catch (error) {
        console.error('Error loading account:', error);
      } finally {
        setLoading(false);
      }
    };

    loadAccount();
  }, [getUserId]);

  const handleModeChange = (value: string) => {
    setBrainMode(value as 'autopilot' | 'report' | 'semi_auto');
    setHasChanges(true);
  };

  const handleHourChange = (value: string) => {
    setScheduleHour(parseInt(value, 10));
    setHasChanges(true);
  };

  const handleTimezoneChange = (value: string) => {
    setTimezone(value);
    setHasChanges(true);
  };

  const handleSave = async () => {
    if (!account) return;

    setSaving(true);
    try {
      const result = await adAccountsApi.update(account.id, {
        brain_mode: brainMode,
        brain_schedule_hour: scheduleHour,
        brain_timezone: timezone,
      });

      if (result.success) {
        toast.success('Настройки Brain сохранены');
        setHasChanges(false);
        // Update local state
        setAccount({
          ...account,
          brain_mode: brainMode,
          brain_schedule_hour: scheduleHour,
          brain_timezone: timezone,
        });
      } else {
        toast.error(result.error || 'Ошибка сохранения');
      }
    } catch (error) {
      console.error('Error saving brain settings:', error);
      toast.error('Не удалось сохранить настройки');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Brain className="h-5 w-5" />
            Настройки Brain
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!account) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Brain className="h-5 w-5" />
            Настройки Brain
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Рекламный аккаунт не найден. Подключите Facebook в разделе выше.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Brain className="h-5 w-5" />
          Настройки Brain
        </CardTitle>
        <CardDescription>
          Настройки AI-оптимизатора для автоматического управления рекламой
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Режим оптимизации */}
        <div className="grid gap-2">
          <Label className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-muted-foreground" />
            Режим оптимизации
          </Label>
          <Select value={brainMode} onValueChange={handleModeChange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(BRAIN_MODE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  <div>
                    <div>{label}</div>
                    <div className="text-xs text-muted-foreground">
                      {BRAIN_MODE_DESCRIPTIONS[value]}
                    </div>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Время запуска */}
        <div className="grid gap-2">
          <Label className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            Время ежедневного запуска
          </Label>
          <Select
            value={String(scheduleHour)}
            onValueChange={handleHourChange}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 24 }, (_, i) => (
                <SelectItem key={i} value={String(i)}>
                  {String(i).padStart(2, '0')}:00
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-2">
          <Label className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-muted-foreground" />
            Часовой пояс
          </Label>
          <Select value={timezone} onValueChange={handleTimezoneChange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BRAIN_TIMEZONES.map((tz) => (
                <SelectItem key={tz.value} value={tz.value}>
                  {tz.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Кнопка сохранения */}
        {hasChanges && (
          <Button
            onClick={handleSave}
            disabled={saving}
            className="w-full"
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Сохранение...
              </>
            ) : (
              'Сохранить настройки'
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export default BrainSettingsCard;
