import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { ChevronDown, QrCode, Cloud, Search } from 'lucide-react';
import type {
  DirectionObjective,
  ConversionChannel,
  CreateDefaultSettingsInput,
  DirectionPlatform,
  TikTokObjective,
  OptimizationLevel,
} from '@/types/direction';
import { OBJECTIVE_DESCRIPTIONS, CONVERSION_CHANNEL_DESCRIPTIONS, TIKTOK_OBJECTIVE_DESCRIPTIONS, CTA_OPTIONS_SITE, CTA_OPTIONS_LEAD_FORM } from '@/types/direction';
import { GEO_GROUPS, COUNTRY_IDS, CYPRUS_GEO_IDS, DEFAULT_UTM } from '@/constants/cities';
import { defaultSettingsApi } from '@/services/defaultSettingsApi';
import { facebookApi } from '@/services/facebookApi';
import { directionsApi, type DirectionCustomAudience } from '@/services/directionsApi';
// tiktokApi убран - Instant Page ID вводится вручную
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { TooltipKeys } from '@/content/tooltips';

export type ConnectionType = 'evolution' | 'waba';

const TIKTOK_MIN_DAILY_BUDGET = 2500;

interface CreateDirectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CreateDirectionFormData) => Promise<void>;
  userAccountId: string;
  accountId?: string | null; // UUID из ad_accounts.id для мультиаккаунтности
  defaultPlatform?: DirectionPlatform;
  hasInstagramId?: boolean; // Есть ли Instagram Account ID у текущего аккаунта
}

export interface CreateDirectionFormData {
  name: string;
  platform: DirectionPlatform;
  objective?: DirectionObjective;
  conversion_channel?: ConversionChannel;
  optimization_level?: OptimizationLevel;
  use_instagram?: boolean;
  advantage_audience_enabled?: boolean;
  custom_audience_id?: string | null;
  daily_budget_cents?: number;
  target_cpl_cents?: number;
  tiktok_objective?: TikTokObjective;
  tiktok_daily_budget?: number;
  tiktok_target_cpl_kzt?: number;
  tiktok_instant_page_id?: string;
  cta_type?: string;
  whatsapp_phone_number?: string;
  whatsapp_connection_type?: ConnectionType;
  whatsapp_waba_phone_id?: string;
  whatsapp_waba_access_token?: string;
  whatsapp_waba_app_secret?: string;
  adSettings?: CreateDefaultSettingsInput;
  facebookAdSettings?: CreateDefaultSettingsInput;
  tiktokAdSettings?: CreateDefaultSettingsInput;
}

