import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { campaignApi } from '@/services/campaignApi';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/hooks/use-toast';
import { useState } from 'react';

const USER_ACCOUNT_ID = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b';

export function CampaignSettings() {
  const queryClient = useQueryClient();

  const { data: settings } = useQuery({
    queryKey: ['campaign-settings', USER_ACCOUNT_ID],
    queryFn: () => campaignApi.getCampaignSettings(USER_ACCOUNT_ID),
  });

  const [localSettings, setLocalSettings] = useState(settings);

  // Update local state when settings load
  React.useEffect(() => {
    if (settings) {
      setLocalSettings(settings);
    }
  }, [settings]);

  const updateMutation = useMutation({
    mutationFn: (updates: any) => campaignApi.updateCampaignSettings(USER_ACCOUNT_ID, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaign-settings'] });
      toast({ title: 'Настройки сохранены' });
    },
    onError: () => toast({ title: 'Ошибка сохранения', variant: 'destructive' }),
  });

  const handleSave = () => {
    if (!localSettings) return;
    updateMutation.mutate(localSettings);
  };

  if (!localSettings) return <div>Загрузка...</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Настройки кампаний</CardTitle>
        <CardDescription>
          Управление автопилотом, лимитами и интервалами между сообщениями
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Autopilot */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>Автопилот (автоматическая отправка)</Label>
            <p className="text-sm text-gray-500">
              Сообщения будут отправляться автоматически через Evolution API
            </p>
          </div>
          <Switch
            checked={localSettings.autopilot_enabled}
            onCheckedChange={(checked) =>
              setLocalSettings({ ...localSettings, autopilot_enabled: checked })
            }
          />
        </div>

        {/* Daily limit */}
        <div>
          <Label>Лимит сообщений в день</Label>
          <Input
            type="number"
            min="1"
            max="1000"
            value={localSettings.daily_message_limit}
            onChange={(e) =>
              setLocalSettings({
                ...localSettings,
                daily_message_limit: parseInt(e.target.value) || 300,
              })
            }
          />
          <p className="text-sm text-gray-500 mt-1">
            Рекомендуется не более 300 для избежания блокировки WhatsApp
          </p>
        </div>

        {/* Intervals */}
        <div>
          <Label>Интервалы между сообщениями (дней)</Label>
          <div className="grid grid-cols-3 gap-4 mt-2">
            <div>
              <Label className="text-xs">HOT лиды</Label>
              <Input
                type="number"
                min="1"
                max="30"
                value={localSettings.hot_interval_days}
                onChange={(e) =>
                  setLocalSettings({
                    ...localSettings,
                    hot_interval_days: parseInt(e.target.value) || 2,
                  })
                }
              />
            </div>
            <div>
              <Label className="text-xs">WARM лиды</Label>
              <Input
                type="number"
                min="1"
                max="30"
                value={localSettings.warm_interval_days}
                onChange={(e) =>
                  setLocalSettings({
                    ...localSettings,
                    warm_interval_days: parseInt(e.target.value) || 5,
                  })
                }
              />
            </div>
            <div>
              <Label className="text-xs">COLD лиды</Label>
              <Input
                type="number"
                min="1"
                max="90"
                value={localSettings.cold_interval_days}
                onChange={(e) =>
                  setLocalSettings({
                    ...localSettings,
                    cold_interval_days: parseInt(e.target.value) || 10,
                  })
                }
              />
            </div>
          </div>
        </div>

        {/* Work hours */}
        <div>
          <Label>Рабочие часы</Label>
          <div className="grid grid-cols-2 gap-4 mt-2">
            <div>
              <Label className="text-xs">Начало</Label>
              <Input
                type="number"
                min="0"
                max="23"
                value={localSettings.work_hours_start}
                onChange={(e) =>
                  setLocalSettings({
                    ...localSettings,
                    work_hours_start: parseInt(e.target.value) || 10,
                  })
                }
              />
            </div>
            <div>
              <Label className="text-xs">Конец</Label>
              <Input
                type="number"
                min="0"
                max="23"
                value={localSettings.work_hours_end}
                onChange={(e) =>
                  setLocalSettings({
                    ...localSettings,
                    work_hours_end: parseInt(e.target.value) || 20,
                  })
                }
              />
            </div>
          </div>
        </div>

        <Button onClick={handleSave} disabled={updateMutation.isPending}>
          Сохранить настройки
        </Button>
      </CardContent>
    </Card>
  );
}

