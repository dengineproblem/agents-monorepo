import { API_BASE_URL } from '@/config/api';
import { shouldFilterByAccountId } from '@/utils/multiAccountHelper';
import * as tus from 'tus-js-client';

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
  tiktok_video_id?: string | null;
  creative_group_id?: string | null;
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
  // Источник креатива: uploaded (загружен пользователем) или imported_analysis (импортирован из анализа FB)
  source?: 'uploaded' | 'imported_analysis' | null;
  // Для импортированных креативов: оригинальный Facebook Ad ID
  fb_ad_id?: string | null;
  // CPL в центах на момент импорта (для imported_analysis)
  imported_cpl_cents?: number | null;
  // Количество лидов на момент импорта (для imported_analysis)
  imported_leads?: number | null;
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
  async list(accountId?: string | null, platform?: 'instagram' | 'tiktok'): Promise<UserCreative[]> {
    const userId = getUserId();
    if (!userId) return [];
    const effectivePlatform = platform || 'instagram';

    const params = new URLSearchParams({ userId });
    if (shouldFilterByAccountId(accountId)) {
      params.set('accountId', accountId!);
    }
    const res = await fetch(`${API_BASE_URL}/user-creatives?${params}`, {
      headers: { 'x-user-id': userId }
    });

    if (!res.ok) {
      console.error('creativesApi.list error:', await res.text().catch(() => ''));
      return [];
    }

    const rawCreatives = ((await res.json()) as UserCreative[]) || [];

    // Дополнительно фильтруем: видео-креативы должны иметь fb_video_id
    const creatives = rawCreatives.filter(creative => {
      const isVideo = creative.media_type === 'video'
        || (!creative.media_type && !creative.image_url && !creative.carousel_data);

      if (effectivePlatform === 'tiktok') {
        return isVideo && creative.tiktok_video_id != null;
      }

      if (isVideo) {
        return creative.fb_video_id != null;
      }
      return true;
    });

    // Carousel_data в user_creatives берём из generated_creatives (источник правды)
    const carouselsWithGenId = creatives.filter(
      c => c.media_type === 'carousel' && c.generated_creative_id
    );

    if (carouselsWithGenId.length > 0) {
      const generatedIds = carouselsWithGenId.map(c => c.generated_creative_id!);
      const genParams = new URLSearchParams({ generatedIds: generatedIds.join(',') });
      const genRes = await fetch(`${API_BASE_URL}/user-creatives/generated-bulk?${genParams}`, {
        headers: { 'x-user-id': userId }
      });
      const generatedData = genRes.ok ? await genRes.json() : null;

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
      const userId = getUserId();
      if (!userId) return null;
      const res = await fetch(`${API_BASE_URL}/user-creatives/${userCreativeId}/transcript`, {
        headers: { 'x-user-id': userId }
      });
      if (!res.ok) return null;
      const data = await res.json();
      return (data && typeof data.text === 'string') ? data.text : null;
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
      const userId = getUserId();
      if (!userId) return { text: null };

      const res = await fetch(`${API_BASE_URL}/user-creatives/${userCreativeId}/generated`, {
        headers: { 'x-user-id': userId }
      });
      if (!res.ok) return { text: null };

      const { creative, generated } = await res.json();

      if (!creative?.generated_creative_id || !generated) {
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
    try {
      const res = await fetch(`${API_BASE_URL}/user-creatives`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
        body: JSON.stringify({ title, status: 'uploaded', is_active: true }),
      });
      if (!res.ok) {
        console.error('creativesApi.createPlaceholder error:', await res.text().catch(() => ''));
        return null;
      }
      return (await res.json()) as UserCreative;
    } catch (error) {
      console.error('creativesApi.createPlaceholder error:', error);
      return null;
    }
  },

  async update(id: string, payload: Partial<UserCreative>): Promise<boolean> {
    const userId = getUserId();
    if (!userId) return false;
    try {
      const res = await fetch(`${API_BASE_URL}/user-creatives/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        console.error('creativesApi.update error:', await res.text().catch(() => ''));
        return false;
      }
      return true;
    } catch (error) {
      console.error('creativesApi.update error:', error);
      return false;
    }
  },

  async toggleActive(id: string, active: boolean): Promise<boolean> {
    return this.update(id, { is_active: active } as Partial<UserCreative>);
  },

  async delete(id: string): Promise<boolean> {
    const userId = getUserId();
    if (!userId) return false;
    try {
      const res = await fetch(`${API_BASE_URL}/user-creatives/${id}`, {
        method: 'DELETE',
        headers: { 'x-user-id': userId },
      });
      if (!res.ok) {
        console.error('Ошибка удаления креатива:', await res.text().catch(() => ''));
        return false;
      }
      return true;
    } catch (error) {
      console.error('Ошибка удаления креатива:', error);
      return false;
    }
  },

  async getCreativeTestStatus(creativeId: string): Promise<CreativeTestStatus | null> {
    try {
      const userId = getUserId();
      if (!userId) return null;

      const params = new URLSearchParams({ userId, creativeIds: creativeId });
      const res = await fetch(`${API_BASE_URL}/user-creatives/tests?${params}`, {
        headers: { 'x-user-id': userId }
      });
      if (!res.ok) {
        console.error('creativesApi.getCreativeTestStatus error:', await res.text().catch(() => ''));
        return null;
      }
      const tests = await res.json();
      if (!tests || tests.length === 0) return null;
      // Return the most recent test
      return {
        status: tests[0].status,
        started_at: tests[0].started_at,
        completed_at: tests[0].completed_at,
        impressions: tests[0].impressions || 0,
      };
    } catch (e) {
      console.error('creativesApi.getCreativeTestStatus exception:', e);
      return null;
    }
  },

  async getCreativeTestStatuses(creativeIds: string[]): Promise<Record<string, CreativeTestStatus>> {
    if (!creativeIds || creativeIds.length === 0) return {};

    try {
      const userId = getUserId();
      if (!userId) return {};

      const params = new URLSearchParams({ userId, creativeIds: creativeIds.join(',') });
      const res = await fetch(`${API_BASE_URL}/user-creatives/tests?${params}`, {
        headers: { 'x-user-id': userId }
      });
      if (!res.ok) {
        console.error('creativesApi.getCreativeTestStatuses error:', await res.text().catch(() => ''));
        return {};
      }
      const data = await res.json();

      // Группируем по user_creative_id и берем последний тест для каждого креатива
      const result: Record<string, CreativeTestStatus> = {};
      for (const test of (data || [])) {
        const cId = test.user_creative_id;
        if (!result[cId]) {
          result[cId] = {
            status: test.status,
            started_at: test.started_at,
            completed_at: test.completed_at,
            impressions: test.impressions || 0,
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
    const isImage = (file?.type || '').startsWith('image/');
    const userId = getUserId();
    if (!userId) return false;

    console.log('[creativesApi.uploadToWebhook] directionId:', directionId);

    // Для изображений используем обычный XHR (без TUS)
    if (isImage) {
      const imageEndpoint = `${API_BASE_URL}/process-image`;
      const form = new FormData();
      form.append('file', file);
      form.append('user_id', userId);
      form.append('id', userId);
      form.append('title', title || file.name);
      if (recordId) form.append('record_id', recordId);
      if (!recordId) form.append('client_request_id', genId());
      if (description) form.append('description', description);
      if (directionId) form.append('direction_id', directionId);
      if (adAccountId) form.append('account_id', adAccountId);

      try {
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', imageEndpoint, true);
          xhr.upload.onprogress = (evt) => {
            if (evt.lengthComputable && onProgress) {
              onProgress(Math.round((evt.loaded / evt.total) * 100));
            }
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              onProgress?.(100);
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
        console.error('uploadToWebhook image exception', e);
        return false;
      }
    }

    // Для видео используем TUS resumable upload
    const tusEndpoint = `${API_BASE_URL}/tus`;
    const storageKey = `tus_upload_${file.name}_${file.size}`;

    // Собираем metadata для TUS
    const metadata: Record<string, string> = {
      filename: file.name,
      filetype: file.type,
      user_id: userId,
      title: title || file.name,
      language: 'ru'
    };
    if (recordId) metadata.record_id = recordId;
    if (!recordId) metadata.client_request_id = genId();
    if (description) metadata.description = description;
    if (directionId) {
      console.log('[creativesApi.uploadToWebhook] TUS metadata direction_id:', directionId);
      metadata.direction_id = directionId;
    }
    if (adAccountId) {
      console.log('[creativesApi.uploadToWebhook] TUS metadata account_id:', adAccountId);
      metadata.account_id = adAccountId;
    }

    // Добавляем поля целей
    const cfg = goals || {};
    if (cfg.whatsapp?.enabled && cfg.whatsapp?.client_question) {
      metadata.client_question = String(cfg.whatsapp.client_question);
    }
    if (cfg.site_leads?.enabled) {
      if (cfg.site_leads?.site_url) metadata.site_url = String(cfg.site_leads.site_url);
      if (cfg.site_leads?.utm_tag) metadata.utm = String(cfg.site_leads.utm_tag);
    }

    return new Promise<boolean>((resolve) => {
      const upload = new tus.Upload(file, {
        endpoint: tusEndpoint,
        retryDelays: [0, 1000, 3000, 5000, 10000, 20000, 30000],
        chunkSize: 5 * 1024 * 1024, // 5MB chunks
        metadata,
        onError: (error) => {
          console.error('[TUS] Upload error:', error);
          // Сохраняем URL для возможного resume
          if (upload.url) {
            try {
              localStorage.setItem(storageKey, upload.url);
            } catch (e) {
              console.warn('[TUS] Failed to save resume URL:', e);
            }
          }
          resolve(false);
        },
        onProgress: (bytesUploaded, bytesTotal) => {
          const pct = Math.round((bytesUploaded / bytesTotal) * 100);
          onProgress?.(pct);
        },
        onSuccess: async () => {
          console.log('[TUS] File upload completed, waiting for processing...');
          // Удаляем сохранённый URL после успешной загрузки файла
          try {
            localStorage.removeItem(storageKey);
          } catch (e) {
            // ignore
          }

          // Извлекаем upload_id из URL для точного отслеживания
          // URL формата: http://localhost:8082/tus/abc123... -> abc123...
          let uploadId: string | null = null;
          if (upload.url) {
            const urlParts = upload.url.split('/tus/');
            if (urlParts.length > 1) {
              uploadId = urlParts[1].split('?')[0]; // убираем query params если есть
              console.log('[TUS] Extracted upload_id:', uploadId);
            }
          }

          // Теперь ждём завершения обработки на сервере (Facebook upload)
          // Делаем polling статуса каждые 2 секунды, максимум 3 минуты
          const maxAttempts = 90; // 90 * 2 = 180 секунд
          const pollInterval = 2000;

          for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
              const statusUrl = new URL(`${API_BASE_URL}/tus/processing-status`);
              statusUrl.searchParams.set('user_id', userId);
              // Используем upload_id если есть, иначе fallback на title
              if (uploadId) {
                statusUrl.searchParams.set('upload_id', uploadId);
              } else {
                statusUrl.searchParams.set('title', metadata.title);
              }
              if (adAccountId) {
                statusUrl.searchParams.set('account_id', adAccountId);
              }

              const response = await fetch(statusUrl.toString());
              if (!response.ok) {
                console.warn('[TUS] Status check failed:', response.status);
                await new Promise(r => setTimeout(r, pollInterval));
                continue;
              }

              const status = await response.json();
              console.log('[TUS] Processing status:', status);

              if (status.status === 'success') {
                console.log('[TUS] Processing completed successfully');
                onProgress?.(100);
                resolve(true);
                return;
              }

              if (status.status === 'error') {
                console.error('[TUS] Processing failed:', status.error);
                resolve(false);
                return;
              }

              // status === 'processing' - продолжаем ждать
              await new Promise(r => setTimeout(r, pollInterval));
            } catch (e) {
              console.warn('[TUS] Status check error:', e);
              await new Promise(r => setTimeout(r, pollInterval));
            }
          }

          // Таймаут - считаем ошибкой
          console.error('[TUS] Processing timeout after 3 minutes');
          resolve(false);
        }
      });

      // Пытаемся восстановить незавершённую загрузку
      const previousUrl = localStorage.getItem(storageKey);
      if (previousUrl) {
        console.log('[TUS] Resuming previous upload from:', previousUrl);
        upload.url = previousUrl;
      }

      // Проверяем, можно ли продолжить предыдущую загрузку
      upload.findPreviousUploads().then((previousUploads) => {
        if (previousUploads.length > 0) {
          console.log('[TUS] Found previous uploads, resuming...');
          upload.resumeFromPreviousUpload(previousUploads[0]);
        }
        upload.start();
      }).catch(() => {
        // Если не удалось найти предыдущие загрузки, начинаем новую
        upload.start();
      });
    });
  },

  /**
   * Получает превью топ креативов из Facebook (без импорта)
   * Пользователь может выбрать какие из них импортировать
   */
  async getTopCreativesPreview(accountId?: string | null): Promise<{
    success: boolean;
    creatives: TopCreativePreview[];
    total_found: number;
    already_imported: number;
    error?: string;
  }> {
    const userId = getUserId();
    if (!userId) {
      return { success: false, creatives: [], total_found: 0, already_imported: 0, error: 'User not authenticated' };
    }

    try {
      const params = new URLSearchParams({ user_id: userId });
      if (accountId) {
        params.set('account_id', accountId);
      }

      const response = await fetch(`${API_BASE_URL}/analyze-top-creatives/preview?${params.toString()}`);
      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          creatives: [],
          total_found: 0,
          already_imported: 0,
          error: data.error || 'Failed to fetch preview'
        };
      }

      return {
        success: true,
        creatives: data.creatives || [],
        total_found: data.total_found || 0,
        already_imported: data.already_imported || 0
      };
    } catch (error) {
      console.error('creativesApi.getTopCreativesPreview error:', error);
      return {
        success: false,
        creatives: [],
        total_found: 0,
        already_imported: 0,
        error: 'Network error during preview'
      };
    }
  },

  /**
   * Импортирует выбранные креативы из Facebook
   * @param adIds - массив ad_id для импорта
   * @param accountId - UUID рекламного аккаунта
   * @param directionMappings - маппинг ad_id -> direction_id (опционально)
   */
  async importSelectedCreatives(
    adIds: string[],
    accountId?: string | null,
    directionMappings?: Array<{ ad_id: string; direction_id: string | null }>
  ): Promise<{
    success: boolean;
    imported: number;
    results: ImportResult[];
    message?: string;
    error?: string;
  }> {
    const userId = getUserId();
    if (!userId) {
      return { success: false, imported: 0, results: [], error: 'User not authenticated' };
    }

    try {
      const response = await fetch(`${API_BASE_URL}/analyze-top-creatives/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          account_id: accountId || undefined,
          ad_ids: adIds,
          direction_mappings: directionMappings || undefined
        })
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          imported: 0,
          results: [],
          error: data.error || 'Failed to import creatives'
        };
      }

      return {
        success: true,
        imported: data.imported || 0,
        results: data.results || [],
        message: data.message
      };
    } catch (error) {
      console.error('creativesApi.importSelectedCreatives error:', error);
      return {
        success: false,
        imported: 0,
        results: [],
        error: 'Network error during import'
      };
    }
  },

  /**
   * Проверяет статус импортированных креативов
   */
  async getImportedCreativesStatus(accountId?: string | null): Promise<{
    hasImported: boolean;
    count: number;
    creatives: Array<{
      id: string;
      title: string;
      imported_cpl_cents: number | null;
      imported_leads: number | null;
      created_at: string;
    }>;
  }> {
    const userId = getUserId();
    if (!userId) {
      return { hasImported: false, count: 0, creatives: [] };
    }

    try {
      const params = new URLSearchParams({ user_id: userId });
      if (accountId) {
        params.set('account_id', accountId);
      }

      const response = await fetch(`${API_BASE_URL}/analyze-top-creatives/status?${params.toString()}`);
      const data = await response.json();

      if (!response.ok) {
        console.error('getImportedCreativesStatus error:', data.error);
        return { hasImported: false, count: 0, creatives: [] };
      }

      return {
        hasImported: data.hasImported,
        count: data.count,
        creatives: data.creatives || []
      };
    } catch (error) {
      console.error('creativesApi.getImportedCreativesStatus error:', error);
      return { hasImported: false, count: 0, creatives: [] };
    }
  },
};

// Типы для превью креатива
export interface TopCreativePreview {
  ad_id: string;
  ad_name: string;
  creative_id: string;
  video_id: string | null;
  thumbnail_url: string | null;
  spend: number;
  leads: number;
  cpl: number;
  cpl_cents: number;
  already_imported: boolean;
  is_video: boolean;
  preview_url: string; // Ссылка на Ads Manager для просмотра
}

// Результат импорта одного креатива
export interface ImportResult {
  ad_id: string;
  ad_name: string;
  success: boolean;
  creative_id?: string;
  error?: string;
}
