export type InterestLevel = 'hot' | 'warm' | 'cold';
export type FunnelStage = 'new_lead' | 'not_qualified' | 'qualified' | 'consultation_booked' | 'consultation_completed' | 'deal_closed' | 'deal_lost';
export type MainIntent = 'purchase' | 'inquiry' | 'support' | 'consultation' | 'other';
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
  
  // Гибкие теги от LLM
  lead_tags: string[] | null;
  
  // Бизнес-профиль
  business_type: string | null;
  is_owner: boolean | null;
  qualification_complete: boolean | null;
  notes: string | null;
  
  // Гибкие поля для специфичных данных
  custom_fields: Record<string, any> | null;
  
  // Анализ
  funnel_stage: FunnelStage | null;
  interest_level: InterestLevel | null;
  main_intent: MainIntent | null;
  objection: string | null;
  next_message: string;
  action: Action | null;
  score: number | null;
  reasoning: string | null;
  
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

