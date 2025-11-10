import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { campaignApi, Template } from '@/services/campaignApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { Plus, Pencil, Trash2 } from 'lucide-react';

const USER_ACCOUNT_ID = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b';

export function TemplateManager() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    template_type: 'selling' as 'selling' | 'useful' | 'reminder',
  });

  const { data: templates } = useQuery({
    queryKey: ['templates', USER_ACCOUNT_ID],
    queryFn: () => campaignApi.getTemplates(USER_ACCOUNT_ID),
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof formData) =>
      campaignApi.createTemplate({
        ...data,
        user_account_id: USER_ACCOUNT_ID,
        is_active: true,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      toast({ title: 'Шаблон создан' });
      handleCloseModal();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: typeof formData }) =>
      campaignApi.updateTemplate(id, USER_ACCOUNT_ID, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      toast({ title: 'Шаблон обновлён' });
      handleCloseModal();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => campaignApi.deleteTemplate(id, USER_ACCOUNT_ID),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      toast({ title: 'Шаблон удалён' });
    },
  });

  const handleOpenModal = (template?: Template) => {
    if (template) {
      setEditingTemplate(template);
      setFormData({
        title: template.title,
        content: template.content,
        template_type: template.template_type,
      });
    } else {
      setEditingTemplate(null);
      setFormData({ title: '', content: '', template_type: 'selling' });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingTemplate(null);
    setFormData({ title: '', content: '', template_type: 'selling' });
  };

  const handleSubmit = () => {
    if (!formData.title || !formData.content) {
      toast({ title: 'Заполните все поля', variant: 'destructive' });
      return;
    }

    if (editingTemplate) {
      updateMutation.mutate({ id: editingTemplate.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const getTypeLabel = (type: string) => {
    const labels = {
      selling: 'Продающее',
      useful: 'Полезное',
      reminder: 'Напоминание',
    };
    return labels[type as keyof typeof labels] || type;
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>Шаблоны сообщений</CardTitle>
            <Button onClick={() => handleOpenModal()} size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Добавить шаблон
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!templates || templates.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              Нет шаблонов. Создайте первый шаблон.
            </div>
          ) : (
            <div className="space-y-3">
              {templates.map((template) => (
                <div key={template.id} className="border rounded-lg p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-semibold">{template.title}</p>
                        <Badge variant="outline">{getTypeLabel(template.template_type)}</Badge>
                      </div>
                      <p className="text-sm text-gray-600 line-clamp-2">{template.content}</p>
                      <p className="text-xs text-gray-400 mt-1">
                        Использовано: {template.usage_count} раз
                      </p>
                    </div>
                    <div className="flex gap-2 ml-4">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleOpenModal(template)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (confirm('Удалить этот шаблон?')) {
                            deleteMutation.mutate(template.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingTemplate ? 'Редактировать шаблон' : 'Новый шаблон'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Название</Label>
              <Input
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="Например: Предложение консультации"
              />
            </div>
            <div>
              <Label>Тип сообщения</Label>
              <Select
                value={formData.template_type}
                onValueChange={(v) => setFormData({ ...formData, template_type: v as any })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="selling">Продающее</SelectItem>
                  <SelectItem value="useful">Полезное</SelectItem>
                  <SelectItem value="reminder">Напоминание</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Текст шаблона</Label>
              <Textarea
                value={formData.content}
                onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                placeholder="Введите текст шаблона. AI использует это как базу для персонализации."
                rows={8}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleCloseModal}>
                Отмена
              </Button>
              <Button onClick={handleSubmit}>
                {editingTemplate ? 'Сохранить' : 'Создать'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

