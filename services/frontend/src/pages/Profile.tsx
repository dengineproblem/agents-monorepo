import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '@/components/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Instagram, User, Lock, CheckCircle2, CircleDashed, CalendarDays, Eye, EyeOff, MessageCircle, DollarSign, Plus, X, Key, Users } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import TariffInfoCard from '@/components/profile/TariffInfoCard';
import PageHero from '@/components/common/PageHero';
import ConnectionsGrid from '@/components/profile/ConnectionsGrid';
import DirectionsCard from '@/components/profile/DirectionsCard';
import { FEATURES } from '../config/appReview';
import { useTranslation } from '../i18n/LanguageContext';
 

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
  const storedUser = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
  const user = storedUser ? (() => { try { return JSON.parse(storedUser); } catch { return null; } })() : null;
  const isLoading = !storedUser;

  // Проверка валидности данных пользователя
  useEffect(() => {
    if (storedUser && user && !user.username) {
      console.error('Некорректные данные пользователя: отсутствует username. Выход...');
      localStorage.removeItem('user');
      toast.error('Необходимо войти заново');
      navigate('/login', { replace: true });
    }
  }, []);

  const [tarif, setTarif] = useState<Tarif>(null);
  const [tarifExpires, setTarifExpires] = useState<string | null>(null);
  const [passwordModal, setPasswordModal] = useState(false);
  const [telegramIdModal, setTelegramIdModal] = useState(false);
  
  // Facebook selection modal
  const [facebookSelectionModal, setFacebookSelectionModal] = useState(false);
  const [facebookData, setFacebookData] = useState<any>(null);
  const [selectedAdAccount, setSelectedAdAccount] = useState<string>('');
  const [selectedPage, setSelectedPage] = useState<string>('');
  const [searchAdAccount, setSearchAdAccount] = useState<string>('');
  const [searchPage, setSearchPage] = useState<string>('');
  
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

  // Handle Facebook OAuth callback
  useEffect(() => {
    const handleFacebookCallback = async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const error = params.get('error');

      if (error) {
        console.error('Facebook OAuth error:', error);
        toast.error(`Facebook connection failed: ${error}`);
        window.history.replaceState({}, document.title, '/profile');
        return;
      }

      if (code) {
        try {
          // Проверка наличия username
          console.log('Facebook OAuth callback - проверка пользователя:', {
            hasUser: !!user,
            username: user?.username,
            userId: user?.id
          });

          if (!user?.username) {
            toast.error('Ошибка: необходимо выйти и войти заново');
            console.error('Username отсутствует в localStorage. Данные пользователя:', user);
            window.history.replaceState({}, document.title, '/profile');
            return;
          }

          toast.info('Подключаем Facebook...');

          const API_URL = 'https://performanteaiagency.com/api';
          const requestBody = { 
            code,
            username: user.username
          };
          
          console.log('Отправка запроса на /facebook/oauth/token с данными:', requestBody);

          const response = await fetch(`${API_URL}/facebook/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
          });

          const data = await response.json();
          console.log('Ответ от /facebook/oauth/token:', data);

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
          console.error('Error connecting Facebook:', error);
          toast.error(error instanceof Error ? error.message : 'Failed to connect Facebook');
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
          .select('tarif, tarif_expires, telegram_id, telegram_id_2, telegram_id_3, telegram_id_4, access_token, page_id, tiktok_access_token, tiktok_business_id, plan_daily_budget_cents, default_cpl_target_cents, openai_api_key, ig_seed_audience_id')
          .eq('id', user.id)
          .single() as any);

        if (error) {
          console.error('Ошибка загрузки данных пользователя:', error);
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

          // Обновляем localStorage актуальными данными
          const updatedUser = { ...user, ...data };
          localStorage.setItem('user', JSON.stringify(updatedUser));
        }
      } catch (error) {
        console.error('Ошибка при загрузке данных:', error);
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
      toast.error('Введите текущий пароль');
      return;
    }
    if (!newPassword.trim()) {
      toast.error('Введите новый пароль');
      return;
    }
    if (newPassword.length < 6) {
      toast.error('Новый пароль должен содержать минимум 6 символов');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Пароли не совпадают');
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
        toast.error('Неверный текущий пароль');
        setIsChangingPassword(false);
        return;
      }

      // Если старый пароль верный, меняем на новый
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (updateError) {
        toast.error('Ошибка при смене пароля: ' + updateError.message);
        setIsChangingPassword(false);
        return;
      }

      toast.success('Пароль успешно изменен');
    setPasswordModal(false);
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      console.error('Ошибка при смене пароля:', error);
      toast.error('Произошла ошибка при смене пароля');
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
          toast.error('Ошибка при удалении Telegram ID: ' + error.message);
          return;
        }

        const updatedIds = [...telegramIds];
        updatedIds[editingTelegramIndex] = null;
        setTelegramIds(updatedIds);

        const updatedUser = { ...user, [fieldName]: null };
        localStorage.setItem('user', JSON.stringify(updatedUser));
        
        toast.success('Telegram ID успешно удален');
        setTelegramIdModal(false);
      } catch (error) {
        console.error('Ошибка при удалении Telegram ID:', error);
        toast.error('Произошла ошибка при удалении');
      } finally {
        setIsSavingTelegramId(false);
      }
      return;
    }

    if (!newTelegramId.trim()) {
      toast.error('Введите Telegram ID');
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
        toast.error('Ошибка при сохранении Telegram ID: ' + error.message);
        return;
      }

      const updatedIds = [...telegramIds];
      updatedIds[editingTelegramIndex] = newTelegramId;
      setTelegramIds(updatedIds);

      const updatedUser = { ...user, [fieldName]: newTelegramId };
      localStorage.setItem('user', JSON.stringify(updatedUser));
      
      toast.success('Telegram ID успешно обновлен');
      setTelegramIdModal(false);
    } catch (error) {
      console.error('Ошибка при сохранении Telegram ID:', error);
      toast.error('Произошла ошибка при сохранении');
    } finally {
      setIsSavingTelegramId(false);
    }
  };

  const handleDisconnectInstagram = async () => {
    if (!confirm('Вы уверены, что хотите отключить Instagram?')) {
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
        toast.error('Ошибка при отключении Instagram: ' + error.message);
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
      
      toast.success('Instagram успешно отключен');
      window.location.reload(); // Перезагружаем для обновления UI
    } catch (error) {
      console.error('Ошибка при отключении Instagram:', error);
      toast.error('Произошла ошибка при отключении');
    }
  };

  const handleSaveFacebookSelection = async () => {
    if (!selectedAdAccount || !selectedPage) {
      toast.error('Выберите рекламный кабинет и страницу');
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
      toast.success('Facebook успешно подключен!');
      window.location.reload();

    } catch (error) {
      console.error('Error saving Facebook selection:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to save selection');
    }
  };

  const handleDisconnectTikTok = async () => {
    if (!confirm('Вы уверены, что хотите отключить TikTok?')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('user_accounts')
        .update({ 
          tiktok_access_token: null,
          tiktok_business_id: null,
          tiktok_account_id: null
        })
        .eq('id', user?.id);

      if (error) {
        toast.error('Ошибка при отключении TikTok: ' + error.message);
        return;
      }

      // Обновляем localStorage
      const updatedUser = { 
        ...user, 
        tiktok_access_token: null,
        tiktok_business_id: null,
        tiktok_account_id: null
      };
      localStorage.setItem('user', JSON.stringify(updatedUser));
      
      toast.success('TikTok успешно отключен');
      window.location.reload(); // Перезагружаем для обновления UI
    } catch (error) {
      console.error('Ошибка при отключении TikTok:', error);
      toast.error('Произошла ошибка при отключении');
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
      toast.error('Введите корректное значение максимального бюджета (без пробелов)');
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
        toast.error('Ошибка при сохранении: ' + error.message);
        return;
      }

      // Обновляем localStorage
      const updatedUser = { ...user, plan_daily_budget_cents: maxBudgetCentsValue };
      localStorage.setItem('user', JSON.stringify(updatedUser));
      
      setMaxBudgetCents(maxBudgetCentsValue);
      toast.success('Максимальный бюджет успешно сохранен');
      setMaxBudgetModal(false);
    } catch (error) {
      console.error('Ошибка при сохранении:', error);
      toast.error('Произошла ошибка при сохранении');
    } finally {
      setIsSavingMaxBudget(false);
    }
  };

  const handleSavePlannedCpl = async () => {
    const plannedCplDollars = parseAmount(newPlannedCpl);

    if (plannedCplDollars !== null && (isNaN(plannedCplDollars) || plannedCplDollars < 0)) {
      toast.error('Введите корректное значение плановой стоимости заявки (без пробелов)');
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
        toast.error('Ошибка при сохранении: ' + error.message);
        return;
      }

      // Обновляем localStorage
      const updatedUser = { ...user, default_cpl_target_cents: plannedCplCentsValue };
      localStorage.setItem('user', JSON.stringify(updatedUser));
      
      setPlannedCplCents(plannedCplCentsValue);
      toast.success('Плановая стоимость заявки успешно сохранена');
      setPlannedCplModal(false);
    } catch (error) {
      console.error('Ошибка при сохранении:', error);
      toast.error('Произошла ошибка при сохранении');
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
        toast.error('Некорректный формат ключа OpenAI (должен начинаться с sk-)');
        setIsSavingOpenaiKey(false);
        return;
      }
      
      const { error } = await (supabase
        .from('user_accounts')
        .update({ openai_api_key: keyToSave || null } as any)
        .eq('id', user.id));
      
      if (error) {
        console.error('Ошибка при сохранении:', error);
        toast.error('Ошибка при сохранении: ' + error.message);
        return;
      }
      
      // Обновляем localStorage
      const updatedUser = { ...user, openai_api_key: keyToSave || null };
      localStorage.setItem('user', JSON.stringify(updatedUser));
      
      setOpenaiApiKey(keyToSave);
      toast.success('OpenAI API ключ успешно сохранен');
      setOpenaiModal(false);
      setNewOpenaiKey('');
      setShowOpenaiKey(false);
    } catch (error) {
      console.error('Ошибка при сохранении:', error);
      toast.error('Произошла ошибка при сохранении');
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
        console.error('Ошибка при сохранении:', error);
        toast.error('Ошибка при сохранении: ' + error.message);
        return;
      }
      
      // Обновляем localStorage
      const updatedUser = { ...user, ig_seed_audience_id: idToSave || null };
      localStorage.setItem('user', JSON.stringify(updatedUser));
      
      setAudienceId(idToSave);
      toast.success('ID аудитории успешно сохранен');
      setAudienceModal(false);
      setNewAudienceId('');
    } catch (error) {
      console.error('Ошибка при сохранении:', error);
      toast.error('Произошла ошибка при сохранении');
    } finally {
      setIsSavingAudienceId(false);
    }
  };

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
            />

              {/* Telegram ID Card */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <MessageCircle className="h-5 w-5" />
                    {t('profile.telegramReports')}
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

              {/* Audience ID Card */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Аудитория
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="text-sm text-muted-foreground mb-1">
                        Facebook Custom Audience ID для дублирования кампаний
                      </div>
                      <div className="font-medium font-mono">
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
                    >
                      {audienceId ? 'Изменить' : 'Добавить'}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* OpenAI API Key - скрыт в App Review */}
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

              {/* Направления бизнеса */}
              {FEATURES.SHOW_DIRECTIONS && <DirectionsCard userAccountId={user?.id || null} />}
            </>
          )}

          <ConnectionsGrid
            items={[
              {
                id: 'facebook',
                title: 'Facebook Ads',
                connected: Boolean(user?.access_token && user?.access_token !== '' && user?.ad_account_id && user?.ad_account_id !== ''),
                onClick: () => {
                  if (user?.access_token && user?.access_token !== '' && user?.ad_account_id && user?.ad_account_id !== '') {
                    if (confirm('Вы уверены, что хотите отключить Facebook Ads?')) {
                      handleDisconnectInstagram(); // Reuse the same function as it clears access_token
                    }
                  } else {
                    // Redirect to Facebook OAuth
                    const FB_APP_ID = '1441781603583445';
                    const FB_REDIRECT_URI = 'https://performanteaiagency.com/profile';
                    const FB_SCOPE = 'ads_read,ads_management,business_management,pages_show_list,pages_manage_ads';
                    const authUrl = `https://www.facebook.com/v21.0/dialog/oauth?` +
                      `client_id=${FB_APP_ID}&` +
                      `redirect_uri=${encodeURIComponent(FB_REDIRECT_URI)}&` +
                      `scope=${FB_SCOPE}&` +
                      `response_type=code&` +
                      `state=${Date.now()}`;
                    window.location.href = authUrl;
                  }
                },
                disabled: false,
              },
              {
                id: 'instagram',
                title: 'Instagram',
                connected: Boolean(user?.access_token && user?.access_token !== '' && user?.page_id && user?.page_id !== ''),
                onClick: () => {
                  if (user?.access_token && user?.access_token !== '' && user?.page_id && user?.page_id !== '') {
                    handleDisconnectInstagram();
                  } else {
                    toast.info('Instagram подключается через Facebook API. Используйте подключение Facebook Ads выше.');
                  }
                },
              },
              ...(FEATURES.SHOW_TIKTOK ? [{
                id: 'tiktok',
                title: 'TikTok',
                connected: Boolean(user?.tiktok_access_token && user?.tiktok_business_id),
                onClick: () => {
                  if (user?.tiktok_access_token && user?.tiktok_business_id) {
                    handleDisconnectTikTok();
                  } else {
                  const uid = user?.id || '';
                  const statePayload = { user_id: uid, ts: Date.now() };
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
            ]}
          />
        </div>

        {/* Диалог смены пароля */}
        <Dialog open={passwordModal} onOpenChange={setPasswordModal}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Смена пароля</DialogTitle>
              <DialogDescription>
                Введите текущий пароль и новый пароль для смены.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="old-password">Текущий пароль</Label>
                <div className="relative">
                  <Input 
                    id="old-password"
                    type={showOldPassword ? "text" : "password"}
                    placeholder="Введите текущий пароль" 
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
                <Label htmlFor="new-password">Новый пароль</Label>
                <div className="relative">
                  <Input 
                    id="new-password"
                    type={showNewPassword ? "text" : "password"}
                    placeholder="Введите новый пароль (минимум 6 символов)" 
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
                <Label htmlFor="confirm-password">Повторите новый пароль</Label>
                <div className="relative">
                  <Input 
                    id="confirm-password"
                    type={showConfirmPassword ? "text" : "password"}
                    placeholder="Повторите новый пароль" 
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
                  Отмена
                </Button>
                <Button 
                  onClick={handlePasswordSave}
                  disabled={isChangingPassword}
                >
                  {isChangingPassword ? 'Сохранение...' : 'Сохранить'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Диалог изменения Telegram ID */}
        <Dialog open={telegramIdModal} onOpenChange={setTelegramIdModal}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Изменить Telegram ID</DialogTitle>
              <DialogDescription>
                Введите ваш Telegram ID для получения отчетов.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="telegram-id">Telegram ID</Label>
                <Input 
                  id="telegram-id"
                  type="text"
                  placeholder="Например: 123456789" 
                  value={newTelegramId}
                  onChange={(e) => setNewTelegramId(e.target.value)}
                  disabled={isSavingTelegramId}
                />
                <p className="text-xs text-muted-foreground">
                  Ваш Telegram ID можно узнать у бота @userinfobot
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button 
                  variant="outline" 
                  onClick={() => setTelegramIdModal(false)}
                  disabled={isSavingTelegramId}
                >
                  Отмена
                </Button>
                <Button 
                  onClick={handleTelegramIdSave}
                  disabled={isSavingTelegramId}
                >
                  {isSavingTelegramId ? 'Сохранение...' : 'Сохранить'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Диалог изменения максимального бюджета */}
        <Dialog open={maxBudgetModal} onOpenChange={setMaxBudgetModal}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Изменить максимальный бюджет</DialogTitle>
              <DialogDescription>
                Укажите максимальный дневной бюджет в долларах.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="max-budget">Максимальный бюджет (USD)</Label>
                <Input 
                  id="max-budget"
                  type="text"
                  placeholder="Например: 10000 или 10000.50 или 10000,50" 
                  value={newMaxBudget}
                  onChange={(e) => setNewMaxBudget(e.target.value)}
                  disabled={isSavingMaxBudget}
                />
                <p className="text-xs text-muted-foreground">
                  Можно использовать точку или запятую для десятых. Оставьте пустым, чтобы убрать ограничение.
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button 
                  variant="outline" 
                  onClick={() => setMaxBudgetModal(false)}
                  disabled={isSavingMaxBudget}
                >
                  Отмена
                </Button>
                <Button 
                  onClick={handleSaveMaxBudget}
                  disabled={isSavingMaxBudget}
                >
                  {isSavingMaxBudget ? 'Сохранение...' : 'Сохранить'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Диалог изменения плановой стоимости заявки */}
        <Dialog open={plannedCplModal} onOpenChange={setPlannedCplModal}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Изменить плановую стоимость заявки</DialogTitle>
              <DialogDescription>
                Укажите целевую стоимость одного лида в долларах.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="planned-cpl">Плановая стоимость заявки (USD)</Label>
                <Input 
                  id="planned-cpl"
                  type="text"
                  placeholder="Например: 50 или 50.75 или 50,75" 
                  value={newPlannedCpl}
                  onChange={(e) => setNewPlannedCpl(e.target.value)}
                  disabled={isSavingPlannedCpl}
                />
                <p className="text-xs text-muted-foreground">
                  Можно использовать точку или запятую для десятых. Оставьте пустым, чтобы убрать значение.
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button 
                  variant="outline" 
                  onClick={() => setPlannedCplModal(false)}
                  disabled={isSavingPlannedCpl}
                >
                  Отмена
                </Button>
                <Button 
                  onClick={handleSavePlannedCpl}
                  disabled={isSavingPlannedCpl}
                >
                  {isSavingPlannedCpl ? 'Сохранение...' : 'Сохранить'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Диалог изменения OpenAI API ключа */}
        <Dialog open={openaiModal} onOpenChange={setOpenaiModal}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>OpenAI API ключ</DialogTitle>
              <DialogDescription>
                Укажите ваш API ключ OpenAI для генерации контента. Ключ должен начинаться с "sk-".
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="openai-key">API ключ</Label>
                <div className="relative">
                  <Input 
                    id="openai-key"
                    type={showOpenaiKey ? "text" : "password"}
                    placeholder="sk-..." 
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
                  Оставьте пустым, чтобы удалить ключ.
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
                  Отмена
                </Button>
                <Button 
                  onClick={handleSaveOpenaiKey}
                  disabled={isSavingOpenaiKey}
                >
                  {isSavingOpenaiKey ? 'Сохранение...' : 'Сохранить'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Диалог изменения ID аудитории */}
        <Dialog open={audienceModal} onOpenChange={setAudienceModal}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>ID аудитории</DialogTitle>
              <DialogDescription>
                Укажите Facebook Custom Audience ID для использования при дублировании кампаний агентом Brain.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="audience-id">Audience ID</Label>
                <Input 
                  id="audience-id"
                  type="text"
                  placeholder="Например: 120210000000000000" 
                  value={newAudienceId}
                  onChange={(e) => setNewAudienceId(e.target.value)}
                  disabled={isSavingAudienceId}
                />
                <p className="text-xs text-muted-foreground">
                  ID готовой LAL аудитории из Facebook Ads Manager. Оставьте пустым, чтобы удалить.
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
                  Отмена
                </Button>
                <Button 
                  onClick={handleSaveAudienceId}
                  disabled={isSavingAudienceId}
                >
                  {isSavingAudienceId ? 'Сохранение...' : 'Сохранить'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Диалог выбора Ad Account и Page */}
        <Dialog open={facebookSelectionModal} onOpenChange={setFacebookSelectionModal}>
          <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Выберите рекламный кабинет и страницу</DialogTitle>
              <DialogDescription>
                Выберите рекламный кабинет и Facebook страницу для подключения. 
                Найдено: {facebookData?.ad_accounts.length} рекламных кабинетов и {facebookData?.pages.length} страниц
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Рекламный кабинет</Label>
                <Input
                  placeholder="Поиск по названию..."
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
                  {facebookData?.ad_accounts
                    .filter((account: any) => 
                      searchAdAccount === '' || 
                      account.name.toLowerCase().includes(searchAdAccount.toLowerCase()) ||
                      account.id.includes(searchAdAccount)
                    )
                    .map((account: any) => (
                      <option key={account.id} value={account.id}>
                        {account.name} ({account.id})
                      </option>
                    ))
                  }
                </select>
                <div className="text-xs text-gray-500 mt-1">
                  Показано: {facebookData?.ad_accounts.filter((account: any) => 
                    searchAdAccount === '' || 
                    account.name.toLowerCase().includes(searchAdAccount.toLowerCase()) ||
                    account.id.includes(searchAdAccount)
                  ).length} из {facebookData?.ad_accounts.length}
                </div>
              </div>
              <div>
                <Label>Facebook Page</Label>
                <Input
                  placeholder="Поиск по названию..."
                  value={searchPage}
                  onChange={(e) => setSearchPage(e.target.value)}
                  className="mt-1 mb-2"
                />
                <select
                  className="w-full p-2 border rounded max-h-40 overflow-y-auto"
                  size={5}
                  value={selectedPage}
                  onChange={(e) => setSelectedPage(e.target.value)}
                >
                  {facebookData?.pages
                    .filter((page: any) => 
                      searchPage === '' || 
                      page.name.toLowerCase().includes(searchPage.toLowerCase()) ||
                      page.id.includes(searchPage)
                    )
                    .map((page: any) => (
                      <option key={page.id} value={page.id}>
                        {page.name} ({page.id})
                        {page.instagram_id && ` ✓ IG`}
                      </option>
                    ))
                  }
                </select>
                <div className="text-xs text-gray-500 mt-1">
                  Показано: {facebookData?.pages.filter((page: any) => 
                    searchPage === '' || 
                    page.name.toLowerCase().includes(searchPage.toLowerCase()) ||
                    page.id.includes(searchPage)
                  ).length} из {facebookData?.pages.length}
                </div>
              </div>
              {facebookData?.pages.find((p: any) => p.id === selectedPage)?.instagram_id && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                  <div className="flex items-center gap-2 text-green-700">
                    <CheckCircle2 className="h-4 w-4" />
                    <span className="font-medium">Instagram Business Account подключен</span>
                  </div>
                  <div className="text-sm text-green-600 mt-1">
                    ID: {facebookData?.pages.find((p: any) => p.id === selectedPage)?.instagram_id}
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
                  Отмена
                </Button>
                <Button onClick={handleSaveFacebookSelection}>
                  Сохранить
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default Profile;
