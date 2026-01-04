import { supabase } from '@/integrations/supabase/client';
import { API_BASE_URL } from '@/config/api';

// Тип для карточки карусели
export type CarouselCard = {
  order: number;
  text: string;
  image_url?: string;
  image_url_4k?: string;
};

export type UserCreative = {
  id: string;
  user_id: string;
  title: string;
  direction_id: string | null;
  fb_video_id: string | null;
  fb_creative_id_whatsapp: string | null;
  fb_creative_id_instagram_traffic: string | null;
  fb_creative_id_site_leads: string | null;
  status: 'uploaded' | 'processing' | 'partial_ready' | 'ready' | 'error';
  is_active: boolean;
  error_text: string | null;
  created_at: string;
  updated_at: string;
  // Тип медиа: video, image или carousel
  media_type?: 'video' | 'image' | 'carousel' | null;
  // Связь с generated_creative для получения текстов
  generated_creative_id?: string | null;
  // URL изображения для миниатюр (image креативы)
  image_url?: string | null;
  // Миниатюра видео (скриншот первого кадра)
  thumbnail_url?: string | null;
  // Данные карусели (carousel креативы)
  carousel_data?: CarouselCard[] | null;
};

export type CreativeTestStatus = {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  started_at: string | null;
  completed_at: string | null;
  impressions: number;
};

const getUserId = (): string | null => {
  const stored = localStorage.getItem('user');
  if (!stored) return null;
  try {
    const u = JSON.parse(stored);
    return u?.id || null;
  } catch {
    return null;
  }
};

const genId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? (crypto as any).randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

/**
 * Проверяет, включён ли режим мультиаккаунтности.
 * СТРОГОЕ ПРАВИЛО: Логика ветвления определяется ТОЛЬКО значением multi_account_enabled,
 * а НЕ наличием accountId в параметрах.
 */
const isMultiAccountEnabled = (): boolean => {
  return localStorage.getItem('multiAccountEnabled') === 'true';
};

