import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Upload, Video, ChevronDown, DollarSign, Rocket, Loader2 } from 'lucide-react';
import { useAppContext } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';
import { salesApi } from '@/services/salesApi';
import { facebookApi } from '@/services/facebookApi';
import { manualLaunchAds, ManualLaunchResponse } from '@/services/manualLaunchApi';
import CallbackRequest from './CallbackRequest';
import { API_BASE_URL } from '@/config/api';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDirections } from '@/hooks/useDirections';
import { OBJECTIVE_LABELS } from '@/types/direction';
import { useNavigate } from 'react-router-dom';
import { Target } from 'lucide-react';
import { APP_REVIEW_MODE } from '../config/appReview';
import { useTranslation } from '../i18n/LanguageContext';

// Основной вебхук для загрузки видео
const DEFAULT_WEBHOOK_URL = 'https://n8n.performanteaiagency.com/webhook/downloadvideo';
const INSTAGRAM_TRAFFIC_WEBHOOK_URL = 'https://n8n.performanteaiagency.com/webhook/instagram-traffic';
const SITE_LEADS_WEBHOOK_URL = 'https://n8n.performanteaiagency.com/webhook/website-leads';
const TIKTOK_VIDEO_WEBHOOK_URL = 'https://n8n.performanteaiagency.com/webhook/tiktok-video';
const MAX_FILE_SIZE = 512 * 1024 * 1024; // 512 МиБ
const MAX_RETRY_ATTEMPTS = 3; // Максимум 3 попытки
const RETRY_DELAYS = [2000, 5000, 10000]; // Задержки между попытками: 2с, 5с, 10с
const DEFAULT_UTM = 'utm_source=facebook&utm_campaign={{campaign.name}}&utm_medium={{adset.name}}&utm_content={{ad.name}}';

// Список городов Казахстана и других стран
// Instagram/Meta IDs сохраняем как были (для IG). Для TikTok используем отдельную карту ID.
const CITIES = [
  { id: 'KZ', name: 'Весь Казахстан' },
  { id: '1289448', name: 'Актау' },
  { id: '1289458', name: 'Актобе' },
  { id: '1289662', name: 'Алматы' },
  { id: '1301648', name: 'Астана' },
  { id: '1290182', name: 'Атырау' },
  { id: '118296', name: 'Баку' },
  { id: 'TASHKENT', name: 'Ташкент' },
  { id: '1293836', name: 'Караганда' },
  { id: '1295460', name: 'Костанай' },
  { id: '1298304', name: 'Павлодар' },
  { id: '1299700', name: 'Семей' },
  { id: '1298077', name: 'Уральск' },
  { id: '1298160', name: 'Усть-Каменогорск' },
  { id: '1300313', name: 'Шымкент' },
];

// TikTok: whitelisted города и их TikTok location_ids (по списку из пользователя)
const TIKTOK_KZ_LOCATION_ID = '1522867'; // Весь Казахстан
const TIKTOK_CITY_IDS: Record<string, string> = {
  // name in RU -> TikTok ID
  'Актау': '610612', // Aqtau
  'Костанай': '94600118', // Kostanay City
  'Атырау': '610529',
  'Кызылорда': '94600065',
  'Семей': '1519422',
  'Усть-Каменогорск': '1520316', // Öskemen
  'Павлодар': '94600073', // Pavlodar City
  'Тараз': '1516905',
  'Актобе': '610611',
  'Караганда': '609655',
  'Шымкент': '94600024',
  'Астана': '1526273',
  'Алматы': '94600135',
};

// Список стран
const COUNTRIES = [
  { code: 'AZ', name: 'Азербайджан' },
  { code: 'BY', name: 'Беларусь' },
  { code: 'KZ', name: 'Казахстан' },
  { code: 'KG', name: 'Кыргызстан' },
  { code: 'UZ', name: 'Узбекистан' },
];

// Список городов и стран для поповера
const CITIES_AND_COUNTRIES = [
  ...CITIES,
  { id: 'AZ', name: 'Азербайджан' },
  { id: 'BY', name: 'Беларусь' },
  { id: 'KG', name: 'Кыргызстан' },
  { id: 'UZ', name: 'Узбекистан' },
  { id: 'US', name: 'США' },
  { id: 'IT', name: 'Италия' },
  { id: 'CA', name: 'Канада' },
  { id: 'SA', name: 'Саудовская Аравия' },
  { id: 'ES', name: 'Испания' },
  { id: 'AE', name: 'ОАЭ' },
  { id: 'AU', name: 'Австралия' },
  { id: 'FR', name: 'Франция' },
  { id: 'DE', name: 'Германия' },
];

function isValidUrl(url: string) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

interface VideoUploadProps {
  showOnlyAddSale?: boolean;
  platform?: 'instagram' | 'tiktok';
}

