import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, Clock, User, Phone, Plus, ChevronLeft, ChevronRight, RefreshCw, Coffee } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { consultationService, BlockedSlot } from '@/services/consultationService';
import {
  Consultant,
  ConsultationWithDetails,
  WorkingSchedule,
  ConsultationService
} from '@/types/consultation';

export function Consultations() {
  const { toast } = useToast();

  // Hardcoded user account ID - в реальном приложении получать из auth
  const userAccountId = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b';

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

  // Расписания консультантов
  const [allSchedules, setAllSchedules] = useState<WorkingSchedule[]>([]);

  // Модальные окна
  const [isNewConsultationOpen, setIsNewConsultationOpen] = useState(false);
  const [selectedConsultation, setSelectedConsultation] = useState<ConsultationWithDetails | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [services, setServices] = useState<ConsultationService[]>([]);

  // Форма новой консультации
  const [newConsultation, setNewConsultation] = useState({
    consultant_id: '',
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

  // Заблокированные слоты (обеды, перерывы)
  const [blockedSlots, setBlockedSlots] = useState<BlockedSlot[]>([]);

  // Модальное окно блокировки слота
  const [isBlockSlotModalOpen, setIsBlockSlotModalOpen] = useState(false);
  const [slotToBlock, setSlotToBlock] = useState<{
    consultant_id: string;
    consultant_name: string;
    time: string;
  } | null>(null);
  const [blockReason, setBlockReason] = useState('Перерыв');

  useEffect(() => {
    loadData();
  }, [selectedDate]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const dateStr = selectedDate.toISOString().split('T')[0];

      const [consultantsData, consultationsData, statsData, schedulesData, servicesData, blockedSlotsData] = await Promise.all([
        consultationService.getConsultants(),
        consultationService.getConsultations(dateStr),
        consultationService.getStats(),
        consultationService.getAllSchedules().catch(() => []),
        consultationService.getServices(userAccountId).catch(() => []),
        consultationService.getBlockedSlots({ date: dateStr }).catch(() => [])
      ]);

      setConsultants(consultantsData);
      setConsultations(consultationsData);
      setStats(statsData);
      setAllSchedules(schedulesData);
      setServices(servicesData);
      setBlockedSlots(blockedSlotsData);
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

      // Получить цену услуги если выбрана
      const selectedService = services.find(s => s.id === newConsultation.service_id);
      const endTime = newConsultation.end_time ||
        (selectedService
          ? calculateEndTimeWithDuration(newConsultation.start_time, selectedService.duration_minutes)
          : calculateEndTime(newConsultation.start_time));

      await consultationService.createConsultation({
        consultant_id: newConsultation.consultant_id,
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
        consultant_id: '',
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

  // Проверка, находится ли слот вне рабочего времени консультанта
  const isSlotOutsideWorkingHours = (consultantId: string, timeSlot: string): boolean => {
    const dayOfWeek = selectedDate.getDay(); // 0 = воскресенье
    const schedule = allSchedules.find(
      s => s.consultant_id === consultantId && s.day_of_week === dayOfWeek && s.is_active
    );

    // Если нет расписания на этот день — слот недоступен
    if (!schedule) return true;

    const slotMinutes = parseInt(timeSlot.split(':')[0]) * 60 + parseInt(timeSlot.split(':')[1]);
    const startMinutes = parseInt(schedule.start_time.split(':')[0]) * 60 + parseInt(schedule.start_time.split(':')[1]);
    const endMinutes = parseInt(schedule.end_time.split(':')[0]) * 60 + parseInt(schedule.end_time.split(':')[1]);

    return slotMinutes < startMinutes || slotMinutes >= endMinutes;
  };

  // Проверка, доступен ли слот хотя бы для одного консультанта
  const isSlotAvailableForAnyConsultant = (timeSlot: string): boolean => {
    return consultants.some(consultant => !isSlotOutsideWorkingHours(consultant.id, timeSlot));
  };

  // Отфильтрованные слоты - только те, где есть хотя бы один работающий консультант
  const availableTimeSlots = timeSlots.filter(slot => isSlotAvailableForAnyConsultant(slot));

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
    const dateStr = selectedDate.toISOString().split('T')[0];
    return blockedSlots.some(slot =>
      slot.consultant_id === consultantId &&
      slot.date === dateStr &&
      slot.start_time.substring(0, 5) === timeSlot
    );
  };

  const getBlockedSlot = (consultantId: string, timeSlot: string): BlockedSlot | undefined => {
    const dateStr = selectedDate.toISOString().split('T')[0];
    return blockedSlots.find(slot =>
      slot.consultant_id === consultantId &&
      slot.date === dateStr &&
      slot.start_time.substring(0, 5) === timeSlot
    );
  };

  const getBlockedReason = (consultantId: string, timeSlot: string) => {
    return getBlockedSlot(consultantId, timeSlot)?.reason || 'Перерыв';
  };

  // Обработчики блокировки слотов
  const handleBlockSlot = (consultantId: string, consultantName: string, timeSlot: string) => {
    setSlotToBlock({ consultant_id: consultantId, consultant_name: consultantName, time: timeSlot });
    setBlockReason('Перерыв');
    setIsBlockSlotModalOpen(true);
  };

  const handleCreateBlockedSlot = async () => {
    if (!slotToBlock) return;

    try {
      const dateStr = selectedDate.toISOString().split('T')[0];
      const endTime = calculateEndTime(slotToBlock.time);

      await consultationService.createBlockedSlot({
        consultant_id: slotToBlock.consultant_id,
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
            <Link to="/consultations/consultants">
              <Button>
                <Plus className="w-4 h-4 mr-1" />
                Добавить консультанта
              </Button>
            </Link>
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

                {/* Временные слоты (только доступные для записи) */}
                {availableTimeSlots.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    <div className="text-lg font-medium mb-1">Расписание не установлено</div>
                    <div className="text-sm">Настройте рабочие часы консультантов на этот день</div>
                  </div>
                ) : availableTimeSlots.map(timeSlot => (
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
                      const blockedSlotItem = getBlockedSlot(consultant.id, timeSlot);
                      const blockedReasonText = getBlockedReason(consultant.id, timeSlot);
                      const isOutsideHours = isSlotOutsideWorkingHours(consultant.id, timeSlot);

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
                          ) : isOutsideHours ? null : (
                            <div className="relative group w-full h-full">
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
                                className="w-full h-full rounded border border-dashed border-muted-foreground/30 hover:border-primary hover:bg-primary/5 transition-colors flex items-center justify-center text-muted-foreground hover:text-primary"
                              >
                                <Plus className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                              </button>
                              {/* Кнопка блокировки при hover */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleBlockSlot(consultant.id, consultant.name, timeSlot);
                                }}
                                className="absolute top-0 right-0 p-1 opacity-0 group-hover:opacity-100 transition-opacity text-amber-600 hover:text-amber-800 bg-white/80 rounded-bl"
                                title="Сделать перерыв"
                              >
                                <Coffee className="w-3 h-3" />
                              </button>
                            </div>
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
                      // Автозаполнение времени окончания на основе длительности услуги
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
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: service.color }}
                          />
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
                <p><strong>Консультант:</strong> {slotToBlock.consultant_name}</p>
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
