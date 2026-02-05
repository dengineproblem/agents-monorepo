import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { consultantApi, Lead } from '@/services/consultantApi';
import { salesApi } from '@/services/salesApi';
import { consultationService } from '@/services/consultationService';
import { ConsultationService } from '@/types/consultation';
import { CreateTaskData } from '@/types/task';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Phone, MessageSquare, Calendar as CalendarIcon, Search, DollarSign, CheckSquare, Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { format, addDays } from 'date-fns';
import { ru } from 'date-fns/locale';
import { ChatSection } from './ChatSection';

export function LeadsTab() {
  const { consultantId } = useParams<{ consultantId: string }>();
  const { toast } = useToast();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({
    is_booked: 'all',
    search: '',
  });

  // Модальное окно для лида
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);

  // Модальное окно добавления продажи
  const [addSaleDialogOpen, setAddSaleDialogOpen] = useState(false);
  const [leadForSale, setLeadForSale] = useState<Lead | null>(null);
  const [saleFormData, setSaleFormData] = useState({
    amount: '',
    product_name: '',
    sale_date: new Date().toISOString().split('T')[0],
    comment: ''
  });

  // Модальное окно записи на консультацию
  const [bookConsultationDialogOpen, setBookConsultationDialogOpen] = useState(false);
  const [leadForBooking, setLeadForBooking] = useState<Lead | null>(null);
  const [services, setServices] = useState<ConsultationService[]>([]);
  const [loadingServices, setLoadingServices] = useState(false);
  const [consultationFormData, setConsultationFormData] = useState({
    service_id: '',
    date: addDays(new Date(), 1).toISOString().split('T')[0], // Завтра по умолчанию
    start_time: '10:00',
    end_time: '10:30',
    notes: ''
  });

  // Модальное окно создания задачи
  const [createTaskDialogOpen, setCreateTaskDialogOpen] = useState(false);
  const [taskFormData, setTaskFormData] = useState<CreateTaskData>({
    title: '',
    description: '',
    due_date: new Date().toISOString().split('T')[0],
    lead_id: undefined,
  });

  // Пагинация
  const [pageSize] = useState(50);
  const [hasMore, setHasMore] = useState(true);

  // Загрузка лидов
  const loadLeads = async (append = false) => {
    try {
      setLoading(true);
      const params: any = {
        limit: pageSize,
        offset: append ? leads.length : 0
      };

      if (filters.is_booked && filters.is_booked !== 'all') {
        params.is_booked = filters.is_booked;
      }
      if (consultantId) {
        params.consultantId = consultantId;
      }

      const data = await consultantApi.getLeads(params);

      if (append) {
        setLeads(prev => [...prev, ...data.leads]);
      } else {
        setLeads(data.leads);
      }

      setTotal(data.total);
      setHasMore((append ? leads.length + data.leads.length : data.leads.length) < data.total);
    } catch (error: any) {
      toast({
        title: 'Ошибка',
        description: 'Не удалось загрузить лидов',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLeads(false); // false = сбросить пагинацию
  }, [filters, consultantId]);

  // Открыть модальное окно лида
  const handleOpenLead = (lead: Lead) => {
    setSelectedLead(lead);
  };

  // Открыть модальное окно добавления продажи
  const handleOpenAddSale = (lead: Lead, e: React.MouseEvent) => {
    e.stopPropagation();
    setLeadForSale(lead);
    setSaleFormData({
      amount: '',
      product_name: '',
      sale_date: new Date().toISOString().split('T')[0],
      comment: ''
    });
    setAddSaleDialogOpen(true);
  };

  // Создать продажу
  const handleCreateSale = async () => {
    if (!leadForSale || !saleFormData.amount || !saleFormData.product_name) {
      toast({
        title: 'Ошибка',
        description: 'Заполните обязательные поля',
        variant: 'destructive',
      });
      return;
    }

    try {
      await salesApi.createSale({
        lead_id: leadForSale.id,
        amount: parseFloat(saleFormData.amount),
        product_name: saleFormData.product_name,
        sale_date: saleFormData.sale_date,
        comment: saleFormData.comment || undefined
      }, consultantId);

      toast({
        title: 'Успешно',
        description: 'Продажа успешно добавлена',
      });

      setAddSaleDialogOpen(false);
      setLeadForSale(null);
    } catch (error: any) {
      toast({
        title: 'Ошибка',
        description: error.message || 'Не удалось добавить продажу',
        variant: 'destructive',
      });
    }
  };

  // Загрузить услуги консультанта
  const loadServices = async () => {
    if (!consultantId) return;

    console.log('[LeadsTab] Loading services for consultantId:', consultantId);

    try {
      setLoadingServices(true);
      const data = await consultantApi.getServices(consultantId);

      // Фильтруем только активные услуги
      const activeServices = data.filter((s: ConsultationService) =>
        s.is_active && s.is_provided
      );

      console.log('[LeadsTab] Services loaded:', { count: activeServices.length, services: activeServices });

      setServices(activeServices);
    } catch (error: any) {
      console.error('[LeadsTab] Failed to load services:', error);
      toast({
        title: 'Ошибка',
        description: 'Не удалось загрузить услуги',
        variant: 'destructive',
      });
    } finally {
      setLoadingServices(false);
    }
  };

  // Открыть модальное окно записи на консультацию
  const handleOpenBookConsultation = async (lead: Lead, e: React.MouseEvent) => {
    e.stopPropagation();

    console.log('[LeadsTab] Opening book consultation modal for lead:', lead.id);

    setLeadForBooking(lead);
    setConsultationFormData({
      service_id: '',
      date: addDays(new Date(), 1).toISOString().split('T')[0],
      start_time: '10:00',
      end_time: '10:30',
      notes: ''
    });

    // Загрузить услуги
    await loadServices();

    setBookConsultationDialogOpen(true);
  };

  // Обновить время окончания при изменении услуги
  const handleServiceChange = (serviceId: string) => {
    const service = services.find(s => s.id === serviceId);

    if (service) {
      const duration = service.custom_duration || service.duration_minutes || 30;
      const [hours, minutes] = consultationFormData.start_time.split(':').map(Number);
      const startMinutes = hours * 60 + minutes;
      const endMinutes = startMinutes + duration;
      const endHours = Math.floor(endMinutes / 60);
      const endMins = endMinutes % 60;
      const end_time = `${endHours.toString().padStart(2, '0')}:${endMins.toString().padStart(2, '0')}`;

      console.log('[LeadsTab] Service changed:', {
        serviceId,
        serviceName: service.name,
        duration,
        start_time: consultationFormData.start_time,
        end_time
      });

      setConsultationFormData({
        ...consultationFormData,
        service_id: serviceId,
        end_time
      });
    } else {
      setConsultationFormData({
        ...consultationFormData,
        service_id: serviceId
      });
    }
  };

  // Создать консультацию для лида
  const handleOpenCreateTask = (lead: Lead, e: React.MouseEvent) => {
    e.stopPropagation();
    setTaskFormData({
      title: '',
      description: '',
      due_date: new Date().toISOString().split('T')[0],
      lead_id: lead.id,
    });
    setCreateTaskDialogOpen(true);
  };

  const handleCreateTask = async () => {
    if (!taskFormData.title || !taskFormData.due_date || !consultantId) {
      toast({
        title: 'Ошибка',
        description: 'Заполните название и дату задачи',
        variant: 'destructive',
      });
      return;
    }

    try {
      await consultantApi.createTask({
        ...taskFormData,
        consultantId,
      });

      toast({
        title: 'Успешно',
        description: 'Задача создана',
      });

      setCreateTaskDialogOpen(false);
      setTaskFormData({
        title: '',
        description: '',
        due_date: new Date().toISOString().split('T')[0],
        lead_id: undefined,
      });
    } catch (error: any) {
      toast({
        title: 'Ошибка',
        description: error.message || 'Не удалось создать задачу',
        variant: 'destructive',
      });
    }
  };

  const handleCreateConsultation = async () => {
    if (!leadForBooking || !consultantId || !consultationFormData.service_id) {
      toast({
        title: 'Ошибка',
        description: 'Заполните обязательные поля',
        variant: 'destructive',
      });
      return;
    }

    console.log('[LeadsTab] Creating consultation:', {
      leadId: leadForBooking.id,
      consultantId,
      formData: consultationFormData
    });

    try {
      await consultationService.createConsultation({
        consultant_id: consultantId,
        service_id: consultationFormData.service_id,
        client_phone: leadForBooking.contact_phone,
        client_name: leadForBooking.contact_name || 'Без имени',
        dialog_analysis_id: leadForBooking.id,
        date: consultationFormData.date,
        start_time: consultationFormData.start_time,
        end_time: consultationFormData.end_time,
        status: 'scheduled',
        consultation_type: 'general',
        notes: consultationFormData.notes
      });

      console.log('[LeadsTab] Consultation created successfully');

      toast({
        title: 'Успешно',
        description: 'Консультация успешно создана',
      });

      setBookConsultationDialogOpen(false);
      setLeadForBooking(null);

      // Обновить список лидов
      await loadLeads();
    } catch (error: any) {
      console.error('[LeadsTab] Failed to create consultation:', error);

      toast({
        title: 'Ошибка',
        description: error.message || 'Не удалось создать консультацию',
        variant: 'destructive',
      });
    }
  };

  const getLeadBadges = (lead: Lead) => {
    const badges = [];

    // Теги консультации в зависимости от статуса
    if (lead.consultation_status) {
      const statusConfig: Record<string, { label: string; className: string }> = {
        scheduled: { label: 'Назначена', className: 'bg-blue-500' },
        confirmed: { label: 'Подтверждена', className: 'bg-cyan-500' },
        completed: { label: 'Проведена', className: 'bg-green-600' },
        cancelled: { label: 'Отменена', className: 'bg-red-500' },
        no_show: { label: 'Не пришел', className: 'bg-orange-500' }
      };

      const config = statusConfig[lead.consultation_status];
      if (config) {
        badges.push(
          <Badge key="consultation" className={config.className}>
            {config.label}
          </Badge>
        );
      }
    }

    // Тег продажи
    if (lead.has_sale) {
      badges.push(
        <Badge key="sale" className="bg-emerald-500">
          Продажа
        </Badge>
      );
    }

    return badges.length > 0 ? <div className="flex gap-1">{badges}</div> : null;
  };

  const filteredLeads = leads.filter(lead => {
    if (!filters.search) return true;
    const search = filters.search.toLowerCase();
    return (
      lead.contact_name?.toLowerCase().includes(search) ||
      lead.contact_phone?.toLowerCase().includes(search)
    );
  });

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Мои лиды</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Фильтры */}
          <div className="flex flex-wrap gap-4 mb-6">
            <div className="flex-1 min-w-[200px]">
              <Input
                placeholder="Поиск по имени или телефону..."
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                className="w-full"
              />
            </div>

            <Select
              value={filters.is_booked}
              onValueChange={(value) => setFilters({ ...filters, is_booked: value })}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Статус записи" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все</SelectItem>
                <SelectItem value="false">Не записан</SelectItem>
                <SelectItem value="true">Записан</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Таблица лидов */}
          {loading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
            </div>
          ) : filteredLeads.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Лидов не найдено
            </div>
          ) : (
            <div className="space-y-2">
              {filteredLeads.map((lead) => (
                <div
                  key={lead.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent cursor-pointer transition-colors"
                  onClick={() => handleOpenLead(lead)}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium">
                        {lead.contact_name || 'Без имени'}
                      </span>
                      {getLeadBadges(lead)}
                    </div>
                    <div className="text-sm text-muted-foreground flex items-center gap-4">
                      <span className="flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {lead.contact_phone}
                      </span>
                      {lead.last_message && (
                        <span className="text-xs">
                          {format(new Date(lead.last_message), 'dd MMM, HH:mm', { locale: ru })}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => handleOpenBookConsultation(lead, e)}
                    >
                      <CalendarIcon className="h-4 w-4 mr-1" />
                      Консультация
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => handleOpenAddSale(lead, e)}
                    >
                      <DollarSign className="h-4 w-4 mr-1" />
                      Продажа
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenLead(lead);
                      }}
                      className="relative"
                    >
                      <MessageSquare className="h-4 w-4 mr-1" />
                      Написать
                      {lead.has_unread && (
                        <span className="absolute -top-1 -right-1 flex h-3 w-3">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                        </span>
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 space-y-2">
            <div className="text-sm text-muted-foreground flex items-center justify-between">
              <span>Показано {filteredLeads.length} из {total} лидов</span>
              {filteredLeads.length < total && (
                <span className="text-xs text-blue-600">
                  ({total - filteredLeads.length} еще доступно)
                </span>
              )}
            </div>

            {hasMore && !loading && (
              <Button
                variant="outline"
                onClick={() => loadLeads(true)}
                className="w-full"
              >
                Загрузить еще
              </Button>
            )}

            {loading && (
              <div className="flex items-center justify-center py-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary mr-2"></div>
                <span className="text-sm text-muted-foreground">Загрузка...</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Модальное окно лида */}
      <Dialog open={!!selectedLead} onOpenChange={() => setSelectedLead(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>
              {selectedLead?.contact_name || 'Без имени'} ({selectedLead?.contact_phone})
            </DialogTitle>
          </DialogHeader>

          {selectedLead && (
            <>
              <ChatSection
                leadId={selectedLead.id}
                clientName={selectedLead.contact_name}
                clientPhone={selectedLead.contact_phone}
              />

              {/* Секция задач по лиду */}
              <div className="mt-4 border-t pt-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold flex items-center gap-2">
                    <CheckSquare className="h-4 w-4" />
                    Задачи по лиду
                  </h3>
                  <Button
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setTaskFormData({
                        title: '',
                        description: '',
                        due_date: new Date().toISOString().split('T')[0],
                        lead_id: selectedLead.id,
                      });
                      setCreateTaskDialogOpen(true);
                    }}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Поставить задачу
                  </Button>
                </div>

                <div className="text-sm text-muted-foreground">
                  <p>Список задач по этому лиду будет доступен в следующей версии</p>
                  <p className="text-xs mt-1">
                    Создавайте задачи здесь, просматривайте во вкладке "Задачи"
                  </p>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Модальное окно добавления продажи */}
      <Dialog open={addSaleDialogOpen} onOpenChange={setAddSaleDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Добавить продажу</DialogTitle>
            <DialogDescription>
              Клиент: {leadForSale?.contact_name || 'Без имени'} ({leadForSale?.contact_phone})
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="sale_amount">Сумма (KZT) *</Label>
              <Input
                id="sale_amount"
                type="number"
                value={saleFormData.amount}
                onChange={(e) => setSaleFormData({ ...saleFormData, amount: e.target.value })}
                placeholder="100000"
                required
              />
            </div>
            <div>
              <Label htmlFor="sale_product_name">Название продукта/услуги *</Label>
              <Input
                id="sale_product_name"
                value={saleFormData.product_name}
                onChange={(e) => setSaleFormData({ ...saleFormData, product_name: e.target.value })}
                placeholder="Консультация Premium"
                required
              />
            </div>
            <div>
              <Label htmlFor="sale_date">Дата продажи</Label>
              <Input
                id="sale_date"
                type="date"
                value={saleFormData.sale_date}
                onChange={(e) => setSaleFormData({ ...saleFormData, sale_date: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="sale_comment">Комментарий (опционально)</Label>
              <Textarea
                id="sale_comment"
                value={saleFormData.comment}
                onChange={(e) => setSaleFormData({ ...saleFormData, comment: e.target.value })}
                placeholder="Дополнительная информация..."
                rows={3}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setAddSaleDialogOpen(false)}>
              Отмена
            </Button>
            <Button onClick={handleCreateSale}>Добавить</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Модальное окно записи на консультацию */}
      <Dialog open={bookConsultationDialogOpen} onOpenChange={setBookConsultationDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Запись на консультацию</DialogTitle>
            <DialogDescription>
              Клиент: {leadForBooking?.contact_name || 'Без имени'} ({leadForBooking?.contact_phone})
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Выбор услуги */}
            <div>
              <Label htmlFor="service">Услуга *</Label>
              {loadingServices ? (
                <div className="flex items-center justify-center py-4">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                </div>
              ) : services.length === 0 ? (
                <div className="text-sm text-muted-foreground py-2">
                  Нет доступных услуг
                </div>
              ) : (
                <Select
                  value={consultationFormData.service_id}
                  onValueChange={handleServiceChange}
                >
                  <SelectTrigger id="service">
                    <SelectValue placeholder="Выберите услугу" />
                  </SelectTrigger>
                  <SelectContent>
                    {services.map((service) => {
                      const price = service.custom_price || service.price || 0;
                      const duration = service.custom_duration || service.duration_minutes || 30;
                      return (
                        <SelectItem key={service.id} value={service.id}>
                          {service.name} ({duration} мин, {price} ₽)
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Выбор даты */}
            <div>
              <Label htmlFor="consultation_date">Дата *</Label>
              <Input
                id="consultation_date"
                type="date"
                value={consultationFormData.date}
                onChange={(e) => setConsultationFormData({
                  ...consultationFormData,
                  date: e.target.value
                })}
                min={new Date().toISOString().split('T')[0]}
                required
              />
            </div>

            {/* Выбор времени */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="start_time">Начало *</Label>
                <Input
                  id="start_time"
                  type="time"
                  value={consultationFormData.start_time}
                  onChange={(e) => {
                    const newStartTime = e.target.value;

                    // Пересчитать время окончания на основе длительности услуги
                    if (consultationFormData.service_id) {
                      const service = services.find(s => s.id === consultationFormData.service_id);
                      if (service) {
                        const duration = service.custom_duration || service.duration_minutes || 30;
                        const [hours, minutes] = newStartTime.split(':').map(Number);
                        const startMinutes = hours * 60 + minutes;
                        const endMinutes = startMinutes + duration;
                        const endHours = Math.floor(endMinutes / 60);
                        const endMins = endMinutes % 60;
                        const end_time = `${endHours.toString().padStart(2, '0')}:${endMins.toString().padStart(2, '0')}`;

                        setConsultationFormData({
                          ...consultationFormData,
                          start_time: newStartTime,
                          end_time
                        });
                        return;
                      }
                    }

                    setConsultationFormData({
                      ...consultationFormData,
                      start_time: newStartTime
                    });
                  }}
                  required
                />
              </div>
              <div>
                <Label htmlFor="end_time">Окончание *</Label>
                <Input
                  id="end_time"
                  type="time"
                  value={consultationFormData.end_time}
                  onChange={(e) => setConsultationFormData({
                    ...consultationFormData,
                    end_time: e.target.value
                  })}
                  required
                />
              </div>
            </div>

            {/* Примечания */}
            <div>
              <Label htmlFor="consultation_notes">Примечания (опционально)</Label>
              <Textarea
                id="consultation_notes"
                value={consultationFormData.notes}
                onChange={(e) => setConsultationFormData({
                  ...consultationFormData,
                  notes: e.target.value
                })}
                placeholder="Дополнительная информация..."
                rows={3}
              />
            </div>

            {/* Информация о выбранной дате и времени */}
            {consultationFormData.date && consultationFormData.start_time && (
              <div className="p-3 bg-muted rounded-md text-sm">
                <p className="font-medium mb-1">Запись:</p>
                <p>📅 {format(new Date(consultationFormData.date), 'dd MMMM yyyy', { locale: ru })}</p>
                <p>🕐 {consultationFormData.start_time} - {consultationFormData.end_time}</p>
                {consultationFormData.service_id && (
                  <p className="mt-1">
                    💼 {services.find(s => s.id === consultationFormData.service_id)?.name}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setBookConsultationDialogOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={handleCreateConsultation}
              disabled={!consultationFormData.service_id || !consultationFormData.date || !consultationFormData.start_time}
            >
              Записать
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Модальное окно создания задачи */}
      <Dialog open={createTaskDialogOpen} onOpenChange={setCreateTaskDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новая задача</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>Название *</Label>
              <Input
                value={taskFormData.title}
                onChange={(e) => setTaskFormData({ ...taskFormData, title: e.target.value })}
                placeholder="Введите название задачи"
              />
            </div>
            <div>
              <Label>Описание</Label>
              <Textarea
                value={taskFormData.description}
                onChange={(e) => setTaskFormData({ ...taskFormData, description: e.target.value })}
                placeholder="Дополнительная информация..."
                rows={3}
              />
            </div>
            <div>
              <Label>Дата выполнения *</Label>
              <Input
                type="date"
                value={taskFormData.due_date}
                onChange={(e) => setTaskFormData({ ...taskFormData, due_date: e.target.value })}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setCreateTaskDialogOpen(false);
                setTaskFormData({
                  title: '',
                  description: '',
                  due_date: new Date().toISOString().split('T')[0],
                  lead_id: undefined,
                });
              }}
            >
              Отмена
            </Button>
            <Button onClick={handleCreateTask}>Создать</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
