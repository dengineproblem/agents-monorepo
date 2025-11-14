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
 * Boost strategy based on active contexts
 * If there's a high-priority context, prefer the matching strategy
 */
function boostStrategyForContext(
  strategy: StrategyType,
  contexts: any[]
): { strategy: StrategyType; context?: any } {
  if (contexts.length === 0) {
    return { strategy };
  }
  
  // Sort by priority (highest first)
  const sortedContexts = [...contexts].sort((a, b) => b.priority - a.priority);
  const topContext = sortedContexts[0];
  
  // Map context type to strategy type
  const contextStrategyMap: Record<string, StrategyType> = {
    promo: 'offer',
    case: 'case',
    content: 'value',
    news: 'value'
  };
  
  const boostedStrategy = contextStrategyMap[topContext.type] || strategy;
  
  log.info({ 
    originalStrategy: strategy, 
    boostedStrategy, 
    contextType: topContext.type,
    contextTitle: topContext.title
  }, 'Strategy boosted by active context');
  
  return { 
    strategy: boostedStrategy, 
    context: topContext 
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
    
    // Boost strategy if there's an active context
    let selectedContext;
    if (input.activeContexts.length > 0) {
      const result = boostStrategyForContext(strategyType, input.activeContexts);
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

