import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Phone, Plus, Star, Trash2, Edit2, Check, QrCode, Cloud } from 'lucide-react';
import { toast } from 'sonner';
import { API_BASE_URL } from '@/config/api';

type ConnectionType = 'evolution' | 'waba';

interface WhatsAppNumber {
  id: string;
  phone_number: string;
  label: string | null;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  connection_type: ConnectionType;
  waba_phone_id: string | null;
}

interface WhatsAppNumbersCardProps {
  userAccountId: string;
}

const WhatsAppNumbersCard: React.FC<WhatsAppNumbersCardProps> = ({ userAccountId }) => {
  const [numbers, setNumbers] = useState<WhatsAppNumber[]>([]);
  const [loading, setLoading] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  // Форма для добавления/редактирования
  const [formData, setFormData] = useState({
    phone_number: '',
    label: '',
    is_default: false,
    connection_type: 'evolution' as ConnectionType,
    waba_phone_id: '',
  });

  // Загрузка номеров
  const loadNumbers = async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/whatsapp-numbers?userAccountId=${userAccountId}`
      );
      const data = await response.json();
      setNumbers(data.numbers || []);
    } catch (error) {
      console.error('Error loading WhatsApp numbers:', error);
      toast.error('Не удалось загрузить номера');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (userAccountId) {
      loadNumbers();
    }
  }, [userAccountId]);

  // Добавить номер
  const handleAdd = async () => {
    if (!formData.phone_number.match(/^\+[1-9][0-9]{7,14}$/)) {
      toast.error('Неверный формат номера. Используйте международный формат: +12345678901');
      return;
    }

    // Валидация WABA Phone ID
    if (formData.connection_type === 'waba' && !formData.waba_phone_id.trim()) {
      toast.error('Введите WABA Phone Number ID для подключения через Meta Cloud API');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/whatsapp-numbers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userAccountId,
          phone_number: formData.phone_number,
          label: formData.label,
          is_default: formData.is_default,
          connection_type: formData.connection_type,
          waba_phone_id: formData.connection_type === 'waba' ? formData.waba_phone_id : undefined,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to add number');
      }

      toast.success('Номер добавлен');
      setAddDialogOpen(false);
      setFormData({ phone_number: '', label: '', is_default: false, connection_type: 'evolution', waba_phone_id: '' });
      loadNumbers();
    } catch (error: any) {
      toast.error(error.message || 'Не удалось добавить номер');
    }
  };

  // Установить дефолтным
  const handleSetDefault = async (id: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/whatsapp-numbers/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_default: true }),
      });

      if (!response.ok) throw new Error('Failed to set default');

      toast.success('Дефолтный номер изменен');
      loadNumbers();
    } catch (error) {
      toast.error('Не удалось изменить дефолтный номер');
    }
  };

  // Удалить номер
  const handleDelete = async (id: string) => {
    if (!confirm('Удалить этот номер?')) return;

    try {
      const response = await fetch(`${API_BASE_URL}/whatsapp-numbers/${id}?userAccountId=${userAccountId}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.directions) {
          toast.error(`Номер используется в направлениях: ${data.directions.join(', ')}`);
        } else {
          throw new Error(data.error || 'Failed to delete');
        }
        return;
      }

      toast.success('Номер удален');
      loadNumbers();
    } catch (error: any) {
      toast.error(error.message || 'Не удалось удалить номер');
    }
  };

  // Начать редактирование label
  const startEdit = (number: WhatsAppNumber) => {
    setEditingId(number.id);
    setFormData({ ...formData, label: number.label || '' });
  };

  // Сохранить label
  const saveLabel = async (id: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/whatsapp-numbers/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: formData.label || null }),
      });

      if (!response.ok) throw new Error('Failed to update label');

      toast.success('Название обновлено');
      setEditingId(null);
      loadNumbers();
    } catch (error) {
      toast.error('Не удалось обновить название');
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Phone className="w-5 h-5" />
                WhatsApp номера
              </CardTitle>
              <CardDescription>
                Управление номерами WhatsApp для разных направлений
              </CardDescription>
            </div>
            <Button onClick={() => setAddDialogOpen(true)} size="sm">
              <Plus className="w-4 h-4 mr-2" />
              Добавить
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-4 text-muted-foreground">Загрузка...</div>
          ) : numbers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Phone className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>Нет добавленных номеров</p>
              <p className="text-sm mt-1">Добавьте номер WhatsApp для использования в направлениях</p>
            </div>
          ) : (
            <div className="space-y-2">
              {numbers.map((number) => (
                <div
                  key={number.id}
                  className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                >
                  {/* Номер и название */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-medium">{number.phone_number}</span>
                      {number.is_default && (
                        <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" title="Дефолтный" />
                      )}
                      {number.connection_type === 'waba' ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" title="Meta Cloud API">
                          <Cloud className="w-3 h-3" />
                          WABA
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" title="Evolution API (QR)">
                          <QrCode className="w-3 h-3" />
                          QR
                        </span>
                      )}
                    </div>
                    
                    {editingId === number.id ? (
                      <div className="flex items-center gap-2 mt-1">
                        <Input
                          value={formData.label}
                          onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                          placeholder="Название (например: Основной)"
                          className="h-7 text-sm"
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={() => saveLabel(number.id)}
                        >
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={() => setEditingId(null)}
                        >
                          ×
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-sm text-muted-foreground">
                          {number.label || 'Без названия'}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100"
                          onClick={() => startEdit(number)}
                        >
                          <Edit2 className="w-3 h-3" />
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Действия */}
                  <div className="flex items-center gap-1">
                    {!number.is_default && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleSetDefault(number.id)}
                        title="Сделать дефолтным"
                      >
                        <Star className="w-4 h-4" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDelete(number.id)}
                      title="Удалить"
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Диалог добавления номера */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Добавить WhatsApp номер</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Тип подключения */}
            <div className="space-y-2">
              <Label>Тип подключения</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, connection_type: 'evolution', waba_phone_id: '' })}
                  className={`flex items-center gap-2 p-3 rounded-lg border-2 transition-colors ${
                    formData.connection_type === 'evolution'
                      ? 'border-primary bg-primary/5'
                      : 'border-muted hover:border-muted-foreground/50'
                  }`}
                >
                  <QrCode className="w-5 h-5" />
                  <div className="text-left">
                    <div className="font-medium text-sm">QR-код</div>
                    <div className="text-xs text-muted-foreground">Evolution API</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, connection_type: 'waba' })}
                  className={`flex items-center gap-2 p-3 rounded-lg border-2 transition-colors ${
                    formData.connection_type === 'waba'
                      ? 'border-primary bg-primary/5'
                      : 'border-muted hover:border-muted-foreground/50'
                  }`}
                >
                  <Cloud className="w-5 h-5" />
                  <div className="text-left">
                    <div className="font-medium text-sm">WABA</div>
                    <div className="text-xs text-muted-foreground">Meta Cloud API</div>
                  </div>
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Номер телефона*</Label>
              <Input
                id="phone"
                value={formData.phone_number}
                onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })}
                placeholder="+12345678901"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Международный формат: +[код страны][номер]
              </p>
            </div>

            {/* WABA Phone ID - только для WABA */}
            {formData.connection_type === 'waba' && (
              <div className="space-y-2">
                <Label htmlFor="waba_phone_id">WABA Phone Number ID*</Label>
                <Input
                  id="waba_phone_id"
                  value={formData.waba_phone_id}
                  onChange={(e) => setFormData({ ...formData, waba_phone_id: e.target.value })}
                  placeholder="123456789012345"
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Найти в Meta Business Suite → WhatsApp Manager → Phone Numbers
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="label">Название (опционально)</Label>
              <Input
                id="label"
                value={formData.label}
                onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                placeholder="Например: Основной"
              />
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="is_default"
                checked={formData.is_default}
                onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
                className="rounded"
              />
              <Label htmlFor="is_default" className="cursor-pointer">
                Сделать дефолтным
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
              Отмена
            </Button>
            <Button onClick={handleAdd}>
              Добавить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default WhatsAppNumbersCard;






