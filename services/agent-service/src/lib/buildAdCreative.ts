/**
 * buildAdCreative — единая точка пересборки Facebook AdCreative на лету.
 *
 * Почему это нужно:
 *   AdCreative в Facebook ИММУТАБЕЛЕН. Direction-editable поля (client_question,
 *   lead_form_id, site_url, utm_tag, cta_type, pixel_id, app_store_url,
 *   whatsapp_phone_number) запекаются в creative при создании. Если пользователь
 *   меняет настройки направления после первого создания креатива — кэшированный
 *   fb_creative_id продолжает указывать на старый снимок, и изменения НЕ доходят
 *   в продакшен. Поэтому при КАЖДОМ запуске (manual, AI, autopilot, creative test,
 *   brain actions, morning batch) мы пересобираем creative заново.
 *
 *   user_creatives хранит только сырые ассеты: fb_video_id, fb_image_hash,
 *   carousel_data, thumbnail_url. Всё direction-specific подставляется из
 *   текущих account_directions + default_ad_settings в момент запуска.
 */

import type { AppLogger } from './logger.js';
import { createLogger } from './logger.js';
import { supabase } from './supabase.js';
import {
  uploadImage,
  createWhatsAppCreative,
  createInstagramCreative,
  createInstagramDMCreative,
  createWebsiteLeadsCreative,
  createLeadFormVideoCreative,
  createAppInstallsVideoCreative,
  createWhatsAppImageCreative,
  createInstagramImageCreative,
  createInstagramDMImageCreative,
  createWebsiteLeadsImageCreative,
  createAppInstallsImageCreative,
  createLeadFormImageCreative,
  createWhatsAppCarouselCreative,
  createInstagramCarouselCreative,
  createInstagramDMCarouselCreative,
  createWebsiteLeadsCarouselCreative,
  createLeadFormCarouselCreative,
  createAppInstallsCarouselCreative,
} from '../adapters/facebook.js';
import { getAppInstallsConfig } from './appInstallsConfig.js';

export type Objective =
  | 'whatsapp'
  | 'conversions'
  | 'instagram_traffic'
  | 'instagram_dm'
  | 'site_leads'
  | 'lead_forms'
  | 'app_installs';

export type MediaType = 'video' | 'image' | 'carousel';

export interface BuildAdCreativeParams {
  user_creative_id: string;
  direction_id: string;
  user_account_id: string;
  /**
   * UUID из ad_accounts.id — для multi-account режима. null для legacy
   * или для опоры на source.account_id у креатива.
   */
  account_id?: string | null;
  /** Для внутреннего логирования */
  logger?: AppLogger;
}

export interface BuildAdCreativeResult {
  fb_creative_id: string;
  media_type: MediaType;
  objective: Objective;
  /** Значение column name в user_creatives, которое обновили с новым id */
  persisted_column: string | null;
}

interface CarouselCard {
  order: number;
  text: string;
  image_url?: string;
  image_url_4k?: string;
}

const defaultLog = createLogger({ module: 'buildAdCreative' });

function normalizeAccountId(id: string): string {
  return id.startsWith('act_') ? id : `act_${id}`;
}

function objectiveColumn(objective: Objective, conversionChannel: string | null): string | null {
  if (objective === 'whatsapp' || objective === 'instagram_dm') return 'fb_creative_id_whatsapp';
  if (objective === 'instagram_traffic') return 'fb_creative_id_instagram_traffic';
  if (objective === 'site_leads') return 'fb_creative_id_site_leads';
  if (objective === 'lead_forms') return 'fb_creative_id_lead_forms';
  if (objective === 'app_installs') return 'fb_creative_id_site_leads'; // legacy mapping
  if (objective === 'conversions') {
    if (conversionChannel === 'whatsapp') return 'fb_creative_id_whatsapp';
    if (conversionChannel === 'lead_form') return 'fb_creative_id_lead_forms';
    return 'fb_creative_id_site_leads';
  }
  return null;
}

