/**
 * User Account Edit Modal
 *
 * Модальное окно для редактирования полей user_account в админке
 *
 * @module components/admin/UserAccountEditModal
 */

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Save } from 'lucide-react';
import { API_BASE_URL } from '@/config/api';
import { toast } from 'sonner';

interface UserAccount {
  id: string;
  username: string;
  onboarding_stage: string;
  // Facebook/Instagram
  access_token?: string;
  ad_account_id?: string;
  page_id?: string;
  business_id?: string;
  instagram_id?: string;
  instagram_username?: string;
  // Telegram
  telegram_id?: string;
  telegram_bot_token?: string;
  // TikTok
  tiktok_business_id?: string;
  tiktok_account_id?: string;
  tiktok_access_token?: string;
  // Тариф и бюджет
  tarif?: string;
  tarif_expires?: string;
  tarif_renewal_cost?: number;
  plan_daily_budget_cents?: number;
  default_cpl_target_cents?: number;
  // Прочее
  webhook_url?: string;
  optimization?: string;
  creative_generations_available?: number;
  current_campaign_goal?: string;
  prompt1?: string;
  prompt2?: string;
  prompt3?: string;
  prompt4?: string;
  // Чекбоксы
  is_active?: boolean;
  test?: boolean;
  autopilot?: boolean;
}

interface UserAccountEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  onSave: () => void;
}

const ONBOARDING_STAGES = [
  'new',
  'prompt_filled',
  'fb_pending',
  'fb_connected',
  'direction_created',
  'campaign_created',
  'lead_received',
  'inactive',
];

const TARIFS = [
  { value: 'ai_target', label: 'AI Target' },
  { value: 'target', label: 'Target' },
  { value: 'ai_manager', label: 'AI Manager' },
  { value: 'complex', label: 'Complex' },
  { value: 'subscription_1m', label: 'Подписка 1 мес (49 000 KZT)' },
  { value: 'subscription_3m', label: 'Подписка 3 мес (99 000 KZT)' },
  { value: 'subscription_12m', label: 'Подписка 12 мес (299 000 KZT)' },
];

