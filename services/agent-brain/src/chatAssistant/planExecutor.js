/**
 * PlanExecutor - Executes approved plans (for Web and Telegram)
 * Unified executor for all plan steps with idempotency support
 */

import { unifiedStore } from './stores/unifiedStore.js';
import { executeTool } from './toolHandlers.js';
import { supabase } from '../lib/supabaseClient.js';
import { logger } from '../lib/logger.js';
import { executeWithIdempotency } from './shared/idempotentExecutor.js';
import crypto from 'crypto';

/**
 * Get access token for user account
 */
async function getAccessToken(userAccountId, adAccountId) {
  // Try to get from ad_accounts first
  if (adAccountId) {
    const { data: adAccount } = await supabase
      .from('ad_accounts')
      .select('access_token')
      .eq('id', adAccountId)
      .single();

    if (adAccount?.access_token) {
      return adAccount.access_token;
    }
  }

  // Fallback to user's default ad account
  const { data: defaultAccount } = await supabase
    .from('ad_accounts')
    .select('access_token')
    .eq('user_account_id', userAccountId)
    .eq('is_default', true)
    .single();

  if (defaultAccount?.access_token) {
    return defaultAccount.access_token;
  }

  // Final fallback - any active account
  const { data: anyAccount } = await supabase
    .from('ad_accounts')
    .select('access_token')
    .eq('user_account_id', userAccountId)
    .eq('is_active', true)
    .limit(1)
    .single();

  return anyAccount?.access_token || null;
}

/**
 * Get ad account ID for user
 */
async function getAdAccountId(userAccountId, adAccountId) {
  if (adAccountId) return adAccountId;

  const { data } = await supabase
    .from('ad_accounts')
    .select('id, ad_account_id')
    .eq('user_account_id', userAccountId)
    .eq('is_default', true)
    .single();

  return data?.id || null;
}

export class PlanExecutor {

  /**
   * Execute full plan (all steps)
   * @param {Object} params
   * @param {string} params.planId - Plan UUID
   * @param {Object} params.toolContext - Context with userAccountId, adAccountId
   * @param {Function} [params.onStepStart] - Callback before each step
   * @param {Function} [params.onStepComplete] - Callback after each step
   * @returns {Promise<Object>} Execution result
   */
  async executeFullPlan({ planId, toolContext, onStepStart, onStepComplete }) {
    // Get plan
    const plan = await unifiedStore.getPendingPlanById(planId);

    if (!plan) {
      throw new Error('Plan not found');
    }

    if (plan.status !== 'approved') {
      throw new Error(`Plan is not approved. Current status: ${plan.status}`);
    }

    // Mark as executing
    await unifiedStore.startExecution(planId);

    const steps = plan.plan_json?.steps || [];
    const results = [];

    // Get access token
    const accessToken = await getAccessToken(
      toolContext.userAccountId,
      toolContext.adAccountId
    );

    if (!accessToken) {
      const errorResults = [{ step_index: 0, success: false, error: 'No access token found' }];
      await unifiedStore.failExecution(planId, errorResults, 'No access token');
      return { success: false, results: errorResults, error: 'No access token found' };
    }

    // Get ad account ID
    const adAccountId = await getAdAccountId(
      toolContext.userAccountId,
      toolContext.adAccountId
    );

    const context = {
      accessToken,
      userAccountId: toolContext.userAccountId,
      adAccountId
    };

    // Generate idempotency prefix for this plan execution
    // This ensures each step has a unique operation_id tied to this plan
    const planOperationPrefix = crypto.randomUUID().slice(0, 8);

    // Execute each step with idempotency
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      // Callback before step
      if (onStepStart) {
        try {
          await onStepStart({ step, index: i, total: steps.length });
        } catch (e) {
          logger.warn({ error: e.message }, 'onStepStart callback error');
        }
      }

      try {
        logger.info({
          planId,
          step: i + 1,
          total: steps.length,
          action: step.action
        }, 'Executing plan step');

        // Add operation_id for idempotency (unique per plan + step)
        const stepArgs = {
          ...(step.params || {}),
          operation_id: `plan-${planOperationPrefix}-step${i}-${step.action}`
        };

        // Execute with idempotency wrapper
        const result = await executeWithIdempotency(
          step.action,
          stepArgs,
          {
            ...context,
            planId,
            source: 'plan_executor'
          },
          (args, ctx) => executeTool(step.action, args, ctx)
        );

        // Log if step was already applied (retry detection)
        if (result.already_applied) {
          logger.info({
            planId,
            step: i + 1,
            action: step.action,
            appliedAt: result.applied_at
          }, 'Plan step already applied (retry detected)');
        }

        results.push({
          step_index: i,
          action: step.action,
          description: step.description,
          success: result.success !== false,
          already_applied: result.already_applied || false,
          message: result.message || result.data?.message,
          data: result.data
        });

        // Callback after step
        if (onStepComplete) {
          try {
            await onStepComplete({
              step,
              index: i,
              total: steps.length,
              result,
              success: result.success !== false
            });
          } catch (e) {
            logger.warn({ error: e.message }, 'onStepComplete callback error');
          }
        }

      } catch (error) {
        logger.error({
          planId,
          step: i + 1,
          action: step.action,
          error: error.message
        }, 'Error executing plan step');

        results.push({
          step_index: i,
          action: step.action,
          description: step.description,
          success: false,
          error: error.message
        });

        // Callback after failed step
        if (onStepComplete) {
          try {
            await onStepComplete({
              step,
              index: i,
              total: steps.length,
              result: { success: false, error: error.message },
              success: false
            });
          } catch (e) {
            logger.warn({ error: e.message }, 'onStepComplete callback error');
          }
        }
      }
    }