async function resolveCredentials(user_account_id: string, account_id: string | null | undefined) {
  const { data: userAccount } = await supabase
    .from('user_accounts')
    .select('multi_account_enabled, access_token, ad_account_id, page_id, instagram_id, instagram_username, whatsapp_phone_number')
    .eq('id', user_account_id)
    .single();

  if (!userAccount) throw new Error('user_account not found');

  if (userAccount.multi_account_enabled) {
    if (!account_id) throw new Error('account_id required in multi-account mode');
    const { data: adAccount } = await supabase
      .from('ad_accounts')
      .select('access_token, ad_account_id, page_id, instagram_id, instagram_username, whatsapp_phone_number')
      .eq('id', account_id)
      .eq('user_account_id', user_account_id)
      .single();
    if (!adAccount?.access_token || !adAccount?.ad_account_id || !adAccount?.page_id) {
      throw new Error('ad_account incomplete');
    }
    return {
      accessToken: adAccount.access_token,
      fbAdAccountId: adAccount.ad_account_id as string,
      pageId: adAccount.page_id as string,
      instagramId: (adAccount.instagram_id as string | null) || null,
      instagramUsername: (adAccount.instagram_username as string | null) || null,
      whatsappPhoneNumber: (adAccount.whatsapp_phone_number as string | null) || null,
    };
  }

  if (!userAccount.access_token || !userAccount.ad_account_id || !userAccount.page_id) {
    throw new Error('user_account incomplete');
  }
  return {
    accessToken: userAccount.access_token as string,
    fbAdAccountId: userAccount.ad_account_id as string,
    pageId: userAccount.page_id as string,
    instagramId: (userAccount.instagram_id as string | null) || null,
    instagramUsername: (userAccount.instagram_username as string | null) || null,
    whatsappPhoneNumber: (userAccount.whatsapp_phone_number as string | null) || null,
  };
}

async function uploadThumbnail(
  adAccountId: string,
  accessToken: string,
  thumbnailUrl: string | null
): Promise<string | undefined> {
  if (!thumbnailUrl) return undefined;
  const res = await fetch(thumbnailUrl);
  if (!res.ok) throw new Error(`Failed to download thumbnail: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const uploaded = await uploadImage(adAccountId, accessToken, buf);
  return uploaded.hash;
}

async function uploadCarouselCards(
  adAccountId: string,
  accessToken: string,
  cards: CarouselCard[]
): Promise<Array<{ imageHash: string; text: string }>> {
  const out: Array<{ imageHash: string; text: string }> = [];
  const sorted = [...cards].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (let i = 0; i < sorted.length; i++) {
    const card = sorted[i];
    const imageUrl = card.image_url_4k || card.image_url;
    if (!imageUrl) throw new Error(`Carousel card ${i + 1} has no image_url`);
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(`Failed to download carousel card ${i + 1}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const uploaded = await uploadImage(adAccountId, accessToken, buf);
    out.push({ imageHash: uploaded.hash, text: card.text });
  }
  return out;
}

/**
 * Пересобирает Facebook AdCreative на лету с актуальными настройками направления.
 * Возвращает СВЕЖИЙ fb_creative_id. Старые id из user_creatives НЕ используются.
 */
