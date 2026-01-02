import { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Package, Clock, DollarSign } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { consultationService } from '@/services/consultationService';
import { ConsultationService, CreateServiceData } from '@/types/consultation';

interface ServiceSettingsProps {
  userAccountId: string;
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULT_COLORS = [
  '#3B82F6', // blue
  '#10B981', // green
  '#F59E0B', // amber
  '#EF4444', // red
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#F97316', // orange
];

export function ServiceSettings({ userAccountId, isOpen, onClose }: ServiceSettingsProps) {
  const { toast } = useToast();
  const [services, setServices] = useState<ConsultationService[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingService, setEditingService] = useState<ConsultationService | null>(null);

  const [formData, setFormData] = useState<CreateServiceData>({
    user_account_id: userAccountId,
    name: '',
    description: '',
    duration_minutes: 60,
    price: 0,
    currency: 'RUB',
    color: '#3B82F6',
    is_active: true,
    sort_order: 0
  });

  useEffect(() => {
    if (isOpen) {
      loadServices();
    }
  }, [isOpen, userAccountId]);

  const loadServices = async () => {
    setIsLoading(true);
    try {
      const data = await consultationService.getServices(userAccountId, true);
      setServices(data);
    } catch (error) {
      console.error('Ошибка загрузки услуг:', error);
      toast({
        title: 'Ошибка',
        description: 'Не удалось загрузить список услуг',
        variant: 'destructive'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenForm = (service?: ConsultationService) => {
    if (service) {
      setEditingService(service);
      setFormData({
        user_account_id: userAccountId,
        name: service.name,
        description: service.description || '',
        duration_minutes: service.duration_minutes,
        price: service.price,
        currency: service.currency,
        color: service.color,
        is_active: service.is_active,
        sort_order: service.sort_order
      });
    } else {
      setEditingService(null);
      setFormData({
        user_account_id: userAccountId,
        name: '',
        description: '',
        duration_minutes: 60,
        price: 0,
        currency: 'RUB',
        color: DEFAULT_COLORS[services.length % DEFAULT_COLORS.length],
        is_active: true,
        sort_order: services.length
      });
    }
    setIsFormOpen(true);
  };

  const handleSave = async () => {
    try {
      if (!formData.name.trim()) {
        toast({
          title: 'Ошибка',
          description: 'Укажите название услуги',
          variant: 'destructive'
        });
        return;
      }

      if (editingService) {
        await consultationService.updateService(editingService.id, {
          name: formData.name,
          description: formData.description || null,
          duration_minutes: formData.duration_minutes,
          price: formData.price,
          currency: formData.currency,
          color: formData.color,
          is_active: formData.is_active,
          sort_order: formData.sort_order
        });
        toast({ title: 'Услуга обновлена' });
      } else {
        await consultationService.createService(formData);
        toast({ title: 'Услуга создана' });
      }

      setIsFormOpen(false);
      setEditingService(null);
      await loadServices();
    } catch (error) {
      console.error('Ошибка сохранения услуги:', error);
      toast({
        title: 'Ошибка',
        description: 'Не удалось сохранить услугу',
        variant: 'destructive'
      });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить услугу? Она будет деактивирована.')) return;

    try {
      await consultationService.deleteService(id);
      toast({ title: 'Услуга удалена' });
      await loadServices();
    } catch (error) {
      console.error('Ошибка удаления услуги:', error);
      toast({
        title: 'Ошибка',
        description: 'Не удалось удалить услугу',
        variant: 'destructive'
      });
    }
  };

  const formatPrice = (price: number, currency: string) => {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(price);
  };

  const formatDuration = (minutes: number) => {
    if (minutes < 60) return `${minutes} мин`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours} ч ${mins} мин` : `${hours} ч`;
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle className="flex items-center gap-2">
                <Package className="w-5 h-5" />
                Управление услугами
              </DialogTitle>
              <Button size="sm" onClick={() => handleOpenForm()}>
                <Plus className="w-4 h-4 mr-1" />
                Добавить
              </Button>
            </div>
          </DialogHeader>

          <div className="space-y-3 mt-4">
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                Загрузка...
              </div>
            ) : services.length === 0 ? (
              <div className="text-center py-8">
                <Package className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground mb-4">Нет услуг</p>
                <Button onClick={() => handleOpenForm()}>
                  <Plus className="w-4 h-4 mr-1" />
                  Добавить услугу
                </Button>
              </div>
            ) : (
              services.map(service => (
                <Card key={service.id} className={!service.is_active ? 'opacity-50' : ''}>
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-4 h-4 rounded-full"
                        style={{ backgroundColor: service.color }}
                      />
                      <div>
                        <div className="font-medium flex items-center gap-2">
                          {service.name}
                          {!service.is_active && (
                            <Badge variant="secondary" className="text-xs">Неактивна</Badge>
                          )}
                        </div>
                        {service.description && (
                          <div className="text-sm text-muted-foreground line-clamp-1">
                            {service.description}
                          </div>
                        )}
                        <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDuration(service.duration_minutes)}
                          </span>
                          <span className="flex items-center gap-1">
                            <DollarSign className="w-3 h-3" />
                            {service.price > 0 ? formatPrice(service.price, service.currency) : 'Бесплатно'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleOpenForm(service)}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(service.id)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Форма создания/редактирования */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingService ? 'Редактировать услугу' : 'Новая услуга'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 mt-4">
            <div>
              <Label>Название *</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Консультация, Диагностика..."
              />
            </div>

            <div>
              <Label>Описание</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Краткое описание услуги..."
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Длительность (минуты)</Label>
                <Input
                  type="number"
                  min={15}
                  max={480}
                  step={15}
                  value={formData.duration_minutes}
                  onChange={(e) => setFormData(prev => ({ ...prev, duration_minutes: parseInt(e.target.value) || 60 }))}
                />
              </div>
              <div>
                <Label>Цена</Label>
                <Input
                  type="number"
                  min={0}
                  step={100}
                  value={formData.price}
                  onChange={(e) => setFormData(prev => ({ ...prev, price: parseFloat(e.target.value) || 0 }))}
                />
              </div>
            </div>

            <div>
              <Label>Цвет</Label>
              <div className="flex gap-2 mt-2">
                {DEFAULT_COLORS.map(color => (
                  <button
                    key={color}
                    onClick={() => setFormData(prev => ({ ...prev, color }))}
                    className={`
                      w-8 h-8 rounded-full transition-all
                      ${formData.color === color ? 'ring-2 ring-offset-2 ring-primary' : 'hover:scale-110'}
                    `}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_active"
                checked={formData.is_active}
                onChange={(e) => setFormData(prev => ({ ...prev, is_active: e.target.checked }))}
                className="rounded"
              />
              <Label htmlFor="is_active">Активна (доступна для записи)</Label>
            </div>

            <div className="flex gap-2 pt-4">
              <Button onClick={handleSave} className="flex-1">
                {editingService ? 'Сохранить' : 'Создать'}
              </Button>
              <Button variant="outline" onClick={() => setIsFormOpen(false)}>
                Отмена
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
