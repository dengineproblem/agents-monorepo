import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Sparkles, Image as ImageIcon, Loader2, Wand2, AlertTriangle, Upload, X, Edit } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import Header from '@/components/Header';
import PageHero from '@/components/common/PageHero';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useDirections } from '@/hooks/useDirections';
import { creativesApi } from '@/services/creativesApi';

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
  const [userData, setUserData] = useState<any>(null);
  const [creativeGenerationsAvailable, setCreativeGenerationsAvailable] = useState<number>(0);
  
  // State для создания креатива
  const [selectedDirectionId, setSelectedDirectionId] = useState<string>('');
  const [isCreatingCreative, setIsCreatingCreative] = useState(false);
  
  // State для референсного изображения
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [referenceImageFile, setReferenceImageFile] = useState<File | null>(null);
  const [referenceImagePrompt, setReferenceImagePrompt] = useState<string>('');
  
  // State для редактирования
  const [isEditMode, setIsEditMode] = useState(false);
  const [editPrompt, setEditPrompt] = useState<string>('');
  
  // Загрузка направлений
  const { directions, loading: directionsLoading } = useDirections(userId);

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
      if (referenceImage && referenceImage.startsWith('blob:')) {
        URL.revokeObjectURL(referenceImage);
      }
    };
  }, [generatedImage, referenceImage]);

  const handleOpenDatePicker = () => {
    // Функция для открытия выбора даты (пока пустая)
  };

  // Загружаем prompt4 и id пользователя при инициализации
  useEffect(() => {
    const loadUserData = async () => {
      try {
        console.log('=== Начало загрузки данных пользователя ===');
        const storedUser = localStorage.getItem('user');
        console.log('Данные из localStorage:', storedUser);
        const localUserData = storedUser ? JSON.parse(storedUser) : {};
        
        if (localUserData.id) {
          console.log('Запрашиваем данные пользователя из Supabase:', localUserData.id);
          const { data, error } = await supabase
            .from('user_accounts')
            .select('*')
            .eq('id', localUserData.id)
            .single();
            
          if (error) {
            console.error('❌ Ошибка загрузки данных пользователя из Supabase:', error);
            console.error('Детали ошибки:', JSON.stringify(error, null, 2));
            setUserData(localUserData); // fallback
            
            // Устанавливаем данные из localStorage как fallback
            if (localUserData.id) {
              setUserId(localUserData.id);
              console.log('⚠️ Используем user ID из localStorage:', localUserData.id);
            }
            if (localUserData.prompt4) {
              setUserPrompt(localUserData.prompt4);
              console.log('⚠️ Используем prompt из localStorage');
            }
          } else if (data) {
            console.log('✅ Получены данные пользователя из Supabase');
            console.log('User ID:', data.id);
            console.log('Prompt4:', data.prompt4 ? `Загружен (${data.prompt4.length} символов)` : 'НЕ НАСТРОЕН');
            console.log('Доступных генераций:', data.creative_generations_available);
            
            const combinedData = { ...localUserData, ...data };
            localStorage.setItem('user', JSON.stringify(combinedData));
            setUserData(combinedData);
            
            if (data.prompt4) {
              setUserPrompt(data.prompt4);
              console.log('✅ Загружен prompt');
            } else {
              console.warn('⚠️ prompt4 не найден в данных пользователя');
            }
            setUserId(data.id);
            console.log('✅ Установлен user ID:', data.id);
            
            // Загружаем количество доступных генераций
            setCreativeGenerationsAvailable(data.creative_generations_available || 0);
          }
        } else {
          console.warn('⚠️ User ID не найден в localStorage');
          setUserData(localUserData);
        }
        console.log('=== Завершение загрузки данных пользователя ===');
      } catch (err) {
        console.error('❌ Критическая ошибка при инициализации данных пользователя:', err);
      }
    };
    
    loadUserData();
  }, []);

  // API базовый URL для creative-generation-service
  // В dev используем локальный сервер, в production - прокси через nginx
  const CREATIVE_API_BASE = import.meta.env.VITE_CREATIVE_API_URL || 'http://localhost:8085';

  const generateText = async (type: keyof CreativeTexts) => {
    setLoading(prev => ({ ...prev, [type]: true }));
    
    try {
      // Проверяем, что user_id загружен
      if (!userId) {
        console.error('User ID не загружен');
        throw new Error('Не удалось определить пользователя. Пожалуйста, перезагрузите страницу.');
      }

      // Проверяем, что prompt загружен
      if (!userPrompt) {
        console.error('User prompt не загружен');
        console.error('User data:', userData);
        throw new Error('Промпт не настроен. Пожалуйста, настройте prompt4 в профиле.');
      }

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
        user_id: userId,
        prompt: userPrompt || '',
        ...otherTexts
      };

      console.log(`Отправляем запрос на генерацию ${type}:`, requestData);
      console.log(`User ID: ${userId}, Prompt length: ${userPrompt?.length || 0}`);

      // Вызываем новый API creative-generation-service
      const response = await fetch(`${CREATIVE_API_BASE}/generate-${type}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData)
      });

      if (!response.ok) {
        // Пытаемся получить детали ошибки от сервера
        let errorMessage = `HTTP error! status: ${response.status}`;
        try {
          const errorData = await response.json();
          console.error('Ошибка от сервера:', errorData);
          
          if (response.status === 404) {
            errorMessage = 'Пользователь не найден в системе. Попробуйте перезайти в систему.';
          } else if (errorData.error) {
            errorMessage = errorData.error;
            if (errorData.details) {
              errorMessage += ` (${errorData.details})`;
            }
          }
        } catch (e) {
          console.error('Не удалось распарсить ошибку от сервера');
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      console.log(`=== Получен ответ от API для ${type} ===`);
      console.log(`Полный ответ:`, JSON.stringify(data, null, 2));
      console.log(`Тип data:`, typeof data);
      console.log(`Ключи в data:`, Object.keys(data));
      
      if (!data.success) {
        throw new Error(data.error || 'Ошибка генерации');
      }

      // Получаем значение из основного поля
      console.log(`\n--- Поиск значения для поля "${type}" ---`);
      console.log(`data.hasOwnProperty("${type}"):`, data.hasOwnProperty(type));
      console.log(`data["${type}"]:`, data[type]);
      console.log(`Тип data["${type}"]:`, typeof data[type]);
      
      // Проверяем все возможные варианты названий полей
      const fieldMappings: Record<string, string[]> = {
        offer: ['offer', 'headline', 'title', 'generated_offer'],
        bullets: ['bullets', 'bullet_points', 'generated_bullets'],
        profits: ['profits', 'benefits', 'generated_benefits', 'generated_profits'],
        cta: ['cta', 'call_to_action', 'generated_cta']
      };
      
      const possibleFields = [type, ...(fieldMappings[type] || []), 'text', 'result', 'generated_text'];
      console.log(`Возможные поля для проверки:`, possibleFields);
      
      let generatedText: string | undefined;
      let foundField: string | undefined;
      
      for (const field of possibleFields) {
        const value = data[field];
        console.log(`\nПроверяем поле "${field}":`, {
          exists: data.hasOwnProperty(field),
          value: value,
          type: typeof value,
          isString: typeof value === 'string',
          length: typeof value === 'string' ? value.length : 'N/A',
          trimmedLength: typeof value === 'string' ? value.trim().length : 'N/A'
        });
        
        if (typeof value === 'string' && value.trim().length > 0) {
          generatedText = value;
          foundField = field;
          console.log(`✅ Найдено значение в поле "${field}": "${value.substring(0, 100)}..."`);
          break;
        }
      }

      console.log(`\n--- Результат поиска ---`);
      console.log(`Найдено поле:`, foundField);
      console.log(`Значение:`, generatedText);
      
      if (generatedText && generatedText.trim().length > 0) {
        const cleanedText = cleanText(generatedText);
        console.log(`✅ Очищенный текст для ${type} (${cleanedText.length} символов):`, cleanedText);
        setTexts(prev => ({ ...prev, [type]: cleanedText }));
        toast.success(`${getTypeLabel(type)} сгенерирован!`);
      } else {
        console.error('\n❌ === ОШИБКА: Текст не найден ===');
        console.error('Доступные поля:', Object.keys(data));
        console.error('Значения всех полей:', data);
        console.error('Проверенные варианты:', possibleFields);
        throw new Error(`Некорректный ответ от сервера. Ожидалось непустое текстовое поле "${type}", но все проверенные варианты пусты или отсутствуют. Доступные поля: ${Object.keys(data).join(', ')}`);
      }
    } catch (error: any) {
      console.error(`Error generating ${type}:`, error);
      toast.error(error.message || `Ошибка генерации ${getTypeLabel(type).toLowerCase()}`);
    } finally {
      setLoading(prev => ({ ...prev, [type]: false }));
    }
  };

  // Обработка загрузки референсного изображения
  const handleReferenceImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Проверка типа файла
    if (!file.type.startsWith('image/')) {
      toast.error('Пожалуйста, выберите изображение');
      return;
    }

    // Проверка размера файла (макс 10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Размер изображения не должен превышать 10MB');
      return;
    }

    setReferenceImageFile(file);
    
    // Создаем preview URL
    const reader = new FileReader();
    reader.onload = (e) => {
      setReferenceImage(e.target?.result as string);
    };
    reader.readAsDataURL(file);
    
    toast.success('Референсное изображение загружено');
  };

  // Удаление референсного изображения
  const removeReferenceImage = () => {
    if (referenceImage && referenceImage.startsWith('blob:')) {
      URL.revokeObjectURL(referenceImage);
    }
    setReferenceImage(null);
    setReferenceImageFile(null);
    setReferenceImagePrompt('');
  };

  const generateCreative = async (isEdit: boolean = false) => {
    // Проверяем лимит генераций
    if (creativeGenerationsAvailable <= 0) {
      toast.error('У вас закончились генерации креативов. Приобретите дополнительный пакет.');
      return;
    }

    setLoading(prev => ({ ...prev, image: true }));
    
    try {
      let referenceImageBase64: string | undefined;
      
      // Если редактируем - используем сгенерированное изображение как референс
      if (isEdit && generatedImage) {
        const response = await fetch(generatedImage);
        const blob = await response.blob();
        const reader = new FileReader();
        referenceImageBase64 = await new Promise((resolve) => {
          reader.onload = () => {
            const base64 = (reader.result as string).split(',')[1];
            resolve(base64);
          };
          reader.readAsDataURL(blob);
        });
      } 
      // Если есть референсное изображение - используем его
      else if (referenceImage) {
        const base64 = referenceImage.split(',')[1];
        referenceImageBase64 = base64;
      }

      const requestData = {
        user_id: userId,
        offer: texts.offer,
        bullets: texts.bullets,
        profits: texts.profits,
        cta: texts.cta,
        direction_id: selectedDirectionId || undefined,
        reference_image: referenceImageBase64,
        reference_image_type: referenceImageBase64 ? 'base64' : undefined,
        // При редактировании используем editPrompt, иначе referenceImagePrompt
        reference_image_prompt: isEdit ? editPrompt : (referenceImagePrompt || undefined)
      };

      console.log(`Отправляем запрос на генерацию креатива через Gemini API (isEdit: ${isEdit}):`, {
        ...requestData,
        reference_image: referenceImageBase64 ? '[base64 data]' : undefined,
        reference_image_prompt_length: requestData.reference_image_prompt?.length || 0
      });

      // Вызываем новый API creative-generation-service
      const response = await fetch(`${CREATIVE_API_BASE}/generate-creative`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('✅ Получен ответ от API:', data);
      
      if (!data.success) {
        throw new Error(data.error || 'Ошибка генерации');
      }

      // Новый API возвращает: { success: true, creative_id, image_url, generations_remaining }
      if (data.image_url) {
        setGeneratedImage(data.image_url);
        toast.success(isEdit ? 'Креатив успешно отредактирован!' : 'Креатив успешно сгенерирован!');
        
        // Обновляем счетчик генераций
        if (typeof data.generations_remaining === 'number') {
          setCreativeGenerationsAvailable(data.generations_remaining);
          console.log('Счетчик генераций обновлен:', data.generations_remaining);
        }
        
        // Сбрасываем режим редактирования
        if (isEdit) {
          setIsEditMode(false);
          setEditPrompt('');
        }
      } else {
        throw new Error('Не удалось получить URL изображения');
      }
    } catch (error: any) {
      console.error('Error generating creative:', error);
      toast.error(error.message || 'Ошибка генерации креатива');
    } finally {
      setLoading(prev => ({ ...prev, image: false }));
    }
  };

  // Функция начала редактирования
  const startEditMode = () => {
    setIsEditMode(true);
    setEditPrompt('');
  };

  // Функция применения редактирования
  const applyEdit = async () => {
    if (!editPrompt.trim()) {
      toast.error('Введите инструкции для редактирования');
      return;
    }
    
    // Генерируем с текущим изображением как референсом
    // editPrompt будет использован как reference_image_prompt
    await generateCreative(true);
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

  // Функция создания креатива
  const createCreative = async () => {
    if (!generatedImage || !selectedDirectionId) {
      toast.error('Выберите направление');
      return;
    }

    setIsCreatingCreative(true);

    try {
      // Конвертируем изображение (blob URL или data URL) в File
      let imageFile: File;
      
      if (generatedImage.startsWith('blob:')) {
        const response = await fetch(generatedImage);
        const blob = await response.blob();
        imageFile = new File([blob], 'generated_creative.png', { type: 'image/png' });
      } else if (generatedImage.startsWith('data:')) {
        // data URL
        const response = await fetch(generatedImage);
        const blob = await response.blob();
        imageFile = new File([blob], 'generated_creative.png', { type: 'image/png' });
      } else {
        // Публичный URL - скачиваем
        const response = await fetch(generatedImage);
        const blob = await response.blob();
        imageFile = new File([blob], 'generated_creative.png', { type: 'image/png' });
      }

      // Используем существующий API для загрузки
      const success = await creativesApi.uploadToWebhook(
        imageFile,
        `Креатив ${new Date().toLocaleDateString()}`,
        null,
        {},
        undefined,
        undefined,
        selectedDirectionId
      );

      if (success) {
        toast.success('Креатив успешно создан!');
        // Очищаем форму
        setGeneratedImage(null);
        setTexts({ offer: '', bullets: '', profits: '', cta: '' });
        setSelectedDirectionId('');
        } else {
        toast.error('Ошибка создания креатива');
      }
    } catch (error) {
      console.error('Ошибка при создании креатива:', error);
      toast.error('Ошибка создания креатива');
    } finally {
      setIsCreatingCreative(false);
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
          <PageHero 
            title="Генерация Креативов"
            subtitle="Создавайте креативы с помощью AI"
          />
          
          {/* Предупреждение, если промпт не настроен */}
          {!userPrompt && userId && (
            <Card className="mb-6 shadow-sm border-destructive/50 bg-destructive/5">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-destructive/10">
                    <AlertTriangle className="h-5 w-5 text-destructive" />
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-destructive mb-1">
                      Промпт не настроен
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Пожалуйста, настройте prompt4 в вашем профиле, чтобы использовать генерацию текстов.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
          
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
                      disabled={loading[type] || !userPrompt || !userId}
                      size="icon"
                      variant="outline"
                      className="shrink-0 h-10 w-10"
                      title={!userPrompt ? 'Настройте prompt4 в профиле' : !userId ? 'Загрузка данных пользователя...' : 'Сгенерировать с помощью AI'}
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

            {/* Референсное изображение */}
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">Референсное изображение (опционально)</CardTitle>
                <CardDescription>
                  Загрузите изображение для сохранения стиля, цветовой палитры или композиции
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!referenceImage ? (
                  <div className="space-y-4">
                    <div className="border-2 border-dashed border-muted rounded-lg p-6 text-center hover:border-primary/50 transition-colors cursor-pointer">
                      <Label htmlFor="reference-upload" className="cursor-pointer block">
                        <div className="flex flex-col items-center gap-2">
                          <div className="p-3 rounded-full bg-muted">
                            <Upload className="h-6 w-6 text-muted-foreground" />
                          </div>
                          <div className="text-sm font-medium">Нажмите для загрузки</div>
                          <div className="text-xs text-muted-foreground">
                            PNG, JPG, WebP до 10MB
                          </div>
                        </div>
                      </Label>
                      <Input
                        id="reference-upload"
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleReferenceImageUpload}
                      />
                    </div>
                    <div className="flex items-start gap-2 p-3 bg-blue-50/50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg">
                      <div className="text-xs text-blue-800 dark:text-blue-200">
                        <strong>Совет:</strong> Используйте референс для брендинга, стилизации или композиции
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="relative rounded-lg overflow-hidden bg-muted/30 p-4">
                      <Button
                        variant="destructive"
                        size="icon"
                        className="absolute top-2 right-2 z-10"
                        onClick={removeReferenceImage}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                      <img
                        src={referenceImage}
                        alt="Референсное изображение"
                        className="max-w-full max-h-[300px] h-auto mx-auto rounded-lg"
                      />
                    </div>
                    
                    {/* Мини-промпт для референсного изображения */}
                    <div className="space-y-2">
                      <Label htmlFor="reference-prompt">
                        Описание референса (опционально)
                      </Label>
                      <Textarea
                        id="reference-prompt"
                        value={referenceImagePrompt}
                        onChange={(e) => setReferenceImagePrompt(e.target.value)}
                        placeholder="Например: Используй эту цветовую палитру и стиль типографики..."
                        className="min-h-[80px] resize-none"
                      />
                      <p className="text-xs text-muted-foreground">
                        💡 Опишите, какие элементы референса важны: стиль, цвета, композицию, типографику и т.д.
                      </p>
                    </div>
                    
                    <div className="flex items-center gap-2 p-3 bg-green-50/50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg">
                      <Badge variant="secondary">✓ Референс загружен</Badge>
                      <span className="text-xs text-green-800 dark:text-green-200">
                        Gemini использует этот стиль при генерации
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Кнопка генерации креатива */}
            <Button
              onClick={() => generateCreative(false)}
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
              <Card className="bg-amber-50/50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/50">
                      <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    </div>
                    <div className="text-sm">
                      <div className="font-medium text-amber-900 dark:text-amber-100 mb-1">Важно!</div>
                      <p className="text-amber-800 dark:text-amber-200">
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
                        <CardTitle className="text-lg flex items-center justify-between">
                          Сгенерированный креатив
                          {!isEditMode && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={startEditMode}
                              disabled={loading.image}
                            >
                              <Edit className="h-4 w-4 mr-2" />
                              Редактировать
                            </Button>
                          )}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="rounded-lg overflow-hidden bg-muted/30 p-4 flex justify-center items-center">
                          <img
                            src={generatedImage}
                            alt="Сгенерированный креатив"
                            className="max-w-full max-h-[70vh] h-auto rounded-lg shadow-md"
                          />
                        </div>
                        
                        {/* Режим редактирования */}
                        {isEditMode && (
                          <div className="space-y-4 p-4 bg-blue-50/50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg">
                            <div className="space-y-2">
                              <Label>Инструкции для редактирования</Label>
                              <Textarea
                                value={editPrompt}
                                onChange={(e) => setEditPrompt(e.target.value)}
                                placeholder="Например: Сделай фон более ярким, измени цвет текста на синий..."
                                className="min-h-[100px] resize-none"
                              />
                              <p className="text-xs text-muted-foreground">
                                Опишите, что нужно изменить. Текущее изображение будет использовано как референс.
                              </p>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                onClick={applyEdit}
                                disabled={loading.image || !editPrompt.trim()}
                                className="flex-1"
                              >
                                {loading.image ? (
                                  <>
                                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                    Применяю изменения...
                                  </>
                                ) : (
                                  <>
                                    <Sparkles className="h-4 w-4 mr-2" />
                                    Применить изменения
                                  </>
                                )}
                              </Button>
                              <Button
                                variant="outline"
                                onClick={() => {
                                  setIsEditMode(false);
                                  setEditPrompt('');
                                }}
                                disabled={loading.image}
                              >
                                Отмена
                              </Button>
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}

            {/* Форма создания креатива */}
            {generatedImage && (
                    <Card className="shadow-sm">
                      <CardHeader>
                  <CardTitle>Создание креатива</CardTitle>
                  <CardDescription>Выберите направление для сохранения креатива</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                      <div className="space-y-2">
                    <Label>Направление</Label>
                    {directions.length > 0 ? (
                      <Select
                        value={selectedDirectionId}
                        onValueChange={setSelectedDirectionId}
                        disabled={directionsLoading || isCreatingCreative}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Выберите направление" />
                        </SelectTrigger>
                        <SelectContent>
                          {directions.map((direction) => (
                            <SelectItem key={direction.id} value={direction.id}>
                              {direction.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Направления не найдены. Создайте направление в профиле.
                      </p>
                    )}
                      </div>

                            <Button
                    onClick={createCreative} 
                    disabled={!selectedDirectionId || isCreatingCreative || directionsLoading}
                    className="w-full"
                        size="lg"
                      >
                    {isCreatingCreative ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Создается...
                      </>
                    ) : (
                      'Создать креатив'
                    )}
                      </Button>
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