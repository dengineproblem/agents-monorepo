/**
 * Strategy Types for Campaign Message Generation
 * 
 * Defines the strategic types of messages and related data structures
 * for the enhanced campaign message generation system.
 */

export type StrategyType = 'check_in' | 'value' | 'case' | 'offer' | 'direct_selling';
export type InterestLevel = 'hot' | 'warm' | 'cold';
export type MessageType = 'selling' | 'useful' | 'reminder';

/**
 * Strategy mapping: funnel_stage -> interest_level -> array of strategy types
 */
export interface StrategyMapping {
  [stage: string]: {
    [interest in InterestLevel]: StrategyType[];
  };
}

/**
 * Campaign context (promo, case, content, news)
 */
export interface CampaignContext {
  id: string;
  user_account_id: string;
  type: 'promo' | 'case' | 'content' | 'news';
  title: string;
  content: string;
  goal?: string;
  start_date: string;
  end_date?: string;
  target_funnel_stages?: string[];
  target_interest_levels?: InterestLevel[];
  priority: number;
  is_active: boolean;
  usage_count: number;
  created_at?: string;
  updated_at?: string;
}

/**
 * Input for strategy selection
 */
export interface StrategySelectionInput {
  lead: {
    id: string;
    funnel_stage: string | null;
    interest_level: InterestLevel | null;
    campaign_messages_count: number;
  };
  lastMessageTypes: StrategyType[];
  activeContexts: CampaignContext[];
}

/**
 * Result of strategy determination
 */
export interface StrategyResult {
  strategyType: StrategyType;
  messageType: MessageType;
  selectedContext?: CampaignContext;
}

