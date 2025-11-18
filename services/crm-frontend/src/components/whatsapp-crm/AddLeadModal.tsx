import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { useState, useEffect } from 'react';
import { FunnelStage } from '@/types/dialogAnalysis';
import { dialogAnalysisService } from '@/services/dialogAnalysisService';
import { useQuery } from '@tanstack/react-query';

interface AddLeadModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (lead: any) => void;
  userAccountId: string;
}

export function AddLeadModal({ open, onClose, onSubmit, userAccountId }: AddLeadModalProps) {
  const [formData, setFormData] = useState({
    phone: '',
    contactName: '',
    businessType: '',
    isMedical: false,
    funnelStage: 'new_lead' as FunnelStage,
    instanceName: '',
    notes: '',
  });

  // Fetch WhatsApp instances
  const { data: instances } = useQuery({
    queryKey: ['whatsapp-instances', userAccountId],
    queryFn: () => dialogAnalysisService.getInstances(userAccountId),
    enabled: open && !!userAccountId,
  });

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setFormData({
        phone: '',
        contactName: '',
        businessType: '',
        isMedical: false,
        funnelStage: 'new_lead',
        instanceName: instances?.[0]?.instance_name || '',
        notes: '',
      });
    }
  }, [open, instances]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.phone) {
      alert('Телефон обязателен');
      return;
    }
    
    if (!formData.instanceName && instances && instances.length > 0) {
      formData.instanceName = instances[0].instance_name;
    }
    
    if (!formData.instanceName) {
      alert('Не найден WhatsApp инстанс');
      return;
    }
    
    onSubmit(formData);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Добавить нового лида</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Phone */}
          <div>
            <Label htmlFor="phone">Телефон *</Label>
            <Input
              id="phone"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              placeholder="+7 700 123 45 67"
              required
            />
          </div>

          {/* Contact Name */}
          <div>
            <Label htmlFor="contactName">Имя контакта</Label>
            <Input
              id="contactName"
              value={formData.contactName}
              onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
              placeholder="Иван Иванов"
            />
          </div>

          {/* Business Type */}
          <div>
            <Label htmlFor="businessType">Тип бизнеса</Label>
            <Input
              id="businessType"
              value={formData.businessType}
              onChange={(e) => setFormData({ ...formData, businessType: e.target.value })}
              placeholder="Клиника, салон, магазин..."
            />
          </div>

          {/* Is Medical */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="isMedical"
              checked={formData.isMedical}
              onCheckedChange={(checked) =>
                setFormData({ ...formData, isMedical: checked as boolean })
              }
            />
            <Label htmlFor="isMedical" className="cursor-pointer">
              🏥 Медицинская ниша
            </Label>
          </div>

          {/* Funnel Stage */}
          <div>
            <Label htmlFor="funnelStage">Этап воронки</Label>
            <Select
              value={formData.funnelStage}
              onValueChange={(value) =>
                setFormData({ ...formData, funnelStage: value as FunnelStage })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new_lead">Новый лид</SelectItem>
                <SelectItem value="not_qualified">Не квалифицирован</SelectItem>
                <SelectItem value="qualified">Квалифицирован</SelectItem>
                <SelectItem value="consultation_booked">Консультация назначена</SelectItem>
                <SelectItem value="consultation_completed">Консультация прошла</SelectItem>
                <SelectItem value="deal_closed">Сделка закрыта</SelectItem>
                <SelectItem value="deal_lost">Сделка потеряна</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* WhatsApp Instance */}
          {instances && instances.length > 0 && (
            <div>
              <Label htmlFor="instanceName">WhatsApp инстанс</Label>
              <Select
                value={formData.instanceName}
                onValueChange={(value) =>
                  setFormData({ ...formData, instanceName: value })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Выберите инстанс" />
                </SelectTrigger>
                <SelectContent>
                  {instances.map((instance) => (
                    <SelectItem key={instance.id} value={instance.instance_name}>
                      {instance.instance_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Notes */}
          <div>
            <Label htmlFor="notes">Заметки</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Дополнительная информация..."
              rows={3}
            />
          </div>

          {/* Buttons */}
          <div className="flex gap-2 justify-end pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit">
              Добавить лида
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}





