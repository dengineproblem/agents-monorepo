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
 * Get interval based on interest level
 */
function getIntervalForLead(interestLevel: string | null, settings: CampaignSettings): number {
  if (interestLevel === 'hot') return settings.hot_interval_days;
  if (interestLevel === 'warm') return settings.warm_interval_days;
  return settings.cold_interval_days;
}

/**
 * Calculate time coefficient based on how long since last campaign message
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
  
  // Exponential growth: 1.0 at exactly interval, 1.5 at 2x, 2.0 at 3x, etc
  // But cap at 3.0 to avoid too high scores
  const coeff = Math.min(1.0 + (intervalsPassed - 1) * 0.5, 3.0);
  
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

  return Math.max(coeff, 0.1); // Never less than 0.1
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

    // Note: Queue generation is independent of autopilot_enabled
    // Autopilot only controls automatic sending via worker
    // User can still manually generate queue and send messages

    // 2. Get all leads with autopilot enabled
    const { data: leads, error } = await supabase
      .from('dialog_analysis')
      .select('*')
      .eq('user_account_id', userAccountId)
      .eq('autopilot_enabled', true)
      .neq('funnel_stage', 'deal_closed') // Skip closed deals
      .neq('funnel_stage', 'deal_lost'); // Skip lost deals

    if (error) {
      throw error;
    }

    if (!leads || leads.length === 0) {
      log.info({ userAccountId }, 'No eligible leads for campaign');
      return [];
    }

    log.info({ userAccountId, totalLeads: leads.length }, 'Processing leads for scoring');

    // 3. Calculate reactivation score for each lead
    const scoredLeads: ScoredLead[] = leads.map((lead: Lead) => {
      const baseScore = lead.score || 0;
      
      // Time coefficient
      const daysSinceLastCampaign = calculateDaysSince(lead.last_campaign_message_at);
      const timeCoeff = calculateTimeCoefficient(
        lead.interest_level,
        daysSinceLastCampaign,
        settings
      );
      
      // If not ready (timeCoeff = 0), skip this lead
      if (timeCoeff === 0) {
        return {
          ...lead,
          reactivationScore: 0
        };
      }

      // Activity coefficient
      const activityCoeff = calculateActivityCoefficient(lead);
      
      // AI prediction coefficient (for now, just 1.0 - can be enhanced later)
      const conversionProbability = 1.0;
      
      // Final reactivation score
      const reactivationScore = baseScore * timeCoeff * activityCoeff * conversionProbability;
      
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