export async function buildAdCreative(
  params: BuildAdCreativeParams
): Promise<BuildAdCreativeResult> {
  const log = params.logger ?? defaultLog;

  // 1. Загружаем user_creative (сырые ассеты + media_type)
  const { data: creative, error: creativeErr } = await supabase
    .from('user_creatives')
    .select('id, title, media_type, fb_video_id, fb_image_hash, carousel_data, thumbnail_url, account_id')
    .eq('id', params.user_creative_id)
    .eq('user_id', params.user_account_id)
    .single();
  if (creativeErr || !creative) {
    throw new Error(`user_creative not found: ${params.user_creative_id}`);
  }

  const mediaType = (creative.media_type as MediaType) || 'video';

  // 2. Загружаем direction
  const { data: direction, error: directionErr } = await supabase
    .from('account_directions')
    .select('objective, platform, conversion_channel, cta_type')
    .eq('id', params.direction_id)
    .single();
  if (directionErr || !direction) {
    throw new Error(`direction not found: ${params.direction_id}`);
  }
  if (direction.platform === 'tiktok') {
    throw new Error('buildAdCreative is Facebook-only; TikTok directions are not supported');
  }

  const objective = (direction.objective as Objective) || 'whatsapp';
  const conversionChannel = (direction.conversion_channel as string | null) || null;

  // 3. Загружаем default_ad_settings
  const { data: settings } = await supabase
    .from('default_ad_settings')
    .select('description, client_question, client_questions, site_url, utm_tag, lead_form_id, app_store_url')
    .eq('direction_id', params.direction_id)
    .maybeSingle();

  const description = settings?.description || 'Напишите нам, чтобы узнать подробности';
  const clientQuestions: string[] = (settings as any)?.client_questions?.length
    ? (settings as any).client_questions
    : [settings?.client_question || 'Здравствуйте! Хочу узнать об этом подробнее.'];
  const siteUrl = settings?.site_url || null;
  const utm = settings?.utm_tag || null;
  const leadFormId = settings?.lead_form_id || null;
  const appStoreUrl = settings?.app_store_url || null;

  // 4. Credentials
  const effectiveAccountId = params.account_id || (creative as any).account_id || null;
  const creds = await resolveCredentials(params.user_account_id, effectiveAccountId);
  const normalizedAccountId = normalizeAccountId(creds.fbAdAccountId);

  log.info(
    {
      user_creative_id: params.user_creative_id,
      direction_id: params.direction_id,
      objective,
      conversion_channel: conversionChannel,
      media_type: mediaType,
      ad_account: normalizedAccountId,
    },
    '[buildAdCreative] Rebuilding AdCreative on-the-fly'
  );

  // 5. По media_type + objective вызываем фабрику
  let fbCreativeId = '';

  if (mediaType === 'video') {
    if (!creative.fb_video_id) throw new Error('user_creative has no fb_video_id');
    const thumbnailHash = await uploadThumbnail(normalizedAccountId, creds.accessToken, creative.thumbnail_url);

    if (objective === 'whatsapp' || (objective === 'conversions' && conversionChannel === 'whatsapp')) {
      const c = await createWhatsAppCreative(normalizedAccountId, creds.accessToken, {
        videoId: creative.fb_video_id,
        pageId: creds.pageId,
        instagramId: creds.instagramId || undefined,
        message: description,
        clientQuestions,
        whatsappPhoneNumber: creds.whatsappPhoneNumber || undefined,
        thumbnailHash,
      });
      fbCreativeId = c.id;
    } else if (objective === 'instagram_traffic') {
      if (!creds.instagramId) throw new Error('Instagram ID required for instagram_traffic');
      const c = await createInstagramCreative(normalizedAccountId, creds.accessToken, {
        videoId: creative.fb_video_id,
        pageId: creds.pageId,
        instagramId: creds.instagramId,
        instagramUsername: creds.instagramUsername || '',
        message: description,
        thumbnailHash,
      });
      fbCreativeId = c.id;
    } else if (objective === 'instagram_dm') {
      if (!creds.instagramId) throw new Error('Instagram ID required for instagram_dm');
      const c = await createInstagramDMCreative(normalizedAccountId, creds.accessToken, {
        videoId: creative.fb_video_id,
        pageId: creds.pageId,
        instagramId: creds.instagramId,
        message: description,
        clientQuestion: clientQuestions[0],
        thumbnailHash,
      });
      fbCreativeId = c.id;
    } else if (objective === 'site_leads' || (objective === 'conversions' && conversionChannel === 'site')) {
      if (!siteUrl) throw new Error('site_url required for site_leads in direction settings');
      const c = await createWebsiteLeadsCreative(normalizedAccountId, creds.accessToken, {
        videoId: creative.fb_video_id,
        pageId: creds.pageId,
        instagramId: creds.instagramId,
        message: description,
        siteUrl,
        utm: utm || undefined,
        thumbnailHash,
        ctaType: (direction as any).cta_type || undefined,
      });
      fbCreativeId = c.id;
    } else if (objective === 'lead_forms' || (objective === 'conversions' && conversionChannel === 'lead_form')) {
      if (!leadFormId) throw new Error('lead_form_id required for lead_forms in direction settings');
      const c = await createLeadFormVideoCreative(normalizedAccountId, creds.accessToken, {
        videoId: creative.fb_video_id,
        pageId: creds.pageId,
        instagramId: creds.instagramId,
        message: description,
        leadFormId,
        thumbnailHash,
        ctaType: (direction as any).cta_type || undefined,
      });
      fbCreativeId = c.id;
    } else if (objective === 'app_installs') {
      const appConfig = getAppInstallsConfig();
      if (!appConfig || !appStoreUrl) {
        throw new Error('app_installs requires app_id (env) and app_store_url (direction settings)');
      }
      const c = await createAppInstallsVideoCreative(normalizedAccountId, creds.accessToken, {
        videoId: creative.fb_video_id,
        pageId: creds.pageId,
        instagramId: creds.instagramId,
        message: description,
        appStoreUrl,
        thumbnailHash,
      });
      fbCreativeId = c.id;
    } else {
      throw new Error(`Unsupported video objective: ${objective}`);
    }
  } else if (mediaType === 'image') {
    if (!creative.fb_image_hash) throw new Error('user_creative has no fb_image_hash');
    const imageHash = creative.fb_image_hash as string;

    if (objective === 'whatsapp' || (objective === 'conversions' && conversionChannel === 'whatsapp')) {
      const c = await createWhatsAppImageCreative(normalizedAccountId, creds.accessToken, {
        imageHash,
        pageId: creds.pageId,
        instagramId: creds.instagramId,
        message: description,
        clientQuestions,
      });
      fbCreativeId = c.id;
    } else if (objective === 'instagram_traffic') {
      if (!creds.instagramId) throw new Error('Instagram ID required for instagram_traffic');
      const c = await createInstagramImageCreative(normalizedAccountId, creds.accessToken, {
        imageHash,
        pageId: creds.pageId,
        instagramId: creds.instagramId,
        instagramUsername: creds.instagramUsername || '',
        message: description,
      });
      fbCreativeId = c.id;
    } else if (objective === 'instagram_dm') {
      if (!creds.instagramId) throw new Error('Instagram ID required for instagram_dm');
      const c = await createInstagramDMImageCreative(normalizedAccountId, creds.accessToken, {
        imageHash,
        pageId: creds.pageId,
        instagramId: creds.instagramId,
        message: description,
        clientQuestion: clientQuestions[0],
      });
      fbCreativeId = c.id;
    } else if (objective === 'site_leads' || (objective === 'conversions' && conversionChannel === 'site')) {
      if (!siteUrl) throw new Error('site_url required for site_leads in direction settings');
      const c = await createWebsiteLeadsImageCreative(normalizedAccountId, creds.accessToken, {
        imageHash,
        pageId: creds.pageId,
        instagramId: creds.instagramId,
        message: description,
        siteUrl,
        utm: utm || undefined,
        ctaType: (direction as any).cta_type || undefined,
      });
      fbCreativeId = c.id;
    } else if (objective === 'lead_forms' || (objective === 'conversions' && conversionChannel === 'lead_form')) {
      if (!leadFormId) throw new Error('lead_form_id required for lead_forms in direction settings');
      // Facebook требует link в link_data для image-креативов с lead form
      const link = siteUrl || 'https://www.facebook.com/';
      const c = await createLeadFormImageCreative(normalizedAccountId, creds.accessToken, {
        imageHash,
        pageId: creds.pageId,
        instagramId: creds.instagramId,
        message: description,
        leadFormId,
        link,
        ctaType: (direction as any).cta_type || undefined,
      });
      fbCreativeId = c.id;
    } else if (objective === 'app_installs') {
      const appConfig = getAppInstallsConfig();
      if (!appConfig || !appStoreUrl) {
        throw new Error('app_installs requires app_id (env) and app_store_url (direction settings)');
      }
      const c = await createAppInstallsImageCreative(normalizedAccountId, creds.accessToken, {
        imageHash,
        pageId: creds.pageId,
        instagramId: creds.instagramId,
        message: description,
        appStoreUrl,
      });
      fbCreativeId = c.id;
    } else {
      throw new Error(`Unsupported image objective: ${objective}`);
    }
  } else if (mediaType === 'carousel') {
    const rawCards = (creative.carousel_data as any as CarouselCard[]) || [];
    if (!Array.isArray(rawCards) || rawCards.length === 0) {
      throw new Error('user_creative has empty carousel_data');
    }
    const cards = await uploadCarouselCards(normalizedAccountId, creds.accessToken, rawCards);

    if (objective === 'whatsapp' || (objective === 'conversions' && conversionChannel === 'whatsapp')) {
      const c = await createWhatsAppCarouselCreative(normalizedAccountId, creds.accessToken, {
        cards,
        pageId: creds.pageId,
        instagramId: creds.instagramId,
        message: description,
        clientQuestion: clientQuestions[0],
      });
      fbCreativeId = c.id;
    } else if (objective === 'instagram_traffic') {
      if (!creds.instagramId) throw new Error('Instagram ID required for instagram_traffic');
      const c = await createInstagramCarouselCreative(normalizedAccountId, creds.accessToken, {
        cards,
        pageId: creds.pageId,
        instagramId: creds.instagramId,
        instagramUsername: creds.instagramUsername || '',
        message: description,
      });
      fbCreativeId = c.id;
    } else if (objective === 'instagram_dm') {
      if (!creds.instagramId) throw new Error('Instagram ID required for instagram_dm');
      const c = await createInstagramDMCarouselCreative(normalizedAccountId, creds.accessToken, {
        cards,
        pageId: creds.pageId,
        instagramId: creds.instagramId,
        message: description,
        clientQuestion: clientQuestions[0],
      });
      fbCreativeId = c.id;
    } else if (objective === 'site_leads' || (objective === 'conversions' && conversionChannel === 'site')) {
      if (!siteUrl) throw new Error('site_url required for site_leads in direction settings');
      const c = await createWebsiteLeadsCarouselCreative(normalizedAccountId, creds.accessToken, {
        cards,
        pageId: creds.pageId,
        instagramId: creds.instagramId,
        message: description,
        siteUrl,
        utm: utm || undefined,
        ctaType: (direction as any).cta_type || undefined,
      });
      fbCreativeId = c.id;
    } else if (objective === 'lead_forms' || (objective === 'conversions' && conversionChannel === 'lead_form')) {
      if (!leadFormId) throw new Error('lead_form_id required for lead_forms in direction settings');
      const c = await createLeadFormCarouselCreative(normalizedAccountId, creds.accessToken, {
        cards,
        pageId: creds.pageId,
        instagramId: creds.instagramId,
        message: description,
        leadFormId,
        ctaType: (direction as any).cta_type || undefined,
      });
      fbCreativeId = c.id;
    } else if (objective === 'app_installs') {
      const appConfig = getAppInstallsConfig();
      if (!appConfig || !appStoreUrl) {
        throw new Error('app_installs requires app_id (env) and app_store_url (direction settings)');
      }
      const c = await createAppInstallsCarouselCreative(normalizedAccountId, creds.accessToken, {
        cards,
        pageId: creds.pageId,
        instagramId: creds.instagramId,
        message: description,
        appStoreUrl,
      });
      fbCreativeId = c.id;
    } else {
      throw new Error(`Unsupported carousel objective: ${objective}`);
    }
  } else {
    throw new Error(`Unsupported media_type: ${mediaType}`);
  }

  // 6. Обновляем user_creatives.fb_creative_id_<objective> свежим значением
  //    (чисто для downstream-аналитики — при следующем запуске снова пересоберётся)
  const column = objectiveColumn(objective, conversionChannel);
  if (column) {
    const update: Record<string, any> = { fb_creative_id: fbCreativeId };
    update[column] = fbCreativeId;
    await supabase.from('user_creatives').update(update).eq('id', params.user_creative_id);
  }

  log.info(
    {
      user_creative_id: params.user_creative_id,
      fb_creative_id: fbCreativeId,
      objective,
      media_type: mediaType,
    },
    '[buildAdCreative] Fresh AdCreative created'
  );

  return {
    fb_creative_id: fbCreativeId,
    media_type: mediaType,
    objective,
    persisted_column: column,
  };
}
