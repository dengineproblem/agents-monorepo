import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Image as ImageIcon, Loader2, ChevronDown, Play, Wand2, AlertTriangle } from 'lucide-react';
import Header from '@/components/Header';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

// Константы для городов и стран (как в VideoUpload)
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
  { id: '1301648', name: 'Астана' },
  { id: '1289662', name: 'Алматы' },
  { id: '1290182', name: 'Атырау' },
];

const COUNTRIES = [
  { code: 'KZ', name: 'Казахстан' },
  { code: 'BY', name: 'Беларусь' },
  { code: 'KG', name: 'Кыргызстан' },
  { code: 'UZ', name: 'Узбекистан' },
];

const CITIES_AND_COUNTRIES = [
  ...CITIES,
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

const COUNTRY_IDS = ['KZ', 'BY', 'KG', 'UZ', 'US', 'IT', 'CA', 'SA', 'ES', 'AE', 'AU', 'FR', 'DE'];
const IMAGE_WEBHOOK_URL = 'https://n8n.performanteaiagency.com/webhook/downloadimagegen';

interface CreativeTexts {
  offer: string;
  bullets: string;
  profits: string;
  cta: string;
}

const CreativeGeneration = () => {
  const [texts, setTexts] = useState<CreativeTexts>({
    offer: '',
    bullets: '',
    profits: '',
    cta: ''
  });

  const [loading, setLoading] = useState({
    offer: false,
    bullets: false,
    profits: false,
    cta: false,
    image: false
  });

  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [userPrompt, setUserPrompt] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  
  // State для формы рекламы
  const [showAdForm, setShowAdForm] = useState(false);
  const [isLaunchingAd, setIsLaunchingAd] = useState(false);
  const [campaignName, setCampaignName] = useState('Новое объявление');
  const [description, setDescription] = useState('Напишите нам, чтобы узнать подробности');
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [dailyBudget, setDailyBudget] = useState(10);
  const [startType, setStartType] = useState<'now' | 'midnight'>('midnight');
  const [ageMin, setAgeMin] = useState<number | ''>(18);
  const [ageMax, setAgeMax] = useState<number | ''>(65);
  const [selectedGender, setSelectedGender] = useState<'all' | 'male' | 'female'>('all');
  const [userData, setUserData] = useState<any>(null);
  const [cityPopoverOpen, setCityPopoverOpen] = useState(false);
  const [creativeGenerationsAvailable, setCreativeGenerationsAvailable] = useState<number>(0);

  // Лимиты символов для каждого типа текста
  const CHARACTER_LIMITS = {
    offer: 60,    // Заголовок
    bullets: 120, // Буллеты (все 3)
    profits: 50,  // Выгода  
    cta: 40       // CTA
  };

  // Очистка blob URL при размонтировании компонента
  useEffect(() => {
    return () => {
      if (generatedImage && generatedImage.startsWith('blob:')) {
        URL.revokeObjectURL(generatedImage);
      }
    };
  }, [generatedImage]);

  const handleOpenDatePicker = () => {
    // Функция для открытия выбора даты (пока пустая)
  };

  // Загружаем prompt4 и id пользователя при инициализации
  useEffect(() => {
    const loadUserData = async () => {
      try {
        const storedUser = localStorage.getItem('user');
        const localUserData = storedUser ? JSON.parse(storedUser) : {};
        
        if (localUserData.id) {
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
            
            if (data.prompt4) {
              setUserPrompt(data.prompt4);
              console.log('Загружен prompt:', data.prompt4);
            }
            setUserId(data.id);
            console.log('Загружен user ID:', data.id);
            
            // Загружаем количество доступных генераций
            setCreativeGenerationsAvailable(data.creative_generations_available || 0);
            console.log('Загружено доступных генераций:', data.creative_generations_available || 0);
          }
        } else {
          setUserData(localUserData);
        }
      } catch (err) {
        console.error('Ошибка при инициализации данных пользователя:', err);
      }
    };
    
    loadUserData();
  }, []);

  const webhooks = {
    offer: 'https://n8n.performanteaiagency.com/webhook/offer',
    bullets: 'https://n8n.performanteaiagency.com/webhook/bullets',
    profits: 'https://n8n.performanteaiagency.com/webhook/profits',
    cta: 'https://n8n.performanteaiagency.com/webhook/cta',
    image: 'https://n8n.performanteaiagency.com/webhook/genimage'
  };

  const generateText = async (type: keyof CreativeTexts) => {
    setLoading(prev => ({ ...prev, [type]: true }));
    
    try {
      // Собираем уже заполненные поля для отправки в запросе
      const otherTexts = Object.entries(texts)
        .filter(([key]) => key !== type && texts[key as keyof CreativeTexts].trim())
        .reduce((acc, [key, value]) => {
          // Преобразуем названия полей
          let fieldName = '';
          switch(key) {
            case 'offer':
              fieldName = 'existing_offer';
              break;
            case 'bullets':
              fieldName = 'existing_bullets';
              break;
            case 'profits':
              fieldName = 'existing_benefits';
              break;
            case 'cta':
              fieldName = 'existing_cta';
              break;
            default:
              fieldName = key;
          }
          return { ...acc, [fieldName]: value };
        }, {});

      const requestData = {
        type,
        ...otherTexts, // Распаковываем поля напрямую в body
        prompt: userPrompt, // Добавляем prompt в запрос
        id: userId, // Добавляем id пользователя в запрос
      };

      console.log(`Отправляем запрос на генерацию ${type}:`, requestData);

      // Используем XMLHttpRequest без таймаута, как при загрузке видео
      const data = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', webhooks[type], true);
        xhr.setRequestHeader('Content-Type', 'application/json');

        xhr.onload = function () {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const responseData = JSON.parse(xhr.responseText);
              resolve(responseData);
            } catch (parseError) {
              reject(new Error('Ошибка парсинга ответа от сервера'));
            }
          } else {
            reject(new Error(`HTTP error! status: ${xhr.status}`));
          }
        };

        xhr.onerror = function () {
          reject(new Error('Ошибка сети при генерации'));
        };

        xhr.send(JSON.stringify(requestData));
      });
      console.log(`Получен ответ от ${type} webhook:`, data);
      
      // Типизируем data для работы с полями ответа
      const responseData = data as any;
      
      // Проверяем разные возможные поля в ответе
      let generatedText = null;
      
      // N8N возвращает массив с объектами
      if (Array.isArray(responseData) && responseData.length > 0 && responseData[0].output) {
        generatedText = responseData[0].output;
      } else if (responseData.text) {
        generatedText = responseData.text;
      } else if (responseData.result) {
        generatedText = responseData.result;
      } else if (responseData.content) {
        generatedText = responseData.content;
      } else if (responseData.generated_text) {
        generatedText = responseData.generated_text;
      } else if (responseData.response) {
        generatedText = responseData.response;
      } else if (responseData.output) {
        generatedText = responseData.output;
      } else if (typeof responseData === 'string') {
        generatedText = responseData;
      } else if (responseData.data && typeof responseData.data === 'string') {
        generatedText = responseData.data;
      }

      if (generatedText) {
        const cleanedText = cleanText(generatedText);
        console.log(`Очищенный текст для ${type}:`, cleanedText);
        setTexts(prev => ({ ...prev, [type]: cleanedText }));
        toast.success(`${getTypeLabel(type)} сгенерирован!`);
      } else {
        console.error('Неизвестный формат ответа:', data);
        throw new Error('Некорректный ответ от сервера - не найдено поле с текстом');
      }
    } catch (error) {
      console.error(`Error generating ${type}:`, error);
      toast.error(`Ошибка генерации ${getTypeLabel(type).toLowerCase()}`);
    } finally {
      setLoading(prev => ({ ...prev, [type]: false }));
    }
  };

    const generateCreative = async () => {
    // Проверяем лимит генераций
    if (creativeGenerationsAvailable <= 0) {
      toast.error('У вас закончились генерации креативов. Приобретите дополнительный пакет.');
      return;
    }

    setLoading(prev => ({ ...prev, image: true }));
    
    try {
      // Используем FormData, как в загрузке видео
      const form = new FormData();
      form.append('action', 'generate_image'); // Указываем что это генерация изображения
      form.append('prompt', `Create a marketing creative with: ${texts.offer} ${texts.bullets} ${texts.profits} ${texts.cta}`);
      form.append('size', '1024x1024');
      form.append('quality', 'standard');
      form.append('user_id', userId);
      form.append('offer', texts.offer);
      form.append('bullets', texts.bullets);
      form.append('benefits', texts.profits); // Передаем как benefits для N8N
      form.append('cta', texts.cta);

      console.log('Отправляем запрос на генерацию креатива через N8N (FormData)');

      // Используем XMLHttpRequest без таймаута, как при загрузке видео
      const data = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', 'https://n8n.performanteaiagency.com/webhook/genimage', true);
        // НЕ устанавливаем Content-Type - FormData сам установит multipart/form-data
        
        // Ожидаем бинарный ответ (изображение)
        xhr.responseType = 'blob';

        xhr.onload = function () {
          if (xhr.status >= 200 && xhr.status < 300) {
            // Проверяем тип ответа
            const contentType = xhr.getResponseHeader('Content-Type') || '';
            console.log('Content-Type ответа:', contentType);
            
            if (contentType.includes('image/')) {
              // Получили изображение как blob
              const imageBlob = xhr.response;
              console.log('Получен image blob, размер:', imageBlob.size);
              resolve({ imageBlob });
            } else {
              reject(new Error('Ожидался image/png, получен: ' + contentType));
            }
          } else {
            reject(new Error(`HTTP error! status: ${xhr.status}`));
          }
        };

        xhr.onerror = function () {
          reject(new Error('Ошибка сети при генерации креатива'));
        };

        xhr.send(form); // Отправляем FormData вместо JSON
      });

      console.log('✅ Получен ответ от N8N webhook:', data);
      
      // Типизируем data для работы с полями ответа
      const responseData = data as any;
      
      let imageUrl = null;
      
      if (responseData.imageBlob) {
        // Получили blob изображения. Для совместимости с Telegram WebView конвертируем в data URL
        const blob: Blob = responseData.imageBlob;
        const toDataURL = (b: Blob) => new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('Не удалось прочитать изображение'));
          reader.readAsDataURL(b);
        });
        try {
          // 1) Генерируем data URL
          imageUrl = await toDataURL(blob);
          console.log('Создан data URL для изображения из blob (для Telegram):', imageUrl?.slice(0, 64) + '...');

          // 2) Пробуем загрузить в Supabase Storage и использовать публичный URL (лучше для Telegram WebView)
          try {
            const fileName = `generated_creatives/${Date.now()}_${Math.random().toString(36).slice(2)}.png`;
            const uploadRes = await supabase.storage
              .from('public')
              .upload(fileName, blob, { contentType: 'image/png', upsert: true });
            if (!uploadRes.error) {
              const pub = supabase.storage.from('public').getPublicUrl(fileName);
              if (pub.data?.publicUrl) {
                imageUrl = pub.data.publicUrl;
                console.log('Изображение загружено в Supabase Storage, public URL:', imageUrl);
              }
            } else {
              console.warn('Не удалось загрузить изображение в Supabase Storage:', uploadRes.error?.message);
            }
          } catch (e) {
            console.warn('Ошибка при загрузке изображения в Supabase Storage:', e);
          }
        } catch (e) {
          // Fallback: если не удалось, пробуем blob URL
          imageUrl = URL.createObjectURL(blob);
          console.log('Fallback: создан blob URL для изображения:', imageUrl);
        }
      } else if (responseData.imageUrl || responseData.image_url || responseData.url) {
        // Прямой URL изображения
        imageUrl = responseData.imageUrl || responseData.image_url || responseData.url;
        console.log('Получен URL изображения:', imageUrl);
      } else if (responseData.base64 || responseData.image || responseData.data) {
        // Base64 изображение
        const base64Data = responseData.base64 || responseData.image || responseData.data;
        if (typeof base64Data === 'string') {
          // Создаем data URL из base64
          const base64Image = base64Data.startsWith('data:') ? base64Data : `data:image/png;base64,${base64Data}`;
          imageUrl = base64Image;
          console.log('Получено base64 изображение, размер:', base64Data.length);
        }
      } else if (Array.isArray(responseData) && responseData.length > 0) {
        // N8N может вернуть массив
        const firstItem = responseData[0];
        if (firstItem.imageUrl || firstItem.image_url || firstItem.url) {
          imageUrl = firstItem.imageUrl || firstItem.image_url || firstItem.url;
        } else if (firstItem.base64 || firstItem.image || firstItem.data) {
          const base64Data = firstItem.base64 || firstItem.image || firstItem.data;
          if (typeof base64Data === 'string') {
            imageUrl = base64Data.startsWith('data:') ? base64Data : `data:image/png;base64,${base64Data}`;
          }
        }
      }

      if (imageUrl) {
        setGeneratedImage(imageUrl);
        setShowAdForm(true); // Показываем форму запуска рекламы
        toast.success('Креатив сгенерирован!');
        
        // Уменьшаем счетчик генераций в базе данных
        try {
          const newCount = creativeGenerationsAvailable - 1;
          const { error: updateError } = await supabase
            .from('user_accounts')
            .update({ creative_generations_available: newCount })
            .eq('id', userId);
            
          if (updateError) {
            console.error('Ошибка обновления счетчика генераций:', updateError);
          } else {
            setCreativeGenerationsAvailable(newCount);
            console.log('Счетчик генераций обновлен:', newCount);
          }
        } catch (error) {
          console.error('Ошибка при обновлении счетчика:', error);
        }
      } else {
        console.error('Не найдено изображение в ответе:', data);
        toast.error('Изображение не найдено в ответе N8N');
      }

    } catch (error) {
      console.error('Error generating creative:', error);
      toast.error('Ошибка генерации креатива');
    } finally {
      setLoading(prev => ({ ...prev, image: false }));
    }
  };

  const getTypeLabel = (type: keyof CreativeTexts): string => {
    const labels = {
      offer: 'Основной оффер',
      bullets: 'Буллеты',
      profits: 'Выгода',
      cta: 'CTA (призыв к действию)'
    };
    return labels[type];
  };

  const handleTextChange = (type: keyof CreativeTexts, value: string) => {
    setTexts(prev => ({ ...prev, [type]: value }));
  };

  // Функция проверки превышения лимита символов
  const isOverLimit = (type: keyof CreativeTexts): boolean => {
    return texts[type].length > CHARACTER_LIMITS[type];
  };

  // Функция получения сообщения о лимите
  const getLimitMessage = (type: keyof CreativeTexts): string => {
    const current = texts[type].length;
    const limit = CHARACTER_LIMITS[type];
    return `${current}/${limit} символов`;
  };

  // Функции для работы с городами и формой рекламы
  const handleCitySelection = (cityId: string) => {
    setSelectedCities(prev => {
      if (prev.includes(cityId)) {
        return prev.filter(id => id !== cityId);
      } else {
        if (cityId === 'KZ') {
          return [cityId];
        }
        const newSelection = prev.filter(id => id !== 'KZ');
        return [...newSelection, cityId];
      }
    });
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

  const getGendersArray = (): number[] => {
    switch (selectedGender) {
      case 'male': return [1];
      case 'female': return [2];
      case 'all':
      default: return [1, 2];
    }
  };

  // Функция запуска рекламы с сгенерированным изображением
  const runAdWithImage = async () => {
    if (!generatedImage) {
      toast.error('Изображение не найдено');
      return;
    }
    if (selectedCities.length === 0) {
      toast.error('Пожалуйста, выберите город или "Весь Казахстан"');
      return;
    }
    if (!dailyBudget || Number(dailyBudget) <= 0) {
      toast.error('Пожалуйста, укажите суточный бюджет');
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

    setIsLaunchingAd(true);

    try {
      const actualUserData = userData || {};
      
      // Преобразуем blob URL в File объект
      let imageFile: File;
      if (generatedImage.startsWith('blob:')) {
        // Получаем blob из URL
        const response = await fetch(generatedImage);
        const blob = await response.blob();
        imageFile = new File([blob], 'generated_creative.png', { type: 'image/png' });
      } else {
        toast.error('Неподдерживаемый формат изображения');
        return;
      }

      const form = new FormData();
      if (actualUserData.id) form.append('user_id', actualUserData.id);
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
      
      // Геолокация
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
      
      // Бюджет и настройки
      const budgetInCents = dailyBudget * 100;
      form.append('daily_budget', String(budgetInCents));
      form.append('start_type', startType);
      
      // Возрастные ограничения
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
      
      // Пол
      form.append('genders', JSON.stringify(getGendersArray()));
      
      // Добавляем изображение
      form.append('image_file', imageFile);

      console.log('Отправляем запрос на запуск рекламы с изображением');

      // Отправляем запрос
      const data = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', IMAGE_WEBHOOK_URL, true);

        xhr.onload = function () {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve('success');
          } else {
            reject(new Error(`HTTP error! status: ${xhr.status}`));
          }
        };

        xhr.onerror = function () {
          reject(new Error('Ошибка сети при запуске рекламы'));
        };

        xhr.send(form);
      });

      toast.success('Реклама успешно запущена!');
      setShowAdForm(false);
      setGeneratedImage(null);
      // Очищаем форму
      setCampaignName('Новое объявление');
      setDescription('Напишите нам, чтобы узнать подробности');
      setSelectedCities([]);
      setDailyBudget(10);
      setStartType('midnight');
      setAgeMin(18);
      setAgeMax(65);
      setSelectedGender('all');

    } catch (error) {
      console.error('Ошибка при запуске рекламы:', error);
      toast.error('Ошибка запуска рекламы');
    } finally {
      setIsLaunchingAd(false);
    }
  };

  // Функция для очистки текста от лишних символов
  const cleanText = (text: string): string => {
    return text
      .replace(/\*{1,}/g, '') // Удаляем все звездочки
      .replace(/\\"/g, '"')   // Заменяем \" на обычные кавычки  
      .replace(/^["']+|["']+$/g, '') // Удаляем кавычки в начале и конце
      .replace(/\\n/g, '\n')  // Заменяем \\n на переносы строк
      .replace(/\\t/g, ' ')   // Заменяем \\t на пробелы
      .replace(/\\/g, '')     // Удаляем оставшиеся слэши
      .replace(/#{1,}/g, '')  // Удаляем символы #
      .replace(/^\s+|\s+$/g, '') // Убираем лишние пробелы в начале и конце
      .trim();
  };

  return (
    <div className="bg-background w-full max-w-full overflow-x-hidden">
              <Header onOpenDatePicker={handleOpenDatePicker} />
      <div className="w-full px-4 py-8 pt-[76px] max-w-full overflow-x-hidden">
        <div className="max-w-3xl lg:max-w-6xl mx-auto w-full">
          <div className="mb-8">
            <h1 className="text-3xl font-bold tracking-tight mb-2">Генерация Креативов</h1>
            <p className="text-muted-foreground">Создавайте креативы с помощью AI</p>
          </div>
          
          {/* Уведомление о количестве оставшихся генераций */}
          <Card className="mb-6 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-muted">
                  <Wand2 className="h-5 w-5 text-foreground" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-foreground">Доступно генераций:</span>
                    <Badge variant="secondary" className="font-semibold">
                      {creativeGenerationsAvailable}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {creativeGenerationsAvailable === 0 
                      ? 'Для генерации креативов приобретите дополнительный пакет'
                      : `Вы можете сгенерировать еще ${creativeGenerationsAvailable} креатив${creativeGenerationsAvailable === 1 ? '' : creativeGenerationsAvailable < 5 ? 'а' : 'ов'}`
                    }
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <div className="grid gap-6">
            {/* Секции для каждого типа текста */}
            {(Object.keys(texts) as Array<keyof CreativeTexts>).map((type) => (
              <Card key={type} className="shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    {getTypeLabel(type)}
                  </CardTitle>
                  <CardDescription>
                    Введите текст вручную или сгенерируйте с помощью AI
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-2">
                    <div className="flex-1 space-y-2">
                      <Textarea
                        value={texts[type]}
                        onChange={(e) => handleTextChange(type, e.target.value)}
                        placeholder={`Введите ${getTypeLabel(type).toLowerCase()}...`}
                        className={`min-h-[100px] resize-none ${isOverLimit(type) ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                      />
                      {/* Счетчик символов */}
                      <div className="flex items-center justify-between">
                        <span className={`text-xs ${isOverLimit(type) ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                          {getLimitMessage(type)}
                        </span>
                      </div>
                      {/* Предупреждение при превышении лимита */}
                      {isOverLimit(type) && (
                        <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                          <p className="text-xs text-destructive">
                            Слишком длинный текст может перекрывать другие элементы на креативе. Рекомендуем сократить.
                          </p>
                        </div>
                      )}
                    </div>
                    <Button
                      onClick={() => generateText(type)}
                      disabled={loading[type]}
                      size="icon"
                      variant="outline"
                      className="shrink-0 h-10 w-10"
                      title="Сгенерировать с помощью AI"
                    >
                      {loading[type] ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}

            {/* Кнопка генерации креатива */}
            <Button
              onClick={generateCreative}
              disabled={loading.image || creativeGenerationsAvailable <= 0}
              className="w-full bg-gradient-to-r from-gray-800 to-gray-900 hover:from-gray-900 hover:to-black text-white shadow-md hover:shadow-lg transition-all duration-200"
              size="lg"
            >
              {loading.image ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Генерирую креатив...
                </>
              ) : (
                <>
                  <ImageIcon className="h-4 w-4 mr-2" />
                  Сгенерировать креатив
                </>
              )}
            </Button>

            {loading.image && (
              <Card className="bg-amber-50/50 border-amber-200 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-amber-100">
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                    </div>
                    <div className="text-sm">
                      <div className="font-medium text-amber-900 mb-1">Важно!</div>
                      <p className="text-amber-800">
                        НЕ закрывайте браузер и НЕ блокируйте телефон до завершения генерации креатива.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

                  {/* Отображение сгенерированного изображения */}
                  {generatedImage && (
                    <Card className="shadow-sm">
                      <CardHeader>
                        <CardTitle className="text-lg">Сгенерированный креатив</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="rounded-lg overflow-hidden bg-muted/30 p-4">
                          <img
                            src={generatedImage}
                            alt="Сгенерированный креатив"
                            className="max-w-full h-auto rounded-lg shadow-md mx-auto"
                          />
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Форма запуска рекламы */}
                  {showAdForm && generatedImage && (
                    <Card className="shadow-sm">
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <div>
                            <CardTitle>Запуск рекламы</CardTitle>
                            <CardDescription>Настройте параметры рекламной кампании</CardDescription>
                          </div>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => setShowAdForm(false)}
                            disabled={isLaunchingAd}
                          >
                            ← Назад
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4">

                      <div className="space-y-2">
                        <Label htmlFor="campaign-name">Название объявления</Label>
                        <Input
                          id="campaign-name"
                          type="text"
                          placeholder="Введите название объявления"
                          value={campaignName}
                          onChange={e => setCampaignName(e.target.value)}
                          disabled={isLaunchingAd}
                          maxLength={100}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="description">Описание</Label>
                        <Textarea
                          id="description"
                          placeholder="Описание объявления"
                          value={description}
                          onChange={e => setDescription(e.target.value)}
                          disabled={isLaunchingAd}
                          maxLength={500}
                          className="min-h-[60px] resize-none"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Возрастная группа</Label>
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2">
                            <Label htmlFor="age-min" className="text-sm text-muted-foreground">От:</Label>
                            <Input
                              id="age-min"
                              type="number"
                              min="18"
                              max="65"
                              className="w-20 text-center"
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
                              disabled={isLaunchingAd}
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <Label htmlFor="age-max" className="text-sm text-muted-foreground">До:</Label>
                            <Input
                              id="age-max"
                              type="number"
                              min="18"
                              max="65"
                              className="w-20 text-center"
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
                              disabled={isLaunchingAd}
                            />
                          </div>
                          <span className="text-sm text-muted-foreground">лет</span>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="gender">Пол</Label>
                        <select 
                          id="gender"
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                          value={selectedGender}
                          onChange={e => setSelectedGender(e.target.value as 'all' | 'male' | 'female')}
                          disabled={isLaunchingAd}
                        >
                          <option value="all">Любой</option>
                          <option value="male">Мужской</option>
                          <option value="female">Женский</option>
                        </select>
                      </div>

                      <div className="space-y-2">
                        <Label>Города / Страны</Label>
                        <Popover open={cityPopoverOpen} onOpenChange={setCityPopoverOpen}>
                          <PopoverTrigger asChild>
                            <Button variant="outline" disabled={isLaunchingAd} className="w-full justify-between">
                              <span className="text-sm">{getSelectedCitiesText()}</span>
                              <ChevronDown className="h-4 w-4 opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-64 max-h-60 overflow-y-auto p-4">
                            <div className="font-medium text-sm mb-3">Выберите города или страны</div>
                            <div className="flex flex-col gap-1">
                              {CITIES_AND_COUNTRIES.map(city => {
                                const isKZ = city.id === 'KZ';
                                const isOtherCountry = ['BY', 'KG', 'UZ'].includes(city.id);
                                const anyCitySelected = selectedCities.some(id => !COUNTRY_IDS.includes(id));
                                const isKZSelected = selectedCities.includes('KZ');
                                return (
                                  <label key={city.id} className="flex items-center gap-2 cursor-pointer text-sm">
                                    <input
                                      type="checkbox"
                                      checked={selectedCities.includes(city.id)}
                                      onChange={() => handleCitySelection(city.id)}
                                      disabled={
                                        isLaunchingAd ||
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
                              variant="default"
                              size="sm"
                            >
                              ОК
                            </Button>
                          </PopoverContent>
                        </Popover>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="budget">Суточный бюджет ($)</Label>
                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="icon" onClick={() => handleBudgetChange(-1)} disabled={isLaunchingAd || dailyBudget <= 1}>-</Button>
                          <Input
                            id="budget"
                            type="number"
                            min="1"
                            className="w-24 text-center"
                            placeholder="10"
                            value={dailyBudget}
                            onChange={e => setDailyBudget(Number(e.target.value.replace(/[^0-9]/g, '')) || 1)}
                            disabled={isLaunchingAd}
                          />
                          <Button variant="outline" size="icon" onClick={() => handleBudgetChange(1)} disabled={isLaunchingAd}>+</Button>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label>Старт</Label>
                        <div className="flex gap-4">
                          <label className="flex items-center gap-2 cursor-pointer text-sm">
                            <input
                              type="radio"
                              name="startType"
                              value="midnight"
                              checked={startType === 'midnight'}
                              onChange={() => setStartType('midnight')}
                              disabled={isLaunchingAd}
                              className="h-4 w-4"
                            />
                            С полуночи
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer text-sm">
                            <input
                              type="radio"
                              name="startType"
                              value="now"
                              checked={startType === 'now'}
                              onChange={() => setStartType('now')}
                              disabled={isLaunchingAd}
                              className="h-4 w-4"
                            />
                            Сейчас
                          </label>
                        </div>
                      </div>

                      <Separator />
                      
                      <Button 
                        onClick={runAdWithImage} 
                        disabled={isLaunchingAd || !generatedImage}
                        className="w-full dark:bg-gray-700 dark:hover:bg-gray-800"
                        size="lg"
                      >
                        <Play className="mr-2 h-4 w-4" />
                        {isLaunchingAd ? 'Запускается...' : 'Запустить рекламу'}
                      </Button>

                      {isLaunchingAd && (
                        <Card className="bg-amber-50/50 border-amber-200">
                          <CardContent className="p-4">
                            <div className="flex items-start gap-3">
                              <div className="p-2 rounded-lg bg-amber-100">
                                <AlertTriangle className="h-4 w-4 text-amber-600" />
                              </div>
                              <div className="text-sm">
                                <div className="font-medium text-amber-900 mb-1">Важно!</div>
                                <p className="text-amber-800">
                                  НЕ закрывайте браузер и НЕ блокируйте телефон до завершения запуска рекламы.
                                </p>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      )}
                      </CardContent>
                    </Card>
                  )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CreativeGeneration; 