import React, { useState } from 'react';
import { useAppContext } from '@/context/AppContext';
import { adAccountsApi } from '@/services/adAccountsApi';
import type { CreateAdAccountPayload } from '@/types/adAccount';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Facebook, MessageSquare, Key } from 'lucide-react';

interface CreateAdAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

const INITIAL_FORM_DATA: Partial<CreateAdAccountPayload> = {
  name: '',
  username: '',
  fb_ad_account_id: '',
  fb_page_id: '',
  fb_instagram_id: '',
  fb_instagram_username: '',
  telegram_id: '',
  telegram_id_2: '',
  telegram_id_3: '',
  telegram_id_4: '',
  prompt1: '',
  prompt2: '',
  prompt3: '',
  prompt4: '',
  openai_api_key: '',
  gemini_api_key: '',
};

export function CreateAdAccountDialog({ open, onOpenChange, onSuccess }: CreateAdAccountDialogProps) {
  const { loadAdAccounts } = useAppContext();
  const [formData, setFormData] = useState<Partial<CreateAdAccountPayload>>(INITIAL_FORM_DATA);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetForm = () => {
    setFormData(INITIAL_FORM_DATA);
  };

  const handleCreate = async () => {
    try {
      setIsSubmitting(true);
      const storedUser = localStorage.getItem('user');
      if (!storedUser) {
        toast.error('Пользователь не авторизован');
        return;
      }
      const userData = JSON.parse(storedUser);

      const result = await adAccountsApi.create({
        userAccountId: userData.id,
        name: formData.name || 'Новый аккаунт',
        ...formData,
      });

      if (result.success) {
        toast.success('Аккаунт создан');
        onOpenChange(false);
        resetForm();
        loadAdAccounts();
        onSuccess?.();
      } else {
        toast.error(result.error || 'Ошибка создания');
      }
    } catch (error) {
      toast.error('Ошибка создания аккаунта');
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateField = (field: keyof CreateAdAccountPayload, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen) resetForm();
      onOpenChange(isOpen);
    }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Новый рекламный аккаунт</DialogTitle>
          <DialogDescription>
            Заполните данные нового рекламного аккаунта
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="basic" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="basic">Основное</TabsTrigger>
            <TabsTrigger value="facebook">Facebook</TabsTrigger>
            <TabsTrigger value="notifications">Уведомления</TabsTrigger>
            <TabsTrigger value="ai">AI & Промпты</TabsTrigger>
          </TabsList>

          <TabsContent value="basic" className="space-y-4 mt-4">
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="create-name">Название аккаунта *</Label>
                <Input
                  id="create-name"
                  value={formData.name || ''}
                  onChange={(e) => updateField('name', e.target.value)}
                  placeholder="Мой бизнес"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="create-username">Имя пользователя</Label>
                <Input
                  id="create-username"
                  value={formData.username || ''}
                  onChange={(e) => updateField('username', e.target.value)}
                  placeholder="username"
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="facebook" className="space-y-4 mt-4">
            <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
              <Facebook className="h-4 w-4" />
              <span>ID аккаунтов из Facebook Business Manager</span>
            </div>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="create-fb_ad_account_id">Ad Account ID</Label>
                <Input
                  id="create-fb_ad_account_id"
                  value={formData.fb_ad_account_id || ''}
                  onChange={(e) => updateField('fb_ad_account_id', e.target.value)}
                  placeholder="act_123456789"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="create-fb_page_id">Page ID</Label>
                <Input
                  id="create-fb_page_id"
                  value={formData.fb_page_id || ''}
                  onChange={(e) => updateField('fb_page_id', e.target.value)}
                  placeholder="123456789"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="create-fb_instagram_id">Instagram Account ID</Label>
                <Input
                  id="create-fb_instagram_id"
                  value={formData.fb_instagram_id || ''}
                  onChange={(e) => updateField('fb_instagram_id', e.target.value)}
                  placeholder="17841..."
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="create-fb_instagram_username">Instagram Username</Label>
                <Input
                  id="create-fb_instagram_username"
                  value={formData.fb_instagram_username || ''}
                  onChange={(e) => updateField('fb_instagram_username', e.target.value)}
                  placeholder="@username"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              * Access Token заполняется администратором
            </p>
          </TabsContent>

          <TabsContent value="notifications" className="space-y-4 mt-4">
            <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
              <MessageSquare className="h-4 w-4" />
              <span>Telegram ID для уведомлений</span>
            </div>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="create-telegram_id">Telegram ID #1</Label>
                <Input
                  id="create-telegram_id"
                  value={formData.telegram_id || ''}
                  onChange={(e) => updateField('telegram_id', e.target.value)}
                  placeholder="123456789"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="create-telegram_id_2">Telegram ID #2</Label>
                <Input
                  id="create-telegram_id_2"
                  value={formData.telegram_id_2 || ''}
                  onChange={(e) => updateField('telegram_id_2', e.target.value)}
                  placeholder="123456789"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="create-telegram_id_3">Telegram ID #3</Label>
                <Input
                  id="create-telegram_id_3"
                  value={formData.telegram_id_3 || ''}
                  onChange={(e) => updateField('telegram_id_3', e.target.value)}
                  placeholder="123456789"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="create-telegram_id_4">Telegram ID #4</Label>
                <Input
                  id="create-telegram_id_4"
                  value={formData.telegram_id_4 || ''}
                  onChange={(e) => updateField('telegram_id_4', e.target.value)}
                  placeholder="123456789"
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="ai" className="space-y-4 mt-4">
            <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
              <Key className="h-4 w-4" />
              <span>API ключи и промпты для AI</span>
            </div>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="create-openai_api_key">OpenAI API Key</Label>
                <Input
                  id="create-openai_api_key"
                  type="password"
                  value={formData.openai_api_key || ''}
                  onChange={(e) => updateField('openai_api_key', e.target.value)}
                  placeholder="sk-..."
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="create-gemini_api_key">Gemini API Key</Label>
                <Input
                  id="create-gemini_api_key"
                  type="password"
                  value={formData.gemini_api_key || ''}
                  onChange={(e) => updateField('gemini_api_key', e.target.value)}
                  placeholder="AI..."
                />
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Отмена
          </Button>
          <Button onClick={handleCreate} disabled={isSubmitting || !formData.name?.trim()}>
            {isSubmitting ? 'Создание...' : 'Создать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CreateAdAccountDialog;
