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
import { ChevronDown } from 'lucide-react';
import type { DirectionObjective, CreateDefaultSettingsInput } from '@/types/direction';
import { OBJECTIVE_DESCRIPTIONS } from '@/types/direction';
import { CITIES_AND_COUNTRIES, COUNTRY_IDS, DEFAULT_UTM } from '@/constants/cities';
import { defaultSettingsApi } from '@/services/defaultSettingsApi';
import { facebookApi } from '@/services/facebookApi';

interface CreateDirectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: {
    name: string;
    objective: DirectionObjective;
    daily_budget_cents: number;
    target_cpl_cents: number;
    whatsapp_phone_number?: string;
    adSettings: CreateDefaultSettingsInput;
  }) => Promise<void>;
  userAccountId: string;
}

export const CreateDirectionDialog: React.FC<CreateDirectionDialogProps> = ({
  open,
  onOpenChange,
  onSubmit,
  userAccountId,
}) => {
  // Ref для порталинга Popover внутрь Dialog
  const dialogContentRef = React.useRef<HTMLDivElement>(null);

  // Основная информация
  const [name, setName] = useState('');
  const [objective, setObjective] = useState<DirectionObjective>('whatsapp');
  const [dailyBudget, setDailyBudget] = useState('50');
  const [targetCpl, setTargetCpl] = useState('2.00');
  
  // WhatsApp номер (вводится напрямую)
  const [whatsappPhoneNumber, setWhatsappPhoneNumber] = useState<string>('');
  
  // Настройки рекламы - Таргетинг
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [cityPopoverOpen, setCityPopoverOpen] = useState(false);
  const [ageMin, setAgeMin] = useState<number>(18);
  const [ageMax, setAgeMax] = useState<number>(65);
  const [gender, setGender] = useState<'all' | 'male' | 'female'>('all');
  
  // Настройки рекламы - Контент
  const [description, setDescription] = useState('Напишите нам, чтобы узнать подробности');
  
  // Настройки рекламы - Специфичные для целей
  const [clientQuestion, setClientQuestion] = useState('Здравствуйте! Хочу узнать об этом подробнее.');
  const [instagramUrl, setInstagramUrl] = useState('');
  const [siteUrl, setSiteUrl] = useState('');
  const [pixelId, setPixelId] = useState('');
  const [pixels, setPixels] = useState<Array<{ id: string; name: string }>>([]);
  const [isLoadingPixels, setIsLoadingPixels] = useState(false);
  const [utmTag, setUtmTag] = useState(DEFAULT_UTM);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Загрузка пикселей при выборе цели "Site Leads"
  useEffect(() => {
    const loadPixels = async () => {
      if (objective !== 'site_leads') {
        // Сброс пикселей при переключении на другую цель
        setPixels([]);
        setPixelId('');
        return;
      }
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
  }, [objective]);

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
    if (objective === 'whatsapp') {
      if (!clientQuestion.trim()) {
        setError('Введите вопрос клиента для WhatsApp');
        return;
      }
      
      // Валидация номера WhatsApp (если указан)
      if (whatsappPhoneNumber.trim() && !whatsappPhoneNumber.match(/^\+[1-9][0-9]{7,14}$/)) {
        setError('Неверный формат WhatsApp номера. Используйте международный формат: +12345678901');
        return;
      }
    }

    if (objective === 'instagram_traffic' && !instagramUrl.trim()) {
      setError('Введите Instagram URL');
      return;
    }

    if (objective === 'site_leads' && !siteUrl.trim()) {
      setError('Введите URL сайта');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const adSettings: CreateDefaultSettingsInput = {
        direction_id: '', // Будет установлен после создания направления
        campaign_goal: objective,
        cities: selectedCities,
        age_min: ageMin,
        age_max: ageMax,
        gender,
        description: description.trim(),
        ...(objective === 'whatsapp' && { client_question: clientQuestion.trim() }),
        ...(objective === 'instagram_traffic' && { instagram_url: instagramUrl.trim() }),
        ...(objective === 'site_leads' && {
          site_url: siteUrl.trim(),
          pixel_id: pixelId || null,
          utm_tag: utmTag.trim() || DEFAULT_UTM,
        }),
      };

      await onSubmit({
        name: name.trim(),
        objective,
        daily_budget_cents: Math.round(budgetValue * 100),
        target_cpl_cents: Math.round(cplValue * 100),
        whatsapp_phone_number: whatsappPhoneNumber.trim() || undefined,
        adSettings,
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
    setObjective('whatsapp');
    setDailyBudget('50');
    setTargetCpl('2.00');
    setWhatsappPhoneNumber('');
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

            {/* Тип кампании */}
            <div className="space-y-2">
              <Label>
                Тип кампании <span className="text-red-500">*</span>
              </Label>
              <RadioGroup
                value={objective}
                onValueChange={(value) => setObjective(value as DirectionObjective)}
                disabled={isSubmitting}
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="whatsapp" id="obj-whatsapp" />
                  <Label htmlFor="obj-whatsapp" className="font-normal cursor-pointer">
                    {OBJECTIVE_DESCRIPTIONS.whatsapp}
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="instagram_traffic" id="obj-instagram" />
                  <Label htmlFor="obj-instagram" className="font-normal cursor-pointer">
                    {OBJECTIVE_DESCRIPTIONS.instagram_traffic}
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="site_leads" id="obj-site" />
                  <Label htmlFor="obj-site" className="font-normal cursor-pointer">
                    {OBJECTIVE_DESCRIPTIONS.site_leads}
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* Суточный бюджет */}
            <div className="space-y-2">
              <Label htmlFor="daily-budget">
                Суточный бюджет <span className="text-red-500">*</span>
              </Label>
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

            {/* Целевая стоимость заявки */}
            <div className="space-y-2">
              <Label htmlFor="target-cpl">
                Целевая стоимость заявки (CPL) <span className="text-red-500">*</span>
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="target-cpl"
                  type="number"
                  min="0.5"
                  step="0.01"
                  placeholder="2.00"
                  value={targetCpl}
                  onChange={(e) => setTargetCpl(e.target.value)}
                  disabled={isSubmitting}
                  className="flex-1"
                />
                <span className="text-sm text-muted-foreground whitespace-nowrap">
                  $ / заявка
                </span>
              </div>
              <p className="text-xs text-muted-foreground">Минимум: $0.50/заявка</p>
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

          <Separator />

          {/* СЕКЦИЯ 3: Контент */}
          <div className="space-y-4">
            <h3 className="font-semibold text-sm">📝 Контент</h3>

            {/* Текст под видео */}
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
          </div>

          <Separator />

          {/* СЕКЦИЯ 4: Специфичные настройки в зависимости от цели */}
          {objective === 'whatsapp' && (
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

          {objective === 'instagram_traffic' && (
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

          {objective === 'site_leads' && (
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
                <Label htmlFor="pixel-id">Pixel ID (опционально)</Label>
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

