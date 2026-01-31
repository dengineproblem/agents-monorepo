import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { consultantApi, WorkingSchedule } from '@/services/consultantApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Clock } from 'lucide-react';

const DAYS_OF_WEEK = [
  { id: 1, name: 'Понедельник' },
  { id: 2, name: 'Вторник' },
  { id: 3, name: 'Среда' },
  { id: 4, name: 'Четверг' },
  { id: 5, name: 'Пятница' },
  { id: 6, name: 'Суббота' },
  { id: 0, name: 'Воскресенье' },
];

interface ScheduleDay {
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
}

export function ScheduleTab() {
  const { consultantId } = useParams<{ consultantId: string }>();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [schedule, setSchedule] = useState<ScheduleDay[]>(
    DAYS_OF_WEEK.map(day => ({
      day_of_week: day.id,
      start_time: '09:00',
      end_time: '18:00',
      is_active: false,
    }))
  );

  // Загрузка расписания
  useEffect(() => {
    loadSchedule();
  }, [consultantId]);

  const loadSchedule = async () => {
    try {
      setLoading(true);
      const data = await consultantApi.getSchedule(consultantId);

      if (data.length > 0) {
        // Обновляем расписание существующими данными
        const updatedSchedule = DAYS_OF_WEEK.map(day => {
          const existing = data.find(s => s.day_of_week === day.id);
          return existing
            ? {
                day_of_week: existing.day_of_week,
                start_time: existing.start_time,
                end_time: existing.end_time,
                is_active: existing.is_active,
              }
            : {
                day_of_week: day.id,
                start_time: '09:00',
                end_time: '18:00',
                is_active: false,
              };
        });
        setSchedule(updatedSchedule);
      }
    } catch (error: any) {
      toast({
        title: 'Ошибка',
        description: 'Не удалось загрузить расписание',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await consultantApi.updateSchedule(schedule);

      toast({
        title: 'Успешно',
        description: 'Расписание сохранено',
      });
    } catch (error: any) {
      toast({
        title: 'Ошибка',
        description: 'Не удалось сохранить расписание',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const updateDay = (dayOfWeek: number, field: keyof ScheduleDay, value: any) => {
    setSchedule(prev =>
      prev.map(day =>
        day.day_of_week === dayOfWeek
          ? { ...day, [field]: value }
          : day
      )
    );
  };

  const toggleAllDays = (enabled: boolean) => {
    setSchedule(prev =>
      prev.map(day => ({ ...day, is_active: enabled }))
    );
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Рабочее расписание</CardTitle>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => toggleAllDays(true)}
            >
              Включить все
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => toggleAllDays(false)}
            >
              Выключить все
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {schedule.map((day) => {
            const dayInfo = DAYS_OF_WEEK.find(d => d.id === day.day_of_week);
            return (
              <div
                key={day.day_of_week}
                className={`border rounded-lg p-4 transition-opacity ${
                  day.is_active ? 'opacity-100' : 'opacity-50'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <Label className="text-base font-medium">
                    {dayInfo?.name}
                  </Label>
                  <Switch
                    checked={day.is_active}
                    onCheckedChange={(checked) =>
                      updateDay(day.day_of_week, 'is_active', checked)
                    }
                  />
                </div>

                {day.is_active && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor={`start-${day.day_of_week}`} className="text-sm">
                        Начало работы
                      </Label>
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <Input
                          id={`start-${day.day_of_week}`}
                          type="time"
                          value={day.start_time}
                          onChange={(e) =>
                            updateDay(day.day_of_week, 'start_time', e.target.value)
                          }
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`end-${day.day_of_week}`} className="text-sm">
                        Конец работы
                      </Label>
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <Input
                          id={`end-${day.day_of_week}`}
                          type="time"
                          value={day.end_time}
                          onChange={(e) =>
                            updateDay(day.day_of_week, 'end_time', e.target.value)
                          }
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-6 flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Сохранение...' : 'Сохранить расписание'}
          </Button>
        </div>

        <div className="mt-4 p-4 bg-muted rounded-lg">
          <p className="text-sm text-muted-foreground">
            💡 Ваше расписание определяет, когда клиенты могут записаться на консультацию.
            Слоты будут доступны только в указанные дни и часы.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
