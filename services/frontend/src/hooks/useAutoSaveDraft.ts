import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

/**
 * Интерфейс для черновика изображений
 */
export interface ImageDraft {
  type: 'image';
  userId: string;
  accountId?: string;
  texts: {
    offer: string;
    bullets: string;
    profits: string;
  };
  selectedStyle: string;
  stylePrompt: string;
  referenceImages: string[];
  referenceImagePrompt: string;
  generatedImage?: string;
  generatedCreativeId?: string;
  selectedDirectionId: string;
  savedAt: number;
}

/**
 * Интерфейс для черновика карусели
 */
export interface CarouselDraft {
  type: 'carousel';
  userId: string;
  accountId?: string;
  carouselIdea: string;
  cardsCount: number;
  carouselCards: Array<{
    order: number;
    text: string;
    custom_prompt?: string;
    reference_image?: string;
    image_url?: string;
    image_url_4k?: string;
  }>;
  visualStyle: string;
  stylePrompt: string;
  globalPrompts: Array<{
    id: string;
    text: string;
    appliedToCards: number[];
  }>;
  globalReferences: Array<{
    id: string;
    base64: string;
    appliedToCards: number[];
  }>;
  generatedCarouselId: string;
  selectedDirectionId: string;
  savedAt: number;
}

export type Draft = ImageDraft | CarouselDraft;

const STORAGE_KEY_PREFIX = 'creative_draft_';
const DEBOUNCE_MS = 1000; // Автосохранение с задержкой 1 секунда

/**
 * Генерирует ключ для localStorage
 */
function getStorageKey(type: 'image' | 'carousel', userId: string, accountId?: string): string {
  const accountSuffix = accountId ? `_${accountId}` : '';
  return `${STORAGE_KEY_PREFIX}${type}_${userId}${accountSuffix}`;
}

/**
 * Хук для автосохранения черновика изображений
 */
export function useImageDraftAutoSave(
  userId: string | null,
  accountId: string | null | undefined,
  enabled: boolean = true
) {
  const [hasSavedDraft, setHasSavedDraft] = useState(false);
  const [savedDraft, setSavedDraft] = useState<ImageDraft | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSaveRef = useRef<string>('');

  // Проверяем наличие сохраненного черновика при загрузке
  useEffect(() => {
    if (!userId || !enabled) return;

    const key = getStorageKey('image', userId, accountId || undefined);
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        const draft = JSON.parse(stored) as ImageDraft;
        // Проверяем что черновик не слишком старый (макс 7 дней)
        const maxAge = 7 * 24 * 60 * 60 * 1000;
        if (Date.now() - draft.savedAt < maxAge) {
          // Проверяем что в черновике есть что-то полезное
          const hasContent =
            draft.texts.offer ||
            draft.texts.bullets ||
            draft.texts.profits ||
            draft.generatedImage ||
            draft.referenceImages.length > 0;

          if (hasContent) {
            setSavedDraft(draft);
            setHasSavedDraft(true);
          }
        } else {
          // Удаляем устаревший черновик
          localStorage.removeItem(key);
        }
      }
    } catch (e) {

    }
  }, [userId, accountId, enabled]);

  // Функция сохранения черновика
  const saveDraft = useCallback((draft: Omit<ImageDraft, 'type' | 'savedAt'>) => {
    if (!userId || !enabled) return;

    const key = getStorageKey('image', userId, accountId || undefined);
    const fullDraft: ImageDraft = {
      ...draft,
      type: 'image',
      savedAt: Date.now()
    };

    // Проверяем изменились ли данные
    const draftJson = JSON.stringify(fullDraft);
    if (draftJson === lastSaveRef.current) return;
    lastSaveRef.current = draftJson;

    // Отменяем предыдущий таймаут
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Debounced сохранение
    saveTimeoutRef.current = setTimeout(() => {
      try {
        localStorage.setItem(key, draftJson);

      } catch (e) {

      }
    }, DEBOUNCE_MS);
  }, [userId, accountId, enabled]);

  // Функция восстановления черновика
  const restoreDraft = useCallback(() => {
    if (!savedDraft) return null;
    setHasSavedDraft(false);
    return savedDraft;
  }, [savedDraft]);

  // Функция отклонения черновика (удаление)
  const discardDraft = useCallback(() => {
    if (!userId) return;

    const key = getStorageKey('image', userId, accountId || undefined);
    try {
      localStorage.removeItem(key);
      setSavedDraft(null);
      setHasSavedDraft(false);

    } catch (e) {

    }
  }, [userId, accountId]);

  // Функция полной очистки черновика (после создания креатива)
  const clearDraft = useCallback(() => {
    if (!userId) return;

    const key = getStorageKey('image', userId, accountId || undefined);
    try {
      localStorage.removeItem(key);
      lastSaveRef.current = '';

    } catch (e) {

    }
  }, [userId, accountId]);

  // Очистка таймера при размонтировании
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  return {
    hasSavedDraft,
    savedDraft,
    saveDraft,
    restoreDraft,
    discardDraft,
    clearDraft
  };
}