export const creativesApi = {
  /**
   * Получает список креативов пользователя.
   *
   * ЛОГИКА РАБОТЫ (по правилам из MULTI_ACCOUNT_GUIDE.md):
   * - Если multi_account_enabled = true: фильтруем по accountId
   * - Если multi_account_enabled = false: accountId ИГНОРИРУЕТСЯ, возвращаем все креативы
   *
   * @param accountId - UUID из ad_accounts.id (используется ТОЛЬКО в multi-account режиме)
   */
  async list(accountId?: string | null): Promise<UserCreative[]> {
    const userId = getUserId();
    if (!userId) return [];

    const multiAccountMode = isMultiAccountEnabled();

    let query = supabase
      .from('user_creatives')
      .select('*')
      .eq('user_id', userId)
      .neq('status', 'failed'); // Исключаем failed креативы из списка

    // СТРОГОЕ ПРАВИЛО: Фильтрация по account_id ТОЛЬКО если multi_account_enabled = true
    // В legacy режиме accountId ИГНОРИРУЕТСЯ, даже если он передан
    if (multiAccountMode && accountId) {
      query = query.eq('account_id', accountId);
      console.log('[creativesApi.list] Multi-account режим: фильтрация по account_id =', accountId);
    } else if (multiAccountMode && !accountId) {
      console.warn('[creativesApi.list] Multi-account режим, но accountId не передан — возвращаем все креативы');
    } else {
      console.log('[creativesApi.list] Legacy режим: accountId игнорируется, возвращаем все креативы пользователя');
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      console.error('creativesApi.list error:', error);
      return [];
    }

    const creatives = (data as unknown as UserCreative[]) || [];

    // Carousel_data в user_creatives берём из generated_creatives (источник правды)
    const carouselsWithGenId = creatives.filter(
      c => c.media_type === 'carousel' && c.generated_creative_id
    );

    if (carouselsWithGenId.length > 0) {
      const generatedIds = carouselsWithGenId.map(c => c.generated_creative_id!);
      const { data: generatedData } = await supabase
        .from('generated_creatives' as any)
        .select('id, carousel_data')
        .in('id', generatedIds);

      if (generatedData) {
        const generatedMap = new Map(generatedData.map((g: any) => [g.id, g.carousel_data]));
        for (const creative of creatives) {
          if (creative.media_type === 'carousel' && creative.generated_creative_id) {
            creative.carousel_data = generatedMap.get(creative.generated_creative_id) || creative.carousel_data;
          }
        }
      }
    }

    return creatives;
  },

  async getTranscript(userCreativeId: string): Promise<string | null> {
    try {
      // Источник транскрибации: public.creative_transcripts
      // Связь: creative_transcripts.creative_id -> user_creatives.id
      const { data, error } = await supabase
        .from('creative_transcripts' as any)
        .select('text, created_at')
        .eq('creative_id', userCreativeId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return null;
      const anyData = data as any;
      return (anyData && typeof anyData.text === 'string') ? (anyData.text as string) : null;
    } catch {
      return null;
    }
  },

  /**
   * Получает текст креатива в зависимости от типа:
   * - video: транскрибация из creative_transcripts
   * - image: offer + bullets + profits из generated_creatives
   * - carousel: тексты всех карточек
   */
  async getCreativeText(
    userCreativeId: string,
    mediaType: string,
    carouselData?: CarouselCard[] | null
  ): Promise<{ text: string | null }> {
    // Для video - используем транскрибацию
    if (mediaType === 'video') {
      const transcript = await this.getTranscript(userCreativeId);
      return { text: transcript };
    }

    // Для carousel - если есть carousel_data, используем тексты из него
    if (mediaType === 'carousel' && carouselData && carouselData.length > 0) {
      const texts = carouselData
        .sort((a, b) => a.order - b.order)
        .map((card, idx) => `Карточка ${idx + 1}:\n${card.text}`)
        .join('\n\n');
      return { text: texts };
    }

    // Для image/carousel без данных - получаем из generated_creatives
    try {
      // Шаг 1: Получаем generated_creative_id из user_creatives
      const { data: creative, error: creativeError } = await supabase
        .from('user_creatives')
        .select('generated_creative_id, carousel_data')
        .eq('id', userCreativeId)
        .single();

      if (creativeError || !creative?.generated_creative_id) {
        return { text: null };
      }

      // Шаг 2: Получаем тексты из generated_creatives
      const { data: generated, error: generatedError } = await supabase
        .from('generated_creatives' as any)
        .select('offer, bullets, profits, carousel_data, creative_type')
        .eq('id', creative.generated_creative_id)
        .single();

      if (generatedError || !generated) {
        return { text: null };
      }

      const genData = generated as any;

      // Для карусели - собираем тексты карточек
      if (genData.creative_type === 'carousel' && genData.carousel_data) {
        const carouselCards = genData.carousel_data as CarouselCard[];
        const texts = carouselCards
          .sort((a, b) => a.order - b.order)
          .map((card, idx) => `Карточка ${idx + 1}:\n${card.text}`)
          .join('\n\n');
        return { text: texts };
      }

      // Для image - возвращаем offer/bullets/profits
      const textParts = [
        genData.offer && `Оффер: ${genData.offer}`,
        genData.bullets && `Буллеты:\n${genData.bullets}`,
        genData.profits && `Выгоды: ${genData.profits}`
      ].filter(Boolean);

      return { text: textParts.join('\n\n') || null };
    } catch (e) {
      console.error('getCreativeText error:', e);
      return { text: null };
    }
  },

  async createPlaceholder(title: string): Promise<UserCreative | null> {
    const userId = getUserId();
    if (!userId) return null;
    const { data, error } = await supabase
      .from('user_creatives')
      .insert({
        user_id: userId,
        title,
        status: 'uploaded',
        is_active: true,
      })
      .select('*')
      .single();
    if (error) {
      console.error('creativesApi.createPlaceholder error:', error);
      return null;
    }
    return data as unknown as UserCreative;
  },

  async update(id: string, payload: Partial<UserCreative>): Promise<boolean> {
    const { error } = await supabase
      .from('user_creatives')
      .update(payload)
      .eq('id', id);
    if (error) {
      console.error('creativesApi.update error:', error);
      return false;
    }
    return true;
  },

  async toggleActive(id: string, active: boolean): Promise<boolean> {
    return this.update(id, { is_active: active } as Partial<UserCreative>);
  },

  async delete(id: string): Promise<boolean> {
    const { error } = await supabase
      .from('user_creatives')
      .delete()
      .eq('id', id);
    
    if (error) {
      console.error('Ошибка удаления креатива:', error);
      return false;
    }
    return true;
  },

  async getCreativeTestStatus(creativeId: string): Promise<CreativeTestStatus | null> {
    try {
      const { data, error } = await supabase
        .from('creative_tests' as any)
        .select('status, started_at, completed_at, impressions')
        .eq('user_creative_id', creativeId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (error) {
        console.error('creativesApi.getCreativeTestStatus error:', error);
        return null;
      }
      
      return data as CreativeTestStatus | null;
    } catch (e) {
      console.error('creativesApi.getCreativeTestStatus exception:', e);
      return null;
    }
  },

  async getCreativeTestStatuses(creativeIds: string[]): Promise<Record<string, CreativeTestStatus>> {
    if (!creativeIds || creativeIds.length === 0) return {};
    
    try {
      const { data, error } = await supabase
        .from('creative_tests' as any)
        .select('user_creative_id, status, started_at, completed_at, impressions, created_at')
        .in('user_creative_id', creativeIds)
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('creativesApi.getCreativeTestStatuses error:', error);
        return {};
      }

      // Группируем по user_creative_id и берем последний тест для каждого креатива
      const result: Record<string, CreativeTestStatus> = {};
      for (const test of (data || [])) {
        const creativeId = (test as any).user_creative_id;
        if (!result[creativeId]) {
          result[creativeId] = {
            status: (test as any).status,
            started_at: (test as any).started_at,
            completed_at: (test as any).completed_at,
            impressions: (test as any).impressions || 0,
          };
        }
      }
      
      return result;
    } catch (e) {
      console.error('creativesApi.getCreativeTestStatuses exception:', e);
      return {};
    }
  },

  /**
   * Перетранскрибировать видео креатив
   */
  async reTranscribe(creativeId: string, language: string = 'ru'): Promise<{
    success: boolean;
    text?: string;
    error?: string;
  }> {
    const userId = getUserId();
    if (!userId) {
      return { success: false, error: 'User not authenticated' };
    }

    try {
      const response = await fetch(`${API_BASE_URL}/re-transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creative_id: creativeId,
          user_id: userId,
          language
        })
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: data.error || 'Failed to re-transcribe'
        };
      }

      return {
        success: true,
        text: data.data?.transcription?.text
      };
    } catch (error) {
      console.error('creativesApi.reTranscribe error:', error);
      return {
        success: false,
        error: 'Network error during re-transcription'
      };
    }
  },

  async uploadToWebhook(
    file: File,
    title: string,
    recordId: string | null,
    goals: any,
    onProgress?: (pct: number) => void,
    description?: string,
    directionId?: string | null,
    adAccountId?: string | null // UUID из ad_accounts (для мультиаккаунтности)
  ): Promise<boolean> {
    // Выбираем эндпоинт по типу файла
    // ✅ Следуем правилам: API_BASE_URL уже содержит /api, не добавляем его в путь
    const isImage = (file?.type || '').startsWith('image/');
    const imageEndpoint = `${API_BASE_URL}/process-image`;
    const videoEndpoint = `${API_BASE_URL}/process-video`;
    const webhookUrl = isImage ? imageEndpoint : videoEndpoint;
    const userId = getUserId();
    if (!userId) return false;

    console.log('[creativesApi.uploadToWebhook] directionId:', directionId);

    const form = new FormData();
    form.append('file', file);
    // Совместимость: backend может ожидать как user_id, так и id (алиас)
    form.append('user_id', userId);
    form.append('id', userId);
    form.append('title', title || file.name);
    if (recordId) form.append('record_id', recordId);
    if (!recordId) form.append('client_request_id', genId());
    if (description) form.append('description', description);
    if (directionId) {
      console.log('[creativesApi.uploadToWebhook] Добавляем direction_id в FormData:', directionId);
      form.append('direction_id', directionId);
    } else {
      console.log('[creativesApi.uploadToWebhook] direction_id НЕ добавлен (значение:', directionId, ')');
    }

    // account_id (UUID из ad_accounts) для мультиаккаунтности
    if (adAccountId) {
      console.log('[creativesApi.uploadToWebhook] Добавляем account_id в FormData:', adAccountId);
      form.append('account_id', adAccountId);
    }
    
    // Язык для транскрибации добавляем только для видео
    if (!isImage) {
      form.append('language', 'ru');
    }

    // Поля целей отдельными полями, без явных флагов campaign_goal
    const cfg = goals || {};
    if (cfg.whatsapp?.enabled) {
      if (cfg.whatsapp?.client_question) form.append('client_question', String(cfg.whatsapp.client_question));
    }
    if (cfg.site_leads?.enabled) {
      if (cfg.site_leads?.site_url) form.append('site_url', String(cfg.site_leads.site_url));
      if (cfg.site_leads?.utm_tag) form.append('utm', String(cfg.site_leads.utm_tag));
    }

    try {
      // Используем XHR для получения прогресса загрузки
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', webhookUrl, true);
        xhr.upload.onprogress = (evt) => {
          if (evt.lengthComputable && onProgress) {
            const pct = Math.round((evt.loaded / evt.total) * 100);
            onProgress(pct);
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            onProgress && onProgress(100);
            resolve();
          } else {
            reject(new Error(`HTTP ${xhr.status}`));
          }
        };
        xhr.onerror = () => reject(new Error('Network error'));
        xhr.send(form);
      });
      return true;
    } catch (e) {
      console.error('uploadToWebhook exception', e);
      return false;
    }
  },
};

