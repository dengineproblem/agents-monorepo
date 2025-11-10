export type InterestLevel = 'hot' | 'warm' | 'cold';
export type FunnelStage = 'new_lead' | 'not_qualified' | 'qualified' | 'consultation_booked' | 'consultation_completed' | 'deal_closed' | 'deal_lost';
export type MainIntent = 'clinic_lead' | 'ai_targetolog' | 'marketing_analysis' | 'other';
export type Action = 'want_call' | 'want_work' | 'reserve' | 'none';

export interface DialogMessage {
  text: string;
  timestamp: string;
  from_me: boolean;
  is_system?: boolean;
}

export interface DialogAnalysis {
  id: string;
  
  // Идентификация
  instance_name: string;
  user_account_id: string;
  
  // Контакт
  contact_phone: string;
  contact_name: string | null;
  incoming_count: number;
  outgoing_count: number;
  first_message: string | null;
  last_message: string | null;
  
  // Бизнес-профиль
  business_type: string | null;
  is_medical: boolean | null;
  is_owner: boolean | null;
  uses_ads_now: boolean | null;
  has_sales_dept: boolean | null;
  ad_budget: string | null;
  qualification_complete: boolean | null;
  has_booking: boolean | null;
  sent_instagram: boolean | null;
  instagram_url: string | null;
  notes: string | null;
  
  // Анализ
  funnel_stage: FunnelStage | null;
  interest_level: InterestLevel | null;
  main_intent: MainIntent | null;
  objection: string | null;
  next_message: string;
  action: Action | null;
  score: number | null;
  reasoning: string | null;
  
  // Bot control
  assigned_to_human?: boolean;
  bot_paused?: boolean;
  bot_paused_until?: string;
  last_bot_message_at?: string;
  
  // История
  messages: DialogMessage[] | null;
  
  // Метаданные
  analyzed_at: string;
  created_at: string;
  updated_at: string;
}

export interface DialogStats {
  total: number;
  hot: number;
  warm: number;
  cold: number;
  avgScore: number;
  totalMessages: number;
  
  // Funnel stages
  new_lead: number;
  not_qualified: number;
  qualified: number;
  consultation_booked: number;
  consultation_completed: number;
  deal_closed: number;
  deal_lost: number;
  
  // Qualification
  qualified_count: number;
}

export interface DialogFilters {
  interestLevel?: InterestLevel;
  funnelStage?: FunnelStage;
  minScore?: number;
  businessType?: string;
  qualificationComplete?: boolean;
  search?: string;
}


