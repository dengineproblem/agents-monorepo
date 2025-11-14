/**
 * Context Manager
 * 
 * Manages campaign contexts (promos, cases, content, news)
 * and provides utilities for filtering and formatting them.
 */

import { supabase } from './supabase.js';
import { CampaignContext, InterestLevel } from './strategyTypes.js';
import { createLogger } from './logger.js';

const log = createLogger({ module: 'contextManager' });

/**
 * Get active contexts for a user, optionally filtered by funnel stage and interest level
 */
export async function getActiveContexts(
  userAccountId: string,
  funnelStage?: string | null,
  interestLevel?: InterestLevel | null
): Promise<CampaignContext[]> {
  try {
    const now = new Date().toISOString();
    
    // Query active contexts within date range
    const { data, error } = await supabase
      .from('campaign_contexts')
      .select('*')
      .eq('user_account_id', userAccountId)
      .eq('is_active', true)
      .lte('start_date', now)
      .or(`end_date.is.null,end_date.gte.${now}`)
      .order('priority', { ascending: false });
    
    if (error) {
      log.error({ error: error.message, userAccountId }, 'Failed to fetch contexts');
      return [];
    }
    
    if (!data || data.length === 0) {
      log.debug({ userAccountId }, 'No active contexts found');
      return [];
    }
    
    // Filter by target funnel stages and interest levels
    const filtered = data.filter(ctx => {
      // Stage match: context has no target stages OR stage is in target list
      const stageMatch = !ctx.target_funnel_stages || 
        ctx.target_funnel_stages.length === 0 ||
        !funnelStage ||
        ctx.target_funnel_stages.includes(funnelStage);
      
      // Interest match: context has no target levels OR level is in target list
      const interestMatch = !ctx.target_interest_levels ||
        ctx.target_interest_levels.length === 0 ||
        !interestLevel ||
        ctx.target_interest_levels.includes(interestLevel);
      
      return stageMatch && interestMatch;
    });
    
    log.info({ 
      userAccountId,
      totalContexts: data.length,
      filteredContexts: filtered.length,
      funnelStage,
      interestLevel
    }, 'Active contexts fetched and filtered');
    
    return filtered as CampaignContext[];
  } catch (error: any) {
    log.error({ error: error.message, userAccountId }, 'Error fetching active contexts');
    return [];
  }
}

/**
 * Format contexts for prompt inclusion
 */
export function formatContextsForPrompt(contexts: CampaignContext[]): string {
  if (contexts.length === 0) {
    return 'Нет специальных акций или новостей. Не придумывай акцию сам.';
  }
  
  return contexts.map((ctx, i) => `
${i + 1}. Тип: ${ctx.type.toUpperCase()}
   Название: ${ctx.title}
   Детали: ${ctx.content}${ctx.goal ? `
   Цель: ${ctx.goal}` : ''}`
  ).join('\n');
}

/**
 * Increment usage count for a context
 */
export async function incrementContextUsage(contextId: string): Promise<void> {
  try {
    const { error } = await supabase.rpc('increment_context_usage', {
      context_id: contextId
    });
    
    if (error) {
      // Try alternative approach if RPC doesn't exist
      const { data: context } = await supabase
        .from('campaign_contexts')
        .select('usage_count')
        .eq('id', contextId)
        .single();
      
      if (context) {
        await supabase
          .from('campaign_contexts')
          .update({ 
            usage_count: (context.usage_count || 0) + 1,
            updated_at: new Date().toISOString()
          })
          .eq('id', contextId);
      }
    }
    
    log.debug({ contextId }, 'Context usage incremented');
  } catch (error: any) {
    log.error({ error: error.message, contextId }, 'Failed to increment context usage');
  }
}

/**
 * Get context by ID
 */
export async function getContextById(contextId: string): Promise<CampaignContext | null> {
  try {
    const { data, error } = await supabase
      .from('campaign_contexts')
      .select('*')
      .eq('id', contextId)
      .single();
    
    if (error) {
      log.error({ error: error.message, contextId }, 'Failed to fetch context by ID');
      return null;
    }
    
    return data as CampaignContext;
  } catch (error: any) {
    log.error({ error: error.message, contextId }, 'Error fetching context by ID');
    return null;
  }
}

