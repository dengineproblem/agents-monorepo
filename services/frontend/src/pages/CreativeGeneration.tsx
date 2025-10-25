import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Image as ImageIcon, Loader2, Wand2, AlertTriangle } from 'lucide-react';
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
                  <div className="rounded-lg overflow-hidden bg-muted/30 p-4 flex justify-center items-center">
                          <img
                            src={generatedImage}
                            alt="Сгенерированный креатив"
                      className="max-w-full max-h-[70vh] h-auto rounded-lg shadow-md"
                          />
                        </div>
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