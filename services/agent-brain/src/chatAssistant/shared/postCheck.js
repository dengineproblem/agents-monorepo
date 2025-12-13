/**
 * Post-Check Verification for WRITE Operations
 *
 * After executing a write operation (pause, update budget, etc.),
 * verify the change was actually applied by re-fetching the entity.
 */

import { fbGraph } from './fbGraph.js';
import { supabase } from '../../lib/supabaseClient.js';
import { logger } from '../../lib/logger.js';

// Max delay for eventual consistency (Facebook API can have lag)
const MAX_VERIFICATION_DELAY_MS = 3000;
const VERIFICATION_RETRIES = 2;

/**
 * Sleep utility
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Verify Facebook campaign status change
 */
export async function verifyCampaignStatus(campaignId, expectedStatus, accessToken) {
  for (let attempt = 0; attempt < VERIFICATION_RETRIES; attempt++) {
    try {
      const result = await fbGraph('GET', campaignId, accessToken, {
        fields: 'id,status,effective_status'
      }, { skipCircuitBreaker: true });

      const actualStatus = result.status;
      const effectiveStatus = result.effective_status;

      const isVerified = actualStatus === expectedStatus ||
                        effectiveStatus === expectedStatus;

      if (isVerified) {
        return {
          verified: true,
          before: null,  // Caller should track this
          after: actualStatus,
          effectiveStatus
        };
      }

      // Not matched yet, wait and retry
      if (attempt < VERIFICATION_RETRIES - 1) {
        await sleep(1000);
      }
    } catch (error) {
      logger.warn({
        campaignId,
        attempt: attempt + 1,
        error: error.message
      }, 'Post-check verification failed');
    }
  }

  return {
    verified: false,
    after: null,
    warning: 'Не удалось подтвердить изменение статуса. Возможна задержка на стороне Facebook.'
  };
}

/**
 * Verify Facebook adset status change
 */
export async function verifyAdSetStatus(adsetId, expectedStatus, accessToken) {
  for (let attempt = 0; attempt < VERIFICATION_RETRIES; attempt++) {
    try {
      const result = await fbGraph('GET', adsetId, accessToken, {
        fields: 'id,status,effective_status'
      }, { skipCircuitBreaker: true });

      const actualStatus = result.status;
      const effectiveStatus = result.effective_status;

      const isVerified = actualStatus === expectedStatus ||
                        effectiveStatus === expectedStatus;

      if (isVerified) {
        return {
          verified: true,
          before: null,
          after: actualStatus,
          effectiveStatus
        };
      }

      if (attempt < VERIFICATION_RETRIES - 1) {
        await sleep(1000);
      }
    } catch (error) {
      logger.warn({
        adsetId,
        attempt: attempt + 1,
        error: error.message
      }, 'Post-check verification failed for adset');
    }
  }

  return {
    verified: false,
    after: null,
    warning: 'Не удалось подтвердить изменение статуса адсета.'
  };
}

/**
 * Verify Facebook adset budget change
 */
export async function verifyAdSetBudget(adsetId, expectedBudgetCents, accessToken) {
  for (let attempt = 0; attempt < VERIFICATION_RETRIES; attempt++) {
    try {
      const result = await fbGraph('GET', adsetId, accessToken, {
        fields: 'id,daily_budget,lifetime_budget'
      }, { skipCircuitBreaker: true });

      const actualBudget = parseInt(result.daily_budget || 0);

      // Allow 1% tolerance for rounding
      const tolerance = expectedBudgetCents * 0.01;
      const isVerified = Math.abs(actualBudget - expectedBudgetCents) <= tolerance;

      if (isVerified) {
        return {
          verified: true,
          before: null,
          after: actualBudget,
          expected: expectedBudgetCents
        };
      }

      if (attempt < VERIFICATION_RETRIES - 1) {
        await sleep(1000);
      }
    } catch (error) {
      logger.warn({
        adsetId,
        attempt: attempt + 1,
        error: error.message
      }, 'Post-check verification failed for budget');
    }
  }

  return {
    verified: false,
    after: null,
    expected: expectedBudgetCents,
    warning: 'Не удалось подтвердить изменение бюджета.'
  };
}

/**
 * Verify Facebook ad status change
 */
export async function verifyAdStatus(adId, expectedStatus, accessToken) {
  for (let attempt = 0; attempt < VERIFICATION_RETRIES; attempt++) {
    try {
      const result = await fbGraph('GET', adId, accessToken, {
        fields: 'id,status,effective_status'
      }, { skipCircuitBreaker: true });

      const actualStatus = result.status;
      const isVerified = actualStatus === expectedStatus;

      if (isVerified) {
        return {
          verified: true,
          after: actualStatus
        };
      }

      if (attempt < VERIFICATION_RETRIES - 1) {
        await sleep(1000);
      }
    } catch (error) {
      logger.warn({
        adId,
        attempt: attempt + 1,
        error: error.message
      }, 'Post-check verification failed for ad');
    }
  }

  return {
    verified: false,
    after: null,
    warning: 'Не удалось подтвердить изменение статуса объявления.'
  };
}

/**
 * Verify Supabase direction status change
 */
export async function verifyDirectionStatus(directionId, expectedStatus) {
  try {
    const { data, error } = await supabase
      .from('directions')
      .select('id, status')
      .eq('id', directionId)
      .single();

    if (error) {
      return {
        verified: false,
        warning: `Ошибка проверки: ${error.message}`
      };
    }

    const isVerified = data.status === expectedStatus;

    return {
      verified: isVerified,
      after: data.status,
      expected: expectedStatus
    };
  } catch (error) {
    return {
      verified: false,
      warning: error.message
    };
  }
}

/**
 * Verify Supabase direction budget change
 */
export async function verifyDirectionBudget(directionId, expectedBudget) {
  try {
    const { data, error } = await supabase
      .from('directions')
      .select('id, budget_per_day')
      .eq('id', directionId)
      .single();

    if (error) {
      return {
        verified: false,
        warning: `Ошибка проверки: ${error.message}`
      };
    }

    const isVerified = parseFloat(data.budget_per_day) === parseFloat(expectedBudget);

    return {
      verified: isVerified,
      after: data.budget_per_day,
      expected: expectedBudget
    };
  } catch (error) {
    return {
      verified: false,
      warning: error.message
    };
  }
}

/**
 * Create a post-check wrapper for any write operation
 *
 * @param {Function} writeFn - The write function to execute
 * @param {Function} verifyFn - Verification function to call after write
 * @param {Object} options - { logContext }
 */
export async function withPostCheck(writeFn, verifyFn, options = {}) {
  const { logContext = {} } = options;

  // Execute write
  const writeResult = await writeFn();

  if (!writeResult.success) {
    return writeResult;
  }

  // Wait a bit for eventual consistency
  await sleep(500);

  // Verify
  const verification = await verifyFn();

  // Log verification result
  logger.info({
    ...logContext,
    writeSuccess: writeResult.success,
    verified: verification.verified,
    after: verification.after
  }, 'Post-check verification completed');

  // Merge verification into result
  return {
    ...writeResult,
    verification: {
      verified: verification.verified,
      after: verification.after,
      warning: verification.warning
    }
  };
}

export default {
  verifyCampaignStatus,
  verifyAdSetStatus,
  verifyAdSetBudget,
  verifyAdStatus,
  verifyDirectionStatus,
  verifyDirectionBudget,
  withPostCheck
};
