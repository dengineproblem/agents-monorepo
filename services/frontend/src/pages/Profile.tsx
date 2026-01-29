import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '@/components/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Instagram, User, Lock, CheckCircle2, CircleDashed, CalendarDays, Eye, EyeOff, MessageCircle, DollarSign, Plus, X, Key, Users, Edit } from 'lucide-react';
import { toast } from 'sonner';
import { toastT } from '@/utils/toastUtils';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import TariffInfoCard from '@/components/profile/TariffInfoCard';
import PageHero from '@/components/common/PageHero';
import ConnectionsGrid from '@/components/profile/ConnectionsGrid';
import DirectionsCard from '@/components/profile/DirectionsCard';
import { WhatsAppConnectionCard } from '@/components/profile/WhatsAppConnectionCard';
import { TildaConnectionCard, TildaInstructionsDialog } from '@/components/profile/TildaConnectionCard';
// TEMPORARILY HIDDEN: import { AmoCRMKeyStageSettings } from '@/components/amocrm/AmoCRMKeyStageSettings';
// REMOVED: Old qualification field modals - now configured at direction level via CAPI settings
// import { AmoCRMQualificationFieldModal } from '@/components/amocrm/AmoCRMQualificationFieldModal';
// import { Bitrix24QualificationFieldModal } from '@/components/bitrix24/Bitrix24QualificationFieldModal';
import {
  getBitrix24Status,
  disconnectBitrix24,
  openBitrix24ConnectWindow,
  onBitrix24Connected,
  syncBitrix24Leads,
  syncBitrix24Pipelines,
  getBitrix24Pipelines,
  getBitrix24AutoCreateSetting,
  setBitrix24AutoCreateSetting,
  getBitrix24DefaultStage,
  setBitrix24DefaultStage,
  type Bitrix24Status,
  type Bitrix24Pipelines,
} from '@/services/bitrix24Api';
import { FEATURES, APP_REVIEW_MODE } from '../config/appReview';
import { useTranslation } from '../i18n/LanguageContext';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { TooltipKeys } from '@/content/tooltips';
import { appReviewText } from '../utils/appReviewText';
import { API_BASE_URL } from '@/config/api';
import { FacebookManualConnectModal } from '@/components/profile/FacebookManualConnectModal';
import { AdAccountsManager } from '@/components/ad-accounts/AdAccountsManager';
import { useAppContext } from '@/context/AppContext';


type Tarif = 'ai_target' | 'target' | 'ai_manager' | 'complex' | null;

const tarifName: Record<Exclude<Tarif, null>, string> = {
  ai_target: 'AI Target',
  target: 'Target',
  ai_manager: 'AI Manager',
  complex: 'Complex',
};

const tarifColor: Record<Exclude<Tarif, null>, string> = {
  ai_target: 'bg-blue-100 text-blue-700',
  target: 'bg-emerald-100 text-emerald-700',
  ai_manager: 'bg-violet-100 text-violet-700',
  complex: 'bg-amber-100 text-amber-700',
};

