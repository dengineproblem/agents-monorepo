import { useState, useEffect } from 'react';
import { User, Plus, Edit, Trash2, Clock, Calendar, Package, ExternalLink, Key, UserCheck, UserX, Copy, CheckCircle, UserPlus, UserMinus, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { consultationService } from '@/services/consultationService';
import { salesApi } from '@/services/salesApi';
import { Consultant, CreateConsultantData, WorkingSchedule, WorkingScheduleInput, ConsultationService } from '@/types/consultation';

const DAYS_OF_WEEK = [
  { value: 0, label: 'Воскресенье', short: 'Вс' },
  { value: 1, label: 'Понедельник', short: 'Пн' },
  { value: 2, label: 'Вторник', short: 'Вт' },
  { value: 3, label: 'Среда', short: 'Ср' },
  { value: 4, label: 'Четверг', short: 'Чт' },
  { value: 5, label: 'Пятница', short: 'Пт' },
  { value: 6, label: 'Суббота', short: 'Сб' },
];

export function ConsultantsPage() {
  const { toast } = useToast();
  const { user } = useAuth();

  const userAccountId = user?.id;

  const [consultants, setConsultants] = useState<Consultant[]>([]);
  const [allSchedules, setAllSchedules] = useState<WorkingSchedule[]>([]);
  const [allServices, setAllServices] = useState<ConsultationService[]>([]);
  const [consultantServicesMap, setConsultantServicesMap] = useState<Record<string, string[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isNewConsultantOpen, setIsNewConsultantOpen] = useState(false);
  const [isEditConsultantOpen, setIsEditConsultantOpen] = useState(false);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [isServicesModalOpen, setIsServicesModalOpen] = useState(false);
  const [editingConsultant, setEditingConsultant] = useState<Consultant | null>(null);
  const [editingSchedules, setEditingSchedules] = useState<WorkingScheduleInput[]>([]);
  const [editingConsultantId, setEditingConsultantId] = useState<string | null>(null);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [isSavingServices, setIsSavingServices] = useState(false);

  // Состояние для установки плана продаж
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
  const [planConsultant, setPlanConsultant] = useState<Consultant | null>(null);
  const [planFormData, setPlanFormData] = useState({
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear(),
    plan_amount: ''
  });

  const [newConsultant, setNewConsultant] = useState<CreateConsultantData>({
    name: '',
    phone: '',
    specialization: '',
    createAccount: false
  });

  const [createdCredentials, setCreatedCredentials] = useState<{
    username: string;
    password: string;
  } | null>(null);
  const [isCredentialsModalOpen, setIsCredentialsModalOpen] = useState(false);
  const [copiedField, setCopiedField] = useState<'username' | 'password' | null>(null);

  const [editingConsultantData, setEditingConsultantData] = useState<CreateConsultantData>({
    name: '',
    phone: '',
    specialization: ''
  });

  const timeSlots: string[] = [];
  for (let hour = 0; hour < 24; hour++) {
    timeSlots.push(`${hour.toString().padStart(2, '0')}:00`);
    timeSlots.push(`${hour.toString().padStart(2, '0')}:30`);
  }

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    if (!userAccountId) return;

    try {
      setIsLoading(true);
      const [consultantsData, schedulesData, servicesData] = await Promise.all([
        consultationService.getConsultants(userAccountId),
        consultationService.getAllSchedules(),
        consultationService.getServices(userAccountId)
      ]);
      setConsultants(consultantsData);
      setAllSchedules(schedulesData);
      setAllServices(servicesData);

      // Загружаем услуги для каждого консультанта
      const servicesMap: Record<string, string[]> = {};
      await Promise.all(
        consultantsData.map(async (consultant) => {
          try {
            const services = await consultationService.getConsultantServices(consultant.id);
            servicesMap[consultant.id] = services.map(s => s.service_id);
          } catch {
            servicesMap[consultant.id] = [];
          }
        })
      );
      setConsultantServicesMap(servicesMap);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Ошибка',
        description: 'Не удалось загрузить данные'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateConsultant = async () => {
    if (!newConsultant.name) {
      toast({
        variant: 'destructive',
        title: 'Ошибка',
        description: 'Укажите имя консультанта'
      });
      return;
    }

    if (newConsultant.createAccount && !newConsultant.phone) {
      toast({
        variant: 'destructive',
        title: 'Ошибка',
        description: 'Укажите телефон для создания аккаунта'
      });
      return;
    }

    try {
      const response = await consultationService.createConsultant(userAccountId, newConsultant);

      toast({
        title: 'Консультант добавлен',
        description: response.credentials ? 'Учетные данные созданы' : undefined
      });

      setIsNewConsultantOpen(false);
      setNewConsultant({ name: '', phone: '', specialization: '', createAccount: false });

      // Если созданы учетные данные - показываем модальное окно
      if (response.credentials) {
        setCreatedCredentials(response.credentials);
        setIsCredentialsModalOpen(true);
      }

      loadData();
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Ошибка',
        description: error.message || 'Не удалось создать консультанта'
      });
    }
  };

  const handleUpdateConsultant = async () => {
    if (!editingConsultantId || !editingConsultantData.name) {
      toast({
        variant: 'destructive',
        title: 'Ошибка',
        description: 'Укажите имя консультанта'
      });
      return;
    }

    try {
      await consultationService.updateConsultant(userAccountId, editingConsultantId, { ...editingConsultantData, user_account_id: userAccountId });
      toast({ title: 'Консультант обновлён' });
      setIsEditConsultantOpen(false);
      setEditingConsultantId(null);
      setEditingConsultantData({ name: '', phone: '', specialization: '' });
      loadData();
    } catch {
      toast({
        variant: 'destructive',
        title: 'Ошибка',
        description: 'Не удалось обновить консультанта'
      });
    }
  };

  const handleDeleteConsultant = async (id: string) => {
    if (!confirm('Удалить консультанта?')) return;
    if (!userAccountId) return;

    try {
      await consultationService.deleteConsultant(userAccountId, id);
      toast({ title: 'Консультант удалён' });
      loadData();
    } catch {
      toast({
        variant: 'destructive',
        title: 'Ошибка',
        description: 'Не удалось удалить консультанта'
      });
    }
  };

  const openScheduleModal = (consultant: Consultant) => {
    setEditingConsultant(consultant);
    const existingSchedules = allSchedules.filter(s => s.consultant_id === consultant.id);
    const scheduleInputs: WorkingScheduleInput[] = DAYS_OF_WEEK.map(day => {
      const existing = existingSchedules.find(s => s.day_of_week === day.value);
      return {
        day_of_week: day.value,
        start_time: existing?.start_time || '09:00',
        end_time: existing?.end_time || '18:00',
        is_working: existing?.is_working ?? false,
        break_start: existing?.break_start || null,
        break_end: existing?.break_end || null
      };
    });
    setEditingSchedules(scheduleInputs);
    setIsScheduleModalOpen(true);
  };

  const handleSaveSchedules = async () => {
    if (!editingConsultant) return;

    try {
      await consultationService.updateSchedules(editingConsultant.id, editingSchedules);
      toast({ title: 'Расписание сохранено' });
      setIsScheduleModalOpen(false);
      loadData();
    } catch {
      toast({
        variant: 'destructive',
        title: 'Ошибка',
        description: 'Не удалось сохранить расписание'
      });
    }
  };

  const openServicesModal = (consultant: Consultant) => {
    setEditingConsultant(consultant);
    // Фильтруем только существующие услуги (на случай если какие-то были удалены)
    const existingServiceIds = new Set(allServices.map(s => s.id));
    const validServiceIds = (consultantServicesMap[consultant.id] || []).filter(id => existingServiceIds.has(id));
    setSelectedServiceIds(validServiceIds);
    setIsServicesModalOpen(true);
  };

  const handleSaveServices = async () => {
    if (!editingConsultant || isSavingServices) return;

    setIsSavingServices(true);
    try {
      await consultationService.bulkUpdateConsultantServices(editingConsultant.id, selectedServiceIds);
      toast({ title: 'Услуги сохранены' });
      setIsServicesModalOpen(false);
      loadData();
    } catch {
      toast({
        variant: 'destructive',
        title: 'Ошибка',
        description: 'Не удалось сохранить услуги'
      });
    } finally {
      setIsSavingServices(false);
    }
  };

  const toggleService = (serviceId: string) => {
    setSelectedServiceIds(prev =>
      prev.includes(serviceId)
        ? prev.filter(id => id !== serviceId)
        : [...prev, serviceId]
    );
  };

  const openEditConsultant = (consultant: Consultant) => {
    setEditingConsultantId(consultant.id);
    setEditingConsultantData({
      name: consultant.name,
      phone: consultant.phone || '',
      specialization: consultant.specialization || ''
    });
    setIsEditConsultantOpen(true);
  };

  const handleToggleAcceptsNewLeads = async (consultant: Consultant) => {
    if (!userAccountId) return;
    const newValue = !consultant.accepts_new_leads;
    try {
      const result = await consultationService.updateConsultantAcceptsNewLeads(userAccountId, consultant.id, newValue);
      toast({
        title: 'Статус обновлён',
        description: result.message
      });
      loadData();
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Ошибка',
        description: error.message || 'Не удалось обновить статус'
      });
    }
  };

  // Открыть модальное окно установки плана продаж
  const openPlanModal = async (consultant: Consultant) => {
    setPlanConsultant(consultant);
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    // Загружаем текущий план для консультанта
    try {
      const stats = await salesApi.getStats({
        consultantId: consultant.id,
        month: currentMonth,
        year: currentYear
      });

      setPlanFormData({
        month: currentMonth,
        year: currentYear,
        plan_amount: stats.plan_amount > 0 ? stats.plan_amount.toString() : ''
      });
    } catch (error) {
      console.error('Failed to load current plan:', error);
      // Если не удалось загрузить план, используем значения по умолчанию
      setPlanFormData({
        month: currentMonth,
        year: currentYear,
        plan_amount: ''
      });
    }

    setIsPlanModalOpen(true);
  };

  // Установить план продаж
  const handleSetSalesPlan = async () => {
    if (!planConsultant || !planFormData.plan_amount) {
      toast({
        variant: 'destructive',
        title: 'Ошибка',
        description: 'Заполните сумму плана'
      });
      return;
    }

    try {
      const result = await salesApi.setSalesPlan(planConsultant.id, {
        month: planFormData.month,
        year: planFormData.year,
        plan_amount: parseFloat(planFormData.plan_amount)
      });

      toast({
        title: 'План установлен',
        description: result.message
      });

      setIsPlanModalOpen(false);
      setPlanConsultant(null);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Ошибка',
        description: error.message || 'Не удалось установить план продаж'
      });
    }
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-lg text-muted-foreground">Необходима авторизация</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Консультанты</h1>
        <Dialog open={isNewConsultantOpen} onOpenChange={setIsNewConsultantOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Добавить
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Новый консультант</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Имя *</Label>
                <Input
                  value={newConsultant.name}
                  onChange={e => setNewConsultant({ ...newConsultant, name: e.target.value })}
                  placeholder="Иван Иванов"
                />
              </div>
              <div>
                <Label>Телефон</Label>
                <Input
                  value={newConsultant.phone}
                  onChange={e => setNewConsultant({ ...newConsultant, phone: e.target.value })}
                  placeholder="+7 999 123-45-67"
                />
              </div>
              <div>
                <Label>Специализация</Label>
                <Input
                  value={newConsultant.specialization}
                  onChange={e => setNewConsultant({ ...newConsultant, specialization: e.target.value })}
                  placeholder="Психолог"
                />
              </div>
              <div className="flex items-center space-x-2 pt-2">
                <Checkbox
                  id="createAccount"
                  checked={newConsultant.createAccount}
                  onCheckedChange={(checked) =>
                    setNewConsultant({ ...newConsultant, createAccount: !!checked })
                  }
                />
                <label
                  htmlFor="createAccount"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                >
                  Создать аккаунт для входа (логин/пароль будут отправлены в WhatsApp)
                </label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsNewConsultantOpen(false)}>
                Отмена
              </Button>
              <Button onClick={handleCreateConsultant}>Создать</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {consultants.map(consultant => {
          const schedules = allSchedules.filter(s => s.consultant_id === consultant.id && s.is_working);
          return (
            <Card key={consultant.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <User className="w-5 h-5 flex-shrink-0" />
                    <span className="truncate">{consultant.name}</span>
                  </div>
                  <div className="flex gap-0.5 flex-shrink-0">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openPlanModal(consultant)} title="План продаж">
                      <Target className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openServicesModal(consultant)} title="Услуги">
                      <Package className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openScheduleModal(consultant)} title="Расписание">
                      <Clock className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditConsultant(consultant)} title="Редактировать">
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDeleteConsultant(consultant.id)} title="Удалить">
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {consultant.specialization && (
                  <p className="text-sm text-muted-foreground mb-2">{consultant.specialization}</p>
                )}
                {consultant.phone && (
                  <p className="text-sm mb-2">{consultant.phone}</p>
                )}

                {/* Статус аккаунта */}
                <div className="flex items-center gap-2 mb-3">
                  {consultant.user_account_id ? (
                    <>
                      <UserCheck className="w-4 h-4 text-green-500" />
                      <span className="text-xs text-green-700 font-medium">Аккаунт создан</span>
                    </>
                  ) : (
                    <>
                      <UserX className="w-4 h-4 text-orange-500" />
                      <span className="text-xs text-orange-700">Без аккаунта</span>
                    </>
                  )}
                </div>

                {/* Переключатель приёма новых лидов */}
                <div className="flex items-center justify-between p-3 mb-3 border rounded-lg bg-accent/30">
                  <div className="flex items-center gap-2">
                    {consultant.accepts_new_leads ? (
                      <UserPlus className="w-4 h-4 text-green-600" />
                    ) : (
                      <UserMinus className="w-4 h-4 text-orange-600" />
                    )}
                    <div className="flex flex-col">
                      <span className="text-xs font-medium">
                        {consultant.accepts_new_leads ? 'Принимает лидов' : 'Не принимает лидов'}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Автораспределение
                      </span>
                    </div>
                  </div>
                  <Switch
                    checked={consultant.accepts_new_leads}
                    onCheckedChange={() => handleToggleAcceptsNewLeads(consultant)}
                  />
                </div>

                {/* Кнопка открыть страницу консультанта */}
                {consultant.user_account_id && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mb-3"
                    onClick={() => window.open(`/c/${consultant.id}`, '_blank')}
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Открыть страницу консультанта
                  </Button>
                )}

                {schedules.length > 0 && (
                  <div className="mt-3 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1 mb-1">
                      <Calendar className="w-3 h-3" />
                      Рабочие дни:
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {schedules.map(s => (
                        <span key={s.day_of_week} className="bg-accent px-1.5 py-0.5 rounded">
                          {DAYS_OF_WEEK.find(d => d.value === s.day_of_week)?.short}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {consultantServicesMap[consultant.id]?.length > 0 && (
                  <div className="mt-3 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1 mb-1">
                      <Package className="w-3 h-3" />
                      Услуги:
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {consultantServicesMap[consultant.id].map(serviceId => {
                        const service = allServices.find(s => s.id === serviceId);
                        return service ? (
                          <span
                            key={serviceId}
                            className="px-1.5 py-0.5 rounded text-white"
                            style={{ backgroundColor: service.color }}
                          >
                            {service.name}
                          </span>
                        ) : null;
                      })}
                    </div>
                  </div>
                )}
                {(!consultantServicesMap[consultant.id] || consultantServicesMap[consultant.id].length === 0) && (
                  <div className="mt-3 text-xs text-orange-500">
                    <Package className="w-3 h-3 inline mr-1" />
                    Нет назначенных услуг
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {consultants.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          Нет консультантов. Добавьте первого!
        </div>
      )}

      {/* Credentials Modal */}
      <Dialog open={isCredentialsModalOpen} onOpenChange={setIsCredentialsModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="w-5 h-5" />
              Аккаунт создан
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Учетные данные отправлены консультанту в WhatsApp. Сохраните их для себя:
            </p>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground">Логин</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <Input
                      readOnly
                      value={createdCredentials?.username || ''}
                      className="font-mono"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        navigator.clipboard.writeText(createdCredentials?.username || '');
                        setCopiedField('username');
                        setTimeout(() => setCopiedField(null), 2000);
                      }}
                    >
                      {copiedField === 'username' ? (
                        <CheckCircle className="w-4 h-4 text-green-500" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground">Пароль</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <Input
                      readOnly
                      value={createdCredentials?.password || ''}
                      className="font-mono"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        navigator.clipboard.writeText(createdCredentials?.password || '');
                        setCopiedField('password');
                        setTimeout(() => setCopiedField(null), 2000);
                      }}
                    >
                      {copiedField === 'password' ? (
                        <CheckCircle className="w-4 h-4 text-green-500" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
              <p className="text-blue-900">
                💡 Консультант может войти на страницу{' '}
                <code className="bg-blue-100 px-1 py-0.5 rounded">/login</code>
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setIsCredentialsModalOpen(false)}>
              Закрыть
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Consultant Modal */}
      <Dialog open={isEditConsultantOpen} onOpenChange={setIsEditConsultantOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Редактировать консультанта</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Имя *</Label>
              <Input
                value={editingConsultantData.name}
                onChange={e => setEditingConsultantData({ ...editingConsultantData, name: e.target.value })}
              />
            </div>
            <div>
              <Label>Телефон</Label>
              <Input
                value={editingConsultantData.phone}
                onChange={e => setEditingConsultantData({ ...editingConsultantData, phone: e.target.value })}
              />
            </div>
            <div>
              <Label>Специализация</Label>
              <Input
                value={editingConsultantData.specialization}
                onChange={e => setEditingConsultantData({ ...editingConsultantData, specialization: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditConsultantOpen(false)}>
              Отмена
            </Button>
            <Button onClick={handleUpdateConsultant}>Сохранить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Schedule Modal */}
      <Dialog open={isScheduleModalOpen} onOpenChange={setIsScheduleModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Расписание: {editingConsultant?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            {editingSchedules.map((schedule, idx) => {
              const day = DAYS_OF_WEEK.find(d => d.value === schedule.day_of_week);
              return (
                <div key={schedule.day_of_week} className="flex items-center gap-3 p-3 border rounded-lg">
                  <label className="flex items-center gap-2 w-24">
                    <input
                      type="checkbox"
                      checked={schedule.is_working}
                      onChange={e => {
                        const updated = [...editingSchedules];
                        updated[idx].is_working = e.target.checked;
                        setEditingSchedules(updated);
                      }}
                      className="w-4 h-4"
                    />
                    <span className="font-medium">{day?.short}</span>
                  </label>
                  {schedule.is_working && (
                    <>
                      <select
                        value={schedule.start_time}
                        onChange={e => {
                          const updated = [...editingSchedules];
                          updated[idx].start_time = e.target.value;
                          setEditingSchedules(updated);
                        }}
                        className="border rounded px-2 py-1 text-sm"
                      >
                        {timeSlots.map(t => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                      <span>—</span>
                      <select
                        value={schedule.end_time}
                        onChange={e => {
                          const updated = [...editingSchedules];
                          updated[idx].end_time = e.target.value;
                          setEditingSchedules(updated);
                        }}
                        className="border rounded px-2 py-1 text-sm"
                      >
                        {timeSlots.map(t => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsScheduleModalOpen(false)}>
              Отмена
            </Button>
            <Button onClick={handleSaveSchedules}>Сохранить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Services Modal */}
      <Dialog open={isServicesModalOpen} onOpenChange={setIsServicesModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Услуги: {editingConsultant?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            {allServices.length === 0 ? (
              <p className="text-center text-muted-foreground py-4">
                Нет доступных услуг. Сначала создайте услуги в разделе "Услуги".
              </p>
            ) : (
              allServices.map(service => (
                <div
                  key={service.id}
                  className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-accent/50"
                  onClick={() => toggleService(service.id)}
                >
                  <Checkbox
                    checked={selectedServiceIds.includes(service.id)}
                    onCheckedChange={() => toggleService(service.id)}
                  />
                  <div
                    className="w-4 h-4 rounded-full"
                    style={{ backgroundColor: service.color }}
                  />
                  <div className="flex-1">
                    <div className="font-medium">{service.name}</div>
                    {service.description && (
                      <div className="text-sm text-muted-foreground">{service.description}</div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsServicesModalOpen(false)}>
              Отмена
            </Button>
            <Button onClick={handleSaveServices} disabled={allServices.length === 0 || isSavingServices}>
              {isSavingServices ? 'Сохранение...' : 'Сохранить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Модальное окно установки плана продаж */}
      <Dialog open={isPlanModalOpen} onOpenChange={setIsPlanModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Установить план продаж</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>Консультант</Label>
              <Input value={planConsultant?.name || ''} disabled />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="plan_month">Месяц</Label>
                <Select
                  value={planFormData.month.toString()}
                  onValueChange={(value) => setPlanFormData({ ...planFormData, month: parseInt(value) })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Январь</SelectItem>
                    <SelectItem value="2">Февраль</SelectItem>
                    <SelectItem value="3">Март</SelectItem>
                    <SelectItem value="4">Апрель</SelectItem>
                    <SelectItem value="5">Май</SelectItem>
                    <SelectItem value="6">Июнь</SelectItem>
                    <SelectItem value="7">Июль</SelectItem>
                    <SelectItem value="8">Август</SelectItem>
                    <SelectItem value="9">Сентябрь</SelectItem>
                    <SelectItem value="10">Октябрь</SelectItem>
                    <SelectItem value="11">Ноябрь</SelectItem>
                    <SelectItem value="12">Декабрь</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="plan_year">Год</Label>
                <Input
                  id="plan_year"
                  type="number"
                  value={planFormData.year}
                  onChange={(e) => setPlanFormData({ ...planFormData, year: parseInt(e.target.value) })}
                  min="2020"
                  max="2100"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="plan_amount">Сумма плана (KZT) *</Label>
              <Input
                id="plan_amount"
                type="number"
                value={planFormData.plan_amount}
                onChange={(e) => setPlanFormData({ ...planFormData, plan_amount: e.target.value })}
                placeholder="1000000"
                required
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPlanModalOpen(false)}>
              Отмена
            </Button>
            <Button onClick={handleSetSalesPlan}>Установить план</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
