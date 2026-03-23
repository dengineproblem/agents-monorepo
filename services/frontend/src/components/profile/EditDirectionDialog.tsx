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
import { ChevronDown, Loader2 } from 'lucide-react';
import type {
  Direction,
  UpdateDefaultSettingsInput,
  OptimizationLevel
} from '@/types/direction';
import { OBJECTIVE_DESCRIPTIONS, TIKTOK_OBJECTIVE_DESCRIPTIONS, CONVERSION_CHANNEL_LABELS, CTA_OPTIONS_SITE, CTA_OPTIONS_LEAD_FORM } from '@/types/direction';
import { CITIES_AND_COUNTRIES, COUNTRY_IDS, CYPRUS_GEO_IDS, DEFAULT_UTM } from '@/constants/cities';
import { defaultSettingsApi } from '@/services/defaultSettingsApi';
import { facebookApi } from '@/services/facebookApi';
import { directionsApi, type DirectionCustomAudience } from '@/services/directionsApi';
import { toast } from 'sonner';

const TIKTOK_MIN_DAILY_BUDGET = 2500;

// CAPI settings for update
export interface EditDirectionCapiSettings {
  capi_event_level?: number | null;
}

interface EditDirectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  direction: Direction | null;
  userAccountId: string;
  accountId?: string | null;
  onSubmit: (data: {
    name: string;
    daily_budget_cents?: number;
    target_cpl_cents?: number;
    tiktok_daily_budget?: number;
    tiktok_target_cpl_kzt?: number;
    is_active: boolean;
    whatsapp_phone_number?: string | null;
    optimization_level?: OptimizationLevel;
    advantage_audience_enabled?: boolean;
    custom_audience_id?: string | null;
    cta_type?: string | null;
    capiSettings?: EditDirectionCapiSettings;
  }) => Promise<void>;
}

