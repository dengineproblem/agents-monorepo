import { useState, useEffect } from 'react';
import { Calendar, Clock, User, Phone, Plus, ChevronLeft, ChevronRight, RefreshCw, X, Coffee, Settings, Edit, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { consultationService } from '@/services/consultationService';
import {
  Consultant,
  ConsultationWithDetails,
  CreateConsultantData
} from '@/types/consultation';

export function Consultations() {
  const { toast } = useToast();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [consultants, setConsultants] = useState<Consultant[]>([]);
  const [consultations, setConsultations] = useState<ConsultationWithDetails[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState({
    total: 0,
    scheduled: 0,
    confirmed: 0,
    completed: 0,
    cancelled: 0,
    no_show: 0
  });

  // Модальные окна
  const [isNewConsultationOpen, setIsNewConsultationOpen] = useState(false);
  const [isConsultantsModalOpen, setIsConsultantsModalOpen] = useState(false);
  const [isNewConsultantOpen, setIsNewConsultantOpen] = useState(false);
  const [selectedConsultation, setSelectedConsultation] = useState<ConsultationWithDetails | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  // Форма новой консультации
  const [newConsultation, setNewConsultation] = useState({
    consultant_id: '',
    client_name: '',
    client_phone: '',
    date: '',
    start_time: '',
    end_time: '',
    notes: ''
  });

  // Форма нового консультанта
  const [newConsultant, setNewConsultant] = useState<CreateConsultantData>({
    name: '',
    email: '',
    phone: '',
    specialization: ''
  });

  // Временные слоты (с 00:00 до 23:30 с интервалом 30 минут)
  const timeSlots: string[] = [];
  for (let hour = 0; hour < 24; hour++) {
    timeSlots.push(`${hour.toString().padStart(2, '0')}:00`);
    timeSlots.push(`${hour.toString().padStart(2, '0')}:30`);
  }

  // Заблокированные слоты (обеды, перерывы)
  const [blockedSlots] = useState<{ consultant_id: string; time: string; reason: string }[]>([]);

  useEffect(() => {
    loadData();
  }, [selectedDate]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const dateStr = selectedDate.toISOString().split('T')[0];

      const [consultantsData, consultationsData, statsData] = await Promise.all([
        consultationService.getConsultants(),
        consultationService.getConsultations(dateStr),
        consultationService.getStats()
      ]);

      setConsultants(consultantsData);
      setConsultations(consultationsData);
      setStats(statsData);
    } catch (error) {
      console.error('Ошибка загрузки данных:', error);
      toast({
        title: 'Ошибка',
        description: 'Не удалось загрузить данные',
        variant: 'destructive'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenNewConsultationModal = () => {
    setNewConsultation(prev => ({
      ...prev,
      date: selectedDate.toISOString().split('T')[0]
    }));
    setIsNewConsultationOpen(true);
  };

  const handleCreateConsultation = async () => {
    try {
      if (!newConsultation.consultant_id || !newConsultation.client_phone || !newConsultation.date || !newConsultation.start_time) {
        toast({
          title: 'Ошибка',
          description: 'Заполните все обязательные поля',
          variant: 'destructive'
        });
        return;
      }

      await consultationService.createConsultation({
        consultant_id: newConsultation.consultant_id,
        client_phone: newConsultation.client_phone,
        client_name: newConsultation.client_name || undefined,
        date: newConsultation.date,
        start_time: newConsultation.start_time,
        end_time: newConsultation.end_time || calculateEndTime(newConsultation.start_time),
        status: 'scheduled',
        consultation_type: 'general',
        notes: newConsultation.notes || undefined
      });

      toast({
        title: 'Успешно',
        description: 'Консультация создана'
      });
      setIsNewConsultationOpen(false);
      setNewConsultation({
        consultant_id: '',
        client_name: '',
        client_phone: '',
        date: '',
        start_time: '',
        end_time: '',
        notes: ''
      });
      await loadData();
    } catch (error) {
      console.error('Ошибка создания консультации:', error);
      toast({
        title: 'Ошибка',
        description: 'Не удалось создать консультацию',
        variant: 'destructive'
      });
    }
  };

  const handleCreateConsultant = async () => {
    try {
      if (!newConsultant.name || !newConsultant.email) {
        toast({
          title: 'Ошибка',
          description: 'Укажите имя и email консультанта',
          variant: 'destructive'
        });
        return;
      }

      await consultationService.createConsultant(newConsultant);

      toast({
        title: 'Успешно',
        description: 'Консультант добавлен'
      });
      setIsNewConsultantOpen(false);
      setNewConsultant({ name: '', email: '', phone: '', specialization: '' });
      await loadData();
    } catch (error) {
      console.error('Ошибка создания консультанта:', error);
      toast({
        title: 'Ошибка',
        description: 'Не удалось добавить консультанта',
        variant: 'destructive'
      });
    }
  };

  const handleDeleteConsultant = async (id: string) => {
    if (!confirm('Удалить консультанта?')) return;

    try {
      await consultationService.deleteConsultant(id);
      toast({ title: 'Консультант удалён' });
      await loadData();
    } catch (error) {
      toast({
        title: 'Ошибка',
        description: 'Не удалось удалить консультанта',
        variant: 'destructive'
      });
    }
  };

  const handleUpdateStatus = async (id: string, status: string) => {
    try {
      await consultationService.updateConsultation(id, { status: status as any });
      toast({ title: 'Статус обновлён' });
      setIsDetailModalOpen(false);
      await loadData();
    } catch (error) {
      toast({
        title: 'Ошибка',
        description: 'Не удалось обновить статус',
        variant: 'destructive'
      });
    }
  };

  const calculateEndTime = (startTime: string): string => {
    const [hours, minutes] = startTime.split(':').map(Number);
    const totalMinutes = hours * 60 + minutes + 30;
    const endHours = Math.floor(totalMinutes / 60) % 24;
    const endMinutes = totalMinutes % 60;
    return `${endHours.toString().padStart(2, '0')}:${endMinutes.toString().padStart(2, '0')}`;
  };

  const getConsultationForSlot = (consultantId: string, timeSlot: string) => {
    const dateStr = selectedDate.toISOString().split('T')[0];
    const normalizeTime = (time: string) => time?.split(':').slice(0, 2).join(':') || '';

    return consultations.find(c =>
      c.consultant_id === consultantId &&
      c.date === dateStr &&
      normalizeTime(c.start_time) === normalizeTime(timeSlot)
    );
  };

  const isSlotBlocked = (consultantId: string, timeSlot: string) => {
    return blockedSlots.some(slot =>
      slot.consultant_id === consultantId && slot.time === timeSlot
    );
  };

  const getBlockedReason = (consultantId: string, timeSlot: string) => {
    return blockedSlots.find(slot =>
      slot.consultant_id === consultantId && slot.time === timeSlot
    )?.reason || '';
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'scheduled': return 'bg-blue-500 border-blue-600';
      case 'confirmed': return 'bg-green-500 border-green-600';
      case 'completed': return 'bg-gray-500 border-gray-600';
      case 'cancelled': return 'bg-red-500 border-red-600';
      case 'no_show': return 'bg-orange-500 border-orange-600';
      default: return 'bg-gray-500 border-gray-600';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'scheduled': return 'Запланирована';
      case 'confirmed': return 'Подтверждена';
      case 'completed': return 'Завершена';
      case 'cancelled': return 'Отменена';
      case 'no_show': return 'Не явился';
      default: return status;
    }
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('ru-RU', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Заголовок */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Calendar className="w-6 h-6" />
            Расписание консультаций
          </h1>
          <p className="text-muted-foreground">{formatDate(selectedDate)}</p>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={loadData} disabled={isLoading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
            Обновить
          </Button>

          <Button variant="outline" size="sm" onClick={() => setIsConsultantsModalOpen(true)}>
            <Settings className="w-4 h-4 mr-1" />
            Консультанты
          </Button>

          <Button size="sm" onClick={handleOpenNewConsultationModal}>
            <Plus className="w-4 h-4 mr-1" />
            Новая запись
          </Button>
        </div>
      </div>

      {/* Навигация по датам */}
      <div className="flex items-center justify-between bg-card p-3 rounded-lg border">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const newDate = new Date(selectedDate);
            newDate.setDate(newDate.getDate() - 1);
            setSelectedDate(newDate);
          }}
        >
          <ChevronLeft className="w-4 h-4 mr-1" />
          Вчера
        </Button>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSelectedDate(new Date())}
          >
            Сегодня
          </Button>
          <Input
            type="date"
            value={selectedDate.toISOString().split('T')[0]}
            onChange={(e) => setSelectedDate(new Date(e.target.value))}
            className="w-auto"
          />
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const newDate = new Date(selectedDate);
            newDate.setDate(newDate.getDate() + 1);
            setSelectedDate(newDate);
          }}
        >
          Завтра
          <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>

      {/* Статистика */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
        <Card>
          <CardContent className="p-3">
            <div className="text-lg font-bold text-blue-600">{stats.total}</div>
            <div className="text-xs text-muted-foreground">Всего</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-lg font-bold text-orange-600">{stats.scheduled}</div>
            <div className="text-xs text-muted-foreground">Запланировано</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-lg font-bold text-green-600">{stats.confirmed}</div>
            <div className="text-xs text-muted-foreground">Подтверждено</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-lg font-bold text-gray-600">{stats.completed}</div>
            <div className="text-xs text-muted-foreground">Завершено</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-lg font-bold text-red-600">{stats.cancelled}</div>
            <div className="text-xs text-muted-foreground">Отменено</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-lg font-bold text-orange-600">{stats.no_show}</div>
            <div className="text-xs text-muted-foreground">Не явились</div>
          </CardContent>
        </Card>
      </div>

      {/* Календарная сетка */}
      {consultants.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <User className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Нет консультантов</h3>
            <p className="text-muted-foreground mb-4">Добавьте консультанта чтобы начать планировать расписание</p>
            <Button onClick={() => setIsConsultantsModalOpen(true)}>
              <Plus className="w-4 h-4 mr-1" />
              Добавить консультанта
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <div className="min-w-[600px]">
                {/* Заголовки консультантов */}
                <div
                  className="grid border-b bg-muted/50"
                  style={{ gridTemplateColumns: `80px repeat(${consultants.length}, 1fr)` }}
                >
                  <div className="p-2 font-medium text-muted-foreground border-r text-sm">Время</div>
                  {consultants.map(consultant => (
                    <div key={consultant.id} className="p-2 border-r last:border-r-0">
                      <div className="font-medium text-sm">{consultant.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{consultant.specialization}</div>
                    </div>
                  ))}
                </div>

                {/* Временные слоты */}
                {timeSlots.map(timeSlot => (
                  <div
                    key={timeSlot}
                    className="grid border-b hover:bg-muted/30"
                    style={{ gridTemplateColumns: `80px repeat(${consultants.length}, 1fr)` }}
                  >
                    <div className="p-2 border-r bg-muted/30 font-medium text-muted-foreground text-sm">
                      {timeSlot}
                    </div>

                    {consultants.map(consultant => {
                      const consultation = getConsultationForSlot(consultant.id, timeSlot);
                      const isBlocked = isSlotBlocked(consultant.id, timeSlot);
                      const blockReason = getBlockedReason(consultant.id, timeSlot);

                      return (
                        <div key={consultant.id} className="p-1 border-r last:border-r-0 min-h-[40px]">
                          {consultation ? (
                            <button
                              onClick={() => {
                                setSelectedConsultation(consultation);
                                setIsDetailModalOpen(true);
                              }}
                              className={`
                                w-full p-2 rounded text-white text-left text-xs
                                hover:opacity-90 transition-opacity
                                ${getStatusColor(consultation.status)}
                              `}
                            >
                              <div className="font-medium truncate">
                                {consultation.client_name || 'Клиент'}
                              </div>
                              <div className="opacity-90 truncate">
                                {consultation.client_phone}
                              </div>
                            </button>
                          ) : isBlocked ? (
                            <div className="w-full h-full rounded bg-muted border border-dashed flex items-center justify-center text-muted-foreground">
                              <div className="text-center">
                                <Coffee className="w-3 h-3 mx-auto" />
                                <div className="text-xs">{blockReason}</div>
                              </div>
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                setNewConsultation(prev => ({
                                  ...prev,
                                  consultant_id: consultant.id,
                                  date: selectedDate.toISOString().split('T')[0],
                                  start_time: timeSlot
                                }));
                                setIsNewConsultationOpen(true);
                              }}
                              className="w-full h-full rounded border border-dashed border-muted-foreground/30 hover:border-primary hover:bg-primary/5 transition-colors flex items-center justify-center text-muted-foreground hover:text-primary group"
                            >
                              <Plus className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Модальное окно новой консультации */}
      <Dialog open={isNewConsultationOpen} onOpenChange={setIsNewConsultationOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новая консультация</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Консультант</Label>
              <Select
                value={newConsultation.consultant_id}
                onValueChange={(value) => setNewConsultation(prev => ({ ...prev, consultant_id: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Выберите консультанта" />
                </SelectTrigger>
                <SelectContent>
                  {consultants.map(consultant => (
                    <SelectItem key={consultant.id} value={consultant.id}>
                      {consultant.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Имя клиента</Label>
              <Input
                value={newConsultation.client_name}
                onChange={(e) => setNewConsultation(prev => ({ ...prev, client_name: e.target.value }))}
                placeholder="Введите имя"
              />
            </div>

            <div>
              <Label>Телефон клиента *</Label>
              <Input
                value={newConsultation.client_phone}
                onChange={(e) => setNewConsultation(prev => ({ ...prev, client_phone: e.target.value }))}
                placeholder="+7 (999) 123-45-67"
              />
            </div>

            <div>
              <Label>Дата</Label>
              <Input
                type="date"
                value={newConsultation.date || selectedDate.toISOString().split('T')[0]}
                onChange={(e) => setNewConsultation(prev => ({ ...prev, date: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Время начала</Label>
                <Select
                  value={newConsultation.start_time}
                  onValueChange={(value) => setNewConsultation(prev => ({ ...prev, start_time: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите" />
                  </SelectTrigger>
                  <SelectContent>
                    {timeSlots.map(time => (
                      <SelectItem key={time} value={time}>{time}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Время окончания</Label>
                <Input
                  type="time"
                  value={newConsultation.end_time}
                  onChange={(e) => setNewConsultation(prev => ({ ...prev, end_time: e.target.value }))}
                />
              </div>
            </div>

            <div>
              <Label>Примечания</Label>
              <Textarea
                value={newConsultation.notes}
                onChange={(e) => setNewConsultation(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Дополнительная информация..."
                rows={3}
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button onClick={handleCreateConsultation} className="flex-1">
                Создать
              </Button>
              <Button variant="outline" onClick={() => setIsNewConsultationOpen(false)}>
                Отмена
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Модальное окно деталей консультации */}
      <Dialog open={isDetailModalOpen} onOpenChange={setIsDetailModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Детали консультации</DialogTitle>
          </DialogHeader>
          {selectedConsultation && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Клиент</Label>
                  <div className="font-medium">{selectedConsultation.client_name || 'Не указан'}</div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Телефон</Label>
                  <div className="flex items-center gap-1">
                    <Phone className="w-3 h-3" />
                    {selectedConsultation.client_phone}
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Консультант</Label>
                  <div>{selectedConsultation.consultant?.name || 'Не назначен'}</div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Время</Label>
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {selectedConsultation.start_time} - {selectedConsultation.end_time}
                  </div>
                </div>
              </div>

              <div>
                <Label className="text-muted-foreground">Статус</Label>
                <div className="mt-1">
                  <Badge className={getStatusColor(selectedConsultation.status).replace('border-', '')}>
                    {getStatusText(selectedConsultation.status)}
                  </Badge>
                </div>
              </div>

              {selectedConsultation.notes && (
                <div>
                  <Label className="text-muted-foreground">Примечания</Label>
                  <div className="text-sm">{selectedConsultation.notes}</div>
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleUpdateStatus(selectedConsultation.id, 'confirmed')}
                  disabled={selectedConsultation.status === 'confirmed'}
                >
                  Подтвердить
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleUpdateStatus(selectedConsultation.id, 'completed')}
                  disabled={selectedConsultation.status === 'completed'}
                >
                  Завершить
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleUpdateStatus(selectedConsultation.id, 'no_show')}
                  disabled={selectedConsultation.status === 'no_show'}
                >
                  Не явился
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => handleUpdateStatus(selectedConsultation.id, 'cancelled')}
                  disabled={selectedConsultation.status === 'cancelled'}
                >
                  Отменить
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Модальное окно управления консультантами */}
      <Dialog open={isConsultantsModalOpen} onOpenChange={setIsConsultantsModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle>Управление консультантами</DialogTitle>
              <Button size="sm" onClick={() => setIsNewConsultantOpen(true)}>
                <Plus className="w-4 h-4 mr-1" />
                Добавить
              </Button>
            </div>
          </DialogHeader>

          <div className="space-y-3">
            {consultants.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                Нет консультантов
              </div>
            ) : (
              consultants.map(consultant => (
                <Card key={consultant.id}>
                  <CardContent className="p-3 flex items-center justify-between">
                    <div>
                      <div className="font-medium">{consultant.name}</div>
                      <div className="text-sm text-muted-foreground">{consultant.email}</div>
                      {consultant.specialization && (
                        <Badge variant="secondary" className="mt-1">{consultant.specialization}</Badge>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteConsultant(consultant.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Модальное окно нового консультанта */}
      <Dialog open={isNewConsultantOpen} onOpenChange={setIsNewConsultantOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новый консультант</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Имя *</Label>
              <Input
                value={newConsultant.name}
                onChange={(e) => setNewConsultant(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Иван Иванов"
              />
            </div>
            <div>
              <Label>Email *</Label>
              <Input
                type="email"
                value={newConsultant.email}
                onChange={(e) => setNewConsultant(prev => ({ ...prev, email: e.target.value }))}
                placeholder="ivan@example.com"
              />
            </div>
            <div>
              <Label>Телефон</Label>
              <Input
                value={newConsultant.phone}
                onChange={(e) => setNewConsultant(prev => ({ ...prev, phone: e.target.value }))}
                placeholder="+7 (999) 123-45-67"
              />
            </div>
            <div>
              <Label>Специализация</Label>
              <Input
                value={newConsultant.specialization}
                onChange={(e) => setNewConsultant(prev => ({ ...prev, specialization: e.target.value }))}
                placeholder="Продажи, Консультации..."
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button onClick={handleCreateConsultant} className="flex-1">
                Добавить
              </Button>
              <Button variant="outline" onClick={() => setIsNewConsultantOpen(false)}>
                Отмена
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
