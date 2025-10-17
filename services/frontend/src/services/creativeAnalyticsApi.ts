// Creative Analytics API
// Документация: см. спецификацию в корне проекта

import { ANALYTICS_API_BASE_URL } from '@/config/api';

export interface CreativeInfo {
  id: string;
  title: string;
  status: string;
  direction_id: string | null;
  direction_name: string | null;
}

export interface MetricsData {
  impressions: number;
  reach: number;
  frequency?: number;
  clicks?: number;
  link_clicks?: number;
  ctr: number;
  link_ctr?: number;
  leads: number;
  spend_cents?: number;
  cpm_cents: number | null;
  cpc_cents?: number | null;
  cpl_cents: number | null;
  video_views: number;
  video_views_25_percent: number;
  video_views_50_percent: number;
  video_views_75_percent: number;
  video_views_95_percent: number;
  video_avg_watch_time_sec?: number;
}

export interface TestData {
  exists: boolean;
  status: string;
  completed_at: string;
  metrics: MetricsData;
  llm_analysis: {
    score: number;
    verdict: string;
    reasoning: string;
  };
}

export interface ProductionData {
  in_use: boolean;
  metrics: MetricsData;
}

export interface TranscriptSuggestion {
  from: string;
  to: string;
  reason: string;
  position?: string;
}

export interface Analysis {
  score: number;
  verdict: 'excellent' | 'good' | 'average' | 'poor';
  reasoning: string;
  video_analysis: string;
  text_recommendations: string;
  transcript_match_quality: 'high' | 'medium' | 'low';
  transcript_suggestions: TranscriptSuggestion[];
  based_on: 'production' | 'test';
  note: string;
}

export interface CreativeAnalytics {
  creative: CreativeInfo;
  data_source: 'production' | 'test' | 'none';
  test: TestData | null;
  production: ProductionData | null;
  analysis: Analysis | null;
  from_cache: boolean;
  cached_at?: string;
}

/**
 * Получить полную аналитику креатива (тест + production + LLM анализ)
 */
export async function getCreativeAnalytics(
  creativeId: string,
  userId: string,
  force: boolean = false
): Promise<CreativeAnalytics> {
  const url = new URL(`${ANALYTICS_API_BASE_URL}/api/analyzer/creative-analytics/${creativeId}`);
  url.searchParams.set('user_id', userId);
  if (force) {
    url.searchParams.set('force', 'true');
  }

  const response = await fetch(url.toString());

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Креатив не найден');
    }
    if (response.status === 400) {
      throw new Error('Неверные параметры запроса');
    }
    throw new Error('Ошибка загрузки аналитики');
  }

  return await response.json();
}

