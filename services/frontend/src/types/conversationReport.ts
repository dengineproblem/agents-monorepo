export interface RejectionReason {
  reason: string;
  count: number;
}

export interface CommonObjection {
  objection: string;
  count: number;
  suggested_response?: string;
}

// Метрики для одного направления
export interface DirectionReportData {
  direction_id: string;
  direction_name: string;
  total_dialogs: number;
  new_dialogs: number;
  capi_enabled: boolean;
  capi_has_data: boolean;
  capi_distribution: {
    interest: number;
    qualified: number;
    scheduled: number;
  };
  interest_distribution: {
    hot: number;
    warm: number;
    cold: number;
  };
  incoming_messages: number;
  outgoing_messages: number;
  avg_response_time_minutes: number | null;
  funnel_distribution: Record<string, number>;
  drop_points: Array<{ point: string; count: number }>;
  hidden_objections: Array<{ type: string; count: number }>;
  engagement_trends: { falling: number; stable: number; rising: number };
}

export interface ConversationReport {
  id: string;
  user_account_id: string;
  telegram_id: string | null;
  report_date: string;
  period_start: string;
  period_end: string;

  // Основные метрики
  total_dialogs: number;
  new_dialogs: number;
  active_dialogs: number;

  // Конверсии
  conversions: Record<string, number>;

  // Распределение
  interest_distribution: {
    hot: number;
    warm: number;
    cold: number;
  };
  funnel_distribution: Record<string, number>;

  // Скорость ответов
  avg_response_time_minutes: number | null;
  min_response_time_minutes: number | null;
  max_response_time_minutes: number | null;

  // Сообщения
  total_incoming_messages: number;
  total_outgoing_messages: number;

  // Аналитика от LLM
  insights: string[];
  rejection_reasons: RejectionReason[];
  common_objections: CommonObjection[];
  recommendations: string[];

  // Текст отчёта
  report_text: string;

  // CAPI интеграция (Meta Pixel) - legacy для обратной совместимости
  capi_distribution?: {
    interest: number;
    qualified: number;
    scheduled: number;
  };
  capi_source_used: boolean;
  capi_has_data: boolean;
  capi_direction_id: string | null;

  // Метрики по направлениям (новое)
  directions_data?: DirectionReportData[];

  // Метаданные
  generated_at: string;
  sent_to_telegram: boolean;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationReportStats {
  period_days: number;
  reports_count: number;
  total_dialogs: number;
  total_new_dialogs: number;
  total_active_dialogs: number;
  total_incoming_messages: number;
  total_outgoing_messages: number;
  avg_response_time: number | null;
  interest_trends: {
    hot: number[];
    warm: number[];
    cold: number[];
  };
  dates: string[];
}
