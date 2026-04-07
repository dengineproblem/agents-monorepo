import { API_BASE_URL } from '@/config/api';
import { getAuthHeaders, getUserId } from '@/lib/apiAuth';
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
      headers: getAuthHeaders()
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
        headers: getAuthHeaders()
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
        headers: getAuthHeaders()
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
        headers: getAuthHeaders()
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
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
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
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
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
        headers: getAuthHeaders(),
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
        headers: getAuthHeaders()
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
        headers: getAuthHeaders()
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

    // Для видео > 45MB: загружаем через backend TUS (нет ограничения 50MB от Supabase)
    // Файл хранится локально на backend, обрабатывается напрямую
    const MAX_DIRECT_SIZE = 45 * 1024 * 1024;
    if (file.size > MAX_DIRECT_SIZE) {
      console.log(`[Upload] File ${(file.size/1024/1024).toFixed(1)}MB > 45MB, using backend TUS`);
      let backendUploadId: string | null = null;

      const backendOk = await new Promise<boolean>((resolve) => {
        const upload = new tus.Upload(file, {
          endpoint: `${API_BASE_URL}/tus`,
          metadata: {
            user_id: userId,
            title: title || file.name,
            language: 'ru',
            ...(directionId && { direction_id: directionId }),
            ...(adAccountId && { account_id: adAccountId }),
          },
          chunkSize: 6 * 1024 * 1024,
          storeFingerprintForResuming: false,
          retryDelays: [0, 1000, 3000, 5000],
          onError: (e: any) => {
            console.error('[Backend TUS] Error:', e.message || e);
            resolve(false);
          },
          onProgress: (b, t) => {
            onProgress?.(Math.round((b / t) * 70)); // 0-70% пока загружается
          },
          onSuccess: () => {
            if (upload.url) {
              backendUploadId = upload.url.split('/').pop() || null;
            }
            onProgress?.(75);
            resolve(true);
          },
        });
        upload.start();
      });

      if (!backendOk) return false;

      // Поллинг статуса обработки на бэкенде
      for (let i = 0; i < 90; i++) {
        await new Promise(r => setTimeout(r, 2000));
        try {
          const params = new URLSearchParams({ user_id: userId });
          if (backendUploadId) params.set('upload_id', backendUploadId);
          const res = await fetch(`${API_BASE_URL}/tus/processing-status?${params}`);
          if (res.ok) {
            const st = await res.json();
            onProgress?.(75 + Math.min(24, i));
            if (st.status === 'success') { onProgress?.(100); return true; }
            if (st.status === 'error') { console.error('[Backend TUS] Failed:', st.error); return false; }
          }
        } catch { /* продолжаем поллинг */ }
      }
      console.error('[Backend TUS] Processing timeout');
      return false;
    }

    // Для видео ≤ 45MB — прямая загрузка в Supabase Storage (быстрее, без NY сервера)

    // Шаг 1: получить storage_path от бэкенда (уникальный путь)
    let storagePath: string;
    try {
      const urlRes = await fetch(`${API_BASE_URL}/create-upload-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, filename: file.name, content_type: file.type }),
      });
      if (!urlRes.ok) {
        console.error('[Upload] Failed to get storage path:', urlRes.status);
        return false;
      }
      const urlData = await urlRes.json();
      storagePath = urlData.storage_path;
    } catch (e) {
      console.error('[Upload] Error getting storage path:', e);
      return false;
    }

    // Шаг 2: TUS resumable upload с anon key (валидный Supabase JWT, безопасен для фронтенда)
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
    const uploadOk = await new Promise<boolean>((resolve) => {
      const upload = new tus.Upload(file, {
        endpoint: `${supabaseUrl}/storage/v1/upload/resumable`,
        headers: {
          Authorization: `Bearer ${supabaseAnonKey}`,
          apikey: supabaseAnonKey,
          'x-upsert': 'true',
        },
        metadata: {
          bucketName: 'videos',
          objectName: storagePath,
          contentType: file.type || 'video/mp4',
          cacheControl: '3600',
        },
        chunkSize: 6 * 1024 * 1024,
        storeFingerprintForResuming: false,
        retryDelays: [0, 1000, 3000, 5000],
        onError: (e: any) => {
          console.error('[TUS] Upload error:', e.message || e, e.originalRequest?.getStatus?.());
          resolve(false);
        },
        onProgress: (bytesUploaded: number, bytesTotal: number) => {
          onProgress?.(Math.round((bytesUploaded / bytesTotal) * 100));
        },
        onSuccess: () => {
          console.log('[TUS] Upload complete:', storagePath);
          resolve(true);
        },
      });
      upload.start();
    });

    if (!uploadOk) return false;

    // Шаг 2: отправить бэкенду путь файла для обработки
    let creativeId: string | null = null;
    try {
      const res = await fetch(`${API_BASE_URL}/process-video-from-storage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          storage_path: storagePath,
          title: title || file.name,
          language: 'ru',
          ...(directionId && { direction_id: directionId }),
          ...(adAccountId && { account_id: adAccountId }),
        }),
      });
      if (!res.ok) {
        console.error('[FromStorage] Backend returned error:', res.status);
        return false;
      }
      const data = await res.json();
      creativeId = data.creative_id;
      console.log('[FromStorage] Got creative_id:', creativeId);
    } catch (e) {
      console.error('[FromStorage] Failed to call backend:', e);
      return false;
    }

    if (!creativeId) return false;

    // Шаг 3: поллинг статуса обработки
    const maxAttempts = 90; // 90 * 2s = 3 минуты
    const pollInterval = 2000;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const statusUrl = new URL(`${API_BASE_URL}/creative-status`);
        statusUrl.searchParams.set('creative_id', creativeId);
        statusUrl.searchParams.set('user_id', userId);
        const response = await fetch(statusUrl.toString());
        if (!response.ok) {
          await new Promise(r => setTimeout(r, pollInterval));
          continue;
        }
        const status = await response.json();
        console.log('[FromStorage] Creative status:', status);
        if (status.status === 'success') {
          onProgress?.(100);
          return true;
        }
        if (status.status === 'error') {
          console.error('[FromStorage] Processing failed:', status.error);
          return false;
        }
        await new Promise(r => setTimeout(r, pollInterval));
      } catch (e) {
        console.warn('[FromStorage] Status check error:', e);
        await new Promise(r => setTimeout(r, pollInterval));
      }
    }
    console.error('[FromStorage] Timeout after 3 minutes');
    return false;
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
   * Привязать существующий видео-креатив к другому направлению.
   * Переиспользует fb_video_id, создаёт новый fb_creative_id под objective нового направления.
   */
  async assignToDirection(creativeId: string, targetDirectionId: string, accountId?: string | null): Promise<{ success: boolean; creative_id?: string; error?: string }> {
    const userId = getUserId();
    if (!userId) return { success: false, error: 'Not authenticated' };

    try {
      const response = await fetch(`${API_BASE_URL}/user-creatives/${creativeId}/assign-direction`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_direction_id: targetDirectionId, account_id: accountId }),
      });
      const data = await response.json();
      if (!response.ok) return { success: false, error: data.error || 'Unknown error' };
      return { success: true, creative_id: data.creative_id };
    } catch {
      return { success: false, error: 'Network error' };
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