const Profile: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { currentAdAccountId, multiAccountEnabled, adAccounts: contextAdAccounts } = useAppContext();
  const storedUser = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
  const user = storedUser ? (() => { try { return JSON.parse(storedUser); } catch { return null; } })() : null;
  const isLoading = !storedUser;

  // Проверка валидности данных пользователя
  useEffect(() => {
    if (storedUser && user && !user.username) {

      localStorage.removeItem('user');
      toastT.error('loginRequired');
      navigate('/login', { replace: true });
    }
  }, []);

  const [tarif, setTarif] = useState<Tarif>(null);
  const [tarifExpires, setTarifExpires] = useState<string | null>(null);
  const [passwordModal, setPasswordModal] = useState(false);
  const [telegramIdModal, setTelegramIdModal] = useState(false);
  const [usernameModal, setUsernameModal] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [isSavingUsername, setIsSavingUsername] = useState(false);
  
  // Facebook selection modal
  const [facebookSelectionModal, setFacebookSelectionModal] = useState(false);
  const [facebookData, setFacebookData] = useState<any>(null);
  const [selectedAdAccount, setSelectedAdAccount] = useState<string>('');
  const [selectedPage, setSelectedPage] = useState<string>('');
  const [searchAdAccount, setSearchAdAccount] = useState<string>('');
  const [searchPage, setSearchPage] = useState<string>('');

  const isAppReviewMode = APP_REVIEW_MODE;
  const adAccounts = facebookData?.ad_accounts ?? [];
  const pages = facebookData?.pages ?? [];

  const filteredAdAccounts = useMemo(() => {
    const trimmedSearch = searchAdAccount.trim();
    const query = trimmedSearch.toLowerCase();

    if (!query) {
      return adAccounts;
    }

    return adAccounts.filter((account: any) =>
      account.name.toLowerCase().includes(query) || account.id.includes(trimmedSearch)
    );
  }, [adAccounts, searchAdAccount]);

  const filteredPages = useMemo(() => {
    const trimmedSearch = searchPage.trim();
    const query = trimmedSearch.toLowerCase();

    if (!query) {
      return pages;
    }

    return pages.filter((page: any) =>
      page.name.toLowerCase().includes(query) || page.id.includes(trimmedSearch)
    );
  }, [pages, searchPage]);

  const selectedPageData = useMemo(
    () => pages.find((page: any) => page.id === selectedPage) ?? null,
    [pages, selectedPage]
  );
  
  // Смена пароля
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showOldPassword, setShowOldPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  
  // Telegram ID (до 4 ID)
  const [telegramIds, setTelegramIds] = useState<(string | null)[]>(['', null, null, null]);
  const [editingTelegramIndex, setEditingTelegramIndex] = useState<number | null>(null);
  const [newTelegramId, setNewTelegramId] = useState('');
  const [isSavingTelegramId, setIsSavingTelegramId] = useState(false);
  
  // Настройки бюджета (хранятся в центах в БД, отображаются в долларах)
  const [maxBudgetCents, setMaxBudgetCents] = useState<number | null>(null);
  const [plannedCplCents, setPlannedCplCents] = useState<number | null>(null);
  const [maxBudgetModal, setMaxBudgetModal] = useState(false);
  const [plannedCplModal, setPlannedCplModal] = useState(false);
  const [newMaxBudget, setNewMaxBudget] = useState('');
  const [newPlannedCpl, setNewPlannedCpl] = useState('');
  const [isSavingMaxBudget, setIsSavingMaxBudget] = useState(false);
  const [isSavingPlannedCpl, setIsSavingPlannedCpl] = useState(false);
  
  // OpenAI API Key
  const [openaiApiKey, setOpenaiApiKey] = useState<string>('');
  const [openaiModal, setOpenaiModal] = useState(false);
  const [newOpenaiKey, setNewOpenaiKey] = useState('');
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);
  const [isSavingOpenaiKey, setIsSavingOpenaiKey] = useState(false);
  
  // Audience ID (ig_seed_audience_id)
  const [audienceId, setAudienceId] = useState<string>('');
  const [audienceModal, setAudienceModal] = useState(false);
  const [newAudienceId, setNewAudienceId] = useState('');
  const [isSavingAudienceId, setIsSavingAudienceId] = useState(false);

  // AmoCRM Integration
  const [amocrmConnected, setAmocrmConnected] = useState(false);
  const [amocrmSubdomain, setAmocrmSubdomain] = useState('');
  const [amocrmWebhookActive, setAmocrmWebhookActive] = useState(false);
  const [amocrmModal, setAmocrmModal] = useState(false);
  const [amocrmConnectModal, setAmocrmConnectModal] = useState(false);
  const [amocrmInputSubdomain, setAmocrmInputSubdomain] = useState('');
  const [isSyncingAmocrm, setIsSyncingAmocrm] = useState(false);
  const [amocrmKeyStagesModal, setAmocrmKeyStagesModal] = useState(false);
  // REMOVED: Qualification now configured at direction level via CAPI settings
  // const [amocrmQualificationModal, setAmocrmQualificationModal] = useState(false);
  // const [amocrmQualificationFieldName, setAmocrmQualificationFieldName] = useState<string | null>(null);

  // Bitrix24 Integration
  const [bitrix24Connected, setBitrix24Connected] = useState(false);
  const [bitrix24Domain, setBitrix24Domain] = useState('');
  const [bitrix24EntityType, setBitrix24EntityType] = useState<'lead' | 'deal' | 'both'>('lead');
  const [bitrix24Modal, setBitrix24Modal] = useState(false);
  // REMOVED: Qualification now configured at direction level via CAPI settings
  // const [bitrix24QualificationModal, setBitrix24QualificationModal] = useState(false);
  const [isSyncingBitrix24, setIsSyncingBitrix24] = useState(false);
  const [bitrix24AutoCreate, setBitrix24AutoCreate] = useState(false);
  const [loadingAutoCreate, setLoadingAutoCreate] = useState(false);
  const [bitrix24Pipelines, setBitrix24Pipelines] = useState<Bitrix24Pipelines | null>(null);
  const [loadingPipelines, setLoadingPipelines] = useState(false);
  const [defaultLeadStatus, setDefaultLeadStatus] = useState<string | null>(null);
  const [defaultDealCategory, setDefaultDealCategory] = useState<number | null>(null);
  const [defaultDealStage, setDefaultDealStage] = useState<string | null>(null);

  // Facebook Manual Connect Modal
  const [facebookManualModal, setFacebookManualModal] = useState(false);

  // Tilda Instructions Modal
  const [tildaInstructionsModal, setTildaInstructionsModal] = useState(false);
  const [tildaConnected, setTildaConnected] = useState(false);

  // Handle Facebook OAuth callback
  useEffect(() => {
    const handleFacebookCallback = async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const error = params.get('error');

      if (error) {

        toast.error(appReviewText(`Facebook connection failed: ${error}`, `Не удалось подключиться к Facebook: ${error}`));
        window.history.replaceState({}, document.title, '/profile');
        return;
      }

      if (code) {
        try {
          // Проверка наличия username

          if (!user?.username) {
            toastT.error('loginRequired');

            window.history.replaceState({}, document.title, '/profile');
            return;
          }

          toastT.info('facebookConnecting');

          const API_URL = 'https://performanteaiagency.com/api';
          const requestBody = { 
            code,
            username: user.username
          };

          const response = await fetch(`${API_URL}/facebook/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
          });

          const data = await response.json();

          if (!response.ok || !data.success) {
            throw new Error(data.error || 'Failed to connect Facebook');
          }

          // Сохраняем данные для выбора и показываем модальное окно
          setFacebookData(data);
          setSelectedAdAccount(data.ad_accounts[0]?.id || '');
          setSelectedPage(data.pages[0]?.id || '');

          setFacebookSelectionModal(true);

          // Clear URL params
          window.history.replaceState({}, document.title, '/profile');

        } catch (error) {

          toast.error(
            error instanceof Error
              ? error.message
              : appReviewText('Failed to connect Facebook', 'Не удалось подключиться к Facebook')
          );
          window.history.replaceState({}, document.title, '/profile');
        }
      }
    };

    handleFacebookCallback();
  }, []);

  useEffect(() => {
    const loadUserData = async () => {
      if (!user?.id) return;

      try {
        // Загружаем актуальные данные из Supabase
        const { data, error } = await (supabase
          .from('user_accounts')
          .select('tarif, tarif_expires, telegram_id, telegram_id_2, telegram_id_3, telegram_id_4, access_token, page_id, tiktok_access_token, tiktok_business_id, plan_daily_budget_cents, default_cpl_target_cents, openai_api_key, ig_seed_audience_id, tilda_utm_field')
          .eq('id', user.id)
          .single() as any);

        if (error) {

          // Используем данные из localStorage как fallback
          setTarif((user.tarif as Tarif) ?? null);
          setTarifExpires(user.tarif_expires ?? null);
          setTelegramIds([
            user.telegram_id || '',
            (user as any).telegram_id_2 || null,
            (user as any).telegram_id_3 || null,
            (user as any).telegram_id_4 || null
          ]);
          setMaxBudgetCents((user as any).plan_daily_budget_cents ?? null);
          setPlannedCplCents((user as any).default_cpl_target_cents ?? null);
          return;
        }

        if (data) {
          setTarif((data.tarif as Tarif) ?? null);
          setTarifExpires(data.tarif_expires ?? null);
          setTelegramIds([
            data.telegram_id || '',
            data.telegram_id_2 || null,
            data.telegram_id_3 || null,
            data.telegram_id_4 || null
          ]);
          setMaxBudgetCents(data.plan_daily_budget_cents ?? null);
          setPlannedCplCents(data.default_cpl_target_cents ?? null);
          setOpenaiApiKey(data.openai_api_key || '');
          setAudienceId(data.ig_seed_audience_id || '');
          setTildaConnected(Boolean(data.tilda_utm_field));

          // Обновляем localStorage актуальными данными
          const updatedUser = { ...user, ...data };
          localStorage.setItem('user', JSON.stringify(updatedUser));
        }
      } catch (error) {

        // Используем данные из localStorage как fallback
      setTarif((user.tarif as Tarif) ?? null);
      setTarifExpires(user.tarif_expires ?? null);
        setTelegramIds([
          user.telegram_id || '',
          (user as any).telegram_id_2 || null,
          (user as any).telegram_id_3 || null,
          (user as any).telegram_id_4 || null
        ]);
        setMaxBudgetCents((user as any).plan_daily_budget_cents ?? null);
        setPlannedCplCents((user as any).default_cpl_target_cents ?? null);
      }
    };

    loadUserData();
  }, [user?.id]);

  // Load AmoCRM status
  useEffect(() => {
    const loadAmoCRMStatus = async () => {
      if (!user?.id) return;

      try {
        const response = await fetch(`${API_BASE_URL}/amocrm/status?userAccountId=${user.id}`);
        if (!response.ok) {

          return;
        }

        const data = await response.json();

        setAmocrmConnected(data.connected);
        setAmocrmSubdomain(data.subdomain || '');

        if (data.connected) {
          // Check webhook status
          try {
            const webhookRes = await fetch(`${API_BASE_URL}/amocrm/webhook-status?userAccountId=${user.id}`);
            if (webhookRes.ok) {
              const webhookData = await webhookRes.json();

              setAmocrmWebhookActive(webhookData.registered);
            }
          } catch (error) {

          }

          // REMOVED: Qualification now configured at direction level via CAPI settings
        }
      } catch (error) {

      }
    };

    loadAmoCRMStatus();
  }, [user?.id]);

  // Load Bitrix24 status
  useEffect(() => {
    const loadBitrix24Status = async () => {
      if (!user?.id) return;

      try {
        // In multi-account mode, pass accountId to check correct table
        const accountId = multiAccountEnabled ? currentAdAccountId : undefined;
        const status = await getBitrix24Status(user.id, accountId);

        setBitrix24Connected(status.connected);
        setBitrix24Domain(status.domain || '');
        setBitrix24EntityType(status.entityType || 'lead');
      } catch (error) {

      }
    };

    loadBitrix24Status();
  }, [user?.id, multiAccountEnabled, currentAdAccountId]);

  // Listen for Bitrix24 connection success
  useEffect(() => {
    if (!user?.id) return;

    const cleanup = onBitrix24Connected((data) => {

      setBitrix24Connected(true);
      setBitrix24Domain(data.domain);
      setBitrix24EntityType(data.entityType as 'lead' | 'deal' | 'both');
      // REMOVED: Qualification now configured at direction level via CAPI settings
    });

    return cleanup;
  }, [user?.id]);

  // REMOVED: AmoCRM qualification modal auto-open - now configured at direction level via CAPI settings

  const tarifBadge = useMemo(() => {
    if (!tarif) return null;
    const label = tarifName[tarif];
    const color = tarifColor[tarif];
    return <span className={`text-xs px-2 py-1 rounded ${color}`}>{label}</span>;
  }, [tarif]);

  const formattedExpiry = useMemo(() => {
    if (!tarifExpires) return t('profile.notSpecified');
    const d = new Date(tarifExpires);
    if (isNaN(d.getTime())) return t('profile.notSpecified');
    return format(d, 'dd.MM.yyyy');
  }, [tarifExpires, t]);

  const handlePasswordSave = async () => {
    // Валидация
    if (!oldPassword.trim()) {
      toast.error(appReviewText('Enter your current password', 'Введите текущий пароль'));
      return;
    }
    if (!newPassword.trim()) {
      toast.error(appReviewText('Enter a new password', 'Введите новый пароль'));
      return;
    }
    if (newPassword.length < 6) {
      toast.error(appReviewText('The new password must be at least 6 characters long', 'Новый пароль должен содержать минимум 6 символов'));
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(appReviewText('Passwords do not match', 'Пароли не совпадают'));
      return;
    }

    setIsChangingPassword(true);
    
    try {
      // Сначала проверяем старый пароль через signInWithPassword
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user?.email || '',
        password: oldPassword,
      });

      if (signInError) {
        toast.error(appReviewText('Incorrect current password', 'Неверный текущий пароль'));
        setIsChangingPassword(false);
        return;
      }

      // Если старый пароль верный, меняем на новый
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (updateError) {
        toast.error(appReviewText(`Failed to change password: ${updateError.message}`, 'Ошибка при смене пароля: ' + updateError.message));
        setIsChangingPassword(false);
        return;
      }

      toast.success(appReviewText('Password changed successfully', 'Пароль успешно изменен'));
    setPasswordModal(false);
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {

      toast.error(appReviewText('An error occurred while changing the password', 'Произошла ошибка при смене пароля'));
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleTelegramIdSave = async () => {
    if (!newTelegramId.trim() && editingTelegramIndex !== null && telegramIds[editingTelegramIndex]) {
      // Удаление ID
      const fieldNames = ['telegram_id', 'telegram_id_2', 'telegram_id_3', 'telegram_id_4'];
      const fieldName = fieldNames[editingTelegramIndex];
      
      setIsSavingTelegramId(true);

      try {
        const { error } = await supabase
          .from('user_accounts')
          .update({ [fieldName]: null } as any)
          .eq('id', user?.id);

        if (error) {
          toast.error(appReviewText(`Failed to remove Telegram ID: ${error.message}`, 'Ошибка при удалении Telegram ID: ' + error.message));
          return;
        }

        const updatedIds = [...telegramIds];
        updatedIds[editingTelegramIndex] = null;
        setTelegramIds(updatedIds);

        const updatedUser = { ...user, [fieldName]: null };
        localStorage.setItem('user', JSON.stringify(updatedUser));
        
        toast.success(appReviewText('Telegram ID removed successfully', 'Telegram ID успешно удален'));
        setTelegramIdModal(false);
      } catch (error) {

        toast.error(appReviewText('An error occurred while removing the Telegram ID', 'Произошла ошибка при удалении'));
      } finally {
        setIsSavingTelegramId(false);
      }
      return;
    }

    if (!newTelegramId.trim()) {
      toast.error(appReviewText('Enter a Telegram ID', 'Введите Telegram ID'));
      return;
    }

    if (editingTelegramIndex === null) return;

    const fieldNames = ['telegram_id', 'telegram_id_2', 'telegram_id_3', 'telegram_id_4'];
    const fieldName = fieldNames[editingTelegramIndex];

    setIsSavingTelegramId(true);

    try {
      const { error } = await supabase
        .from('user_accounts')
        .update({ [fieldName]: newTelegramId } as any)
        .eq('id', user?.id);

      if (error) {
        toast.error(appReviewText(`Failed to save Telegram ID: ${error.message}`, 'Ошибка при сохранении Telegram ID: ' + error.message));
        return;
      }

      const updatedIds = [...telegramIds];
      updatedIds[editingTelegramIndex] = newTelegramId;
      setTelegramIds(updatedIds);

      const updatedUser = { ...user, [fieldName]: newTelegramId };
      localStorage.setItem('user', JSON.stringify(updatedUser));
      
      toast.success(appReviewText('Telegram ID updated successfully', 'Telegram ID успешно обновлен'));
      setTelegramIdModal(false);
    } catch (error) {

      toast.error(appReviewText('An error occurred while saving', 'Произошла ошибка при сохранении'));
    } finally {
      setIsSavingTelegramId(false);
    }
  };

  const handleUsernameSave = async () => {
    if (!newUsername.trim()) {
      toast.error(appReviewText('Enter a username', 'Введите имя пользователя'));
      return;
    }

    setIsSavingUsername(true);

    try {
      const { error } = await supabase
        .from('user_accounts')
        .update({ username: newUsername.trim() })
        .eq('id', user?.id);

      if (error) {
        toast.error(appReviewText(`Failed to save username: ${error.message}`, 'Ошибка при сохранении имени: ' + error.message));
        return;
      }

      const updatedUser = { ...user, username: newUsername.trim() };
      localStorage.setItem('user', JSON.stringify(updatedUser));

      toast.success(appReviewText('Username updated successfully', 'Имя успешно обновлено'));
      setUsernameModal(false);
      window.location.reload(); // Перезагружаем для обновления UI
    } catch (error) {

      toast.error(appReviewText('An error occurred while saving', 'Произошла ошибка при сохранении'));
    } finally {
      setIsSavingUsername(false);
    }
  };

  const handleDisconnectInstagram = async () => {
    if (!confirm(appReviewText('Are you sure you want to disconnect Instagram?', 'Вы уверены, что хотите отключить Instagram?'))) {
      return;
    }

    try {
      const { error } = await supabase
        .from('user_accounts')
        .update({ 
          access_token: '',  // Пустая строка вместо null (поле NOT NULL)
          page_id: '',
          ad_account_id: '',
          instagram_id: ''
        })
        .eq('id', user?.id);

      if (error) {
        toast.error(appReviewText(`Failed to disconnect Instagram: ${error.message}`, 'Ошибка при отключении Instagram: ' + error.message));
        return;
      }

      // Обновляем localStorage
      const updatedUser = { 
        ...user, 
        access_token: '',
        page_id: '',
        ad_account_id: '',
        instagram_id: ''
      };
      localStorage.setItem('user', JSON.stringify(updatedUser));
      
      toast.success(appReviewText('Instagram disconnected successfully', 'Instagram успешно отключен'));
      window.location.reload(); // Перезагружаем для обновления UI
    } catch (error) {

      toast.error(appReviewText('An error occurred while disconnecting', 'Произошла ошибка при отключении'));
    }
  };

  const handleSaveFacebookSelection = async () => {
    });

    if (!selectedAdAccount || !selectedPage) {
      toastT.error('selectAdAccountAndPage');
      return;
    }

    try {
      const selectedPageData = facebookData.pages.find((p: any) => p.id === selectedPage);
      const instagramId = selectedPageData?.instagram_id || null;

      const API_URL = 'https://performanteaiagency.com/api';
      const response = await fetch(`${API_URL}/facebook/save-selection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: user?.username,
          access_token: facebookData.access_token,
          ad_account_id: selectedAdAccount,
          page_id: selectedPage,
          instagram_id: instagramId
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to save selection');
      }

      // Update localStorage
      const updatedUser = {
        ...user,
        access_token: facebookData.access_token,
        ad_account_id: selectedAdAccount,
        page_id: selectedPage,
        instagram_id: instagramId,
        ad_accounts: facebookData.ad_accounts,
        pages: facebookData.pages,
      };

      localStorage.setItem('user', JSON.stringify(updatedUser));
      setFacebookSelectionModal(false);
      toastT.success('facebookConnected');

      window.location.reload();

    } catch (error) {

      toast.error(
        error instanceof Error
          ? error.message
          : appReviewText('Failed to save selection', 'Не удалось сохранить выбор')
      );
    }
  };

  const handleDisconnectTikTok = async () => {
    if (!confirm(t('profile.confirmDisconnectTikTok'))) {
      return;
    }

    try {
      if (multiAccountEnabled && currentAdAccountId) {
        // Мультиаккаунт режим: обновляем ad_accounts через API
        const response = await fetch(`${import.meta.env.VITE_API_URL}/ad-accounts/${currentAdAccountId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tiktok_access_token: null,
            tiktok_business_id: null,
            tiktok_account_id: null
          })
        });

        if (!response.ok) {
          const errorData = await response.json();
          toast.error(appReviewText(`Failed to disconnect TikTok: ${errorData.message}`, 'Ошибка при отключении TikTok: ' + errorData.message));
          return;
        }
      } else {
        // Legacy режим: обновляем user_accounts напрямую
        const { error } = await supabase
          .from('user_accounts')
          .update({
            tiktok_access_token: null,
            tiktok_business_id: null,
            tiktok_account_id: null
          })
          .eq('id', user?.id);

        if (error) {
          toast.error(appReviewText(`Failed to disconnect TikTok: ${error.message}`, 'Ошибка при отключении TikTok: ' + error.message));
          return;
        }

        // Обновляем localStorage только в legacy режиме
        const updatedUser = {
          ...user,
          tiktok_access_token: null,
          tiktok_business_id: null,
          tiktok_account_id: null
        };
        localStorage.setItem('user', JSON.stringify(updatedUser));
      }

      toast.success(appReviewText('TikTok disconnected successfully', 'TikTok успешно отключен'));
      window.location.reload(); // Перезагружаем для обновления UI
    } catch (error) {

      toast.error(appReviewText('An error occurred while disconnecting', 'Произошла ошибка при отключении'));
    }
  };

  // Обработка ввода: принимаем точку и запятую, не принимаем пробелы
  const parseAmount = (input: string): number | null => {
    if (!input.trim()) return null;
    
    // Проверяем наличие пробелов (не принимаем)
    if (input.includes(' ')) {
      return NaN;
    }
    
    // Заменяем запятую на точку для парсинга
    const normalized = input.replace(',', '.');
    const parsed = parseFloat(normalized);
    
    return parsed;
  };

  const handleSaveMaxBudget = async () => {
    const maxBudgetDollars = parseAmount(newMaxBudget);

    if (maxBudgetDollars !== null && (isNaN(maxBudgetDollars) || maxBudgetDollars < 0)) {
      toast.error(appReviewText('Enter a valid maximum budget without spaces', 'Введите корректное значение максимального бюджета (без пробелов)'));
      return;
    }

    // Конвертируем доллары в центы
    const maxBudgetCentsValue = maxBudgetDollars !== null ? Math.round(maxBudgetDollars * 100) : null;

    setIsSavingMaxBudget(true);

    try {
      const { error } = await supabase
        .from('user_accounts')
        .update({ plan_daily_budget_cents: maxBudgetCentsValue } as any)
        .eq('id', user?.id);

      if (error) {
        toast.error(appReviewText(`Failed to save: ${error.message}`, 'Ошибка при сохранении: ' + error.message));
        return;
      }

      // Обновляем localStorage
      const updatedUser = { ...user, plan_daily_budget_cents: maxBudgetCentsValue };
      localStorage.setItem('user', JSON.stringify(updatedUser));
      
      setMaxBudgetCents(maxBudgetCentsValue);
      toast.success(appReviewText('Maximum budget saved successfully', 'Максимальный бюджет успешно сохранен'));
      setMaxBudgetModal(false);
    } catch (error) {

      toast.error(appReviewText('An error occurred while saving', 'Произошла ошибка при сохранении'));
    } finally {
      setIsSavingMaxBudget(false);
    }
  };

  const handleSavePlannedCpl = async () => {
    const plannedCplDollars = parseAmount(newPlannedCpl);

    if (plannedCplDollars !== null && (isNaN(plannedCplDollars) || plannedCplDollars < 0)) {
      toast.error(appReviewText('Enter a valid planned cost per lead without spaces', 'Введите корректное значение плановой стоимости заявки (без пробелов)'));
      return;
    }

    // Конвертируем доллары в центы
    const plannedCplCentsValue = plannedCplDollars !== null ? Math.round(plannedCplDollars * 100) : null;

    setIsSavingPlannedCpl(true);

    try {
      const { error } = await supabase
        .from('user_accounts')
        .update({ default_cpl_target_cents: plannedCplCentsValue } as any)
        .eq('id', user?.id);

      if (error) {
        toast.error(appReviewText(`Failed to save: ${error.message}`, 'Ошибка при сохранении: ' + error.message));
        return;
      }

      // Обновляем localStorage
      const updatedUser = { ...user, default_cpl_target_cents: plannedCplCentsValue };
      localStorage.setItem('user', JSON.stringify(updatedUser));
      
      setPlannedCplCents(plannedCplCentsValue);
      toast.success(appReviewText('Planned cost per lead saved successfully', 'Плановая стоимость заявки успешно сохранена'));
      setPlannedCplModal(false);
    } catch (error) {

      toast.error(appReviewText('An error occurred while saving', 'Произошла ошибка при сохранении'));
    } finally {
      setIsSavingPlannedCpl(false);
    }
  };

  const handleSaveOpenaiKey = async () => {
    if (!user?.id) return;
    
    setIsSavingOpenaiKey(true);
    try {
      const keyToSave = newOpenaiKey.trim();
      
      if (keyToSave && !keyToSave.startsWith('sk-')) {
        toast.error(appReviewText('Invalid OpenAI key format (must start with sk-)', 'Некорректный формат ключа OpenAI (должен начинаться с sk-)'));
        setIsSavingOpenaiKey(false);
        return;
      }
      
      const { error } = await (supabase
        .from('user_accounts')
        .update({ openai_api_key: keyToSave || null } as any)
        .eq('id', user.id));
      
      if (error) {

        toast.error(appReviewText(`Failed to save: ${error.message}`, 'Ошибка при сохранении: ' + error.message));
        return;
      }
      
      // Обновляем localStorage
      const updatedUser = { ...user, openai_api_key: keyToSave || null };
      localStorage.setItem('user', JSON.stringify(updatedUser));
      
      setOpenaiApiKey(keyToSave);
      toast.success(appReviewText('OpenAI API key saved successfully', 'OpenAI API ключ успешно сохранен'));
      setOpenaiModal(false);
      setNewOpenaiKey('');
      setShowOpenaiKey(false);
    } catch (error) {

      toast.error(appReviewText('An error occurred while saving', 'Произошла ошибка при сохранении'));
    } finally {
      setIsSavingOpenaiKey(false);
    }
  };

  const handleSaveAudienceId = async () => {
    if (!user?.id) return;
    
    setIsSavingAudienceId(true);
    try {
      const idToSave = newAudienceId.trim();
      
      const { error } = await (supabase
        .from('user_accounts')
        .update({ ig_seed_audience_id: idToSave || null } as any)
        .eq('id', user.id));
      
      if (error) {

        toast.error(appReviewText(`Failed to save: ${error.message}`, 'Ошибка при сохранении: ' + error.message));
        return;
      }
      
      // Обновляем localStorage
      const updatedUser = { ...user, ig_seed_audience_id: idToSave || null };
      localStorage.setItem('user', JSON.stringify(updatedUser));
      
      setAudienceId(idToSave);
      toast.success(appReviewText('Audience ID saved successfully', 'ID аудитории успешно сохранен'));
      setAudienceModal(false);
      setNewAudienceId('');
    } catch (error) {

      toast.error(appReviewText('An error occurred while saving', 'Произошла ошибка при сохранении'));
    } finally {
      setIsSavingAudienceId(false);
    }
  };

  // AmoCRM handlers
  const handleAmoCRMConnect = () => {

    if (amocrmConnected) {

      setAmocrmModal(true); // Open management modal
    } else {

      setAmocrmConnectModal(true); // Open connection modal
    }
  };

  const handleAmoCRMConnectSubmit = () => {
    if (!user?.id || !amocrmInputSubdomain.trim()) return;

    // Include accountId for multi-account mode
    let url = `${API_BASE_URL}/amocrm/connect?userAccountId=${user.id}&subdomain=${amocrmInputSubdomain.trim()}`;
    if (multiAccountEnabled && currentAdAccountId) {
      url += `&accountId=${currentAdAccountId}`;
    }
    window.location.href = url;
  };

  const handleAmoCRMDisconnect = async () => {
    if (!user?.id) return;
    
    try {
      const response = await fetch(`${API_BASE_URL}/amocrm/disconnect?userAccountId=${user.id}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        setAmocrmConnected(false);
        setAmocrmWebhookActive(false);
        setAmocrmSubdomain('');
        toast.success('AmoCRM отключен');
        setAmocrmModal(false);
      } else {
        toast.error('Ошибка при отключении AmoCRM');
      }
    } catch (error) {

      toast.error('Ошибка при отключении AmoCRM');
    }
  };

  const handleAmoCRMSync = async () => {
    if (!user?.id) return;
    
    setIsSyncingAmocrm(true);
    try {
      toast.info('Синхронизация запущена...');
      const response = await fetch(`${API_BASE_URL}/amocrm/sync-leads?userAccountId=${user.id}`, {
        method: 'POST'
      });
      const data = await response.json();
      
      if (data.success) {
        toast.success(`Синхронизировано: обновлено ${data.updated} лидов из ${data.total}`);
      } else {
        toast.error('Ошибка синхронизации');
      }
    } catch (error) {

      toast.error('Ошибка синхронизации');
    } finally {
      setIsSyncingAmocrm(false);
    }
  };

  // Bitrix24 handlers
  const handleBitrix24Connect = () => {

    if (bitrix24Connected) {

      setBitrix24Modal(true);
    } else {

      if (user?.id) {
        // Pass accountId for multi-account mode
        const accountId = multiAccountEnabled ? currentAdAccountId : undefined;
        openBitrix24ConnectWindow(user.id, accountId || undefined);
      }
    }
  };

  const handleBitrix24Disconnect = async () => {
    if (!user?.id) return;

    try {
      await disconnectBitrix24(user.id);
      setBitrix24Connected(false);
      setBitrix24Domain('');
      toast.success('Bitrix24 отключен');
      setBitrix24Modal(false);
    } catch (error) {

      toast.error('Ошибка при отключении Bitrix24');
    }
  };

  const handleBitrix24Sync = async () => {
    if (!user?.id) return;

    setIsSyncingBitrix24(true);
    try {
      toast.info('Синхронизация запущена...');
      // Pass currentAdAccountId for multi-account mode
      const accountId = multiAccountEnabled ? currentAdAccountId : undefined;
      const result = await syncBitrix24Leads(user.id, bitrix24EntityType === 'both' ? undefined : bitrix24EntityType, accountId);

      if (result.success) {
        toast.success(`Синхронизировано: обновлено ${result.updated} записей`);
      } else {
        toast.error('Ошибка синхронизации');
      }
    } catch (error) {

      toast.error('Ошибка синхронизации');
    } finally {
      setIsSyncingBitrix24(false);
    }
  };

  // Load settings when modal opens
  useEffect(() => {
    if (bitrix24Modal && bitrix24Connected && user?.id) {
      const accountId = multiAccountEnabled ? currentAdAccountId : undefined;

      // Load auto-create setting
      const loadAutoCreateSetting = async () => {
        setLoadingAutoCreate(true);
        try {
          const result = await getBitrix24AutoCreateSetting(user.id, accountId || undefined);
          setBitrix24AutoCreate(result.enabled);
        } catch (error) {

        } finally {
          setLoadingAutoCreate(false);
        }
      };

      // Load pipelines and default stage
      const loadPipelinesAndDefaults = async () => {
        setLoadingPipelines(true);
        try {
          // Load pipelines (pass accountId for multi-account mode)
          const pipelines = await getBitrix24Pipelines(user.id, accountId || undefined);
          setBitrix24Pipelines(pipelines);

          // Load default stage settings
          const defaults = await getBitrix24DefaultStage(user.id, accountId || undefined);
          setDefaultLeadStatus(defaults.leadStatus);
          setDefaultDealCategory(defaults.dealCategory);
          setDefaultDealStage(defaults.dealStage);
          setDefaultStagesDirty(false); // Reset dirty flag after loading
        } catch (error) {

        } finally {
          setLoadingPipelines(false);
        }
      };

      loadAutoCreateSetting();
      loadPipelinesAndDefaults();
    }
  }, [bitrix24Modal, bitrix24Connected, user?.id, multiAccountEnabled, currentAdAccountId]);

  const handleAutoCreateChange = async (enabled: boolean) => {
    if (!user?.id) return;

    setLoadingAutoCreate(true);
    try {
      const accountId = multiAccountEnabled ? currentAdAccountId : undefined;
      const result = await setBitrix24AutoCreateSetting(user.id, enabled, accountId || undefined);
      if (result.success) {
        setBitrix24AutoCreate(result.enabled);
        toast.success(enabled ? 'Авто-создание лидов включено' : 'Авто-создание лидов отключено');
      }
    } catch (error) {

      toast.error('Ошибка при изменении настройки');
    } finally {
      setLoadingAutoCreate(false);
    }
  };

  // Track if default stage settings have unsaved changes
  const [defaultStagesDirty, setDefaultStagesDirty] = useState(false);
  const [savingDefaultStages, setSavingDefaultStages] = useState(false);

  // Handle lead status change - only update local state
  const handleLeadStatusChange = (value: string) => {
    setDefaultLeadStatus(value || null);
    setDefaultStagesDirty(true);
  };

  // Handle deal stage change - only update local state
  const handleDealStageChange = (value: string) => {
    setDefaultDealStage(value || null);
    setDefaultStagesDirty(true);
  };

  // Handle deal pipeline (category) change - only update local state
  const handleDealCategoryChange = (categoryId: string) => {
    const newCategoryId = categoryId ? parseInt(categoryId) : null;
    setDefaultDealCategory(newCategoryId);
    // Reset stage when category changes (stages are different per pipeline)
    setDefaultDealStage(null);
    setDefaultStagesDirty(true);
  };

  // Save all default stage settings to API
  const handleSaveDefaultStages = async () => {
    if (!user?.id) return;

    setSavingDefaultStages(true);
    try {
      const accountId = multiAccountEnabled ? currentAdAccountId : undefined;

      // Build update object based on entity type
      const updateData: { leadStatus?: string | null; dealCategory?: number | null; dealStage?: string | null } = {};

      if (bitrix24EntityType === 'lead' || bitrix24EntityType === 'both') {
        updateData.leadStatus = defaultLeadStatus;
      }

      if (bitrix24EntityType === 'deal' || bitrix24EntityType === 'both') {
        updateData.dealCategory = defaultDealCategory;
        updateData.dealStage = defaultDealStage;
      }

      await setBitrix24DefaultStage(user.id, updateData, accountId || undefined);
      setDefaultStagesDirty(false);
      toast.success('Настройки сохранены');
    } catch (error) {

      toast.error('Ошибка при сохранении настроек');
    } finally {
      setSavingDefaultStages(false);
    }
  };

  const handleSyncPipelines = async () => {
    if (!user?.id) return;

    setLoadingPipelines(true);
    try {
      const accountId = multiAccountEnabled ? currentAdAccountId : undefined;
      await syncBitrix24Pipelines(user.id, accountId);
      const pipelines = await getBitrix24Pipelines(user.id, accountId);
      setBitrix24Pipelines(pipelines);
      toast.success('Воронки синхронизированы');
    } catch (error) {

      toast.error('Ошибка синхронизации воронок');
    } finally {
      setLoadingPipelines(false);
    }
  };

  // === Флаги подключений для ConnectionsGrid ===
  // Для мультиаккаунтного режима проверяем текущий ad_account
  const currentAdAccount = multiAccountEnabled && contextAdAccounts?.length > 0
    ? contextAdAccounts.find((a: any) => a.id === currentAdAccountId) || contextAdAccounts[0]
    : null;

  // Facebook: в мульти-режиме проверяем connection_status, иначе user_accounts
  const isFbConnected = multiAccountEnabled
    ? currentAdAccount?.connection_status === 'connected'
    : Boolean(user?.access_token && user?.access_token !== '' && user?.ad_account_id && user?.ad_account_id !== '');

  // Instagram: в мульти-режиме это часть FB подключения
  const isIgConnected = multiAccountEnabled
    ? currentAdAccount?.connection_status === 'connected'
    : Boolean(user?.access_token && user?.access_token !== '' && user?.page_id && user?.page_id !== '');

  // TikTok: в мульти-режиме из ad_accounts, иначе из user_accounts

  const isTikTokConnected = multiAccountEnabled
    ? Boolean(currentAdAccount?.tiktok_access_token && currentAdAccount?.tiktok_business_id)
    : Boolean(user?.tiktok_access_token && user?.tiktok_business_id);

  // Tilda: проверяем наличие tilda_utm_field (всегда есть дефолт, считаем подключённым)
  const isTildaConnected = multiAccountEnabled
    ? Boolean(currentAdAccount?.tilda_utm_field)
    : tildaConnected;

  // AmoCRM: проверяется отдельным запросом (amocrmConnected state)

  return (
    <div className="bg-background w-full max-w-full overflow-x-hidden">
      <Header onOpenDatePicker={() => {}} />
      <div className="w-full py-6 px-4 pt-[76px] max-w-full overflow-x-hidden">
        <div className="max-w-4xl lg:max-w-6xl mx-auto space-y-6 w-full">
          <PageHero title={t('profile.title')} subtitle={t('profile.subtitle')} />
          
          {isLoading ? (
            <Card>
              <CardContent className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <Skeleton className="h-4 w-56" />
                  <Skeleton className="h-4 w-72" />
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-4 w-48" />
                </div>
                <div className="flex md:justify-end">
                  <Skeleton className="h-9 w-40" />
                </div>
              </div>
              </CardContent>
            </Card>
          ) : (
            <>
            <TariffInfoCard
              username={user?.username || '—'}
              tarif={tarif || undefined as any}
              expiry={formattedExpiry}
              onChangePassword={() => setPasswordModal(true)}
              onChangeUsername={() => {
                setNewUsername(user?.username || '');
                setUsernameModal(true);
              }}
            />

              {/* Ad Accounts Manager - только для мультиаккаунтности */}
              {multiAccountEnabled && <AdAccountsManager />}

              {/* Telegram ID Card - только для обычного режима, в мультиаккаунтном настраивается через AdAccountsManager */}
              {!multiAccountEnabled && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <MessageCircle className="h-5 w-5" />
                      {t('profile.telegramReports')}
                      <HelpTooltip tooltipKey={TooltipKeys.PROFILE_TELEGRAM_IDS} iconSize="sm" />
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {telegramIds.map((id, index) => {
                        // Показываем только заполненные ID
                        if (!id) return null;

                        return (
                          <div key={index} className="flex items-center justify-between">
                            <div className="flex-1">
                              <div className="text-sm text-muted-foreground mb-1">
                                Telegram ID
                              </div>
                              <div className="font-medium">{id}</div>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setEditingTelegramIndex(index);
                                setNewTelegramId(id);
                                setTelegramIdModal(true);
                              }}
                            >
                              {t('action.change')}
                            </Button>
                          </div>
                        );
                      })}

                      {/* Кнопка добавить еще ID (показывается если есть свободный слот) */}
                      {telegramIds.filter(id => id !== null).length < 4 && telegramIds[0] && (
                        <div className="pt-2 border-t">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              const emptyIndex = telegramIds.findIndex(id => id === null);
                              if (emptyIndex !== -1) {
                                setEditingTelegramIndex(emptyIndex);
                                setNewTelegramId('');
                                setTelegramIdModal(true);
                              }
                            }}
                            className="w-full"
                          >
                            <Plus className="h-4 w-4 mr-2" />
                            {t('profile.addTelegramId')}
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Brain Settings Card убран для legacy режима:
                  - Legacy (multi_account_enabled=false) использует user_accounts.autopilot (toggle on/off)
                  - Multi-account настраивает brain_mode через AdAccountsManager */}

              {/* Audience ID Card - скрыто в preview версии и в мультиаккаунтном режиме (настраивается через AdAccountsManager) */}
              {!APP_REVIEW_MODE && !multiAccountEnabled && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Users className="h-5 w-5" />
                      Аудитория
                      <HelpTooltip tooltipKey={TooltipKeys.PROFILE_AUDIENCE_ID} iconSize="sm" />
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-start justify-between gap-2 sm:gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-muted-foreground mb-1">
                          Facebook Custom Audience ID для дублирования кампаний
                        </div>
                        <div className="font-medium font-mono text-sm break-all">
                          {audienceId || 'Не установлено'}
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setNewAudienceId(audienceId);
                          setAudienceModal(true);
                        }}
                        className="px-2 sm:px-4 flex-shrink-0"
                      >
                        {audienceId ? (
                          <>
                            <Edit className="h-4 w-4 sm:mr-2" />
                            <span className="hidden sm:inline">Изменить</span>
                          </>
                        ) : (
                          <>
                            <Plus className="h-4 w-4 sm:mr-2" />
                            <span className="hidden sm:inline">Добавить</span>
                          </>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* OpenAI API Key - скрыт (не используется в данной версии) */}
              {/* 
              {FEATURES.SHOW_DIRECTIONS && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Key className="h-5 w-5" />
                      {t('profile.openaiKey')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="text-sm text-muted-foreground mb-1">
                          {t('profile.apiKeyDescription')}
                        </div>
                        <div className="font-medium font-mono">
                          {openaiApiKey ? `${openaiApiKey.substring(0, 7)}...${openaiApiKey.substring(openaiApiKey.length - 4)}` : t('profile.notSet')}
                        </div>
                      </div>
                      <Button 
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setNewOpenaiKey(openaiApiKey);
                          setShowOpenaiKey(false);
                          setOpenaiModal(true);
                        }}
                      >
                        {openaiApiKey ? t('action.change') : t('action.add')}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
              */}

              {/* Направления бизнеса */}
              {FEATURES.SHOW_DIRECTIONS && (
                <div data-tour="directions-block">
                  <DirectionsCard userAccountId={user?.id || null} accountId={currentAdAccountId} />
                </div>
              )}

              {/* WhatsApp Connection Card */}
              {FEATURES.SHOW_WHATSAPP && <WhatsAppConnectionCard userAccountId={user?.id || null} accountId={currentAdAccountId} />}
            </>
          )}

          <ConnectionsGrid
            items={[
              {
                id: 'facebook',
                title: 'Facebook Ads',
                connected: isFbConnected,
                onClick: () => {
                  if (isFbConnected) {
                    if (confirm(t('profile.confirmDisconnectFacebook'))) {
                      handleDisconnectInstagram();
                    }
                  } else {
                    setFacebookManualModal(true);
                  }
                },
                disabled: false,
              },
              {
                id: 'instagram',
                title: 'Instagram',
                connected: isIgConnected,
                onClick: () => {
                  if (isIgConnected) {
                    handleDisconnectInstagram();
                  } else {
                    toast.info(t('profile.instagramConnectInfo'));
                  }
                },
              },
              ...(FEATURES.SHOW_TIKTOK ? [{
                id: 'tiktok' as const,
                title: 'TikTok',
                connected: isTikTokConnected,
                onClick: () => {
                  if (isTikTokConnected) {
                    handleDisconnectTikTok();
                  } else {
                    const uid = user?.id || '';
                    // Включаем ad_account_id для multi-account режима
                    const statePayload: { user_id: string; ad_account_id?: string; ts: number } = {
                      user_id: uid,
                      ts: Date.now()
                    };
                    if (multiAccountEnabled && currentAdAccountId) {
                      statePayload.ad_account_id = currentAdAccountId;
                    }
                    let state = '';
                    try {
                      state = encodeURIComponent(btoa(JSON.stringify(statePayload)));
                    } catch {
                      state = encodeURIComponent(JSON.stringify(statePayload));
                    }
                    const redirect = encodeURIComponent('https://performanteaiagency.com/oauth/callback');
                    const authUrl = `https://business-api.tiktok.com/portal/auth?app_id=7527489318093668353&state=${state}&redirect_uri=${redirect}`;
                    window.open(authUrl, '_blank', 'noopener,noreferrer');
                  }
                },
                disabled: false,
              }] : []),
              {
                id: 'amocrm',
                title: 'AmoCRM',
                connected: amocrmConnected,
                onClick: handleAmoCRMConnect,
                badge: amocrmConnected && amocrmWebhookActive ? 'Webhook' : undefined,
              },
              {
                id: 'bitrix24',
                title: 'Bitrix24',
                connected: bitrix24Connected,
                onClick: handleBitrix24Connect,
              },
              ...(FEATURES.SHOW_DIRECTIONS ? [{
                id: 'tilda' as const,
                title: 'Tilda (сайт)',
                connected: isTildaConnected,
                onClick: () => setTildaInstructionsModal(true),
              }] : []),
            ]}
          />

        </div>

        {/* Диалог смены пароля */}
        <Dialog open={passwordModal} onOpenChange={setPasswordModal}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{appReviewText('Change password', 'Смена пароля')}</DialogTitle>
              <DialogDescription>
                {appReviewText('Enter your current and new password to update it.', 'Введите текущий пароль и новый пароль для смены.')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="old-password">{appReviewText('Current password', 'Текущий пароль')}</Label>
                <div className="relative">
                  <Input
                    id="old-password"
                    type={showOldPassword ? "text" : "password"}
                    placeholder={appReviewText('Enter current password', 'Введите текущий пароль')}
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                    disabled={isChangingPassword}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                    onClick={() => setShowOldPassword(!showOldPassword)}
                  >
                    {showOldPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-password" className="flex items-center gap-1">
                  {appReviewText('New password', 'Новый пароль')}
                  <HelpTooltip tooltipKey={TooltipKeys.PROFILE_PASSWORD} iconSize="sm" />
                </Label>
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showNewPassword ? "text" : "password"}
                    placeholder={appReviewText('Enter new password (min. 6 characters)', 'Введите новый пароль (минимум 6 символов)')}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    disabled={isChangingPassword}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                  >
                    {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">{appReviewText('Confirm new password', 'Повторите новый пароль')}</Label>
                <div className="relative">
                  <Input
                    id="confirm-password"
                    type={showConfirmPassword ? "text" : "password"}
                    placeholder={appReviewText('Re-enter the new password', 'Повторите новый пароль')}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={isChangingPassword}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setPasswordModal(false);
                    setOldPassword('');
                    setNewPassword('');
                    setConfirmPassword('');
                  }}
                  disabled={isChangingPassword}
                >
                  {t('action.cancel')}
                </Button>
                <Button
                  onClick={handlePasswordSave}
                  disabled={isChangingPassword}
                >
                  {isChangingPassword ? appReviewText('Saving...', 'Сохранение...') : t('action.save')}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Диалог изменения имени пользователя */}
        <Dialog open={usernameModal} onOpenChange={setUsernameModal}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{appReviewText('Change Username', 'Изменить имя')}</DialogTitle>
              <DialogDescription>
                {appReviewText('Enter a new username.', 'Введите новое имя пользователя.')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-username" className="flex items-center gap-1">
                  {appReviewText('Username', 'Имя пользователя')}
                  <HelpTooltip tooltipKey={TooltipKeys.PROFILE_USERNAME} iconSize="sm" />
                </Label>
                <Input
                  id="new-username"
                  type="text"
                  placeholder={appReviewText('Enter username', 'Введите имя')}
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  disabled={isSavingUsername}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setUsernameModal(false)}
                  disabled={isSavingUsername}
                >
                  {t('action.cancel')}
                </Button>
                <Button
                  onClick={handleUsernameSave}
                  disabled={isSavingUsername}
                >
                  {isSavingUsername ? appReviewText('Saving...', 'Сохранение...') : t('action.save')}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Диалог изменения Telegram ID */}
        <Dialog open={telegramIdModal} onOpenChange={setTelegramIdModal}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{appReviewText('Edit Telegram ID', 'Изменить Telegram ID')}</DialogTitle>
              <DialogDescription>
                {appReviewText('Enter your Telegram ID to receive reports.', 'Введите ваш Telegram ID для получения отчетов.')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="telegram-id">Telegram ID</Label>
                <Input
                  id="telegram-id"
                  type="text"
                  placeholder={appReviewText('For example: 123456789', 'Например: 123456789')}
                  value={newTelegramId}
                  onChange={(e) => setNewTelegramId(e.target.value)}
                  disabled={isSavingTelegramId}
                />
                <p className="text-xs text-muted-foreground">
                  {appReviewText('You can find your Telegram ID via @userinfobot', 'Ваш Telegram ID можно узнать у бота @userinfobot')}
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setTelegramIdModal(false)}
                  disabled={isSavingTelegramId}
                >
                  {t('action.cancel')}
                </Button>
                <Button
                  onClick={handleTelegramIdSave}
                  disabled={isSavingTelegramId}
                >
                  {isSavingTelegramId ? appReviewText('Saving...', 'Сохранение...') : t('action.save')}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Диалог изменения максимального бюджета */}
        <Dialog open={maxBudgetModal} onOpenChange={setMaxBudgetModal}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{appReviewText('Edit maximum budget', 'Изменить максимальный бюджет')}</DialogTitle>
              <DialogDescription>
                {appReviewText('Specify the maximum daily budget in USD.', 'Укажите максимальный дневной бюджет в долларах.')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="max-budget" className="flex items-center gap-1">
                  {appReviewText('Maximum budget (USD)', 'Максимальный бюджет (USD)')}
                  <HelpTooltip tooltipKey={TooltipKeys.PROFILE_MAX_BUDGET} iconSize="sm" />
                </Label>
                <Input
                  id="max-budget"
                  type="text"
                  placeholder={appReviewText('For example: 10000 or 10000.50 or 10000,50', 'Например: 10000 или 10000.50 или 10000,50')}
                  value={newMaxBudget}
                  onChange={(e) => setNewMaxBudget(e.target.value)}
                  disabled={isSavingMaxBudget}
                />
                <p className="text-xs text-muted-foreground">
                  {appReviewText('You can use a dot or comma for decimals. Leave empty to remove the limit.', 'Можно использовать точку или запятую для десятых. Оставьте пустым, чтобы убрать ограничение.')}
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setMaxBudgetModal(false)}
                  disabled={isSavingMaxBudget}
                >
                  {t('action.cancel')}
                </Button>
                <Button
                  onClick={handleSaveMaxBudget}
                  disabled={isSavingMaxBudget}
                >
                  {isSavingMaxBudget ? appReviewText('Saving...', 'Сохранение...') : t('action.save')}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Диалог изменения плановой стоимости заявки */}
        <Dialog open={plannedCplModal} onOpenChange={setPlannedCplModal}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{appReviewText('Edit planned cost per lead', 'Изменить плановую стоимость заявки')}</DialogTitle>
              <DialogDescription>
                {appReviewText('Set the target cost per lead in USD.', 'Укажите целевую стоимость одного лида в долларах.')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="planned-cpl" className="flex items-center gap-1">
                  {appReviewText('Planned cost per lead (USD)', 'Плановая стоимость заявки (USD)')}
                  <HelpTooltip tooltipKey={TooltipKeys.PROFILE_PLANNED_CPL} iconSize="sm" />
                </Label>
                <Input
                  id="planned-cpl"
                  type="text"
                  placeholder={appReviewText('For example: 50 or 50.75 or 50,75', 'Например: 50 или 50.75 или 50,75')}
                  value={newPlannedCpl}
                  onChange={(e) => setNewPlannedCpl(e.target.value)}
                  disabled={isSavingPlannedCpl}
                />
                <p className="text-xs text-muted-foreground">
                  {appReviewText('You can use a dot or comma for decimals. Leave empty to remove the value.', 'Можно использовать точку или запятую для десятых. Оставьте пустым, чтобы убрать значение.')}
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setPlannedCplModal(false)}
                  disabled={isSavingPlannedCpl}
                >
                  {t('action.cancel')}
                </Button>
                <Button
                  onClick={handleSavePlannedCpl}
                  disabled={isSavingPlannedCpl}
                >
                  {isSavingPlannedCpl ? appReviewText('Saving...', 'Сохранение...') : t('action.save')}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Диалог изменения OpenAI API ключа */}
        <Dialog open={openaiModal} onOpenChange={setOpenaiModal}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{appReviewText('OpenAI API key', 'OpenAI API ключ')}</DialogTitle>
              <DialogDescription>
                {appReviewText('Provide your OpenAI API key for content generation. The key must start with "sk-".', 'Укажите ваш API ключ OpenAI для генерации контента. Ключ должен начинаться с "sk-".')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="openai-key" className="flex items-center gap-1">
                  {appReviewText('API key', 'API ключ')}
                  <HelpTooltip tooltipKey={TooltipKeys.PROFILE_OPENAI_KEY} iconSize="sm" />
                </Label>
                <div className="relative">
                  <Input
                    id="openai-key"
                    type={showOpenaiKey ? "text" : "password"}
                    placeholder={appReviewText('sk-...', 'sk-...')}
                    value={newOpenaiKey}
                    onChange={(e) => setNewOpenaiKey(e.target.value)}
                    disabled={isSavingOpenaiKey}
                    className="pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                    onClick={() => setShowOpenaiKey(!showOpenaiKey)}
                  >
                    {showOpenaiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {appReviewText('Leave empty to remove the key.', 'Оставьте пустым, чтобы удалить ключ.')}
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setOpenaiModal(false);
                    setNewOpenaiKey('');
                    setShowOpenaiKey(false);
                  }}
                  disabled={isSavingOpenaiKey}
                >
                  {t('action.cancel')}
                </Button>
                <Button
                  onClick={handleSaveOpenaiKey}
                  disabled={isSavingOpenaiKey}
                >
                  {isSavingOpenaiKey ? appReviewText('Saving...', 'Сохранение...') : t('action.save')}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Диалог изменения ID аудитории */}
        <Dialog open={audienceModal} onOpenChange={setAudienceModal}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{appReviewText('Audience ID', 'ID аудитории')}</DialogTitle>
              <DialogDescription>
                {appReviewText('Provide the Facebook Custom Audience ID used for duplicating campaigns with Brain.', 'Укажите Facebook Custom Audience ID для использования при дублировании кампаний агентом Brain.')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="audience-id">Audience ID</Label>
                <Input
                  id="audience-id"
                  type="text"
                  placeholder={appReviewText('For example: 120210000000000000', 'Например: 120210000000000000')}
                  value={newAudienceId}
                  onChange={(e) => setNewAudienceId(e.target.value)}
                  disabled={isSavingAudienceId}
                />
                <p className="text-xs text-muted-foreground">
                  {appReviewText('Use the existing LAL audience ID from Facebook Ads Manager. Leave empty to remove.', 'ID готовой LAL аудитории из Facebook Ads Manager. Оставьте пустым, чтобы удалить.')}
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setAudienceModal(false);
                    setNewAudienceId('');
                  }}
                  disabled={isSavingAudienceId}
                >
                  {t('action.cancel')}
                </Button>
                <Button
                  onClick={handleSaveAudienceId}
                  disabled={isSavingAudienceId}
                >
                  {isSavingAudienceId ? appReviewText('Saving...', 'Сохранение...') : t('action.save')}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Диалог выбора Ad Account и Page */}
        <Dialog open={facebookSelectionModal} onOpenChange={setFacebookSelectionModal}>
          <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {isAppReviewMode
                  ? 'Select ad account and page'
                  : 'Выберите рекламный кабинет и страницу'}
              </DialogTitle>
              <DialogDescription>
                {isAppReviewMode
                  ? 'Select the ad account and Facebook Page to connect.'
                  : 'Выберите рекламный кабинет и Facebook страницу для подключения.'}
                <br />
                {isAppReviewMode
                  ? `Found: ${adAccounts.length} ad account(s) and ${pages.length} page(s)`
                  : `Найдено: ${adAccounts.length} рекламных кабинетов и ${pages.length} страниц`}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>{isAppReviewMode ? 'Ad Account' : 'Рекламный кабинет'}</Label>
                <Input
                  placeholder={isAppReviewMode ? 'Search by name...' : 'Поиск по названию...'}
                  value={searchAdAccount}
                  onChange={(e) => setSearchAdAccount(e.target.value)}
                  className="mt-1 mb-2"
                />
                <select
                  className="w-full p-2 border rounded max-h-40 overflow-y-auto"
                  size={5}
                  value={selectedAdAccount}
                  onChange={(e) => setSelectedAdAccount(e.target.value)}
                >
                  {filteredAdAccounts.map((account: any) => (
                    <option key={account.id} value={account.id}>
                      {account.name} ({account.id})
                    </option>
                  ))}
                </select>
                <div className="text-xs text-gray-500 mt-1">
                  {isAppReviewMode
                    ? `Showing: ${filteredAdAccounts.length} of ${adAccounts.length}`
                    : `Показано: ${filteredAdAccounts.length} из ${adAccounts.length}`}
                </div>
              </div>
              <div>
                <Label>Facebook Page</Label>
                <Input
                  placeholder={isAppReviewMode ? 'Search by name...' : 'Поиск по названию...'}
                  value={searchPage}
                  onChange={(e) => setSearchPage(e.target.value)}
                  className="mt-1 mb-2"
                />
                <div className="w-full border rounded max-h-40 overflow-y-auto p-2">
                  {filteredPages.map((page: any) => (
                    <label
                      key={page.id}
                      className="flex items-center p-2 hover:bg-gray-50 cursor-pointer rounded"
                    >
                      <input
                        type="radio"
                        name="facebookPage"
                        value={page.id}
                        checked={selectedPage === page.id}
                        onChange={(e) => {

                          const newPageId = e.target.value;
                          const pageName = filteredPages.find((p: any) => p.id === newPageId)?.name;

                          setSelectedPage(newPageId);
                        }}
                        className="mr-3"
                      />
                      <span className="flex-1">
                        {page.name} ({page.id})
                        {page.instagram_id && ` ✓ IG`}
                      </span>
                    </label>
                  ))}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {isAppReviewMode
                    ? `Showing: ${filteredPages.length} of ${pages.length}`
                    : `Показано: ${filteredPages.length} из ${pages.length}`}
                </div>
              </div>
              {selectedPageData?.instagram_id && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                  <div className="flex items-center gap-2 text-green-700">
                    <CheckCircle2 className="h-4 w-4" />
                    <span className="font-medium">
                      {isAppReviewMode
                        ? 'Instagram Business Account connected'
                        : 'Instagram Business Account подключен'}
                    </span>
                  </div>
                  <div className="text-sm text-green-600 mt-1">
                    ID: {selectedPageData?.instagram_id}
                  </div>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setFacebookSelectionModal(false);
                    setSearchAdAccount('');
                    setSearchPage('');
                  }}
                >
                  {t('action.cancel')}
                </Button>
                <Button onClick={handleSaveFacebookSelection}>
                  {t('action.save')}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* AmoCRM Connection Modal */}
        <Dialog open={amocrmConnectModal} onOpenChange={setAmocrmConnectModal}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Подключить AmoCRM</DialogTitle>
              <DialogDescription>
                Введите поддомен вашего аккаунта AmoCRM (например: mycompany)
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label htmlFor="subdomain">Поддомен AmoCRM</Label>
                <div className="flex items-center gap-2 mt-2">
                  <Input
                    id="subdomain"
                    placeholder="mycompany"
                    value={amocrmInputSubdomain}
                    onChange={(e) => setAmocrmInputSubdomain(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && amocrmInputSubdomain.trim()) {
                        handleAmoCRMConnectSubmit();
                      }
                    }}
                  />
                  <span className="text-sm text-muted-foreground whitespace-nowrap">.amocrm.ru</span>
                </div>
              </div>
              <Button
                onClick={handleAmoCRMConnectSubmit}
                disabled={!amocrmInputSubdomain.trim()}
                className="w-full"
              >
                Подключить
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* AmoCRM Management Modal */}
        <Dialog open={amocrmModal} onOpenChange={setAmocrmModal}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>AmoCRM подключен</DialogTitle>
              <DialogDescription>
                Аккаунт: {amocrmSubdomain}.amocrm.ru
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-4">
              <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                <div className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${amocrmWebhookActive ? 'bg-green-500' : 'bg-yellow-500'}`} />
                  <span className="text-sm">
                    Вебхук {amocrmWebhookActive ? 'активен' : 'не настроен'}
                  </span>
                </div>
              </div>

              {/* TEMPORARILY HIDDEN: Key Stages Configuration
              <Button
                onClick={() => {
                  setAmocrmModal(false);
                  setAmocrmKeyStagesModal(true);
                }}
                variant="default"
                className="w-full"
              >
                Настроить ключевые этапы
              </Button>
              */}

              {/* REMOVED: Qualification now configured at direction level via CAPI settings */}

              <Button
                onClick={handleAmoCRMSync}
                variant="outline"
                className="w-full"
                disabled={isSyncingAmocrm}
              >
                {isSyncingAmocrm ? 'Синхронизация...' : 'Синхронизировать данные вручную'}
              </Button>

              <Button
                onClick={handleAmoCRMDisconnect}
                variant="destructive"
                className="w-full"
              >
                Отключить AmoCRM
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* TEMPORARILY HIDDEN: AmoCRM Key Stages Settings Modal
        <Dialog open={amocrmKeyStagesModal} onOpenChange={setAmocrmKeyStagesModal}>
          <DialogContent className="sm:max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader className="sr-only">
              <DialogTitle>Настройка ключевых этапов воронки AmoCRM</DialogTitle>
            </DialogHeader>
            {user?.id && (
              <AmoCRMKeyStageSettings
                userAccountId={user.id}
                onClose={() => setAmocrmKeyStagesModal(false)}
              />
            )}
          </DialogContent>
        </Dialog>
        */}

        {/* Facebook Manual Connect Modal */}
        <FacebookManualConnectModal
          open={facebookManualModal}
          onOpenChange={setFacebookManualModal}
          onComplete={() => {
            setFacebookManualModal(false);
            // window.location.reload(); // Reload to update UI with new status
          }}
          showSkipButton={false}
        />

        {/* Tilda Instructions Modal */}
        <TildaInstructionsDialog
          open={tildaInstructionsModal}
          onOpenChange={setTildaInstructionsModal}
          userAccountId={user?.id || null}
          onSettingsSaved={() => setTildaConnected(true)}
        />

        {/* REMOVED: AmoCRM Qualification Field Modal - now configured at direction level via CAPI settings */}

        {/* Bitrix24 Management Modal */}
        <Dialog open={bitrix24Modal} onOpenChange={setBitrix24Modal}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Bitrix24 подключен</DialogTitle>
              <DialogDescription>
                Портал: {bitrix24Domain}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-4">
              <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-green-500" />
                  <span className="text-sm">
                    Режим: {bitrix24EntityType === 'both' ? 'Лиды и Сделки' : bitrix24EntityType === 'lead' ? 'Лиды' : 'Сделки'}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                <div className="flex flex-col">
                  <span className="text-sm font-medium">Авто-создание лидов</span>
                  <span className="text-xs text-muted-foreground">
                    Создавать лиды в CRM при получении из Facebook Lead Forms
                  </span>
                </div>
                <Switch
                  checked={bitrix24AutoCreate}
                  onCheckedChange={handleAutoCreateChange}
                  disabled={loadingAutoCreate}
                />
              </div>

              {/* Default stage selector - показываем только если авто-создание включено */}
              {bitrix24AutoCreate && (
                <div className="p-3 bg-muted rounded-lg space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Этап для новых лидов</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleSyncPipelines}
                      disabled={loadingPipelines}
                    >
                      {loadingPipelines ? 'Загрузка...' : 'Обновить'}
                    </Button>
                  </div>

                  {(bitrix24EntityType === 'lead' || bitrix24EntityType === 'both') && (
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Этап лида</Label>
                      <Select
                        value={defaultLeadStatus || ''}
                        onValueChange={handleLeadStatusChange}
                        disabled={loadingPipelines}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Выберите этап" />
                        </SelectTrigger>
                        <SelectContent>
                          {bitrix24Pipelines?.leads?.map((pipeline) =>
                            pipeline.stages.map((stage) => (
                              <SelectItem key={stage.statusId} value={stage.statusId}>
                                {stage.statusName}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {(bitrix24EntityType === 'deal' || bitrix24EntityType === 'both') && (
                    <>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Воронка сделки</Label>
                        <Select
                          value={defaultDealCategory?.toString() || ''}
                          onValueChange={handleDealCategoryChange}
                          disabled={loadingPipelines}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Выберите воронку" />
                          </SelectTrigger>
                          <SelectContent>
                            {bitrix24Pipelines?.deals?.map((pipeline) => (
                              <SelectItem key={pipeline.categoryId} value={pipeline.categoryId.toString()}>
                                {pipeline.categoryName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {defaultDealCategory !== null && (
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Этап сделки</Label>
                          <Select
                            value={defaultDealStage || ''}
                            onValueChange={handleDealStageChange}
                            disabled={loadingPipelines}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Выберите этап" />
                            </SelectTrigger>
                            <SelectContent>
                              {bitrix24Pipelines?.deals
                                ?.find((p) => p.categoryId === defaultDealCategory)
                                ?.stages.map((stage) => (
                                  <SelectItem key={stage.statusId} value={stage.statusId}>
                                    {stage.statusName}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </>
                  )}

                  {!bitrix24Pipelines && !loadingPipelines && (
                    <p className="text-xs text-muted-foreground">
                      Нажмите "Обновить" для загрузки воронок из Bitrix24
                    </p>
                  )}

                  {bitrix24Pipelines && (
                    <Button
                      onClick={handleSaveDefaultStages}
                      disabled={!defaultStagesDirty || savingDefaultStages}
                      className="w-full"
                    >
                      {savingDefaultStages ? 'Сохранение...' : 'Сохранить настройки этапов'}
                    </Button>
                  )}
                </div>
              )}

              <Button
                onClick={handleBitrix24Sync}
                variant="outline"
                className="w-full"
                disabled={isSyncingBitrix24}
              >
                {isSyncingBitrix24 ? 'Синхронизация...' : 'Синхронизировать данные вручную'}
              </Button>

              <Button
                onClick={handleBitrix24Disconnect}
                variant="destructive"
                className="w-full"
              >
                Отключить Bitrix24
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* REMOVED: Bitrix24 Qualification Field Modal - now configured at direction level via CAPI settings */}
      </div>
    </div>
  );
};

export default Profile;
