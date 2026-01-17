import React, { useState, useEffect } from 'react';
import { useAppContext } from '@/context/AppContext';
import { adAccountsApi } from '@/services/adAccountsApi';
import type { AdAccount, CreateAdAccountPayload, UpdateAdAccountPayload } from '@/types/adAccount';
import { BRAIN_MODE_LABELS, BRAIN_MODE_DESCRIPTIONS, BRAIN_TIMEZONES } from '@/types/adAccount';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import {
  Plus,
  Trash2,
  CheckCircle,
  AlertCircle,
  Clock,
  Settings,
  Facebook,
  MessageSquare,
  Key,
  Building2,
  Brain,
  ExternalLink,
  Unlink,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// TikTok icon SVG component
const TikTokIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/>
  </svg>
);

interface AdAccountsManagerProps {
  className?: string;
}

export function AdAccountsManager({ className }: AdAccountsManagerProps) {
  const { multiAccountEnabled, loadAdAccounts, currentAdAccountId, setCurrentAdAccountId } = useAppContext();

  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAccount, setSelectedAccount] = useState<AdAccount | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [accountToDelete, setAccountToDelete] = useState<AdAccount | null>(null);

  // Form state (extended with brain fields and TikTok)
  const [formData, setFormData] = useState<Partial<CreateAdAccountPayload> & {
    brain_mode?: 'autopilot' | 'report' | 'semi_auto';
    brain_schedule_hour?: number;
    brain_timezone?: string;
    autopilot_tiktok?: boolean;
    tiktok_account_id?: string;
    tiktok_business_id?: string;
    tiktok_access_token?: string;
  }>({
    name: '',
    username: '',
    fb_ad_account_id: '',
    fb_page_id: '',
    fb_instagram_id: '',
    fb_instagram_username: '',
    ig_seed_audience_id: '',
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
    brain_mode: 'report',
    brain_schedule_hour: 8,
    brain_timezone: 'Asia/Almaty',
    autopilot_tiktok: false,
  });

  // Load accounts
  useEffect(() => {
    loadAccountsList();
  }, []);

  const loadAccountsList = async () => {
    setLoading(true);
    try {
      const storedUser = localStorage.getItem('user');
      if (!storedUser) return;
      const userData = JSON.parse(storedUser);

      const response = await adAccountsApi.list(userData.id);
      setAccounts(response.ad_accounts);
    } catch (error) {
      console.error('Error loading accounts:', error);
      toast.error('Не удалось загрузить аккаунты');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    try {
      const storedUser = localStorage.getItem('user');
      if (!storedUser) return;
      const userData = JSON.parse(storedUser);

      const result = await adAccountsApi.create({
        userAccountId: userData.id,
        name: formData.name || 'Новый аккаунт',
        ...formData,
      });

      if (result.success) {
        toast.success('Аккаунт создан');
        setIsCreateOpen(false);
        resetForm();
        loadAccountsList();
        loadAdAccounts();
      } else {
        toast.error(result.error || 'Ошибка создания');
      }
    } catch (error) {
      toast.error('Ошибка создания аккаунта');
    }
  };

  const handleUpdate = async () => {
    if (!selectedAccount) return;

    try {
      const result = await adAccountsApi.update(selectedAccount.id, formData as UpdateAdAccountPayload);

      if (result.success) {
        toast.success('Аккаунт обновлён');
        setIsEditOpen(false);
        setSelectedAccount(null);
        resetForm();
        loadAccountsList();
        loadAdAccounts();
      } else {
        toast.error(result.error || 'Ошибка обновления');
      }
    } catch (error) {
      toast.error('Ошибка обновления аккаунта');
    }
  };

  const handleDelete = async () => {
    if (!accountToDelete) return;

    try {
      const result = await adAccountsApi.delete(accountToDelete.id);

      if (result.success) {
        toast.success('Аккаунт удалён');
        setIsDeleteOpen(false);
        setAccountToDelete(null);
        loadAccountsList();
        loadAdAccounts();
      } else {
        toast.error(result.error || 'Ошибка удаления');
      }
    } catch (error) {
      toast.error('Ошибка удаления аккаунта');
    }
  };

  const handleToggleActive = async (accountId: string, isActive: boolean) => {
    try {
      const result = await adAccountsApi.update(accountId, { is_active: isActive });

      if (result.success) {
        toast.success(isActive ? 'Аккаунт активирован' : 'Аккаунт деактивирован');
        loadAccountsList();
        loadAdAccounts();
      } else {
        toast.error(result.error || 'Ошибка');
      }
    } catch (error) {
      toast.error('Ошибка изменения статуса аккаунта');
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      username: '',
      fb_ad_account_id: '',
      fb_page_id: '',
      fb_instagram_id: '',
      fb_instagram_username: '',
      ig_seed_audience_id: '',
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
      brain_mode: 'report',
      brain_schedule_hour: 8,
      brain_timezone: 'Asia/Almaty',
      autopilot_tiktok: false,
    });
  };

  const openEditDialog = (account: AdAccount) => {
    setSelectedAccount(account);
    setFormData({
      name: account.name,
      username: account.username || '',
      fb_ad_account_id: account.fb_ad_account_id || '',
      fb_page_id: account.fb_page_id || '',
      fb_instagram_id: account.fb_instagram_id || '',
      fb_instagram_username: account.fb_instagram_username || '',
      ig_seed_audience_id: account.ig_seed_audience_id || '',
      telegram_id: account.telegram_id || '',
      telegram_id_2: account.telegram_id_2 || '',
      telegram_id_3: account.telegram_id_3 || '',
      telegram_id_4: account.telegram_id_4 || '',
      prompt1: account.prompt1 || '',
      prompt2: account.prompt2 || '',
      prompt3: account.prompt3 || '',
      prompt4: account.prompt4 || '',
      openai_api_key: account.openai_api_key || '',
      gemini_api_key: account.gemini_api_key || '',
      brain_mode: account.brain_mode || 'report',
      brain_schedule_hour: account.brain_schedule_hour ?? 8,
      brain_timezone: account.brain_timezone || 'Asia/Almaty',
      autopilot_tiktok: account.autopilot_tiktok ?? false,
      tiktok_account_id: account.tiktok_account_id || '',
      tiktok_business_id: account.tiktok_business_id || '',
      tiktok_access_token: account.tiktok_access_token || '',
    });
    setIsEditOpen(true);
  };

  if (!multiAccountEnabled) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Рекламные аккаунты
          </CardTitle>
          <CardDescription>
            Мультиаккаунтность не включена для вашего профиля.
            Обратитесь к администратору для подключения.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const STATUS_CONFIG = {
    connected: { icon: CheckCircle, color: 'text-green-500', label: 'Подключён' },
    pending: { icon: Clock, color: 'text-yellow-500', label: 'Ожидает' },
    error: { icon: AlertCircle, color: 'text-red-500', label: 'Ошибка' },
  };

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Рекламные аккаунты
            </CardTitle>
            <CardDescription>
              Управление рекламными аккаунтами (до 10 аккаунтов)
            </CardDescription>
          </div>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={accounts.length >= 10}
                onClick={() => {
                  resetForm();
                  setIsCreateOpen(true);
                }}
              >
                <Plus className="h-4 w-4 mr-2" />
                Добавить
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Новый рекламный аккаунт</DialogTitle>
                <DialogDescription>
                  Заполните данные нового рекламного аккаунта
                </DialogDescription>
              </DialogHeader>
              <AccountForm formData={formData} setFormData={setFormData} selectedAccountId={undefined} />
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                  Отмена
                </Button>
                <Button onClick={handleCreate}>Создать</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">Загрузка...</div>
        ) : accounts.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            Нет рекламных аккаунтов. Создайте первый аккаунт.
          </div>
        ) : (
          <div className="space-y-3">
            {accounts.map((account) => {
              // Автоматически вычисляем connection_status на основе полей
              const hasAllFbFields = !!(
                account.fb_page_id &&
                account.fb_instagram_id &&
                account.fb_access_token &&
                account.fb_ad_account_id
              );
              const hasTikTokFields = !!(
                account.tiktok_access_token &&
                account.tiktok_business_id
              );
              const computedStatus = hasAllFbFields ? 'connected' : (account.connection_status || 'pending');
              const status = STATUS_CONFIG[computedStatus] || STATUS_CONFIG.pending;
              const StatusIcon = status.icon;

              const isSelected = currentAdAccountId === account.id;

              return (
                <div
                  key={account.id}
                  className={cn(
                    "flex items-center justify-between p-4 border rounded-lg transition-colors cursor-pointer",
                    isSelected
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : account.is_active
                        ? "hover:bg-muted/50"
                        : "opacity-50 bg-muted/30"
                  )}
                  onClick={() => account.is_active && setCurrentAdAccountId(account.id)}
                >
                  <div className="flex items-center gap-3">
                    <StatusIcon className={cn('h-5 w-5', status.color)} />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={cn("font-medium", !account.is_active && "line-through")}>{account.name}</span>
                        {isSelected && (
                          <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full">
                            Выбран
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Facebook className="h-3 w-3" />
                          {hasAllFbFields ? (
                            <span className="text-green-600">{account.fb_ad_account_id}</span>
                          ) : (
                            <span className="text-yellow-600">не настроен</span>
                          )}
                        </span>
                        <span className="flex items-center gap-1">
                          <TikTokIcon className="h-3 w-3" />
                          {hasTikTokFields ? (
                            <span className="text-green-600">подключён</span>
                          ) : (
                            <span className="text-muted-foreground">не настроен</span>
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                    <Switch
                      checked={account.is_active}
                      onCheckedChange={(checked) => handleToggleActive(account.id, checked)}
                      title={account.is_active ? 'Деактивировать аккаунт' : 'Активировать аккаунт'}
                    />
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditDialog(account)}
                      >
                        <Settings className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setAccountToDelete(account);
                          setIsDeleteOpen(true);
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {/* Edit Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Редактирование аккаунта</DialogTitle>
            <DialogDescription>
              {selectedAccount?.name}
            </DialogDescription>
          </DialogHeader>
          <AccountForm formData={formData} setFormData={setFormData} selectedAccountId={selectedAccount?.id} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>
              Отмена
            </Button>
            <Button onClick={handleUpdate}>Сохранить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Alert */}
      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить аккаунт?</AlertDialogTitle>
            <AlertDialogDescription>
              Вы уверены, что хотите удалить аккаунт "{accountToDelete?.name}"?
              Это действие нельзя отменить. Все связанные данные (направления, лиды, креативы)
              будут отвязаны от этого аккаунта.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-500 hover:bg-red-600">
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// Form component
interface AccountFormProps {
  formData: Partial<CreateAdAccountPayload> & {
    brain_mode?: 'autopilot' | 'report' | 'semi_auto';
    brain_schedule_hour?: number;
    brain_timezone?: string;
    autopilot_tiktok?: boolean;
    tiktok_account_id?: string;
    tiktok_business_id?: string;
    tiktok_access_token?: string;
  };
  setFormData: React.Dispatch<React.SetStateAction<Partial<CreateAdAccountPayload> & {
    brain_mode?: 'autopilot' | 'report' | 'semi_auto';
    brain_schedule_hour?: number;
    brain_timezone?: string;
    autopilot_tiktok?: boolean;
    tiktok_account_id?: string;
    tiktok_business_id?: string;
    tiktok_access_token?: string;
  }>>;
  selectedAccountId?: string;
}

function AccountForm({ formData, setFormData, selectedAccountId }: AccountFormProps) {
  const updateField = (field: string, value: string | number | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const isTikTokConnected = Boolean(formData.tiktok_access_token && formData.tiktok_business_id);

  const handleConnectTikTok = (accountId: string | undefined) => {
    try {
      // Явная проверка accountId - это обязательный параметр для multi-account режима
      if (!accountId) {
        console.error('[TikTok OAuth] accountId is required but not provided');
        toast.error('Ошибка: аккаунт не выбран. Сначала сохраните аккаунт.');
        return;
      }

      // Собираем state для OAuth callback
      const storedUser = localStorage.getItem('user');
      if (!storedUser) {
        console.error('[TikTok OAuth] User not found in localStorage');
        toast.error('Пользователь не найден. Пожалуйста, войдите в систему заново.');
        return;
      }

      let userData;
      try {
        userData = JSON.parse(storedUser);
      } catch (parseError) {
        console.error('[TikTok OAuth] Failed to parse user data:', parseError);
        toast.error('Ошибка данных пользователя. Пожалуйста, войдите заново.');
        return;
      }

      if (!userData?.id) {
        console.error('[TikTok OAuth] User ID not found in user data');
        toast.error('ID пользователя не найден');
        return;
      }

      // accountId гарантированно строка здесь
      const statePayload = {
        user_id: userData.id,
        ad_account_id: accountId, // Явно передаём accountId для multi-account режима
        ts: Date.now(),
      };

      console.log('[TikTok OAuth] Initiating OAuth flow', {
        userId: userData.id,
        adAccountId: accountId,
        timestamp: statePayload.ts,
      });

      const state = btoa(JSON.stringify(statePayload));
      const appId = import.meta.env.VITE_TIKTOK_APP_ID || '7457939636746919942';
      const redirectUri = encodeURIComponent(`${window.location.origin}/oauth/tiktok/callback`);

      const authUrl = `https://business-api.tiktok.com/portal/auth?app_id=${appId}&state=${state}&redirect_uri=${redirectUri}`;

      console.log('[TikTok OAuth] Redirecting to TikTok auth', { authUrl: authUrl.substring(0, 100) + '...' });
      window.location.href = authUrl;
    } catch (error) {
      console.error('[TikTok OAuth] Unexpected error:', error);
      toast.error('Произошла ошибка при подключении TikTok');
    }
  };

  const handleDisconnectTikTok = () => {
    console.log('[TikTok] Disconnecting TikTok account', {
      adAccountId: selectedAccountId || 'legacy mode',
      hadBusinessId: !!formData.tiktok_business_id,
    });

    setFormData(prev => ({
      ...prev,
      tiktok_access_token: '',
      tiktok_business_id: '',
      tiktok_account_id: '',
    }));
    toast.success('TikTok отключён. Сохраните изменения.');
  };

  return (
    <Tabs defaultValue="basic" className="w-full">
      <TabsList className="grid w-full grid-cols-6">
        <TabsTrigger value="basic">Основное</TabsTrigger>
        <TabsTrigger value="facebook">Facebook</TabsTrigger>
        <TabsTrigger value="tiktok">TikTok</TabsTrigger>
        <TabsTrigger value="notifications">Уведомления</TabsTrigger>
        <TabsTrigger value="brain">Оптимизация</TabsTrigger>
        <TabsTrigger value="ai">AI</TabsTrigger>
      </TabsList>

      <TabsContent value="basic" className="space-y-4 mt-4">
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="name">Название аккаунта *</Label>
            <Input
              id="name"
              value={formData.name || ''}
              onChange={(e) => updateField('name', e.target.value)}
              placeholder="Мой бизнес"
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
            <Label htmlFor="fb_ad_account_id">Ad Account ID</Label>
            <Input
              id="fb_ad_account_id"
              value={formData.fb_ad_account_id || ''}
              onChange={(e) => updateField('fb_ad_account_id', e.target.value)}
              placeholder="act_123456789"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="fb_page_id">Page ID</Label>
            <Input
              id="fb_page_id"
              value={formData.fb_page_id || ''}
              onChange={(e) => updateField('fb_page_id', e.target.value)}
              placeholder="123456789"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="fb_instagram_id">Instagram Account ID</Label>
            <Input
              id="fb_instagram_id"
              value={formData.fb_instagram_id || ''}
              onChange={(e) => updateField('fb_instagram_id', e.target.value)}
              placeholder="17841..."
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="fb_instagram_username">Instagram Username</Label>
            <Input
              id="fb_instagram_username"
              value={formData.fb_instagram_username || ''}
              onChange={(e) => updateField('fb_instagram_username', e.target.value)}
              placeholder="@username"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ig_seed_audience_id">Custom Audience ID</Label>
            <Input
              id="ig_seed_audience_id"
              value={formData.ig_seed_audience_id || ''}
              onChange={(e) => updateField('ig_seed_audience_id', e.target.value)}
              placeholder="23851234567890123"
            />
            <p className="text-xs text-muted-foreground">
              ID аудитории для дублирования кампаний
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-4">
          * Access Token заполняется администратором
        </p>
      </TabsContent>

      <TabsContent value="tiktok" className="space-y-4 mt-4">
        <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
          <TikTokIcon className="h-4 w-4" />
          <span>Подключение TikTok Business</span>
        </div>

        {isTikTokConnected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg">
              <CheckCircle className="h-5 w-5 text-green-500" />
              <span className="text-green-700 dark:text-green-300 font-medium">TikTok подключён</span>
            </div>

            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Advertiser ID</Label>
                <Input
                  value={formData.tiktok_business_id || ''}
                  disabled
                  className="bg-muted"
                />
              </div>
              {formData.tiktok_account_id && (
                <div className="grid gap-2">
                  <Label>Account ID</Label>
                  <Input
                    value={formData.tiktok_account_id || ''}
                    disabled
                    className="bg-muted"
                  />
                </div>
              )}
            </div>

            <Button
              variant="outline"
              className="text-red-500 border-red-200 hover:bg-red-50"
              onClick={handleDisconnectTikTok}
            >
              <Unlink className="h-4 w-4 mr-2" />
              Отключить TikTok
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 p-3 bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded-lg">
              <AlertCircle className="h-5 w-5 text-yellow-500" />
              <span className="text-yellow-700 dark:text-yellow-300">TikTok не подключён</span>
            </div>

            {selectedAccountId ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Подключите TikTok Business аккаунт для запуска рекламы на TikTok.
                  После авторизации credentials будут сохранены для этого аккаунта.
                </p>

                <Button onClick={() => handleConnectTikTok(selectedAccountId)}>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Подключить TikTok
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Сначала сохраните аккаунт, затем подключите TikTok в настройках.
              </p>
            )}
          </div>
        )}

        <p className="text-xs text-muted-foreground mt-4">
          * После подключения будет получен Access Token через OAuth авторизацию
        </p>
      </TabsContent>

      <TabsContent value="notifications" className="space-y-4 mt-4">
        <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
          <MessageSquare className="h-4 w-4" />
          <span>Telegram ID для уведомлений</span>
        </div>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="telegram_id">Telegram ID #1</Label>
            <Input
              id="telegram_id"
              value={formData.telegram_id || ''}
              onChange={(e) => updateField('telegram_id', e.target.value)}
              placeholder="123456789"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="telegram_id_2">Telegram ID #2</Label>
            <Input
              id="telegram_id_2"
              value={formData.telegram_id_2 || ''}
              onChange={(e) => updateField('telegram_id_2', e.target.value)}
              placeholder="123456789"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="telegram_id_3">Telegram ID #3</Label>
            <Input
              id="telegram_id_3"
              value={formData.telegram_id_3 || ''}
              onChange={(e) => updateField('telegram_id_3', e.target.value)}
              placeholder="123456789"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="telegram_id_4">Telegram ID #4</Label>
            <Input
              id="telegram_id_4"
              value={formData.telegram_id_4 || ''}
              onChange={(e) => updateField('telegram_id_4', e.target.value)}
              placeholder="123456789"
            />
          </div>
        </div>
      </TabsContent>

      <TabsContent value="brain" className="space-y-4 mt-4">
        <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
          <Brain className="h-4 w-4" />
          <span>Настройки AI-оптимизации Brain</span>
        </div>
        <div className="grid gap-4">
          {/* Режим оптимизации */}
          <div className="grid gap-2">
            <Label>Режим оптимизации</Label>
            <Select
              value={formData.brain_mode || 'report'}
              onValueChange={(value) => updateField('brain_mode', value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(BRAIN_MODE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    <div>
                      <div>{label}</div>
                      <div className="text-xs text-muted-foreground">
                        {BRAIN_MODE_DESCRIPTIONS[value]}
                      </div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Время запуска */}
          <div className="grid gap-2">
            <Label>Время ежедневного запуска</Label>
            <Select
              value={String(formData.brain_schedule_hour ?? 8)}
              onValueChange={(value) => updateField('brain_schedule_hour', parseInt(value))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 24 }, (_, i) => (
                  <SelectItem key={i} value={String(i)}>
                    {String(i).padStart(2, '0')}:00
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>Часовой пояс</Label>
            <Select
              value={formData.brain_timezone || 'Asia/Almaty'}
              onValueChange={(value) => updateField('brain_timezone', value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BRAIN_TIMEZONES.map((tz) => (
                  <SelectItem key={tz.value} value={tz.value}>
                    {tz.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* TikTok Autopilot */}
          <div className="border-t pt-4 mt-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="flex items-center gap-2">
                  <TikTokIcon className="h-4 w-4" />
                  TikTok Autopilot
                </Label>
                <p className="text-xs text-muted-foreground">
                  Включить автоматическую оптимизацию для TikTok кампаний
                </p>
              </div>
              <Switch
                checked={formData.autopilot_tiktok ?? false}
                onCheckedChange={(checked) => updateField('autopilot_tiktok', checked)}
              />
            </div>
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
            <Label htmlFor="openai_api_key">OpenAI API Key</Label>
            <Input
              id="openai_api_key"
              type="password"
              value={formData.openai_api_key || ''}
              onChange={(e) => updateField('openai_api_key', e.target.value)}
              placeholder="sk-..."
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="gemini_api_key">Gemini API Key</Label>
            <Input
              id="gemini_api_key"
              type="password"
              value={formData.gemini_api_key || ''}
              onChange={(e) => updateField('gemini_api_key', e.target.value)}
              placeholder="AIza..."
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="prompt1">Контекст бизнеса (для текстов)</Label>
            <Textarea
              id="prompt1"
              value={formData.prompt1 || ''}
              onChange={(e) => updateField('prompt1', e.target.value)}
              placeholder="Описание бизнеса, целевой аудитории, болей клиентов, конкурентных преимуществ..."
              rows={4}
            />
            <p className="text-xs text-muted-foreground">
              Используется для генерации текстов объявлений и каруселей
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="prompt4">Бриф для генерации изображений</Label>
            <Textarea
              id="prompt4"
              value={formData.prompt4 || ''}
              onChange={(e) => updateField('prompt4', e.target.value)}
              placeholder="Описание стилей визуализации, цветовой палитры, примеры идей для креативов..."
              rows={4}
            />
            <p className="text-xs text-muted-foreground">
              Используется для генерации рекламных изображений (Gemini, DALL-E)
            </p>
          </div>
        </div>
      </TabsContent>
    </Tabs>
  );
}

export default AdAccountsManager;