export function VideoUpload({ showOnlyAddSale = false, platform = 'instagram' }: VideoUploadProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [userData, setUserData] = useState<any>(null);
  const { refreshData } = useAppContext();
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [dailyBudget, setDailyBudget] = useState(10); // по умолчанию 10$ (используется в форме изображений)
  const [dailyBudgetInstagram, setDailyBudgetInstagram] = useState(10); // Instagram (USD)
  const [dailyBudgetTiktok, setDailyBudgetTiktok] = useState(1000); // TikTok (KZT)
  const [startType, setStartType] = useState<'now' | 'midnight'>('midnight');
  const [cityPopoverOpen, setCityPopoverOpen] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState('KZ');
  const [campaignName, setCampaignName] = useState('Новое объявление');
  const [description, setDescription] = useState('Напишите нам, чтобы узнать подробности');
  const [ageMin, setAgeMin] = useState<number | ''>(18); // минимальный возраст
  const [ageMax, setAgeMax] = useState<number | ''>(65); // максимальный возраст
  const [selectedGender, setSelectedGender] = useState<'all' | 'male' | 'female'>('all');
  const [clientQuestion, setClientQuestion] = useState('Здравствуйте! Хочу узнать об этом подробнее.'); // Вопрос клиента
  const [campaignGoal, setCampaignGoal] = useState<'whatsapp' | 'instagram_traffic' | 'site_leads'>('whatsapp'); // Цель объявления
  const [siteUrl, setSiteUrl] = useState<string>('');
  const [pixelId, setPixelId] = useState<string>('');
  const [pixels, setPixels] = useState<Array<{ id: string; name: string }>>([]);
  const [isLoadingPixels, setIsLoadingPixels] = useState(false);
  const [utmTag, setUtmTag] = useState<string>(DEFAULT_UTM);
  const [placement, setPlacement] = useState<'instagram' | 'tiktok' | 'both'>('instagram');
  const [selectedDirectionId, setSelectedDirectionId] = useState<string>('');
  
  // Загрузка списка направлений
  const { directions, loading: directionsLoading } = useDirections(userData?.id || null);
  
  // Автоматически выбираем первое направление если ничего не выбрано
  useEffect(() => {
    if (!directionsLoading && directions.length > 0 && !selectedDirectionId) {
      // Фильтруем по текущей цели, если нужно
      const filtered = directions.filter(d => d.objective === campaignGoal);
      const toSelect = filtered.length > 0 ? filtered[0].id : directions[0].id;
      setSelectedDirectionId(toSelect);
    }
  }, [directions, directionsLoading, selectedDirectionId, campaignGoal]);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isCancelledByUserRef = useRef<boolean>(false);
  const [showVideoForm, setShowVideoForm] = useState(false);
  const [showSaleForm, setShowSaleForm] = useState(false);
  const [salePhone, setSalePhone] = useState('');
  const [saleAmount, setSaleAmount] = useState('');
  const [showCreateLead, setShowCreateLead] = useState(false);
  const [existingCampaigns, setExistingCampaigns] = useState<Array<{id: string, name: string, creative_url?: string}>>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [isLoadingCampaigns, setIsLoadingCampaigns] = useState(false);
  const IMAGE_WEBHOOK_URL = 'https://n8n.performanteaiagency.com/webhook/image';
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [showImageForm, setShowImageForm] = useState(false);
  const [affluentAudience, setAffluentAudience] = useState(false);
  // TikTok WhatsApp phone for ad group (local 10 digits, KZ +7 always)
  const [whatsappPhone, setWhatsappPhone] = useState<string>('');
  // Для кнопки запуска рекламы
  const [launchDialogOpen, setLaunchDialogOpen] = useState(false);
  const [launchLoading, setLaunchLoading] = useState(false);
  const [autoStartMode, setAutoStartMode] = useState<'now' | 'midnight_almaty'>('midnight_almaty');
  
  // Для ручного запуска
  const [manualLaunchDialogOpen, setManualLaunchDialogOpen] = useState(false);
  const [manualLaunchLoading, setManualLaunchLoading] = useState(false);
  const [selectedManualDirection, setSelectedManualDirection] = useState<string>('');
  const [selectedCreativeIds, setSelectedCreativeIds] = useState<string[]>([]);
  const [availableCreatives, setAvailableCreatives] = useState<any[]>([]);
  const [loadingCreatives, setLoadingCreatives] = useState(false);
  const [launchResult, setLaunchResult] = useState<ManualLaunchResponse | null>(null);
  const [resultDialogOpen, setResultDialogOpen] = useState(false);
  const [manualLaunchBudget, setManualLaunchBudget] = useState<number>(10); // Дневной бюджет в USD
  const [manualStartMode, setManualStartMode] = useState<'now' | 'midnight_almaty'>('midnight_almaty');

  useEffect(() => {
    async function fetchUserData() {
      try {
        const storedUser = localStorage.getItem('user');
        const localUserData = storedUser ? JSON.parse(storedUser) : {};
        if (localUserData.id) {
          // ВСЕГДА делаем запрос к Supabase по id
          console.log('Запрашиваем данные пользователя из Supabase:', localUserData.id);
          const { data, error } = await supabase
            .from('user_accounts')
            .select('*')
            .eq('id', localUserData.id)
            .single();
          if (error) {
            console.error('Ошибка загрузки данных пользователя из Supabase:', error);
            setUserData(localUserData); // fallback
          } else if (data) {
            console.log('Получены данные пользователя из Supabase:', data);
            const combinedData = { ...localUserData, ...data };
            localStorage.setItem('user', JSON.stringify(combinedData));
            setUserData(combinedData);
          }
        } else {
          setUserData(localUserData);
        }
      } catch (error) {
        console.error('Ошибка при загрузке данных пользователя:', error);
      }
    }
    fetchUserData();
  }, []);

  // Загружаем пиксели при выборе цели "Лиды на сайте"
  useEffect(() => {
    const loadPixels = async () => {
      if (campaignGoal !== 'site_leads') return;
      setIsLoadingPixels(true);
      try {
        const list = await facebookApi.getPixels();
        setPixels(list || []);
      } catch (e) {
        setPixels([]);
      } finally {
        setIsLoadingPixels(false);
      }
    };
    loadPixels();
  }, [campaignGoal]);

  // Загружаем дефолтные настройки при смене цели кампании
  useEffect(() => {
    const loadDefaultSettings = async () => {
      if (!userData?.id) return;
      
      try {
        const { data, error } = await supabase
          .from('default_ad_settings')
          .select('*')
          .eq('user_id', userData.id)
          .eq('campaign_goal', campaignGoal)
          .maybeSingle();

        if (error) {
          console.error('Ошибка загрузки дефолтных настроек:', error);
          return;
        }

        if (data) {
          console.log('Загружены дефолтные настройки:', data);
          // Применяем настройки
          if (data.cities && data.cities.length > 0) {
            setSelectedCities(data.cities);
          }
          if (data.age_min !== null && data.age_min !== undefined) {
            setAgeMin(data.age_min);
          }
          if (data.age_max !== null && data.age_max !== undefined) {
            setAgeMax(data.age_max);
          }
          if (data.gender) {
            setSelectedGender(data.gender as 'all' | 'male' | 'female');
          }
          if (data.description) {
            setDescription(data.description);
          }
          
          // Специфичные для каждой цели
          if (campaignGoal === 'whatsapp' && data.client_question) {
            setClientQuestion(data.client_question);
          }
          if (campaignGoal === 'instagram_traffic' && data.instagram_url) {
            // instagramUrl нужно найти где он определен
            // Возможно это поле не существует, пропустим пока
          }
          if (campaignGoal === 'site_leads') {
            if (data.site_url) setSiteUrl(data.site_url);
            if (data.pixel_id) setPixelId(data.pixel_id);
            if (data.utm_tag) setUtmTag(data.utm_tag);
          }
          
          // Настройки применены тихо, без уведомления
        }
      } catch (error) {
        console.error('Ошибка при загрузке дефолтных настроек:', error);
      }
    };
    
    loadDefaultSettings();
  }, [campaignGoal, userData?.id]);

  // Загрузка креативов при выборе направления для ручного запуска
  useEffect(() => {
    const loadCreatives = async () => {
      if (!selectedManualDirection || !userData?.id) {
        setAvailableCreatives([]);
        return;
      }

      setLoadingCreatives(true);
      try {
        const { data, error } = await supabase
          .from('user_creatives')
          .select('*')
          .eq('user_id', userData.id)
          .eq('direction_id', selectedManualDirection)
          .eq('is_active', true)
          .eq('status', 'ready')
          .order('created_at', { ascending: false });

        if (error) {
          console.error('Ошибка загрузки креативов:', error);
          toast.error('Не удалось загрузить креативы');
          setAvailableCreatives([]);
        } else {
          setAvailableCreatives(data || []);
        }
      } catch (error) {
        console.error('Ошибка при загрузке креативов:', error);
        setAvailableCreatives([]);
      } finally {
        setLoadingCreatives(false);
      }
    };

    loadCreatives();
  }, [selectedManualDirection, userData?.id]);

  // Обработчик ручного запуска рекламы
  const handleManualLaunch = async () => {
    if (!userData?.id) {
      toast.error('Пользователь не авторизован');
      return;
    }

    if (!selectedManualDirection) {
      toast.error('Выберите направление');
      return;
    }

    if (selectedCreativeIds.length === 0) {
      toast.error('Выберите хотя бы один креатив');
      return;
    }

    if (manualLaunchBudget < 10) {
      toast.error('Минимальный бюджет - $10');
      return;
    }

    setManualLaunchLoading(true);

    try {
      const result = await manualLaunchAds({
        user_account_id: userData.id,
        direction_id: selectedManualDirection,
        creative_ids: selectedCreativeIds,
        start_mode: manualStartMode,
        daily_budget_cents: Math.round(manualLaunchBudget * 100), // Конвертируем в центы
      });

      if (result.success) {
        setLaunchResult(result);
        setManualLaunchDialogOpen(false);
        setResultDialogOpen(true);
        toast.success(result.message || 'Реклама успешно запущена!');
        
        // Сброс формы
        setSelectedManualDirection('');
        setSelectedCreativeIds([]);
        setAvailableCreatives([]);
        setManualLaunchBudget(10);
        setManualStartMode('midnight_almaty');
      } else {
        toast.error(result.error || 'Ошибка запуска рекламы');
      }
    } catch (error: any) {
      console.error('Ошибка запуска рекламы:', error);
      toast.error(error.message || 'Ошибка запуска рекламы');
    } finally {
      setManualLaunchLoading(false);
    }
  };

  // Функция для определения типа ошибки
  const isWorkflowError = (status: number, responseText: string) => {
    // HTTP 500 = ошибка workflow в n8n
    if (status === 500) return true;
    
    // HTTP 4xx = клиентские ошибки (могут быть workflow)
    if (status >= 400 && status < 500) return true;
    
    // Статус 0 обычно означает CORS или сетевую ошибку
    if (status === 0) return false;
    
    return false;
  };

  // Функция для отмены всех запланированных retry
  const cancelRetryAttempts = () => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    setIsRetrying(false);
    setRetryAttempt(0);
  };

  // Функция для попытки retry
  const attemptRetry = (formData: FormData, webhookUrl: string, currentAttempt: number = retryAttempt) => {
    console.log(`attemptRetry вызван с currentAttempt: ${currentAttempt}, MAX_RETRY_ATTEMPTS: ${MAX_RETRY_ATTEMPTS}`);
    
    const nextAttempt = currentAttempt + 1;
    console.log(`nextAttempt: ${nextAttempt}`);
    
    if (nextAttempt > MAX_RETRY_ATTEMPTS) {
      console.log(`Достигнут лимит попыток: ${nextAttempt} > ${MAX_RETRY_ATTEMPTS}`);
      toast.error(`Не удалось загрузить файл после ${MAX_RETRY_ATTEMPTS} попыток`);
      setIsUploading(false);
      setIsRetrying(false);
      setRetryAttempt(0);
      setProgress(0);
      return;
    }

    const delay = RETRY_DELAYS[nextAttempt - 1] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
    
    // Обновляем счетчик сразу для UI
    setRetryAttempt(nextAttempt);
    setIsRetrying(true);
    toast.info(`Повторная попытка ${nextAttempt}/${MAX_RETRY_ATTEMPTS} через ${delay/1000} сек...`);
    
    // Отменяем предыдущий timeout если есть
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
    }
    
    // Сохраняем ссылку на новый timeout
    retryTimeoutRef.current = setTimeout(() => {
      retryTimeoutRef.current = null;
      performUpload(formData, webhookUrl, nextAttempt);
    }, delay);
  };

  // Основная функция загрузки
  const performUpload = (formData: FormData, webhookUrl: string, currentAttempt: number = retryAttempt, fileType: 'video' | 'image' = 'video') => {
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;

    xhr.open('POST', webhookUrl, true);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        setProgress(percent);
      }
    };

    const updateCurrentCampaignGoal = async (goal: 'whatsapp' | 'instagram_traffic' | 'site_leads') => {
      try {
        const storedUser = localStorage.getItem('user');
        const localUserData = storedUser ? JSON.parse(storedUser) : {};
        if (!localUserData.id) return;
        const { error } = await supabase
          .from('user_accounts')
          .update({ current_campaign_goal: goal, current_campaign_goal_changed_at: new Date().toISOString() })
          .eq('id', localUserData.id);
        if (error) {
          console.error('Не удалось обновить current_campaign_goal:', error);
          return;
        }
        const updated = { ...localUserData, current_campaign_goal: goal, current_campaign_goal_changed_at: new Date().toISOString() };
        localStorage.setItem('user', JSON.stringify(updated));
      } catch (e) {
        console.error('Ошибка при обновлении current_campaign_goal:', e);
      }
    };

    xhr.onload = function () {
      if (isCancelledByUserRef.current) {
        return;
      }
      const status = xhr.status;
      const responseText = xhr.responseText;
      if (status >= 200 && status < 300) {
        cancelRetryAttempts();
        toast.success(fileType === 'image' ? 'Изображение успешно загружено!' : 'Видео успешно загружено!');
        setProgress(100);
        // фиксируем выбранную цель кампании для последующей оптимизации
        updateCurrentCampaignGoal(campaignGoal);
        setTimeout(() => {
          if (fileType === 'video') {
            setSelectedFile(null);
            const input = document.getElementById('video-upload') as HTMLInputElement | null;
            if (input) input.value = '';
          } else {
            setSelectedImage(null);
            const input = document.getElementById('image-upload') as HTMLInputElement | null;
            if (input) input.value = '';
            setShowImageForm(false);
          }
          // Сбрасываем все настройки формы
          setCampaignName('Новое объявление');
          setDescription('Напишите нам, чтобы узнать подробности');
          setSelectedCities([]);
          setDailyBudget(10);
          setDailyBudgetInstagram(10);
          setDailyBudgetTiktok(1000);
          setStartType('midnight');
          setAgeMin(18);
          setAgeMax(65);
          setSelectedGender('all');
          setSiteUrl('');
          setPixelId('');
          setUtmTag('');
          refreshData();
          setIsUploading(false);
          setIsRetrying(false);
          setRetryAttempt(0);
          setProgress(0);
        }, 2000);
      } else if (isWorkflowError(status, responseText)) {
        if (currentAttempt === 0) {
          toast.error(fileType === 'image' ? 'Ошибка при загрузке изображения. Обратитесь в службу технической поддержки за решением.' : 'Ошибка при загрузке видео. Обратитесь в службу технической поддержки за решением.');
        }
        setIsRetrying(true);
        setRetryAttempt(currentAttempt + 1);
        attemptRetry(formData, webhookUrl, currentAttempt);
      } else {
        cancelRetryAttempts();
        toast.success(fileType === 'image' ? 'Изображение успешно загружено!' : 'Видео успешно загружено!');
        setProgress(100);
        // фиксируем выбранную цель кампании для последующей оптимизации
        updateCurrentCampaignGoal(campaignGoal);
        setTimeout(() => {
          if (fileType === 'video') {
            setSelectedFile(null);
            const input = document.getElementById('video-upload') as HTMLInputElement | null;
            if (input) input.value = '';
          } else {
            setSelectedImage(null);
            const input = document.getElementById('image-upload') as HTMLInputElement | null;
            if (input) input.value = '';
            setShowImageForm(false);
          }
          // Сбрасываем все настройки формы
          setCampaignName('Новое объявление');
          setDescription('Напишите нам, чтобы узнать подробности');
          setSelectedCities([]);
          setDailyBudget(10);
          setDailyBudgetInstagram(10);
          setDailyBudgetTiktok(1000);
          setStartType('midnight');
          setAgeMin(18);
          setAgeMax(65);
          setSelectedGender('all');
          setSiteUrl('');
          setPixelId('');
          setUtmTag('');
          refreshData();
          setIsUploading(false);
          setIsRetrying(false);
          setRetryAttempt(0);
          setProgress(0);
        }, 2000);
      }
    };
    xhr.onerror = function () {
      if (isCancelledByUserRef.current) {
        return;
      }
      const status = xhr.status;
      const responseText = xhr.responseText;
      if (isWorkflowError(status, responseText)) {
        if (currentAttempt === 0) {
          toast.error(fileType === 'image' ? 'Ошибка при загрузке изображения. Обратитесь в службу технической поддержки за решением.' : 'Ошибка при загрузке видео. Обратитесь в службу технической поддержки за решением.');
        }
        setIsRetrying(true);
        setRetryAttempt(currentAttempt + 1);
        attemptRetry(formData, webhookUrl, currentAttempt);
      } else {
        cancelRetryAttempts();
        toast.success(fileType === 'image' ? 'Изображение успешно загружено!' : 'Видео успешно загружено!');
        if (fileType === 'video') {
          setSelectedFile(null);
          const input = document.getElementById('video-upload') as HTMLInputElement | null;
          if (input) input.value = '';
        } else {
          setSelectedImage(null);
          const input = document.getElementById('image-upload') as HTMLInputElement | null;
          if (input) input.value = '';
          setShowImageForm(false);
        }
          // Сбрасываем все настройки формы
        setCampaignName('Новое объявление');
        setDescription('Напишите нам, чтобы узнать подробности');
        setSelectedCities([]);
        setDailyBudget(10);
        setDailyBudgetInstagram(10);
        setDailyBudgetTiktok(1000);
        setStartType('midnight');
        setAgeMin(18);
        setAgeMax(65);
        setSelectedGender('all');
          setSiteUrl('');
          setPixelId('');
          setUtmTag('');
          setClientQuestion('Здравствуйте! Хочу узнать об этом подробнее.');
        refreshData();
        setIsUploading(false);
        setIsRetrying(false);
        setRetryAttempt(0);
        setProgress(0);
      }
    };
    xhr.send(formData);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      toast.error('Файл слишком большой (максимум 512 МБ)');
      console.error('Ограничение: файл превышает 512 МБ, размер:', file.size);
      return;
    }
    if (!file.type.startsWith('video/')) {
      toast.error('Пожалуйста, выберите видео-файл');
      console.error('Выбран не видео-файл:', file.type);
      return;
    }
    setSelectedFile(file);
    
    // Для TikTok автоматически устанавливаем площадку и цель
    if (platform === 'tiktok') {
      setPlacement('tiktok');
      setCampaignGoal('whatsapp');
    }
    
    setShowVideoForm(true); // Автоматически показываем форму после выбора файла
    toast.info(`Выбран файл: ${file.name}`);
    console.log('Файл выбран для загрузки:', file.name, 'Размер:', file.size, 'Тип:', file.type);
    // Сбрасываем value, чтобы повторный выбор того же файла снова триггерил onChange
    try {
      (event.target as HTMLInputElement).value = '';
    } catch {}
  };

  const COUNTRY_IDS = ['KZ', 'BY', 'KG', 'UZ', 'US', 'IT', 'CA', 'SA', 'ES', 'AE', 'AU', 'FR', 'DE'];

  const handleCitySelection = (cityId: string) => {
    // Рассчитываем новое множество выбранных локаций синхронно
    let nextSelection = [...selectedCities];
    if (nextSelection.includes(cityId)) {
      nextSelection = nextSelection.filter(id => id !== cityId);
    } else {
      if (cityId === 'KZ') {
        nextSelection = ['KZ'];
      } else {
        nextSelection = nextSelection.filter(id => id !== 'KZ');
        nextSelection = [...nextSelection, cityId];
      }
    }
    setSelectedCities(nextSelection);

    // Вспомогательные функции для автоподстановки города
    const getCityNameById = (id: string): string | null => {
      const found = CITIES_AND_COUNTRIES.find(c => c.id === id);
      return found ? found.name : null;
    };
    const extractSingleCityName = (selection: string[]): string | null => {
      if (selection.length !== 1) return null;
      const only = selection[0];
      if (only === 'KZ') return null;
      if (COUNTRY_IDS.includes(only)) return null;
      if (only === 'TASHKENT') return 'Ташкент';
      return getCityNameById(only);
    };
    const stripDescCityPrefix = (text: string): string => {
      // Убираем лидирующий префикс типа "📍 Алматы. "
      return text.replace(/^📍\s+[\p{L}\-]+\.?\s*/u, '');
    };
    const stripQuestionCitySuffix = (text: string): string => {
      // Убираем суффикс типа " Я из Алматы."/" Я из Алматы"
      return text.replace(/\s*Я из\s+[^.!?]+[.!?]?$/u, '');
    };

    const toCityGenitive = (name: string): string => {
      const map: Record<string, string> = {
        'Актау': 'Актау',
        'Актобе': 'Актобе',
        'Алматы': 'Алматы',
        'Астана': 'Астаны',
        'Атырау': 'Атырау',
        'Баку': 'Баку',
        'Караганда': 'Караганды',
        'Костанай': 'Костаная',
        'Павлодар': 'Павлодара',
        'Семей': 'Семея',
        'Уральск': 'Уральска',
        'Усть-Каменогорск': 'Усть-Каменогорска',
        'Шымкент': 'Шымкента',
      };
      return map[name] || name;
    };

    const singleCityName = extractSingleCityName(nextSelection);
    // Описание: префикс с гео-эмодзи
    setDescription(prev => {
      const base = stripDescCityPrefix(prev || '');
      if (singleCityName) {
        return `📍 ${singleCityName}. ${base}`.trim();
      }
      return base;
    });

    // Вопрос для WhatsApp: добавляем суффикс, только если выбрана цель whatsapp
    if (campaignGoal === 'whatsapp') {
      setClientQuestion(prev => {
        const base = stripQuestionCitySuffix(prev || '');
        if (singleCityName) {
          const gen = toCityGenitive(singleCityName);
          return `${base}${base ? ' ' : ''}Я из ${gen}.`;
        }
        return base;
      });
    } else {
      // Если цель не whatsapp, просто очищаем возможный автосуффикс, чтобы не мешал
      setClientQuestion(prev => stripQuestionCitySuffix(prev || ''));
    }
  };

  const getSelectedCitiesText = () => {
    if (selectedCities.length === 0) return 'Выберите города или страны';
    if (selectedCities.includes('KZ')) return 'Весь Казахстан';
    
    const selectedNames = selectedCities.map(id => {
      const city = CITIES_AND_COUNTRIES.find(c => c.id === id);
      return city ? city.name : id;
    });
    
    if (selectedNames.length > 2) {
      return `${selectedNames.slice(0, 2).join(', ')} и еще ${selectedNames.length - 2}`;
    }
    return selectedNames.join(', ');
  };

  const handleBudgetChange = (delta: number) => {
    setDailyBudget(prev => Math.max(1, prev + delta));
  };
  const handleInstagramBudgetChange = (delta: number) => {
    setDailyBudgetInstagram(prev => Math.max(1, prev + delta));
  };
  const handleTiktokBudgetChange = (delta: number) => {
    setDailyBudgetTiktok(prev => Math.max(100, prev + delta * 100));
  };

  const getGendersArray = (): number[] => {
    switch (selectedGender) {
      case 'male': return [1];
      case 'female': return [2];
      case 'all':
      default: return [1, 2];
    }
  };

  const uploadVideo = async () => {
    if (!selectedFile) {
      toast.error('Пожалуйста, выберите файл для загрузки');
      return;
    }
    if (selectedCities.length === 0) {
      toast.error('Пожалуйста, выберите город или "Весь Казахстан"');
      return;
    }
    // Валидация бюджетов по площадкам
    if (placement === 'instagram') {
      if (!dailyBudgetInstagram || Number(dailyBudgetInstagram) <= 0) {
        toast.error('Пожалуйста, укажите суточный бюджет для Instagram (USD)');
        return;
      }
    } else if (placement === 'tiktok') {
      if (!dailyBudgetTiktok || Number(dailyBudgetTiktok) <= 0) {
        toast.error('Пожалуйста, укажите суточный бюджет для TikTok (KZT)');
        return;
      }
    } else if (placement === 'both') {
      if (!dailyBudgetInstagram || Number(dailyBudgetInstagram) <= 0) {
        toast.error('Пожалуйста, укажите суточный бюджет для Instagram (USD)');
        return;
      }
      if (!dailyBudgetTiktok || Number(dailyBudgetTiktok) <= 0) {
        toast.error('Пожалуйста, укажите суточный бюджет для TikTok (KZT)');
        return;
      }
    }
    if (!(selectedFile instanceof File)) {
      toast.error('Ошибка: выбранный файл не является File-объектом!');
      console.error('video_file не является File:', selectedFile);
      return;
    }
    if (!campaignName.trim()) {
      toast.error('Пожалуйста, введите название объявления');
      return;
    }
    if (ageMin === '' || ageMax === '' || ageMin > ageMax) {
      toast.error('Проверьте корректность возрастного диапазона');
      return;
    }

    setIsUploading(true);
    setProgress(0);
    setIsRetrying(false);
    setRetryAttempt(0);
    isCancelledByUserRef.current = false;

    try {
      const actualUserData = userData || {};
      console.log('userData перед отправкой:', actualUserData);
      
      const form = new FormData();
      if (actualUserData.id) form.append('user_id', actualUserData.id);
      if (selectedDirectionId) form.append('direction_id', selectedDirectionId);
      if (actualUserData.instagram_id) form.append('instagram_id', actualUserData.instagram_id);
      if (actualUserData.telegram_id) form.append('telegram_id', actualUserData.telegram_id);
      if (actualUserData.telegram_bot_token) form.append('telegram_bot_token', actualUserData.telegram_bot_token);
      if (actualUserData.access_token) form.append('page_access_token', actualUserData.access_token);
      if (actualUserData.page_id) form.append('page_id', actualUserData.page_id);
      if (actualUserData.ad_account_id) form.append('ad_account_id', actualUserData.ad_account_id);
      // TikTok identifiers from Supabase/localStorage
      if (actualUserData.tiktok_business_id) form.append('tiktok_business_id', actualUserData.tiktok_business_id);
      if (actualUserData.tiktok_account_id) form.append('tiktok_account_id', actualUserData.tiktok_account_id);
      if (actualUserData.tiktok_access_token) form.append('tiktok_access_token', actualUserData.tiktok_access_token);
      if (actualUserData.prompt1) form.append('prompt1', actualUserData.prompt1);
      if (actualUserData.prompt2) form.append('prompt2', actualUserData.prompt2);
      if (actualUserData.prompt3) form.append('prompt3', actualUserData.prompt3);
      if (actualUserData.username) form.append('username', actualUserData.username);
      
      // Название объявления и текст под видео как переменные
      form.append('campaign_name', campaignName);
      form.append('ad_text', description || 'Напишите в WhatsApp');
      // TikTok WhatsApp settings (цель фиксирована)
      if (placement === 'tiktok' || placement === 'both') {
        const digits = (whatsappPhone || '').replace(/[^0-9]/g, '');
        if (digits.length === 10) {
          form.append('phone_region_code', 'KZ');
          form.append('phone_region_calling_code', '+7');
          form.append('phone_number', digits);
        }
      }
      if (campaignGoal === 'site_leads') {
        form.append('site_url', siteUrl);
        form.append('facebook_pixel_id', pixelId);
        if (utmTag) form.append('utm', utmTag);
      }
      
      // Разделяем выбранные id на страны и города
      let countries: string[] = [];
      let cities: any[] = [];
      selectedCities.forEach(id => {
        // Ташкент считаем как Узбекистан
        if (id === 'TASHKENT') {
          countries.push('UZ');
          return;
        }
        if (id === 'KZ') {
          countries.push('KZ');
        } else if (COUNTRY_IDS.includes(id)) {
          countries.push(id);
        } else {
          cities.push({ key: id, radius: 20, distance_unit: 'kilometer' });
        }
      });
      let geo_locations: any = {};
      if (countries.length > 0) geo_locations.countries = countries;
      if (cities.length > 0) geo_locations.cities = cities;
      form.append('geo_locations', JSON.stringify(geo_locations));

      // TikTok: отдельная географическая структура (используем whitelisted города и IDs)
      if (placement === 'tiktok' || placement === 'both') {
        // Правило: для TikTok разрешены только список городов из TIKTOK_CITY_IDS и весь Казахстан
        const locationIds: string[] = [];
        if (selectedCities.includes('KZ')) {
          locationIds.push(TIKTOK_KZ_LOCATION_ID);
        } else {
          selectedCities.forEach(id => {
            const cityName = (CITIES_AND_COUNTRIES.find(c => c.id === id) as any)?.name || '';
            const ttId = TIKTOK_CITY_IDS[cityName];
            if (ttId) locationIds.push(ttId);
          });
        }
        // Если ничего валидного не выбрано — не добавляем поле, n8n/бэкенд сам решит дефолт
        if (locationIds.length > 0) {
          form.append('tiktok_location_ids', JSON.stringify(locationIds));
          // Дублируем под каноническое имя для ноды n8n
          form.append('location_ids', JSON.stringify(locationIds));
        }
      }
      
      // Передаем дневной бюджет(ы) в зависимости от площадки
      if (placement === 'both') {
        // Instagram — USD в центах, TikTok — KZT без умножения
        const instagramBudgetInCents = Math.round(Number(dailyBudgetInstagram) * 100);
        form.append('daily_budget_instagram', String(instagramBudgetInCents));
        form.append('daily_budget_tiktok', String(Math.round(Number(dailyBudgetTiktok))));
        console.log('Бюджеты: IG (¢)', instagramBudgetInCents, 'TT (₸)', dailyBudgetTiktok);
      } else if (placement === 'tiktok') {
        // TikTok — бюджет в тенге, НЕ умножаем
        form.append('daily_budget_tiktok', String(Math.round(Number(dailyBudgetTiktok))));
        console.log('Дневной бюджет TikTok (₸):', dailyBudgetTiktok);
      } else {
        // Instagram — бюджет в долларах, в центах
        const budgetInCents = Math.round(Number(dailyBudgetInstagram) * 100);
        form.append('daily_budget', String(budgetInCents));
        console.log('Дневной бюджет Instagram (¢):', budgetInCents);
      }
      
      // Передаем тип запуска
      form.append('start_type', startType);
      console.log('Тип запуска:', startType);
      
      // Передаем возрастные ограничения
      let min = Number(ageMin);
      let max = Number(ageMax);
      if (isNaN(min) || min < 18) min = 18;
      if (min > 65) min = 65;
      if (isNaN(max) || max > 65) max = 65;
      if (max < 18) max = 18;
      if (min > max) min = max;
      if (max < min) max = min;
      form.append('age_min', String(min));
      form.append('age_max', String(max));
      // TikTok age groups mapping: выбираем те группы, которые покрывают бОльшую часть выбранного интервала
      if (placement === 'tiktok' || placement === 'both') {
        const buckets = [
          { from: 18, to: 24, label: 'AGE_18_24' },
          { from: 25, to: 34, label: 'AGE_25_34' },
          { from: 35, to: 44, label: 'AGE_35_44' },
          { from: 45, to: 54, label: 'AGE_45_54' },
          { from: 55, to: 100, label: 'AGE_55_100' },
        ];
        const selected: string[] = [];
        const totalSpan = Math.max(0, (max - min + 1));
        buckets.forEach(b => {
          const overlapStart = Math.max(min, b.from);
          const overlapEnd = Math.min(max, b.to);
          const overlap = Math.max(0, overlapEnd - overlapStart + 1);
          // Берем бакет, если перекрытие >= 50% самого бакета или >= 50% выбранного диапазона
          const bucketSize = b.to - b.from + 1;
          if (overlap >= 0.5 * bucketSize || (totalSpan > 0 && overlap >= 0.5 * totalSpan)) {
            selected.push(b.label);
          }
        });
        if (selected.length === 0) {
          // fallback: обычное покрытие по пересечению
          buckets.forEach(b => {
            if (min <= b.to && max >= b.from) selected.push(b.label);
          });
        }
        const uniqueSelected = Array.from(new Set(selected));
        form.append('tiktok_age_groups', JSON.stringify(uniqueSelected));
        // Дублируем под каноническое имя для ноды n8n
        form.append('age_groups', JSON.stringify(uniqueSelected));
      }
      console.log('Возрастная группа:', min, '-', max);
      
      // Передаем пол
      form.append('genders', JSON.stringify(getGendersArray()));
      // TikTok gender mapping
      if (placement === 'tiktok' || placement === 'both') {
        const ttGender = selectedGender === 'male' ? 'GENDER_MALE' : selectedGender === 'female' ? 'GENDER_FEMALE' : 'GENDER_UNLIMITED';
        form.append('tiktok_gender', ttGender);
      }
      console.log('Выбранный пол:', selectedGender, '- массив:', getGendersArray());
      
      form.append('video_file', selectedFile);
      
      const fileInForm = form.get('video_file');
      if (!(fileInForm instanceof File)) {
        toast.error('Ошибка: video_file в FormData не является File!');
        console.error('video_file в FormData не File:', fileInForm);
        return;
      }
      
      let webhookUrl = DEFAULT_WEBHOOK_URL;
      
      // Выбираем webhook на основе площадки и цели объявления
      if (placement === 'tiktok') {
        webhookUrl = TIKTOK_VIDEO_WEBHOOK_URL;
        console.log('Используем webhook для TikTok:', webhookUrl);
      } else if (placement === 'instagram') {
        if (campaignGoal === 'site_leads') {
          webhookUrl = SITE_LEADS_WEBHOOK_URL;
          console.log('Используем webhook для Site Leads:', webhookUrl);
        } else if (campaignGoal === 'instagram_traffic') {
          webhookUrl = INSTAGRAM_TRAFFIC_WEBHOOK_URL;
          console.log('Используем webhook для Instagram traffic:', webhookUrl);
        } else if (actualUserData.webhook_url && String(actualUserData.webhook_url).trim() !== '') {
          webhookUrl = actualUserData.webhook_url;
          console.log('Используем индивидуальный webhook URL из Supabase:', webhookUrl);
        } else {
          console.log('В Supabase не найден индивидуальный webhook, используем стандартный:', webhookUrl);
        }
      } else if (placement === 'both') {
        // Для обеих площадок отправляем на общий вебхук, который умеет форкать; если нет — по умолчанию Instagram
        // При наличии отдельного мульти-вебхука — заменить URL
        if (campaignGoal === 'site_leads') {
          webhookUrl = SITE_LEADS_WEBHOOK_URL;
        } else if (campaignGoal === 'instagram_traffic') {
          webhookUrl = INSTAGRAM_TRAFFIC_WEBHOOK_URL;
        }
        console.log('Выбраны обе площадки, используем Instagram маршрут и передаем оба бюджета');
      }
      
      if (!isValidUrl(webhookUrl)) {
        toast.error('Некорректный адрес webhook!');
        console.error('Некорректный webhookUrl:', webhookUrl);
        return;
      }

      performUpload(form, webhookUrl, 0, 'video');
      
    } catch (error) {
      console.error('Ошибка при загрузке видео:', error);
      toast.error('Ошибка при загрузке видео: ' + (error instanceof Error ? error.message : 'Неизвестная ошибка'));
      setIsUploading(false);
      setProgress(0);
    }
  };

  const cancelUpload = () => {
    // Устанавливаем флаг что отменено пользователем
    isCancelledByUserRef.current = true;
    
    // Прерываем текущий запрос если есть
    if (xhrRef.current) {
      xhrRef.current.abort();
      xhrRef.current = null;
    }
    
    cancelRetryAttempts();
    setIsUploading(false);
    setIsRetrying(false);
    setRetryAttempt(0);
    setProgress(0);
    toast.info('Загрузка отменена');
  };

  const handleSaleSubmit = async () => {
    if (!salePhone || !saleAmount) {
      toast.error('Заполните все поля: телефон и сумма');
      return;
    }

            // Валидация номера телефона
    const cleanPhone = salePhone.replace(/[\s\-\(\)]/g, '');
    let normalizedPhone = cleanPhone;
    
    // Убираем + если есть
    if (normalizedPhone.startsWith('+')) {
      normalizedPhone = normalizedPhone.substring(1);
    }
    
    // Если начинается с 8, заменяем на 7
    if (normalizedPhone.startsWith('8') && normalizedPhone.length === 11) {
      normalizedPhone = '7' + normalizedPhone.substring(1);
    }
    
    // Если начинается с 77 (12 цифр), убираем первую 7
    if (normalizedPhone.startsWith('77') && normalizedPhone.length === 12) {
      normalizedPhone = normalizedPhone.substring(1);
    }

    const phoneRegex = /^7[0-9]{10}$/;
    if (!phoneRegex.test(normalizedPhone)) {
      toast.error('Введите корректный номер телефона в формате 77079808026');
      return;
    }

    // Валидация суммы
    const amount = Number(saleAmount);
    if (amount <= 0) {
      toast.error('Сумма должна быть больше 0');
      return;
    }

    setIsUploading(true);
    
    try {
      const businessId = await salesApi.getCurrentUserBusinessId();
      if (!businessId) {
        toast.error('Business ID не найден. Обратитесь к администратору.');
        return;
      }

      // Добавляем продажу в таблицу purchases
      await salesApi.addSale({
        client_phone: normalizedPhone,
        amount: amount,
        business_id: businessId
      });
      
      toast.success('Продажа успешно добавлена! 🎉');
      setSalePhone('');
      setSaleAmount('');
      setShowSaleForm(false);
      
    } catch (error) {
      console.error('Ошибка добавления продажи:', error);
      
      if (error instanceof Error && error.message.includes('не найден в базе лидов')) {
        // Лид не найден - показываем форму выбора креатива
        setShowCreateLead(true);
        loadExistingCampaigns();
      } else {
        let errorMessage = 'Не удалось добавить продажу. Попробуйте еще раз.';
        
        if (error instanceof Error) {
          if (error.message.includes('уже существует')) {
            errorMessage = 'Продажа для этого клиента уже существует в системе.';
          } else if (error.message.includes('Business ID')) {
            errorMessage = 'Ошибка авторизации. Попробуйте перезайти в систему.';
          } else {
            errorMessage = error.message;
          }
        }
        
        toast.error(errorMessage);
      }
    } finally {
      setIsUploading(false);
    }
  };

  // Запуск рекламы
  const handleLaunchAd = async () => {
    setLaunchLoading(true);
    
    try {
      const storedUser = localStorage.getItem('user');
      if (!storedUser) {
        toast.error('Пользователь не авторизован');
        return;
      }
      
      const userData = JSON.parse(storedUser);
      const userId = userData.id;
      
      if (!userId) {
        toast.error('ID пользователя не найден');
        return;
      }

      console.log('Запускаем рекламу для всех активных направлений:', { userId });

      // Отправляем запрос на новый endpoint (v2) - создаст кампании для всех активных направлений
      const response = await fetch(`${API_BASE_URL}/api/campaign-builder/auto-launch-v2`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_account_id: userId,
          start_mode: autoStartMode,
        }),
      });

      const data = await response.json();

      if (data.success || response.ok) {
        toast.success('Реклама успешно запущена!');
        setLaunchDialogOpen(false);
      } else {
        toast.error('Не удалось запустить рекламу');
      }
    } catch (error) {
      console.error('Ошибка запуска рекламы:', error);
      toast.error('Ошибка при запуске рекламы');
    } finally {
      setLaunchLoading(false);
    }
  };

  // Загрузка существующих кампаний
  const loadExistingCampaigns = async () => {
    setIsLoadingCampaigns(true);
    try {
      const businessId = await salesApi.getCurrentUserBusinessId();
      if (businessId) {
        const campaigns = await salesApi.getExistingCampaigns(businessId);
        setExistingCampaigns(campaigns);
      }
    } catch (error) {
      console.error('Ошибка загрузки кампаний:', error);
      toast.error('Не удалось загрузить список кампаний');
    } finally {
      setIsLoadingCampaigns(false);
    }
  };

  // Добавление продажи с выбранным креативом
  const handleAddSaleWithCampaign = async () => {
    if (!selectedCampaignId) {
      toast.error('Выберите кампанию');
      return;
    }

    const cleanPhone = salePhone.replace(/[\s\-\(\)]/g, '');
    let normalizedPhone = cleanPhone;
    
    // Убираем + если есть
    if (normalizedPhone.startsWith('+')) {
      normalizedPhone = normalizedPhone.substring(1);
    }
    
    // Если начинается с 8, заменяем на 7
    if (normalizedPhone.startsWith('8') && normalizedPhone.length === 11) {
      normalizedPhone = '7' + normalizedPhone.substring(1);
    }
    
    // Если начинается с 77 (12 цифр), убираем первую 7
    if (normalizedPhone.startsWith('77') && normalizedPhone.length === 12) {
      normalizedPhone = normalizedPhone.substring(1);
    }
    
    const amount = Number(saleAmount);

    // Получаем данные выбранной кампании
    const selectedCampaign = existingCampaigns.find(c => c.id === selectedCampaignId);
    if (!selectedCampaign) {
      toast.error('Выбранная кампания не найдена');
      return;
    }

    setIsUploading(true);
    
    try {
      const businessId = await salesApi.getCurrentUserBusinessId();
      if (!businessId) {
        toast.error('Business ID не найден. Обратитесь к администратору.');
        return;
      }

      // Добавляем продажу с указанной кампанией
      await salesApi.addSale({
        client_phone: normalizedPhone,
        amount: amount,
        business_id: businessId,
        manual_source_id: selectedCampaign.id,
        manual_creative_url: selectedCampaign.creative_url || ''
      });
      
      toast.success('Продажа и лид успешно добавлены! 🎉');
      resetSaleForm();
      
    } catch (error) {
      console.error('Ошибка добавления продажи с кампанией:', error);
      toast.error('Не удалось добавить продажу. Попробуйте еще раз.');
    } finally {
      setIsUploading(false);
    }
  };

  const resetSaleForm = () => {
    setSalePhone('');
    setSaleAmount('');
    setSelectedCampaignId('');
    setShowSaleForm(false);
    setShowCreateLead(false);
  };

  const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Пожалуйста, выберите изображение');
      return;
    }
    setSelectedImage(file);
    setShowImageForm(true);
    toast.info(`Выбрано изображение: ${file.name}`);
  };

  const uploadImage = async () => {
    if (!selectedImage) {
      toast.error('Пожалуйста, выберите изображение для загрузки');
      return;
    }
    if (selectedCities.length === 0) {
      toast.error('Пожалуйста, выберите город или "Весь Казахстан"');
      return;
    }
    // Проверка бюджета перенесена на отдельные поля в зависимости от площадки
    if (!campaignName.trim()) {
      toast.error('Пожалуйста, введите название объявления');
      return;
    }
    if (ageMin === '' || ageMax === '' || ageMin > ageMax) {
      toast.error('Проверьте корректность возрастного диапазона');
      return;
    }
    setIsUploading(true);
    setProgress(0);
    setIsRetrying(false);
    setRetryAttempt(0);
    isCancelledByUserRef.current = false;

    try {
      const actualUserData = userData || {};
      const form = new FormData();
      if (actualUserData.id) form.append('user_id', actualUserData.id);
      if (selectedDirectionId) form.append('direction_id', selectedDirectionId);
      if (actualUserData.instagram_id) form.append('instagram_id', actualUserData.instagram_id);
      if (actualUserData.telegram_id) form.append('telegram_id', actualUserData.telegram_id);
      if (actualUserData.telegram_bot_token) form.append('telegram_bot_token', actualUserData.telegram_bot_token);
      if (actualUserData.access_token) form.append('page_access_token', actualUserData.access_token);
      if (actualUserData.page_id) form.append('page_id', actualUserData.page_id);
      if (actualUserData.ad_account_id) form.append('ad_account_id', actualUserData.ad_account_id);
      if (actualUserData.prompt1) form.append('prompt1', actualUserData.prompt1);
      if (actualUserData.prompt2) form.append('prompt2', actualUserData.prompt2);
      if (actualUserData.prompt3) form.append('prompt3', actualUserData.prompt3);
      if (actualUserData.username) form.append('username', actualUserData.username);
      form.append('campaign_name', campaignName);
      form.append('description', description);
      form.append('client_question', clientQuestion);
      let countries: string[] = [];
      let cities: any[] = [];
      selectedCities.forEach(id => {
        if (id === 'KZ') {
          countries.push('KZ');
        } else if (COUNTRY_IDS.includes(id)) {
          countries.push(id);
        } else {
          cities.push({ key: id, radius: 20, distance_unit: 'kilometer' });
        }
      });
      let geo_locations: any = {};
      if (countries.length > 0) geo_locations.countries = countries;
      if (cities.length > 0) geo_locations.cities = cities;
      form.append('geo_locations', JSON.stringify(geo_locations));
      const budgetInCents = dailyBudget * 100;
      form.append('daily_budget', String(budgetInCents));
      form.append('start_type', startType);
      let min = Number(ageMin);
      let max = Number(ageMax);
      if (isNaN(min) || min < 18) min = 18;
      if (min > 65) min = 65;
      if (isNaN(max) || max > 65) max = 65;
      if (max < 18) max = 18;
      if (min > max) min = max;
      if (max < min) max = min;
      form.append('age_min', String(min));
      form.append('age_max', String(max));
      
      // Передаем пол
      form.append('genders', JSON.stringify(getGendersArray()));
      
      form.append('image_file', selectedImage);
      
      let webhookUrl = IMAGE_WEBHOOK_URL;
      // Выбираем webhook на основе цели объявления
      if (campaignGoal === 'site_leads') {
        webhookUrl = SITE_LEADS_WEBHOOK_URL;
        console.log('Используем webhook для Site Leads (изображение):', webhookUrl);
      } else if (campaignGoal === 'instagram_traffic') {
        webhookUrl = INSTAGRAM_TRAFFIC_WEBHOOK_URL;
        console.log('Используем webhook для Instagram traffic (изображение):', webhookUrl);
      } else {
        console.log('Используем стандартный webhook для изображений:', webhookUrl);
      }
      
      if (!isValidUrl(webhookUrl)) {
        toast.error('Некорректный адрес webhook!');
        return;
      }
      performUpload(form, webhookUrl, 0, 'image');
    } catch (error) {
      console.error('Ошибка при загрузке изображения:', error);
      toast.error('Ошибка при загрузке изображения: ' + (error instanceof Error ? error.message : 'Неизвестная ошибка'));
      setIsUploading(false);
      setProgress(0);
    }
  };

  return (
    <div className="space-y-4">
      {/* Основная секция действий */}
      <div className="flex flex-col gap-4 p-5 border rounded-xl bg-card shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Действия</h3>
          {selectedFile && showVideoForm && (
            <div
              className="text-sm text-muted-foreground max-w-[180px] overflow-hidden text-ellipsis whitespace-nowrap"
              title={selectedFile.name}
            >
              {selectedFile.name} ({(selectedFile.size / (1024 * 1024)).toFixed(2)} МБ)
            </div>
          )}
          {selectedImage && showImageForm && (
            <div
              className="text-sm text-muted-foreground max-w-[180px] overflow-hidden text-ellipsis whitespace-nowrap"
              title={selectedImage.name}
            >
              {selectedImage.name} ({(selectedImage.size / (1024 * 1024)).toFixed(2)} МБ)
            </div>
          )}
        </div>
        
        {/* Скрытые inputs для выбора файлов - всегда доступны */}
        <input
          type="file"
          id="video-upload"
          accept="video/*"
          onChange={handleFileChange}
          className="hidden"
          disabled={isUploading}
        />
        <input
          type="file"
          id="image-upload"
          accept="image/*"
          onChange={handleImageChange}
          className="hidden"
          disabled={isUploading}
        />

        {/* Кнопки действий */}
        {!showVideoForm && !showSaleForm && !showImageForm && (
          APP_REVIEW_MODE ? (
            /* App Review Mode: только две простые кнопки */
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  document.getElementById('video-upload')?.click();
                }}
                disabled={isUploading}
                className="w-full hover:bg-accent hover:shadow-sm transition-all duration-200"
              >
                <Video className="mr-2 h-4 w-4" />
                {t('action.uploadVideo')}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  document.getElementById('image-upload')?.click();
                }}
                disabled={isUploading}
                className="w-full hover:bg-accent hover:shadow-sm transition-all duration-200"
              >
                <Upload className="mr-2 h-4 w-4" />
                {t('action.uploadImage')}
              </Button>
            </div>
          ) : showOnlyAddSale ? (
            /* Действия для тарифа "target" */
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Button
                variant="outline"
                onClick={() => setShowSaleForm(true)}
                disabled={isUploading}
                className="w-full border-gray-200 bg-gradient-to-r from-gray-50 to-slate-50 hover:from-gray-100 hover:to-slate-100 text-gray-700 hover:text-gray-800 shadow-sm transition-all duration-200"
              >
                <DollarSign className="mr-2 h-4 w-4" />
                Добавить продажу
              </Button>
              <CallbackRequest />
            </div>
          ) : platform === 'tiktok' ? (
            /* Действия для TikTok - только загрузка видео */
            <div className="grid grid-cols-1 gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  document.getElementById('video-upload')?.click();
                }}
                disabled={isUploading}
                className="w-full hover:bg-accent hover:shadow-sm transition-all duration-200"
              >
                <Video className="mr-2 h-4 w-4" />
                Загрузить видео
              </Button>
            </div>
          ) : (
            /* Полный набор кнопок для Instagram */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              <Dialog open={launchDialogOpen} onOpenChange={setLaunchDialogOpen}>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    disabled={isUploading || ((placement === 'instagram' || placement === 'both') && !selectedDirectionId)}
                    className="w-full hover:bg-accent hover:shadow-sm transition-all duration-200"
                  >
                    <Rocket className="mr-2 h-4 w-4" />
                    Автозапуск
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Автозапуск рекламы</DialogTitle>
                    <DialogDescription>
                      Реклама будет запущена для всех активных направлений
                    </DialogDescription>
                  </DialogHeader>
                  <div className="pt-2 space-y-2">
                    <Label>Время запуска</Label>
                    <RadioGroup
                      value={autoStartMode}
                      onValueChange={(v: 'now' | 'midnight_almaty') => setAutoStartMode(v)}
                      className="grid grid-cols-1 gap-2"
                    >
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="midnight_almaty" id="auto-start-midnight" />
                        <Label htmlFor="auto-start-midnight" className="cursor-pointer">С полуночи (Алматы)</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="now" id="auto-start-now" />
                        <Label htmlFor="auto-start-now" className="cursor-pointer">Сейчас</Label>
                      </div>
                    </RadioGroup>
                  </div>
                  <div className="flex justify-end gap-2 pt-4">
                    <Button variant="outline" onClick={() => setLaunchDialogOpen(false)} disabled={launchLoading}>
                      Отмена
                    </Button>
                    <Button onClick={handleLaunchAd} disabled={launchLoading} className="dark:bg-gray-700 dark:hover:bg-gray-800">
                      {launchLoading ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          Запуск...
                        </>
                      ) : (
                        <>
                          <Rocket className="h-4 w-4 mr-2" />
                          Запустить
                        </>
                      )}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
              <Button
                variant="outline"
                onClick={() => setManualLaunchDialogOpen(true)}
                disabled={isUploading || directions.length === 0}
                className="w-full hover:bg-accent hover:shadow-sm transition-all duration-200"
              >
                <Rocket className="mr-2 h-4 w-4" />
                Ручной запуск
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowSaleForm(true)}
                disabled={isUploading}
                className="w-full hover:bg-accent hover:shadow-sm transition-all duration-200"
              >
                <DollarSign className="mr-2 h-4 w-4" />
                Добавить продажу
              </Button>
            </div>
          )
        )}

        {/* Форма загрузки видео */}
        {showVideoForm && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-base">Параметры рекламы</h4>
              <Button 
                variant="ghost" 
                size="sm"
                className="transition-all duration-200"
                onClick={() => {
                  setShowVideoForm(false);
                  setSelectedFile(null);
                  setProgress(0);
                  // Сбрасываем все настройки формы
                  setCampaignName('Новое объявление');
                  setDescription('Напишите нам, чтобы узнать подробности');
                  setSelectedCities([]);
                  setDailyBudget(10);
                  setStartType('midnight');
                  setAgeMin(18);
                  setAgeMax(65);
                  setSelectedGender('all');
                  setClientQuestion('Здравствуйте! Хочу узнать об этом подробнее.');
                  const input = document.getElementById('video-upload') as HTMLInputElement | null;
                  if (input) input.value = '';
                }}
                disabled={isUploading}
              >
                ← Назад
              </Button>
            </div>

            {isUploading && (
              <div className="w-full mb-2">
                <div className="h-2 bg-gray-200 rounded">
                  <div
                    className={`h-2 rounded transition-all ${isRetrying ? 'bg-gradient-to-r from-amber-400 to-orange-400' : 'bg-gradient-to-r from-gray-500 to-slate-600'}`}
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="flex justify-between items-center mt-1">
                  <div className="flex flex-col">
                    <span className="text-sm text-muted-foreground">{progress}%</span>
                    {isRetrying && retryAttempt > 0 && (
                      <span className="text-xs text-orange-600">
                        Попытка {retryAttempt}/{MAX_RETRY_ATTEMPTS}
                      </span>
                    )}
                  </div>
                  <Button variant="outline" size="sm" onClick={cancelUpload} disabled={!isUploading}>
                    Отменить загрузку
                  </Button>
                </div>
                <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <div className="flex items-start gap-2">
                    <span className="text-amber-600 text-lg">⚠️</span>
                    <div className="text-sm text-amber-800">
                      <div className="font-medium mb-1">Важно!</div>
                      <div>
                        {progress < 100 ? (
                          <>НЕ закрывайте браузер и НЕ блокируйте телефон до завершения загрузки.</>
                        ) : (
                          <>Загрузка завершена, идёт обработка видео в системе. НЕ закрывайте браузер до появления финального сообщения.</>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            

            
            {selectedFile && (
              <>
                {/* Выбор площадки - только для Instagram */}
                {platform !== 'tiktok' && (
                  <div className="mb-4">
                    <label className="block mb-1 font-medium">Площадка размещения</label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" disabled={isUploading} className="w-full justify-between">
                          <span>{placement === 'instagram' ? 'Instagram' : placement === 'tiktok' ? 'TikTok' : 'Обе площадки'}</span>
                          <ChevronDown className="h-4 w-4 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[200px] p-3">
                        <div className="space-y-2">
                          {[
                            { value: 'instagram', label: 'Instagram' },
                            { value: 'tiktok', label: 'TikTok' },
                            { value: 'both', label: 'Обе площадки' }
                          ].map((option) => (
                            <label key={option.value} className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="radio"
                                name="placement"
                                value={option.value}
                                checked={placement === option.value}
                                onChange={(e) => setPlacement(e.target.value as 'instagram' | 'tiktok' | 'both')}
                                disabled={isUploading}
                                className="cursor-pointer"
                              />
                              {option.label}
                            </label>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                )}
                
                {/* Выбор цели объявления для Instagram/обе площадки - скрыто для TikTok */}
                {platform !== 'tiktok' && (placement === 'instagram' || placement === 'both') && (
                  <div className="mb-4">
                    <label className="block mb-1 font-medium">Цель объявления</label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" disabled={isUploading} className="w-full justify-between">
                          <span>
                            {campaignGoal === 'whatsapp' ? 'Сообщение WhatsApp' : 
                             campaignGoal === 'instagram_traffic' ? 'Переходы в профиль Instagram' : 
                             'Лиды на сайте'}
                          </span>
                          <ChevronDown className="h-4 w-4 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[280px] p-3">
                        <div className="space-y-2">
                          {[
                            { value: 'whatsapp', label: 'Сообщение WhatsApp' },
                            { value: 'instagram_traffic', label: 'Переходы в профиль Instagram' },
                            { value: 'site_leads', label: 'Лиды на сайте' }
                          ].map((option) => (
                            <label key={option.value} className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="radio"
                                name="campaignGoal"
                                value={option.value}
                                checked={campaignGoal === option.value}
                                onChange={(e) => setCampaignGoal(e.target.value as 'whatsapp' | 'instagram_traffic' | 'site_leads')}
                                disabled={isUploading}
                                className="cursor-pointer"
                              />
                              {option.label}
                            </label>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                )}
                {/* Выбор направления бизнеса */}
                {(placement === 'instagram' || placement === 'both') && (
                  <>
                    {directions.length > 0 ? (
                      <div className="mb-4">
                        <label className="block mb-1 font-medium">Направление бизнеса</label>
                        <Select
                          value={selectedDirectionId}
                          onValueChange={setSelectedDirectionId}
                          disabled={isUploading || directionsLoading}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Выберите направление" />
                          </SelectTrigger>
                          <SelectContent>
                            {directions
                              .filter(d => !campaignGoal || d.objective === campaignGoal)
                              .map((direction) => (
                                <SelectItem key={direction.id} value={direction.id}>
                                  {direction.name} ({OBJECTIVE_LABELS[direction.objective]})
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground mt-1">
                          Креатив будет связан с выбранным направлением
                        </p>
                      </div>
                    ) : !directionsLoading && (
                      <div className="mb-4 p-4 border border-dashed rounded-lg bg-muted/20">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                          <Target className="h-4 w-4" />
                          <span className="font-medium">Направление не создано</span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-3">
                          Для загрузки креативов необходимо создать направление бизнеса
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => navigate('/profile')}
                          className="w-full"
                        >
                          <Target className="mr-2 h-4 w-4" />
                          Создать направление
                        </Button>
                      </div>
                    )}
                  </>
                )}
                {campaignGoal === 'site_leads' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                    <div>
                      <label className="block mb-1 text-sm text-muted-foreground">Сайт</label>
                      <input className="border rounded px-3 py-2 w-full" placeholder="https://example.com" value={siteUrl} onChange={e => setSiteUrl(e.target.value)} />
                    </div>
                    <div>
                      <label className="block mb-1 text-sm text-muted-foreground">Пиксель Facebook</label>
                      <select className="border rounded px-3 py-2 w-full" value={pixelId} onChange={e => setPixelId(e.target.value)}>
                        <option value="">Не выбран</option>
                        {pixels.map(p => (
                          <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
                        ))}
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block mb-1 text-sm text-muted-foreground">UTM‑метка</label>
                      <input className="border rounded px-3 py-2 w-full" placeholder="utm_source=...&utm_medium=...&utm_campaign=..." value={utmTag} onChange={e => setUtmTag(e.target.value)} />
                    </div>
                    
                  </div>
                )}
                <div className="mb-4">
                  <label className="block mb-1 font-medium">Название объявления</label>
                  <input
                    type="text"
                    className="border rounded px-3 py-2 w-full"
                    placeholder="Введите название объявления"
                    value={campaignName}
                    onChange={e => setCampaignName(e.target.value)}
                    disabled={isUploading}
                    maxLength={100}
                  />
                </div>
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-medium">Текст под видео</label>
                    <span className={`text-xs ${(placement === 'tiktok' || placement === 'both') && description.length > 100 ? 'text-red-500 font-semibold' : 'text-muted-foreground'}`}>
                      {description.length}/{(placement === 'tiktok' || placement === 'both') ? 100 : 500}
                    </span>
                  </div>
                  <textarea
                    className={`border rounded px-3 py-2 w-full min-h-[60px] ${(placement === 'tiktok' || placement === 'both') && description.length > 100 ? 'border-red-500' : ''}`}
                    placeholder={(placement === 'tiktok' || placement === 'both') ? 'Текст под видео (максимум 100 символов для TikTok)' : 'Текст под видео'}
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    disabled={isUploading}
                    maxLength={(placement === 'tiktok' || placement === 'both') ? 100 : 500}
                  />
                  {(placement === 'tiktok' || placement === 'both') && description.length > 95 && (
                    <p className="text-xs text-amber-600 mt-1">
                      ⚠️ Для TikTok максимум 100 символов
                    </p>
                  )}
                </div>
                {/* Вопрос клиента для WhatsApp */}
                {campaignGoal === 'whatsapp' && (placement === 'instagram' || placement === 'both') && (
                  <div className="mb-4">
                    <label className="block mb-1 font-medium">Вопрос клиента</label>
                    <textarea
                      className="border rounded px-3 py-2 w-full min-h-[60px]"
                      placeholder="Введите вопрос клиента или дополнительную информацию"
                      value={clientQuestion}
                      onChange={e => setClientQuestion(e.target.value)}
                      disabled={isUploading}
                      maxLength={300}
                    />
                  </div>
                )}
                {/* Платежеспособная аудитория — скрываем для TikTok */}
                {placement === 'instagram' && (
                  <div className="mb-4">
                    <label className="block mb-1 font-medium">Платежеспособная аудитория</label>
                    <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                      <input
                        type="checkbox"
                        className="w-4 h-4 cursor-pointer"
                        checked={affluentAudience}
                        onChange={(e) => {
                          setAffluentAudience(e.target.checked);
                          if (e.target.checked) {
                            setAgeMin(26);
                            setAgeMax(48);
                          }
                        }}
                        disabled={isUploading}
                      />
                      <span className="text-sm flex-1">
                        Добавляет интересы к таргетингу, присущие платежеспособной аудитории
                      </span>
                    </label>
                  </div>
                )}
                <div className="mb-4">
                  <label className="block mb-1 font-medium">Возрастная группа</label>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <label className="text-sm">От:</label>
                      <input
                        type="number"
                        min="18"
                        max="65"
                        className="border rounded px-2 py-1 w-16 text-center"
                        value={ageMin}
                        onChange={e => {
                          const val = e.target.value;
                          if (val === '') {
                            setAgeMin('');
                          } else {
                            setAgeMin(Number(val));
                          }
                        }}
                        onBlur={() => {
                          let min = Number(ageMin);
                          let max = Number(ageMax);
                          if (isNaN(min) || min < 18) min = 18;
                          if (min > 65) min = 65;
                          if (min > max) min = max;
                          setAgeMin(min);
                        }}
                        disabled={isUploading}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-sm">До:</label>
                      <input
                        type="number"
                        min="18"
                        max="65"
                        className="border rounded px-2 py-1 w-16 text-center"
                        value={ageMax}
                        onChange={e => {
                          const val = e.target.value;
                          if (val === '') {
                            setAgeMax('');
                          } else {
                            setAgeMax(Number(val));
                          }
                        }}
                        onBlur={() => {
                          let min = Number(ageMin);
                          let max = Number(ageMax);
                          if (isNaN(max) || max > 65) max = 65;
                          if (max < 18) max = 18;
                          if (max < min) max = min;
                          setAgeMax(max);
                        }}
                        disabled={isUploading}
                      />
                    </div>
                    <span className="text-sm text-muted-foreground">лет</span>
                  </div>
                </div>
                <div className="mb-4">
                  <label className="block mb-1 font-medium">Пол</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" disabled={isUploading} className="w-full justify-between">
                        <span>{selectedGender === 'all' ? 'Любой' : selectedGender === 'male' ? 'Мужской' : 'Женский'}</span>
                        <ChevronDown className="h-4 w-4 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[200px] p-3">
                      <div className="space-y-2">
                        {[
                          { value: 'all', label: 'Любой' },
                          { value: 'male', label: 'Мужской' },
                          { value: 'female', label: 'Женский' }
                        ].map((option) => (
                          <label key={option.value} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="gender"
                              value={option.value}
                              checked={selectedGender === option.value}
                              onChange={(e) => setSelectedGender(e.target.value as 'all' | 'male' | 'female')}
                              disabled={isUploading}
                              className="cursor-pointer"
                            />
                            {option.label}
                          </label>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="flex flex-col gap-2 mb-2">
                  <label className="font-medium text-sm">Города / Страны</label>
                  <Popover open={cityPopoverOpen} onOpenChange={setCityPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" disabled={isUploading} className="w-full justify-between">
                        <span>{getSelectedCitiesText()}</span>
                        <ChevronDown className="h-4 w-4 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 max-h-60 overflow-y-auto p-4 flex flex-col gap-2">
                      <div className="font-medium text-sm mb-2">Выберите города или страны</div>
                      <div className="flex flex-col gap-1">
                      {CITIES_AND_COUNTRIES.map(city => {
                          const isKZ = city.id === 'KZ';
                          const isOtherCountry = ['BY', 'KG', 'UZ'].includes(city.id);
                          const anyCitySelected = selectedCities.some(id => !COUNTRY_IDS.includes(id));
                          const isKZSelected = selectedCities.includes('KZ');
                        // Если выбраны обе площадки или TikTok, фильтруем список только разрешенными для TikTok
                        const isTikTokMode = placement === 'tiktok' || placement === 'both';
                        if (isTikTokMode) {
                          const allowedKz = isKZ; // разрешаем весь Казахстан
                          const isCountry = COUNTRY_IDS.includes(city.id);
                          const cityName = city.name;
                          const allowedCity = Boolean(TIKTOK_CITY_IDS[cityName]);
                          if (!allowedKz && (isCountry || (!isCountry && !allowedCity))) {
                            return null; // скрываем неразрешенные страны/города
                          }
                        }
                          return (
                            <label key={city.id} className="flex items-center gap-2 cursor-pointer text-sm">
                              <input
                                type="checkbox"
                                checked={selectedCities.includes(city.id)}
                                onChange={() => handleCitySelection(city.id)}
                                disabled={
                                  isUploading ||
                                  // Если это KZ и выбран хотя бы один город
                                  (isKZ && anyCitySelected) ||
                                  // Если это город и выбран KZ
                                  (!isKZ && !isOtherCountry && isKZSelected)
                                }
                              />
                              {city.name}
                            </label>
                          );
                        })}
                      </div>
                      <Button
                        className="mt-2"
                        onClick={() => setCityPopoverOpen(false)}
                        variant="outline"
                        size="sm"
                      >
                        ОК
                      </Button>
                    </PopoverContent>
                  </Popover>
                </div>
                {placement === 'instagram' && (
                  <div className="flex flex-col gap-2 mb-2">
                    <label className="font-medium text-sm">Суточный бюджет Instagram (USD)</label>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="icon" onClick={() => handleInstagramBudgetChange(-1)} disabled={isUploading || dailyBudgetInstagram <= 1}>-</Button>
                      <input
                        type="number"
                        min="1"
                        className="border rounded px-2 py-1 bg-background w-24 text-center"
                        placeholder="Бюджет, $"
                        value={dailyBudgetInstagram}
                        onChange={e => setDailyBudgetInstagram(Number(e.target.value.replace(/[^0-9]/g, '')) || 1)}
                        disabled={isUploading}
                      />
                      <Button variant="outline" size="icon" onClick={() => handleInstagramBudgetChange(1)} disabled={isUploading}>+</Button>
                    </div>
                  </div>
                )}
                {placement === 'tiktok' && (
                  <div className="flex flex-col gap-2 mb-2">
                    <label className="font-medium text-sm">Суточный бюджет TikTok (₸)</label>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="icon" onClick={() => handleTiktokBudgetChange(-1)} disabled={isUploading || dailyBudgetTiktok <= 100}>-</Button>
                      <input
                        type="number"
                        min="100"
                        className="border rounded px-2 py-1 bg-background w-32 text-center"
                        placeholder="Бюджет, ₸"
                        value={dailyBudgetTiktok}
                        onChange={e => setDailyBudgetTiktok(Number(e.target.value.replace(/[^0-9]/g, '')) || 100)}
                        disabled={isUploading}
                      />
                      <Button variant="outline" size="icon" onClick={() => handleTiktokBudgetChange(1)} disabled={isUploading}>+</Button>
                    </div>
                    {campaignGoal === 'whatsapp' && (
                      <div className="mt-2">
                        <label className="font-medium text-sm">WhatsApp номер (10 цифр, без +7)</label>
                        <div className="flex items-center gap-2">
                          <span className="text-sm">+7</span>
                          <input
                            type="tel"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            placeholder="7074094375"
                            value={whatsappPhone}
                            onChange={e => setWhatsappPhone(e.target.value.replace(/[^0-9]/g, '').slice(0, 10))}
                            className="border rounded px-2 py-1 bg-background w-44"
                            disabled={isUploading}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {placement === 'both' && (
                  <div className="flex flex-col gap-2 mb-2">
                    <label className="font-medium text-sm">Суточные бюджеты</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">Instagram (USD)</div>
                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="icon" onClick={() => handleInstagramBudgetChange(-1)} disabled={isUploading || dailyBudgetInstagram <= 1}>-</Button>
                          <input
                            type="number"
                            min="1"
                            className="border rounded px-2 py-1 bg-background w-24 text-center"
                            placeholder="$"
                            value={dailyBudgetInstagram}
                            onChange={e => setDailyBudgetInstagram(Number(e.target.value.replace(/[^0-9]/g, '')) || 1)}
                            disabled={isUploading}
                          />
                          <Button variant="outline" size="icon" onClick={() => handleInstagramBudgetChange(1)} disabled={isUploading}>+</Button>
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">TikTok (₸)</div>
                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="icon" onClick={() => handleTiktokBudgetChange(-1)} disabled={isUploading || dailyBudgetTiktok <= 100}>-</Button>
                          <input
                            type="number"
                            min="100"
                            className="border rounded px-2 py-1 bg-background w-32 text-center"
                            placeholder="₸"
                            value={dailyBudgetTiktok}
                            onChange={e => setDailyBudgetTiktok(Number(e.target.value.replace(/[^0-9]/g, '')) || 100)}
                            disabled={isUploading}
                          />
                          <Button variant="outline" size="icon" onClick={() => handleTiktokBudgetChange(1)} disabled={isUploading}>+</Button>
                        </div>
                        {campaignGoal === 'whatsapp' && (
                          <div className="mt-2">
                            <label className="font-medium text-sm">WhatsApp номер (10 цифр, без +7)</label>
                            <div className="flex items-center gap-2">
                              <span className="text-sm">+7</span>
                              <input
                                type="tel"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                placeholder="7074094375"
                                value={whatsappPhone}
                                onChange={e => setWhatsappPhone(e.target.value.replace(/[^0-9]/g, '').slice(0, 10))}
                                className="border rounded px-2 py-1 bg-background w-44"
                                disabled={isUploading}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                <div className="mb-4">
                  <label className="block mb-1 font-medium">Время запуска</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" disabled={isUploading} className="w-full justify-between">
                        <span>{startType === 'midnight' ? 'С полуночи' : 'Сейчас'}</span>
                        <ChevronDown className="h-4 w-4 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[200px] p-3">
                      <div className="space-y-2">
                        {[
                          { value: 'midnight', label: 'С полуночи' },
                          { value: 'now', label: 'Сейчас' }
                        ].map((option) => (
                          <label key={option.value} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="startType"
                              value={option.value}
                              checked={startType === option.value}
                              onChange={(e) => setStartType(e.target.value as 'now' | 'midnight')}
                              disabled={isUploading}
                              className="cursor-pointer"
                            />
                            {option.label}
                          </label>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
                
                {/* Кнопка отправки - обособлена */}
                <div className="pt-4 mt-2 border-t">
                  <Button 
                    onClick={uploadVideo} 
                    disabled={isUploading || !selectedFile}
                    className="w-full bg-gradient-to-r from-gray-700 to-slate-800 hover:from-gray-800 hover:to-slate-900 text-white shadow-md hover:shadow-lg transition-all duration-200"
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    {isUploading ? 'Загружается...' : 'Загрузить видео'}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Форма добавления продажи */}
        {showSaleForm && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-medium">Добавить продажу</h4>
              <Button 
                variant="ghost" 
                size="sm"
                className="transition-all duration-200"
                onClick={() => setShowSaleForm(false)}
              >
                ← Назад
              </Button>
            </div>
            
            <div>
              <label className="block mb-1 font-medium text-sm">Номер телефона клиента *</label>
              <input
                type="tel"
                placeholder="77079808026"
                value={salePhone}
                onChange={(e) => setSalePhone(e.target.value)}
                className="border rounded px-3 py-2 w-full"
                disabled={isUploading}
              />
              <p className="text-xs text-gray-500 mt-1">
                Введите номер в формате: 77079808026 (11 цифр, начинается с 7)
              </p>
            </div>

            <div>
              <label className="block mb-1 font-medium text-sm">Сумма продажи (₸) *</label>
              <input
                type="number"
                min="1"
                placeholder="15000"
                value={saleAmount}
                onChange={(e) => setSaleAmount(e.target.value)}
                className="border rounded px-3 py-2 w-full"
                disabled={isUploading}
              />
            </div>

            {/* Форма выбора креатива - показывается если лид не найден */}
            {showCreateLead ? (
              <div className="space-y-4 p-4 border rounded-lg bg-yellow-50 border-yellow-200">
                <div className="flex items-center gap-2">
                  <span className="text-yellow-600 text-lg">⚠️</span>
                  <h4 className="font-medium text-yellow-800">Лид не найден</h4>
                </div>
                <p className="text-sm text-yellow-700">
                  Клиент с номером {salePhone} не найден в базе лидов. Выберите кампанию, с которой он пришел.
                </p>

                <div>
                  <label className="block mb-2 font-medium text-sm">Выберите кампанию</label>
                  {isLoadingCampaigns ? (
                    <div className="py-4 text-center text-gray-500">Загружаем кампании...</div>
                  ) : existingCampaigns.length > 0 ? (
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {existingCampaigns.map((campaign) => (
                        <label key={campaign.id} className="flex items-start gap-2 p-2 border rounded cursor-pointer hover:bg-gray-50">
                          <input
                            type="radio"
                            name="campaign"
                            value={campaign.id}
                            checked={selectedCampaignId === campaign.id}
                            onChange={(e) => setSelectedCampaignId(e.target.value)}
                            className="mt-1"
                          />
                          <div className="flex-1">
                            <div className="font-medium">{campaign.name}</div>
                            <div className="text-xs text-gray-500">ID: {campaign.id}</div>
                          </div>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <div className="py-4 text-center text-gray-500">Кампании не найдены</div>
                  )}
                </div>

                <div className="flex flex-col sm:flex-row gap-2 sm:gap-4">
                  <Button 
                    onClick={handleAddSaleWithCampaign}
                    disabled={isUploading || !selectedCampaignId}
                    variant="outline"
                    className="w-full sm:w-auto border-emerald-200 bg-gradient-to-r from-emerald-50 to-green-50 hover:from-emerald-100 hover:to-green-100 text-emerald-700 hover:text-emerald-800 shadow-sm transition-all duration-200"
                  >
                    <DollarSign className="mr-2 h-4 w-4" />
                    {isUploading ? 'Добавляется...' : 'Добавить продажу'}
                  </Button>
                  <Button 
                    variant="outline"
                    onClick={() => setShowCreateLead(false)}
                    disabled={isUploading}
                    className="w-full sm:w-auto transition-all duration-200 hover:bg-gray-50"
                  >
                    Отмена
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <Button 
                  onClick={handleSaleSubmit}
                  disabled={isUploading || !salePhone || !saleAmount}
                  variant="outline"
                  className="border-emerald-200 bg-gradient-to-r from-emerald-50 to-green-50 hover:from-emerald-100 hover:to-green-100 text-emerald-700 hover:text-emerald-800 shadow-sm transition-all duration-200"
                >
                  <DollarSign className="mr-2 h-4 w-4" />
                  {isUploading ? 'Добавляется...' : 'Добавить продажу'}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Форма для загрузки изображения */}
        {showImageForm && selectedImage && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-base">Параметры рекламы</h4>
              <Button 
                variant="ghost" 
                size="sm"
                className="transition-all duration-200"
                onClick={() => {
                  setShowImageForm(false);
                  setSelectedImage(null);
                  setProgress(0);
                  // Сбрасываем все настройки формы
                  setCampaignName('Новое объявление');
                  setDescription('Напишите нам, чтобы узнать подробности');
                  setSelectedCities([]);
                  setDailyBudget(10);
                  setStartType('midnight');
                  setAgeMin(18);
                  setAgeMax(65);
                  setSelectedGender('all');
                  setClientQuestion('Здравствуйте! Хочу узнать об этом подробнее.');
                }}
                disabled={isUploading}
              >
                ← Назад
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium">Выбрано изображение:</span>
              <span className="text-sm text-muted-foreground max-w-[180px] overflow-hidden text-ellipsis whitespace-nowrap" title={selectedImage.name}>
                {selectedImage.name} ({(selectedImage.size / (1024 * 1024)).toFixed(2)} МБ)
              </span>
            </div>
            <div className="mb-4">
              <label className="block mb-1 font-medium">Цель объявления</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" disabled={isUploading} className="w-full justify-between">
                    <span>
                      {campaignGoal === 'whatsapp' ? 'Сообщение WhatsApp' : 
                       campaignGoal === 'instagram_traffic' ? 'Переходы в профиль Instagram' : 
                       'Лиды на сайте'}
                    </span>
                    <ChevronDown className="h-4 w-4 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[280px] p-3">
                  <div className="space-y-2">
                    {[
                      { value: 'whatsapp', label: 'Сообщение WhatsApp' },
                      { value: 'instagram_traffic', label: 'Переходы в профиль Instagram' },
                      { value: 'site_leads', label: 'Лиды на сайте' }
                    ].map((option) => (
                      <label key={option.value} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="campaignGoalImage"
                          value={option.value}
                          checked={campaignGoal === option.value}
                          onChange={(e) => setCampaignGoal(e.target.value as 'whatsapp' | 'instagram_traffic' | 'site_leads')}
                          disabled={isUploading}
                          className="cursor-pointer"
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            {campaignGoal === 'site_leads' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="block mb-1 text-sm text-muted-foreground">Сайт</label>
                  <input className="border rounded px-3 py-2 w-full" placeholder="https://example.com" value={siteUrl} onChange={e => setSiteUrl(e.target.value)} />
                </div>
                <div>
                  <label className="block mb-1 text-sm text-muted-foreground">Пиксель Facebook</label>
                  <select className="border rounded px-3 py-2 w-full" value={pixelId} onChange={e => setPixelId(e.target.value)}>
                    <option value="">Не выбран</option>
                    {pixels.map(p => (
                      <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
            <div className="mb-4">
              <label className="block mb-1 font-medium">Название объявления</label>
              <input
                type="text"
                className="border rounded px-3 py-2 w-full"
                placeholder="Введите название объявления"
                value={campaignName}
                onChange={e => setCampaignName(e.target.value)}
                disabled={isUploading}
                maxLength={100}
              />
            </div>
            <div className="mb-4">
              <label className="block mb-1 font-medium">Текст под изображением</label>
              <textarea
                className="border rounded px-3 py-2 w-full min-h-[60px]"
                placeholder="Текст под изображением"
                value={description}
                onChange={e => setDescription(e.target.value)}
                disabled={isUploading}
                maxLength={500}
              />
            </div>
            <div className="mb-4">
              <label className="block mb-1 font-medium">Вопрос клиента</label>
              <textarea
                className="border rounded px-3 py-2 w-full min-h-[60px]"
                placeholder="Введите вопрос клиента или дополнительную информацию"
                value={clientQuestion}
                onChange={e => setClientQuestion(e.target.value)}
                disabled={isUploading}
                maxLength={300}
              />
            </div>
            <div className="mb-4">
              <label className="block mb-1 font-medium">Возрастная группа</label>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <label className="text-sm">От:</label>
                  <input
                    type="number"
                    min="18"
                    max="65"
                    className="border rounded px-2 py-1 w-16 text-center"
                    value={ageMin}
                    onChange={e => {
                      const val = e.target.value;
                      if (val === '') {
                        setAgeMin('');
                      } else {
                        setAgeMin(Number(val));
                      }
                    }}
                    onBlur={() => {
                      let min = Number(ageMin);
                      let max = Number(ageMax);
                      if (isNaN(min) || min < 18) min = 18;
                      if (min > 65) min = 65;
                      if (min > max) min = max;
                      setAgeMin(min);
                    }}
                    disabled={isUploading}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-sm">До:</label>
                  <input
                    type="number"
                    min="18"
                    max="65"
                    className="border rounded px-2 py-1 w-16 text-center"
                    value={ageMax}
                    onChange={e => {
                      const val = e.target.value;
                      if (val === '') {
                        setAgeMax('');
                      } else {
                        setAgeMax(Number(val));
                      }
                    }}
                    onBlur={() => {
                      let min = Number(ageMin);
                      let max = Number(ageMax);
                      if (isNaN(max) || max > 65) max = 65;
                      if (max < 18) max = 18;
                      if (max < min) max = min;
                      setAgeMax(max);
                    }}
                    disabled={isUploading}
                  />
                </div>
                <span className="text-sm text-muted-foreground">лет</span>
              </div>
            </div>
            <div className="mb-4">
              <label className="block mb-1 font-medium">Пол</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" disabled={isUploading} className="w-full justify-between">
                    <span>{selectedGender === 'all' ? 'Любой' : selectedGender === 'male' ? 'Мужской' : 'Женский'}</span>
                    <ChevronDown className="h-4 w-4 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[200px] p-3">
                  <div className="space-y-2">
                    {[
                      { value: 'all', label: 'Любой' },
                      { value: 'male', label: 'Мужской' },
                      { value: 'female', label: 'Женский' }
                    ].map((option) => (
                      <label key={option.value} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="genderImage"
                          value={option.value}
                          checked={selectedGender === option.value}
                          onChange={(e) => setSelectedGender(e.target.value as 'all' | 'male' | 'female')}
                          disabled={isUploading}
                          className="cursor-pointer"
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex flex-col gap-2 mb-2">
              <label className="font-medium text-sm">Города / Страны</label>
              <Popover open={cityPopoverOpen} onOpenChange={setCityPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" disabled={isUploading} className="w-full justify-between">
                    <span>{getSelectedCitiesText()}</span>
                    <ChevronDown className="h-4 w-4 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 max-h-60 overflow-y-auto p-4 flex flex-col gap-2">
                  <div className="font-medium text-sm mb-2">Выберите города или страны</div>
                  <div className="flex flex-col gap-1">
                    {CITIES_AND_COUNTRIES.map(city => {
                      const isKZ = city.id === 'KZ';
                      const isOtherCountry = ['BY', 'KG', 'UZ'].includes(city.id);
                      const anyCitySelected = selectedCities.some(id => !COUNTRY_IDS.includes(id));
                      const isKZSelected = selectedCities.includes('KZ');
                      const isTikTokMode = placement === 'tiktok' || placement === 'both';
                      if (isTikTokMode) {
                        const allowedKz = isKZ;
                        const isCountry = COUNTRY_IDS.includes(city.id);
                        const cityName = city.name;
                        const allowedCity = Boolean(TIKTOK_CITY_IDS[cityName]);
                        if (!allowedKz && (isCountry || (!isCountry && !allowedCity))) {
                          return null;
                        }
                      }
                      return (
                        <label key={city.id} className="flex items-center gap-2 cursor-pointer text-sm">
                          <input
                            type="checkbox"
                            checked={selectedCities.includes(city.id)}
                            onChange={() => handleCitySelection(city.id)}
                            disabled={
                              isUploading ||
                              (isKZ && anyCitySelected) ||
                              (!isKZ && !isOtherCountry && isKZSelected)
                            }
                          />
                          {city.name}
                        </label>
                      );
                    })}
                  </div>
                  <Button
                    className="mt-2"
                    onClick={() => setCityPopoverOpen(false)}
                    variant="outline"
                    size="sm"
                  >
                    ОК
                  </Button>
                </PopoverContent>
              </Popover>
            </div>
            {placement === 'instagram' && (
              <div className="flex flex-col gap-2 mb-2">
                <label className="font-medium text-sm">Суточный бюджет Instagram (USD)</label>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="icon" onClick={() => handleInstagramBudgetChange(-1)} disabled={isUploading || dailyBudgetInstagram <= 1}>-</Button>
                  <input
                    type="number"
                    min="1"
                    className="border rounded px-2 py-1 bg-background w-24 text-center"
                    placeholder="Бюджет, $"
                    value={dailyBudgetInstagram}
                    onChange={e => setDailyBudgetInstagram(Number(e.target.value.replace(/[^0-9]/g, '')) || 1)}
                    disabled={isUploading}
                  />
                  <Button variant="outline" size="icon" onClick={() => handleInstagramBudgetChange(1)} disabled={isUploading}>+</Button>
                </div>
              </div>
            )}
            {placement === 'tiktok' && (
              <div className="flex flex-col gap-2 mb-2">
                <label className="font-medium text-sm">Суточный бюджет TikTok (₸)</label>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="icon" onClick={() => handleTiktokBudgetChange(-1)} disabled={isUploading || dailyBudgetTiktok <= 100}>-</Button>
                  <input
                    type="number"
                    min="100"
                    className="border rounded px-2 py-1 bg-background w-32 text-center"
                    placeholder="Бюджет, ₸"
                    value={dailyBudgetTiktok}
                    onChange={e => setDailyBudgetTiktok(Number(e.target.value.replace(/[^0-9]/g, '')) || 100)}
                    disabled={isUploading}
                  />
                  <Button variant="outline" size="icon" onClick={() => handleTiktokBudgetChange(1)} disabled={isUploading}>+</Button>
                </div>
              </div>
            )}
            {placement === 'both' && (
              <div className="flex flex-col gap-2 mb-2">
                <label className="font-medium text-sm">Суточные бюджеты</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Instagram (USD)</div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="icon" onClick={() => handleInstagramBudgetChange(-1)} disabled={isUploading || dailyBudgetInstagram <= 1}>-</Button>
                      <input
                        type="number"
                        min="1"
                        className="border rounded px-2 py-1 bg-background w-24 text-center"
                        placeholder="$"
                        value={dailyBudgetInstagram}
                        onChange={e => setDailyBudgetInstagram(Number(e.target.value.replace(/[^0-9]/g, '')) || 1)}
                        disabled={isUploading}
                      />
                      <Button variant="outline" size="icon" onClick={() => handleInstagramBudgetChange(1)} disabled={isUploading}>+</Button>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">TikTok (₸)</div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="icon" onClick={() => handleTiktokBudgetChange(-1)} disabled={isUploading || dailyBudgetTiktok <= 100}>-</Button>
                      <input
                        type="number"
                        min="100"
                        className="border rounded px-2 py-1 bg-background w-32 text-center"
                        placeholder="₸"
                        value={dailyBudgetTiktok}
                        onChange={e => setDailyBudgetTiktok(Number(e.target.value.replace(/[^0-9]/g, '')) || 100)}
                        disabled={isUploading}
                      />
                      <Button variant="outline" size="icon" onClick={() => handleTiktokBudgetChange(1)} disabled={isUploading}>+</Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div className="mb-4">
              <label className="block mb-1 font-medium">Время запуска</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" disabled={isUploading} className="w-full justify-between">
                    <span>{startType === 'midnight' ? 'С полуночи' : 'Сейчас'}</span>
                    <ChevronDown className="h-4 w-4 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[200px] p-3">
                  <div className="space-y-2">
                    {[
                      { value: 'midnight', label: 'С полуночи' },
                      { value: 'now', label: 'Сейчас' }
                    ].map((option) => (
                      <label key={option.value} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="startTypeImage"
                          value={option.value}
                          checked={startType === option.value}
                          onChange={(e) => setStartType(e.target.value as 'now' | 'midnight')}
                          disabled={isUploading}
                          className="cursor-pointer"
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            {isUploading && (
              <div className="w-full mb-2">
                <div className="h-2 bg-gray-200 rounded">
                  <div
                    className={`h-2 rounded transition-all ${isRetrying ? 'bg-gradient-to-r from-amber-400 to-orange-400' : 'bg-gradient-to-r from-gray-500 to-slate-600'}`}
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="flex justify-between items-center mt-1">
                  <div className="flex flex-col">
                    <span className="text-sm text-muted-foreground">{progress}%</span>
                    {isRetrying && retryAttempt > 0 && (
                      <span className="text-xs text-orange-600">
                        Попытка {retryAttempt}/{MAX_RETRY_ATTEMPTS}
                      </span>
                    )}
                  </div>
                  <Button variant="outline" size="sm" onClick={cancelUpload} disabled={!isUploading}>
                    Отменить загрузку
                  </Button>
                </div>
                <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <div className="flex items-start gap-2">
                    <span className="text-amber-600 text-lg">⚠️</span>
                    <div className="text-sm text-amber-800">
                      <div className="font-medium mb-1">Важно!</div>
                      <div>
                        {progress < 100 ? (
                          <>НЕ закрывайте браузер и НЕ блокируйте телефон до завершения загрузки.</>
                        ) : (
                          <>Загрузка завершена, идёт обработка изображения в системе. НЕ закрывайте браузер до появления финального сообщения.</>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {/* Кнопка отправки - обособлена */}
            <div className="pt-4 mt-2 border-t">
              <Button
                onClick={uploadImage}
                disabled={isUploading || !selectedImage}
                className="w-full bg-gradient-to-r from-gray-700 to-slate-800 hover:from-gray-800 hover:to-slate-900 text-white shadow-md hover:shadow-lg transition-all duration-200"
              >
                <Upload className="mr-2 h-4 w-4" />
                {isUploading ? 'Загружается...' : 'Загрузить изображение'}
              </Button>
            </div>
          </div>
        )}

        {/* Модальное окно для ручного запуска */}
        <Dialog open={manualLaunchDialogOpen} onOpenChange={setManualLaunchDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Ручной запуск рекламы</DialogTitle>
              <DialogDescription>
                Выберите направление и креативы для запуска рекламы
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6 py-4">
              {/* Выбор направления */}
              <div className="space-y-2">
                <Label>Направление</Label>
                <Select
                  value={selectedManualDirection}
                  onValueChange={(value) => {
                    setSelectedManualDirection(value);
                    setSelectedCreativeIds([]);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите направление" />
                  </SelectTrigger>
                  <SelectContent>
                    {directions.length === 0 ? (
                      <div className="p-2 text-sm text-muted-foreground">
                        Нет доступных направлений
                      </div>
                    ) : (
                      directions
                        .filter((d) => d.is_active)
                        .map((direction) => (
                          <SelectItem key={direction.id} value={direction.id}>
                            {direction.name} ({OBJECTIVE_LABELS[direction.objective]})
                          </SelectItem>
                        ))
                    )}
                  </SelectContent>
                </Select>
                {directions.length === 0 && (
                  <div className="text-xs text-muted-foreground">
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0"
                      onClick={() => {
                        setManualLaunchDialogOpen(false);
                        navigate('/profile');
                      }}
                    >
                      Создать направление
                    </Button>
                  </div>
                )}
              </div>

              {/* Дневной бюджет */}
              <div className="space-y-2">
                <Label htmlFor="manual-budget">Дневной бюджет (USD)</Label>
                <div className="flex items-center gap-2">
                  <span className="text-2xl">$</span>
                  <input
                    id="manual-budget"
                    type="number"
                    min="10"
                    step="1"
                    value={manualLaunchBudget}
                    onChange={(e) => setManualLaunchBudget(Number(e.target.value))}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={manualLaunchLoading}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Минимальный бюджет: $10 в день
                </p>
              </div>

              {/* Время запуска */}
              <div className="space-y-2">
                <Label>Время запуска</Label>
                <RadioGroup
                  value={manualStartMode}
                  onValueChange={(v: 'now' | 'midnight_almaty') => setManualStartMode(v)}
                  className="grid grid-cols-1 gap-2"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="midnight_almaty" id="start-midnight" />
                    <Label htmlFor="start-midnight" className="cursor-pointer">С полуночи (Алматы)</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="now" id="start-now" />
                    <Label htmlFor="start-now" className="cursor-pointer">Сейчас</Label>
                  </div>
                </RadioGroup>
              </div>

              {/* Выбор креативов */}
              {selectedManualDirection && (
                <div className="space-y-2">
                  <Label>
                    Креативы {selectedCreativeIds.length > 0 && `(выбрано: ${selectedCreativeIds.length})`}
                  </Label>
                  {loadingCreatives ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : availableCreatives.length === 0 ? (
                    <div className="p-4 border border-dashed rounded-lg text-center text-sm text-muted-foreground">
                      Нет активных креативов в этом направлении
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[300px] overflow-y-auto border rounded-lg p-3">
                      {availableCreatives.map((creative) => (
                        <div
                          key={creative.id}
                          className="flex items-center space-x-3 p-2 hover:bg-muted/50 rounded transition-colors"
                        >
                          <Checkbox
                            id={`creative-${creative.id}`}
                            checked={selectedCreativeIds.includes(creative.id)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedCreativeIds([...selectedCreativeIds, creative.id]);
                              } else {
                                setSelectedCreativeIds(
                                  selectedCreativeIds.filter((id) => id !== creative.id)
                                );
                              }
                            }}
                          />
                          <label
                            htmlFor={`creative-${creative.id}`}
                            className="flex-1 cursor-pointer text-sm"
                          >
                            <div className="font-medium">{creative.title}</div>
                            <div className="text-xs text-muted-foreground">
                              {new Date(creative.created_at).toLocaleDateString('ru-RU')}
                            </div>
                          </label>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button
                variant="outline"
                onClick={() => {
                  setManualLaunchDialogOpen(false);
                  setSelectedManualDirection('');
                  setSelectedCreativeIds([]);
                  setManualLaunchBudget(10);
                }}
                disabled={manualLaunchLoading}
              >
                Отмена
              </Button>
              <Button
                onClick={handleManualLaunch}
                disabled={
                  manualLaunchLoading ||
                  !selectedManualDirection ||
                  selectedCreativeIds.length === 0
                }
                variant="default"
                className="dark:bg-gray-700 dark:hover:bg-gray-800"
              >
                {manualLaunchLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Запуск...
                  </>
                ) : (
                  <>
                    <Rocket className="h-4 w-4 mr-2" />
                    Запустить
                  </>
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Модальное окно с результатом запуска */}
        <Dialog open={resultDialogOpen} onOpenChange={setResultDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Реклама запущена!</DialogTitle>
              <DialogDescription>
                {launchResult?.message || 'Реклама успешно запущена'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {launchResult && (
                <>
                  {/* Информация о направлении */}
                  <div className="space-y-2">
                    <div className="text-sm">
                      <span className="text-muted-foreground">Направление:</span>{' '}
                      <span className="font-medium">{launchResult.direction_name}</span>
                    </div>
                    <div className="text-sm">
                      <span className="text-muted-foreground">Campaign ID:</span>{' '}
                      <span className="font-mono text-xs">{launchResult.campaign_id}</span>
                    </div>
                  </div>

                  {/* Информация об Ad Set */}
                  <div className="p-4 bg-muted/30 rounded-lg space-y-2">
                    <div className="text-sm font-medium">Ad Set</div>
                    <div className="text-sm text-muted-foreground">{launchResult.adset_name}</div>
                    <div className="text-xs text-muted-foreground font-mono">
                      ID: {launchResult.adset_id}
                    </div>
                    <div className="text-sm pt-2 border-t border-border/50">
                      <span className="text-muted-foreground">Дневной бюджет:</span>{' '}
                      <span className="font-medium">${manualLaunchBudget}</span>
                    </div>
                  </div>

                  {/* Список созданных объявлений */}
                  {launchResult.ads && launchResult.ads.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-sm font-medium">
                        Создано объявлений: {launchResult.ads_created}
                      </div>
                      <div className="space-y-2 max-h-[200px] overflow-y-auto">
                        {launchResult.ads.map((ad, index) => (
                          <div
                            key={ad.ad_id}
                            className="p-3 border rounded-lg text-sm space-y-1"
                          >
                            <div className="font-medium">
                              {index + 1}. {ad.name}
                            </div>
                            <div className="text-xs text-muted-foreground font-mono">
                              ID: {ad.ad_id}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button
                variant="outline"
                onClick={() => {
                  setResultDialogOpen(false);
                  setLaunchResult(null);
                }}
              >
                Закрыть
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
