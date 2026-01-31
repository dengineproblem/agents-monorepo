import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { consultantApi, Consultation, WorkingSchedule } from '@/services/consultantApi';
import { consultationService, BlockedSlot } from '@/services/consultationService';
import { ConsultationService } from '@/types/consultation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Calendar, Clock, Phone, Plus, ChevronLeft, ChevronRight, RefreshCw, Coffee, DollarSign } from 'lucide-react';

export function CalendarTab() {
  const { consultantId } = useParams<{ consultantId: string }>();
  const { toast } = useToast();

  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [schedules, setSchedules] = useState<WorkingSchedule[]>([]);
  const [blockedSlots, setBlockedSlots] = useState<BlockedSlot[]>([]);
  const [services, setServices] = useState<ConsultationService[]>([]);

  // Модальные окна
  const [isNewConsultationOpen, setIsNewConsultationOpen] = useState(false);
  const [selectedConsultation, setSelectedConsultation] = useState<Consultation | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isBlockSlotModalOpen, setIsBlockSlotModalOpen] = useState(false);
  const [slotToBlock, setSlotToBlock] = useState<{ time: string } | null>(null);
  const [blockReason, setBlockReason] = useState('Перерыв');

  // Форма новой консультации
  const [newConsultation, setNewConsultation] = useState({
    service_id: '',
    client_name: '',
    client_phone: '',
    date: '',
    start_time: '',
    end_time: '',
    notes: ''
  });

  // Временные слоты (с 00:00 до 23:30 с интервалом 30 минут)
  const timeSlots: string[] = [];
  for (let hour = 0; hour < 24; hour++) {
    timeSlots.push(`${hour.toString().padStart(2, '0')}:00`);
    timeSlots.push(`${hour.toString().padStart(2, '0')}:30`);
  }

  useEffect(() => {
    if (consultantId) {
      loadData();
    }
  }, [selectedDate, consultantId]);

  const loadData = async () => {
    if (!consultantId) return;

    setIsLoading(true);
    try {
      const dateStr = selectedDate.toISOString().split('T')[0];
      const userAccountId = JSON.parse(localStorage.getItem('user') || '{}').id;

      const [consultationsData, schedulesData, blockedSlotsData, servicesData] = await Promise.all([
        consultantApi.getConsultations({ date: dateStr }),
        consultantApi.getSchedule(consultantId),
        consultationService.getBlockedSlots({ date: dateStr, consultant_id: consultantId }).catch(() => []),
        consultationService.getServices(userAccountId).catch(() => [])
      ]);

      setConsultations(consultationsData);
      setSchedules(schedulesData);
      setBlockedSlots(blockedSlotsData);
      setServices(servicesData);
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
      if (!consultantId || !newConsultation.client_phone || !newConsultation.date || !newConsultation.start_time) {
        toast({
          title: 'Ошибка',
          description: 'Заполните все обязательные поля',
          variant: 'destructive'
        });
        return;
      }

      const selectedService = services.find(s => s.id === newConsultation.service_id);
      const endTime = newConsultation.end_time ||
        (selectedService
          ? calculateEndTimeWithDuration(newConsultation.start_time, selectedService.duration_minutes)
          : calculateEndTime(newConsultation.start_time));

      await consultationService.createConsultation({
        consultant_id: consultantId,
        service_id: newConsultation.service_id || undefined,
        client_phone: newConsultation.client_phone,
        client_name: newConsultation.client_name || undefined,
        date: newConsultation.date,
        start_time: newConsultation.start_time,
        end_time: endTime,
        status: 'scheduled',
        consultation_type: 'general',
        notes: newConsultation.notes || undefined,
        price: selectedService?.price
      });

      toast({
        title: 'Успешно',
        description: 'Консультация создана'
      });
      setIsNewConsultationOpen(false);
      setNewConsultation({
        service_id: '',
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

  const isSlotOutsideWorkingHours = (timeSlot: string): boolean => {
    const dayOfWeek = selectedDate.getDay();
    const schedule = schedules.find(
      s => s.day_of_week === dayOfWeek && s.is_active
    );

    if (!schedule) return true;

    const slotMinutes = parseInt(timeSlot.split(':')[0]) * 60 + parseInt(timeSlot.split(':')[1]);
    const startMinutes = parseInt(schedule.start_time.split(':')[0]) * 60 + parseInt(schedule.start_time.split(':')[1]);
    const endMinutes = parseInt(schedule.end_time.split(':')[0]) * 60 + parseInt(schedule.end_time.split(':')[1]);

    return slotMinutes < startMinutes || slotMinutes >= endMinutes;
  };

  const availableTimeSlots = timeSlots.filter(slot => !isSlotOutsideWorkingHours(slot));

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

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить консультацию? Это действие нельзя отменить.')) return;
    try {
      await consultationService.deleteConsultation(id);
      toast({ title: 'Консультация удалена' });
      setIsDetailModalOpen(false);
      await loadData();
    } catch (error) {
      toast({
        title: 'Ошибка',
        description: 'Не удалось удалить консультацию',
        variant: 'destructive'
      });
    }
  };

  const calculateEndTime = (startTime: string): string => {
    return calculateEndTimeWithDuration(startTime, 30);
  };

  const calculateEndTimeWithDuration = (startTime: string, durationMinutes: number): string => {
    const [hours, minutes] = startTime.split(':').map(Number);
    const totalMinutes = hours * 60 + minutes + durationMinutes;
    const endHours = Math.floor(totalMinutes / 60) % 24;
    const endMinutes = totalMinutes % 60;
    return `${endHours.toString().padStart(2, '0')}:${endMinutes.toString().padStart(2, '0')}`;
  };

  const getConsultationForSlot = (timeSlot: string) => {
    const dateStr = selectedDate.toISOString().split('T')[0];
    const normalizeTime = (time: string) => time?.split(':').slice(0, 2).join(':') || '';

    return consultations.find(c =>
      c.date === dateStr &&
      normalizeTime(c.start_time) === normalizeTime(timeSlot)
    );
  };

  const isSlotBlocked = (timeSlot: string) => {
    const dateStr = selectedDate.toISOString().split('T')[0];
    return blockedSlots.some(slot =>
      slot.date === dateStr &&
      slot.start_time.substring(0, 5) === timeSlot
    );
  };

  const getBlockedSlot = (timeSlot: string): BlockedSlot | undefined => {
    const dateStr = selectedDate.toISOString().split('T')[0];
    return blockedSlots.find(slot =>
      slot.date === dateStr &&
      slot.start_time.substring(0, 5) === timeSlot
    );
  };

  const getBlockedReason = (timeSlot: string) => {
    return getBlockedSlot(timeSlot)?.reason || 'Перерыв';
  };

  const handleBlockSlot = (timeSlot: string) => {
    setSlotToBlock({ time: timeSlot });
    setBlockReason('Перерыв');
    setIsBlockSlotModalOpen(true);
  };

  const handleCreateBlockedSlot = async () => {
    if (!slotToBlock || !consultantId) return;

    try {
      const dateStr = selectedDate.toISOString().split('T')[0];
      const endTime = calculateEndTime(slotToBlock.time);

      await consultationService.createBlockedSlot({
        consultant_id: consultantId,
        date: dateStr,
        start_time: slotToBlock.time,
        end_time: endTime,
        reason: blockReason
      });

      toast({ title: 'Слот заблокирован' });
      setIsBlockSlotModalOpen(false);
      setSlotToBlock(null);
      await loadData();
    } catch (error: any) {
      toast({
        title: 'Ошибка',
        description: error.message || 'Не удалось заблокировать слот',
        variant: 'destructive'
      });
    }
  };

  const handleUnblockSlot = async (blockedSlotItem: BlockedSlot) => {
    if (!confirm('Разблокировать этот слот?')) return;

    try {
      await consultationService.deleteBlockedSlot(blockedSlotItem.id);
      toast({ title: 'Слот разблокирован' });
      await loadData();
    } catch (error) {
      toast({
        title: 'Ошибка',
        description: 'Не удалось разблокировать слот',
        variant: 'destructive'
      });
    }
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
      <Card>
        <CardContent className="py-8">
          <div className="text-center">
            <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground mx-auto" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Навигация по датам и кнопки */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">Расписание</h2>
          <p className="text-muted-foreground text-sm">{formatDate(selectedDate)}</p>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={loadData} disabled={isLoading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
            Обновить
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
          size="icon"
          onClick={() => {
            const newDate = new Date(selectedDate);
            newDate.setDate(newDate.getDate() - 1);
            setSelectedDate(newDate);
          }}
        >
          <ChevronLeft className="w-4 h-4" />
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
          size="icon"
          onClick={() => {
            const newDate = new Date(selectedDate);
            newDate.setDate(newDate.getDate() + 1);
            setSelectedDate(newDate);
          }}
        >
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>

      {/* Календарная сетка */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <div className="min-w-[400px]">
              {/* Заголовок */}
              <div className="grid grid-cols-[80px_1fr] border-b bg-muted/50">
                <div className="p-2 font-medium text-muted-foreground border-r text-sm">Время</div>
                <div className="p-2">
                  <div className="font-medium text-sm">Слоты</div>
                </div>
              </div>

              {/* Временные слоты */}
              {availableTimeSlots.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  <div className="text-lg font-medium mb-1">Расписание не установлено</div>
                  <div className="text-sm">Настройте рабочие часы на этот день в разделе "Расписание"</div>
                </div>
              ) : availableTimeSlots.map(timeSlot => {
                const consultation = getConsultationForSlot(timeSlot);
                const isBlocked = isSlotBlocked(timeSlot);
                const blockedSlotItem = getBlockedSlot(timeSlot);
                const blockedReasonText = getBlockedReason(timeSlot);

                return (
                  <div
                    key={timeSlot}
                    className="grid grid-cols-[80px_1fr] border-b hover:bg-muted/30"
                  >
                    <div className="p-2 border-r bg-muted/30 font-medium text-muted-foreground text-sm">
                      {timeSlot}
                    </div>

                    <div className="p-1 min-h-[40px]">
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
                            {consultation.lead?.contact_name || 'Клиент'}
                          </div>
                          <div className="opacity-90 truncate">
                            {consultation.lead?.contact_phone}
                          </div>
                        </button>
                      ) : isBlocked && blockedSlotItem ? (
                        <button
                          onClick={() => handleUnblockSlot(blockedSlotItem)}
                          className="w-full h-full rounded bg-amber-100 border border-amber-300 flex items-center justify-center text-amber-700 hover:bg-amber-200 transition-colors"
                          title="Нажмите чтобы разблокировать"
                        >
                          <div className="text-center">
                            <Coffee className="w-3 h-3 mx-auto" />
                            <div className="text-xs truncate max-w-full px-1">{blockedReasonText}</div>
                          </div>
                        </button>
                      ) : (
                        <div className="relative group w-full h-full">
                          <button
                            onClick={() => {
                              setNewConsultation(prev => ({
                                ...prev,
                                date: selectedDate.toISOString().split('T')[0],
                                start_time: timeSlot
                              }));
                              setIsNewConsultationOpen(true);
                            }}
                            className="w-full h-full rounded border border-dashed border-muted-foreground/30 hover:border-primary hover:bg-primary/5 transition-colors flex items-center justify-center text-muted-foreground hover:text-primary"
                          >
                            <Plus className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </button>
                          {/* Кнопка блокировки при hover */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleBlockSlot(timeSlot);
                            }}
                            className="absolute top-0 right-0 p-1 opacity-0 group-hover:opacity-100 transition-opacity text-amber-600 hover:text-amber-800 bg-white/80 rounded-bl"
                            title="Сделать перерыв"
                          >
                            <Coffee className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Модальное окно новой консультации */}
      <Dialog open={isNewConsultationOpen} onOpenChange={setIsNewConsultationOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новая консультация</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {services.length > 0 && (
              <div>
                <Label>Услуга</Label>
                <Select
                  value={newConsultation.service_id}
                  onValueChange={(value) => {
                    const service = services.find(s => s.id === value);
                    setNewConsultation(prev => ({
                      ...prev,
                      service_id: value,
                      end_time: prev.start_time && service
                        ? calculateEndTimeWithDuration(prev.start_time, service.duration_minutes)
                        : prev.end_time
                    }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите услугу (опционально)" />
                  </SelectTrigger>
                  <SelectContent>
                    {services.map(service => (
                      <SelectItem key={service.id} value={service.id}>
                        <div className="flex items-center gap-2">
                          <span>{service.name}</span>
                          <span className="text-muted-foreground text-xs">
                            ({service.duration_minutes} мин
                            {service.price > 0 && `, ${service.price} ₽`})
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

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
                  <div className="font-medium">{selectedConsultation.lead?.contact_name || 'Не указан'}</div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Телефон</Label>
                  <div className="flex items-center gap-1">
                    <Phone className="w-3 h-3" />
                    {selectedConsultation.lead?.contact_phone}
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Время</Label>
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {selectedConsultation.start_time} - {selectedConsultation.end_time}
                  </div>
                </div>
                {selectedConsultation.service_name && (
                  <div>
                    <Label className="text-muted-foreground">Услуга</Label>
                    <div>{selectedConsultation.service_name}</div>
                  </div>
                )}
                {selectedConsultation.price && (
                  <div>
                    <Label className="text-muted-foreground">Стоимость</Label>
                    <div className="flex items-center gap-1">
                      <DollarSign className="w-3 h-3" />
                      {selectedConsultation.price} ₽
                    </div>
                  </div>
                )}
              </div>

              <div>
                <Label className="text-muted-foreground">Статус</Label>
                <div className="mt-1">
                  <Badge className={getStatusColor(selectedConsultation.status).replace('border-', '')}>
                    {getStatusText(selectedConsultation.status)}
                  </Badge>
                </div>
              </div>

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
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red-600 border-red-300 hover:bg-red-50"
                  onClick={() => handleDelete(selectedConsultation.id)}
                >
                  Удалить
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Модальное окно блокировки слота */}
      <Dialog open={isBlockSlotModalOpen} onOpenChange={setIsBlockSlotModalOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Coffee className="w-5 h-5 text-amber-600" />
              Заблокировать слот
            </DialogTitle>
          </DialogHeader>
          {slotToBlock && (
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                <p><strong>Дата:</strong> {formatDate(selectedDate)}</p>
                <p><strong>Время:</strong> {slotToBlock.time}</p>
              </div>

              <div>
                <Label>Причина</Label>
                <Select value={blockReason} onValueChange={setBlockReason}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Перерыв">Перерыв</SelectItem>
                    <SelectItem value="Обед">Обед</SelectItem>
                    <SelectItem value="Личные дела">Личные дела</SelectItem>
                    <SelectItem value="Встреча">Встреча</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex gap-2 pt-2">
                <Button onClick={handleCreateBlockedSlot} className="flex-1 bg-amber-600 hover:bg-amber-700">
                  <Coffee className="w-4 h-4 mr-1" />
                  Заблокировать
                </Button>
                <Button variant="outline" onClick={() => setIsBlockSlotModalOpen(false)}>
                  Отмена
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
