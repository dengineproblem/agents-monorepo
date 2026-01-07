import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { campaignContextsApi, CampaignContext, CreateContextInput } from '@/services/campaignContextsApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from '@/hooks/use-toast';
import { Plus, Pencil, Trash2, Calendar, Target } from 'lucide-react';
import { format } from 'date-fns';

const USER_ACCOUNT_ID = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b';

const typeLabels: Record<string, string> = {
  promo: 'Промо-акция',
  case: 'Кейс',
  content: 'Полезный контент',
  news: 'Новость'
};

const typeColors: Record<string, string> = {
  promo: 'bg-orange-100 text-orange-800',
  case: 'bg-blue-100 text-blue-800',
  content: 'bg-green-100 text-green-800',
  news: 'bg-purple-100 text-purple-800'
};

export function CampaignContextsManager() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingContext, setEditingContext] = useState<CampaignContext | null>(null);
  const [formData, setFormData] = useState<Partial<CreateContextInput>>({
    type: 'promo',
    title: '',
    content: '',
    goal: '',
    start_date: new Date().toISOString().split('T')[0],
    end_date: '',
    target_funnel_stages: [],
    target_interest_levels: [],
    priority: 3,
    is_active: true
  });

  const { data: contexts, isLoading } = useQuery({
    queryKey: ['contexts', USER_ACCOUNT_ID],
    queryFn: () => campaignContextsApi.getContexts(USER_ACCOUNT_ID),
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateContextInput) => campaignContextsApi.createContext(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contexts'] });
      toast({ title: 'Контекст создан успешно' });
      handleCloseModal();
    },
    onError: () => {
      toast({ title: 'Ошибка создания контекста', variant: 'destructive' });
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CampaignContext> }) =>
      campaignContextsApi.updateContext(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contexts'] });
      toast({ title: 'Контекст обновлён' });
      handleCloseModal();
    },
    onError: () => {
      toast({ title: 'Ошибка обновления контекста', variant: 'destructive' });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => campaignContextsApi.deleteContext(id, USER_ACCOUNT_ID),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contexts'] });
      toast({ title: 'Контекст удалён' });
    },
    onError: () => {
      toast({ title: 'Ошибка удаления контекста', variant: 'destructive' });
    }
  });

  const handleOpenModal = (context?: CampaignContext) => {
    if (context) {
      setEditingContext(context);
      setFormData({
        type: context.type,
        title: context.title,
        content: context.content,
        goal: context.goal || '',
        start_date: context.start_date.split('T')[0],
        end_date: context.end_date ? context.end_date.split('T')[0] : '',
        target_funnel_stages: context.target_funnel_stages || [],
        target_interest_levels: context.target_interest_levels || [],
        priority: context.priority,
        is_active: context.is_active
      });
    } else {
      setEditingContext(null);
      setFormData({
        type: 'promo',
        title: '',
        content: '',
        goal: '',
        start_date: new Date().toISOString().split('T')[0],
        end_date: '',
        target_funnel_stages: [],
        target_interest_levels: [],
        priority: 3,
        is_active: true
      });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingContext(null);
    setFormData({
      type: 'promo',
      title: '',
      content: '',
      goal: '',
      start_date: new Date().toISOString().split('T')[0],
      end_date: '',
      target_funnel_stages: [],
      target_interest_levels: [],
      priority: 3,
      is_active: true
    });
  };

  const handleSubmit = () => {
    if (!formData.title || !formData.content) {
      toast({ title: 'Заполните обязательные поля', variant: 'destructive' });
      return;
    }

    const submitData: CreateContextInput = {
      user_account_id: USER_ACCOUNT_ID,
      type: formData.type as any,
      title: formData.title,
      content: formData.content,
      goal: formData.goal,
      start_date: formData.start_date,
      end_date: formData.end_date || null,
      target_funnel_stages: formData.target_funnel_stages,
      target_interest_levels: formData.target_interest_levels,
      priority: formData.priority || 3,
      is_active: formData.is_active !== false
    };

    if (editingContext) {
      updateMutation.mutate({ id: editingContext.id, data: submitData });
    } else {
      createMutation.mutate(submitData);
    }
  };

  const toggleInterestLevel = (level: 'hot' | 'warm' | 'cold') => {
    const current = formData.target_interest_levels || [];
    const updated = current.includes(level)
      ? current.filter(l => l !== level)
      : [...current, level];
    setFormData({ ...formData, target_interest_levels: updated });
  };

  const isActive = (context: CampaignContext) => {
    if (!context.is_active) return false;
    const now = new Date();
    const start = new Date(context.start_date);
    if (start > now) return false;
    if (context.end_date) {
      const end = new Date(context.end_date);
      if (end < now) return false;
    }
    return true;
  };

  if (isLoading) {
    return <div className="text-center py-8">Загрузка...</div>;
  }

  const activeContexts = contexts?.filter(isActive) || [];
  const inactiveContexts = contexts?.filter(c => !isActive(c)) || [];

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>Актуальный контекст для рассылок</CardTitle>
            <Button onClick={() => handleOpenModal()} size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Добавить контекст
            </Button>
          </div>
          <p className="text-sm text-gray-600 mt-2">
            Управляйте актуальными акциями, кейсами и полезными материалами, которые будут использоваться в рассылках
          </p>
        </CardHeader>
        <CardContent>
          {/* Active Contexts */}
          {activeContexts.length > 0 && (
            <div className="mb-6">
              <h3 className="text-md font-semibold mb-3 flex items-center">
                <span className="h-2 w-2 bg-green-500 rounded-full mr-2"></span>
                Активные контексты ({activeContexts.length})
              </h3>
              <div className="space-y-3">
                {activeContexts.map((context) => (
                  <ContextCard
                    key={context.id}
                    context={context}
                    onEdit={() => handleOpenModal(context)}
                    onDelete={() => {
                      if (confirm('Удалить этот контекст?')) {
                        deleteMutation.mutate(context.id);
                      }
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Inactive Contexts */}
          {inactiveContexts.length > 0 && (
            <div>
              <h3 className="text-md font-semibold mb-3 flex items-center">
                <span className="h-2 w-2 bg-gray-400 rounded-full mr-2"></span>
                Неактивные / Завершённые ({inactiveContexts.length})
              </h3>
              <div className="space-y-3">
                {inactiveContexts.map((context) => (
                  <ContextCard
                    key={context.id}
                    context={context}
                    onEdit={() => handleOpenModal(context)}
                    onDelete={() => {
                      if (confirm('Удалить этот контекст?')) {
                        deleteMutation.mutate(context.id);
                      }
                    }}
                    inactive
                  />
                ))}
              </div>
            </div>
          )}

          {contexts && contexts.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              Нет контекстов. Создайте первый контекст для использования в рассылках.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingContext ? 'Редактировать контекст' : 'Новый контекст'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Тип контекста *</Label>
              <Select
                value={formData.type}
                onValueChange={(v) => setFormData({ ...formData, type: v as any })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="promo">Промо-акция</SelectItem>
                  <SelectItem value="case">Кейс / Результат</SelectItem>
                  <SelectItem value="content">Полезный контент</SelectItem>
                  <SelectItem value="news">Новость</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Название *</Label>
              <Input
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="Например: Скидка 20% до конца месяца"
              />
            </div>

            <div>
              <Label>Описание / Детали *</Label>
              <Textarea
                value={formData.content}
                onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                placeholder="Подробное описание контекста для AI"
                rows={6}
              />
            </div>

            <div>
              <Label>Цель использования (опционально)</Label>
              <Input
                value={formData.goal}
                onChange={(e) => setFormData({ ...formData, goal: e.target.value })}
                placeholder="Например: побудить к записи на консультацию"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Дата начала *</Label>
                <Input
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                />
              </div>
              <div>
                <Label>Дата окончания</Label>
                <Input
                  type="date"
                  value={formData.end_date || ''}
                  onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                />
                <p className="text-xs text-gray-500 mt-1">Оставьте пустым, если без срока</p>
              </div>
            </div>

            <div>
              <Label>Целевая теплота лидов</Label>
              <div className="flex gap-4 mt-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    checked={(formData.target_interest_levels || []).includes('hot')}
                    onCheckedChange={() => toggleInterestLevel('hot')}
                  />
                  <Label className="font-normal cursor-pointer" onClick={() => toggleInterestLevel('hot')}>
                    Горячие (HOT)
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    checked={(formData.target_interest_levels || []).includes('warm')}
                    onCheckedChange={() => toggleInterestLevel('warm')}
                  />
                  <Label className="font-normal cursor-pointer" onClick={() => toggleInterestLevel('warm')}>
                    Тёплые (WARM)
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    checked={(formData.target_interest_levels || []).includes('cold')}
                    onCheckedChange={() => toggleInterestLevel('cold')}
                  />
                  <Label className="font-normal cursor-pointer" onClick={() => toggleInterestLevel('cold')}>
                    Холодные (COLD)
                  </Label>
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-1">Пусто = применяется ко всем</p>
            </div>

            <div>
              <Label>Приоритет (1-5)</Label>
              <Select
                value={String(formData.priority || 3)}
                onValueChange={(v) => setFormData({ ...formData, priority: Number(v) })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 - Низкий</SelectItem>
                  <SelectItem value="2">2</SelectItem>
                  <SelectItem value="3">3 - Средний</SelectItem>
                  <SelectItem value="4">4</SelectItem>
                  <SelectItem value="5">5 - Высокий</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                checked={formData.is_active !== false}
                onCheckedChange={(checked) => setFormData({ ...formData, is_active: !!checked })}
              />
              <Label className="font-normal cursor-pointer">
                Активен (можно использовать в рассылках)
              </Label>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={handleCloseModal}>
                Отмена
              </Button>
              <Button onClick={handleSubmit}>
                {editingContext ? 'Сохранить' : 'Создать'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ContextCard({
  context,
  onEdit,
  onDelete,
  inactive = false
}: {
  context: CampaignContext;
  onEdit: () => void;
  onDelete: () => void;
  inactive?: boolean;
}) {
  return (
    <div className={`border rounded-lg p-4 ${inactive ? 'opacity-60 bg-gray-50' : ''}`}>
      <div className="flex justify-between items-start mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <Badge className={typeColors[context.type]}>
              {typeLabels[context.type]}
            </Badge>
            <Badge variant="outline">Приоритет: {context.priority}</Badge>
            {context.target_interest_levels && context.target_interest_levels.length > 0 && (
              <Badge variant="secondary">
                <Target className="h-3 w-3 mr-1" />
                {context.target_interest_levels.map(l => l.toUpperCase()).join(', ')}
              </Badge>
            )}
          </div>
          <p className="font-semibold text-lg mb-1">{context.title}</p>
          <p className="text-sm text-gray-600 line-clamp-2 mb-2">{context.content}</p>
          {context.goal && (
            <p className="text-xs text-gray-500 italic">Цель: {context.goal}</p>
          )}
          <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
            <div className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {format(new Date(context.start_date), 'dd.MM.yyyy')}
              {context.end_date && ` - ${format(new Date(context.end_date), 'dd.MM.yyyy')}`}
            </div>
            <span>•</span>
            <span>Использовано: {context.usage_count} раз</span>
          </div>
        </div>
        <div className="flex gap-2 ml-4">
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete}>
            <Trash2 className="h-4 w-4 text-red-600" />
          </Button>
        </div>
      </div>
    </div>
  );
}