/**
 * Хук для автосохранения черновика карусели
 */
export function useCarouselDraftAutoSave(
  userId: string | null,
  accountId: string | null | undefined,
  enabled: boolean = true
) {
  const [hasSavedDraft, setHasSavedDraft] = useState(false);
  const [savedDraft, setSavedDraft] = useState<CarouselDraft | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSaveRef = useRef<string>('');

  // Проверяем наличие сохраненного черновика при загрузке
  useEffect(() => {
    if (!userId || !enabled) return;

    const key = getStorageKey('carousel', userId, accountId || undefined);
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        const draft = JSON.parse(stored) as CarouselDraft;
        // Проверяем что черновик не слишком старый (макс 7 дней)
        const maxAge = 7 * 24 * 60 * 60 * 1000;
        if (Date.now() - draft.savedAt < maxAge) {
          // Проверяем что в черновике есть что-то полезное
          const hasContent =
            draft.carouselIdea ||
            draft.carouselCards.length > 0 ||
            draft.globalPrompts.length > 0 ||
            draft.globalReferences.length > 0;

          if (hasContent) {
            setSavedDraft(draft);
            setHasSavedDraft(true);
          }
        } else {
          // Удаляем устаревший черновик
          localStorage.removeItem(key);
        }
      }
    } catch (e) {

    }
  }, [userId, accountId, enabled]);

  // Функция сохранения черновика
  const saveDraft = useCallback((draft: Omit<CarouselDraft, 'type' | 'savedAt'>) => {
    if (!userId || !enabled) return;

    const key = getStorageKey('carousel', userId, accountId || undefined);
    const fullDraft: CarouselDraft = {
      ...draft,
      type: 'carousel',
      savedAt: Date.now()
    };

    // Проверяем изменились ли данные
    const draftJson = JSON.stringify(fullDraft);
    if (draftJson === lastSaveRef.current) return;
    lastSaveRef.current = draftJson;

    // Отменяем предыдущий таймаут
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Debounced сохранение
    saveTimeoutRef.current = setTimeout(() => {
      try {
        localStorage.setItem(key, draftJson);

      } catch (e) {

      }
    }, DEBOUNCE_MS);
  }, [userId, accountId, enabled]);

  // Функция восстановления черновика
  const restoreDraft = useCallback(() => {
    if (!savedDraft) return null;
    setHasSavedDraft(false);
    return savedDraft;
  }, [savedDraft]);

  // Функция отклонения черновика (удаление)
  const discardDraft = useCallback(() => {
    if (!userId) return;

    const key = getStorageKey('carousel', userId, accountId || undefined);
    try {
      localStorage.removeItem(key);
      setSavedDraft(null);
      setHasSavedDraft(false);

    } catch (e) {

    }
  }, [userId, accountId]);

  // Функция полной очистки черновика (после создания креатива)
  const clearDraft = useCallback(() => {
    if (!userId) return;

    const key = getStorageKey('carousel', userId, accountId || undefined);
    try {
      localStorage.removeItem(key);
      lastSaveRef.current = '';

    } catch (e) {

    }
  }, [userId, accountId]);

  // Очистка таймера при размонтировании
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  return {
    hasSavedDraft,
    savedDraft,
    saveDraft,
    restoreDraft,
    discardDraft,
    clearDraft
  };
}
