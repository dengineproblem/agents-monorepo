import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { consultantApi, Consultation, WorkingSchedule, Sale } from '@/services/consultantApi';
import { consultationService, BlockedSlot } from '@/services/consultationService';
import { ConsultationService } from '@/types/consultation';
import { CreateTaskData } from '@/types/task';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Calendar, Clock, Phone, Plus, ChevronLeft, ChevronRight, RefreshCw, Coffee, DollarSign, CheckSquare, ShoppingBag } from 'lucide-react';
import { ChatSection } from './ChatSection';

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
  const [isCreateTaskOpen, setIsCreateTaskOpen] = useState(false);
  const [isRescheduleModalOpen, setIsRescheduleModalOpen] = useState(false);
  const [rescheduleData, setRescheduleData] = useState({
    date: '',
    start_time: ''
  });
  const [draggedConsultation, setDraggedConsultation] = useState<Consultation | null>(null);
  const [dropTargetSlot, setDropTargetSlot] = useState<string | null>(null);

  // Продажи
  const [clientSales, setClientSales] = useState<Sale[]>([]);
  const [isLoadingSales, setIsLoadingSales] = useState(false);
  const [isAddSaleModalOpen, setIsAddSaleModalOpen] = useState(false);
  const [newSale, setNewSale] = useState({
    amount: '',
    product_name: '',
    sale_date: '',
    comment: ''
  });

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

  // Форма новой задачи
  const [newTask, setNewTask] = useState<CreateTaskData>({
    title: '',
    description: '',
    due_date: '',
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
        consultantApi.getConsultations({ date: dateStr, consultantId }),
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

    // Проверяем, попадает ли слот в интервал консультации (start_time <= slot < end_time)
    return consultations.find(c => {
      if (c.date !== dateStr) return false;

      const consultationStart = normalizeTime(c.start_time);
      const consultationEnd = normalizeTime(c.end_time);
      const slot = normalizeTime(timeSlot);

      // Слот попадает в консультацию, если он >= start и < end
      return slot >= consultationStart && slot < consultationEnd;
    });
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

  const handleCreateTask = async () => {
    if (!consultantId || !newTask.title || !newTask.due_date) {
      toast({
        title: 'Ошибка',
        description: 'Заполните название и дату задачи',
        variant: 'destructive'
      });
      return;
    }

    try {
      await consultantApi.createTask({
        ...newTask,
        consultantId,
      });

      toast({
        title: 'Успешно',
        description: 'Задача создана'
      });

      setIsCreateTaskOpen(false);
      setNewTask({
        title: '',
        description: '',
        due_date: '',
      });
    } catch (error: any) {
      toast({
        title: 'Ошибка',
        description: error.message || 'Не удалось создать задачу',
        variant: 'destructive'
      });
    }
  };

  const handleOpenRescheduleModal = () => {
    if (!selectedConsultation) return;
    setRescheduleData({
      date: selectedConsultation.date,
      start_time: selectedConsultation.start_time
    });
    setIsRescheduleModalOpen(true);
  };

  const handleRescheduleConsultation = async () => {
    if (!selectedConsultation || !rescheduleData.date || !rescheduleData.start_time) {
      toast({
        title: 'Ошибка',
        description: 'Заполните дату и время',
        variant: 'destructive'
      });
      return;
    }

    try {
      await consultationService.rescheduleConsultation(selectedConsultation.id, {
        new_date: rescheduleData.date,
        new_start_time: rescheduleData.start_time
      });

      toast({
        title: 'Успешно',
        description: 'Консультация перенесена'
      });

      setIsRescheduleModalOpen(false);
      setIsDetailModalOpen(false);
      await loadData();
    } catch (error: any) {
      toast({
        title: 'Ошибка',
        description: error.message || 'Не удалось перенести консультацию',
        variant: 'destructive'
      });
    }
  };

  // Загрузка продаж клиента
  const loadClientSales = async (clientPhone: string) => {
    if (!consultantId || !clientPhone) return;

    setIsLoadingSales(true);
    try {
      const data = await consultantApi.getSales({
        consultantId,
        search: clientPhone,
        limit: '100'
      });
      setClientSales(data.sales || []);
    } catch (error) {
      console.error('Ошибка загрузки продаж клиента:', error);
      setClientSales([]);
    } finally {
      setIsLoadingSales(false);
    }
  };

  // Открытие модалки с загрузкой продаж
  const handleOpenConsultationDetail = async (consultation: Consultation) => {
    setSelectedConsultation(consultation);
    setIsDetailModalOpen(true);
    if (consultation.client_phone) {
      await loadClientSales(consultation.client_phone);
    }
  };

  // Создание продажи
  const handleCreateSale = async () => {
    if (!consultantId || !selectedConsultation) return;

    if (!newSale.amount || !newSale.product_name || !newSale.sale_date) {
      toast({
        title: 'Ошибка',
        description: 'Заполните все обязательные поля',
        variant: 'destructive'
      });
      return;
    }

    try {
      await consultantApi.createSale({
        consultantId,
        amount: parseFloat(newSale.amount),
        product_name: newSale.product_name,
        sale_date: newSale.sale_date,
        comment: newSale.comment || undefined,
        client_name: selectedConsultation.client_name || undefined,
        client_phone: selectedConsultation.client_phone,
        lead_id: selectedConsultation.dialog_analysis_id || undefined
      });

      toast({
        title: 'Успешно',
        description: 'Продажа добавлена'
      });

      setIsAddSaleModalOpen(false);
      setNewSale({
        amount: '',
        product_name: '',
        sale_date: '',
        comment: ''
      });

      // Перезагрузить продажи
      if (selectedConsultation.client_phone) {
        await loadClientSales(selectedConsultation.client_phone);
      }
    } catch (error: any) {
      toast({
        title: 'Ошибка',
        description: error.message || 'Не удалось добавить продажу',
        variant: 'destructive'
      });
    }
  };

  // Открытие формы добавления продажи
  const handleOpenAddSaleModal = () => {
    setNewSale({
      amount: '',
      product_name: '',
      sale_date: new Date().toISOString().split('T')[0],
      comment: ''
    });
    setIsAddSaleModalOpen(true);
  };

  // Drag & Drop handlers
  const handleDragStart = (consultation: Consultation) => (e: React.DragEvent) => {
    setDraggedConsultation(consultation);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.currentTarget.innerHTML);
    // Добавляем класс для визуального эффекта
    e.currentTarget.classList.add('opacity-50');
  };

  const handleDragEnd = (e: React.DragEvent) => {
    e.currentTarget.classList.remove('opacity-50');
    setDraggedConsultation(null);
    setDropTargetSlot(null);
  };

  const handleDragOver = (timeSlot: string) => (e: React.DragEvent) => {
    e.preventDefault(); // Необходимо для drop
    e.dataTransfer.dropEffect = 'move';
    setDropTargetSlot(timeSlot);
  };

  const handleDragLeave = () => {
    setDropTargetSlot(null);
  };

  const handleDrop = (timeSlot: string) => async (e: React.DragEvent) => {
    e.preventDefault();
    setDropTargetSlot(null);

    if (!draggedConsultation) return;

    const newDate = selectedDate.toISOString().split('T')[0];
    const newStartTime = timeSlot;

    // Проверяем, что не переносим на то же время
    if (draggedConsultation.date === newDate && draggedConsultation.start_time === newStartTime) {
      return;
    }

    try {
      await consultationService.rescheduleConsultation(draggedConsultation.id, {
        new_date: newDate,
        new_start_time: newStartTime
      });

      toast({
        title: 'Успешно',
        description: 'Консультация перенесена'
      });

      await loadData();
    } catch (error: any) {
      toast({
        title: 'Ошибка',
        description: error.message || 'Не удалось перенести консультацию',
        variant: 'destructive'
      });
    }

    setDraggedConsultation(null);
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
                          draggable={consultation.status !== 'completed' && consultation.status !== 'cancelled'}
                          onDragStart={handleDragStart(consultation)}
                          onDragEnd={handleDragEnd}
                          onClick={() => handleOpenConsultationDetail(consultation)}
                          className={`
                            w-full p-2 rounded text-white text-left text-xs
                            hover:opacity-90 transition-opacity cursor-move
                            ${getStatusColor(consultation.status)}
                          `}
                          title="Перетащите для переноса на другое время"
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
                      ) : (
                        <div
                          className="relative group w-full h-full"
                          onDragOver={handleDragOver(timeSlot)}
                          onDragLeave={handleDragLeave}
                          onDrop={handleDrop(timeSlot)}
                        >
                          <button
                            onClick={() => {
                              setNewConsultation(prev => ({
                                ...prev,
                                date: selectedDate.toISOString().split('T')[0],
                                start_time: timeSlot
                              }));
                              setIsNewConsultationOpen(true);
                            }}
                            className={`
                              w-full h-full rounded border border-dashed transition-colors flex items-center justify-center
                              ${dropTargetSlot === timeSlot
                                ? 'border-primary bg-primary/20 border-2'
                                : 'border-muted-foreground/30 hover:border-primary hover:bg-primary/5 text-muted-foreground hover:text-primary'}
                            `}
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

      {/* Задачи на выбранную дату */}
      <Card className="mt-4">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <CheckSquare className="h-5 w-5" />
              Задачи на {selectedDate.toLocaleDateString('ru-RU')}
            </CardTitle>
            <Button
              size="sm"
              onClick={() => {
                setNewTask({
                  title: '',
                  description: '',
                  due_date: selectedDate.toISOString().split('T')[0],
                });
                setIsCreateTaskOpen(true);
              }}
            >
              <Plus className="h-4 w-4 mr-1" />
              Добавить задачу
            </Button>
          </div>
        </CardHeader>
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
      <Dialog
        open={isDetailModalOpen}
        onOpenChange={(open) => {
          console.log('[CalendarTab] Detail modal state changing:', {
            open,
            consultationId: selectedConsultation?.id,
            hasDialogAnalysisId: !!selectedConsultation?.dialog_analysis_id
          });
          setIsDetailModalOpen(open);
        }}
      >
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Детали консультации</DialogTitle>
          </DialogHeader>
          {selectedConsultation && (
            <div className="flex-1 overflow-y-auto space-y-6">
              {/* Детали консультации */}
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

                {selectedConsultation.notes && (
                  <div>
                    <Label className="text-muted-foreground">Примечания</Label>
                    <div className="text-sm bg-muted p-3 rounded-md whitespace-pre-wrap">
                      {selectedConsultation.notes}
                    </div>
                  </div>
                )}

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
                    onClick={handleOpenRescheduleModal}
                    disabled={selectedConsultation.status === 'completed' || selectedConsultation.status === 'cancelled'}
                  >
                    <Calendar className="w-3 h-3 mr-1" />
                    Перенести
                  </Button>
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

              {/* Продажи клиента */}
              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-3">
                  <Label className="text-lg font-medium flex items-center gap-2">
                    <ShoppingBag className="w-4 h-4" />
                    Продажи клиента
                  </Label>
                  <Button size="sm" onClick={handleOpenAddSaleModal}>
                    <Plus className="w-3 h-3 mr-1" />
                    Добавить продажу
                  </Button>
                </div>

                {isLoadingSales ? (
                  <div className="text-center py-4 text-muted-foreground">
                    <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-2" />
                    Загрузка продаж...
                  </div>
                ) : clientSales.length === 0 ? (
                  <div className="text-center py-4 text-muted-foreground text-sm">
                    Продаж пока нет
                  </div>
                ) : (
                  <div className="space-y-2">
                    {clientSales.map(sale => (
                      <div key={sale.id} className="bg-muted p-3 rounded-md text-sm">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium">{sale.product_name || 'Продукт не указан'}</span>
                          <span className="font-bold text-green-600">{sale.amount} {sale.currency || 'KZT'}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Дата: {new Date(sale.purchase_date).toLocaleDateString('ru-RU')}
                        </div>
                        {sale.notes && (
                          <div className="text-xs text-muted-foreground mt-1">
                            {sale.notes}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Чат с клиентом */}
              {(() => {
                const hasDialogAnalysisId = selectedConsultation.dialog_analysis_id &&
                                            selectedConsultation.dialog_analysis_id.trim() !== '';

                console.log('[CalendarTab] Rendering chat section:', {
                  consultationId: selectedConsultation.id,
                  dialog_analysis_id: selectedConsultation.dialog_analysis_id,
                  hasDialogAnalysisId,
                  client_name: selectedConsultation.client_name,
                  client_phone: selectedConsultation.client_phone
                });

                if (hasDialogAnalysisId) {
                  return (
                    <div className="border-t pt-4">
                      <ChatSection
                        leadId={selectedConsultation.dialog_analysis_id}
                        clientName={selectedConsultation.client_name}
                        clientPhone={selectedConsultation.client_phone}
                      />
                    </div>
                  );
                } else {
                  return (
                    <div className="border-t pt-4">
                      <div className="text-center py-4 text-muted-foreground">
                        Чат недоступен для этой консультации
                        {selectedConsultation.dialog_analysis_id === null && (
                          <p className="text-xs mt-1">(Консультация не связана с лидом)</p>
                        )}
                      </div>
                    </div>
                  );
                }
              })()}
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

      {/* Модальное окно создания задачи */}
      <Dialog open={isCreateTaskOpen} onOpenChange={setIsCreateTaskOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новая задача</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>Название *</Label>
              <Input
                value={newTask.title}
                onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                placeholder="Введите название задачи"
              />
            </div>
            <div>
              <Label>Описание</Label>
              <Textarea
                value={newTask.description}
                onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                placeholder="Дополнительная информация..."
                rows={3}
              />
            </div>
            <div>
              <Label>Дата выполнения *</Label>
              <Input
                type="date"
                value={newTask.due_date}
                onChange={(e) => setNewTask({ ...newTask, due_date: e.target.value })}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setIsCreateTaskOpen(false);
                setNewTask({
                  title: '',
                  description: '',
                  due_date: '',
                });
              }}
            >
              Отмена
            </Button>
            <Button onClick={handleCreateTask}>Создать</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Модальное окно переноса консультации */}
      <Dialog open={isRescheduleModalOpen} onOpenChange={setIsRescheduleModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5" />
              Перенести консультацию
            </DialogTitle>
          </DialogHeader>
          {selectedConsultation && (
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground bg-muted p-3 rounded-md">
                <p><strong>Клиент:</strong> {selectedConsultation.client_name || 'Не указан'}</p>
                <p><strong>Текущее время:</strong> {selectedConsultation.date} в {selectedConsultation.start_time}</p>
              </div>

              <div>
                <Label>Новая дата</Label>
                <Input
                  type="date"
                  value={rescheduleData.date}
                  onChange={(e) => setRescheduleData(prev => ({ ...prev, date: e.target.value }))}
                />
              </div>

              <div>
                <Label>Новое время начала</Label>
                <Select
                  value={rescheduleData.start_time}
                  onValueChange={(value) => setRescheduleData(prev => ({ ...prev, start_time: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите время" />
                  </SelectTrigger>
                  <SelectContent>
                    {timeSlots.map(time => (
                      <SelectItem key={time} value={time}>{time}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex gap-2 pt-2">
                <Button onClick={handleRescheduleConsultation} className="flex-1">
                  <Calendar className="w-4 h-4 mr-1" />
                  Перенести
                </Button>
                <Button variant="outline" onClick={() => setIsRescheduleModalOpen(false)}>
                  Отмена
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Модальное окно добавления продажи */}
      <Dialog open={isAddSaleModalOpen} onOpenChange={setIsAddSaleModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingBag className="w-5 h-5" />
              Добавить продажу
            </DialogTitle>
          </DialogHeader>
          {selectedConsultation && (
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground bg-muted p-3 rounded-md">
                <p><strong>Клиент:</strong> {selectedConsultation.client_name || 'Не указан'}</p>
                <p><strong>Телефон:</strong> {selectedConsultation.client_phone}</p>
              </div>

              <div>
                <Label>Название товара/услуги *</Label>
                <Input
                  value={newSale.product_name}
                  onChange={(e) => setNewSale(prev => ({ ...prev, product_name: e.target.value }))}
                  placeholder="Например: Консультация"
                />
              </div>

              <div>
                <Label>Сумма (KZT) *</Label>
                <Input
                  type="number"
                  value={newSale.amount}
                  onChange={(e) => setNewSale(prev => ({ ...prev, amount: e.target.value }))}
                  placeholder="0"
                />
              </div>

              <div>
                <Label>Дата продажи *</Label>
                <Input
                  type="date"
                  value={newSale.sale_date}
                  onChange={(e) => setNewSale(prev => ({ ...prev, sale_date: e.target.value }))}
                />
              </div>

              <div>
                <Label>Комментарий</Label>
                <Textarea
                  value={newSale.comment}
                  onChange={(e) => setNewSale(prev => ({ ...prev, comment: e.target.value }))}
                  placeholder="Дополнительная информация..."
                  rows={3}
                />
              </div>

              <div className="flex gap-2 pt-2">
                <Button onClick={handleCreateSale} className="flex-1">
                  <ShoppingBag className="w-4 h-4 mr-1" />
                  Добавить
                </Button>
                <Button variant="outline" onClick={() => setIsAddSaleModalOpen(false)}>
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
