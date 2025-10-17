import { supabase } from '@/integrations/supabase/client';

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
  // Тип медиа, если есть (video | image)
  media_type?: 'video' | 'image' | null;
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
  async list(): Promise<UserCreative[]> {
    const userId = getUserId();
    if (!userId) return [];
    const { data, error } = await supabase
      .from('user_creatives')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('creativesApi.list error:', error);
      return [];
    }
    return (data as unknown as UserCreative[]) || [];
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

  async uploadToWebhook(
    file: File,
    title: string,
    recordId: string | null,
    goals: any,
    onProgress?: (pct: number) => void,
    description?: string,
    directionId?: string | null
  ): Promise<boolean> {
    // Выбираем эндпоинт по типу файла
    const isImage = (file?.type || '').startsWith('image/');
    const imageEndpoint = (import.meta as any).env?.VITE_PROCESS_IMAGE_URL || 'http://localhost:8082/process-image';
    const videoEndpoint = (import.meta as any).env?.VITE_N8N_CREATIVE_WEBHOOK_URL || 'http://localhost:8082/process-video';
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

    // проброс всех стандартных полей как в VideoUpload
    const stored = localStorage.getItem('user');
    if (stored) {
      try {
        const u = JSON.parse(stored);
        if (u?.instagram_id) form.append('instagram_id', String(u.instagram_id));
        if (u?.instagram_username) form.append('instagram_username', String(u.instagram_username));
        if (u?.telegram_id) form.append('telegram_id', String(u.telegram_id));
        if (u?.telegram_bot_token) form.append('telegram_bot_token', String(u.telegram_bot_token));
        if (u?.access_token) form.append('page_access_token', String(u.access_token));
        if (u?.page_id) form.append('page_id', String(u.page_id));
        if (u?.ad_account_id) form.append('ad_account_id', String(u.ad_account_id));
        if (u?.facebook_pixel_id) form.append('facebook_pixel_id', String(u.facebook_pixel_id));
        if (u?.prompt1) form.append('prompt1', String(u.prompt1));
        if (u?.prompt2) form.append('prompt2', String(u.prompt2));
        if (u?.prompt3) form.append('prompt3', String(u.prompt3));
        if (u?.username) form.append('username', String(u.username));
      } catch {}
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

