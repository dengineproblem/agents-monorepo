import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAppContext } from '@/context/AppContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Sparkles, Image as ImageIcon, Loader2, Wand2, AlertTriangle, Upload, X, Edit, Download, Users, ImagePlus } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import Header from '@/components/Header';
import PageHero from '@/components/common/PageHero';
import { toast } from 'sonner';
import { API_BASE_URL } from '@/config/api';
import { supabase } from '@/integrations/supabase/client';
import { useDirections } from '@/hooks/useDirections';
import { creativesApi } from '@/services/creativesApi';
import { CarouselTab } from '@/components/creatives/CarouselTab';
import { VideoScriptsTab } from '@/components/creatives/VideoScriptsTab';
import { CompetitorReferenceSelector, type CompetitorReference } from '@/components/creatives/CompetitorReferenceSelector';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { TooltipKeys } from '@/content/tooltips';
import { ImageHistoryTab } from '@/components/creatives/ImageHistoryTab';
import { ImageGalleryTab } from '@/components/creatives/ImageGalleryTab';
import { CarouselHistoryTab } from '@/components/creatives/CarouselHistoryTab';
import { CarouselGalleryTab } from '@/components/creatives/CarouselGalleryTab';
import { TextHistoryTab } from '@/components/creatives/TextHistoryTab';
import { TextGalleryTab } from '@/components/creatives/TextGalleryTab';
import { galleryApi } from '@/services/galleryApi';
import { History, GalleryHorizontalEnd, Wand2 as GenerateIcon, Save, RotateCcw } from 'lucide-react';
import { useImageDraftAutoSave } from '@/hooks/useAutoSaveDraft';

interface CreativeTexts {
  offer: string;
  bullets: string;
  profits: string;
}

