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
import { ChevronDown, Loader2 } from 'lucide-react';
import type { Direction, DefaultAdSettings, UpdateDefaultSettingsInput } from '@/types/direction';
import { OBJECTIVE_DESCRIPTIONS } from '@/types/direction';
import { CITIES_AND_COUNTRIES, COUNTRY_IDS, DEFAULT_UTM } from '@/constants/cities';
import { defaultSettingsApi } from '@/services/defaultSettingsApi';
import { facebookApi } from '@/services/facebookApi';
import { toast } from 'sonner';

interface EditDirectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  direction: Direction | null;
  onSubmit: (data: {
    name: string;
    daily_budget_cents: number;
    target_cpl_cents: number;
    is_active: boolean;
    whatsapp_phone_number?: string | null;
  }) => Promise<void>;
}

export const EditDirectionDialog: React.FC<EditDirectionDialogProps> = ({
  open,
  onOpenChange,
  direction,
  onSubmit,
}) => {
  // Ref для порталинга Popover внутрь Dialog
  const dialogContentRef = React.useRef<HTMLDivElement>(null);

  // Основная информация
  const [name, setName] = useState('');
  const [dailyBudget, setDailyBudget] = useState('');
  const [targetCpl, setTargetCpl] = useState('');
  const [isActive, setIsActive] = useState(true);

  // Настройки рекламы
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [cityPopoverOpen, setCityPopoverOpen] = useState(false);
  const [ageMin, setAgeMin] = useState<number>(18);
  const [ageMax, setAgeMax] = useState<number>(65);
  const [gender, setGender] = useState<'all' | 'male' | 'female'>('all');
  const [description, setDescription] = useState('Напишите нам, чтобы узнать подробности');
  
  // Специфичные для целей
  const [whatsappPhoneNumber, setWhatsappPhoneNumber] = useState('');
  const [clientQuestion, setClientQuestion] = useState('Здравствуйте! Хочу узнать об этом подробнее.');
  const [instagramUrl, setInstagramUrl] = useState('');
  const [siteUrl, setSiteUrl] = useState('');
  const [pixelId, setPixelId] = useState('');
  const [pixels, setPixels] = useState<Array<{ id: string; name: string }>>([]);
  const [isLoadingPixels, setIsLoadingPixels] = useState(false);
  const [utmTag, setUtmTag] = useState(DEFAULT_UTM);

  const [isLoadingSettings, setIsLoadingSettings] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Загрузка пикселей при выборе цели "Site Leads"
  useEffect(() => {
    const loadPixels = async () => {
      if (!direction || direction.objective !== 'site_leads') return;
      setIsLoadingPixels(true);
      try {
        const list = await facebookApi.getPixels();
        setPixels(list || []);
      } catch (e) {
        console.error('Ошибка загрузки пикселей:', e);
        setPixels([]);
      } finally {
        setIsLoadingPixels(false);
      }
    };
    loadPixels();
  }, [direction?.objective]);

  // Заполнение формы при открытии диалога
  useEffect(() => {
    if (!direction || !open) return;

    // Основная информация
    setName(direction.name);
    setDailyBudget((direction.daily_budget_cents / 100).toFixed(2));
    setTargetCpl((direction.target_cpl_cents / 100).toFixed(2));
    setIsActive(direction.is_active);
    setWhatsappPhoneNumber(direction.whatsapp_phone_number || '');
    setError(null);

    // Загружаем настройки рекламы
    loadAdSettings(direction.id);
  }, [direction, open]);

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
        if (settings.pixel_id) setPixelId(settings.pixel_id);
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
    setPixelId('');
    setUtmTag(DEFAULT_UTM);
  };

  const handleCitySelection = (cityId: string) => {
    // Простая логика как в VideoUpload
    let nextSelection = [...selectedCities];
    if (nextSelection.includes(cityId)) {
      // Снимаем выбор
      nextSelection = nextSelection.filter(id => id !== cityId);
    } else {
      // Добавляем выбор
      if (cityId === 'KZ') {
        // "Весь Казахстан" отменяет все остальные города
        nextSelection = ['KZ'];
      } else {
        // Убираем "Весь Казахстан" если был выбран
        nextSelection = nextSelection.filter(id => id !== 'KZ');
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

    const budgetValue = parseFloat(dailyBudget);
    if (isNaN(budgetValue) || budgetValue < 5) {
      setError('Минимальный бюджет: $5/день');
      return;
    }

    const cplValue = parseFloat(targetCpl);
    if (isNaN(cplValue) || cplValue < 0.5) {
      setError('Минимальная стоимость заявки: $0.50');
      return;
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

    // Валидация специфичных полей
    if (direction.objective === 'whatsapp' && !clientQuestion.trim()) {
      setError('Введите вопрос клиента для WhatsApp');
      return;
    }

    if (direction.objective === 'instagram_traffic' && !instagramUrl.trim()) {
      setError('Введите Instagram URL');
      return;
    }

    if (direction.objective === 'site_leads' && !siteUrl.trim()) {
      setError('Введите URL сайта');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Обновляем основную информацию направления
      await onSubmit({
        name: name.trim(),
        daily_budget_cents: Math.round(budgetValue * 100),
        target_cpl_cents: Math.round(cplValue * 100),
        is_active: isActive,
        whatsapp_phone_number: whatsappPhoneNumber.trim() || null,
      });

      // Обновляем или создаём настройки рекламы
      const adSettingsInput: UpdateDefaultSettingsInput = {
        cities: selectedCities,
        age_min: ageMin,
        age_max: ageMax,
        gender,
        description: description.trim(),
        ...(direction.objective === 'whatsapp' && { client_question: clientQuestion.trim() }),
        ...(direction.objective === 'instagram_traffic' && { instagram_url: instagramUrl.trim() }),
        ...(direction.objective === 'site_leads' && {
          site_url: siteUrl.trim(),
          pixel_id: pixelId || null,
          utm_tag: utmTag.trim() || DEFAULT_UTM,
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
                    {OBJECTIVE_DESCRIPTIONS[direction.objective]}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    ⚠️ Тип кампании нельзя изменить
                  </p>
                </div>

                {/* Суточный бюджет */}
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

                {/* Целевая стоимость заявки */}
                <div className="space-y-2">
                  <Label htmlFor="edit-target-cpl">
                    Целевая стоимость заявки (CPL) <span className="text-red-500">*</span>
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="edit-target-cpl"
                      type="number"
                      min="0.5"
                      step="0.01"
                      value={targetCpl}
                      onChange={(e) => setTargetCpl(e.target.value)}
                      disabled={isSubmitting}
                      className="flex-1"
                    />
                    <span className="text-sm text-muted-foreground whitespace-nowrap">
                      $ / заявка
                    </span>
                  </div>
                </div>
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
              {direction.objective === 'whatsapp' && (
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

              {direction.objective === 'instagram_traffic' && (
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

              {direction.objective === 'site_leads' && (
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
                      value={pixelId}
                      onValueChange={setPixelId}
                      disabled={isSubmitting || isLoadingPixels}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={isLoadingPixels ? 'Загрузка...' : 'Выберите пиксель'} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">Без пикселя</SelectItem>
                        {pixels.map((pixel) => (
                          <SelectItem key={pixel.id} value={pixel.id}>
                            {pixel.name} ({pixel.id})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
