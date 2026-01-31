import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { consultantApi } from '@/services/consultantApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Briefcase, Clock, DollarSign } from 'lucide-react';

interface Service {
  id: string;
  name: string;
  description?: string;
  default_price?: number;
  default_duration?: number;
  is_active: boolean;
  custom_price?: number;
  custom_duration?: number;
}

export function ServicesTab() {
  const { consultantId } = useParams<{ consultantId: string }>();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [services, setServices] = useState<Service[]>([]);

  // Загрузка услуг
  useEffect(() => {
    loadServices();
  }, [consultantId]);

  const loadServices = async () => {
    try {
      setLoading(true);
      const data = await consultantApi.getServices(consultantId);

      // Маппинг данных из backend в формат компонента
      const mappedServices = (data || []).map((service: any) => ({
        id: service.id,
        name: service.name,
        description: service.description,
        default_price: service.price,
        default_duration: service.duration_minutes,
        is_active: service.is_provided || false,
        custom_price: service.consultant_service?.custom_price,
        custom_duration: service.consultant_service?.custom_duration,
      }));

      setServices(mappedServices);
    } catch (error: any) {
      toast({
        title: 'Ошибка',
        description: 'Не удалось загрузить услуги',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);

      // Формируем данные для отправки - только активные услуги
      const servicesToSave = services
        .filter(s => s.is_active)
        .map(s => ({
          service_id: s.id,
          custom_price: s.custom_price,
          custom_duration: s.custom_duration,
          is_active: true,
        }));

      await consultantApi.updateServices(servicesToSave, consultantId);

      toast({
        title: 'Успешно',
        description: 'Услуги сохранены',
      });

      // Перезагрузить услуги чтобы получить обновленные данные
      await loadServices();
    } catch (error: any) {
      toast({
        title: 'Ошибка',
        description: 'Не удалось сохранить услуги',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const toggleService = (serviceId: string) => {
    setServices(prev =>
      prev.map(s =>
        s.id === serviceId ? { ...s, is_active: !s.is_active } : s
      )
    );
  };

  const updateServiceField = (
    serviceId: string,
    field: 'custom_price' | 'custom_duration',
    value: number | undefined
  ) => {
    setServices(prev =>
      prev.map(s =>
        s.id === serviceId ? { ...s, [field]: value } : s
      )
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
          <CardTitle>Мои услуги</CardTitle>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Сохранение...' : 'Сохранить изменения'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {services.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            Нет доступных услуг
          </div>
        ) : (
          <div className="space-y-4">
            {services.map((service) => (
              <div
                key={service.id}
                className={`border rounded-lg p-4 transition-opacity ${
                  service.is_active ? 'opacity-100' : 'opacity-50'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <Briefcase className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <h3 className="font-medium text-base">{service.name}</h3>
                      {service.description && (
                        <p className="text-sm text-muted-foreground mt-1">
                          {service.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <Switch
                    checked={service.is_active}
                    onCheckedChange={() => toggleService(service.id)}
                  />
                </div>

                {service.is_active && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-4 border-t">
                    <div className="space-y-2">
                      <Label htmlFor={`price-${service.id}`} className="text-sm">
                        <div className="flex items-center gap-2">
                          <DollarSign className="h-4 w-4 text-muted-foreground" />
                          <span>Стоимость (₽)</span>
                        </div>
                      </Label>
                      <Input
                        id={`price-${service.id}`}
                        type="number"
                        min="0"
                        step="100"
                        value={service.custom_price ?? service.default_price ?? ''}
                        onChange={(e) =>
                          updateServiceField(
                            service.id,
                            'custom_price',
                            e.target.value ? Number(e.target.value) : undefined
                          )
                        }
                        placeholder={service.default_price?.toString() || 'Не указана'}
                      />
                      {service.default_price && service.custom_price !== service.default_price && (
                        <p className="text-xs text-muted-foreground">
                          По умолчанию: {service.default_price} ₽
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`duration-${service.id}`} className="text-sm">
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          <span>Длительность (мин)</span>
                        </div>
                      </Label>
                      <Input
                        id={`duration-${service.id}`}
                        type="number"
                        min="15"
                        step="15"
                        value={service.custom_duration ?? service.default_duration ?? ''}
                        onChange={(e) =>
                          updateServiceField(
                            service.id,
                            'custom_duration',
                            e.target.value ? Number(e.target.value) : undefined
                          )
                        }
                        placeholder={service.default_duration?.toString() || 'Не указана'}
                      />
                      {service.default_duration && service.custom_duration !== service.default_duration && (
                        <p className="text-xs text-muted-foreground">
                          По умолчанию: {service.default_duration} мин
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 p-4 bg-muted rounded-lg">
          <p className="text-sm text-muted-foreground">
            💡 Выберите услуги, которые вы предоставляете. Вы можете установить свои цены и длительность для каждой услуги.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