export const CreateDirectionDialog: React.FC<CreateDirectionDialogProps> = ({
  open,
  onOpenChange,
  onSubmit,
  userAccountId,
  accountId,
  defaultPlatform = 'facebook',
  hasInstagramId = true,
}) => {
  // Ref для порталинга Popover внутрь Dialog
  const dialogContentRef = React.useRef<HTMLDivElement>(null);

  // Основная информация
  const [name, setName] = useState('');
  const [directionPlatform, setDirectionPlatform] = useState<DirectionPlatform>(defaultPlatform);
  const [objective, setObjective] = useState<DirectionObjective>('whatsapp');
  const [conversionChannel, setConversionChannel] = useState<ConversionChannel>('whatsapp');
  const [optimizationLevel, setOptimizationLevel] = useState<OptimizationLevel>('level_1');
  const [useInstagram, setUseInstagram] = useState(hasInstagramId !== false);
  const [advantageAudienceEnabled, setAdvantageAudienceEnabled] = useState(true);
  const [customAudienceId, setCustomAudienceId] = useState('');
  const [customAudiences, setCustomAudiences] = useState<DirectionCustomAudience[]>([]);
  const [isLoadingCustomAudiences, setIsLoadingCustomAudiences] = useState(false);
  const [dailyBudget, setDailyBudget] = useState('50');
  const [targetCpl, setTargetCpl] = useState('2.00');
  const [tiktokObjective, setTiktokObjective] = useState<TikTokObjective>('traffic');
  const [tiktokDailyBudget, setTikTokDailyBudget] = useState(String(TIKTOK_MIN_DAILY_BUDGET));
  const [tiktokTargetCpl, setTikTokTargetCpl] = useState('');
  const [separateTikTokSettings, setSeparateTikTokSettings] = useState(false);
  
  // WhatsApp номер (вводится напрямую)
  const [whatsappPhoneNumber, setWhatsappPhoneNumber] = useState<string>('');
  const [whatsappConnectionType, setWhatsappConnectionType] = useState<ConnectionType>('evolution');
  const [whatsappWabaPhoneId, setWhatsappWabaPhoneId] = useState<string>('');
  const [whatsappWabaAccessToken, setWhatsappWabaAccessToken] = useState<string>('');
  const [whatsappWabaAppSecret, setWhatsappWabaAppSecret] = useState<string>('');

  // Настройки рекламы - Таргетинг
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [cityPopoverOpen, setCityPopoverOpen] = useState(false);
  const [geoSearch, setGeoSearch] = useState('');
  const [ageMin, setAgeMin] = useState<number>(18);
  const [ageMax, setAgeMax] = useState<number>(65);
  const [gender, setGender] = useState<'all' | 'male' | 'female'>('all');
  const [tiktokSelectedCities, setTikTokSelectedCities] = useState<string[]>([]);
  const [tiktokCityPopoverOpen, setTikTokCityPopoverOpen] = useState(false);
  const [tiktokAgeMin, setTikTokAgeMin] = useState<number>(18);
  const [tiktokAgeMax, setTikTokAgeMax] = useState<number>(65);
  const [tiktokGender, setTikTokGender] = useState<'all' | 'male' | 'female'>('all');
  
  // Настройки рекламы - Контент
  const [description, setDescription] = useState('Напишите нам, чтобы узнать подробности');
  const [tiktokDescription, setTikTokDescription] = useState('Напишите нам, чтобы узнать подробности');
  
  // Настройки рекламы - Специфичные для целей
  const [clientQuestion, setClientQuestion] = useState('Здравствуйте! Хочу узнать об этом подробнее.');
  const [instagramUrl, setInstagramUrl] = useState('');
  const [siteUrl, setSiteUrl] = useState('');
  const [pixelId, setPixelId] = useState('');
  const [pixels, setPixels] = useState<Array<{ id: string; name: string }>>([]);
  const [isLoadingPixels, setIsLoadingPixels] = useState(false);
  const [utmTag, setUtmTag] = useState(DEFAULT_UTM);

  // Lead Forms специфичные (Facebook)
  const [leadFormId, setLeadFormId] = useState('');
  const [leadForms, setLeadForms] = useState<Array<{ id: string; name: string; status: string }>>([]);
  const [isLoadingLeadForms, setIsLoadingLeadForms] = useState(false);
  const [appStoreUrl, setAppStoreUrl] = useState('');
  const [isSkadnetworkAttribution, setIsSkadnetworkAttribution] = useState(false);

  // CTA кнопка
  const [ctaType, setCtaType] = useState('');

  // TikTok Instant Page ID (Lead Forms) - ручной ввод
  const [tiktokInstantPageId, setTikTokInstantPageId] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsFacebook = directionPlatform === 'facebook' || directionPlatform === 'both';
  const needsTikTok = directionPlatform === 'tiktok' || directionPlatform === 'both';

  const mapTikTokObjectiveToDirectionObjective = (value: TikTokObjective): DirectionObjective => {
    switch (value) {
      case 'lead_generation':
        return 'lead_forms';
      case 'conversions':
        return 'site_leads';
      case 'traffic':
      default:
        return 'instagram_traffic';
    }
  };

  useEffect(() => {
    if (open) {
      setDirectionPlatform(defaultPlatform);
    }
  }, [open, defaultPlatform]);

  useEffect(() => {
    if (directionPlatform !== 'both' && separateTikTokSettings) {
      setSeparateTikTokSettings(false);
    }
  }, [directionPlatform, separateTikTokSettings]);

  useEffect(() => {
    if (separateTikTokSettings) {
      setTikTokSelectedCities(selectedCities);
      setTikTokAgeMin(ageMin);
      setTikTokAgeMax(ageMax);
      setTikTokGender(gender);
      setTikTokDescription(description);
    }
  }, [separateTikTokSettings]);

  // Загрузка пикселей для всех типов целей (для Meta CAPI)
  // Для site_leads пиксель обязателен, для остальных — опционален
  useEffect(() => {
    if (!open || !needsFacebook) {
      setPixels([]);
      return;
    }

    const loadPixels = async () => {
      setIsLoadingPixels(true);
      try {
        const list = await facebookApi.getPixels();
        console.log('Загружены пиксели:', list);
        setPixels(Array.isArray(list) ? list : []);
      } catch (e) {
        console.error('Ошибка загрузки пикселей:', e);
        setPixels([]);
      } finally {
        setIsLoadingPixels(false);
      }
    };
    loadPixels();
  }, [open, needsFacebook]); // Загружаем при открытии диалога для Facebook

  // Загрузка кастомных аудиторий из Meta кабинета
  useEffect(() => {
    if (!open || !needsFacebook || !userAccountId) {
      setCustomAudiences([]);
      setCustomAudienceId('');
      return;
    }

    const loadCustomAudiences = async () => {
      setIsLoadingCustomAudiences(true);
      try {
        const audiences = await directionsApi.listCustomAudiences(userAccountId, accountId || null);
        setCustomAudiences(audiences);
        setCustomAudienceId((prev) => (
          prev && !audiences.some((aud) => aud.id === prev) ? '' : prev
        ));
      } catch (e) {
        console.error('Ошибка загрузки custom audiences:', e);
        setCustomAudiences([]);
      } finally {
        setIsLoadingCustomAudiences(false);
      }
    };

    loadCustomAudiences();
  }, [open, needsFacebook, userAccountId, accountId]);

  // Обновление дефолта целевой стоимости при смене objective
  useEffect(() => {
    // Для instagram_traffic дефолт $0.10, для остальных $2.00
    const defaultValue = objective === 'instagram_traffic' ? '0.10' : '2.00';
    setTargetCpl(defaultValue);
  }, [objective]);

  // Загрузка лидформ при выборе цели "Lead Forms" или "Конверсии" + канал "lead_form"
  const needsLeadFormLoad = objective === 'lead_forms' || (objective === 'conversions' && conversionChannel === 'lead_form');
  useEffect(() => {
    const loadLeadForms = async () => {
      if (!open || !needsFacebook || !needsLeadFormLoad) {
        // Сброс лидформ при переключении на другую цель или платформу
        setLeadForms([]);
        setLeadFormId('');
        return;
      }
      setIsLoadingLeadForms(true);
      try {
        const list = await facebookApi.getLeadForms();
        console.log('Загружены лидформы:', list);
        setLeadForms(Array.isArray(list) ? list : []);
      } catch (e) {
        console.error('Ошибка загрузки лидформ:', e);
        setLeadForms([]);
      } finally {
        setIsLoadingLeadForms(false);
      }
    };
    loadLeadForms();
  }, [objective, conversionChannel, open, needsFacebook, needsLeadFormLoad]);

  // Сброс Instant Page ID при смене цели
  useEffect(() => {
    if (!open || !needsTikTok || tiktokObjective !== 'lead_generation') {
      setTikTokInstantPageId('');
    }
  }, [tiktokObjective, open, needsTikTok]);

  const handleCitySelection = (cityId: string) => {
    let nextSelection = [...selectedCities];
    if (nextSelection.includes(cityId)) {
      nextSelection = nextSelection.filter(id => id !== cityId);
    } else {
      if (cityId === 'KZ') {
        // "Весь Казахстан" убирает KZ-города, но оставляет другие страны/города
        nextSelection = nextSelection.filter(id => COUNTRY_IDS.includes(id) || CYPRUS_GEO_IDS.includes(id));
        nextSelection = [...nextSelection, cityId];
      } else if (cityId === 'CY') {
        // "Весь Кипр" убирает кипрские регионы/города, но оставляет остальное
        nextSelection = nextSelection.filter(id => !CYPRUS_GEO_IDS.includes(id));
        nextSelection = [...nextSelection, cityId];
      } else if (CYPRUS_GEO_IDS.includes(cityId)) {
        // Кипрский регион/город — убираем "Весь Кипр"
        nextSelection = nextSelection.filter(id => id !== 'CY');
        nextSelection = [...nextSelection, cityId];
      } else if (!COUNTRY_IDS.includes(cityId)) {
        // KZ-город — убираем "Весь Казахстан"
        nextSelection = nextSelection.filter(id => id !== 'KZ');
        nextSelection = [...nextSelection, cityId];
      } else {
        // Другая страна — просто добавляем
        nextSelection = [...nextSelection, cityId];
      }
    }
    setSelectedCities(nextSelection);
  };

  const handleTikTokCitySelection = (cityId: string) => {
    let nextSelection = [...tiktokSelectedCities];
    if (nextSelection.includes(cityId)) {
      nextSelection = nextSelection.filter(id => id !== cityId);
    } else {
      if (cityId === 'KZ') {
        nextSelection = nextSelection.filter(id => COUNTRY_IDS.includes(id) || CYPRUS_GEO_IDS.includes(id));
        nextSelection = [...nextSelection, cityId];
      } else if (cityId === 'CY') {
        nextSelection = nextSelection.filter(id => !CYPRUS_GEO_IDS.includes(id));
        nextSelection = [...nextSelection, cityId];
      } else if (CYPRUS_GEO_IDS.includes(cityId)) {
        nextSelection = nextSelection.filter(id => id !== 'CY');
        nextSelection = [...nextSelection, cityId];
      } else if (!COUNTRY_IDS.includes(cityId)) {
        nextSelection = nextSelection.filter(id => id !== 'KZ');
        nextSelection = [...nextSelection, cityId];
      } else {
        nextSelection = [...nextSelection, cityId];
      }
    }
    setTikTokSelectedCities(nextSelection);
  };

  const handleSubmit = async () => {
    // Валидация основной информации
    if (!name.trim() || name.trim().length < 2) {
      setError('Название должно содержать минимум 2 символа');
      return;
    }

    let budgetValue = 0;
    let cplValue = 0;
    let tiktokBudgetValue = 0;
    let tiktokTargetCplValue: number | null = null;

    if (needsFacebook) {
      budgetValue = parseFloat(dailyBudget);
      if (isNaN(budgetValue) || budgetValue < 5) {
        setError('Минимальный бюджет: $5/день');
        return;
      }

      cplValue = parseFloat(targetCpl);
      const minCost = objective === 'instagram_traffic' ? 0.10 : 0.50;
      if (isNaN(cplValue) || cplValue < minCost) {
        const label = objective === 'instagram_traffic' ? 'перехода' : 'заявки';
        setError(`Минимальная стоимость ${label}: $${minCost.toFixed(2)}`);
        return;
      }
    }

    if (needsTikTok) {
      tiktokBudgetValue = parseFloat(tiktokDailyBudget);
      if (isNaN(tiktokBudgetValue) || tiktokBudgetValue < TIKTOK_MIN_DAILY_BUDGET) {
        setError(`Минимальный бюджет: ${TIKTOK_MIN_DAILY_BUDGET} KZT/день`);
        return;
      }

      if (tiktokTargetCpl.trim()) {
        const parsedTarget = parseFloat(tiktokTargetCpl);
        if (isNaN(parsedTarget) || parsedTarget < 0) {
          setError('Проверьте целевую стоимость для TikTok');
          return;
        }
        tiktokTargetCplValue = Math.round(parsedTarget);
      }

      // Валидация Instant Page ID для Lead Generation
      if (tiktokObjective === 'lead_generation' && !tiktokInstantPageId) {
        setError('Введите Instant Page ID для лидогенерации TikTok');
        return;
      }
    }

    // Валидация настроек рекламы
    const usesSharedSettings = needsFacebook || (!separateTikTokSettings && needsTikTok);
    if (usesSharedSettings) {
      if (selectedCities.length === 0) {
        setError('Выберите хотя бы один город');
        return;
      }

      if (ageMin < 13 || ageMax > 65 || ageMin >= ageMax) {
        setError('Проверьте возрастной диапазон (13-65 лет)');
        return;
      }

      if (!description.trim()) {
        setError('Введите текст под видео');
        return;
      }
    }

    if (needsTikTok && separateTikTokSettings) {
      if (tiktokSelectedCities.length === 0) {
        setError('Выберите хотя бы один город для TikTok');
        return;
      }

      if (tiktokAgeMin < 13 || tiktokAgeMax > 65 || tiktokAgeMin >= tiktokAgeMax) {
        setError('Проверьте возрастной диапазон TikTok (13-65 лет)');
        return;
      }

      if (!tiktokDescription.trim()) {
        setError('Введите текст под видео для TikTok');
        return;
      }
    }

    // Валидация специфичных полей (Facebook)
    if (needsFacebook) {
      const needsWhatsAppFields = objective === 'whatsapp' || (objective === 'conversions' && conversionChannel === 'whatsapp');
      const needsLeadFormFields = objective === 'lead_forms' || (objective === 'conversions' && conversionChannel === 'lead_form');
      const needsSiteFields = objective === 'site_leads' || (objective === 'conversions' && conversionChannel === 'site');

      if (needsWhatsAppFields) {
        if (!clientQuestion.trim()) {
          setError('Введите вопрос клиента для WhatsApp');
          return;
        }

        // Валидация номера WhatsApp (если указан)
        if (whatsappPhoneNumber.trim() && !whatsappPhoneNumber.match(/^\+[1-9][0-9]{7,14}$/)) {
          setError('Неверный формат WhatsApp номера. Используйте международный формат: +12345678901');
          return;
        }

        // Валидация WABA Phone ID (обязательно для WABA типа подключения)
        if (whatsappPhoneNumber.trim() && whatsappConnectionType === 'waba' && !whatsappWabaPhoneId.trim()) {
          setError('Введите WABA Phone Number ID для подключения через Meta Cloud API');
          return;
        }
      }

      if (objective === 'instagram_traffic' && !instagramUrl.trim()) {
        setError('Введите Instagram URL');
        return;
      }

      if (needsSiteFields && !siteUrl.trim()) {
        setError('Введите URL сайта');
        return;
      }

      if (needsSiteFields && !pixelId) {
        setError('Выберите Meta Pixel для направления Site Leads');
        return;
      }

      if (needsLeadFormFields && !leadFormId) {
        setError('Выберите лидформу');
        return;
      }

      if (objective === 'app_installs' && !appStoreUrl.trim()) {
        setError('Введите ссылку на приложение (App Store / Google Play)');
        return;
      }

    }

    setIsSubmitting(true);
    setError(null);

    try {
      const facebookAdSettings: CreateDefaultSettingsInput | undefined = needsFacebook
        ? {
            direction_id: '', // Будет установлен после создания направления
            campaign_goal: objective,
            cities: selectedCities,
            age_min: ageMin,
            age_max: ageMax,
            gender,
            description: description.trim(),
            // ✅ НОВОЕ: pixel_id передаётся для ВСЕХ типов целей (для Meta CAPI)
            // Для site_leads обязателен, для остальных — опционален
            pixel_id: pixelId || null,
            ...((objective === 'whatsapp' || (objective === 'conversions' && conversionChannel === 'whatsapp')) && { client_question: clientQuestion.trim() }),
            ...(objective === 'instagram_traffic' && { instagram_url: instagramUrl.trim() }),
            ...((objective === 'site_leads' || (objective === 'conversions' && conversionChannel === 'site')) && {
              site_url: siteUrl.trim(),
              utm_tag: utmTag.trim() || DEFAULT_UTM,
            }),
            ...((objective === 'lead_forms' || (objective === 'conversions' && conversionChannel === 'lead_form')) && {
              lead_form_id: leadFormId,
              ...(siteUrl.trim() && { site_url: siteUrl.trim() }),
            }),
            ...(objective === 'app_installs' && {
              app_store_url: appStoreUrl.trim(),
              is_skadnetwork_attribution: isSkadnetworkAttribution,
            }),
          }
        : undefined;

      const tiktokAdSettings: CreateDefaultSettingsInput | undefined = needsTikTok
        ? {
            direction_id: '',
            campaign_goal: mapTikTokObjectiveToDirectionObjective(tiktokObjective),
            cities: separateTikTokSettings ? tiktokSelectedCities : selectedCities,
            age_min: separateTikTokSettings ? tiktokAgeMin : ageMin,
            age_max: separateTikTokSettings ? tiktokAgeMax : ageMax,
            gender: separateTikTokSettings ? tiktokGender : gender,
            description: (separateTikTokSettings ? tiktokDescription : description).trim(),
          }
        : undefined;

      await onSubmit({
        name: name.trim(),
        platform: directionPlatform,
        ...(needsFacebook && {
          objective,
          ...(objective === 'conversions' && {
            conversion_channel: conversionChannel,
            ...(conversionChannel !== 'lead_form' && { optimization_level: optimizationLevel }),
          }),
          use_instagram: useInstagram,
          advantage_audience_enabled: advantageAudienceEnabled,
          custom_audience_id: customAudienceId || null,
          daily_budget_cents: Math.round(budgetValue * 100),
          target_cpl_cents: Math.round(cplValue * 100),
          ...(ctaType && { cta_type: ctaType }),
          whatsapp_phone_number: whatsappPhoneNumber.trim() || undefined,
          ...(whatsappPhoneNumber.trim() && {
            whatsapp_connection_type: whatsappConnectionType,
            ...(whatsappConnectionType === 'waba' && {
              whatsapp_waba_phone_id: whatsappWabaPhoneId.trim(),
              ...(whatsappWabaAccessToken.trim() && { whatsapp_waba_access_token: whatsappWabaAccessToken.trim() }),
              ...(whatsappWabaAppSecret.trim() && { whatsapp_waba_app_secret: whatsappWabaAppSecret.trim() }),
            }),
          }),
        }),
        ...(needsTikTok && {
          tiktok_objective: tiktokObjective,
          tiktok_daily_budget: Math.round(tiktokBudgetValue),
          ...(tiktokTargetCplValue !== null && { tiktok_target_cpl_kzt: tiktokTargetCplValue }),
          ...(tiktokObjective === 'lead_generation' && tiktokInstantPageId && {
            tiktok_instant_page_id: tiktokInstantPageId,
          }),
        }),
        ...(separateTikTokSettings && needsFacebook && needsTikTok
          ? {
              facebookAdSettings,
              tiktokAdSettings,
            }
          : {
              adSettings: facebookAdSettings || tiktokAdSettings,
            }),
      });

      // Сброс формы
      resetForm();
      onOpenChange(false);
    } catch (err) {
      setError('Произошла ошибка при создании направления');
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setName('');
    setDirectionPlatform(defaultPlatform);
    setObjective('whatsapp');
    setConversionChannel('whatsapp');
    setOptimizationLevel('level_1');
    setAdvantageAudienceEnabled(true);
    setCustomAudienceId('');
    setDailyBudget('50');
    setTargetCpl('2.00');
    setTiktokObjective('traffic');
    setTikTokDailyBudget(String(TIKTOK_MIN_DAILY_BUDGET));
    setTikTokTargetCpl('');
    setSeparateTikTokSettings(false);
    setCtaType('');
    setWhatsappPhoneNumber('');
    setWhatsappConnectionType('evolution');
    setWhatsappWabaPhoneId('');
    setWhatsappWabaAccessToken('');
    setSelectedCities([]);
    setAgeMin(18);
    setAgeMax(65);
    setGender('all');
    setTikTokSelectedCities([]);
    setTikTokAgeMin(18);
    setTikTokAgeMax(65);
    setTikTokGender('all');
    setDescription('Напишите нам, чтобы узнать подробности');
    setTikTokDescription('Напишите нам, чтобы узнать подробности');
    setClientQuestion('Здравствуйте! Хочу узнать об этом подробнее.');
    setInstagramUrl('');
    setSiteUrl('');
    setPixelId('');
    setUtmTag(DEFAULT_UTM);
    setLeadFormId('');
    setAppStoreUrl('');
    setIsSkadnetworkAttribution(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        ref={dialogContentRef}
        className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto"
        onInteractOutside={(e) => {
          const el = e.target as HTMLElement;
          if (el.closest('[data-radix-popper-content-wrapper]')) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          const el = e.target as HTMLElement;
          if (el.closest('[data-radix-popper-content-wrapper]')) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Создать направление</DialogTitle>
          <DialogDescription>
            Заполните информацию о направлении и настройки рекламы
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* СЕКЦИЯ 1: Основная информация */}
          <div className="space-y-4">
            <h3 className="font-semibold text-sm">Основная информация</h3>
            
            {/* Название направления */}
            <div className="space-y-2">
              <Label htmlFor="direction-name">
                Название направления <span className="text-red-500">*</span>
              </Label>
              <Input
                id="direction-name"
                placeholder='Например: "Имплантация", "Виниры", "Брекеты"'
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isSubmitting}
                maxLength={100}
              />
              <p className="text-xs text-muted-foreground">
                Минимум 2 символа, максимум 100
              </p>
            </div>

            {/* Площадка */}
            <div className="space-y-2">
              <Label>
                Площадка <span className="text-red-500">*</span>
              </Label>
              <Select
                value={directionPlatform}
                onValueChange={(value) => setDirectionPlatform(value as DirectionPlatform)}
                disabled={isSubmitting}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Выберите площадку" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="facebook">Instagram</SelectItem>
                  <SelectItem value="tiktok">TikTok</SelectItem>
                  <SelectItem value="both">Instagram + TikTok</SelectItem>
                </SelectContent>
              </Select>
              {directionPlatform === 'both' && (
                <p className="text-xs text-muted-foreground">
                  Будут созданы два независимых направления для каждой площадки
                </p>
              )}
            </div>

            {/* Цель Instagram */}
            {needsFacebook && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label>
                    Цель Instagram <span className="text-red-500">*</span>
                  </Label>
                  <HelpTooltip tooltipKey={TooltipKeys.DIRECTION_OBJECTIVE} />
                </div>
                <RadioGroup
                  value={objective}
                  onValueChange={(value) => {
                    setObjective(value as DirectionObjective);
                  }}
                  disabled={isSubmitting}
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="whatsapp" id="obj-whatsapp" />
                    <Label htmlFor="obj-whatsapp" className="font-normal cursor-pointer">
                      {OBJECTIVE_DESCRIPTIONS.whatsapp}
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="conversions" id="obj-conversions" />
                    <Label htmlFor="obj-conversions" className="font-normal cursor-pointer">
                      {OBJECTIVE_DESCRIPTIONS.conversions}
                    </Label>
                  </div>
                  {hasInstagramId && (
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="instagram_traffic" id="obj-instagram" />
                      <Label htmlFor="obj-instagram" className="font-normal cursor-pointer">
                        {OBJECTIVE_DESCRIPTIONS.instagram_traffic}
                      </Label>
                    </div>
                  )}
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="site_leads" id="obj-site" />
                    <Label htmlFor="obj-site" className="font-normal cursor-pointer">
                      {OBJECTIVE_DESCRIPTIONS.site_leads}
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="lead_forms" id="obj-lead-forms" />
                    <Label htmlFor="obj-lead-forms" className="font-normal cursor-pointer">
                      {OBJECTIVE_DESCRIPTIONS.lead_forms}
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="app_installs" id="obj-app-installs" />
                    <Label htmlFor="obj-app-installs" className="font-normal cursor-pointer">
                      {OBJECTIVE_DESCRIPTIONS.app_installs}
                    </Label>
                  </div>
                </RadioGroup>
              </div>
            )}

            {/* Канал конверсий */}
            {needsFacebook && objective === 'conversions' && (
              <div className="space-y-2">
                <Label>
                  Канал конверсий <span className="text-red-500">*</span>
                </Label>
                <RadioGroup
                  value={conversionChannel}
                  onValueChange={(value) => {
                    setConversionChannel(value as ConversionChannel);
                  }}
                  disabled={isSubmitting}
                >
                  <div className="flex items-start space-x-2">
                    <RadioGroupItem value="whatsapp" id="channel-whatsapp" />
                    <div>
                      <Label htmlFor="channel-whatsapp" className="font-normal cursor-pointer">
                        {CONVERSION_CHANNEL_DESCRIPTIONS.whatsapp}
                      </Label>
                    </div>
                  </div>
                  <div className="flex items-start space-x-2">
                    <RadioGroupItem value="lead_form" id="channel-lead-form" />
                    <div>
                      <Label htmlFor="channel-lead-form" className="font-normal cursor-pointer">
                        {CONVERSION_CHANNEL_DESCRIPTIONS.lead_form}
                      </Label>
                    </div>
                  </div>
                  <div className="flex items-start space-x-2">
                    <RadioGroupItem value="site" id="channel-site" />
                    <div>
                      <Label htmlFor="channel-site" className="font-normal cursor-pointer">
                        {CONVERSION_CHANNEL_DESCRIPTIONS.site}
                      </Label>
                    </div>
                  </div>
                </RadioGroup>
              </div>
            )}

            {/* Уровень оптимизации для конверсий (не для lead_form — там Facebook оптимизирует сам через CRM воронку) */}
            {needsFacebook && objective === 'conversions' && conversionChannel !== 'lead_form' && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label>
                    Уровень оптимизации <span className="text-red-500">*</span>
                  </Label>
                </div>
                <RadioGroup
                  value={optimizationLevel}
                  onValueChange={(value) => setOptimizationLevel(value as OptimizationLevel)}
                  disabled={isSubmitting}
                >
                  <div className="flex items-start space-x-2">
                    <RadioGroupItem value="level_1" id="opt-level-1" />
                    <div>
                      <Label htmlFor="opt-level-1" className="font-normal cursor-pointer">
                        Level 1: Интерес
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        LeadSubmitted — 3+ сообщения от клиента
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start space-x-2">
                    <RadioGroupItem value="level_2" id="opt-level-2" />
                    <div>
                      <Label htmlFor="opt-level-2" className="font-normal cursor-pointer">
                        Level 2: Квалификация
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        LeadSubmitted — клиент квалифицирован
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start space-x-2">
                    <RadioGroupItem value="level_3" id="opt-level-3" />
                    <div>
                      <Label htmlFor="opt-level-3" className="font-normal cursor-pointer">
                        Level 3: Запись/Покупка
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        LeadSubmitted — клиент записался или купил
                      </p>
                    </div>
                  </div>
                </RadioGroup>
              </div>
            )}

            {/* Чекбокс использования Instagram аккаунта */}
            {needsFacebook && (
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="use-instagram"
                  checked={hasInstagramId ? useInstagram : false}
                  onChange={(e) => setUseInstagram(e.target.checked)}
                  disabled={isSubmitting || !hasInstagramId}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <Label htmlFor="use-instagram" className={`font-normal ${hasInstagramId ? 'cursor-pointer' : 'cursor-not-allowed text-muted-foreground'}`}>
                  Использовать Instagram аккаунт
                </Label>
              </div>
            )}
            {needsFacebook && (!useInstagram || !hasInstagramId) && (
              <p className="text-xs text-muted-foreground">
                {!hasInstagramId
                  ? 'Instagram аккаунт не привязан — реклама будет показываться только на Facebook'
                  : 'Реклама будет показываться от имени Facebook страницы без привязки к Instagram'}
              </p>
            )}

            {/* Цель TikTok */}
            {needsTikTok && (
              <div className="space-y-2">
                <Label>
                  Цель TikTok <span className="text-red-500">*</span>
                </Label>
                <RadioGroup
                  value={tiktokObjective}
                  onValueChange={(value) => setTiktokObjective(value as TikTokObjective)}
                  disabled={isSubmitting}
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="traffic" id="obj-tt-traffic" />
                    <Label htmlFor="obj-tt-traffic" className="font-normal cursor-pointer">
                      {TIKTOK_OBJECTIVE_DESCRIPTIONS.traffic}
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="conversions" id="obj-tt-conversions" />
                    <Label htmlFor="obj-tt-conversions" className="font-normal cursor-pointer">
                      {TIKTOK_OBJECTIVE_DESCRIPTIONS.conversions}
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="lead_generation" id="obj-tt-lead-gen" />
                    <Label htmlFor="obj-tt-lead-gen" className="font-normal cursor-pointer">
                      {TIKTOK_OBJECTIVE_DESCRIPTIONS.lead_generation}
                    </Label>
                  </div>
                </RadioGroup>
              </div>
            )}

            {/* TikTok Instant Page ID (Lead Generation) */}
            {needsTikTok && tiktokObjective === 'lead_generation' && (
              <div className="space-y-2">
                <Label htmlFor="tiktok-instant-page-id">
                  Instant Page ID <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="tiktok-instant-page-id"
                  value={tiktokInstantPageId}
                  onChange={(e) => setTikTokInstantPageId(e.target.value.trim())}
                  placeholder="Например: 7123456789012345678"
                  disabled={isSubmitting}
                  className="bg-white dark:bg-gray-900"
                />
                <p className="text-xs text-muted-foreground">
                  Скопируйте ID из TikTok Ads Manager → Tools → Instant Page
                </p>
              </div>
            )}

            {/* Суточный бюджет Instagram */}
            {needsFacebook && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="daily-budget">
                    Суточный бюджет Instagram <span className="text-red-500">*</span>
                  </Label>
                  <HelpTooltip tooltipKey={TooltipKeys.DIRECTION_BUDGET} />
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    id="daily-budget"
                    type="number"
                    min="5"
                    step="1"
                    placeholder="50"
                    value={dailyBudget}
                    onChange={(e) => setDailyBudget(e.target.value)}
                    disabled={isSubmitting}
                    className="flex-1"
                  />
                  <span className="text-sm text-muted-foreground whitespace-nowrap">
                    $ / день
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">Минимум: $5/день</p>
              </div>
            )}

            {/* Суточный бюджет TikTok */}
            {needsTikTok && (
              <div className="space-y-2">
                <Label htmlFor="tiktok-daily-budget">
                  Суточный бюджет TikTok <span className="text-red-500">*</span>
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="tiktok-daily-budget"
                    type="number"
                    min={TIKTOK_MIN_DAILY_BUDGET.toString()}
                    step="1"
                    placeholder={TIKTOK_MIN_DAILY_BUDGET.toString()}
                    value={tiktokDailyBudget}
                    onChange={(e) => setTikTokDailyBudget(e.target.value)}
                    disabled={isSubmitting}
                    className="flex-1"
                  />
                  <span className="text-sm text-muted-foreground whitespace-nowrap">
                    KZT / день
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Минимум: {TIKTOK_MIN_DAILY_BUDGET} KZT/день
                </p>
              </div>
            )}

            {/* Целевая стоимость Instagram */}
            {needsFacebook && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="target-cpl">
                    {objective === 'instagram_traffic'
                      ? 'Целевая стоимость перехода (CPC)'
                      : 'Целевая стоимость заявки (CPL)'} <span className="text-red-500">*</span>
                  </Label>
                  <HelpTooltip tooltipKey={objective === 'instagram_traffic' ? TooltipKeys.DIRECTION_TARGET_CPC : TooltipKeys.DIRECTION_TARGET_CPL} />
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    id="target-cpl"
                    type="number"
                    min={objective === 'instagram_traffic' ? '0.1' : '0.5'}
                    step="0.01"
                    placeholder={objective === 'instagram_traffic' ? '0.10' : '2.00'}
                    value={targetCpl}
                    onChange={(e) => setTargetCpl(e.target.value)}
                    disabled={isSubmitting}
                    className="flex-1"
                  />
                  <span className="text-sm text-muted-foreground whitespace-nowrap">
                    {objective === 'instagram_traffic' ? '$ / переход' : '$ / заявка'}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {objective === 'instagram_traffic' ? 'Минимум: $0.10/переход' : 'Минимум: $0.50/заявка'}
                </p>
              </div>
            )}

            {/* Целевая стоимость TikTok */}
            {needsTikTok && (
              <div className="space-y-2">
                <Label htmlFor="tiktok-target-cpl">
                  Целевая стоимость TikTok (опционально)
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="tiktok-target-cpl"
                    type="number"
                    min="0"
                    step="1"
                    placeholder="1500"
                    value={tiktokTargetCpl}
                    onChange={(e) => setTikTokTargetCpl(e.target.value)}
                    disabled={isSubmitting}
                    className="flex-1"
                  />
                  <span className="text-sm text-muted-foreground whitespace-nowrap">
                    KZT
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Можно оставить пустым — будет использовано значение по умолчанию
                </p>
              </div>
            )}
          </div>

          <Separator />

          {/* СЕКЦИЯ 2: Таргетинг */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">📍 Таргетинг</h3>
              {needsFacebook && needsTikTok && (
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">
                    Отдельные настройки TikTok
                  </Label>
                  <Switch
                    checked={separateTikTokSettings}
                    onCheckedChange={setSeparateTikTokSettings}
                    disabled={isSubmitting}
                  />
                </div>
              )}
            </div>

            {!separateTikTokSettings && (
              <>
                {/* География */}
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <Label>
                      География <span className="text-red-500">*</span>
                    </Label>
                    <HelpTooltip tooltipKey={TooltipKeys.DIRECTION_CITIES} />
                  </div>
                  <Popover 
                    open={cityPopoverOpen} 
                    onOpenChange={setCityPopoverOpen} 
                    modal={false}
                  >
                    <PopoverTrigger asChild>
                      <Button 
                        variant="outline" 
                        disabled={isSubmitting} 
                        className="w-full justify-between"
                      >
                        <span>
                          {selectedCities.length === 0 ? 'Выберите города' : `Выбрано: ${selectedCities.length}`}
                        </span>
                        <ChevronDown className="h-4 w-4 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      container={dialogContentRef.current}
                      className="z-50 w-72 max-h-72 overflow-hidden p-0 flex flex-col"
                      side="bottom"
                      align="start"
                      sideOffset={6}
                    >
                      <div className="p-3 pb-2 border-b">
                        <div className="relative">
                          <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                          <Input
                            placeholder="Поиск..."
                            value={geoSearch}
                            onChange={(e) => setGeoSearch(e.target.value)}
                            className="h-8 pl-7 text-sm"
                          />
                        </div>
                      </div>
                      <div className="overflow-y-auto p-2 flex-1">
                        {GEO_GROUPS.map(group => {
                          const searchLower = geoSearch.toLowerCase();
                          const filteredItems = geoSearch
                            ? group.items.filter(c => c.name.toLowerCase().includes(searchLower))
                            : group.items;
                          if (filteredItems.length === 0) return null;
                          return (
                            <div key={group.label} className="mb-2">
                              <div className="text-xs font-semibold text-muted-foreground px-2 py-1 uppercase tracking-wider">{group.label}</div>
                              {filteredItems.map(city => {
                                const isWholeCountry = city.id === 'KZ' || city.id === 'CY';
                                const isCyprusGeo = CYPRUS_GEO_IDS.includes(city.id);
                                const isOtherCountry = COUNTRY_IDS.includes(city.id) && !isWholeCountry;
                                const anyCitySelected = selectedCities.some(id => !COUNTRY_IDS.includes(id) && !CYPRUS_GEO_IDS.includes(id));
                                const isKZSelected = selectedCities.includes('KZ');
                                const isCYSelected = selectedCities.includes('CY');
                                const isDisabled = isSubmitting ||
                                  (city.id === 'KZ' && anyCitySelected) ||
                                  (!isWholeCountry && !isOtherCountry && !isCyprusGeo && isKZSelected) ||
                                  (city.id === 'CY' && selectedCities.some(id => CYPRUS_GEO_IDS.includes(id))) ||
                                  (isCyprusGeo && isCYSelected);
                                return (
                                  <div
                                    key={city.id}
                                    className={`flex items-center gap-2 cursor-pointer text-sm py-1 hover:bg-accent px-2 rounded select-none ${isDisabled ? 'opacity-50' : ''}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (!isDisabled) handleCitySelection(city.id);
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={selectedCities.includes(city.id)}
                                      disabled={isDisabled}
                                      onChange={() => { if (!isDisabled) handleCitySelection(city.id); }}
                                    />
                                    <span>{city.name}</span>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                      <div className="p-2 border-t">
                        <Button
                          className="w-full"
                          onClick={() => { setCityPopoverOpen(false); setGeoSearch(''); }}
                          variant="outline"
                          size="sm"
                        >
                          ОК
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>

                {/* Возраст */}
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <Label>
                      Возраст <span className="text-red-500">*</span>
                    </Label>
                    <HelpTooltip tooltipKey={TooltipKeys.DIRECTION_AGE} />
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min="13"
                      max="65"
                      value={ageMin}
                      onChange={(e) => setAgeMin(parseInt(e.target.value) || 13)}
                      disabled={isSubmitting}
                      className="w-24"
                    />
                    <span className="text-muted-foreground">—</span>
                    <Input
                      type="number"
                      min="13"
                      max="65"
                      value={ageMax}
                      onChange={(e) => setAgeMax(parseInt(e.target.value) || 65)}
                      disabled={isSubmitting}
                      className="w-24"
                    />
                    <span className="text-sm text-muted-foreground">лет</span>
                  </div>
                </div>

                {/* Пол */}
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <Label>Пол</Label>
                    <HelpTooltip tooltipKey={TooltipKeys.DIRECTION_GENDER} />
                  </div>
                  <RadioGroup
                    value={gender}
                    onValueChange={(value) => setGender(value as 'all' | 'male' | 'female')}
                    disabled={isSubmitting}
                    className="flex gap-4"
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="all" id="gender-all" />
                      <Label htmlFor="gender-all" className="font-normal cursor-pointer">
                        Все
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="male" id="gender-male" />
                      <Label htmlFor="gender-male" className="font-normal cursor-pointer">
                        Мужчины
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="female" id="gender-female" />
                      <Label htmlFor="gender-female" className="font-normal cursor-pointer">
                        Женщины
                      </Label>
                    </div>
                  </RadioGroup>
                </div>
              </>
            )}

            {separateTikTokSettings && needsFacebook && needsTikTok && (
              <>
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-muted-foreground">Instagram</h4>
                  {/* География */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5">
                      <Label>
                        География <span className="text-red-500">*</span>
                      </Label>
                      <HelpTooltip tooltipKey={TooltipKeys.DIRECTION_CITIES} />
                    </div>
                    <Popover 
                      open={cityPopoverOpen} 
                      onOpenChange={setCityPopoverOpen} 
                      modal={false}
                    >
                      <PopoverTrigger asChild>
                        <Button 
                          variant="outline" 
                          disabled={isSubmitting} 
                          className="w-full justify-between"
                        >
                          <span>
                            {selectedCities.length === 0 ? 'Выберите города' : `Выбрано: ${selectedCities.length}`}
                          </span>
                          <ChevronDown className="h-4 w-4 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        container={dialogContentRef.current}
                        className="z-50 w-72 max-h-72 overflow-hidden p-0 flex flex-col"
                        side="bottom"
                        align="start"
                        sideOffset={6}
                      >
                        <div className="p-3 pb-2 border-b">
                          <div className="relative">
                            <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                            <Input
                              placeholder="Поиск..."
                              value={geoSearch}
                              onChange={(e) => setGeoSearch(e.target.value)}
                              className="h-8 pl-7 text-sm"
                            />
                          </div>
                        </div>
                        <div className="overflow-y-auto p-2 flex-1">
                          {GEO_GROUPS.map(group => {
                            const searchLower = geoSearch.toLowerCase();
                            const filteredItems = geoSearch
                              ? group.items.filter(c => c.name.toLowerCase().includes(searchLower))
                              : group.items;
                            if (filteredItems.length === 0) return null;
                            return (
                              <div key={group.label} className="mb-2">
                                <div className="text-xs font-semibold text-muted-foreground px-2 py-1 uppercase tracking-wider">{group.label}</div>
                                {filteredItems.map(city => {
                                  const isKZ = city.id === 'KZ';
                                  const isOtherCountry = ['BY', 'KG', 'UZ'].includes(city.id);
                                  const anyCitySelected = selectedCities.some(id => !COUNTRY_IDS.includes(id));
                                  const isKZSelected = selectedCities.includes('KZ');
                                  const isDisabled = isSubmitting ||
                                    (isKZ && anyCitySelected) ||
                                    (!isKZ && !isOtherCountry && isKZSelected);
                                  return (
                                    <div
                                      key={city.id}
                                      className={`flex items-center gap-2 cursor-pointer text-sm py-1 hover:bg-accent px-2 rounded select-none ${isDisabled ? 'opacity-50' : ''}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (!isDisabled) handleCitySelection(city.id);
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={selectedCities.includes(city.id)}
                                        disabled={isDisabled}
                                        onChange={() => { if (!isDisabled) handleCitySelection(city.id); }}
                                      />
                                      <span>{city.name}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })}
                        </div>
                        <div className="p-2 border-t">
                          <Button
                            className="w-full"
                            onClick={() => { setCityPopoverOpen(false); setGeoSearch(''); }}
                            variant="outline"
                            size="sm"
                          >
                            ОК
                          </Button>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>

                  {/* Возраст */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5">
                      <Label>
                        Возраст <span className="text-red-500">*</span>
                      </Label>
                      <HelpTooltip tooltipKey={TooltipKeys.DIRECTION_AGE} />
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min="13"
                        max="65"
                        value={ageMin}
                        onChange={(e) => setAgeMin(parseInt(e.target.value) || 13)}
                        disabled={isSubmitting}
                        className="w-24"
                      />
                      <span className="text-muted-foreground">—</span>
                      <Input
                        type="number"
                        min="13"
                        max="65"
                        value={ageMax}
                        onChange={(e) => setAgeMax(parseInt(e.target.value) || 65)}
                        disabled={isSubmitting}
                        className="w-24"
                      />
                      <span className="text-sm text-muted-foreground">лет</span>
                    </div>
                  </div>

                  {/* Пол */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5">
                      <Label>Пол</Label>
                      <HelpTooltip tooltipKey={TooltipKeys.DIRECTION_GENDER} />
                    </div>
                    <RadioGroup
                      value={gender}
                      onValueChange={(value) => setGender(value as 'all' | 'male' | 'female')}
                      disabled={isSubmitting}
                      className="flex gap-4"
                    >
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="all" id="gender-all" />
                        <Label htmlFor="gender-all" className="font-normal cursor-pointer">
                          Все
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="male" id="gender-male" />
                        <Label htmlFor="gender-male" className="font-normal cursor-pointer">
                          Мужчины
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="female" id="gender-female" />
                        <Label htmlFor="gender-female" className="font-normal cursor-pointer">
                          Женщины
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-muted-foreground">TikTok</h4>
                  {/* География */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5">
                      <Label>
                        География <span className="text-red-500">*</span>
                      </Label>
                      <HelpTooltip tooltipKey={TooltipKeys.DIRECTION_CITIES} />
                    </div>
                    <Popover 
                      open={tiktokCityPopoverOpen} 
                      onOpenChange={setTikTokCityPopoverOpen} 
                      modal={false}
                    >
                      <PopoverTrigger asChild>
                        <Button 
                          variant="outline" 
                          disabled={isSubmitting} 
                          className="w-full justify-between"
                        >
                          <span>
                            {tiktokSelectedCities.length === 0 ? 'Выберите города' : `Выбрано: ${tiktokSelectedCities.length}`}
                          </span>
                          <ChevronDown className="h-4 w-4 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        container={dialogContentRef.current}
                        className="z-50 w-72 max-h-72 overflow-hidden p-0 flex flex-col"
                        side="bottom"
                        align="start"
                        sideOffset={6}
                      >
                        <div className="p-3 pb-2 border-b">
                          <div className="relative">
                            <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                            <Input
                              placeholder="Поиск..."
                              value={geoSearch}
                              onChange={(e) => setGeoSearch(e.target.value)}
                              className="h-8 pl-7 text-sm"
                            />
                          </div>
                        </div>
                        <div className="overflow-y-auto p-2 flex-1">
                          {GEO_GROUPS.map(group => {
                            const searchLower = geoSearch.toLowerCase();
                            const filteredItems = geoSearch
                              ? group.items.filter(c => c.name.toLowerCase().includes(searchLower))
                              : group.items;
                            if (filteredItems.length === 0) return null;
                            return (
                              <div key={group.label} className="mb-2">
                                <div className="text-xs font-semibold text-muted-foreground px-2 py-1 uppercase tracking-wider">{group.label}</div>
                                {filteredItems.map(city => {
                                  const isWholeCountry = city.id === 'KZ' || city.id === 'CY';
                                  const isCyprusGeo = CYPRUS_GEO_IDS.includes(city.id);
                                  const isOtherCountry = COUNTRY_IDS.includes(city.id) && !isWholeCountry;
                                  const anyCitySelected = tiktokSelectedCities.some(id => !COUNTRY_IDS.includes(id) && !CYPRUS_GEO_IDS.includes(id));
                                  const isKZSelected = tiktokSelectedCities.includes('KZ');
                                  const isCYSelected = tiktokSelectedCities.includes('CY');
                                  const isDisabled = isSubmitting ||
                                    (city.id === 'KZ' && anyCitySelected) ||
                                    (!isWholeCountry && !isOtherCountry && !isCyprusGeo && isKZSelected) ||
                                    (city.id === 'CY' && tiktokSelectedCities.some(id => CYPRUS_GEO_IDS.includes(id))) ||
                                    (isCyprusGeo && isCYSelected);
                                  return (
                                    <div
                                      key={city.id}
                                      className={`flex items-center gap-2 cursor-pointer text-sm py-1 hover:bg-accent px-2 rounded select-none ${isDisabled ? 'opacity-50' : ''}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (!isDisabled) handleTikTokCitySelection(city.id);
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={tiktokSelectedCities.includes(city.id)}
                                        disabled={isDisabled}
                                        onChange={() => { if (!isDisabled) handleTikTokCitySelection(city.id); }}
                                      />
                                      <span>{city.name}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })}
                        </div>
                        <div className="p-2 border-t">
                          <Button
                            className="w-full"
                            onClick={() => { setTikTokCityPopoverOpen(false); setGeoSearch(''); }}
                            variant="outline"
                            size="sm"
                          >
                            ОК
                          </Button>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>

                  {/* Возраст */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5">
                      <Label>
                        Возраст <span className="text-red-500">*</span>
                      </Label>
                      <HelpTooltip tooltipKey={TooltipKeys.DIRECTION_AGE} />
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min="13"
                        max="65"
                        value={tiktokAgeMin}
                        onChange={(e) => setTikTokAgeMin(parseInt(e.target.value) || 13)}
                        disabled={isSubmitting}
                        className="w-24"
                      />
                      <span className="text-muted-foreground">—</span>
                      <Input
                        type="number"
                        min="13"
                        max="65"
                        value={tiktokAgeMax}
                        onChange={(e) => setTikTokAgeMax(parseInt(e.target.value) || 65)}
                        disabled={isSubmitting}
                        className="w-24"
                      />
                      <span className="text-sm text-muted-foreground">лет</span>
                    </div>
                  </div>

                  {/* Пол */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5">
                      <Label>Пол</Label>
                      <HelpTooltip tooltipKey={TooltipKeys.DIRECTION_GENDER} />
                    </div>
                    <RadioGroup
                      value={tiktokGender}
                      onValueChange={(value) => setTikTokGender(value as 'all' | 'male' | 'female')}
                      disabled={isSubmitting}
                      className="flex gap-4"
                    >
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="all" id="gender-tt-all" />
                        <Label htmlFor="gender-tt-all" className="font-normal cursor-pointer">
                          Все
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="male" id="gender-tt-male" />
                        <Label htmlFor="gender-tt-male" className="font-normal cursor-pointer">
                          Мужчины
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="female" id="gender-tt-female" />
                        <Label htmlFor="gender-tt-female" className="font-normal cursor-pointer">
                          Женщины
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>
                </div>
              </>
            )}

            {needsFacebook && (
              <div className="space-y-3 rounded-md border p-3 bg-muted/20">
                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <Label>Advantage+ Audience</Label>
                    <p className="text-xs text-muted-foreground">
                      Можно отключить, если нужен строго фиксированный таргетинг.
                    </p>
                  </div>
                  <Switch
                    checked={advantageAudienceEnabled}
                    onCheckedChange={setAdvantageAudienceEnabled}
                    disabled={isSubmitting}
                  />
                </div>
              </div>
            )}

            {needsFacebook && (
              <div className="space-y-2 rounded-md border p-3 bg-muted/20">
                <Label htmlFor="direction-custom-audience">Custom Audience (опционально)</Label>
                <Select
                  value={customAudienceId || 'none'}
                  onValueChange={(value) => setCustomAudienceId(value === 'none' ? '' : value)}
                  disabled={isSubmitting || isLoadingCustomAudiences}
                >
                  <SelectTrigger id="direction-custom-audience">
                    <SelectValue placeholder={
                      isLoadingCustomAudiences
                        ? 'Загрузка...'
                        : customAudiences.length === 0
                          ? 'Аудитории не найдены'
                          : 'Выберите аудиторию'
                    } />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Без Custom Audience</SelectItem>
                    {customAudiences.length === 0 && !isLoadingCustomAudiences && (
                      <SelectItem value="no-audiences" disabled>
                        Нет доступных Custom Audience
                      </SelectItem>
                    )}
                    {customAudiences.map((audience) => (
                      <SelectItem key={audience.id} value={audience.id}>
                        {audience.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Список подтягивается из текущего рекламного кабинета Meta.
                </p>
              </div>
            )}
          </div>

          <Separator />

          {/* СЕКЦИЯ 3: Контент */}
          <div className="space-y-4">
            <h3 className="font-semibold text-sm">📝 Контент</h3>

            {!separateTikTokSettings && (
              <div className="space-y-2">
                <Label htmlFor="description">
                  Текст под видео <span className="text-red-500">*</span>
                </Label>
                <Textarea
                  id="description"
                  placeholder="Напишите нам, чтобы узнать подробности"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={isSubmitting}
                  rows={3}
                />
              </div>
            )}

            {separateTikTokSettings && needsFacebook && needsTikTok && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="description">
                    Текст под видео (Instagram) <span className="text-red-500">*</span>
                  </Label>
                  <Textarea
                    id="description"
                    placeholder="Напишите нам, чтобы узнать подробности"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    disabled={isSubmitting}
                    rows={3}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="tiktok-description">
                    Текст под видео (TikTok) <span className="text-red-500">*</span>
                  </Label>
                  <Textarea
                    id="tiktok-description"
                    placeholder="Напишите нам, чтобы узнать подробности"
                    value={tiktokDescription}
                    onChange={(e) => setTikTokDescription(e.target.value)}
                    disabled={isSubmitting}
                    rows={3}
                  />
                </div>
              </>
            )}
          </div>

          <Separator />

          {/* СЕКЦИЯ 4: Специфичные настройки в зависимости от цели */}
          {needsFacebook && (objective === 'whatsapp' || (objective === 'conversions' && conversionChannel === 'whatsapp')) && (
            <div className="space-y-4">
              <h3 className="font-semibold text-sm">💬 WhatsApp</h3>

              {/* Ввод WhatsApp номера */}
              <div className="space-y-2">
                <Label htmlFor="whatsapp-number">
                  WhatsApp номер (опционально)
                </Label>
                <Input
                  id="whatsapp-number"
                  value={whatsappPhoneNumber}
                  onChange={(e) => setWhatsappPhoneNumber(e.target.value)}
                  placeholder="+77001234567"
                  disabled={isSubmitting}
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Международный формат: +[код страны][номер]. Если не указан - будет использован дефолтный из Facebook.
                </p>
              </div>

              {/* Тип подключения WhatsApp (показываем только если номер указан) */}
              {whatsappPhoneNumber.trim() && (
                <>
                  <div className="space-y-2">
                    <Label>Тип подключения</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setWhatsappConnectionType('evolution');
                          setWhatsappWabaPhoneId('');
                          setWhatsappWabaAccessToken('');
                        }}
                        disabled={isSubmitting}
                        className={`flex items-center gap-2 p-3 rounded-lg border-2 transition-colors ${
                          whatsappConnectionType === 'evolution'
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
                        onClick={() => setWhatsappConnectionType('waba')}
                        disabled={isSubmitting}
                        className={`flex items-center gap-2 p-3 rounded-lg border-2 transition-colors ${
                          whatsappConnectionType === 'waba'
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

                  {/* WABA Phone ID - только для WABA */}
                  {whatsappConnectionType === 'waba' && (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="waba-phone-id">
                          WABA Phone Number ID <span className="text-red-500">*</span>
                        </Label>
                        <Input
                          id="waba-phone-id"
                          value={whatsappWabaPhoneId}
                          onChange={(e) => setWhatsappWabaPhoneId(e.target.value)}
                          placeholder="123456789012345"
                          disabled={isSubmitting}
                          className="font-mono"
                        />
                        <p className="text-xs text-muted-foreground">
                          Найти в Meta Business Suite → WhatsApp Manager → Phone Numbers
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="waba-access-token">WABA Access Token</Label>
                        <Input
                          id="waba-access-token"
                          type="password"
                          value={whatsappWabaAccessToken}
                          onChange={(e) => setWhatsappWabaAccessToken(e.target.value)}
                          placeholder="System User Token"
                          disabled={isSubmitting}
                          className="font-mono"
                        />
                        <p className="text-xs text-muted-foreground">
                          System User Token с правами whatsapp_business_messaging. Если не указан — используется токен из рекламного аккаунта.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="waba-app-secret">WABA App Secret</Label>
                        <Input
                          id="waba-app-secret"
                          type="password"
                          value={whatsappWabaAppSecret}
                          onChange={(e) => setWhatsappWabaAppSecret(e.target.value)}
                          placeholder="App Secret из Meta Developer Console"
                          disabled={isSubmitting}
                          className="font-mono"
                        />
                        <p className="text-xs text-muted-foreground">
                          Settings → Basic → App Secret. Используется для верификации входящих webhook.
                        </p>
                      </div>
                    </>
                  )}
                </>
              )}

              <div className="space-y-2">
                <Label htmlFor="client-question">
                  Вопрос клиента <span className="text-red-500">*</span>
                </Label>
                <Textarea
                  id="client-question"
                  placeholder="Здравствуйте! Хочу узнать об этом подробнее."
                  value={clientQuestion}
                  onChange={(e) => setClientQuestion(e.target.value)}
                  disabled={isSubmitting}
                  rows={2}
                />
                <p className="text-xs text-muted-foreground">
                  Это сообщение будет отправлено в WhatsApp от имени клиента
                </p>
              </div>
            </div>
          )}

          {needsFacebook && objective === 'instagram_traffic' && (
            <div className="space-y-4">
              <h3 className="font-semibold text-sm">📱 Instagram</h3>
              
              <div className="space-y-2">
                <Label htmlFor="instagram-url">
                  Instagram URL <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="instagram-url"
                  type="url"
                  placeholder="https://instagram.com/your_profile"
                  value={instagramUrl}
                  onChange={(e) => setInstagramUrl(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>
            </div>
          )}

          {needsFacebook && (objective === 'site_leads' || (objective === 'conversions' && conversionChannel === 'site')) && (
            <div className="space-y-4">
              <h3 className="font-semibold text-sm">🌐 Лиды на сайте</h3>
              
              <div className="space-y-2">
                <Label htmlFor="site-url">
                  URL сайта <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="site-url"
                  type="url"
                  placeholder="https://yoursite.com"
                  value={siteUrl}
                  onChange={(e) => setSiteUrl(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="pixel-id">Pixel ID <span className="text-red-500">*</span></Label>
                  <HelpTooltip tooltipKey={TooltipKeys.DIRECTION_PIXEL_ID} />
                </div>
                <Select
                  value={pixelId || 'none'}
                  onValueChange={(value) => setPixelId(value === 'none' ? '' : value)}
                  disabled={isSubmitting || isLoadingPixels}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={
                      isLoadingPixels
                        ? 'Загрузка...'
                        : pixels.length === 0
                          ? 'Нет доступных пикселей'
                          : 'Выберите пиксель'
                    } />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Без пикселя</SelectItem>
                    {pixels.length === 0 && !isLoadingPixels && (
                      <SelectItem value="no-pixels" disabled>
                        Пиксели не найдены в рекламном кабинете
                      </SelectItem>
                    )}
                    {pixels.map((pixel) => (
                      <SelectItem key={pixel.id} value={pixel.id}>
                        {pixel.name} ({pixel.id})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {pixels.length === 0 && !isLoadingPixels && (
                  <p className="text-xs text-muted-foreground">
                    В вашем рекламном кабинете не найдено пикселей. Вы можете продолжить без пикселя.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="utm-tag">UTM-метка (опционально)</Label>
                <Textarea
                  id="utm-tag"
                  placeholder={DEFAULT_UTM}
                  value={utmTag}
                  onChange={(e) => setUtmTag(e.target.value)}
                  disabled={isSubmitting}
                  rows={2}
                />
                <p className="text-xs text-muted-foreground">
                  Используйте переменные: {'{'}{'{'} campaign.name {'}'}{'}' }, {'{'}{'{'}  adset.name {'}'}{'}'}, {'{'}{'{'}  ad.name {'}'}{'}'}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cta-type-site">Кнопка действия</Label>
                <Select
                  value={ctaType || 'SIGN_UP'}
                  onValueChange={(value) => setCtaType(value)}
                  disabled={isSubmitting}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CTA_OPTIONS_SITE.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {needsFacebook && (objective === 'lead_forms' || (objective === 'conversions' && conversionChannel === 'lead_form')) && (
            <div className="space-y-4">
              <h3 className="font-semibold text-sm">📋 Лидформы Facebook</h3>

              <div className="space-y-2">
                <Label htmlFor="lead-form-id">
                  Лидформа <span className="text-red-500">*</span>
                </Label>
                <Select
                  value={leadFormId || 'none'}
                  onValueChange={(value) => setLeadFormId(value === 'none' ? '' : value)}
                  disabled={isSubmitting || isLoadingLeadForms}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={
                      isLoadingLeadForms
                        ? 'Загрузка...'
                        : leadForms.length === 0
                          ? 'Нет доступных лидформ'
                          : 'Выберите лидформу'
                    } />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none" disabled>Выберите лидформу</SelectItem>
                    {leadForms.length === 0 && !isLoadingLeadForms && (
                      <SelectItem value="no-forms" disabled>
                        Лидформы не найдены на странице Facebook
                      </SelectItem>
                    )}
                    {leadForms.map((form) => (
                      <SelectItem key={form.id} value={form.id}>
                        {form.name} ({form.status})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {leadForms.length === 0 && !isLoadingLeadForms && (
                  <p className="text-xs text-muted-foreground">
                    На вашей Facebook странице не найдено лидформ. Создайте лидформу в Facebook Ads Manager.
                  </p>
                )}
                {leadForms.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Выберите лидформу, которая будет использоваться для сбора заявок
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="lead-form-site-url">
                  URL сайта (для изображений и каруселей)
                </Label>
                <Input
                  id="lead-form-site-url"
                  type="url"
                  placeholder="https://yoursite.com"
                  value={siteUrl}
                  onChange={(e) => setSiteUrl(e.target.value)}
                  disabled={isSubmitting}
                />
                <p className="text-xs text-amber-600">
                  ⚠️ Обязательно для объявлений с изображениями и каруселями. Для видео — не требуется.
                </p>
                <p className="text-xs text-muted-foreground">
                  Если не указан, вы сможете создавать только видео объявления на эту лид-форму.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cta-type-lead">Кнопка действия</Label>
                <Select
                  value={ctaType || 'LEARN_MORE'}
                  onValueChange={(value) => setCtaType(value)}
                  disabled={isSubmitting}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CTA_OPTIONS_LEAD_FORM.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {needsFacebook && objective === 'app_installs' && (
            <div className="space-y-4">
              <h3 className="font-semibold text-sm">📲 Установки приложения</h3>
              <div className="space-y-2">
                <Label htmlFor="app-store-url">
                  Ссылка на приложение (App Store / Google Play) <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="app-store-url"
                  type="url"
                  value={appStoreUrl}
                  onChange={(e) => setAppStoreUrl(e.target.value)}
                  placeholder="https://apps.apple.com/app/id1234567890"
                  disabled={isSubmitting}
                />
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="skadnetwork-attribution"
                  checked={isSkadnetworkAttribution}
                  onCheckedChange={setIsSkadnetworkAttribution}
                  disabled={isSubmitting}
                />
                <Label htmlFor="skadnetwork-attribution" className="font-normal cursor-pointer">
                  Включить SKAdNetwork атрибуцию (iOS)
                </Label>
              </div>
              <p className="text-xs text-muted-foreground">
                App ID берётся из глобального env на сервере.
              </p>
            </div>
          )}

          {/* Ошибка */}
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Отмена
          </Button>
          <Button 
            variant="outline"
            onClick={handleSubmit} 
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Создание...' : 'Создать'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
