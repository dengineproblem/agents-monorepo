import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sparkles, Loader2, ImageIcon, Download, ChevronLeft, ChevronRight, RefreshCw, X, Plus, RotateCcw, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { carouselApi } from '@/services/carouselApi';
import type { CarouselCard, CarouselVisualStyle, CardChangeOption } from '@/types/carousel';
import JSZip from 'jszip';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { TooltipKeys } from '@/content/tooltips';
import { useCarouselDraftAutoSave } from '@/hooks/useAutoSaveDraft';
import { DirectionMultiSelect } from '@/components/ui/direction-multi-select';

interface CarouselTabProps {
  userId: string | null;
  currentAdAccountId?: string | null; // UUID из ad_accounts (для мультиаккаунтности)
  multiAccountEnabled?: boolean; // Флаг мультиаккаунтности из user_accounts
  creativeGenerationsAvailable: number;
  setCreativeGenerationsAvailable: (value: number) => void;
  directions: any[];
}

export const CarouselTab: React.FC<CarouselTabProps> = ({
  userId,
  currentAdAccountId,
  multiAccountEnabled,
  creativeGenerationsAvailable,
  setCreativeGenerationsAvailable,
  directions
}) => {
  // В мультиаккаунтном режиме генерации безлимитные
  // ВАЖНО: проверяем флаг multiAccountEnabled, а НЕ наличие currentAdAccountId!
  const isMultiAccountMode = multiAccountEnabled === true;
  // State для шага 1: Ввод идеи
  const [carouselIdea, setCarouselIdea] = useState('');
  const [cardsCount, setCardsCount] = useState(3);
  const [isGeneratingTexts, setIsGeneratingTexts] = useState(false);

  // State для шага 2: Карточки с текстами
  const [carouselCards, setCarouselCards] = useState<CarouselCard[]>([]);
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [isRegeneratingText, setIsRegeneratingText] = useState(false);

  // State для шага 3: Генерация изображений
  const [visualStyle, setVisualStyle] = useState<CarouselVisualStyle>('freestyle');
  const [stylePrompt, setStylePrompt] = useState('');  // Промпт для freestyle стиля
  const [isGeneratingCarousel, setIsGeneratingCarousel] = useState(false);
  const [generatedCarouselId, setGeneratedCarouselId] = useState('');

  // State для шага 4: Создание креатива
  const [selectedDirectionIds, setSelectedDirectionIds] = useState<string[]>([]);
  const [isCreatingCreative, setIsCreatingCreative] = useState(false);

  // State для перегенерации отдельной карточки
  const [regeneratingCardIndex, setRegeneratingCardIndex] = useState<number | null>(null);
  const [cardRegenerationPrompts, setCardRegenerationPrompts] = useState<{[key: number]: string}>({});
  // Теперь поддерживаем до 2 референсов на карточку
  const [cardRegenerationImages, setCardRegenerationImages] = useState<{[key: number]: string[]}>({});
  // Опции что именно менять при перегенерации
  const [cardChangeOptions, setCardChangeOptions] = useState<{[key: number]: CardChangeOption[]}>({});

  // История изображений для отката (храним предыдущую версию для каждой карточки)
  const [cardImageHistory, setCardImageHistory] = useState<{[key: number]: string}>({});

  // State для множественных промптов и референсов
  interface GlobalPrompt {
    id: string;
    text: string;
    appliedToCards: number[]; // индексы карточек, к которым применён
  }

  interface GlobalReference {
    id: string;
    base64: string;
    appliedToCards: number[]; // индексы карточек, к которым применён
  }

  const [globalPrompts, setGlobalPrompts] = useState<GlobalPrompt[]>([]);
  const [globalReferences, setGlobalReferences] = useState<GlobalReference[]>([]);

  // State для отслеживания загрузки изображений
  const [loadedImages, setLoadedImages] = useState<{[key: number]: boolean}>({});

  // State для отслеживания прогресса скачивания
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({ current: 0, total: 0 });

  // State для выбора карточек для скачивания
  const [selectedCardsForDownload, setSelectedCardsForDownload] = useState<number[]>([]);

  // Автосохранение черновика
  const {
    hasSavedDraft,
    savedDraft,
    saveDraft: saveCarouselDraft,
    restoreDraft: restoreCarouselDraft,
    discardDraft: discardCarouselDraft,
    clearDraft: clearCarouselDraft
  } = useCarouselDraftAutoSave(userId, currentAdAccountId);

  // Автосохранение при изменении данных
  useEffect(() => {
    if (!userId) return;

    // Проверяем что есть что сохранять
    const hasContent =
      carouselIdea ||
      carouselCards.length > 0 ||
      globalPrompts.length > 0 ||
      globalReferences.length > 0;

    if (!hasContent) return;

    saveCarouselDraft({
      userId,
      accountId: currentAdAccountId || undefined,
      carouselIdea,
      cardsCount,
      carouselCards,
      visualStyle,
      stylePrompt,
      globalPrompts,
      globalReferences,
      generatedCarouselId,
      selectedDirectionIds
    });
  }, [
    userId,
    currentAdAccountId,
    carouselIdea,
    cardsCount,
    carouselCards,
    visualStyle,
    stylePrompt,
    globalPrompts,
    globalReferences,
    generatedCarouselId,
    selectedDirectionIds,
    saveCarouselDraft
  ]);

  // Функция восстановления черновика
  const handleRestoreCarouselDraft = useCallback(() => {
    const draft = restoreCarouselDraft();
    if (draft) {
      setCarouselIdea(draft.carouselIdea);
      setCardsCount(draft.cardsCount);
      setCarouselCards(draft.carouselCards);
      setVisualStyle(draft.visualStyle as CarouselVisualStyle);
      setStylePrompt(draft.stylePrompt);
      setGlobalPrompts(draft.globalPrompts);
      setGlobalReferences(draft.globalReferences);
      setGeneratedCarouselId(draft.generatedCarouselId);
      if (draft.selectedDirectionIds?.length) {
        setSelectedDirectionIds(draft.selectedDirectionIds);
      }
      toast.success('Черновик карусели восстановлен');
    }
  }, [restoreCarouselDraft]);

  // Сброс состояния при смене аккаунта
  useEffect(() => {
    if (!currentAdAccountId) return;

    console.log('[CarouselTab] Смена аккаунта, сбрасываем состояние');

    // Сбрасываем все локальное состояние
    setCarouselIdea('');
    setCardsCount(3);
    setCarouselCards([]);
    setCurrentCardIndex(0);
    setVisualStyle('freestyle');
    setStylePrompt('');
    setGeneratedCarouselId('');
    setSelectedDirectionIds([]);
    setCardRegenerationPrompts({});
    setCardRegenerationImages({});
    setCardChangeOptions({});
    setCardImageHistory({});
    setGlobalPrompts([]);
    setGlobalReferences([]);
    setLoadedImages({});
    setSelectedCardsForDownload([]);
  }, [currentAdAccountId]);

  // Управление глобальными промптами
  const addGlobalPrompt = () => {
    const newPrompt: GlobalPrompt = {
      id: `prompt_${Date.now()}`,
      text: '',
      appliedToCards: []
    };
    setGlobalPrompts([...globalPrompts, newPrompt]);
  };

  const updateGlobalPromptText = (promptId: string, text: string) => {
    setGlobalPrompts(globalPrompts.map(p =>
      p.id === promptId ? { ...p, text } : p
    ));
  };

  const togglePromptForCard = (promptId: string, cardIndex: number) => {
    setGlobalPrompts(globalPrompts.map(p => {
      if (p.id === promptId) {
        // Если карточка уже применена к этому промпту - убираем
        if (p.appliedToCards.includes(cardIndex)) {
          return { ...p, appliedToCards: p.appliedToCards.filter(i => i !== cardIndex) };
        } else {
          // Иначе добавляем, но сначала убираем эту карточку из всех других промптов (1 промпт на карточку)
          const updatedPrompts = globalPrompts.map(otherP => ({
            ...otherP,
            appliedToCards: otherP.appliedToCards.filter(i => i !== cardIndex)
          }));
          // Обновляем текущий промпт
          const currentPromptIndex = updatedPrompts.findIndex(pr => pr.id === promptId);
          updatedPrompts[currentPromptIndex].appliedToCards.push(cardIndex);
          setGlobalPrompts(updatedPrompts);
          return updatedPrompts[currentPromptIndex];
        }
      }
      return p;
    }));
  };

  const removeGlobalPrompt = (promptId: string) => {
    setGlobalPrompts(globalPrompts.filter(p => p.id !== promptId));
  };

  // Управление глобальными референсами
  const addGlobalReference = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        const newRef: GlobalReference = {
          id: `ref_${Date.now()}`,
          base64,
          appliedToCards: [] // По умолчанию пустой — пользователь сам выбирает карточки
        };
        setGlobalReferences([...globalReferences, newRef]);
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const toggleReferenceForCard = (refId: string, cardIndex: number) => {
    setGlobalReferences(globalReferences.map(r => {
      if (r.id === refId) {
        if (r.appliedToCards.includes(cardIndex)) {
          return { ...r, appliedToCards: r.appliedToCards.filter(i => i !== cardIndex) };
        } else {
          return { ...r, appliedToCards: [...r.appliedToCards, cardIndex] };
        }
      }
      return r;
    }));
  };

  const removeGlobalReference = (refId: string) => {
    setGlobalReferences(globalReferences.filter(r => r.id !== refId));
  };

  // Вспомогательные функции для сборки данных из глобальных промптов/референсов
  const buildCustomPromptsArray = (): (string | null)[] => {
    return carouselCards.map((_, cardIndex) => {
      // Находим промпт, который применён к этой карточке
      const applicablePrompt = globalPrompts.find(p => p.appliedToCards.includes(cardIndex));
      return applicablePrompt?.text || null;
    });
  };

  const buildReferenceImagesArray = (): (string[] | null)[] => {
    return carouselCards.map((_, cardIndex) => {
      // Находим все референсы, которые применены к этой карточке
      const applicableRefs = globalReferences.filter(r => r.appliedToCards.includes(cardIndex));
      // Возвращаем массив всех референсов для этой карточки (до 2 штук)
      return applicableRefs.length > 0 ? applicableRefs.map(r => r.base64) : null;
    });
  };

  // Генерация текстов для карточек
  const handleGenerateTexts = async () => {
    if (!userId) {
      toast.error('Необходимо авторизоваться');
      return;
    }

    setIsGeneratingTexts(true);
    try {
      // Если идея пустая, отправляем пустую строку - модель сама придумает
      const response = await carouselApi.generateTexts({
        user_id: userId,
        account_id: currentAdAccountId || undefined,
        carousel_idea: carouselIdea || '',
        cards_count: cardsCount
      });

      if (response.success && response.texts) {
        setCarouselCards(response.texts.map((text, i) => ({
          order: i,
          text,
          custom_prompt: '',
          reference_image: undefined
        })));
        setCurrentCardIndex(0);
        toast.success(`Сгенерировано ${response.texts.length} текстов`);
      } else {
        toast.error(response.error || 'Ошибка генерации текстов');
      }
    } catch (error) {
      console.error('Error generating texts:', error);
      toast.error('Ошибка при генерации текстов');
    } finally {
      setIsGeneratingTexts(false);
    }
  };

  // Обновление текста карточки
  const updateCardText = (index: number, text: string) => {
    const updated = [...carouselCards];
    updated[index].text = text;
    setCarouselCards(updated);
  };

  // Перегенерация текста одной карточки
  const handleRegenerateCardText = async (index: number) => {
    if (!userId || !carouselCards.length) return;

    setIsRegeneratingText(true);
    try {
      const existingTexts = carouselCards.map(c => c.text);

      const response = await carouselApi.regenerateCardText({
        user_id: userId,
        account_id: currentAdAccountId || undefined,
        carousel_id: generatedCarouselId || 'temp',
        card_index: index,
        existing_texts: existingTexts
      });

      if (response.success && response.text) {
        updateCardText(index, response.text);
        toast.success('Текст перегенерирован');
      } else {
        toast.error(response.error || 'Ошибка перегенерации');
      }
    } catch (error) {
      console.error('Error regenerating text:', error);
      toast.error('Ошибка при перегенерации текста');
    } finally {
      setIsRegeneratingText(false);
    }
  };

  // Генерация карусели (всех изображений)
  const handleGenerateCarousel = async () => {
    if (!userId) return;

    // TEMPORARILY DISABLED: Проверка лимита генераций
    // if (!isMultiAccountMode && creativeGenerationsAvailable < carouselCards.length) {
    //   toast.error(`Недостаточно генераций. Нужно ${carouselCards.length}, доступно ${creativeGenerationsAvailable}`);
    //   return;
    // }

    setIsGeneratingCarousel(true);

    // Прогресс-тост с обновлениями
    const totalCards = carouselCards.length;
    let currentProgress = 0;
    let progressToastId: string | number | undefined;

    // Первый этап: генерация промптов
    progressToastId = toast.loading('🎨 Генерация промптов для изображений...');

    // Таймер для имитации прогресса (примерно 5-10 секунд на промпты)
    const promptTimer = setTimeout(() => {
      if (progressToastId) {
        toast.loading(`🖼️ Генерация изображения 1 из ${totalCards}...`, { id: progressToastId });
        currentProgress = 1;
      }
    }, 8000);

    // Таймеры для имитации прогресса генерации изображений
    const imageTimers: NodeJS.Timeout[] = [];
    const averageTimePerImage = totalCards <= 3 ? 25000 : totalCards <= 5 ? 20000 : 15000;

    for (let i = 2; i <= totalCards; i++) {
      const timer = setTimeout(() => {
        if (progressToastId && currentProgress < totalCards) {
          currentProgress = i;
          toast.loading(`🖼️ Генерация изображения ${i} из ${totalCards}...`, { id: progressToastId });
        }
      }, 8000 + (i - 1) * averageTimePerImage);
      imageTimers.push(timer);
    }

    try {
      const texts = carouselCards.map(c => c.text);
      // Используем глобальные промпты/референсы из UI
      const customPrompts = buildCustomPromptsArray();
      const referenceImages = buildReferenceImagesArray();

      const response = await carouselApi.generateCarousel({
        user_id: userId,
        account_id: currentAdAccountId || undefined,
        carousel_texts: texts,
        visual_style: visualStyle,
        style_prompt: visualStyle === 'freestyle' ? (stylePrompt || undefined) : undefined,
        custom_prompts: customPrompts,
        reference_images: referenceImages,
        direction_id: selectedDirectionIds[0] || undefined
      });

      // Очищаем все таймеры
      clearTimeout(promptTimer);
      imageTimers.forEach(timer => clearTimeout(timer));

      if (response.success && response.carousel_data) {
        setGeneratedCarouselId(response.carousel_id!);
        setCarouselCards(response.carousel_data);
        setCreativeGenerationsAvailable(response.generations_remaining!);

        if (progressToastId) {
          toast.success(`✅ Карусель из ${totalCards} карточек успешно сгенерирована!`, { id: progressToastId });
        }
      } else {
        if (progressToastId) {
          toast.error(response.error || 'Ошибка генерации карусели', { id: progressToastId });
        }
      }
    } catch (error) {
      console.error('Error generating carousel:', error);

      // Очищаем все таймеры
      clearTimeout(promptTimer);
      imageTimers.forEach(timer => clearTimeout(timer));

      if (progressToastId) {
        toast.error('Ошибка при генерации карусели', { id: progressToastId });
      }
    } finally {
      setIsGeneratingCarousel(false);
    }
  };

  // Перегенерация всей карусели (с теми же текстами, но новым стилем/промптами)
  const handleRegenerateAllCarousel = async () => {
    if (!userId) return;

    // TEMPORARILY DISABLED: Проверка лимита генераций
    // if (!isMultiAccountMode && creativeGenerationsAvailable < carouselCards.length) {
    //   toast.error(`Недостаточно генераций. Нужно ${carouselCards.length}, доступно ${creativeGenerationsAvailable}`);
    //   return;
    // }

    setIsGeneratingCarousel(true);

    // Прогресс-тост с обновлениями
    const totalCards = carouselCards.length;
    let currentProgress = 0;
    let progressToastId: string | number | undefined;

    // Первый этап: генерация промптов
    progressToastId = toast.loading('🎨 Генерация промптов для изображений...');

    // Таймер для имитации прогресса (примерно 5-10 секунд на промпты)
    const promptTimer = setTimeout(() => {
      if (progressToastId) {
        toast.loading(`🖼️ Генерация изображения 1 из ${totalCards}...`, { id: progressToastId });
        currentProgress = 1;
      }
    }, 8000);

    // Таймеры для имитации прогресса генерации изображений
    const imageTimers: NodeJS.Timeout[] = [];
    const averageTimePerImage = totalCards <= 3 ? 25000 : totalCards <= 5 ? 20000 : 15000;

    for (let i = 2; i <= totalCards; i++) {
      const timer = setTimeout(() => {
        if (progressToastId && currentProgress < totalCards) {
          currentProgress = i;
          toast.loading(`🖼️ Генерация изображения ${i} из ${totalCards}...`, { id: progressToastId });
        }
      }, 8000 + (i - 1) * averageTimePerImage);
      imageTimers.push(timer);
    }

    try {
      const texts = carouselCards.map(c => c.text);
      // Используем глобальные промпты/референсы из UI
      const customPrompts = buildCustomPromptsArray();
      const referenceImages = buildReferenceImagesArray();

      const response = await carouselApi.generateCarousel({
        user_id: userId,
        account_id: currentAdAccountId || undefined,
        carousel_texts: texts,
        visual_style: visualStyle,
        style_prompt: visualStyle === 'freestyle' ? (stylePrompt || undefined) : undefined,
        custom_prompts: customPrompts,
        reference_images: referenceImages,
        direction_id: selectedDirectionIds[0] || undefined
      });

      // Очищаем все таймеры
      clearTimeout(promptTimer);
      imageTimers.forEach(timer => clearTimeout(timer));

      if (response.success && response.carousel_data) {
        setGeneratedCarouselId(response.carousel_id!);
        setCarouselCards(response.carousel_data);
        setCreativeGenerationsAvailable(response.generations_remaining!);

        if (progressToastId) {
          toast.success(`✅ Карусель из ${totalCards} карточек успешно перегенерирована!`, { id: progressToastId });
        }
      } else {
        if (progressToastId) {
          toast.error(response.error || 'Ошибка перегенерации карусели', { id: progressToastId });
        }
      }
    } catch (error) {
      console.error('Error regenerating all carousel:', error);

      // Очищаем все таймеры
      clearTimeout(promptTimer);
      imageTimers.forEach(timer => clearTimeout(timer));

      if (progressToastId) {
        toast.error('Ошибка при перегенерации карусели', { id: progressToastId });
      }
    } finally {
      setIsGeneratingCarousel(false);
    }
  };

  // Сброс изображений (вернуться к редактированию текстов)
  const handleResetImages = () => {
    // Сбрасываем изображения, но сохраняем тексты и промпты
    const resetCards = carouselCards.map(card => ({
      ...card,
      image_url: undefined,
      image_url_4k: undefined
    }));
    setCarouselCards(resetCards);
    setGeneratedCarouselId('');
    toast.info('Изображения сброшены. Вы можете изменить параметры и перегенерировать.');
  };

  // Перегенерация отдельной карточки
  const handleRegenerateCard = async (cardIndex: number) => {
    if (!userId || !generatedCarouselId) return;

    // Сохраняем текущее изображение в историю перед регенерацией
    const currentImageUrl = carouselCards[cardIndex]?.image_url;
    if (currentImageUrl) {
      setCardImageHistory(prev => ({
        ...prev,
        [cardIndex]: currentImageUrl
      }));
    }

    setRegeneratingCardIndex(cardIndex);
    try {
      const customPrompt = cardRegenerationPrompts[cardIndex] || undefined;
      const referenceImages = cardRegenerationImages[cardIndex] || [];
      const changeOptions = cardChangeOptions[cardIndex] || [];
      // Для обратной совместимости с API передаём первый референс как reference_image
      // и массив как reference_images
      const referenceImage = referenceImages.length > 0 ? referenceImages[0] : undefined;

      console.log('[CarouselTab] Regenerating card:', {
        cardIndex,
        hasCustomPrompt: !!customPrompt,
        customPromptLength: customPrompt?.length || 0,
        referenceImagesCount: referenceImages.length,
        changeOptions: changeOptions.length > 0 ? changeOptions : 'all (default)'
      });

      const response = await carouselApi.regenerateCard({
        user_id: userId,
        account_id: currentAdAccountId || undefined,
        carousel_id: generatedCarouselId,
        card_index: cardIndex,
        custom_prompt: customPrompt,
        style_prompt: visualStyle === 'freestyle' ? (stylePrompt || undefined) : undefined,
        reference_image: referenceImage,
        reference_images: referenceImages.length > 0 ? referenceImages : undefined,
        text: carouselCards[cardIndex].text,
        change_options: changeOptions.length > 0 ? changeOptions : undefined
      });

      if (response.success && response.card_data) {
        // Обновляем конкретную карточку
        const updatedCards = [...carouselCards];
        updatedCards[cardIndex] = response.card_data;
        setCarouselCards(updatedCards);

        // Обновляем доступные генерации
        if (response.generations_remaining !== undefined) {
          setCreativeGenerationsAvailable(response.generations_remaining);
        }

        // Очищаем промпт, изображения и опции после успешной регенерации
        const newPrompts = {...cardRegenerationPrompts};
        delete newPrompts[cardIndex];
        setCardRegenerationPrompts(newPrompts);

        const newImages = {...cardRegenerationImages};
        delete newImages[cardIndex];
        setCardRegenerationImages(newImages);

        const newOptions = {...cardChangeOptions};
        delete newOptions[cardIndex];
        setCardChangeOptions(newOptions);

        toast.success(`Карточка ${cardIndex + 1} перегенерирована!`);
      } else {
        toast.error(response.error || 'Ошибка перегенерации карточки');
      }
    } catch (error) {
      console.error('Error regenerating card:', error);
      toast.error('Ошибка при перегенерации карточки');
    } finally {
      setRegeneratingCardIndex(null);
    }
  };

  // Откат к предыдущей версии изображения
  const handleUndoCardImage = (cardIndex: number) => {
    const previousImageUrl = cardImageHistory[cardIndex];
    if (!previousImageUrl) {
      toast.error('Нет предыдущей версии для отката');
      return;
    }

    // Восстанавливаем предыдущее изображение
    const updatedCards = [...carouselCards];
    updatedCards[cardIndex] = {
      ...updatedCards[cardIndex],
      image_url: previousImageUrl,
      image_url_4k: undefined // Сбрасываем 4K версию
    };
    setCarouselCards(updatedCards);

    // Очищаем историю для этой карточки
    const newHistory = { ...cardImageHistory };
    delete newHistory[cardIndex];
    setCardImageHistory(newHistory);

    toast.success(`Изображение карточки ${cardIndex + 1} восстановлено`);
  };

  // Upload референсного изображения для перегенерации (до 2 референсов)
  const handleCardRegenerationImageUpload = (cardIndex: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const currentImages = cardRegenerationImages[cardIndex] || [];
    if (currentImages.length >= 2) {
      toast.error('Максимум 2 референса на карточку');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      const base64Data = base64.split(',')[1];

      setCardRegenerationImages({
        ...cardRegenerationImages,
        [cardIndex]: [...currentImages, base64Data]
      });
      toast.success(`Референс ${currentImages.length + 1} загружен`);
    };
    reader.readAsDataURL(file);
  };

  // Удаление референса по индексу
  const removeCardRegenerationImage = (cardIndex: number, imageIndex: number) => {
    const currentImages = cardRegenerationImages[cardIndex] || [];
    const newImages = currentImages.filter((_, i) => i !== imageIndex);

    if (newImages.length === 0) {
      const newState = { ...cardRegenerationImages };
      delete newState[cardIndex];
      setCardRegenerationImages(newState);
    } else {
      setCardRegenerationImages({
        ...cardRegenerationImages,
        [cardIndex]: newImages
      });
    }
  };

  // Добавление соседней карточки карусели как референса
  const addCarouselCardAsReference = async (cardIndex: number, sourceCardIndex: number) => {
    const currentImages = cardRegenerationImages[cardIndex] || [];
    if (currentImages.length >= 2) {
      toast.error('Максимум 2 референса на карточку');
      return;
    }

    const sourceCard = carouselCards[sourceCardIndex];
    if (!sourceCard?.image_url) {
      toast.error('У этой карточки нет изображения');
      return;
    }

    try {
      // Загружаем изображение и конвертируем в base64
      const response = await fetch(sourceCard.image_url);
      const blob = await response.blob();
      const reader = new FileReader();

      reader.onloadend = () => {
        const base64 = reader.result as string;
        const base64Data = base64.split(',')[1];

        setCardRegenerationImages({
          ...cardRegenerationImages,
          [cardIndex]: [...currentImages, base64Data]
        });
        toast.success(`Карточка ${sourceCardIndex + 1} добавлена как референс`);
      };
      reader.readAsDataURL(blob);
    } catch (error) {
      console.error('Error adding carousel card as reference:', error);
      toast.error('Ошибка загрузки изображения');
    }
  };

  // Скачивание картинок (всех или выбранных) - без апскейла, используем 2K
  const handleDownloadAll = async () => {
    if (!userId || !generatedCarouselId || isDownloading) return;

    // Определяем какие карточки скачиваем: выбранные или все
    const cardsToDownload = selectedCardsForDownload.length > 0
      ? selectedCardsForDownload.sort((a, b) => a - b)
      : carouselCards.map((_, i) => i);

    if (cardsToDownload.length === 0) {
      toast.error('Выберите карточки для скачивания');
      return;
    }

    setIsDownloading(true);
    setDownloadProgress({ current: 0, total: cardsToDownload.length });

    const totalCards = cardsToDownload.length;
    let progressToastId: string | number | undefined;

    try {
      progressToastId = toast.loading('📦 Создание архива...');

      // Создаём ZIP архив с выбранными картинками (используем 2K изображения)
      const zip = new JSZip();

      let downloadedCount = 0;
      for (const cardIndex of cardsToDownload) {
        const card = carouselCards[cardIndex];

        if (card && card.image_url) {
          downloadedCount++;
          setDownloadProgress({ current: downloadedCount, total: totalCards });

          if (progressToastId) {
            toast.loading(`📥 Загрузка изображения ${downloadedCount} из ${totalCards}...`, { id: progressToastId });
          }

          // Загружаем изображение как blob
          const imageResponse = await fetch(card.image_url);
          const blob = await imageResponse.blob();

          // Добавляем в ZIP
          zip.file(`carousel_card_${cardIndex + 1}.png`, blob);
        }
      }

      // Генерируем ZIP файл
      if (progressToastId) {
        toast.loading('🗜️ Упаковка архива...', { id: progressToastId });
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });

      // Скачиваем архив одним файлом
      const url = window.URL.createObjectURL(zipBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `carousel_${Date.now()}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      if (progressToastId) {
        toast.success(`✅ Архив с ${totalCards} картинками успешно скачан!`, { id: progressToastId });
      }

      // Очищаем выбор после скачивания
      setSelectedCardsForDownload([]);
    } catch (error) {
      console.error('Error downloading:', error);
      if (progressToastId) {
        toast.error('Ошибка при скачивании', { id: progressToastId });
      }
    } finally {
      setIsDownloading(false);
      setDownloadProgress({ current: 0, total: 0 });
    }
  };

  // Создание креатива в Facebook (используем 2K изображения напрямую)
  const handleCreateCreative = async () => {
    if (!userId || !generatedCarouselId || selectedDirectionIds.length === 0) {
      toast.error('Выберите направление для создания креатива');
      return;
    }

    setIsCreatingCreative(true);
    const toastId = toast.loading(
      selectedDirectionIds.length > 1
        ? `Загружаем карусель в ${selectedDirectionIds.length} направления...`
        : 'Загружаем карусель в Facebook...'
    );

    const results = await Promise.allSettled(
      selectedDirectionIds.map(directionId =>
        carouselApi.createCreative({
          user_id: userId,
          account_id: currentAdAccountId || undefined,
          carousel_id: generatedCarouselId,
          direction_id: directionId,
        })
      )
    );

    const succeeded = results.filter(
      r => r.status === 'fulfilled' && r.value.success
    ).length;
    const failed = results.length - succeeded;

    if (succeeded === results.length) {
      const directionNames = selectedDirectionIds
        .map(id => directions.find(d => d.id === id)?.name || id)
        .join(', ');
      toast.success(
        succeeded === 1
          ? `Креатив создан! Направление: ${directionNames}`
          : `Креатив создан в ${succeeded} направлениях: ${directionNames}`,
        { id: toastId }
      );
      clearCarouselDraft();
    } else if (succeeded > 0) {
      toast.warning(`Создан в ${succeeded} из ${results.length} направлениях. Ошибка в ${failed}.`, { id: toastId });
    } else {
      const firstError = results.find(r => r.status === 'fulfilled') as any;
      const errorMsg = firstError?.value?.error || 'Ошибка создания креатива';
      toast.error(errorMsg, { id: toastId });
    }

    setIsCreatingCreative(false);
  };

  // Сброс формы
  const handleReset = () => {
    setCarouselIdea('');
    setCarouselCards([]);
    setGeneratedCarouselId('');
    setCurrentCardIndex(0);
    setSelectedDirectionIds([]);
    setGlobalPrompts([]);
    setGlobalReferences([]);
    setCardImageHistory({});  // Очищаем историю изображений
    // Очищаем черновик при сбросе
    clearCarouselDraft();
  };

  const hasGeneratedImages = carouselCards.length > 0 && carouselCards.every(c => c.image_url);

  return (
    <div className="space-y-6 py-6">
      {/* Уведомление о сохраненном черновике */}
      {hasSavedDraft && savedDraft && (
        <Card className="shadow-sm border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/50">
                  <RotateCcw className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <div className="font-medium text-blue-900 dark:text-blue-100">
                    Найден незавершённый черновик карусели
                  </div>
                  <p className="text-sm text-blue-700 dark:text-blue-300">
                    {savedDraft.carouselCards.length > 0
                      ? `${savedDraft.carouselCards.length} карточек • `
                      : ''}
                    Сохранено {new Date(savedDraft.savedAt).toLocaleString('ru-RU')}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={discardCarouselDraft}
                  className="border-blue-300 text-blue-700 hover:bg-blue-100 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-900/50"
                >
                  Отклонить
                </Button>
                <Button
                  size="sm"
                  onClick={handleRestoreCarouselDraft}
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

      {/* Ввод идеи карусели */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Идея карусели
            <HelpTooltip tooltipKey={TooltipKeys.CAROUSEL_IDEA} iconSize="sm" />
          </CardTitle>
          <CardDescription>
            Введите общую идею, и AI создаст связанный storytelling из нескольких карточек
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="carousel-idea" className="flex items-center gap-1">
              Идея карусели
              <HelpTooltip tooltipKey={TooltipKeys.CAROUSEL_IDEA_INPUT} iconSize="sm" />
            </Label>
            <Textarea
              id="carousel-idea"
              value={carouselIdea}
              onChange={(e) => setCarouselIdea(e.target.value)}
              placeholder="Например: показать путь клиента от проблемы к решению..."
              rows={4}
              disabled={carouselCards.length > 0}
            />
          </div>

          <div>
            <Label htmlFor="cards-count" className="flex items-center gap-1">
              Количество карточек
              <HelpTooltip tooltipKey={TooltipKeys.CAROUSEL_CARDS_COUNT} iconSize="sm" />
            </Label>
            <Select
              value={cardsCount.toString()}
              onValueChange={(v) => setCardsCount(Number(v))}
              disabled={carouselCards.length > 0}
            >
              <SelectTrigger id="cards-count">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                  <SelectItem key={n} value={n.toString()}>
                    {n} {n === 1 ? 'карточка' : n < 5 ? 'карточки' : 'карточек'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleGenerateTexts}
              disabled={isGeneratingTexts || carouselCards.length > 0}
              className="flex-1"
            >
              {isGeneratingTexts && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Sparkles className="mr-2 h-4 w-4" />
              Сгенерировать тексты
            </Button>

            {carouselCards.length > 0 && (
              <Button variant="outline" onClick={handleReset}>
                Начать заново
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Редактирование карточек */}
      {carouselCards.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              {hasGeneratedImages ? 'Карусель' : 'Редактирование карточек'} ({currentCardIndex + 1}/{carouselCards.length})
            </CardTitle>
            <CardDescription>
              {hasGeneratedImages
                ? 'Просмотрите и отредактируйте готовые карточки карусели'
                : 'Отредактируйте тексты, добавьте кастомные промпты или референсные изображения'
              }
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Карточка с навигацией */}
            <div className="flex items-center justify-center gap-6">
              {/* Кнопка назад */}
              <Button
                size="icon"
                variant="outline"
                onClick={() => setCurrentCardIndex(Math.max(0, currentCardIndex - 1))}
                disabled={currentCardIndex === 0}
                className="flex-shrink-0"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>

              {/* Карточка 1:1 */}
              <div className="w-full max-w-md">
                <div className="space-y-3">
                  {/* Карточка 1:1 (квадрат) */}
                  <div className="relative aspect-square bg-gradient-to-br from-muted/80 to-muted border border-border rounded-lg overflow-hidden">
                    {/* Если есть изображение - показываем его */}
                    {hasGeneratedImages && carouselCards[currentCardIndex].image_url ? (
                      <>
                        <img
                          src={carouselCards[currentCardIndex].image_url}
                          alt={`Карточка ${currentCardIndex + 1}`}
                          className={`w-full h-full object-cover transition-opacity duration-300 ${
                            loadedImages[currentCardIndex] ? 'opacity-100' : 'opacity-0'
                          }`}
                          onLoad={() => setLoadedImages(prev => ({ ...prev, [currentCardIndex]: true }))}
                        />
                        {/* Прогресс-бар загрузки */}
                        {!loadedImages[currentCardIndex] && (
                          <div className="absolute inset-0 flex items-center justify-center bg-muted/80">
                            <div className="text-center space-y-3">
                              <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                              <p className="text-sm text-muted-foreground">Загрузка изображения...</p>
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      /* Иначе показываем текстовое поле */
                      <div className="w-full h-full flex items-center justify-center p-8">
                        <Textarea
                          value={carouselCards[currentCardIndex].text}
                          onChange={(e) => updateCardText(currentCardIndex, e.target.value)}
                          disabled={hasGeneratedImages}
                          className="w-full h-full resize-none bg-transparent border-none text-center text-lg font-medium leading-relaxed focus-visible:ring-0 focus-visible:ring-offset-0"
                          placeholder="Текст карточки..."
                        />
                      </div>
                    )}

                    {/* Бейдж с номером карточки */}
                    <div className="absolute top-3 left-3">
                      <Badge variant="secondary">
                        {currentCardIndex + 1}
                      </Badge>
                    </div>

                    {/* Бейдж хук/CTA */}
                    <div className="absolute top-3 right-3 flex items-center gap-1">
                      {currentCardIndex === 0 && (
                        <>
                          <Badge variant="default">Хук</Badge>
                          <HelpTooltip tooltipKey={TooltipKeys.CAROUSEL_HOOK_BADGE} iconSize="sm" />
                        </>
                      )}
                      {currentCardIndex === carouselCards.length - 1 && (
                        <>
                          <Badge variant="default">CTA</Badge>
                          <HelpTooltip tooltipKey={TooltipKeys.CAROUSEL_CTA_BADGE} iconSize="sm" />
                        </>
                      )}
                    </div>
                  </div>

                  {/* Точки-индикаторы под карточкой */}
                  <div className="flex gap-2 justify-center">
                    {carouselCards.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setCurrentCardIndex(i)}
                        className={`w-2 h-2 rounded-full transition-colors ${
                          i === currentCardIndex ? 'bg-primary' : 'bg-muted-foreground/30 hover:bg-muted-foreground/50'
                        }`}
                        title={`Карточка ${i + 1}`}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Кнопка вперед */}
              <Button
                size="icon"
                variant="outline"
                onClick={() => setCurrentCardIndex(Math.min(carouselCards.length - 1, currentCardIndex + 1))}
                disabled={currentCardIndex === carouselCards.length - 1}
                className="flex-shrink-0"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {/* Инструменты редактирования под карточкой (только для режима редактирования текстов) */}
            {!hasGeneratedImages && (
              <div className="max-w-md mx-auto space-y-3">
                <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleRegenerateCardText(currentCardIndex)}
                    disabled={isRegeneratingText}
                    className="w-full"
                  >
                    {isRegeneratingText ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4 mr-2" />
                    )}
                    Перегенерировать текст
                </Button>
              </div>
            )}

            {/* Кнопка генерации и действия */}
            {!hasGeneratedImages ? (
              /* Показываем кнопку генерации, если картинок ещё нет */
              <div className="max-w-md mx-auto space-y-4 pt-4 border-t border-border">
                <div className="flex items-center gap-4 justify-center">
                  {/* TEMPORARILY HIDDEN: Счетчик генераций */}
                  {/* {!isMultiAccountMode && (
                    <>
                      <Badge variant="secondary">
                        Стоимость: {carouselCards.length} {carouselCards.length === 1 ? 'генерация' : carouselCards.length < 5 ? 'генерации' : 'генераций'}
                      </Badge>
                      <Badge variant={creativeGenerationsAvailable >= carouselCards.length ? "default" : "destructive"}>
                        Доступно: {creativeGenerationsAvailable}
                      </Badge>
                    </>
                  )} */}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="visual-style" className="flex items-center gap-1">
                    Визуальный стиль карусели
                    <HelpTooltip tooltipKey={TooltipKeys.CAROUSEL_VISUAL_STYLE} iconSize="sm" />
                  </Label>
                  <Select value={visualStyle} onValueChange={(value) => setVisualStyle(value as CarouselVisualStyle)}>
                    <SelectTrigger id="visual-style">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="clean_minimal">Чистый минимализм</SelectItem>
                      <SelectItem value="story_illustration">Визуальный сторителлинг</SelectItem>
                      <SelectItem value="photo_ugc">Живые фото (UGC)</SelectItem>
                      <SelectItem value="asset_focus">Фокус на товаре/скриншоте</SelectItem>
                      <SelectItem value="freestyle">Свободный стиль</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {visualStyle === 'clean_minimal' && 'Универсальный стиль с акцентом на тексте и современным фоном'}
                    {visualStyle === 'story_illustration' && 'Иллюстративный стиль для визуального рассказа истории'}
                    {visualStyle === 'photo_ugc' && 'Реалистичные фото людей и сцен из жизни бизнеса'}
                    {visualStyle === 'asset_focus' && 'Фокус на загруженном изображении товара или скриншоте'}
                    {visualStyle === 'freestyle' && 'Полная свобода — задайте стиль самостоятельно через промпт'}
                  </p>

                  {/* Поле для ввода промпта стиля (только для freestyle) */}
                  {visualStyle === 'freestyle' && (
                    <div className="space-y-2 pt-3 border-t">
                      <Label htmlFor="carousel-style-prompt">Промпт стиля</Label>
                      <Textarea
                        id="carousel-style-prompt"
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
                </div>

                {/* Промпты для карточек */}
                <div className="space-y-2 pt-2 border-t border-border">
                  <Label className="text-sm text-muted-foreground flex items-center gap-1">
                    Промпты (опционально)
                    <HelpTooltip tooltipKey={TooltipKeys.CAROUSEL_CUSTOM_PROMPTS} iconSize="sm" />
                  </Label>

                  {globalPrompts.length > 0 && (
                    <div className="space-y-2">
                      {globalPrompts.map((prompt, index) => (
                        <Card key={prompt.id} className="p-3">
                          <div className="space-y-2">
                            <div className="flex items-start gap-2">
                              <Textarea
                                placeholder="Опишите дополнительные требования..."
                                value={prompt.text}
                                onChange={(e) => updateGlobalPromptText(prompt.id, e.target.value)}
                                className="flex-1 min-h-[60px]"
                              />
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => removeGlobalPrompt(prompt.id)}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>

                            <div className="flex flex-wrap gap-2 items-center">
                              <span className="text-xs text-muted-foreground">Применить к:</span>
                              {carouselCards.map((_, cardIndex) => (
                                <label key={cardIndex} className="flex items-center gap-1.5 cursor-pointer">
                                  <Checkbox
                                    checked={prompt.appliedToCards.includes(cardIndex)}
                                    onCheckedChange={() => togglePromptForCard(prompt.id, cardIndex)}
                                  />
                                  <span className="text-xs">Карточка {cardIndex + 1}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        </Card>
                      ))}
                    </div>
                  )}

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={addGlobalPrompt}
                    className="w-full text-muted-foreground hover:text-foreground"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Добавить промпт
                  </Button>
                </div>

                {/* Референсные изображения */}
                <div className="space-y-2 pt-2 border-t border-border">
                  <Label className="text-sm text-muted-foreground flex items-center gap-1">
                    Референсы (опционально)
                    <HelpTooltip tooltipKey={TooltipKeys.CAROUSEL_REFERENCES} iconSize="sm" />
                  </Label>

                  {globalReferences.length > 0 && (
                    <div className="space-y-2">
                      {globalReferences.map((ref, index) => (
                        <Card key={ref.id} className="p-3">
                          <div className="space-y-2">
                            <div className="flex items-start gap-2">
                              <img
                                src={`data:image/jpeg;base64,${ref.base64}`}
                                alt={`Референс ${index + 1}`}
                                className="w-16 h-16 object-cover rounded"
                              />
                              <div className="flex-1 space-y-2">
                                <div className="flex justify-between items-start">
                                  <span className="text-sm font-medium">Референс #{index + 1}</span>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => removeGlobalReference(ref.id)}
                                    className="h-6 w-6"
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                </div>

                                <div className="flex flex-wrap gap-2 items-center">
                                  <span className="text-xs text-muted-foreground">Применить к:</span>
                                  {carouselCards.map((_, cardIndex) => (
                                    <label key={cardIndex} className="flex items-center gap-1.5 cursor-pointer">
                                      <Checkbox
                                        checked={ref.appliedToCards.includes(cardIndex)}
                                        onCheckedChange={() => toggleReferenceForCard(ref.id, cardIndex)}
                                      />
                                      <span className="text-xs">Карточка {cardIndex + 1}</span>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        </Card>
                      ))}
                    </div>
                  )}

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={addGlobalReference}
                    className="w-full text-muted-foreground hover:text-foreground"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Добавить референс
                  </Button>
                </div>

                <Button
                  onClick={handleGenerateCarousel}
                  disabled={isGeneratingCarousel}
                  className="w-full"
                  size="lg"
                >
                  {isGeneratingCarousel ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Генерация карусели...
                    </>
                  ) : (
                    <>
                      <ImageIcon className="mr-2 h-5 w-5" />
                      Сгенерировать карусель
                    </>
                  )}
                </Button>
              </div>
            ) : (
              /* Показываем действия после генерации */
              <div className="max-w-md mx-auto space-y-6 pt-4 border-t border-border">

                {/* Раздел: Перегенерировать карточку */}
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                    Перегенерировать карточку
                    <HelpTooltip tooltipKey={TooltipKeys.CAROUSEL_REGENERATE_CARD} iconSize="sm" />
                  </h4>
                  <div className="space-y-3">
                    {/* Что именно менять */}
                    <div>
                      <Label className="text-xs text-muted-foreground">Что изменить?</Label>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        {([
                          { value: 'background' as CardChangeOption, label: 'Фон' },
                          { value: 'typography' as CardChangeOption, label: 'Типографика' },
                          { value: 'main_object' as CardChangeOption, label: 'Объект/персонаж' },
                          { value: 'composition' as CardChangeOption, label: 'Композиция' }
                        ]).map(option => {
                          const currentOptions = cardChangeOptions[currentCardIndex] || [];
                          const isChecked = currentOptions.includes(option.value);
                          return (
                            <label
                              key={option.value}
                              className={`flex items-center gap-2 p-2 rounded border cursor-pointer transition-colors ${
                                isChecked
                                  ? 'bg-primary/10 border-primary/30'
                                  : 'bg-background border-border hover:border-primary/20'
                              }`}
                            >
                              <Checkbox
                                checked={isChecked}
                                onCheckedChange={(checked) => {
                                  const current = cardChangeOptions[currentCardIndex] || [];
                                  const updated = checked
                                    ? [...current, option.value]
                                    : current.filter(o => o !== option.value);
                                  setCardChangeOptions({
                                    ...cardChangeOptions,
                                    [currentCardIndex]: updated
                                  });
                                }}
                                disabled={regeneratingCardIndex === currentCardIndex}
                              />
                              <span className="text-xs">{option.label}</span>
                            </label>
                          );
                        })}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {(cardChangeOptions[currentCardIndex] || []).length === 0
                          ? 'Не выбрано — будет улучшена вся карточка'
                          : `Выбрано: ${(cardChangeOptions[currentCardIndex] || []).length}`}
                      </p>
                    </div>

                    <div>
                      <Label htmlFor={`regen-prompt-section-${currentCardIndex}`} className="text-xs text-muted-foreground">
                        Дополнительный промпт
                      </Label>
                      <Input
                        id={`regen-prompt-section-${currentCardIndex}`}
                        value={cardRegenerationPrompts[currentCardIndex] || ''}
                        onChange={(e) => setCardRegenerationPrompts({
                          ...cardRegenerationPrompts,
                          [currentCardIndex]: e.target.value
                        })}
                        placeholder="Например: добавь больше контраста..."
                        disabled={regeneratingCardIndex === currentCardIndex}
                        className="mt-1"
                      />
                    </div>

                    <div>
                      <Label className="text-xs text-muted-foreground">Референсные изображения (до 2)</Label>
                      <div className="mt-1 space-y-3">
                        {/* Отображение загруженных референсов */}
                        {(cardRegenerationImages[currentCardIndex] || []).length > 0 && (
                          <div className="flex items-center gap-2 flex-wrap">
                            {(cardRegenerationImages[currentCardIndex] || []).map((img, imgIndex) => (
                              <div key={imgIndex} className="relative">
                                <img
                                  src={`data:image/jpeg;base64,${img}`}
                                  alt={`Референс ${imgIndex + 1}`}
                                  className="w-12 h-12 object-cover rounded border"
                                />
                                <Button
                                  size="icon"
                                  variant="destructive"
                                  onClick={() => removeCardRegenerationImage(currentCardIndex, imgIndex)}
                                  disabled={regeneratingCardIndex === currentCardIndex}
                                  className="absolute -top-1 -right-1 h-5 w-5 rounded-full"
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Выбор карточек из карусели как референсы (стиль как у скачивания) */}
                        {carouselCards.filter((c, i) => i !== currentCardIndex && c.image_url).length > 0 && (
                          <div className="space-y-2">
                            <span className="text-xs text-muted-foreground">Выбрать из карусели:</span>
                            <div className="flex flex-wrap gap-2">
                              {carouselCards.map((card, cardIdx) => {
                                if (cardIdx === currentCardIndex || !card.image_url) return null;
                                const currentImages = cardRegenerationImages[currentCardIndex] || [];
                                const isDisabled = regeneratingCardIndex === currentCardIndex || currentImages.length >= 2;
                                return (
                                  <label
                                    key={cardIdx}
                                    className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-colors ${
                                      isDisabled
                                        ? 'opacity-50 cursor-not-allowed bg-background border border-border'
                                        : 'bg-background border border-border hover:border-primary/30'
                                    }`}
                                  >
                                    <button
                                      onClick={() => !isDisabled && addCarouselCardAsReference(currentCardIndex, cardIdx)}
                                      disabled={isDisabled}
                                      className="flex items-center gap-1.5"
                                    >
                                      <img
                                        src={card.image_url}
                                        alt={`Карточка ${cardIdx + 1}`}
                                        className="w-6 h-6 object-cover rounded"
                                      />
                                      <span className="text-xs font-medium">{cardIdx + 1}</span>
                                    </button>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Загрузить свой файл */}
                        {(cardRegenerationImages[currentCardIndex] || []).length < 2 && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              const input = document.createElement('input');
                              input.type = 'file';
                              input.accept = 'image/*';
                              input.onchange = (e: any) => handleCardRegenerationImageUpload(currentCardIndex, e);
                              input.click();
                            }}
                            disabled={regeneratingCardIndex === currentCardIndex}
                            className="w-full text-muted-foreground hover:text-foreground"
                          >
                            <Plus className="h-4 w-4 mr-2" />
                            Загрузить свой файл
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRegenerateCard(currentCardIndex)}
                        disabled={regeneratingCardIndex === currentCardIndex}
                        className="flex-1"
                      >
                        {regeneratingCardIndex === currentCardIndex ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4 mr-2" />
                        )}
                        Перегенерировать
                      </Button>

                      {/* Кнопка отката к предыдущей версии */}
                      {cardImageHistory[currentCardIndex] && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleUndoCardImage(currentCardIndex)}
                          disabled={regeneratingCardIndex === currentCardIndex}
                          title="Вернуть предыдущую версию"
                        >
                          <Undo2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Раздел: Все карточки */}
                <div className="space-y-3 pt-4 border-t border-border">
                  <h4 className="text-sm font-medium text-muted-foreground">Все карточки</h4>

                  <div className="space-y-2">
                    <Label htmlFor="visual-style-after" className="text-xs text-muted-foreground">Визуальный стиль</Label>
                    <Select value={visualStyle} onValueChange={(value) => setVisualStyle(value as CarouselVisualStyle)}>
                      <SelectTrigger id="visual-style-after">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="clean_minimal">Чистый минимализм</SelectItem>
                        <SelectItem value="story_illustration">Визуальный сторителлинг</SelectItem>
                        <SelectItem value="photo_ugc">Живые фото (UGC)</SelectItem>
                        <SelectItem value="asset_focus">Фокус на товаре/скриншоте</SelectItem>
                        <SelectItem value="freestyle">Свободный стиль</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <Button
                    onClick={handleRegenerateAllCarousel}
                    variant="outline"
                    className="w-full"
                    disabled={isGeneratingCarousel}
                  >
                    {isGeneratingCarousel ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Генерация...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Перегенерировать всю карусель
                      </>
                    )}
                  </Button>

                  <Button
                    onClick={handleResetImages}
                    variant="ghost"
                    className="w-full text-muted-foreground hover:text-foreground"
                    disabled={isGeneratingCarousel}
                  >
                    Сбросить изображения
                  </Button>

                  {/* Скачивание */}
                  <div className="space-y-2 pt-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-muted-foreground flex items-center gap-1">
                        Скачать карточки
                        <HelpTooltip tooltipKey={TooltipKeys.CAROUSEL_DOWNLOAD} iconSize="sm" />
                      </Label>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setSelectedCardsForDownload(carouselCards.map((_, i) => i))}
                          className="h-6 text-xs px-2"
                        >
                          Все
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setSelectedCardsForDownload([])}
                          className="h-6 text-xs px-2"
                        >
                          Сбросить
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {carouselCards.map((_, cardIndex) => (
                        <label
                          key={cardIndex}
                          className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-colors ${
                            selectedCardsForDownload.includes(cardIndex)
                              ? 'bg-primary/10 border border-primary/30'
                              : 'bg-background border border-border hover:border-primary/30'
                          }`}
                        >
                          <Checkbox
                            checked={selectedCardsForDownload.includes(cardIndex)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedCardsForDownload([...selectedCardsForDownload, cardIndex]);
                              } else {
                                setSelectedCardsForDownload(selectedCardsForDownload.filter(i => i !== cardIndex));
                              }
                            }}
                          />
                          <span className="text-xs font-medium">{cardIndex + 1}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <Button
                    onClick={handleDownloadAll}
                    variant="outline"
                    className="w-full"
                    disabled={isDownloading}
                  >
                    {isDownloading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Упаковка {downloadProgress.current}/{downloadProgress.total}
                      </>
                    ) : (
                      <>
                        <Download className="mr-2 h-4 w-4" />
                        {selectedCardsForDownload.length > 0
                          ? `Скачать ${selectedCardsForDownload.length} ${selectedCardsForDownload.length === 1 ? 'карточку' : selectedCardsForDownload.length < 5 ? 'карточки' : 'карточек'}`
                          : 'Скачать все карточки'
                        }
                      </>
                    )}
                  </Button>
                </div>

                {/* Раздел: Создание креатива */}
                <div className="space-y-3 pt-4 border-t border-border">
                  <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                    Создание креатива
                    <HelpTooltip tooltipKey={TooltipKeys.CAROUSEL_CREATE_FB} iconSize="sm" />
                  </h4>

                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Направление</Label>
                    <DirectionMultiSelect
                      directions={directions}
                      selectedIds={selectedDirectionIds}
                      onChange={setSelectedDirectionIds}
                      disabled={!directions.length}
                      placeholder="Выберите направления"
                    />
                  </div>

                  <Button
                    onClick={handleCreateCreative}
                    disabled={selectedDirectionIds.length === 0 || isCreatingCreative}
                    className="w-full"
                  >
                    {isCreatingCreative && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Создать креатив
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};
