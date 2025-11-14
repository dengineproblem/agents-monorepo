import { supabase } from './supabase.js';
import { createLogger } from './logger.js';

const log = createLogger({ module: 'campaignScoringAgent' });

interface Lead {
  id: string;
  user_account_id: string;
  instance_name: string;
  contact_phone: string;
  contact_name: string | null;
  score: number | null;
  interest_level: 'hot' | 'warm' | 'cold' | null;
  funnel_stage: string | null;
  is_on_key_stage?: boolean;
  key_stage_entered_at?: string | null;
  key_stage_left_at?: string | null;
  funnel_stage_history?: any;
  last_campaign_message_at: string | null;
  campaign_messages_count: number;
  incoming_count: number;
  outgoing_count: number;
  last_message: string | null;
  first_message: string | null;
  autopilot_enabled: boolean;
  messages: any[] | null;
  business_type: string | null;
  is_medical: boolean | null;
  audio_transcripts: any[] | null;
  manual_notes: string | null;
}

interface CampaignSettings {
  autopilot_enabled: boolean;
  daily_message_limit: number;
  hot_interval_days: number;
  warm_interval_days: number;
  cold_interval_days: number;
  work_hours_start: number;
  work_hours_end: number;
  work_days: number[];
  key_stage_cooldown_days: number;
  stage_interval_multipliers?: Record<string, number>;
  fatigue_thresholds?: Record<string, number>;
}

interface ScoredLead extends Lead {
  reactivationScore: number;
}

/**
 * Get campaign settings for a user
 */
async function getCampaignSettings(userAccountId: string): Promise<CampaignSettings> {
  const { data, error } = await supabase
    .from('campaign_settings')
    .select('*')
    .eq('user_account_id', userAccountId)
    .maybeSingle();

  if (error) {
    log.error({ error: error.message, userAccountId }, 'Failed to fetch campaign settings');
    throw error;
  }

  // Return defaults if not found
  if (!data) {
    return {
      autopilot_enabled: false,
      daily_message_limit: 300,
      hot_interval_days: 2,
      warm_interval_days: 5,
      cold_interval_days: 10,
      work_hours_start: 10,
      work_hours_end: 20,
      work_days: [1, 2, 3, 4, 5], // Monday-Friday
      key_stage_cooldown_days: 7,
      stage_interval_multipliers: {},
      fatigue_thresholds: {},
    };
  }

  return data;
}

/**
 * Calculate days since a date
 */
