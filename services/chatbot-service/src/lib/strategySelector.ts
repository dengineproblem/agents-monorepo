/**
 * Strategy Selector
 * 
 * Determines the best strategy type for a lead based on:
 * - Funnel stage
 * - Interest level
 * - Previous message history
 * - Active contexts (promos, cases, etc.)
 */

import { StrategyType, StrategySelectionInput, StrategyMapping, MessageType, StrategyResult } from './strategyTypes.js';
import { defaultStrategyMatrix, strategyToTemplateType } from './defaultStrategyMatrix.js';
import { supabase } from './supabase.js';
import { createLogger } from './logger.js';

const log = createLogger({ module: 'strategySelector' });

/**
 * Get strategy matrix for user (custom or default)
 */
async function getStrategyMatrix(userAccountId: string): Promise<StrategyMapping> {
  try {
    const { data, error } = await supabase
      .from('campaign_strategy_overrides')
      .select('matrix_json')
      .eq('user_account_id', userAccountId)
      .maybeSingle();
    
    if (error) {
      log.warn({ error: error.message, userAccountId }, 'Failed to fetch strategy overrides, using default');
      return defaultStrategyMatrix;
    }
    
    if (data?.matrix_json) {
      // TODO: добавить валидацию через zod
      log.info({ userAccountId }, 'Using custom strategy matrix');
      return data.matrix_json as StrategyMapping;
    }
    
    return defaultStrategyMatrix;
  } catch (error: any) {
    log.error({ error: error.message, userAccountId }, 'Error fetching strategy matrix');
    return defaultStrategyMatrix;
  }
}

/**
 * Select strategy from matrix based on stage and interest level
 * Avoids repeating the same strategy more than 2 times in a row
 */
function selectStrategyFromMatrix(
  matrix: StrategyMapping,
  stage: string,
  interest: string,
  lastTypes: StrategyType[]
): StrategyType {
  // Normalize stage key
  const stageKey = stage || 'new_lead';
  const interestKey = (interest || 'cold') as 'hot' | 'warm' | 'cold';
  
  // Get strategies for this stage+interest combination
  let strategies = matrix[stageKey]?.[interestKey];
  
  // Fallback to 'default' if stage not found
  if (!strategies) {
    log.warn({ stage: stageKey, interest: interestKey }, 'Stage not found in matrix, using default');
    strategies = matrix['default']?.[interestKey] || ['check_in'];
  }
  
  // Avoid repeating the same type more than 2 times in a row
  const lastTwo = lastTypes.slice(0, 2);
  const availableStrategies = strategies.filter(s => {
    const count = lastTwo.filter(t => t === s).length;
    return count < 2;
  });
  
  // Return first available, or fallback to first strategy
  const selected = availableStrategies[0] || strategies[0] || 'check_in';
  
  log.debug({ 
    stage: stageKey, 
    interest: interestKey, 
    lastTwo, 
    selected, 
    availableCount: availableStrategies.length 
  }, 'Strategy selected from matrix');
  
  return selected;
}

/**
 * Determine if context should be used based on strategy and lead state
 */
function shouldUseContext(
  strategy: StrategyType,
  lead: { interest_level?: string | null; campaign_messages_count: number }
): boolean {
  // check_in strategy: no context (just checking in)
  if (strategy === 'check_in') {
    return false;
  }
  
  // First message to lead: be careful with aggressive context
  if (lead.campaign_messages_count === 0) {
    // For first message, only use context if lead is warm/hot
    if (lead.interest_level === 'cold') {
      return false;
    }
  }
  
  // For other strategies, context is welcome
  return true;
}

/**
 * Select best context for the lead and strategy
 * Returns null if no context should be used
 */
function selectContextForLead(
  strategy: StrategyType,
  contexts: any[],
  lead: { interest_level?: string | null; campaign_messages_count: number }
): { strategy: StrategyType; context?: any } {
  if (contexts.length === 0) {
    return { strategy };
  }
  
  // Check if context should be used at all
  if (!shouldUseContext(strategy, lead)) {
    log.info({ 
      strategy, 
      interestLevel: lead.interest_level,
      campaignCount: lead.campaign_messages_count
    }, 'Context skipped - not appropriate for this strategy/lead');
    return { strategy };
  }
  
  // Sort by priority (highest first)
  const sortedContexts = [...contexts].sort((a, b) => b.priority - a.priority);
  
  // Map context type to strategy type
  const contextStrategyMap: Record<string, StrategyType> = {
    promo: 'offer',
    case: 'case',
    content: 'value',
    news: 'value'
  };
  
  // Try to find context that matches current strategy
  let selectedContext = sortedContexts.find(ctx => 
    contextStrategyMap[ctx.type] === strategy
  );
  
  // If no match, take highest priority context and adjust strategy
  if (!selectedContext) {
    selectedContext = sortedContexts[0];
    const newStrategy = contextStrategyMap[selectedContext.type] || strategy;
    
    log.info({ 
      originalStrategy: strategy, 
      newStrategy, 
      contextType: selectedContext.type,
      contextTitle: selectedContext.title
    }, 'Strategy adjusted to match available context');
    
    return { 
      strategy: newStrategy, 
      context: selectedContext 
    };
  }
  
  log.info({ 
    strategy, 
    contextType: selectedContext.type,
    contextTitle: selectedContext.title
  }, 'Context selected matching strategy');
  
  return { 
    strategy, 
    context: selectedContext 
  };
}

/**
 * Main function: determine strategy type for a lead
 */
export async function determineStrategyType(
  input: StrategySelectionInput,
  userAccountId: string
): Promise<StrategyResult> {
  try {
    log.info({ 
      leadId: input.lead.id,
      stage: input.lead.funnel_stage,
      interest: input.lead.interest_level,
      activeContextsCount: input.activeContexts.length
    }, 'Determining strategy type');
    
    // Get strategy matrix (custom or default)
    const matrix = await getStrategyMatrix(userAccountId);
    
    // Select base strategy from matrix
    let strategyType = selectStrategyFromMatrix(
      matrix,
      input.lead.funnel_stage || 'new_lead',
      input.lead.interest_level || 'cold',
      input.lastMessageTypes
    );
    
    // Select context if appropriate for this lead and strategy
    let selectedContext;
    if (input.activeContexts.length > 0) {
      const result = selectContextForLead(strategyType, input.activeContexts, input.lead);
      strategyType = result.strategy;
      selectedContext = result.context;
    }
    
    // Map to template type for backward compatibility
    const messageType = strategyToTemplateType[strategyType];
    
    log.info({ 
      leadId: input.lead.id, 
      strategyType, 
      messageType,
      contextUsed: !!selectedContext
    }, 'Strategy determined successfully');
    
    return { 
      strategyType, 
      messageType,
      selectedContext
    };
  } catch (error: any) {
    log.error({ error: error.message, leadId: input.lead.id }, 'Failed to determine strategy');
    
    // Fallback to safe defaults
    return {
      strategyType: 'check_in',
      messageType: 'reminder'
    };
  }
}