    // Check if all succeeded
    const allSucceeded = results.every(r => r.success);
    const successCount = results.filter(r => r.success).length;

    if (allSucceeded) {
      await unifiedStore.completeExecution(planId, results);
      logger.info({ planId, successCount, totalSteps: steps.length }, 'Plan execution completed');
    } else {
      await unifiedStore.failExecution(planId, results);
      logger.warn({ planId, successCount, totalSteps: steps.length }, 'Plan execution partially failed');
    }

    return {
      success: allSucceeded,
      results,
      successCount,
      totalSteps: steps.length,
      summary: `${successCount}/${steps.length} шагов выполнено успешно`
    };
  }

  /**
   * Execute single step from plan
   * @param {Object} params
   * @param {string} params.planId - Plan UUID
   * @param {number} params.stepIndex - Step index to execute
   * @param {Object} params.toolContext - Context with userAccountId, adAccountId
   * @returns {Promise<Object>} Step result
   */
  async executeSingleStep({ planId, stepIndex, toolContext }) {
    // Get plan
    const plan = await unifiedStore.getPendingPlanById(planId);

    if (!plan) {
      throw new Error('Plan not found');
    }

    if (!['approved', 'executing'].includes(plan.status)) {
      throw new Error(`Plan cannot be executed. Current status: ${plan.status}`);
    }

    const steps = plan.plan_json?.steps || [];
    const step = steps[stepIndex];

    if (!step) {
      throw new Error(`Step ${stepIndex} not found in plan`);
    }

    // Mark as executing if not already
    if (plan.status === 'approved') {
      await unifiedStore.startExecution(planId);
    }

    // Get access token
    const accessToken = await getAccessToken(
      toolContext.userAccountId,
      toolContext.adAccountId
    );

    if (!accessToken) {
      return { success: false, error: 'No access token found' };
    }

    // Get ad account ID
    const adAccountId = await getAdAccountId(
      toolContext.userAccountId,
      toolContext.adAccountId
    );

    const context = {
      accessToken,
      userAccountId: toolContext.userAccountId,
      adAccountId
    };

    try {
      logger.info({
        planId,
        stepIndex,
        action: step.action
      }, 'Executing single plan step');

      const result = await executeTool(step.action, step.params || {}, context);

      // Update execution results in plan
      const currentResults = plan.execution_results || [];
      currentResults.push({
        step_index: stepIndex,
        action: step.action,
        success: result.success,
        message: result.message,
        executed_at: new Date().toISOString()
      });

      // Check if all steps done
      const executedCount = currentResults.length;
      if (executedCount >= steps.length) {
        const allSucceeded = currentResults.every(r => r.success);
        if (allSucceeded) {
          await unifiedStore.completeExecution(planId, currentResults);
        } else {
          await unifiedStore.failExecution(planId, currentResults);
        }
      } else {
        // Update partial results
        await supabase
          .from('ai_pending_plans')
          .update({
            execution_results: currentResults,
            executed_steps: executedCount
          })
          .eq('id', planId);
      }

      return {
        success: result.success,
        message: result.message,
        data: result.data,
        stepIndex,
        stepsRemaining: steps.length - executedCount
      };

    } catch (error) {
      logger.error({
        planId,
        stepIndex,
        action: step.action,
        error: error.message
      }, 'Error executing single step');

      return {
        success: false,
        error: error.message,
        stepIndex
      };
    }
  }

  /**
   * Execute only selected steps from plan
   * @param {Object} params
   * @param {string} params.planId - Plan UUID
   * @param {number[]} params.stepIndices - Array of step indices to execute
   * @param {Object} params.toolContext - Context with userAccountId, adAccountId
   * @param {Function} [params.onStepStart] - Callback before each step
   * @param {Function} [params.onStepComplete] - Callback after each step
   * @returns {Promise<Object>} Execution result
   */
  async executeSelectedSteps({ planId, stepIndices, toolContext, onStepStart, onStepComplete }) {
    logger.info({
      where: 'planExecutor.executeSelectedSteps',
      phase: 'start',
      planId,
      stepIndices,
      userAccountId: toolContext.userAccountId,
      adAccountId: toolContext.adAccountId
    }, `Starting execution of ${stepIndices.length} selected steps`);

    // Get plan
    const plan = await unifiedStore.getPendingPlanById(planId);

    if (!plan) {
      logger.error({ planId }, 'Plan not found in executeSelectedSteps');
      throw new Error('Plan not found');
    }

    logger.info({
      planId,
      planStatus: plan.status,
      totalStepsInPlan: plan.plan_json?.steps?.length || 0
    }, `Plan found with status: ${plan.status}`);

    if (plan.status !== 'approved') {
      logger.error({ planId, status: plan.status }, 'Plan is not approved');
      throw new Error(`Plan is not approved. Current status: ${plan.status}`);
    }

    // Mark as executing
    await unifiedStore.startExecution(planId);
    logger.info({ planId }, 'Plan marked as executing');

    const allSteps = plan.plan_json?.steps || [];
    const results = [];

    // Validate step indices
    const validIndices = stepIndices.filter(i => i >= 0 && i < allSteps.length);
    if (validIndices.length === 0) {
      logger.error({ planId, stepIndices, allStepsLength: allSteps.length }, 'No valid step indices');
      await unifiedStore.failExecution(planId, [], 'No valid step indices');
      return { success: false, results: [], error: 'No valid step indices' };
    }

    logger.info({
      planId,
      validIndices,
      invalidCount: stepIndices.length - validIndices.length
    }, `Validated ${validIndices.length} step indices`);

    // Get access token
    const accessToken = await getAccessToken(
      toolContext.userAccountId,
      toolContext.adAccountId
    );

    if (!accessToken) {
      logger.error({ planId, userAccountId: toolContext.userAccountId }, 'No access token found');
      const errorResults = [{ step_index: 0, success: false, error: 'No access token found' }];
      await unifiedStore.failExecution(planId, errorResults, 'No access token');
      return { success: false, results: errorResults, error: 'No access token found' };
    }

    // Get ad account ID
    const adAccountId = await getAdAccountId(
      toolContext.userAccountId,
      toolContext.adAccountId
    );

    logger.info({ planId, adAccountId, hasToken: !!accessToken }, 'Got access token and adAccountId');

    const context = {
      accessToken,
      userAccountId: toolContext.userAccountId,
      adAccountId
    };

    // Generate idempotency prefix for this plan execution
    const planOperationPrefix = crypto.randomUUID().slice(0, 8);

    // Execute only selected steps
    for (let idx = 0; idx < validIndices.length; idx++) {
      const stepIndex = validIndices[idx];
      const step = allSteps[stepIndex];

      // Callback before step
      if (onStepStart) {
        try {
          await onStepStart({ step, index: stepIndex, total: validIndices.length });
        } catch (e) {
          logger.warn({ error: e.message }, 'onStepStart callback error');
        }
      }

      try {
        logger.info({
          planId,
          step: idx + 1,
          stepIndex,
          total: validIndices.length,
          action: step.action
        }, 'Executing selected plan step');

        // Add operation_id for idempotency (unique per plan + step)
        const stepArgs = {
          ...(step.params || {}),
          operation_id: `plan-${planOperationPrefix}-step${stepIndex}-${step.action}`
        };

        // Execute with idempotency wrapper
        const result = await executeWithIdempotency(
          step.action,
          stepArgs,
          {
            ...context,
            planId,
            source: 'plan_executor_selected'
          },
          (args, ctx) => executeTool(step.action, args, ctx)
        );

        // Log if step was already applied (retry detection)
        if (result.already_applied) {
          logger.info({
            planId,
            stepIndex,
            action: step.action,
            appliedAt: result.applied_at
          }, 'Plan step already applied (retry detected)');
        }

        results.push({
          step_index: stepIndex,
          action: step.action,
          description: step.description,
          success: result.success !== false,
          already_applied: result.already_applied || false,
          message: result.message || result.data?.message,
          data: result.data
        });

        // Callback after step
        if (onStepComplete) {
          try {
            await onStepComplete({
              step,
              index: stepIndex,
              total: validIndices.length,
              result,
              success: result.success !== false
            });
          } catch (e) {
            logger.warn({ error: e.message }, 'onStepComplete callback error');
          }
        }

      } catch (error) {
        logger.error({
          planId,
          stepIndex,
          action: step.action,
          error: error.message
        }, 'Error executing selected plan step');

        results.push({
          step_index: stepIndex,
          action: step.action,
          description: step.description,
          success: false,
          error: error.message
        });

        // Callback after failed step
        if (onStepComplete) {
          try {
            await onStepComplete({
              step,
              index: stepIndex,
              total: validIndices.length,
              result: { success: false, error: error.message },
              success: false
            });
          } catch (e) {
            logger.warn({ error: e.message }, 'onStepComplete callback error');
          }
        }
      }
    }

    // Check if all selected succeeded
    const allSucceeded = results.every(r => r.success);
    const successCount = results.filter(r => r.success).length;

    if (allSucceeded) {
      await unifiedStore.completeExecution(planId, results);
      logger.info({ planId, successCount, selectedSteps: validIndices.length }, 'Selected steps execution completed');
    } else {
      await unifiedStore.failExecution(planId, results);
      logger.warn({ planId, successCount, selectedSteps: validIndices.length }, 'Selected steps execution partially failed');
    }

    // Save to brain_executions for Autopilot history
    try {
      logger.info({
        planId,
        phase: 'saving_to_brain_executions',
        userAccountId: toolContext.userAccountId,
        adAccountId,
        actionsCount: results.length
      }, 'Saving Brain Mini execution to brain_executions...');

      const executedSteps = validIndices.map(i => allSteps[i]);
      const actions = executedSteps.map(step => ({
        type: this.mapActionToType(step.action),
        params: step.params || {}
      }));

      const reportText = this.generateMiniReport(results, executedSteps);

      const insertData = {
        user_account_id: toolContext.userAccountId,
        account_id: adAccountId,
        execution_mode: 'manual_trigger', // Brain Mini mode
        plan_json: { planNote: 'Brain Mini оптимизация', steps: executedSteps },
        actions_json: actions,
        report_text: reportText,
        status: allSucceeded ? 'success' : 'partial',
        actions_taken: results.length,
        actions_failed: results.filter(r => !r.success).length
      };

      const { data, error } = await supabase.from('brain_executions').insert(insertData).select();

      if (error) {
        logger.error({
          planId,
          error: error.message,
          code: error.code,
          details: error.details
        }, 'Supabase error saving to brain_executions');
      } else {
        logger.info({
          planId,
          executionId: data?.[0]?.id,
          actionsCount: results.length,
          status: insertData.status
        }, 'Successfully saved to brain_executions');
      }
    } catch (saveError) {
      logger.error({
        planId,
        error: saveError.message,
        stack: saveError.stack
      }, 'Failed to save to brain_executions');
    }

    return {
      success: allSucceeded,
      results,
      successCount,
      totalSteps: validIndices.length,
      summary: `${successCount}/${validIndices.length} шагов выполнено успешно`
    };
  }

  /**
   * Map action name to standard type for brain_executions
   */
  mapActionToType(action) {
    const mapping = {
      'updateBudget': 'UpdateAdSetDailyBudget',
      'pauseAdSet': 'PauseAdSet',
      'pauseAd': 'PauseAd',
      'enableAdSet': 'ResumeAdSet',
      'enableAd': 'ResumeAd',
      'createAdSet': 'Direction.CreateAdSetWithCreatives',
      'launchNewCreatives': 'Direction.CreateAdSetWithCreatives'
    };
    return mapping[action] || action;
  }

  /**
   * Generate mini report for brain_executions
   */
  generateMiniReport(results, steps) {
    const successCount = results.filter(r => r.success).length;
    let report = `Brain Mini оптимизация\n`;
    report += `Выполнено ${successCount}/${results.length} действий\n\n`;

    results.forEach((r, i) => {
      const icon = r.success ? '✓' : '✗';
      report += `${icon} ${r.description || r.action}\n`;
      if (r.message) report += `   ${r.message}\n`;
      if (r.error) report += `   Ошибка: ${r.error}\n`;
    });

    return report;
  }

  /**
   * Format execution result for display
   */
  formatResult(result) {
    if (result.success) {
      let text = `✅ *План выполнен успешно*\n`;
      text += `${result.summary}\n\n`;

      result.results.forEach((r, i) => {
        const icon = r.success ? '✓' : '✗';
        text += `${icon} ${r.description || r.action}\n`;
        if (r.message) text += `   _${r.message}_\n`;
        if (r.error) text += `   ❌ ${r.error}\n`;
      });

      return text;
    } else {
      let text = `⚠️ *План выполнен частично*\n`;
      text += `${result.summary}\n\n`;

      result.results.forEach((r, i) => {
        const icon = r.success ? '✓' : '✗';
        text += `${icon} ${r.description || r.action}\n`;
        if (r.error) text += `   ❌ ${r.error}\n`;
      });

      return text;
    }
  }
}

// Export singleton instance
export const planExecutor = new PlanExecutor();