const CreativeGeneration = () => {
  const location = useLocation();
  const { currentAdAccountId, multiAccountEnabled, platform } = useAppContext();

  // В мультиаккаунтном режиме генерации безлимитные
  // ВАЖНО: проверяем флаг multiAccountEnabled, а НЕ наличие currentAdAccountId!
  const isMultiAccountMode = multiAccountEnabled === true;

  // Читаем URL параметры
  const searchParams = new URLSearchParams(location.search);
  const tabFromUrl = searchParams.get('tab');
  const promptFromUrl = searchParams.get('prompt');
  const textTypeFromUrl = searchParams.get('textType');
  const competitorCreativeIdFromUrl = searchParams.get('competitorCreativeId');

  const [activeTab, setActiveTab] = useState(tabFromUrl || 'images');

  // Подвкладки для каждой основной вкладки
  const [imageSubTab, setImageSubTab] = useState<'generate' | 'history' | 'gallery'>('generate');
  const [carouselSubTab, setCarouselSubTab] = useState<'generate' | 'history' | 'gallery'>('generate');
  const [textSubTab, setTextSubTab] = useState<'generate' | 'history' | 'gallery'>('generate');

  // Состояние для сохранения черновика
  const [isSavingDraft, setIsSavingDraft] = useState(false);

  const [texts, setTexts] = useState<CreativeTexts>({
    offer: '',
    bullets: '',
    profits: ''
  });

  const [loading, setLoading] = useState({
    offer: false,
    bullets: false,
    profits: false,
    image: false
  });

  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [userPrompt, setUserPrompt] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userData, setUserData] = useState<any>(null);
  const [creativeGenerationsAvailable, setCreativeGenerationsAvailable] = useState<number>(0);

  // Месячный лимит генераций
  const [generationsUsed, setGenerationsUsed] = useState<number>(0);
  const [generationsLimit, setGenerationsLimit] = useState<number>(20);
  
  // State для создания креатива
  const [selectedDirectionId, setSelectedDirectionId] = useState<string>('');
  const [isCreatingCreative, setIsCreatingCreative] = useState(false);

  // State для референсных изображений (до 2)
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [referenceImagePrompt, setReferenceImagePrompt] = useState<string>('');

  // State для референса конкурента
  const [competitorReference, setCompetitorReference] = useState<CompetitorReference | null>(null);

  // State для редактирования
  const [isEditMode, setIsEditMode] = useState(false);
  const [editPrompt, setEditPrompt] = useState<string>('');
  const [editReferenceImages, setEditReferenceImages] = useState<string[]>([]);

  // State для сохранения creative_id для upscale
  const [generatedCreativeId, setGeneratedCreativeId] = useState<string>('');

  // State для полноэкранного просмотра изображения
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);

  // State для выбора стиля креатива
  const [selectedStyle, setSelectedStyle] = useState<'modern_performance' | 'live_ugc' | 'visual_hook' | 'premium_minimal' | 'product_hero' | 'freestyle'>('freestyle');
  const [stylePrompt, setStylePrompt] = useState<string>('');  // Промпт для freestyle стиля

  // State для модалки референса конкурента
  const [showCompetitorRef, setShowCompetitorRef] = useState(false);

  // Загрузка направлений (с фильтрацией по аккаунту для multi-account режима)
  const directionsPlatform = platform === 'tiktok' ? 'tiktok' : 'facebook';
  const { directions, loading: directionsLoading } = useDirections(userId, currentAdAccountId, directionsPlatform);

  // Автосохранение черновика
  const {
    hasSavedDraft,
    savedDraft,
    saveDraft: saveImageDraft,
    restoreDraft: restoreImageDraft,
    discardDraft: discardImageDraft,
    clearDraft: clearImageDraft
  } = useImageDraftAutoSave(userId, currentAdAccountId);

  // Лимиты символов для каждого типа текста
  const CHARACTER_LIMITS = {
    offer: 60,    // Заголовок
    bullets: 120, // Буллеты (все 3)
    profits: 50   // Выгода
  };

  // Очистка blob URL при размонтировании компонента
  useEffect(() => {
    return () => {
      if (generatedImage && generatedImage.startsWith('blob:')) {
        URL.revokeObjectURL(generatedImage);
      }
      referenceImages.forEach(img => {
        if (img.startsWith('blob:')) {
          URL.revokeObjectURL(img);
        }
      });
    };
  }, [generatedImage, referenceImages]);

  // Автосохранение черновика при изменении данных
  useEffect(() => {
    if (!userId) return;

    // Проверяем что есть что сохранять
    const hasContent =
      texts.offer ||
      texts.bullets ||
      texts.profits ||
      generatedImage ||
      referenceImages.length > 0;

    if (!hasContent) return;

    saveImageDraft({
      userId,
      accountId: currentAdAccountId || undefined,
      texts,
      selectedStyle,
      stylePrompt,
      referenceImages,
      referenceImagePrompt,
      generatedImage: generatedImage || undefined,
      generatedCreativeId: generatedCreativeId || undefined,
      selectedDirectionId
    });
  }, [
    userId,
    currentAdAccountId,
    texts,
    selectedStyle,
    stylePrompt,
    referenceImages,
    referenceImagePrompt,
    generatedImage,
    generatedCreativeId,
    selectedDirectionId,
    saveImageDraft
  ]);

  // Функция восстановления черновика
  const handleRestoreDraft = () => {
    const draft = restoreImageDraft();
    if (draft) {
      setTexts(draft.texts);
      setSelectedStyle(draft.selectedStyle as any);
      setStylePrompt(draft.stylePrompt);
      setReferenceImages(draft.referenceImages);
      setReferenceImagePrompt(draft.referenceImagePrompt);
      if (draft.generatedImage) {
        setGeneratedImage(draft.generatedImage);
      }
      if (draft.generatedCreativeId) {
        setGeneratedCreativeId(draft.generatedCreativeId);
      }
      if (draft.selectedDirectionId) {
        setSelectedDirectionId(draft.selectedDirectionId);
      }
      toast.success('Черновик восстановлен');
    }
  };

  // Закрытие полноэкранного просмотра по Escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreenOpen) {
        setIsFullscreenOpen(false);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isFullscreenOpen]);

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
            
            // Загружаем количество доступных генераций (legacy)
            setCreativeGenerationsAvailable(data.creative_generations_available || 0);

            // Загружаем месячную статистику генераций
            loadGenerationsStats(data.id);
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

    // Загрузка месячной статистики генераций
    const loadGenerationsStats = async (userId: string) => {
      const CREATIVE_API = import.meta.env.VITE_CREATIVE_API_URL
        || (import.meta.env.VITE_API_URL || 'http://localhost:8082') + '/api/creative';

      try {
        const response = await fetch(`${CREATIVE_API}/generations-stats?user_id=${userId}`);
        const data = await response.json();

        if (data.success) {
          setGenerationsUsed(data.generations_used || 0);
          setGenerationsLimit(data.generations_limit || 20);
          console.log(`✅ Месячная статистика: ${data.generations_used}/${data.generations_limit}`);
        }
      } catch (err) {
        console.warn('⚠️ Не удалось загрузить статистику генераций:', err);
      }
    };

    loadUserData();
  }, []);

  // Сброс состояния при смене аккаунта
  useEffect(() => {
    if (!currentAdAccountId) return;

    console.log('[CreativeGeneration] Смена аккаунта, сбрасываем состояние');

    // Сбрасываем все локальное состояние
    setTexts({ offer: '', bullets: '', profits: '' });
    setGeneratedImage(null);
    setGeneratedCreativeId('');
    setSelectedDirectionId('');
    setReferenceImages([]);
    setReferenceImagePrompt('');
    setCompetitorReference(null);
    setIsEditMode(false);
    setEditPrompt('');
    setEditReferenceImages([]);
    setSelectedStyle('freestyle');
    setStylePrompt('');
  }, [currentAdAccountId]);

  // Загружаем prompt4 из ad_accounts при смене аккаунта (мультиаккаунтный режим)
  // ВАЖНО: проверяем multiAccountEnabled — для legacy пользователей НЕ загружаем из ad_accounts!
  useEffect(() => {
    const loadAdAccountPrompt = async () => {
      if (!multiAccountEnabled || !currentAdAccountId || !userId) return;

      try {
        console.log('[CreativeGeneration] Загрузка prompt4 для ad_account:', currentAdAccountId);
        const { data: adAccount, error } = await supabase
          .from('ad_accounts')
          .select('prompt4')
          .eq('id', currentAdAccountId)
          .single();

        if (error) {
          console.error('[CreativeGeneration] Ошибка загрузки prompt4 из ad_accounts:', error);
          return;
        }

        if (adAccount?.prompt4) {
          console.log('[CreativeGeneration] ✅ Загружен prompt4 из ad_accounts:', adAccount.prompt4.length, 'символов');
          setUserPrompt(adAccount.prompt4);
        } else {
          console.warn('[CreativeGeneration] ⚠️ prompt4 не найден в ad_accounts');
          // Не сбрасываем userPrompt - оставляем из user_accounts как fallback
        }
      } catch (err) {
        console.error('[CreativeGeneration] Ошибка загрузки prompt4:', err);
      }
    };

    loadAdAccountPrompt();
  }, [multiAccountEnabled, currentAdAccountId, userId]);

  // API базовый URL для creative-generation-service
  // В dev используем локальный сервер, в production - прокси через nginx (через /api/creative)
  const CREATIVE_API_BASE = import.meta.env.VITE_CREATIVE_API_URL
    || (import.meta.env.DEV ? 'http://localhost:8085' : 'https://app.performanteaiagency.com/api/creative');

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
            default:
              fieldName = key;
          }
          return { ...acc, [fieldName]: value };
        }, {});

      // Добавляем референс конкурента, если выбран
      const competitorReferenceData = competitorReference ? {
        competitor_reference: {
          body_text: competitorReference.body_text,
          headline: competitorReference.headline,
          ocr_text: competitorReference.ocr_text,
          transcript: competitorReference.transcript,
          competitor_name: competitorReference.competitor_name,
        }
      } : {};

      const requestData = {
        user_id: userId,
        prompt: userPrompt || '',
        ...otherTexts,
        ...competitorReferenceData
      };

      console.log(`Отправляем запрос на генерацию ${type}:`, requestData);
      console.log(`User ID: ${userId}, Prompt length: ${userPrompt?.length || 0}`);
      if (competitorReference) {
        console.log('Competitor reference:', competitorReference.competitor_name);
      }

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
        profits: ['profits', 'benefits', 'generated_benefits', 'generated_profits']
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

  // Обработка загрузки референсного изображения (до 2)
  const handleReferenceImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (referenceImages.length >= 2) {
      toast.error('Максимум 2 референса');
      return;
    }

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

    // Создаем preview URL
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setReferenceImages(prev => [...prev, result]);
      toast.success(`Референс ${referenceImages.length + 1} загружен`);
    };
    reader.readAsDataURL(file);
  };

  // Удаление референсного изображения по индексу
  const removeReferenceImage = (index: number) => {
    const img = referenceImages[index];
    if (img && img.startsWith('blob:')) {
      URL.revokeObjectURL(img);
    }
    setReferenceImages(prev => prev.filter((_, i) => i !== index));
    if (referenceImages.length === 1) {
      setReferenceImagePrompt('');
    }
  };

  // Обработка загрузки референсного изображения в режиме редактирования (до 2)
  const handleEditReferenceImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (editReferenceImages.length >= 2) {
      toast.error('Максимум 2 референса');
      return;
    }

    if (!file.type.startsWith('image/')) {
      toast.error('Пожалуйста, выберите изображение');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error('Размер изображения не должен превышать 10MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setEditReferenceImages(prev => [...prev, result]);
      toast.success(`Референс ${editReferenceImages.length + 1} добавлен`);
    };
    reader.readAsDataURL(file);
  };

  // Удаление референсного изображения в режиме редактирования
  const removeEditReferenceImage = (index: number) => {
    setEditReferenceImages(prev => prev.filter((_, i) => i !== index));
  };

  // Функция добавления изображения как референса из истории/галереи
  const handleUseImageAsReference = async (imageUrl: string) => {
    if (referenceImages.length >= 2) {
      toast.error('Максимум 2 референса. Удалите один из существующих.');
      return;
    }

    try {
      // Загружаем изображение и конвертируем в base64
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const reader = new FileReader();

      reader.onload = (e) => {
        const result = e.target?.result as string;
        setReferenceImages(prev => [...prev, result]);
        setImageSubTab('generate'); // Переключаемся на вкладку генерации
        toast.success('Референс добавлен');
      };
      reader.readAsDataURL(blob);
    } catch (error) {
      console.error('Error loading reference image:', error);
      toast.error('Не удалось загрузить изображение');
    }
  };

  // Функция сохранения черновика
  const handleSaveDraft = async () => {
    if (!userId) {
      toast.error('Необходимо авторизоваться');
      return;
    }

    if (!texts.offer && !texts.bullets && !texts.profits && !generatedImage) {
      toast.error('Заполните хотя бы одно поле или сгенерируйте изображение');
      return;
    }

    setIsSavingDraft(true);

    try {
      const response = await galleryApi.saveDraft({
        user_id: userId,
        account_id: currentAdAccountId || undefined,
        creative_type: 'image',
        offer: texts.offer,
        bullets: texts.bullets,
        profits: texts.profits,
        image_url: generatedImage || '',
        style_id: selectedStyle,
        direction_id: selectedDirectionId || undefined
      });

      if (response.success) {
        toast.success('Черновик сохранён');
      } else {
        toast.error(response.error || 'Не удалось сохранить черновик');
      }
    } catch (error: any) {
      console.error('Error saving draft:', error);
      toast.error('Ошибка сохранения черновика');
    } finally {
      setIsSavingDraft(false);
    }
  };

  const generateCreative = async (isEdit: boolean = false) => {
    // Проверяем месячный лимит генераций
    if (generationsUsed >= generationsLimit) {
      toast.error(`Лимит генераций исчерпан. Доступно ${generationsLimit} генераций в месяц.`);
      return;
    }

    setLoading(prev => ({ ...prev, image: true }));

    try {
      let referenceImageBase64: string | undefined;
      let referenceImagesBase64: string[] = [];

      // Если редактируем - используем сгенерированное изображение + дополнительные референсы
      if (isEdit && generatedImage) {
        // Конвертируем текущее изображение в base64
        const response = await fetch(generatedImage);
        const blob = await response.blob();
        const reader = new FileReader();
        const currentImageBase64: string = await new Promise((resolve) => {
          reader.onload = () => {
            const base64 = (reader.result as string).split(',')[1];
            resolve(base64);
          };
          reader.readAsDataURL(blob);
        });

        // Собираем все референсы: текущее изображение + дополнительные
        referenceImagesBase64 = [currentImageBase64];

        // Добавляем дополнительные референсы (до 2)
        if (editReferenceImages.length > 0) {
          const additionalRefs = editReferenceImages.map(img => img.split(',')[1]);
          referenceImagesBase64 = [...referenceImagesBase64, ...additionalRefs];
        }

        referenceImageBase64 = referenceImagesBase64[0]; // Первый для обратной совместимости
      }
      // Если есть референсные изображения - используем их
      else if (referenceImages.length > 0) {
        referenceImagesBase64 = referenceImages.map(img => img.split(',')[1]);
        referenceImageBase64 = referenceImagesBase64[0]; // Первый для обратной совместимости
      }

      // Добавляем референс конкурента, если выбран
      const competitorReferenceData = competitorReference ? {
        competitor_reference: {
          body_text: competitorReference.body_text,
          headline: competitorReference.headline,
          ocr_text: competitorReference.ocr_text,
          transcript: competitorReference.transcript,
          competitor_name: competitorReference.competitor_name,
        }
      } : {};

      const requestData = {
        user_id: userId,
        account_id: currentAdAccountId || undefined,
        offer: texts.offer,
        bullets: texts.bullets,
        profits: texts.profits,
        direction_id: selectedDirectionId || undefined,
        style_id: selectedStyle,
        style_prompt: selectedStyle === 'freestyle' ? (stylePrompt || undefined) : undefined, // Для freestyle стиля
        reference_image: referenceImageBase64, // Для обратной совместимости
        reference_images: referenceImagesBase64.length > 0 ? referenceImagesBase64 : undefined,
        reference_image_type: referenceImageBase64 ? 'base64' : undefined,
        // При редактировании используем editPrompt, иначе referenceImagePrompt
        reference_image_prompt: isEdit ? editPrompt : (referenceImagePrompt || undefined),
        ...competitorReferenceData
      };

      console.log(`Отправляем запрос на генерацию креатива через Gemini API (isEdit: ${isEdit}):`, {
        ...requestData,
        reference_image: referenceImageBase64 ? '[base64 data]' : undefined,
        reference_images_count: referenceImagesBase64.length,
        reference_image_prompt_length: requestData.reference_image_prompt?.length || 0,
        has_competitor_reference: !!competitorReference
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

        // Сохраняем creative_id для upscale
        if (data.creative_id) {
          setGeneratedCreativeId(data.creative_id);
          console.log('Creative ID сохранен:', data.creative_id);
        }

        toast.success(isEdit ? 'Креатив успешно отредактирован!' : 'Креатив успешно сгенерирован!');

        // Обновляем счетчики месячных генераций
        if (typeof data.generations_used === 'number') {
          setGenerationsUsed(data.generations_used);
        }
        if (typeof data.generations_limit === 'number') {
          setGenerationsLimit(data.generations_limit);
        }
        if (typeof data.generations_remaining === 'number') {
          setCreativeGenerationsAvailable(data.generations_remaining);
          console.log('Счетчик генераций обновлен:', data.generations_used, '/', data.generations_limit);
        }

        // Сбрасываем режим редактирования
        if (isEdit) {
          setIsEditMode(false);
          setEditPrompt('');
          setEditReferenceImages([]);
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

  // Функция скачивания изображения
  const downloadImage = async () => {
    if (!generatedImage || !generatedCreativeId) {
      toast.error('Сначала сгенерируйте креатив');
      return;
    }

    try {
      toast.loading('Подготовка 4K версии для скачивания...', { id: 'upscale' });

      // Вызываем upscale до 4K
      const upscaleResponse = await fetch(`${CREATIVE_API_BASE}/upscale-to-4k`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          creative_id: generatedCreativeId,
          user_id: userId
        }),
      });

      const upscaleData = await upscaleResponse.json();

      if (!upscaleData.success || !upscaleData.image_url_4k) {
        throw new Error('Не удалось улучшить качество изображения');
      }

      toast.success('4K версия готова, скачивание...', { id: 'upscale' });

      // Получаем 4K изображение
      const response = await fetch(upscaleData.image_url_4k);
      const blob = await response.blob();

      // Создаём ссылку для скачивания
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;

      // Генерируем имя файла с датой и временем
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      link.download = `creative_4K_${timestamp}.png`;

      // Триггерим скачивание
      document.body.appendChild(link);
      link.click();

      // Очищаем
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast.success('4K изображение скачано', { id: 'upscale' });
    } catch (error) {
      console.error('Error downloading image:', error);
      toast.error('Ошибка при скачивании изображения', { id: 'upscale' });
    }
  };

  const getTypeLabel = (type: keyof CreativeTexts): string => {
    const labels = {
      offer: 'Основной оффер',
      bullets: 'Буллеты',
      profits: 'Выгода'
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
    if (!generatedImage || !selectedDirectionId || !generatedCreativeId) {
      toast.error('Выберите направление');
      return;
    }

    setIsCreatingCreative(true);

    try {
      toast.loading('Подготовка 4K версии (9:16)...', { id: 'upscale-create' });

      // 1. Вызываем upscale до 4K - расширяет 4:5 до 9:16
      const upscaleResponse = await fetch(`${CREATIVE_API_BASE}/upscale-to-4k`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          creative_id: generatedCreativeId,
          user_id: userId
        }),
      });

      const upscaleData = await upscaleResponse.json();

      if (!upscaleData.success || !upscaleData.image_url_4k) {
        throw new Error('Не удалось создать 4K версию изображения');
      }

      toast.success('4K версия готова, создание креатива в Facebook...', { id: 'upscale-create' });

      // 2. Вызываем API для создания креатива (одно 9:16 изображение)
      const createResponse = await fetch(`${API_BASE_URL}/create-image-creative`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: userId,
          account_id: currentAdAccountId || undefined,
          creative_id: generatedCreativeId,
          direction_id: selectedDirectionId
        }),
      });

      const createData = await createResponse.json();

      if (!createData.success) {
        throw new Error(createData.error || 'Ошибка создания креатива в Facebook');
      }

      toast.success('Креатив создан в Facebook!', { id: 'upscale-create' });

      // Очищаем форму
      setGeneratedImage(null);
      setGeneratedCreativeId('');
      setTexts({ offer: '', bullets: '', profits: '' });
      setSelectedDirectionId('');

      // Очищаем черновик после успешного создания
      clearImageDraft();
    } catch (error: any) {
      console.error('Ошибка при создании креатива:', error);
      toast.error(error.message || 'Ошибка создания креатива', { id: 'upscale-create' });
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
      <div className="w-full px-4 py-8 pt-[76px] max-w-full overflow-x-hidden" data-tour="creatives-content">
        <div className="max-w-3xl lg:max-w-6xl mx-auto w-full">
          <PageHero
            title="Генерация креативов"
            subtitle="Создавайте профессиональные креативы для Instagram с помощью AI"
          />

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full mt-6">
            <TabsList className="grid w-full grid-cols-3 mb-6">
              <TabsTrigger value="images">Картинки</TabsTrigger>
              <TabsTrigger value="carousels">Карусели</TabsTrigger>
              <TabsTrigger value="video-scripts">Текст</TabsTrigger>
            </TabsList>

            <TabsContent value="images" className="mt-0">
              {/* Подвкладки для картинок */}
              <Tabs value={imageSubTab} onValueChange={(v) => setImageSubTab(v as any)} className="w-full">
                <TabsList className="mb-4">
                  <TabsTrigger value="generate" className="gap-1">
                    <GenerateIcon className="h-4 w-4" />
                    Генерация
                  </TabsTrigger>
                  <TabsTrigger value="history" className="gap-1">
                    <History className="h-4 w-4" />
                    История
                  </TabsTrigger>
                  <TabsTrigger value="gallery" className="gap-1">
                    <GalleryHorizontalEnd className="h-4 w-4" />
                    Галерея
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="generate" className="mt-0">

          {/* Уведомление о сохраненном черновике */}
          {hasSavedDraft && savedDraft && (
            <Card className="mb-6 shadow-sm border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/30">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/50">
                      <RotateCcw className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <div className="font-medium text-blue-900 dark:text-blue-100">
                        Найден незавершённый черновик
                      </div>
                      <p className="text-sm text-blue-700 dark:text-blue-300">
                        Сохранено {new Date(savedDraft.savedAt).toLocaleString('ru-RU')}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={discardImageDraft}
                      className="border-blue-300 text-blue-700 hover:bg-blue-100 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-900/50"
                    >
                      Отклонить
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleRestoreDraft}
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      <RotateCcw className="h-4 w-4 mr-2" />
                      Восстановить
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

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
          
          {/* Месячный лимит генераций */}
          <Card className="mb-6 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-muted">
                  <Wand2 className="h-5 w-5 text-foreground" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-medium text-foreground">Генерации в этом месяце:</span>
                    <Badge variant={generationsUsed >= generationsLimit ? "destructive" : "secondary"} className="font-semibold">
                      {generationsUsed} / {generationsLimit}
                    </Badge>
                  </div>
                  {/* Прогресс-бар */}
                  <div className="w-full bg-muted rounded-full h-2 mb-2">
                    <div
                      className={`h-2 rounded-full transition-all ${generationsUsed >= generationsLimit ? 'bg-destructive' : 'bg-primary'}`}
                      style={{ width: `${Math.min((generationsUsed / generationsLimit) * 100, 100)}%` }}
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {generationsUsed >= generationsLimit
                      ? 'Лимит генераций исчерпан. Лимит сбросится в начале следующего месяца.'
                      : `Осталось ${generationsLimit - generationsUsed} генерац${(generationsLimit - generationsUsed) === 1 ? 'ия' : (generationsLimit - generationsUsed) < 5 ? 'ии' : 'ий'} в этом месяце`
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
                    <HelpTooltip
                      tooltipKey={
                        type === 'offer' ? TooltipKeys.CREATIVE_OFFER :
                        type === 'bullets' ? TooltipKeys.CREATIVE_BULLETS :
                        TooltipKeys.CREATIVE_BENEFIT
                      }
                      iconSize="sm"
                    />
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
                    <div className="flex flex-col items-center gap-1">
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
                      <HelpTooltip tooltipKey={TooltipKeys.GEN_TEXT_AI_BUTTON} iconSize="sm" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}

            {/* Выбор стиля креатива */}
            <Card className="shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  Стиль креатива
                  <HelpTooltip tooltipKey={TooltipKeys.CREATIVE_STYLE} />
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Селект стиля + кнопки референсов в одну строку */}
                <div className="flex gap-2 items-center">
                  <Select
                    value={selectedStyle}
                    onValueChange={(value: any) => setSelectedStyle(value)}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Выберите стиль" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="modern_performance">Современная графика</SelectItem>
                      <SelectItem value="live_ugc">Живой UGC-контент</SelectItem>
                      <SelectItem value="visual_hook">Визуальный зацеп</SelectItem>
                      <SelectItem value="premium_minimal">Премиум минимализм</SelectItem>
                      <SelectItem value="product_hero">Товар в главной роли</SelectItem>
                      <SelectItem value="freestyle">Свободный стиль</SelectItem>
                    </SelectContent>
                  </Select>

                  {/* Кнопка референса конкурента */}
                  {userId && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant={competitorReference ? "secondary" : "outline"}
                        size="sm"
                        onClick={() => setShowCompetitorRef(!showCompetitorRef)}
                      >
                        <Users className="h-4 w-4 mr-1" />
                        {competitorReference ? "Референс ✓" : "Конкурент"}
                      </Button>
                      <HelpTooltip tooltipKey={TooltipKeys.GEN_COMPETITOR_REFERENCE} iconSize="sm" />
                    </div>
                  )}

                  {/* Кнопка загрузки референсных изображений */}
                  <div className="flex items-center gap-1 shrink-0">
                    {referenceImages.length < 2 && (
                      <Label htmlFor="reference-upload-inline" className="cursor-pointer">
                        <div className={`inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 h-9 px-3 ${referenceImages.length > 0 ? 'bg-secondary text-secondary-foreground hover:bg-secondary/80' : 'border border-input bg-background hover:bg-accent hover:text-accent-foreground'}`}>
                          <ImagePlus className="h-4 w-4 mr-1" />
                          {referenceImages.length > 0 ? `Фото (${referenceImages.length})` : "Фото"}
                        </div>
                        <Input id="reference-upload-inline" type="file" accept="image/*" className="hidden" onChange={handleReferenceImageUpload} />
                      </Label>
                    )}
                    {referenceImages.length >= 2 && (
                      <Badge variant="secondary">Фото ({referenceImages.length})</Badge>
                    )}
                    <HelpTooltip tooltipKey={TooltipKeys.GEN_REFERENCE_LIMIT} iconSize="sm" />
                  </div>
                </div>

                {/* Загруженные референсные изображения */}
                {referenceImages.length > 0 && (
                  <div className="flex gap-2 items-start flex-wrap">
                    {referenceImages.map((img, index) => (
                      <div key={index} className="relative rounded-lg overflow-hidden bg-muted/30">
                        <Button
                          variant="destructive"
                          size="icon"
                          className="absolute top-1 right-1 z-10 h-5 w-5"
                          onClick={() => removeReferenceImage(index)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                        <img src={img} alt={`Референс ${index + 1}`} className="w-16 h-16 object-cover rounded" />
                      </div>
                    ))}
                    {referenceImages.length < 2 && (
                      <Label htmlFor="reference-upload-add" className="cursor-pointer">
                        <div className="w-16 h-16 border-2 border-dashed border-muted rounded-lg flex items-center justify-center hover:border-primary/50 transition-colors">
                          <ImagePlus className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <Input id="reference-upload-add" type="file" accept="image/*" className="hidden" onChange={handleReferenceImageUpload} />
                      </Label>
                    )}
                  </div>
                )}

                {/* Промпт для референсных изображений */}
                {referenceImages.length > 0 && (
                  <Textarea
                    value={referenceImagePrompt}
                    onChange={(e) => setReferenceImagePrompt(e.target.value)}
                    placeholder="Опишите что взять из референсов: стиль, цвета, композицию..."
                    className="min-h-[50px] resize-none text-sm"
                  />
                )}

                {/* Описание выбранного стиля */}
                <div className="text-sm text-muted-foreground p-3 bg-muted/30 rounded-md flex items-start gap-2">
                  <span className="flex-1">
                    {selectedStyle === 'modern_performance' &&
                      'Чистый дизайн с UI-элементами, графикой роста и структурированными блоками'}
                    {selectedStyle === 'live_ugc' &&
                      'Реалистичные сцены с людьми в естественных ситуациях, как в настоящих сторис'}
                    {selectedStyle === 'visual_hook' &&
                      'Яркий контраст, мощные метафоры и эффектные визуальные образы'}
                    {selectedStyle === 'premium_minimal' &&
                      'Сдержанный дизайн с минимумом элементов, премиальные цвета и много воздуха'}
                    {selectedStyle === 'product_hero' &&
                      'Товар в центре внимания: профессиональная товарная реклама с продуктом в главной роли'}
                    {selectedStyle === 'freestyle' &&
                      'Полная свобода — задайте стиль самостоятельно через промпт'}
                  </span>
                  {selectedStyle === 'modern_performance' && <HelpTooltip tooltipKey={TooltipKeys.GEN_STYLE_MODERN} iconSize="sm" />}
                  {selectedStyle === 'live_ugc' && <HelpTooltip tooltipKey={TooltipKeys.GEN_STYLE_UGC} iconSize="sm" />}
                  {selectedStyle === 'visual_hook' && <HelpTooltip tooltipKey={TooltipKeys.GEN_STYLE_HOOK} iconSize="sm" />}
                  {selectedStyle === 'premium_minimal' && <HelpTooltip tooltipKey={TooltipKeys.GEN_STYLE_MINIMAL} iconSize="sm" />}
                  {selectedStyle === 'product_hero' && <HelpTooltip tooltipKey={TooltipKeys.GEN_STYLE_PRODUCT} iconSize="sm" />}
                  {selectedStyle === 'freestyle' && <HelpTooltip tooltipKey={TooltipKeys.GEN_STYLE_FREESTYLE} iconSize="sm" />}
                </div>

                {/* Поле для ввода промпта стиля (только для freestyle) */}
                {selectedStyle === 'freestyle' && (
                  <div className="space-y-2 pt-3 border-t">
                    <Label htmlFor="style-prompt" className="flex items-center gap-1">
                      Промпт стиля
                      <HelpTooltip tooltipKey={TooltipKeys.GEN_FREESTYLE_PROMPT} iconSize="sm" />
                    </Label>
                    <Textarea
                      id="style-prompt"
                      placeholder="Опишите желаемый визуальный стиль: цвета, атмосферу, тип изображения (фото, иллюстрация, 3D), композицию..."
                      value={stylePrompt}
                      onChange={(e) => setStylePrompt(e.target.value)}
                      className="min-h-[100px] resize-y"
                    />
                    <p className="text-xs text-muted-foreground">
                      Опишите стиль максимально подробно: тип визуала, цветовая палитра, настроение, композиция
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Кнопки генерации и сохранения черновика */}
            <div className="flex gap-2">
              <Button
                onClick={() => generateCreative(false)}
                disabled={loading.image}
                className="flex-1 bg-gradient-to-r from-gray-800 to-gray-900 hover:from-gray-900 hover:to-black text-white shadow-md hover:shadow-lg transition-all duration-200"
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
              <Button
                onClick={handleSaveDraft}
                disabled={isSavingDraft || loading.image}
                variant="outline"
                size="lg"
                title="Сохранить как черновик"
              >
                {isSavingDraft ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
              </Button>
            </div>

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
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={downloadImage}
                                disabled={loading.image}
                              >
                                <Download className="h-4 w-4 mr-2" />
                                Скачать
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={startEditMode}
                                disabled={loading.image}
                              >
                                <Edit className="h-4 w-4 mr-2" />
                                Редактировать
                              </Button>
                            </div>
                          )}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div
                          className="rounded-lg overflow-hidden bg-muted/30 p-4 flex justify-center items-center cursor-pointer hover:bg-muted/50 transition-colors"
                          onClick={() => setIsFullscreenOpen(true)}
                          title="Нажмите для просмотра в полноэкранном режиме"
                        >
                          <img
                            src={generatedImage}
                            alt="Сгенерированный креатив"
                            className="max-w-full max-h-[70vh] h-auto rounded-lg shadow-md"
                          />
                        </div>
                        
                        {/* Режим редактирования */}
                        {isEditMode && (
                          <div className="space-y-4 p-4 bg-blue-50/50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg">
                            {/* Референсные изображения для редактирования */}
                            <div className="space-y-2">
                              <Label className="flex items-center gap-1">
                                Дополнительные референсы (до 2)
                              </Label>
                              <div className="flex gap-2 items-start flex-wrap">
                                {editReferenceImages.map((img, index) => (
                                  <div key={index} className="relative rounded-lg overflow-hidden bg-muted/30">
                                    <Button
                                      variant="destructive"
                                      size="icon"
                                      className="absolute top-1 right-1 z-10 h-5 w-5"
                                      onClick={() => removeEditReferenceImage(index)}
                                    >
                                      <X className="h-3 w-3" />
                                    </Button>
                                    <img src={img} alt={`Референс ${index + 1}`} className="w-16 h-16 object-cover rounded" />
                                  </div>
                                ))}
                                {editReferenceImages.length < 2 && (
                                  <Label htmlFor="edit-reference-upload" className="cursor-pointer">
                                    <div className="w-16 h-16 border-2 border-dashed border-muted rounded-lg flex items-center justify-center hover:border-primary/50 transition-colors">
                                      <ImagePlus className="h-5 w-5 text-muted-foreground" />
                                    </div>
                                    <Input id="edit-reference-upload" type="file" accept="image/*" className="hidden" onChange={handleEditReferenceImageUpload} />
                                  </Label>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground">
                                Добавьте изображения, на которые нужно ориентироваться при редактировании
                              </p>
                            </div>

                            <div className="space-y-2">
                              <Label className="flex items-center gap-1">
                                Инструкции для редактирования
                                <HelpTooltip tooltipKey={TooltipKeys.GEN_EDIT_MODE} iconSize="sm" />
                              </Label>
                              <Textarea
                                value={editPrompt}
                                onChange={(e) => setEditPrompt(e.target.value)}
                                placeholder="Например: Сделай фон более ярким, измени цвет текста на синий, используй стиль как на референсе..."
                                className="min-h-[100px] resize-none"
                              />
                              <p className="text-xs text-muted-foreground">
                                Опишите, что нужно изменить. Текущее изображение + референсы будут учтены.
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
                                  setEditReferenceImages([]);
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
                  <CardTitle className="flex items-center gap-2">
                    Создание креатива
                    <HelpTooltip tooltipKey={TooltipKeys.GEN_CREATE_IN_FACEBOOK} iconSize="sm" />
                  </CardTitle>
                  <CardDescription>Выберите направление для сохранения креатива</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                      <div className="space-y-2">
                    <Label className="flex items-center gap-1">
                      Направление
                      <HelpTooltip tooltipKey={TooltipKeys.GEN_SELECT_DIRECTION} iconSize="sm" />
                    </Label>
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
                </TabsContent>

                <TabsContent value="history" className="mt-0">
                  <ImageHistoryTab
                    userId={userId}
                    onUseAsReference={handleUseImageAsReference}
                  />
                </TabsContent>

                <TabsContent value="gallery" className="mt-0">
                  <ImageGalleryTab onUseAsReference={handleUseImageAsReference} />
                </TabsContent>
              </Tabs>
            </TabsContent>

            <TabsContent value="carousels" className="mt-0">
              {/* Подвкладки для каруселей */}
              <Tabs value={carouselSubTab} onValueChange={(v) => setCarouselSubTab(v as any)} className="w-full">
                <TabsList className="mb-4">
                  <TabsTrigger value="generate" className="gap-1">
                    <GenerateIcon className="h-4 w-4" />
                    Генерация
                  </TabsTrigger>
                  <TabsTrigger value="history" className="gap-1">
                    <History className="h-4 w-4" />
                    История
                  </TabsTrigger>
                  <TabsTrigger value="gallery" className="gap-1">
                    <GalleryHorizontalEnd className="h-4 w-4" />
                    Галерея
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="generate" className="mt-0">
                  <CarouselTab
                    userId={userId}
                    currentAdAccountId={currentAdAccountId}
                    multiAccountEnabled={multiAccountEnabled}
                    creativeGenerationsAvailable={creativeGenerationsAvailable}
                    setCreativeGenerationsAvailable={setCreativeGenerationsAvailable}
                    directions={directions}
                  />
                </TabsContent>

                <TabsContent value="history" className="mt-0">
                  <CarouselHistoryTab
                    userId={userId}
                    onUseAsReference={(imageUrls) => {
                      // TODO: Интеграция с CarouselTab для референсов
                      toast.success(`Добавлено ${imageUrls.length} референсов. Переключитесь на генерацию.`);
                      setCarouselSubTab('generate');
                    }}
                  />
                </TabsContent>

                <TabsContent value="gallery" className="mt-0">
                  <CarouselGalleryTab
                    onUseAsReference={(imageUrls) => {
                      toast.success(`Добавлено ${imageUrls.length} референсов. Переключитесь на генерацию.`);
                      setCarouselSubTab('generate');
                    }}
                  />
                </TabsContent>
              </Tabs>
            </TabsContent>

            <TabsContent value="video-scripts" className="mt-0">
              {/* Подвкладки для текстов */}
              <Tabs value={textSubTab} onValueChange={(v) => setTextSubTab(v as any)} className="w-full">
                <TabsList className="mb-4">
                  <TabsTrigger value="generate" className="gap-1">
                    <GenerateIcon className="h-4 w-4" />
                    Генерация
                  </TabsTrigger>
                  <TabsTrigger value="history" className="gap-1">
                    <History className="h-4 w-4" />
                    История
                  </TabsTrigger>
                  <TabsTrigger value="gallery" className="gap-1">
                    <GalleryHorizontalEnd className="h-4 w-4" />
                    Галерея
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="generate" className="mt-0">
                  <VideoScriptsTab
                    userId={userId}
                    initialPrompt={promptFromUrl || undefined}
                    initialTextType={textTypeFromUrl as any || undefined}
                    initialCompetitorCreativeId={competitorCreativeIdFromUrl || undefined}
                    accountId={currentAdAccountId}
                  />
                </TabsContent>

                <TabsContent value="history" className="mt-0">
                  <TextHistoryTab
                    userId={userId}
                    onUseAsReference={(text, textType) => {
                      // Переключаемся на генерацию с заполненным prompt
                      // Используем URL параметры для передачи данных
                      const searchParams = new URLSearchParams(location.search);
                      searchParams.set('prompt', text);
                      searchParams.set('textType', 'reference');
                      window.history.replaceState({}, '', `${location.pathname}?${searchParams.toString()}`);
                      setTextSubTab('generate');
                      // Перезагрузим компонент с новыми параметрами
                      window.location.reload();
                    }}
                  />
                </TabsContent>

                <TabsContent value="gallery" className="mt-0">
                  <TextGalleryTab
                    onUseAsReference={(text, textType) => {
                      const searchParams = new URLSearchParams(location.search);
                      searchParams.set('prompt', text);
                      searchParams.set('textType', 'reference');
                      window.history.replaceState({}, '', `${location.pathname}?${searchParams.toString()}`);
                      setTextSubTab('generate');
                      window.location.reload();
                    }}
                  />
                </TabsContent>
              </Tabs>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Полноэкранный просмотр изображения */}
      {isFullscreenOpen && generatedImage && (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4"
          onClick={() => setIsFullscreenOpen(false)}
        >
          <button
            className="absolute top-4 right-4 text-white hover:text-gray-300 transition-colors"
            onClick={() => setIsFullscreenOpen(false)}
          >
            <X className="h-8 w-8" />
          </button>
          <img
            src={generatedImage}
            alt="Сгенерированный креатив в полноэкранном режиме"
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Модалка референса конкурента - напрямую открывает CompetitorReferenceSelector */}
      {userId && (
        <CompetitorReferenceSelector
          userAccountId={userId}
          selectedReference={competitorReference}
          onSelect={setCompetitorReference}
          mediaTypeFilter="image"
          accountId={currentAdAccountId}
          open={showCompetitorRef}
          onOpenChange={setShowCompetitorRef}
          hideTrigger
        />
      )}

    </div>
  );
};

export default CreativeGeneration; 
