import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { chatbotApi } from '@/services/chatbotApi';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/hooks/use-toast';
import { Plus, Edit, Trash2 } from 'lucide-react';

interface Trigger {
  id: string;
  keyword: string;
  response: string;
  enabled: boolean;
}

export function TriggersManager() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTrigger, setEditingTrigger] = useState<Trigger | null>(null);
  const [formData, setFormData] = useState({
    keyword: '',
    response: '',
    enabled: true,
  });

  // Fetch triggers
  const { data: triggers = [], isLoading } = useQuery({
    queryKey: ['chatbot-triggers'],
    queryFn: () => chatbotApi.getTriggers(),
  });

  // Create trigger mutation
  const createMutation = useMutation({
    mutationFn: (data: { keyword: string; response: string; enabled: boolean }) =>
      chatbotApi.createTrigger(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chatbot-triggers'] });
      toast({ title: 'Триггер создан' });
      handleCloseModal();
    },
    onError: () => {
      toast({ title: 'Ошибка при создании триггера', variant: 'destructive' });
    },
  });

  // Update trigger mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Trigger> }) =>
      chatbotApi.updateTrigger(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chatbot-triggers'] });
      toast({ title: 'Триггер обновлён' });
      handleCloseModal();
    },
    onError: () => {
      toast({ title: 'Ошибка при обновлении триггера', variant: 'destructive' });
    },
  });

  // Delete trigger mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => chatbotApi.deleteTrigger(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chatbot-triggers'] });
      toast({ title: 'Триггер удалён' });
    },
    onError: () => {
      toast({ title: 'Ошибка при удалении триггера', variant: 'destructive' });
    },
  });

  const handleOpenModal = (trigger?: Trigger) => {
    if (trigger) {
      setEditingTrigger(trigger);
      setFormData({
        keyword: trigger.keyword,
        response: trigger.response,
        enabled: trigger.enabled,
      });
    } else {
      setEditingTrigger(null);
      setFormData({
        keyword: '',
        response: '',
        enabled: true,
      });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingTrigger(null);
    setFormData({
      keyword: '',
      response: '',
      enabled: true,
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.keyword || !formData.response) {
      toast({ title: 'Заполните все поля', variant: 'destructive' });
      return;
    }

    if (editingTrigger) {
      updateMutation.mutate({ id: editingTrigger.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleDelete = (trigger: Trigger) => {
    if (confirm(`Удалить триггер "${trigger.keyword}"?`)) {
      deleteMutation.mutate(trigger.id);
    }
  };

  const handleToggleEnabled = (trigger: Trigger) => {
    updateMutation.mutate({
      id: trigger.id,
      data: { enabled: !trigger.enabled },
    });
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Триггеры</CardTitle>
              <CardDescription>
                Автоматические ответы на ключевые слова
              </CardDescription>
            </div>
            <Button onClick={() => handleOpenModal()} size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Добавить триггер
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
            </div>
          ) : triggers.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              Триггеры не настроены
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ключевое слово</TableHead>
                  <TableHead>Ответ</TableHead>
                  <TableHead className="w-24">Статус</TableHead>
                  <TableHead className="w-24">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {triggers.map((trigger: Trigger) => (
                  <TableRow key={trigger.id}>
                    <TableCell className="font-medium">{trigger.keyword}</TableCell>
                    <TableCell className="max-w-md truncate">{trigger.response}</TableCell>
                    <TableCell>
                      <Switch
                        checked={trigger.enabled}
                        onCheckedChange={() => handleToggleEnabled(trigger)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenModal(trigger)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(trigger)}
                        >
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Edit/Create Modal */}
      <Dialog open={isModalOpen} onOpenChange={handleCloseModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingTrigger ? 'Редактировать триггер' : 'Новый триггер'}
            </DialogTitle>
            <DialogDescription>
              Укажите ключевое слово и ответ бота
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="keyword">Ключевое слово</Label>
              <Input
                id="keyword"
                value={formData.keyword}
                onChange={(e) => setFormData({ ...formData, keyword: e.target.value })}
                placeholder="Например: цена, стоимость"
                required
              />
            </div>

            <div>
              <Label htmlFor="response">Ответ</Label>
              <Textarea
                id="response"
                value={formData.response}
                onChange={(e) => setFormData({ ...formData, response: e.target.value })}
                placeholder="Ответ бота на это ключевое слово..."
                rows={4}
                required
              />
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="enabled"
                checked={formData.enabled}
                onCheckedChange={(checked) => setFormData({ ...formData, enabled: checked })}
              />
              <Label htmlFor="enabled">Включен</Label>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleCloseModal}>
                Отмена
              </Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {editingTrigger ? 'Сохранить' : 'Создать'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