export function UserAccountEditModal({
  open,
  onOpenChange,
  userId,
  onSave,
}: UserAccountEditModalProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [user, setUser] = useState<UserAccount | null>(null);
  const [formData, setFormData] = useState<Partial<UserAccount>>({});

  // Загрузить данные пользователя
  useEffect(() => {
    if (open && userId) {
      fetchUser();
    }
  }, [open, userId]);

  const fetchUser = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/admin/users/${userId}`);
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setFormData(data.user);
      } else {
        toast.error('Не удалось загрузить данные пользователя');
      }
    } catch (err) {
      console.error('Error fetching user:', err);
      toast.error('Ошибка при загрузке');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/admin/users/${userId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      if (res.ok) {
        toast.success('Изменения сохранены');
        onSave();
        onOpenChange(false);
      } else {
        const data = await res.json();
        toast.error(data.error || 'Ошибка при сохранении');
      }
    } catch (err) {
      console.error('Error saving user:', err);
      toast.error('Ошибка при сохранении');
    } finally {
      setSaving(false);
    }
  };

  const updateField = (field: keyof UserAccount, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  // Конвертировать копейки в рубли для отображения
  const centsToRubles = (cents?: number) => {
    if (!cents) return '';
    return (cents / 100).toString();
  };

  // Конвертировать рубли в копейки для сохранения
  const rublesToCents = (rubles: string) => {
    const num = parseFloat(rubles);
    if (isNaN(num)) return undefined;
    return Math.round(num * 100);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl max-h-[90vh] overflow-y-auto"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          // Fix pointer-events stuck issue
          document.body.style.pointerEvents = '';
        }}
      >
        <DialogHeader>
          <DialogTitle>
            Редактирование: {user?.username || 'Загрузка...'}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Tabs defaultValue="facebook" className="w-full">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="facebook">Facebook</TabsTrigger>
              <TabsTrigger value="telegram">Telegram</TabsTrigger>
              <TabsTrigger value="tiktok">TikTok</TabsTrigger>
              <TabsTrigger value="tarif">Подписка</TabsTrigger>
              <TabsTrigger value="other">Прочее</TabsTrigger>
            </TabsList>

            {/* Facebook/Instagram */}
            <TabsContent value="facebook" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="access_token">Access Token</Label>
                  <Input
                    id="access_token"
                    value={formData.access_token || ''}
                    onChange={(e) => updateField('access_token', e.target.value)}
                    placeholder="Токен доступа Facebook"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ad_account_id">Ad Account ID</Label>
                  <Input
                    id="ad_account_id"
                    value={formData.ad_account_id || ''}
                    onChange={(e) => updateField('ad_account_id', e.target.value)}
                    placeholder="act_123456789"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="page_id">Page ID</Label>
                  <Input
                    id="page_id"
                    value={formData.page_id || ''}
                    onChange={(e) => updateField('page_id', e.target.value)}
                    placeholder="ID страницы Facebook"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="business_id">Business ID</Label>
                  <Input
                    id="business_id"
                    value={formData.business_id || ''}
                    onChange={(e) => updateField('business_id', e.target.value)}
                    placeholder="ID бизнес-аккаунта"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="instagram_id">Instagram ID</Label>
                  <Input
                    id="instagram_id"
                    value={formData.instagram_id || ''}
                    onChange={(e) => updateField('instagram_id', e.target.value)}
                    placeholder="ID Instagram аккаунта"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="instagram_username">Instagram Username</Label>
                  <Input
                    id="instagram_username"
                    value={formData.instagram_username || ''}
                    onChange={(e) => updateField('instagram_username', e.target.value)}
                    placeholder="@username"
                  />
                </div>
              </div>
            </TabsContent>

            {/* Telegram */}
            <TabsContent value="telegram" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="telegram_id">Telegram ID</Label>
                  <Input
                    id="telegram_id"
                    value={formData.telegram_id || ''}
                    onChange={(e) => updateField('telegram_id', e.target.value)}
                    placeholder="ID в Telegram"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="telegram_bot_token">Telegram Bot Token</Label>
                  <Input
                    id="telegram_bot_token"
                    value={formData.telegram_bot_token || ''}
                    onChange={(e) => updateField('telegram_bot_token', e.target.value)}
                    placeholder="Токен бота"
                  />
                </div>
              </div>
            </TabsContent>

            {/* TikTok */}
            <TabsContent value="tiktok" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="tiktok_business_id">TikTok Business ID</Label>
                  <Input
                    id="tiktok_business_id"
                    value={formData.tiktok_business_id || ''}
                    onChange={(e) => updateField('tiktok_business_id', e.target.value)}
                    placeholder="Business ID"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="tiktok_account_id">TikTok Account ID</Label>
                  <Input
                    id="tiktok_account_id"
                    value={formData.tiktok_account_id || ''}
                    onChange={(e) => updateField('tiktok_account_id', e.target.value)}
                    placeholder="Account ID"
                  />
                </div>

                <div className="col-span-2 space-y-2">
                  <Label htmlFor="tiktok_access_token">TikTok Access Token</Label>
                  <Input
                    id="tiktok_access_token"
                    value={formData.tiktok_access_token || ''}
                    onChange={(e) => updateField('tiktok_access_token', e.target.value)}
                    placeholder="Токен доступа TikTok"
                  />
                </div>
              </div>
            </TabsContent>

            {/* Тариф и бюджет */}
            <TabsContent value="tarif" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="tarif">Тариф</Label>
                  <Select
                    value={formData.tarif || ''}
                    onValueChange={(value) => updateField('tarif', value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите тариф" />
                    </SelectTrigger>
                    <SelectContent>
                      {TARIFS.map((tarif) => (
                        <SelectItem key={tarif.value} value={tarif.value}>
                          {tarif.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="tarif_expires">Дата окончания подписки</Label>
                  <Input
                    id="tarif_expires"
                    type="date"
                    value={formData.tarif_expires ? formData.tarif_expires.split('T')[0] : ''}
                    onChange={(e) => updateField('tarif_expires', e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="tarif_renewal_cost">Стоимость продления (KZT)</Label>
                  <Input
                    id="tarif_renewal_cost"
                    type="number"
                    value={formData.tarif_renewal_cost || ''}
                    onChange={(e) => updateField('tarif_renewal_cost', parseFloat(e.target.value) || undefined)}
                    placeholder="0"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="plan_daily_budget">Дневной бюджет (₽)</Label>
                  <Input
                    id="plan_daily_budget"
                    type="number"
                    step="0.01"
                    value={centsToRubles(formData.plan_daily_budget_cents)}
                    onChange={(e) => updateField('plan_daily_budget_cents', rublesToCents(e.target.value))}
                    placeholder="0.00"
                  />
                  <p className="text-xs text-muted-foreground">
                    Хранится в копейках: {formData.plan_daily_budget_cents || 0}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="default_cpl_target">Плановый CPL (₽)</Label>
                  <Input
                    id="default_cpl_target"
                    type="number"
                    step="0.01"
                    value={centsToRubles(formData.default_cpl_target_cents)}
                    onChange={(e) => updateField('default_cpl_target_cents', rublesToCents(e.target.value))}
                    placeholder="0.00"
                  />
                  <p className="text-xs text-muted-foreground">
                    Хранится в копейках: {formData.default_cpl_target_cents || 0}
                  </p>
                </div>
              </div>
            </TabsContent>

            {/* Прочее */}
            <TabsContent value="other" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="onboarding_stage">Этап онбординга</Label>
                  <Select
                    value={formData.onboarding_stage || ''}
                    onValueChange={(value) => updateField('onboarding_stage', value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите этап" />
                    </SelectTrigger>
                    <SelectContent>
                      {ONBOARDING_STAGES.map((stage) => (
                        <SelectItem key={stage} value={stage}>
                          {stage}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="webhook_url">Webhook URL</Label>
                  <Input
                    id="webhook_url"
                    value={formData.webhook_url || ''}
                    onChange={(e) => updateField('webhook_url', e.target.value)}
                    placeholder="https://..."
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="optimization">Оптимизация</Label>
                  <Input
                    id="optimization"
                    value={formData.optimization || ''}
                    onChange={(e) => updateField('optimization', e.target.value)}
                    placeholder="Тип оптимизации"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="creative_generations_available">Доступные генерации</Label>
                  <Input
                    id="creative_generations_available"
                    type="number"
                    value={formData.creative_generations_available || ''}
                    onChange={(e) => updateField('creative_generations_available', parseInt(e.target.value) || undefined)}
                    placeholder="0"
                  />
                </div>

                <div className="col-span-2 space-y-2">
                  <Label htmlFor="current_campaign_goal">Текущая цель кампании</Label>
                  <Input
                    id="current_campaign_goal"
                    value={formData.current_campaign_goal || ''}
                    onChange={(e) => updateField('current_campaign_goal', e.target.value)}
                    placeholder="Цель кампании"
                  />
                </div>
              </div>

              {/* Промпты */}
              <div className="space-y-4 border-t pt-4">
                <h4 className="font-medium">Промпты</h4>
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="prompt1">Промпт 1</Label>
                    <Textarea
                      id="prompt1"
                      value={formData.prompt1 || ''}
                      onChange={(e) => updateField('prompt1', e.target.value)}
                      placeholder="Промпт 1"
                      rows={2}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="prompt2">Промпт 2</Label>
                    <Textarea
                      id="prompt2"
                      value={formData.prompt2 || ''}
                      onChange={(e) => updateField('prompt2', e.target.value)}
                      placeholder="Промпт 2"
                      rows={2}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="prompt3">Промпт 3</Label>
                    <Textarea
                      id="prompt3"
                      value={formData.prompt3 || ''}
                      onChange={(e) => updateField('prompt3', e.target.value)}
                      placeholder="Промпт 3"
                      rows={2}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="prompt4">Промпт 4</Label>
                    <Textarea
                      id="prompt4"
                      value={formData.prompt4 || ''}
                      onChange={(e) => updateField('prompt4', e.target.value)}
                      placeholder="Промпт 4"
                      rows={2}
                    />
                  </div>
                </div>
              </div>

              {/* Чекбоксы */}
              <div className="space-y-4 border-t pt-4">
                <h4 className="font-medium">Флаги</h4>
                <div className="flex flex-wrap gap-6">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="is_active"
                      checked={formData.is_active ?? false}
                      onCheckedChange={(checked) => updateField('is_active', checked)}
                    />
                    <Label htmlFor="is_active" className="cursor-pointer">Активен</Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="test"
                      checked={formData.test ?? false}
                      onCheckedChange={(checked) => updateField('test', checked)}
                    />
                    <Label htmlFor="test" className="cursor-pointer">Тестовый режим</Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="autopilot"
                      checked={formData.autopilot ?? false}
                      onCheckedChange={(checked) => updateField('autopilot', checked)}
                    />
                    <Label htmlFor="autopilot" className="cursor-pointer">Автопилот</Label>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        )}

        <DialogFooter className="mt-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Сохранение...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Сохранить
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default UserAccountEditModal;
