/**
 * Типы для раздела "Конкуренты"
 */

export interface Competitor {
  id: string;
  fb_page_id: string;
  fb_page_url: string;
  name: string;
  avatar_url?: string;
  country_code: string;
  status: 'pending' | 'active' | 'error';
  last_error?: string;
  last_crawled_at?: string;
  creatives_count: number;
  created_at: string;
  // Поля из user_competitors
  user_competitor_id: string;
  display_name?: string;
  is_favorite: boolean;
}

export interface CompetitorCreativeAnalysis {
  transcript?: string;
  ocr_text?: string;
  processing_status: 'pending' | 'processing' | 'completed' | 'failed';
}

export interface CompetitorCreative {
  id: string;
  competitor_id: string;
  fb_ad_archive_id: string;
  media_type: 'video' | 'image' | 'carousel';
  media_urls: string[];
  thumbnail_url?: string;
  body_text?: string;
  headline?: string;
  cta_type?: string;
  platforms: string[];
  first_shown_date?: string;
  is_active: boolean;
  created_at: string;
  // Поля скоринга
  score?: number;
  duration_days?: number;
  ad_variations?: number;
  is_top10?: boolean;
  entered_top10_at?: string;
  last_seen_at?: string;
  // Данные анализа (может приходить как массив от Supabase)
  analysis?: CompetitorCreativeAnalysis | CompetitorCreativeAnalysis[];
  // Данные о конкуренте (при запросе all-creatives)
  competitor?: {
    id: string;
    name: string;
    avatar_url?: string;
  };
}

/**
 * Категория score для отображения
 */
export interface ScoreCategory {
  label: 'ELITE' | 'TOP' | 'GOOD' | 'OK' | 'WEAK';
  emoji: string;
  color: 'green' | 'yellow' | 'orange' | 'red' | 'gray';
}

/**
 * Получить категорию score
 */
export function getScoreCategory(score: number | undefined): ScoreCategory {
  if (!score || score < 50) {
    return { label: 'WEAK', emoji: '❌', color: 'red' };
  } else if (score >= 95) {
    return { label: 'ELITE', emoji: '💎', color: 'green' };
  } else if (score >= 85) {
    return { label: 'TOP', emoji: '🔥', color: 'green' };
  } else if (score >= 70) {
    return { label: 'GOOD', emoji: '✅', color: 'yellow' };
  } else {
    return { label: 'OK', emoji: '🟡', color: 'orange' };
  }
}

/**
 * Проверить, является ли креатив "новым" в ТОП-10 (< 7 дней)
 */
export function isNewInTop10(enteredTop10At: string | undefined): boolean {
  if (!enteredTop10At) return false;
  const entered = new Date(enteredTop10At);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return entered > weekAgo;
}

export interface CompetitorsPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface AddCompetitorRequest {
  userAccountId: string;
  accountId?: string; // UUID рекламного аккаунта для мультиаккаунтности
  socialUrl: string; // Facebook URL, Instagram URL или @handle
  name: string;
  countryCode?: string;
}

export interface GetCompetitorsResponse {
  success: boolean;
  competitors: Competitor[];
  error?: string;
}

export interface GetCreativesResponse {
  success: boolean;
  creatives: CompetitorCreative[];
  pagination: CompetitorsPagination;
  error?: string;
}

export interface RefreshCompetitorResponse {
  success: boolean;
  result?: {
    creatives_found: number;
    creatives_new: number;
  };
  error?: string;
  nextAllowedAt?: string;
}
