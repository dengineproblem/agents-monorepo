import React, { useState, useEffect } from 'react';
import { Calendar, Clock, User, Phone, Plus, Filter, ChevronLeft, ChevronRight, RefreshCw, MessageCircle, X, Coffee, Settings, Edit, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import Header from '@/components/Header';
import DateRangePicker from '@/components/DateRangePicker';
import {
  getConsultants,
  getConsultations,
  getConsultationStats,
  createConsultation
} from '@/services/consultationService';
import {
  Consultant,
  ConsultationWithDetails
} from '@/types/consultation';
import { getServices } from '@/services/servicesService';
import { createSale, closeSaleFromConsultation } from '@/services/salesService';
import { Service, CreateSaleData } from '@/types/services';

const Consultations: React.FC = () => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [consultants, setConsultants] = useState<Consultant[]>([]);
  const [consultations, setConsultations] = useState<ConsultationWithDetails[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [stats, setStats] = useState({
    total: 0,
    scheduled: 0,
    confirmed: 0,
    completed: 0,
    cancelled: 0,
    no_show: 0
  });
  const [isNewConsultationOpen, setIsNewConsultationOpen] = useState(false);
  const [selectedConsultation, setSelectedConsultation] = useState<ConsultationWithDetails | null>(null);
  const [isClientModalOpen, setIsClientModalOpen] = useState(false);
  
  // Новые состояния для закрытия продаж
  const [isSaleModalOpen, setIsSaleModalOpen] = useState(false);
  const [availableServices, setAvailableServices] = useState<Service[]>([]);
  const [saleForm, setSaleForm] = useState<CreateSaleData>({
    service_id: '',
    client_phone: '',
    client_name: '',
    amount: 0,
    currency: 'RUB',
    status: 'pending',
    payment_method: '',
    notes: ''
  });

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

  // Временные слоты (с 9:00 до 21:00 с интервалом 60 минут) - максимально компактно
  const timeSlots = [];
  for (let hour = 9; hour <= 21; hour++) {
    const timeString = `${hour.toString().padStart(2, '0')}:00`;
    timeSlots.push(timeString);
  }

  // Заблокированные слоты (перерывы, обеды и т.д.)
  const blockedSlots = [
    { consultant_id: '1', time: '13:00', reason: 'Обед' },
    { consultant_id: '2', time: '12:00', reason: 'Перерыв' },
    { consultant_id: '3', time: '15:00', reason: 'Встреча' },
  ];

  // Новые состояния для управления услугами
  const [isServicesModalOpen, setIsServicesModalOpen] = useState(false);
  const [isCreateServiceModalOpen, setIsCreateServiceModalOpen] = useState(false);
  const [isEditServiceModalOpen, setIsEditServiceModalOpen] = useState(false);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [serviceForm, setServiceForm] = useState({
    name: '',
    description: '',
    service_type: 'online' as 'online' | 'offline' | 'hybrid',
    duration_minutes: 60,
    price: 0,
    category: ''
  });

  useEffect(() => {
    loadData();
  }, [selectedDate]);

  const loadData = async () => {
    setIsLoadingData(true);
    try {
      const dateStr = selectedDate.toISOString().split('T')[0];
      
      const [consultantsData, consultationsData, statsData, servicesData] = await Promise.all([
        getConsultants(),
        getConsultations(dateStr),
        getConsultationStats(),
        getServices()
      ]);
      
      setConsultants(consultantsData);
      setConsultations(consultationsData);
      setStats(statsData);
      setAvailableServices(servicesData);
    } catch (error) {
      console.error('Ошибка загрузки данных:', error);
      toast.error('Не удалось загрузить данные');
    } finally {
      setIsLoadingData(false);
    }
  };

  // Функция для открытия модального окна создания консультации
  const handleOpenNewConsultationModal = () => {
    // Устанавливаем текущую выбранную дату
    setNewConsultation(prev => ({
      ...prev,
      date: selectedDate.toISOString().split('T')[0]
    }));
    setIsNewConsultationOpen(true);
  };

  const handleCreateConsultation = async () => {
    try {
      // Валидация данных
      if (!newConsultation.consultant_id || !newConsultation.client_phone || !newConsultation.date || !newConsultation.start_time) {
        toast.error('Пожалуйста, заполните все обязательные поля');
        return;
      }

      // Создаем объект консультации
      const consultationData = {
        consultant_id: newConsultation.consultant_id,
        client_phone: newConsultation.client_phone,
        client_name: newConsultation.client_name || '',
        client_chat_id: '',
        date: newConsultation.date,
        start_time: newConsultation.start_time,
        end_time: newConsultation.end_time || calculateEndTime(newConsultation.start_time),
        status: 'scheduled' as const,
        consultation_type: 'general',
        notes: newConsultation.notes || ''
      };

      console.log('Создание консультации:', consultationData);
      
      // Вызываем API для создания консультации
      const createdConsultation = await createConsultation(consultationData);
      
      toast.success('Консультация успешно создана');
      setIsNewConsultationOpen(false);
      
      // Очищаем форму
      setNewConsultation({
        consultant_id: '',
        client_name: '',
        client_phone: '',
        date: '',
        start_time: '',
        end_time: '',
        notes: ''
      });
      
      // Перезагружаем данные
      await loadData();
    } catch (error) {
      console.error('Ошибка создания консультации:', error);
      toast.error('Не удалось создать консультацию');
    }
  };

  // Вспомогательная функция для расчета времени окончания
  const calculateEndTime = (startTime: string): string => {
    const [hours, minutes] = startTime.split(':').map(Number);
    const endHours = hours + 1; // По умолчанию 1 час
    return `${endHours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  };

  const handleConsultationClick = (consultation: ConsultationWithDetails) => {
    setSelectedConsultation(consultation);
    setIsClientModalOpen(true);
  };

  // Новая функция для открытия модального окна продажи
  const handleOpenSaleModal = (consultation: ConsultationWithDetails) => {
    setSelectedConsultation(consultation);
    setSaleForm({
      service_id: '',
      client_phone: consultation.client_phone || '',
      client_name: consultation.client_name || '',
      amount: 0,
      currency: 'RUB',
      status: 'pending',
      payment_method: '',
      notes: ''
    });
    setIsSaleModalOpen(true);
  };

  // Функция закрытия продажи
  const handleCloseSale = async () => {
    if (!selectedConsultation) return;
    
    try {
      await closeSaleFromConsultation(selectedConsultation.id, saleForm);
      toast.success('Продажа успешно закрыта');
      setIsSaleModalOpen(false);
      await loadData();
    } catch (error) {
      console.error('Ошибка закрытия продажи:', error);
      toast.error('Не удалось закрыть продажу');
    }
  };

  // Получаем консультации для выбранной даты и консультанта
  const getConsultationForSlot = (consultantId: string, timeSlot: string) => {
    const dateStr = selectedDate.toISOString().split('T')[0];
    
    // Нормализуем время для сравнения (убираем секунды если есть)
    const normalizeTime = (time: string) => {
      if (!time) return '';
      return time.split(':').slice(0, 2).join(':'); // Берем только часы:минуты
    };
    
    const foundConsultation = consultations.find(c => {
      const matches = c.consultant_id === consultantId && 
                     c.date === dateStr && 
                     normalizeTime(c.start_time) === normalizeTime(timeSlot);
      
      return matches;
    });
    
    return foundConsultation;
  };

  // Проверяем, заблокирован ли слот
  const isSlotBlocked = (consultantId: string, timeSlot: string) => {
    return blockedSlots.some(slot => 
      slot.consultant_id === consultantId && slot.time === timeSlot
    );
  };

  // Получаем причину блокировки слота
  const getBlockedReason = (consultantId: string, timeSlot: string) => {
    const blocked = blockedSlots.find(slot => 
      slot.consultant_id === consultantId && slot.time === timeSlot
    );
    return blocked?.reason || '';
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

  const handleCreateServiceFromConsultations = async () => {
    try {
      const { createService } = await import('@/services/servicesService');
      await createService(serviceForm);
      toast.success('Услуга создана успешно');
      setIsCreateServiceModalOpen(false);
      setServiceForm({
        name: '',
        description: '',
        service_type: 'online',
        duration_minutes: 60,
        price: 0,
        category: ''
      });
      await loadData(); // Обновляем список услуг
    } catch (error) {
      console.error('Ошибка создания услуги:', error);
      toast.error('Не удалось создать услугу');
    }
  };

  const handleEditService = async () => {
    if (!selectedService) return;
    
    try {
      const { updateService } = await import('@/services/servicesService');
      await updateService(selectedService.id, serviceForm);
      toast.success('Услуга обновлена успешно');
      setIsEditServiceModalOpen(false);
      setSelectedService(null);
      setServiceForm({
        name: '',
        description: '',
        service_type: 'online',
        duration_minutes: 60,
        price: 0,
        category: ''
      });
      await loadData(); // Обновляем список услуг
    } catch (error) {
      console.error('Ошибка обновления услуги:', error);
      toast.error('Не удалось обновить услугу');
    }
  };

  const handleDeleteService = async (service: Service) => {
    if (!confirm(`Вы уверены, что хотите удалить услугу "${service.name}"?`)) {
      return;
    }
    
    try {
      const { deleteService } = await import('@/services/servicesService');
      await deleteService(service.id);
      toast.success('Услуга удалена');
      await loadData(); // Обновляем список услуг
    } catch (error) {
      console.error('Ошибка удаления услуги:', error);
      toast.error('Не удалось удалить услугу');
    }
  };

  const openEditServiceModal = (service: Service) => {
    setSelectedService(service);
    setServiceForm({
      name: service.name,
      description: service.description || '',
      service_type: service.service_type,
      duration_minutes: service.duration_minutes,
      price: service.price || 0,
      category: service.category || ''
    });
    setIsEditServiceModalOpen(true);
  };

  if (isLoadingData) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
              <Header onOpenDatePicker={() => setDatePickerOpen(true)} />
      
      <main className="flex-1 p-2 md:p-4 space-y-2 md:space-y-4">
        {/* Заголовок и кнопки - адаптивно */}
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
          <div>
            <h1 className="text-lg md:text-2xl font-bold">Расписание консультаций</h1>
            <p className="text-gray-600 text-xs md:text-sm">{formatDate(selectedDate)}</p>
          </div>
          
          <div className="flex gap-1 md:gap-2">
            <Button 
              variant="outline" 
              size="sm"
              onClick={loadData}
              disabled={isLoadingData}
              className="text-xs md:text-sm"
            >
              <RefreshCw className={`h-3 w-3 mr-1 ${isLoadingData ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Обновить</span>
            </Button>
            
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => setIsServicesModalOpen(true)}
              className="text-xs md:text-sm"
            >
              <Settings className="h-3 w-3 mr-1" />
              <span className="hidden sm:inline">Услуги</span>
              <span className="sm:hidden">⚙️</span>
            </Button>
            
            <Dialog open={isNewConsultationOpen} onOpenChange={setIsNewConsultationOpen}>
              <DialogTrigger asChild>
                <Button 
                  size="sm" 
                  className="flex items-center gap-1 text-xs md:text-sm"
                  onClick={handleOpenNewConsultationModal}
                >
                  <Plus className="w-3 h-3" />
                  <span className="hidden sm:inline">Новая запись</span>
                  <span className="sm:hidden">+</span>
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-[95vw] md:max-w-md max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Новая консультация</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="consultant">Консультант</Label>
                    <Select value={newConsultation.consultant_id} onValueChange={(value) => 
                      setNewConsultation(prev => ({ ...prev, consultant_id: value }))
                    }>
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
                    <Label htmlFor="client_name">Имя клиента</Label>
                    <Input
                      id="client_name"
                      value={newConsultation.client_name}
                      onChange={(e) => setNewConsultation(prev => ({ ...prev, client_name: e.target.value }))}
                      placeholder="Введите имя клиента"
                    />
                  </div>

                  <div>
                    <Label htmlFor="client_phone">Телефон клиента</Label>
                    <Input
                      id="client_phone"
                      value={newConsultation.client_phone}
                      onChange={(e) => setNewConsultation(prev => ({ ...prev, client_phone: e.target.value }))}
                      placeholder="+7 (999) 123-45-67"
                    />
                  </div>

                  <div>
                    <Label htmlFor="date">Дата</Label>
                    <Input
                      id="date"
                      type="date"
                      value={newConsultation.date || selectedDate.toISOString().split('T')[0]}
                      onChange={(e) => setNewConsultation(prev => ({ ...prev, date: e.target.value }))}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label htmlFor="start_time">Время начала</Label>
                      <Select value={newConsultation.start_time} onValueChange={(value) => 
                        setNewConsultation(prev => ({ ...prev, start_time: value }))
                      }>
                        <SelectTrigger>
                          <SelectValue placeholder="Выберите время" />
                        </SelectTrigger>
                        <SelectContent>
                          {timeSlots.map(time => (
                            <SelectItem key={time} value={time}>
                              {time}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="end_time">Время окончания</Label>
                      <Input
                        id="end_time"
                        type="time"
                        value={newConsultation.end_time}
                        onChange={(e) => setNewConsultation(prev => ({ ...prev, end_time: e.target.value }))}
                      />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="notes">Примечания</Label>
                    <Textarea
                      id="notes"
                      value={newConsultation.notes}
                      onChange={(e) => setNewConsultation(prev => ({ ...prev, notes: e.target.value }))}
                      placeholder="Дополнительная информация..."
                      rows={3}
                    />
                  </div>

                  <div className="flex gap-2 pt-4">
                    <Button onClick={handleCreateConsultation} className="flex-1">
                      Создать консультацию
                    </Button>
                    <Button variant="outline" onClick={() => setIsNewConsultationOpen(false)}>
                      Отмена
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Навигация по датам - адаптивно */}
        <div className="flex items-center justify-between bg-white p-2 md:p-3 rounded-lg border">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const newDate = new Date(selectedDate);
              newDate.setDate(newDate.getDate() - 1);
              setSelectedDate(newDate);
            }}
            className="text-xs md:text-sm"
          >
            <ChevronLeft className="w-3 h-3 mr-1" />
            <span className="hidden sm:inline">Вчера</span>
            <span className="sm:hidden">←</span>
          </Button>
          
          <div className="flex items-center gap-1 md:gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedDate(new Date())}
              className="text-xs md:text-sm"
            >
              Сегодня
            </Button>
            <Input
              type="date"
              value={selectedDate.toISOString().split('T')[0]}
              onChange={(e) => setSelectedDate(new Date(e.target.value))}
              className="w-auto text-xs md:text-sm"
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
            className="text-xs md:text-sm"
          >
            <span className="hidden sm:inline">Завтра</span>
            <span className="sm:hidden">→</span>
            <ChevronRight className="w-3 h-3 ml-1" />
          </Button>
        </div>

        {/* Статистика - адаптивно */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-1 md:gap-2">
          <Card>
            <CardContent className="p-2 md:p-3">
              <div className="text-sm md:text-lg font-bold text-blue-600">{stats.total}</div>
              <div className="text-xs text-gray-600">Всего</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-2 md:p-3">
              <div className="text-sm md:text-lg font-bold text-orange-600">{stats.scheduled}</div>
              <div className="text-xs text-gray-600">Запланировано</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-2 md:p-3">
              <div className="text-sm md:text-lg font-bold text-green-600">{stats.confirmed}</div>
              <div className="text-xs text-gray-600">Подтверждено</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-2 md:p-3">
              <div className="text-sm md:text-lg font-bold text-gray-600">{stats.completed}</div>
              <div className="text-xs text-gray-600">Завершено</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-2 md:p-3">
              <div className="text-sm md:text-lg font-bold text-red-600">{stats.cancelled}</div>
              <div className="text-xs text-gray-600">Отменено</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-2 md:p-3">
              <div className="text-sm md:text-lg font-bold text-orange-600">{stats.no_show}</div>
              <div className="text-xs text-gray-600">Не явились</div>
            </CardContent>
          </Card>
        </div>

        {/* Календарная сетка - с горизонтальной прокруткой на мобильных */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <div className="min-w-[800px] md:min-w-full">
                {/* Заголовки с консультантами - адаптивно */}
                <div className="grid grid-cols-[60px_repeat(auto-fit,minmax(120px,1fr))] md:grid-cols-[80px_repeat(auto-fit,minmax(160px,1fr))] border-b bg-gray-50">
                  <div className="p-1 md:p-2 font-medium text-gray-600 border-r text-xs">Время</div>
                  {consultants.map(consultant => (
                    <div key={consultant.id} className="p-1 md:p-2 border-r last:border-r-0">
                      <div className="font-medium text-xs md:text-sm">{consultant.name}</div>
                      <div className="text-xs text-gray-500 truncate">{consultant.specialization}</div>
                    </div>
                  ))}
                </div>

                {/* Временные слоты - адаптивно */}
                <div>
                  {timeSlots.map(timeSlot => (
                    <div key={timeSlot} className="grid grid-cols-[60px_repeat(auto-fit,minmax(120px,1fr))] md:grid-cols-[80px_repeat(auto-fit,minmax(160px,1fr))] border-b hover:bg-gray-50">
                      {/* Время */}
                      <div className="p-1 md:p-2 border-r bg-gray-50 font-medium text-gray-700 text-xs">
                        {timeSlot}
                      </div>
                      
                      {/* Слоты для каждого консультанта */}
                      {consultants.map(consultant => {
                        const consultation = getConsultationForSlot(consultant.id, timeSlot);
                        const isBlocked = isSlotBlocked(consultant.id, timeSlot);
                        const blockReason = getBlockedReason(consultant.id, timeSlot);
                        
                        return (
                          <div key={consultant.id} className="p-0.5 border-r last:border-r-0 min-h-[24px] md:min-h-[28px]">
                            {consultation ? (
                              <button
                                onClick={() => handleConsultationClick(consultation)}
                                className={`
                                  w-full p-1 rounded text-white text-left text-xs
                                  hover:opacity-90 transition-opacity
                                  ${getStatusColor(consultation.status)}
                                `}
                              >
                                <div className="font-medium truncate text-xs">
                                  {consultation.client_name || 'Клиент не указан'}
                                </div>
                                <div className="text-xs opacity-90 truncate hidden md:block">
                                  {consultation.client_phone}
                                </div>
                              </button>
                            ) : isBlocked ? (
                              <div className="w-full h-full rounded bg-gray-300 border border-gray-400 flex items-center justify-center text-gray-600">
                                <div className="text-center">
                                  <Coffee className="w-2 h-2 mx-auto mb-0.5" />
                                  <div className="text-xs hidden md:block">{blockReason}</div>
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
                                className="w-full h-full rounded border border-dashed border-gray-300 hover:border-blue-400 hover:bg-blue-50 transition-colors flex items-center justify-center text-gray-400 hover:text-blue-600 group"
                              >
                                <Plus className="w-2 h-2 opacity-0 group-hover:opacity-100 transition-opacity" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Модальное окно с карточкой клиента - обновленное */}
        <Dialog open={isClientModalOpen} onOpenChange={setIsClientModalOpen}>
          <DialogContent className="max-w-[95vw] md:max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <div className="flex items-center justify-between">
                <DialogTitle>Консультация</DialogTitle>
                <div className="flex gap-2">
                  {selectedConsultation && !selectedConsultation.is_sale_closed && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setIsClientModalOpen(false);
                        handleOpenSaleModal(selectedConsultation);
                      }}
                      className="text-green-600 hover:text-green-700"
                    >
                      💰 Закрыть продажу
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsClientModalOpen(false)}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </DialogHeader>
            
            {selectedConsultation && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
                {/* Карточка клиента */}
                <div className="space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-sm md:text-base">
                        <User className="w-4 h-4 md:w-5 md:h-5" />
                        Информация о клиенте
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div>
                        <Label className="text-xs md:text-sm font-medium text-gray-600">Имя</Label>
                        <div className="text-sm md:text-lg font-medium">
                          {selectedConsultation.client_name || 'Не указано'}
                        </div>
                      </div>
                      
                      <div>
                        <Label className="text-xs md:text-sm font-medium text-gray-600">Телефон</Label>
                        <div className="flex items-center gap-2">
                          <Phone className="w-3 h-3 md:w-4 md:h-4 text-gray-500" />
                          <span className="text-sm">{selectedConsultation.client_phone || 'Не указан'}</span>
                        </div>
                      </div>
                      
                      <div>
                        <Label className="text-xs md:text-sm font-medium text-gray-600">Консультант</Label>
                        <div className="text-sm">{selectedConsultation.consultant?.name || 'Не назначен'}</div>
                      </div>
                      
                      <div>
                        <Label className="text-xs md:text-sm font-medium text-gray-600">Дата и время</Label>
                        <div className="flex items-center gap-2">
                          <Clock className="w-3 h-3 md:w-4 md:h-4 text-gray-500" />
                          <span className="text-sm">
                            {new Date(selectedConsultation.date).toLocaleDateString('ru-RU')} 
                            {' '}
                            {selectedConsultation.start_time} - {selectedConsultation.end_time}
                          </span>
                        </div>
                      </div>
                      
                      <div>
                        <Label className="text-xs md:text-sm font-medium text-gray-600">Статус</Label>
                        <Badge className={getStatusColor(selectedConsultation.status).replace('border-', 'bg-').replace('bg-', 'bg-opacity-20 text-')}>
                          {getStatusText(selectedConsultation.status)}
                        </Badge>
                      </div>
                      
                      <div>
                        <Label className="text-xs md:text-sm font-medium text-gray-600">Продажа</Label>
                        <Badge variant={selectedConsultation.is_sale_closed ? "default" : "secondary"} className="text-xs">
                          {selectedConsultation.is_sale_closed ? '✅ Закрыта' : '⏳ Не закрыта'}
                        </Badge>
                      </div>
                      
                      <div>
                        <Label className="text-xs md:text-sm font-medium text-gray-600">Примечания</Label>
                        <div className="text-xs md:text-sm text-gray-700">
                          {selectedConsultation.notes || 'Нет примечаний'}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
                
                {/* Переписка */}
                <div className="space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-sm md:text-base">
                        <MessageCircle className="w-4 h-4 md:w-5 md:h-5" />
                        Переписка с клиентом
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4 max-h-[300px] md:max-h-[400px] overflow-y-auto">
                        {/* Заглушка для сообщений */}
                        <div className="text-center text-gray-500 py-8">
                          <MessageCircle className="w-6 h-6 md:w-8 md:h-8 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">История переписки будет отображаться здесь</p>
                          <p className="text-xs">Интеграция с чатами в разработке</p>
                        </div>
                      </div>
                      
                      {/* Поле для отправки сообщения */}
                      <div className="mt-4 pt-4 border-t">
                        <div className="flex gap-2">
                          <Input
                            placeholder="Написать сообщение..."
                            className="flex-1 text-sm"
                          />
                          <Button size="sm">Отправить</Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Новое модальное окно для закрытия продажи */}
        <Dialog open={isSaleModalOpen} onOpenChange={setIsSaleModalOpen}>
          <DialogContent className="max-w-[95vw] md:max-w-md max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Закрыть продажу</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="sale_service">Услуга</Label>
                <Select value={saleForm.service_id} onValueChange={(value) => {
                  const service = availableServices.find(s => s.id === value);
                  setSaleForm(prev => ({ 
                    ...prev, 
                    service_id: value,
                    amount: service?.price || 0
                  }));
                }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите услугу" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableServices.map(service => (
                      <SelectItem key={service.id} value={service.id}>
                        {service.name} - {service.price?.toLocaleString()} ₽
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="sale_client_name">Имя клиента</Label>
                  <Input
                    id="sale_client_name"
                    value={saleForm.client_name}
                    onChange={(e) => setSaleForm(prev => ({ ...prev, client_name: e.target.value }))}
                    placeholder="Имя клиента"
                  />
                </div>
                <div>
                  <Label htmlFor="sale_client_phone">Телефон</Label>
                  <Input
                    id="sale_client_phone"
                    value={saleForm.client_phone}
                    onChange={(e) => setSaleForm(prev => ({ ...prev, client_phone: e.target.value }))}
                    placeholder="+7 (999) 123-45-67"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="sale_amount">Сумма (₽)</Label>
                  <Input
                    id="sale_amount"
                    type="number"
                    value={saleForm.amount}
                    onChange={(e) => setSaleForm(prev => ({ ...prev, amount: parseFloat(e.target.value) || 0 }))}
                    placeholder="5000"
                  />
                </div>
                <div>
                  <Label htmlFor="sale_status">Статус</Label>
                  <Select value={saleForm.status} onValueChange={(value: any) => 
                    setSaleForm(prev => ({ ...prev, status: value }))
                  }>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">Ожидает оплаты</SelectItem>
                      <SelectItem value="confirmed">Подтверждено</SelectItem>
                      <SelectItem value="paid">Оплачено</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label htmlFor="sale_payment_method">Способ оплаты</Label>
                <Select value={saleForm.payment_method} onValueChange={(value) => 
                  setSaleForm(prev => ({ ...prev, payment_method: value }))
                }>
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите способ оплаты" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="card">Банковская карта</SelectItem>
                    <SelectItem value="bank_transfer">Банковский перевод</SelectItem>
                    <SelectItem value="cash">Наличные</SelectItem>
                    <SelectItem value="crypto">Криптовалюта</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="sale_notes">Примечания</Label>
                <Textarea
                  id="sale_notes"
                  value={saleForm.notes}
                  onChange={(e) => setSaleForm(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="Дополнительная информация о продаже..."
                  rows={3}
                />
              </div>

              <div className="flex gap-2 pt-4">
                <Button onClick={handleCloseSale} className="flex-1">
                  💰 Закрыть продажу
                </Button>
                <Button variant="outline" onClick={() => setIsSaleModalOpen(false)}>
                  Отмена
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Модальное окно управления услугами */}
        <Dialog open={isServicesModalOpen} onOpenChange={setIsServicesModalOpen}>
          <DialogContent className="max-w-[95vw] md:max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <div className="flex items-center justify-between">
                <DialogTitle>Управление услугами</DialogTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsCreateServiceModalOpen(true)}
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Добавить услугу
                </Button>
              </div>
            </DialogHeader>
            
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {availableServices.map(service => (
                  <Card key={service.id}>
                    <CardHeader className="p-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <CardTitle className="text-sm">{service.name}</CardTitle>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline" className="text-xs">
                              {service.service_type === 'online' ? '🌐 Онлайн' : 
                               service.service_type === 'offline' ? '📍 Офлайн' : '🔄 Гибрид'}
                            </Badge>
                            {service.category && (
                              <Badge variant="secondary" className="text-xs">
                                {service.category}
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-1 ml-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditServiceModal(service)}
                            className="h-6 w-6 p-0"
                          >
                            <Edit className="w-3 h-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteService(service)}
                            className="h-6 w-6 p-0 text-red-600 hover:text-red-700"
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="p-3 pt-0">
                      <div className="text-xs text-gray-600 mb-2">
                        {service.description}
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span>⏱️ {service.duration_minutes}м</span>
                        <span className="font-medium">💰 {service.price?.toLocaleString()} ₽</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              
              {availableServices.length === 0 && (
                <div className="text-center py-8">
                  <Settings className="w-12 h-12 mx-auto text-gray-400 mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">Нет услуг</h3>
                  <p className="text-gray-500 mb-4">Создайте первую услугу для начала работы</p>
                  <Button onClick={() => setIsCreateServiceModalOpen(true)}>
                    <Plus className="w-4 h-4 mr-1" />
                    Создать услугу
                  </Button>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Модальное окно создания услуги */}
        <Dialog open={isCreateServiceModalOpen} onOpenChange={setIsCreateServiceModalOpen}>
          <DialogContent className="max-w-[95vw] md:max-w-md max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Создать услугу</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="service_name">Название услуги</Label>
                <Input
                  id="service_name"
                  value={serviceForm.name}
                  onChange={(e) => setServiceForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Консультация по таргетингу"
                />
              </div>

              <div>
                <Label htmlFor="service_description">Описание</Label>
                <Textarea
                  id="service_description"
                  value={serviceForm.description}
                  onChange={(e) => setServiceForm(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Подробное описание услуги..."
                  rows={3}
                />
              </div>

              <div>
                <Label htmlFor="service_type">Тип услуги</Label>
                <Select value={serviceForm.service_type} onValueChange={(value: any) => 
                  setServiceForm(prev => ({ ...prev, service_type: value }))
                }>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="online">🌐 Онлайн</SelectItem>
                    <SelectItem value="offline">📍 Офлайн</SelectItem>
                    <SelectItem value="hybrid">🔄 Гибрид</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="service_duration">Длительность (мин)</Label>
                  <Input
                    id="service_duration"
                    type="number"
                    value={serviceForm.duration_minutes}
                    onChange={(e) => setServiceForm(prev => ({ ...prev, duration_minutes: parseInt(e.target.value) || 60 }))}
                    placeholder="60"
                  />
                </div>
                <div>
                  <Label htmlFor="service_price">Цена (₽)</Label>
                  <Input
                    id="service_price"
                    type="number"
                    value={serviceForm.price}
                    onChange={(e) => setServiceForm(prev => ({ ...prev, price: parseFloat(e.target.value) || 0 }))}
                    placeholder="5000"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="service_category">Категория</Label>
                <Input
                  id="service_category"
                  value={serviceForm.category}
                  onChange={(e) => setServiceForm(prev => ({ ...prev, category: e.target.value }))}
                  placeholder="Реклама, CRM, Аналитика..."
                />
              </div>

              <div className="flex gap-2 pt-4">
                <Button onClick={handleCreateServiceFromConsultations} className="flex-1">
                  Создать услугу
                </Button>
                <Button variant="outline" onClick={() => setIsCreateServiceModalOpen(false)}>
                  Отмена
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Модальное окно редактирования услуги */}
        <Dialog open={isEditServiceModalOpen} onOpenChange={setIsEditServiceModalOpen}>
          <DialogContent className="max-w-[95vw] md:max-w-md max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Редактировать услугу</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="edit_service_name">Название услуги</Label>
                <Input
                  id="edit_service_name"
                  value={serviceForm.name}
                  onChange={(e) => setServiceForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Консультация по таргетингу"
                />
              </div>

              <div>
                <Label htmlFor="edit_service_description">Описание</Label>
                <Textarea
                  id="edit_service_description"
                  value={serviceForm.description}
                  onChange={(e) => setServiceForm(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Подробное описание услуги..."
                  rows={3}
                />
              </div>

              <div>
                <Label htmlFor="edit_service_type">Тип услуги</Label>
                <Select value={serviceForm.service_type} onValueChange={(value: any) => 
                  setServiceForm(prev => ({ ...prev, service_type: value }))
                }>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="online">🌐 Онлайн</SelectItem>
                    <SelectItem value="offline">📍 Офлайн</SelectItem>
                    <SelectItem value="hybrid">🔄 Гибрид</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="edit_service_duration">Длительность (мин)</Label>
                  <Input
                    id="edit_service_duration"
                    type="number"
                    value={serviceForm.duration_minutes}
                    onChange={(e) => setServiceForm(prev => ({ ...prev, duration_minutes: parseInt(e.target.value) || 60 }))}
                    placeholder="60"
                  />
                </div>
                <div>
                  <Label htmlFor="edit_service_price">Цена (₽)</Label>
                  <Input
                    id="edit_service_price"
                    type="number"
                    value={serviceForm.price}
                    onChange={(e) => setServiceForm(prev => ({ ...prev, price: parseFloat(e.target.value) || 0 }))}
                    placeholder="5000"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="edit_service_category">Категория</Label>
                <Input
                  id="edit_service_category"
                  value={serviceForm.category}
                  onChange={(e) => setServiceForm(prev => ({ ...prev, category: e.target.value }))}
                  placeholder="Реклама, CRM, Аналитика..."
                />
              </div>

              <div className="flex gap-2 pt-4">
                <Button onClick={handleEditService} className="flex-1">
                  Сохранить изменения
                </Button>
                <Button variant="outline" onClick={() => setIsEditServiceModalOpen(false)}>
                  Отмена
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </main>
      
      {/* DateRangePicker */}
      <DateRangePicker open={datePickerOpen} onOpenChange={setDatePickerOpen} />
    </div>
  );
};

export default Consultations; 