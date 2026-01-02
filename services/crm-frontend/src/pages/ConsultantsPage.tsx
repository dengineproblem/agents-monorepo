import { useState, useEffect } from 'react';
import { User, Plus, Edit, Trash2, Clock, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { consultationService } from '@/services/consultationService';
import { Consultant, CreateConsultantData, WorkingSchedule, WorkingScheduleInput } from '@/types/consultation';

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
  const userAccountId = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b';

  const [consultants, setConsultants] = useState<Consultant[]>([]);
  const [allSchedules, setAllSchedules] = useState<WorkingSchedule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isNewConsultantOpen, setIsNewConsultantOpen] = useState(false);
  const [isEditConsultantOpen, setIsEditConsultantOpen] = useState(false);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [editingConsultant, setEditingConsultant] = useState<Consultant | null>(null);
  const [editingSchedules, setEditingSchedules] = useState<WorkingScheduleInput[]>([]);
  const [editingConsultantId, setEditingConsultantId] = useState<string | null>(null);

  const [newConsultant, setNewConsultant] = useState<CreateConsultantData>({
    name: '',
    email: '',
    phone: '',
    specialization: ''
  });

  const [editingConsultantData, setEditingConsultantData] = useState<CreateConsultantData>({
    name: '',
    email: '',
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
    try {
      setIsLoading(true);
      const [consultantsData, schedulesData] = await Promise.all([
        consultationService.getConsultants(userAccountId),
        consultationService.getAllSchedules(userAccountId)
      ]);
      setConsultants(consultantsData);
      setAllSchedules(schedulesData);
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

    try {
      await consultationService.createConsultant(userAccountId, newConsultant);
      toast({ title: 'Консультант добавлен' });
      setIsNewConsultantOpen(false);
      setNewConsultant({ name: '', email: '', phone: '', specialization: '' });
      loadData();
    } catch {
      toast({
        variant: 'destructive',
        title: 'Ошибка',
        description: 'Не удалось создать консультанта'
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
      await consultationService.updateConsultant(editingConsultantId, editingConsultantData);
      toast({ title: 'Консультант обновлён' });
      setIsEditConsultantOpen(false);
      setEditingConsultantId(null);
      setEditingConsultantData({ name: '', email: '', phone: '', specialization: '' });
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

    try {
      await consultationService.deleteConsultant(id);
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

  const openEditConsultant = (consultant: Consultant) => {
    setEditingConsultantId(consultant.id);
    setEditingConsultantData({
      name: consultant.name,
      email: consultant.email || '',
      phone: consultant.phone || '',
      specialization: consultant.specialization || ''
    });
    setIsEditConsultantOpen(true);
  };

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
                <Label>Email</Label>
                <Input
                  type="email"
                  value={newConsultant.email}
                  onChange={e => setNewConsultant({ ...newConsultant, email: e.target.value })}
                  placeholder="ivan@example.com"
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
                <CardTitle className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <User className="w-5 h-5" />
                    <span>{consultant.name}</span>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openScheduleModal(consultant)}>
                      <Clock className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => openEditConsultant(consultant)}>
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDeleteConsultant(consultant.id)}>
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
                  <p className="text-sm">{consultant.phone}</p>
                )}
                {consultant.email && (
                  <p className="text-sm text-muted-foreground">{consultant.email}</p>
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
              <Label>Email</Label>
              <Input
                type="email"
                value={editingConsultantData.email}
                onChange={e => setEditingConsultantData({ ...editingConsultantData, email: e.target.value })}
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
    </div>
  );
}
