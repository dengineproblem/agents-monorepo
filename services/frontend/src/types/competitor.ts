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
  // Данные анализа
  analysis?: CompetitorCreativeAnalysis;
  // Данные о конкуренте (при запросе all-creatives)
  competitor?: {
    id: string;
    name: string;
    avatar_url?: string;
  };
}

export interface CompetitorsPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface AddCompetitorRequest {
  userAccountId: string;
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
