import { toastT } from '@/utils/toastUtils';
import React, { useState, useEffect } from 'react';
import Header from '@/components/Header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MessageCircle, Instagram, Globe, ChevronDown, Save, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

// Список городов и стран (как в VideoUpload)
const CITIES = [
  { id: 'KZ', name: 'Весь Казахстан' },
  { id: '1289448', name: 'Актау' },
  { id: '1289458', name: 'Актобе' },
  { id: '1293836', name: 'Караганда' },
  { id: '1295460', name: 'Костанай' },
  { id: '1298077', name: 'Уральск' },
  { id: '1298160', name: 'Усть-Каменогорск' },
  { id: '1298304', name: 'Павлодар' },
  { id: '1299700', name: 'Семей' },
  { id: '1300313', name: 'Шымкент' },
  { id: '1301740', name: 'Туркестан' },
  { id: '1301648', name: 'Астана' },
  { id: '1289662', name: 'Алматы' },
  { id: '1290182', name: 'Атырау' },
];

const CITIES_AND_COUNTRIES = [
  ...CITIES,
  { id: 'BY', name: 'Беларусь' },
  { id: 'KG', name: 'Кыргызстан' },
  { id: 'UZ', name: 'Узбекистан' },
];

interface DefaultSettings {
  cities: string[];
  ageMin: number;
  ageMax: number;
  gender: 'all' | 'male' | 'female';
  description: string;
  // WhatsApp
  clientQuestion?: string;
  // Instagram Traffic
  instagramUrl?: string;
  // Site Leads
  siteUrl?: string;
  pixelId?: string;
  utmTag?: string;
}