function calculateDaysSince(date: string | null): number {
  if (!date) {
    return 999; // Very large number if never sent
  }

  const now = new Date();
  const past = new Date(date);
  const diffTime = Math.abs(now.getTime() - past.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays;
}

/**
 * Get key funnel stages from business profile
 */
async function getKeyFunnelStages(userAccountId: string): Promise<string[]> {
  const { data } = await supabase
    .from('business_profile')
    .select('key_funnel_stages')
    .eq('user_account_id', userAccountId)
    .maybeSingle();
  
  return data?.key_funnel_stages || [];
}

/**
 * Check if lead should be blocked from campaign queue
 */
function isLeadBlocked(
  lead: Lead,
  keyStages: string[],
  cooldownDays: number = 7
): boolean {
  // 1. Hard-blocked stages
  const ALWAYS_SKIP = ['deal_closed', 'deal_lost'];
  if (lead.funnel_stage && ALWAYS_SKIP.includes(lead.funnel_stage)) {
    return true;
  }
  
  // 2. Currently on key stage
  if (lead.is_on_key_stage === true) {
    return true;
  }
  
  // 3. Recently left key stage (< cooldown days)
  if (lead.key_stage_left_at) {
    const daysSinceLeft = calculateDaysSince(lead.key_stage_left_at);
    if (daysSinceLeft < cooldownDays) {
      return true;
    }
  }
  
  return false;
}

/**
 * Get touch interval days based on lead characteristics
 */
function getTouchIntervalDays(
  lead: Lead,
  settings: CampaignSettings
): number {
  const interest = lead.interest_level ?? 'cold';
  
  // Base interval by interest
  const baseByInterest = {
    hot: settings.hot_interval_days || 2,
    warm: settings.warm_interval_days || 5,
    cold: settings.cold_interval_days || 10,
  };
  let interval = baseByInterest[interest] ?? 10;
  
  // Stage multiplier
  const stageMultipliers = settings.stage_interval_multipliers || {
    'new_lead': 0.7,
    'first_contact': 1.0,
    'thinking': 1.2,
    'no_show': 0.8,
    'price_objection': 1.2,
  };
  
  const multiplier = lead.funnel_stage ? (stageMultipliers[lead.funnel_stage] || 1.0) : 1.0;
  interval = interval * multiplier;
  
  return Math.round(interval);
}

/**
 * Get interval based on interest level (deprecated, kept for compatibility)
 */
function getIntervalForLead(interestLevel: string | null, settings: CampaignSettings): number {
  if (interestLevel === 'hot') return settings.hot_interval_days;
  if (interestLevel === 'warm') return settings.warm_interval_days;
  return settings.cold_interval_days;
}

/**
 * Calculate time readiness coefficient
 * Considers both campaign messages and regular messages
 */
function calculateTimeReadinessCoefficient(
  lead: Lead,
  settings: CampaignSettings
): number {
  const interval = getTouchIntervalDays(lead, settings);
  
  // Take minimum of last campaign and last message (any touch counts)
  const daysSinceLastCampaign = calculateDaysSince(lead.last_campaign_message_at);
  const daysSinceLastMessage = calculateDaysSince(lead.last_message);
  const daysSinceLastTouch = Math.min(daysSinceLastCampaign, daysSinceLastMessage);
  
  if (daysSinceLastTouch === Infinity) return 1.0; // Never contacted
  
  const threshold = interval * 0.7;
  if (daysSinceLastTouch < threshold) return 0; // Too early
  
  const ratio = daysSinceLastTouch / interval;
  
  if (ratio < 1.0) {
    // Between 70% and 100% of interval
    const progress = (ratio - 0.7) / 0.3;
    return 0.5 + progress * 0.5;
  }
  
  // After interval - grows but capped
  return Math.min(1.0 + (ratio - 1) * 0.4, 1.5);
}

/**
 * Calculate time coefficient based on how long since last campaign message (deprecated)
 * The longer the wait since required interval, the higher the coefficient
 * SOFTENED: Includes leads that have reached 70%+ of required interval
 */
function calculateTimeCoefficient(
  interestLevel: string | null,
  daysSinceLastCampaign: number,
  settings: CampaignSettings
): number {
  const requiredInterval = getIntervalForLead(interestLevel, settings);
  
  // Softened criteria: include leads at 70%+ of required interval
  const threshold = requiredInterval * 0.7;
  
  if (daysSinceLastCampaign < threshold) {
    // Not ready yet - too early
    return 0;
  }

  // Calculate how many intervals have passed
  const intervalsPassed = daysSinceLastCampaign / requiredInterval;
  
  // If between 70%-100% of interval, use partial coefficient (0.5-1.0)
  if (intervalsPassed < 1.0) {
    // Linear interpolation from 0.5 to 1.0
    const progress = (intervalsPassed - 0.7) / 0.3; // 0 to 1 in range [0.7, 1.0]
    return 0.5 + progress * 0.5;
  }
  
  // Exponential growth: 1.0 at exactly interval, 1.25 at 2x, etc
  // But cap at 1.5 to keep scores reasonable
  const coeff = Math.min(1.0 + (intervalsPassed - 1) * 0.5, 1.5);
  
  return coeff;
}

/**
 * Calculate activity coefficient based on message frequency and engagement
 */
function calculateActivityCoefficient(lead: Lead): number {
  // Base coefficient
  let coeff = 1.0;

  // More incoming messages = more engaged client
  const totalMessages = lead.incoming_count + lead.outgoing_count;
  if (totalMessages > 0) {
    const incomingRatio = lead.incoming_count / totalMessages;
    
    // Reward high incoming ratio (client is responsive)
    if (incomingRatio > 0.6) {
      coeff += 0.3;
    } else if (incomingRatio > 0.4) {
      coeff += 0.1;
    }
  }

  // Dialog length (more messages = more engaged)
  if (totalMessages > 20) {
    coeff += 0.2;
  } else if (totalMessages > 10) {
    coeff += 0.1;
  }

  // Recency of last message
  const daysSinceLastMessage = calculateDaysSince(lead.last_message);
  if (daysSinceLastMessage < 7) {
    // Very recent conversation
    coeff += 0.2;
  } else if (daysSinceLastMessage < 14) {
    coeff += 0.1;
  } else if (daysSinceLastMessage > 90) {
    // Very old, reduce priority
    coeff -= 0.2;
  }

  // Cap at 1.2 to keep reactivation scores reasonable
  return Math.min(Math.max(coeff, 0.1), 1.2);
}

/**
 * Calculate stage coefficient based on funnel stage
 */
function calculateStageCoefficient(stage: string | null): number {
  if (!stage) return 1.0;
  
  const stageMapping: Record<string, number> = {
    'new_lead': 1.2,
    'first_contact': 1.1,
    'no_show': 1.3,
    'thinking': 0.9,
    'price_objection': 1.0,
    'not_qualified': 0.8,
  };
  
  return stageMapping[stage] ?? 1.0;
}

/**
 * Calculate fatigue coefficient based on campaign message count
 */
function calculateFatigueCoefficient(lead: Lead): number {
  const sentCount = lead.campaign_messages_count ?? 0;
  
  if (sentCount === 0) return 1.0;
  if (sentCount <= 3) return 0.95;
  if (sentCount <= 6) return 0.85;
  if (sentCount <= 10) return 0.7;
  
  return 0.5; // Heavily spammed
}

/**
 * Generate daily campaign queue
 * Returns top N leads sorted by reactivation score
 */
export async function generateDailyCampaignQueue(
  userAccountId: string
): Promise<ScoredLead[]> {
  try {
    log.info({ userAccountId }, 'Generating daily campaign queue');

    // 1. Get campaign settings
    const settings = await getCampaignSettings(userAccountId);
    const keyStages = await getKeyFunnelStages(userAccountId);

    // 2. Get all leads with autopilot enabled
    const { data: leads, error } = await supabase
      .from('dialog_analysis')
      .select('*')
      .eq('user_account_id', userAccountId)
      .eq('autopilot_enabled', true);

    if (error) {
      throw error;
    }

    if (!leads || leads.length === 0) {
      log.info({ userAccountId }, 'No eligible leads for campaign');
      return [];
    }

    log.info({ 
      userAccountId, 
      totalLeads: leads.length,
      keyStagesCount: keyStages.length 
    }, 'Processing leads for scoring');

    // 3. Calculate reactivation score for each lead
    const scoredLeads: ScoredLead[] = leads.map((lead: Lead) => {
      // Hard filter: blocked leads
      if (isLeadBlocked(lead, keyStages, settings.key_stage_cooldown_days)) {
        return {
          ...lead,
          reactivationScore: 0
        };
      }
      
      const baseScore = lead.score || 0;
      
      // Time readiness coefficient
      const timeCoeff = calculateTimeReadinessCoefficient(lead, settings);
      
      // If not ready (timeCoeff = 0), skip this lead
      if (timeCoeff === 0) {
        return {
          ...lead,
          reactivationScore: 0
        };
      }

      // Activity coefficient
      const activityCoeff = calculateActivityCoefficient(lead);
      
      // Stage coefficient
      const stageCoeff = calculateStageCoefficient(lead.funnel_stage);
      
      // Fatigue coefficient
      const fatigueCoeff = calculateFatigueCoefficient(lead);
      
      // Final reactivation score
      const reactivationScore = baseScore * timeCoeff * activityCoeff * stageCoeff * fatigueCoeff;
      
      return {
        ...lead,
        reactivationScore
      };
    });

    // 4. Filter: only leads ready for messaging
    // Use minimum threshold: base score * 0.3 to include more leads
    const eligibleLeads = scoredLeads.filter(lead => {
      if (lead.reactivationScore === 0) return false;
      const baseScore = lead.score || 0;
      const minThreshold = baseScore * 0.3;
      return lead.reactivationScore >= minThreshold;
    });

    log.info({ 
      userAccountId, 
      eligible: eligibleLeads.length, 
      total: scoredLeads.length 
    }, 'Leads filtered by eligibility');

    // 5. Sort by reactivation score (highest first)
    eligibleLeads.sort((a, b) => b.reactivationScore - a.reactivationScore);

    // 6. Take top N (daily message limit)
    const topLeads = eligibleLeads.slice(0, settings.daily_message_limit);

    // 7. Update reactivation_score in database for top leads
    for (const lead of topLeads) {
      await supabase
        .from('dialog_analysis')
        .update({ 
          reactivation_score: lead.reactivationScore 
        })
        .eq('id', lead.id);
    }

    log.info({ 
      userAccountId, 
      queueSize: topLeads.length,
      topScore: topLeads[0]?.reactivationScore,
      avgScore: topLeads.reduce((sum, l) => sum + l.reactivationScore, 0) / topLeads.length
    }, 'Daily campaign queue generated');

    return topLeads;
  } catch (error: any) {
    log.error({ error: error.message, userAccountId }, 'Failed to generate campaign queue');
    throw error;
  }
}

/**
 * Get top N leads for preview (without full generation)
 */
export async function previewCampaignQueue(
  userAccountId: string,
  limit: number = 50
): Promise<ScoredLead[]> {
  try {
    const settings = await getCampaignSettings(userAccountId);

    const { data: leads, error } = await supabase
      .from('dialog_analysis')
      .select('*')
      .eq('user_account_id', userAccountId)
      .eq('autopilot_enabled', true)
      .neq('funnel_stage', 'deal_closed')
      .neq('funnel_stage', 'deal_lost')
      .limit(500); // Get more to have options

    if (error) throw error;
    if (!leads) return [];

    // Score leads
    const scoredLeads: ScoredLead[] = leads.map((lead: Lead) => {
      const baseScore = lead.score || 0;
      const daysSinceLastCampaign = calculateDaysSince(lead.last_campaign_message_at);
      const timeCoeff = calculateTimeCoefficient(lead.interest_level, daysSinceLastCampaign, settings);
      const activityCoeff = calculateActivityCoefficient(lead);
      const reactivationScore = baseScore * timeCoeff * activityCoeff;
      
      return { ...lead, reactivationScore };
    });

    // Filter and sort (using same softened criteria as main function)
    const eligible = scoredLeads
      .filter(l => {
        if (l.reactivationScore === 0) return false;
        const baseScore = l.score || 0;
        const minThreshold = baseScore * 0.3;
        return l.reactivationScore >= minThreshold;
      })
      .sort((a, b) => b.reactivationScore - a.reactivationScore);

    return eligible.slice(0, limit);
  } catch (error: any) {
    log.error({ error: error.message }, 'Failed to preview campaign queue');
    throw error;
  }
}