export const EditDirectionDialog: React.FC<EditDirectionDialogProps> = ({
  open,
  onOpenChange,
  direction,
  userAccountId,
  accountId,
  onSubmit,
}) => {
  // Ref для порталинга Popover внутрь Dialog
  const dialogContentRef = React.useRef<HTMLDivElement>(null);

  // Основная информация
  const [name, setName] = useState('');
  const [dailyBudget, setDailyBudget] = useState('');
  const [targetCpl, setTargetCpl] = useState('');
  const [tiktokDailyBudget, setTikTokDailyBudget] = useState('');
  const [tiktokTargetCpl, setTikTokTargetCpl] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [optimizationLevel, setOptimizationLevel] = useState<OptimizationLevel>('level_1');
  const [advantageAudienceEnabled, setAdvantageAudienceEnabled] = useState(true);
  const [customAudienceId, setCustomAudienceId] = useState('');
  const [customAudiences, setCustomAudiences] = useState<DirectionCustomAudience[]>([]);
  const [isLoadingCustomAudiences, setIsLoadingCustomAudiences] = useState(false);

  // Настройки рекламы
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [cityPopoverOpen, setCityPopoverOpen] = useState(false);
  const [ageMin, setAgeMin] = useState<number>(18);
  const [ageMax, setAgeMax] = useState<number>(65);
  const [gender, setGender] = useState<'all' | 'male' | 'female'>('all');
  const [description, setDescription] = useState('Напишите нам, чтобы узнать подробности');
  
  // CTA кнопка
  const [ctaType, setCtaType] = useState('');

  // Специфичные для целей
  const [whatsappPhoneNumber, setWhatsappPhoneNumber] = useState('');
  const [clientQuestion, setClientQuestion] = useState('Здравствуйте! Хочу узнать об этом подробнее.');
  const [instagramUrl, setInstagramUrl] = useState('');
  const [siteUrl, setSiteUrl] = useState('');
  const [appStoreUrl, setAppStoreUrl] = useState('');
  const [isSkadnetworkAttribution, setIsSkadnetworkAttribution] = useState(false);
  const [pixelId, setPixelId] = useState('');
  const [pixels, setPixels] = useState<Array<{ id: string; name: string }>>([]);
  const [isLoadingPixels, setIsLoadingPixels] = useState(false);
  const [utmTag, setUtmTag] = useState(DEFAULT_UTM);

  const [isLoadingSettings, setIsLoadingSettings] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isTikTok = direction?.platform === 'tiktok';

  // Загрузка пикселей для site_leads
  useEffect(() => {
    const loadPixels = async () => {
      if (!direction || isTikTok || direction.objective !== 'site_leads') {
        setPixels([]);
        return;
      }
      setIsLoadingPixels(true);
      try {
        const list = await facebookApi.getPixels();
        console.log('Загружены пиксели (Edit):', list);
        setPixels(Array.isArray(list) ? list : []);
      } catch (e) {
        console.error('Ошибка загрузки пикселей:', e);
        setPixels([]);
      } finally {
        setIsLoadingPixels(false);
      }
    };
    loadPixels();
  }, [direction?.objective, isTikTok]);

  // Загрузка кастомных аудиторий из Meta кабинета
  useEffect(() => {
    if (!open || isTikTok || !userAccountId) {
      setCustomAudiences([]);
      return;
    }

    const loadCustomAudiences = async () => {
      setIsLoadingCustomAudiences(true);
      try {
        const audiences = await directionsApi.listCustomAudiences(userAccountId, accountId || null);
        const currentAudienceId = direction?.custom_audience_id || '';
        const hasCurrentAudience = currentAudienceId
          ? audiences.some((aud) => aud.id === currentAudienceId)
          : false;

        const normalizedAudiences = hasCurrentAudience || !currentAudienceId
          ? audiences
          : [
              {
                id: currentAudienceId,
                name: `Текущая аудитория (${currentAudienceId})`,
              },
              ...audiences,
            ];

        setCustomAudiences(normalizedAudiences);
      } catch (e) {
        console.error('Ошибка загрузки custom audiences:', e);
        if (direction?.custom_audience_id) {
          setCustomAudiences([{
            id: direction.custom_audience_id,
            name: `Текущая аудитория (${direction.custom_audience_id})`,
          }]);
        } else {
          setCustomAudiences([]);
        }
      } finally {
        setIsLoadingCustomAudiences(false);
      }
    };

    loadCustomAudiences();
  }, [open, isTikTok, userAccountId, accountId, direction?.id, direction?.custom_audience_id]);

  // Заполнение формы при открытии диалога
  useEffect(() => {
    if (!direction || !open) return;

    // Основная информация
    setName(direction.name);
    setIsActive(direction.is_active);
    setOptimizationLevel(direction.optimization_level || 'level_1');
    setWhatsappPhoneNumber(direction.whatsapp_phone_number || '');
    setAdvantageAudienceEnabled(direction.advantage_audience_enabled !== false);
    setCustomAudienceId(direction.custom_audience_id || '');
    setCtaType(direction.cta_type || '');
    setError(null);

    if (isTikTok) {
      setTikTokDailyBudget(
        direction.tiktok_daily_budget ? String(direction.tiktok_daily_budget) : String(TIKTOK_MIN_DAILY_BUDGET)
      );
      setTikTokTargetCpl(
        direction.tiktok_target_cpl_kzt != null
          ? String(direction.tiktok_target_cpl_kzt)
          : direction.tiktok_target_cpl != null
            ? String(direction.tiktok_target_cpl)
            : ''
      );
      setDailyBudget('');
      setTargetCpl('');
    } else {
      setDailyBudget((direction.daily_budget_cents / 100).toFixed(2));
      setTargetCpl((direction.target_cpl_cents / 100).toFixed(2));
      setTikTokDailyBudget('');
      setTikTokTargetCpl('');
    }

    // Загружаем настройки рекламы
    loadAdSettings(direction.id);
  }, [direction, open, isTikTok]);

  const loadAdSettings = async (directionId: string) => {
    setIsLoadingSettings(true);
    try {
      console.log('[EditDirectionDialog] Загрузка настроек для направления:', directionId);
      const settings = await defaultSettingsApi.get(directionId);
      
      if (settings) {
        console.log('[EditDirectionDialog] Настройки загружены:', settings);
        setSettingsId(settings.id);
        setSelectedCities(settings.cities || []);
        setAgeMin(settings.age_min);
        setAgeMax(settings.age_max);
        setGender(settings.gender);
        setDescription(settings.description);
        
        // Специфичные для целей
        if (settings.client_question) setClientQuestion(settings.client_question);
        if (settings.instagram_url) setInstagramUrl(settings.instagram_url);
        if (settings.site_url) setSiteUrl(settings.site_url);
        if (settings.app_store_url) setAppStoreUrl(settings.app_store_url);
        setIsSkadnetworkAttribution(Boolean(settings.is_skadnetwork_attribution));
        if (settings.pixel_id) {
          setPixelId(settings.pixel_id);
        }
        if (settings.utm_tag) setUtmTag(settings.utm_tag);
      } else {
        console.log('[EditDirectionDialog] Настройки не найдены, используем дефолты');
        // Сбрасываем к дефолтам
        resetAdSettings();
      }
    } catch (error) {
      console.error('[EditDirectionDialog] Ошибка загрузки настроек:', error);
      resetAdSettings();
    } finally {
      setIsLoadingSettings(false);
    }
  };

  const resetAdSettings = () => {
    setSettingsId(null);
    setSelectedCities([]);
    setAgeMin(18);
    setAgeMax(65);
    setGender('all');
    setDescription('Напишите нам, чтобы узнать подробности');
    setClientQuestion('Здравствуйте! Хочу узнать об этом подробнее.');
    setInstagramUrl('');
    setSiteUrl('');
    setAppStoreUrl('');
    setIsSkadnetworkAttribution(false);
    setPixelId('');
    setUtmTag(DEFAULT_UTM);
  };

  const handleCitySelection = (cityId: string) => {
    let nextSelection = [...selectedCities];
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
    setSelectedCities(nextSelection);
  };

  const handleSubmit = async () => {
    if (!direction) return;

    // Валидация основной информации
    if (!name.trim() || name.trim().length < 2) {
      setError('Название должно содержать минимум 2 символа');
      return;
    }

    let budgetValue = 0;
    let cplValue = 0;
    let tiktokBudgetValue = 0;
    let tiktokTargetCplValue: number | null = null;

    if (!isTikTok) {
      budgetValue = parseFloat(dailyBudget);
      if (isNaN(budgetValue) || budgetValue < 5) {
        setError('Минимальный бюджет: $5/день');
        return;
      }

      cplValue = parseFloat(targetCpl);
      const minCost = direction?.objective === 'instagram_traffic' ? 0.10 : 0.50;
      if (isNaN(cplValue) || cplValue < minCost) {
        const label = direction?.objective === 'instagram_traffic' ? 'перехода' : 'заявки';
        setError(`Минимальная стоимость ${label}: $${minCost.toFixed(2)}`);
        return;
      }
    } else {
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
    }

    // Валидация настроек рекламы
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

    // Валидация специфичных полей (Facebook)
    if (!isTikTok) {
      if (direction.objective === 'whatsapp' && !clientQuestion.trim()) {
        setError('Введите вопрос клиента для WhatsApp');
        return;
      }

      if ((direction.objective === 'instagram_traffic' || direction.objective === 'instagram_dm') && !instagramUrl.trim()) {
        setError('Введите Instagram URL');
        return;
      }

      if (direction.objective === 'site_leads' && !siteUrl.trim()) {
        setError('Введите URL сайта');
        return;
      }

      if (direction.objective === 'app_installs' && !appStoreUrl.trim()) {
        setError('Введите ссылку на приложение (App Store / Google Play)');
        return;
      }

    }

    // lead_forms валидация не нужна - lead_form_id уже выбран при создании direction

    setIsSubmitting(true);
    setError(null);

    try {
      // Обновляем основную информацию направления
      await onSubmit({
        name: name.trim(),
        ...(isTikTok
          ? {
              tiktok_daily_budget: Math.round(tiktokBudgetValue),
              ...(tiktokTargetCplValue !== null && { tiktok_target_cpl_kzt: tiktokTargetCplValue }),
              ...(direction.tiktok_objective === 'whatsapp' && {
                whatsapp_phone_number: whatsappPhoneNumber.trim() || null,
              }),
            }
          : {
              daily_budget_cents: Math.round(budgetValue * 100),
              target_cpl_cents: Math.round(cplValue * 100),
              whatsapp_phone_number: whatsappPhoneNumber.trim() || null,
              ...(direction.objective === 'conversions' && { optimization_level: optimizationLevel }),
              advantage_audience_enabled: advantageAudienceEnabled,
              custom_audience_id: customAudienceId || null,
              cta_type: ctaType || null,
              capiSettings: {
                capi_event_level: null,
              },
            }),
        is_active: isActive,
      });

      // Обновляем или создаём настройки рекламы
      const adSettingsInput: UpdateDefaultSettingsInput = {
        cities: selectedCities,
        age_min: ageMin,
        age_max: ageMax,
        gender,
        description: description.trim(),
        ...(!isTikTok && direction.objective === 'whatsapp' && {
          client_question: clientQuestion.trim(),
        }),
        ...(isTikTok && direction.tiktok_objective === 'whatsapp' && {
          client_question: clientQuestion.trim(),
        }),
        ...(!isTikTok && (direction.objective === 'instagram_traffic' || direction.objective === 'instagram_dm') && {
          instagram_url: instagramUrl.trim(),
        }),
        ...(!isTikTok && direction.objective === 'site_leads' && {
          site_url: siteUrl.trim(),
          pixel_id: pixelId || null,
          utm_tag: utmTag.trim() || DEFAULT_UTM,
        }),
        ...(!isTikTok && direction.objective === 'lead_forms' && {
          site_url: siteUrl.trim() || null,
        }),
        ...(!isTikTok && direction.objective === 'app_installs' && {
          app_store_url: appStoreUrl.trim(),
          is_skadnetwork_attribution: isSkadnetworkAttribution,
        }),
      };

      if (settingsId) {
        // Обновляем существующие настройки
        console.log('[EditDirectionDialog] Обновление настроек:', settingsId, adSettingsInput);
        const result = await defaultSettingsApi.update(settingsId, adSettingsInput);
        
        if (!result.success) {
          console.error('[EditDirectionDialog] Ошибка обновления настроек:', result.error);
          toast.warning('Направление обновлено, но не удалось сохранить настройки рекламы');
        }
      } else {
        // Создаём новые настройки
        console.log('[EditDirectionDialog] Создание новых настроек для направления:', direction.id);
        const result = await defaultSettingsApi.save({
          direction_id: direction.id,
          campaign_goal: direction.objective,
          ...adSettingsInput,
        });
        
        if (!result.success) {
          console.error('[EditDirectionDialog] Ошибка создания настроек:', result.error);
          toast.warning('Направление обновлено, но не удалось сохранить настройки рекламы');
        }
      }

      onOpenChange(false);
    } catch (err) {
      setError('Произошла ошибка при обновлении направления');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!direction) return null;

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
          <DialogTitle>Изменить направление: {direction.name}</DialogTitle>
          <DialogDescription>
            Обновите параметры направления и настройки рекламы
          </DialogDescription>
        </DialogHeader>

        {isLoadingSettings ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Загрузка настроек...</span>
          </div>
        ) : (
          <>
            <div className="space-y-6 py-4">
              {/* СЕКЦИЯ 1: Основная информация */}
              <div className="space-y-4">
                <h3 className="font-semibold text-sm">Основная информация</h3>
                
                {/* Название направления */}
                <div className="space-y-2">
                  <Label htmlFor="edit-direction-name">
                    Название направления <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="edit-direction-name"
                    placeholder="Название направления"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={isSubmitting}
                    maxLength={100}
                  />
                </div>

                {/* Тип кампании (только для отображения) */}
                <div className="space-y-2">
                  <Label>Тип кампании</Label>
                  <div className="text-sm text-muted-foreground">
                    {isTikTok
                      ? TIKTOK_OBJECTIVE_DESCRIPTIONS[direction.tiktok_objective || 'traffic']
                      : OBJECTIVE_DESCRIPTIONS[direction.objective]}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    ⚠️ Тип кампании нельзя изменить
                  </p>
                </div>

                {/* Суточный бюджет Instagram */}
                {!isTikTok && (
                  <div className="space-y-2">
                    <Label htmlFor="edit-daily-budget">
                      Суточный бюджет <span className="text-red-500">*</span>
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="edit-daily-budget"
                        type="number"
                        min="5"
                        step="1"
                        value={dailyBudget}
                        onChange={(e) => setDailyBudget(e.target.value)}
                        disabled={isSubmitting}
                        className="flex-1"
                      />
                      <span className="text-sm text-muted-foreground whitespace-nowrap">
                        $ / день
                      </span>
                    </div>
                  </div>
                )}

                {/* Суточный бюджет TikTok */}
                {isTikTok && (
                  <div className="space-y-2">
                    <Label htmlFor="edit-tiktok-daily-budget">
                      Суточный бюджет TikTok <span className="text-red-500">*</span>
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="edit-tiktok-daily-budget"
                        type="number"
                        min={TIKTOK_MIN_DAILY_BUDGET.toString()}
                        step="1"
                        value={tiktokDailyBudget}
                        onChange={(e) => setTikTokDailyBudget(e.target.value)}
                        disabled={isSubmitting}
                        className="flex-1"
                      />
                      <span className="text-sm text-muted-foreground whitespace-nowrap">
                        KZT / день
                      </span>
                    </div>
                  </div>
                )}

                {/* Целевая стоимость Instagram */}
                {!isTikTok && (
                  <div className="space-y-2">
                    <Label htmlFor="edit-target-cpl">
                      {direction?.objective === 'instagram_traffic'
                        ? 'Целевая стоимость перехода (CPC)'
                        : 'Целевая стоимость заявки (CPL)'} <span className="text-red-500">*</span>
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="edit-target-cpl"
                        type="number"
                        min={direction?.objective === 'instagram_traffic' ? '0.1' : '0.5'}
                        step="0.01"
                        value={targetCpl}
                        onChange={(e) => setTargetCpl(e.target.value)}
                        disabled={isSubmitting}
                        className="flex-1"
                      />
                      <span className="text-sm text-muted-foreground whitespace-nowrap">
                        {direction?.objective === 'instagram_traffic' ? '$ / переход' : '$ / заявка'}
                      </span>
                    </div>
                  </div>
                )}

                {/* Целевая стоимость TikTok */}
                {isTikTok && (
                  <div className="space-y-2">
                    <Label htmlFor="edit-tiktok-target-cpl">
                      Целевая стоимость TikTok (опционально)
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="edit-tiktok-target-cpl"
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
                  </div>
                )}
              </div>

              <Separator />

              {/* СЕКЦИЯ 2: Таргетинг */}
              <div className="space-y-4">
                <h3 className="font-semibold text-sm">📍 Таргетинг</h3>

                {/* География */}
                <div className="space-y-2">
                  <Label>
                    География <span className="text-red-500">*</span>
                  </Label>
                  <Popover open={cityPopoverOpen} onOpenChange={setCityPopoverOpen} modal={false}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" disabled={isSubmitting} className="w-full justify-between">
                        <span>
                          {selectedCities.length === 0 ? 'Выберите города' : `Выбрано: ${selectedCities.length}`}
                        </span>
                        <ChevronDown className="h-4 w-4 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent 
                      container={dialogContentRef.current}
                      className="z-50 w-64 max-h-60 overflow-y-auto p-4 flex flex-col gap-2"
                      side="bottom"
                      align="start"
                      sideOffset={6}
                    >
                      <div className="font-medium text-sm mb-2">Выберите города или страны</div>
                      <div className="flex flex-col gap-1">
                        {CITIES_AND_COUNTRIES.map(city => {
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
                              className="flex items-center gap-2 cursor-pointer text-sm py-1 hover:bg-accent px-2 rounded select-none"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!isDisabled) {
                                  handleCitySelection(city.id);
                                }
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={selectedCities.includes(city.id)}
                                disabled={isDisabled}
                                onChange={() => {
                                  if (!isDisabled) {
                                    handleCitySelection(city.id);
                                  }
                                }}
                              />
                              <span>{city.name}</span>
                            </div>
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

                {/* Возраст */}
                <div className="space-y-2">
                  <Label>
                    Возраст <span className="text-red-500">*</span>
                  </Label>
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
                  <Label>Пол</Label>
                  <RadioGroup
                    value={gender}
                    onValueChange={(value) => setGender(value as 'all' | 'male' | 'female')}
                    disabled={isSubmitting}
                    className="flex gap-4"
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="all" id="edit-gender-all" />
                      <Label htmlFor="edit-gender-all" className="font-normal cursor-pointer">
                        Все
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="male" id="edit-gender-male" />
                      <Label htmlFor="edit-gender-male" className="font-normal cursor-pointer">
                        Мужчины
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="female" id="edit-gender-female" />
                      <Label htmlFor="edit-gender-female" className="font-normal cursor-pointer">
                        Женщины
                      </Label>
                    </div>
                  </RadioGroup>
                </div>

                {!isTikTok && (
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

                    <div className="space-y-2">
                      <Label htmlFor="edit-direction-custom-audience">Custom Audience (опционально)</Label>
                      <Select
                        value={customAudienceId || 'none'}
                        onValueChange={(value) => setCustomAudienceId(value === 'none' ? '' : value)}
                        disabled={isSubmitting || isLoadingCustomAudiences}
                      >
                        <SelectTrigger id="edit-direction-custom-audience">
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
                  </div>
                )}
              </div>

              <Separator />

              {/* СЕКЦИЯ 3: Контент */}
              <div className="space-y-4">
                <h3 className="font-semibold text-sm">📝 Контент</h3>

                {/* Текст под видео */}
                <div className="space-y-2">
                  <Label htmlFor="edit-description">
                    Текст под видео <span className="text-red-500">*</span>
                  </Label>
                  <Textarea
                    id="edit-description"
                    placeholder="Напишите нам, чтобы узнать подробности"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    disabled={isSubmitting}
                    rows={3}
                  />
                </div>
              </div>

              <Separator />

              {/* СЕКЦИЯ 4: Специфичные настройки в зависимости от цели */}
              {isTikTok && direction.tiktok_objective === 'whatsapp' && (
                <div className="space-y-4">
                  <h3 className="font-semibold text-sm">💬 WhatsApp (TikTok)</h3>

                  <div className="space-y-2">
                    <Label htmlFor="edit-tt-whatsapp-number">
                      WhatsApp номер (опционально)
                    </Label>
                    <Input
                      id="edit-tt-whatsapp-number"
                      value={whatsappPhoneNumber}
                      onChange={(e) => setWhatsappPhoneNumber(e.target.value)}
                      placeholder="+77001234567"
                      disabled={isSubmitting}
                      className="font-mono"
                    />
                    <p className="text-xs text-muted-foreground">
                      Международный формат: +[код страны][номер]. Используется для формирования ссылки wa.me.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="edit-tt-client-question">
                      Вопрос клиента <span className="text-red-500">*</span>
                    </Label>
                    <Textarea
                      id="edit-tt-client-question"
                      placeholder="Здравствуйте! Хочу узнать об этом подробнее."
                      value={clientQuestion}
                      onChange={(e) => setClientQuestion(e.target.value)}
                      disabled={isSubmitting}
                      rows={2}
                    />
                    <p className="text-xs text-muted-foreground">
                      Это сообщение будет предзаполнено в WhatsApp при переходе по ссылке
                    </p>
                  </div>
                </div>
              )}

              {!isTikTok && direction.objective === 'whatsapp' && (
                <div className="space-y-4">
                  <h3 className="font-semibold text-sm">💬 WhatsApp</h3>
                  
                  <div className="space-y-2">
                    <Label htmlFor="edit-whatsapp-number">
                      WhatsApp номер (опционально)
                    </Label>
                    <Input
                      id="edit-whatsapp-number"
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
                  
                  <div className="space-y-2">
                    <Label htmlFor="edit-client-question">
                      Вопрос клиента <span className="text-red-500">*</span>
                    </Label>
                    <Textarea
                      id="edit-client-question"
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

              {!isTikTok && direction.objective === 'conversions' && (
                <div className="space-y-4">
                  <h3 className="font-semibold text-sm">
                    Конверсии (CAPI)
                    {direction.conversion_channel && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        Канал: {CONVERSION_CHANNEL_LABELS[direction.conversion_channel]}
                      </span>
                    )}
                  </h3>

                  {/* Уровень оптимизации скрыт для lead_form — Facebook оптимизирует сам через CRM воронку */}
                  {direction.conversion_channel !== 'lead_form' && (
                  <div className="space-y-2">
                    <Label>
                      Уровень оптимизации <span className="text-red-500">*</span>
                    </Label>
                    <RadioGroup
                      value={optimizationLevel}
                      onValueChange={(value) => setOptimizationLevel(value as OptimizationLevel)}
                      disabled={isSubmitting}
                    >
                      <div className="flex items-start space-x-2">
                        <RadioGroupItem value="level_1" id="edit-opt-level-1" />
                        <div>
                          <Label htmlFor="edit-opt-level-1" className="font-normal cursor-pointer">
                            Level 1: Интерес
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            LeadSubmitted — 3+ сообщения от клиента
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start space-x-2">
                        <RadioGroupItem value="level_2" id="edit-opt-level-2" />
                        <div>
                          <Label htmlFor="edit-opt-level-2" className="font-normal cursor-pointer">
                            Level 2: Квалификация
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            LeadSubmitted — клиент квалифицирован
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start space-x-2">
                        <RadioGroupItem value="level_3" id="edit-opt-level-3" />
                        <div>
                          <Label htmlFor="edit-opt-level-3" className="font-normal cursor-pointer">
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

                  <div className="space-y-2">
                    <Label htmlFor="edit-wa-conv-number">
                      WhatsApp номер (опционально)
                    </Label>
                    <Input
                      id="edit-wa-conv-number"
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

                  {(direction.conversion_channel === 'site' || direction.conversion_channel === 'lead_form') && (
                    <div className="space-y-2">
                      <Label htmlFor="edit-cta-type-conv">Кнопка действия</Label>
                      <Select
                        value={ctaType || (direction.conversion_channel === 'site' ? 'SIGN_UP' : 'LEARN_MORE')}
                        onValueChange={(value) => setCtaType(value)}
                        disabled={isSubmitting}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(direction.conversion_channel === 'site' ? CTA_OPTIONS_SITE : CTA_OPTIONS_LEAD_FORM).map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              )}

              {!isTikTok && (direction.objective === 'instagram_traffic' || direction.objective === 'instagram_dm') && (
                <div className="space-y-4">
                  <h3 className="font-semibold text-sm">📱 Instagram</h3>
                  
                  <div className="space-y-2">
                    <Label htmlFor="edit-instagram-url">
                      Instagram URL <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="edit-instagram-url"
                      type="url"
                      placeholder="https://instagram.com/your_profile"
                      value={instagramUrl}
                      onChange={(e) => setInstagramUrl(e.target.value)}
                      disabled={isSubmitting}
                    />
                  </div>
                </div>
              )}

              {!isTikTok && direction.objective === 'site_leads' && (
                <div className="space-y-4">
                  <h3 className="font-semibold text-sm">🌐 Лиды на сайте</h3>
                  
                  <div className="space-y-2">
                    <Label htmlFor="edit-site-url">
                      URL сайта <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="edit-site-url"
                      type="url"
                      placeholder="https://yoursite.com"
                      value={siteUrl}
                      onChange={(e) => setSiteUrl(e.target.value)}
                      disabled={isSubmitting}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="edit-pixel-id">Pixel ID (опционально)</Label>
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
                    <Label htmlFor="edit-utm-tag">UTM-метка (опционально)</Label>
                    <Textarea
                      id="edit-utm-tag"
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
                    <Label htmlFor="edit-cta-type-site">Кнопка действия</Label>
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

              {!isTikTok && direction.objective === 'lead_forms' && (
                <div className="space-y-4">
                  <h3 className="font-semibold text-sm">📝 Лид-формы</h3>

                  <div className="space-y-2">
                    <Label htmlFor="edit-site-url-leadforms">
                      URL сайта (для image креативов)
                    </Label>
                    <Input
                      id="edit-site-url-leadforms"
                      type="url"
                      placeholder="https://yoursite.com"
                      value={siteUrl}
                      onChange={(e) => setSiteUrl(e.target.value)}
                      disabled={isSubmitting}
                    />
                    <p className="text-xs text-muted-foreground">
                      Обязательно для креативов с картинками. Для видео креативов не требуется.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="edit-cta-type-lead">Кнопка действия</Label>
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

              {!isTikTok && direction.objective === 'app_installs' && (
                <div className="space-y-4">
                  <h3 className="font-semibold text-sm">📲 Установки приложения</h3>
                  <div className="space-y-2">
                    <Label htmlFor="edit-app-store-url">
                      Ссылка на приложение (App Store / Google Play) <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="edit-app-store-url"
                      type="url"
                      value={appStoreUrl}
                      onChange={(e) => setAppStoreUrl(e.target.value)}
                      placeholder="https://apps.apple.com/app/id1234567890"
                      disabled={isSubmitting}
                    />
                  </div>
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="edit-skadnetwork-attribution"
                      checked={isSkadnetworkAttribution}
                      onCheckedChange={setIsSkadnetworkAttribution}
                      disabled={isSubmitting}
                    />
                    <Label htmlFor="edit-skadnetwork-attribution" className="font-normal cursor-pointer">
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
                {isSubmitting ? 'Сохранение...' : 'Сохранить'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