const AdSettings: React.FC = () => {
  const storedUser = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
  const user = storedUser ? (() => { try { return JSON.parse(storedUser); } catch { return null; } })() : null;

  const [activeTab, setActiveTab] = useState<'whatsapp' | 'instagram_traffic' | 'site_leads'>('whatsapp');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  
  // Настройки для каждого типа кампании
  const [settings, setSettings] = useState<Record<string, DefaultSettings>>({
    whatsapp: {
      cities: ['KZ'],
      ageMin: 18,
      ageMax: 65,
      gender: 'all',
      description: 'Напишите нам, чтобы узнать подробности',
      clientQuestion: 'Здравствуйте! Хочу узнать об этом подробнее.',
    },
    instagram_traffic: {
      cities: ['KZ'],
      ageMin: 18,
      ageMax: 65,
      gender: 'all',
      description: 'Подпишитесь на наш профиль',
      instagramUrl: '',
    },
    site_leads: {
      cities: ['KZ'],
      ageMin: 18,
      ageMax: 65,
      gender: 'all',
      description: 'Узнайте больше на нашем сайте',
      siteUrl: '',
      pixelId: '',
      utmTag: 'utm_source=facebook&utm_medium=cpc&utm_campaign={{campaign.name}}',
    },
  });

  const [cityPopoverOpen, setCityPopoverOpen] = useState(false);

  // Загрузка сохраненных настроек
  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    if (!user?.id) {
      setIsLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('default_ad_settings')
        .select('*')
        .eq('user_id', user.id);

      if (error) throw error;

      if (data && data.length > 0) {
        const loadedSettings: Record<string, DefaultSettings> = { ...settings };
        
        data.forEach((row: any) => {
          loadedSettings[row.campaign_goal] = {
            cities: row.cities || ['KZ'],
            ageMin: row.age_min || 18,
            ageMax: row.age_max || 65,
            gender: row.gender || 'all',
            description: row.description || '',
            clientQuestion: row.client_question || '',
            instagramUrl: row.instagram_url || '',
            siteUrl: row.site_url || '',
            pixelId: row.pixel_id || '',
            utmTag: row.utm_tag || '',
          };
        });

        setSettings(loadedSettings);
      }
    } catch (error) {
      console.error('Ошибка загрузки настроек:', error);
      toastT.error('settingsLoadError');
    } finally {
      setIsLoading(false);
    }
  };

  const saveSettings = async () => {
    if (!user?.id) {
      toastT.error('userNotAuthorized');
      return;
    }

    setIsSaving(true);
    try {
      const currentSettings = settings[activeTab];
      
      const dataToSave = {
        user_id: user.id,
        campaign_goal: activeTab,
        cities: currentSettings.cities,
        age_min: currentSettings.ageMin,
        age_max: currentSettings.ageMax,
        gender: currentSettings.gender,
        description: currentSettings.description,
        client_question: currentSettings.clientQuestion,
        instagram_url: currentSettings.instagramUrl,
        site_url: currentSettings.siteUrl,
        pixel_id: currentSettings.pixelId,
        utm_tag: currentSettings.utmTag,
      };

      const { error } = await supabase
        .from('default_ad_settings')
        .upsert(dataToSave, {
          onConflict: 'user_id,campaign_goal'
        });

      if (error) throw error;

      toastT.success('settingsSaved');
    } catch (error) {
      console.error('Ошибка сохранения настроек:', error);
      toastT.error('settingsSaveError');
    } finally {
      setIsSaving(false);
    }
  };

  const updateSetting = (field: keyof DefaultSettings, value: any) => {
    setSettings(prev => ({
      ...prev,
      [activeTab]: {
        ...prev[activeTab],
        [field]: value,
      },
    }));
  };

  const currentSettings = settings[activeTab];

  const toggleCity = (cityId: string) => {
    const newCities = currentSettings.cities.includes(cityId)
      ? currentSettings.cities.filter(id => id !== cityId)
      : [...currentSettings.cities, cityId];
    updateSetting('cities', newCities);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-background w-full max-w-full overflow-x-hidden">
      <Header onOpenDatePicker={() => {}} showBack onBack={() => history.back()} />
      
      <main className="container mx-auto px-4 py-6 max-w-4xl pt-[140px]">
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-2">Дефолтные настройки рекламы</h1>
          <p className="text-muted-foreground">
            Настройте параметры по умолчанию для каждого типа рекламы. Эти настройки будут автоматически подставляться при загрузке видео.
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="whatsapp" className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4" />
              WhatsApp
            </TabsTrigger>
            <TabsTrigger value="instagram_traffic" className="flex items-center gap-2">
              <Instagram className="h-4 w-4" />
              Профиль
            </TabsTrigger>
            <TabsTrigger value="site_leads" className="flex items-center gap-2">
              <Globe className="h-4 w-4" />
              Сайт
            </TabsTrigger>
          </TabsList>

          {/* WhatsApp Settings */}
          <TabsContent value="whatsapp" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Настройки WhatsApp переписки</CardTitle>
                <CardDescription>Эти настройки будут использоваться по умолчанию для рекламы с целью "Переписка в WhatsApp"</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Вопрос клиента */}
                <div>
                  <Label>Вопрос клиента (по умолчанию)</Label>
                  <Textarea
                    placeholder="Здравствуйте! Хочу узнать об этом подробнее."
                    value={currentSettings.clientQuestion}
                    onChange={(e) => updateSetting('clientQuestion', e.target.value)}
                    rows={3}
                  />
                </div>

                {/* Общие настройки */}
                {renderCommonSettings()}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Instagram Traffic Settings */}
          <TabsContent value="instagram_traffic" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Настройки посещения профиля</CardTitle>
                <CardDescription>Эти настройки будут использоваться по умолчанию для рекламы с целью "Посещение профиля Instagram"</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Instagram URL */}
                <div>
                  <Label>URL профиля Instagram</Label>
                  <Input
                    type="url"
                    placeholder="https://instagram.com/your_profile"
                    value={currentSettings.instagramUrl}
                    onChange={(e) => updateSetting('instagramUrl', e.target.value)}
                  />
                </div>

                {/* Общие настройки */}
                {renderCommonSettings()}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Site Leads Settings */}
          <TabsContent value="site_leads" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Настройки лидов на сайт</CardTitle>
                <CardDescription>Эти настройки будут использоваться по умолчанию для рекламы с целью "Лиды на сайте"</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* URL сайта */}
                <div>
                  <Label>URL сайта</Label>
                  <Input
                    type="url"
                    placeholder="https://your-site.com"
                    value={currentSettings.siteUrl}
                    onChange={(e) => updateSetting('siteUrl', e.target.value)}
                  />
                </div>

                {/* Pixel ID */}
                <div>
                  <Label>ID пикселя Facebook</Label>
                  <Input
                    placeholder="Введите ID пикселя"
                    value={currentSettings.pixelId}
                    onChange={(e) => updateSetting('pixelId', e.target.value)}
                  />
                </div>

                {/* UTM метки */}
                <div>
                  <Label>UTM метки</Label>
                  <Input
                    placeholder="utm_source=facebook&utm_medium=cpc"
                    value={currentSettings.utmTag}
                    onChange={(e) => updateSetting('utmTag', e.target.value)}
                  />
                </div>

                {/* Общие настройки */}
                {renderCommonSettings()}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Кнопка сохранения */}
        <div className="flex justify-end mt-6">
          <Button 
            onClick={saveSettings} 
            disabled={isSaving} 
            size="lg"
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Сохранение...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Сохранить настройки
              </>
            )}
          </Button>
        </div>
      </main>
    </div>
  );

  // Общие настройки для всех типов
  function renderCommonSettings() {
    return (
      <>
        {/* Текст под видео */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <Label>Текст под видео</Label>
            <span className="text-xs text-muted-foreground">
              {currentSettings.description.length}/500
            </span>
          </div>
          <Textarea
            placeholder="Текст под видео"
            value={currentSettings.description}
            onChange={(e) => updateSetting('description', e.target.value)}
            rows={3}
            maxLength={500}
          />
        </div>

        {/* География */}
        <div>
          <Label>География</Label>
          <Popover open={cityPopoverOpen} onOpenChange={setCityPopoverOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-between">
                {currentSettings.cities.length === 0
                  ? 'Выберите города'
                  : `Выбрано: ${currentSettings.cities.length}`}
                <ChevronDown className="ml-2 h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-full max-h-[300px] overflow-y-auto">
              {CITIES_AND_COUNTRIES.map((city) => (
                <div
                  key={city.id}
                  className="flex items-center space-x-2 py-2 px-3 hover:bg-accent rounded cursor-pointer"
                  onClick={() => toggleCity(city.id)}
                >
                  <input
                    type="checkbox"
                    checked={currentSettings.cities.includes(city.id)}
                    onChange={() => {}}
                    className="h-4 w-4"
                  />
                  <span className="text-sm">{city.name}</span>
                </div>
              ))}
            </PopoverContent>
          </Popover>
        </div>

        {/* Возраст */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Возраст от</Label>
            <Input
              type="number"
              min={18}
              max={65}
              value={currentSettings.ageMin}
              onChange={(e) => updateSetting('ageMin', parseInt(e.target.value) || 18)}
            />
          </div>
          <div>
            <Label>Возраст до</Label>
            <Input
              type="number"
              min={18}
              max={65}
              value={currentSettings.ageMax}
              onChange={(e) => updateSetting('ageMax', parseInt(e.target.value) || 65)}
            />
          </div>
        </div>

        {/* Пол */}
        <div>
          <Label>Пол</Label>
          <Select value={currentSettings.gender} onValueChange={(v) => updateSetting('gender', v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все</SelectItem>
              <SelectItem value="male">Мужчины</SelectItem>
              <SelectItem value="female">Женщины</SelectItem>
            </SelectContent>
          </Select>
        </div>

      </>
    );
  }
};

export default AdSettings;
