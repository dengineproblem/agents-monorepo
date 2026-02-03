import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { consultantApi } from '@/services/consultantApi';
import type { Task, CreateTaskData } from '@/types/task';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { Plus, CheckSquare, Trash2, Edit, Search, Calendar as CalendarIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LeadPhoneSearch } from '@/components/ui/LeadPhoneSearch';

interface Lead {
  id: string;
  contact_name?: string;
  contact_phone: string;
}

export function TasksTab() {
  const { consultantId } = useParams<{ consultantId: string }>();
  const { toast } = useToast();

  // ============== СОСТОЯНИЕ ==============
  const [tasks, setTasks] = useState<Task[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    status: 'all',
    dateFilter: 'all', // all, overdue, today, week, month
    leadId: undefined as string | undefined,
    search: '',
  });

  // Модальные окна
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null);
  const [resultNotesDialogOpen, setResultNotesDialogOpen] = useState(false);
  const [completingTask, setCompletingTask] = useState<Task | null>(null);
  const [resultNotesValue, setResultNotesValue] = useState('');

  // Форма добавления/редактирования
  const [formData, setFormData] = useState<CreateTaskData>({
    title: '',
    description: '',
    due_date: '',
    lead_id: undefined,
  });

  // ============== ЭФФЕКТЫ ==============
  useEffect(() => {
    loadTasks();
    loadLeads();
  }, [consultantId]);

  useEffect(() => {
    // Перезагрузка при смене фильтров
    if (!loading) {
      loadTasks();
    }
  }, [filters.status, filters.dateFilter, filters.leadId]);

  // ============== ЗАГРУЗКА ДАННЫХ ==============
  const loadTasks = async () => {
    if (!consultantId) return;

    try {
      setLoading(true);

      const params: any = { consultantId };

      // Фильтр по статусу
      if (filters.status !== 'all') {
        params.status = filters.status;
      }

      // Фильтр по дате
      const today = new Date().toISOString().split('T')[0];
      if (filters.dateFilter === 'overdue') {
        params.due_date_to = new Date(Date.now() - 86400000).toISOString().split('T')[0]; // вчера
      } else if (filters.dateFilter === 'today') {
        params.due_date_from = today;
        params.due_date_to = today;
      } else if (filters.dateFilter === 'week') {
        params.due_date_from = today;
        params.due_date_to = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
      } else if (filters.dateFilter === 'month') {
        params.due_date_from = today;
        params.due_date_to = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
      }

      // Фильтр по лиду
      if (filters.leadId) {
        params.lead_id = filters.leadId;
      }

      // Поиск
      if (filters.search) {
        params.search = filters.search;
      }

      const data = await consultantApi.getTasks(params);
      setTasks(data.tasks);
    } catch (error: any) {
      toast({
        title: 'Ошибка',
        description: 'Не удалось загрузить задачи',
        variant: 'destructive',
      });
      console.error('Failed to load tasks:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadLeads = async () => {
    if (!consultantId) return;

    try {
      const data = await consultantApi.getLeads({ consultantId, limit: 1000 });
      setLeads(data.leads as Lead[]);
    } catch (error: any) {
      console.error('Failed to load leads:', error);
    }
  };

  // ============== ОБРАБОТЧИКИ ==============
  const handleAddTask = async () => {
    if (!formData.title || !formData.due_date) {
      toast({
        title: 'Ошибка',
        description: 'Заполните название и дату задачи',
        variant: 'destructive',
      });
      return;
    }

    try {
      const dataToSubmit: CreateTaskData = {
        ...formData,
        consultantId: consultantId,
      };

      await consultantApi.createTask(dataToSubmit);

      toast({
        title: 'Успешно',
        description: 'Задача создана',
      });

      setIsAddDialogOpen(false);
      resetForm();
      await loadTasks();
    } catch (error: any) {
      toast({
        title: 'Ошибка',
        description: error.message || 'Не удалось создать задачу',
        variant: 'destructive',
      });
    }
  };

  const handleUpdateTask = async () => {
    if (!editingTask) return;

    if (!formData.title || !formData.due_date) {
      toast({
        title: 'Ошибка',
        description: 'Заполните название и дату задачи',
        variant: 'destructive',
      });
      return;
    }

    try {
      await consultantApi.updateTask(editingTask.id, {
        title: formData.title,
        description: formData.description,
        due_date: formData.due_date,
      });

      toast({
        title: 'Успешно',
        description: 'Задача обновлена',
      });

      setIsEditDialogOpen(false);
      setEditingTask(null);
      resetForm();
      await loadTasks();
    } catch (error: any) {
      toast({
        title: 'Ошибка',
        description: error.message || 'Не удалось обновить задачу',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteTask = async () => {
    if (!taskToDelete) return;

    try {
      await consultantApi.deleteTask(taskToDelete.id);

      toast({
        title: 'Успешно',
        description: 'Задача удалена',
      });

      setDeleteConfirmOpen(false);
      setTaskToDelete(null);
      await loadTasks();
    } catch (error: any) {
      toast({
        title: 'Ошибка',
        description: error.message || 'Не удалось удалить задачу',
        variant: 'destructive',
      });
    }
  };

  const handleQuickComplete = (task: Task) => {
    if (task.status === 'completed') return;

    setCompletingTask(task);
    setResultNotesValue(task.result_notes || '');
    setResultNotesDialogOpen(true);
  };

  const handleSaveResult = async () => {
    if (!completingTask) return;

    try {
      await consultantApi.updateTask(completingTask.id, {
        status: 'completed',
        result_notes: resultNotesValue,
      });

      toast({
        title: 'Успешно',
        description: 'Задача отмечена выполненной',
      });

      setResultNotesDialogOpen(false);
      setCompletingTask(null);
      setResultNotesValue('');
      await loadTasks();
    } catch (error: any) {
      toast({
        title: 'Ошибка',
        description: error.message || 'Не удалось сохранить результат',
        variant: 'destructive',
      });
    }
  };

  const openEditDialog = (task: Task) => {
    setEditingTask(task);
    setFormData({
      title: task.title,
      description: task.description || '',
      due_date: task.due_date,
      lead_id: task.lead_id,
    });
    setIsEditDialogOpen(true);
  };

  const resetForm = () => {
    setFormData({
      title: '',
      description: '',
      due_date: '',
      lead_id: undefined,
    });
  };

  // ============== УТИЛИТЫ ==============
  const isOverdue = (task: Task): boolean => {
    if (task.status !== 'pending') return false;
    const today = new Date().setHours(0, 0, 0, 0);
    const dueDate = new Date(task.due_date).setHours(0, 0, 0, 0);
    return dueDate < today;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-blue-500 text-white';
      case 'completed':
        return 'bg-green-500 text-white';
      case 'cancelled':
        return 'bg-red-500 text-white';
      default:
        return 'bg-gray-500 text-white';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'pending':
        return 'Новая';
      case 'completed':
        return 'Выполнена';
      case 'cancelled':
        return 'Отменена';
      default:
        return status;
    }
  };

  const isAssignedByAdmin = (task: Task): boolean => {
    // Проверяем, создана ли задача админом (не самим консультантом)
    // Если created_by_user_id !== user_account_id консультанта
    return !!task.created_by && task.created_by_user_id !== consultantId;
  };

  // ============== RENDER ==============
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

  const filteredTasks = tasks.filter((task) => {
    // Дополнительная клиентская фильтрация по поиску
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      return (
        task.title.toLowerCase().includes(searchLower) ||
        (task.description && task.description.toLowerCase().includes(searchLower))
      );
    }
    return true;
  });

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <CheckSquare className="h-5 w-5" />
              Мои задачи
            </CardTitle>
            <Button
              onClick={() => {
                resetForm();
                setIsAddDialogOpen(true);
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              Новая задача
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Фильтры */}
          <div className="flex flex-wrap gap-4 mb-6">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Поиск по названию..."
                  value={filters.search}
                  onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                  className="pl-10"
                />
              </div>
            </div>
            <Select value={filters.status} onValueChange={(value) => setFilters({ ...filters, status: value })}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Статус" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все</SelectItem>
                <SelectItem value="pending">Новые</SelectItem>
                <SelectItem value="completed">Выполненные</SelectItem>
                <SelectItem value="cancelled">Отменённые</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filters.dateFilter} onValueChange={(value) => setFilters({ ...filters, dateFilter: value })}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Дата" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все</SelectItem>
                <SelectItem value="overdue">Просроченные</SelectItem>
                <SelectItem value="today">Сегодня</SelectItem>
                <SelectItem value="week">Неделя</SelectItem>
                <SelectItem value="month">Месяц</SelectItem>
              </SelectContent>
            </Select>
            <LeadPhoneSearch
              leads={leads}
              value={filters.leadId}
              onChange={(leadId) => setFilters({ ...filters, leadId })}
              placeholder="Фильтр по телефону лида..."
              className="w-[220px]"
              allowNone={true}
            />
          </div>

          {/* Список задач */}
          {filteredTasks.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <CheckSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium">Задачи не найдены</p>
              <p className="text-sm mt-1">Создайте первую задачу для планирования работы</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredTasks.map((task) => (
                <div
                  key={task.id}
                  className={cn(
                    'flex items-start gap-3 p-4 border rounded-lg hover:bg-accent transition-colors',
                    isOverdue(task) && 'border-red-500 bg-red-50 dark:bg-red-950/20',
                    task.status === 'completed' && 'opacity-60'
                  )}
                >
                  {/* Чекбокс для быстрого выполнения */}
                  <Checkbox
                    checked={task.status === 'completed'}
                    onCheckedChange={() => handleQuickComplete(task)}
                    disabled={task.status === 'completed'}
                    className="mt-1"
                  />

                  {/* Контент задачи */}
                  <div className="flex-1">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <span
                        className={cn('font-medium', task.status === 'completed' && 'line-through text-muted-foreground')}
                      >
                        {task.title}
                      </span>
                      <div className="flex gap-1">
                        <Badge className={getStatusColor(task.status)}>{getStatusText(task.status)}</Badge>
                        {isAssignedByAdmin(task) && (
                          <Badge variant="outline" className="bg-purple-100 text-purple-800 border-purple-300">
                            Назначена админом
                          </Badge>
                        )}
                      </div>
                    </div>

                    {task.description && (
                      <p
                        className={cn(
                          'text-sm text-muted-foreground mb-2',
                          task.status === 'completed' && 'line-through'
                        )}
                      >
                        {task.description}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <CalendarIcon className="h-3 w-3" />
                        {new Date(task.due_date).toLocaleDateString('ru-RU')}
                      </span>

                      {isOverdue(task) && (
                        <Badge variant="destructive" className="text-xs">
                          Просрочено
                        </Badge>
                      )}

                      {task.lead && (
                        <Badge variant="outline" className="text-xs">
                          {task.lead.contact_name || task.lead.contact_phone}
                        </Badge>
                      )}

                      {task.result_notes && task.status === 'completed' && (
                        <span className="text-xs text-green-600">✓ С результатом</span>
                      )}
                    </div>

                    {task.result_notes && task.status === 'completed' && (
                      <div className="mt-2 p-2 bg-green-50 dark:bg-green-950/20 rounded border border-green-200 dark:border-green-800">
                        <p className="text-xs text-green-900 dark:text-green-100">
                          <strong>Результат:</strong> {task.result_notes}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Кнопки действий */}
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => openEditDialog(task)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setTaskToDelete(task);
                        setDeleteConfirmOpen(true);
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Диалог добавления */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новая задача</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>Название *</Label>
              <Input
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="Введите название задачи"
              />
            </div>
            <div>
              <Label>Описание</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Дополнительная информация..."
                rows={3}
              />
            </div>
            <div>
              <Label>Дата выполнения *</Label>
              <Input
                type="date"
                value={formData.due_date}
                onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
              />
            </div>
            <div>
              <Label>Лид (опционально)</Label>
              <LeadPhoneSearch
                leads={leads}
                value={formData.lead_id}
                onChange={(leadId) => setFormData({ ...formData, lead_id: leadId })}
                placeholder="Введите номер телефона..."
                allowNone={true}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setIsAddDialogOpen(false);
                resetForm();
              }}
            >
              Отмена
            </Button>
            <Button onClick={handleAddTask}>Создать</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Диалог редактирования */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Редактировать задачу</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>Название</Label>
              <Input
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              />
            </div>
            <div>
              <Label>Описание</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={3}
              />
            </div>
            <div>
              <Label>Дата выполнения</Label>
              <Input
                type="date"
                value={formData.due_date}
                onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setIsEditDialogOpen(false);
                setEditingTask(null);
                resetForm();
              }}
            >
              Отмена
            </Button>
            <Button onClick={handleUpdateTask}>Сохранить</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Диалог записи результата */}
      <Dialog open={resultNotesDialogOpen} onOpenChange={setResultNotesDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Записать результат выполнения</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {completingTask && (
              <div className="p-3 bg-muted rounded-lg">
                <p className="font-medium">{completingTask.title}</p>
                {completingTask.description && (
                  <p className="text-sm text-muted-foreground mt-1">{completingTask.description}</p>
                )}
              </div>
            )}
            <div>
              <Label>Результат выполнения</Label>
              <Textarea
                value={resultNotesValue}
                onChange={(e) => setResultNotesValue(e.target.value)}
                placeholder="Опишите результат выполнения задачи..."
                rows={4}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setResultNotesDialogOpen(false);
                setCompletingTask(null);
                setResultNotesValue('');
              }}
            >
              Отмена
            </Button>
            <Button onClick={handleSaveResult}>Сохранить</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Диалог удаления */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить задачу?</AlertDialogTitle>
            <AlertDialogDescription>
              Это действие нельзя отменить. Задача будет удалена безвозвратно.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteTask} className="bg-destructive text-destructive-foreground">
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
