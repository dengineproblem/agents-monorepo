/**
 * RunsStore - LLM call tracing for Chat Assistant
 * Provides full audit trail for debugging "why the response was bad"
 */

import { supabase } from '../../lib/supabaseClient.js';
import { logger } from '../../lib/logger.js';

export class RunsStore {

  /**
   * Create a new run record
   * @param {Object} params
   * @param {string} params.conversationId
   * @param {string} params.userAccountId
   * @param {string} params.model
   * @param {string} [params.agent]
   * @param {string} [params.domain]
   * @param {string} [params.userMessage]
   * @param {string} [params.promptVersion]
   * @returns {Promise<Object>} Created run record
   */
  async create({
    conversationId,
    userAccountId,
    model,
    agent = null,
    domain = null,
    userMessage = null,
    promptVersion = null
  }) {
    const { data, error } = await supabase
      .from('ai_runs')
      .insert({
        conversation_id: conversationId,
        user_account_id: userAccountId,
        model,
        agent,
        domain,
        user_message: userMessage?.substring(0, 500), // Truncate to 500 chars
        prompt_version: promptVersion,
        status: 'pending'
      })
      .select()
      .single();

    if (error) {
      logger.error({ error, conversationId }, 'Error creating run');
      throw error;
    }

    logger.debug({ runId: data.id, agent, domain }, 'Created run');
    return data;
  }

  /**
   * Update run with context stats before LLM call
   * @param {string} runId
   * @param {Object} contextStats - Token budget stats
   */
  async updateContextStats(runId, contextStats) {
    const { error } = await supabase
      .from('ai_runs')
      .update({
        context_stats: contextStats,
        snapshot_used: contextStats?.snapshotUsed || false,
        rolling_summary_used: contextStats?.rollingSummaryUsed || false
      })
      .eq('id', runId);

    if (error) {
      logger.error({ error, runId }, 'Error updating context stats');
    }
  }

  /**
   * Record planned tool calls (what LLM wants to execute)
   * @param {string} runId
   * @param {Array} toolCalls - [{name, args}]
   */
  async recordToolsPlanned(runId, toolCalls) {
    if (!toolCalls || toolCalls.length === 0) return;

    const planned = toolCalls.map(tc => ({
      name: tc.function?.name || tc.name,
      args: tc.function?.arguments || tc.args
    }));

    const { error } = await supabase
      .from('ai_runs')
      .update({ tools_planned: planned })
      .eq('id', runId);

    if (error) {
      logger.error({ error, runId }, 'Error recording tools planned');
    }
  }

  /**
   * Record tool execution result
   * @param {string} runId
   * @param {Object} execution - {name, args, success, latencyMs, cached, error}
   */
  async recordToolExecution(runId, execution) {
    // Get current tools_executed
    const { data: current } = await supabase
      .from('ai_runs')
      .select('tools_executed, tool_errors')
      .eq('id', runId)
      .single();

    const toolsExecuted = [...(current?.tools_executed || []), {
      name: execution.name,
      args: execution.args,
      success: execution.success,
      latency_ms: execution.latencyMs,
      cached: execution.cached || false
    }];

    const updates = { tools_executed: toolsExecuted };

    // Record error if failed
    if (!execution.success && execution.error) {
      const toolErrors = [...(current?.tool_errors || []), {
        name: execution.name,
        error: execution.error,
        code: execution.errorCode
      }];
      updates.tool_errors = toolErrors;
    }

    const { error } = await supabase
      .from('ai_runs')
      .update(updates)
      .eq('id', runId);

    if (error) {
      logger.error({ error, runId }, 'Error recording tool execution');
    }
  }

  /**
   * Complete run successfully
   * @param {string} runId
   * @param {Object} stats
   * @param {number} stats.inputTokens
   * @param {number} stats.outputTokens
   * @param {number} stats.latencyMs
   * @param {string} [stats.messageId] - ID of saved message
   */
  async complete(runId, stats) {
    const { error } = await supabase
      .from('ai_runs')
      .update({
        status: 'completed',
        input_tokens: stats.inputTokens,
        output_tokens: stats.outputTokens,
        total_tokens: (stats.inputTokens || 0) + (stats.outputTokens || 0),
        latency_ms: stats.latencyMs,
        message_id: stats.messageId,
        completed_at: new Date().toISOString()
      })
      .eq('id', runId);

    if (error) {
      logger.error({ error, runId }, 'Error completing run');
    } else {
      logger.debug({
        runId,
        tokens: (stats.inputTokens || 0) + (stats.outputTokens || 0),
        latencyMs: stats.latencyMs
      }, 'Completed run');
    }
  }

  /**
   * Mark run as failed
   * @param {string} runId
   * @param {Object} stats
   * @param {number} stats.latencyMs
   * @param {string} stats.errorMessage
   * @param {string} [stats.errorCode]
   * @param {number} [stats.retries]
   */
  async fail(runId, stats) {
    const { error } = await supabase
      .from('ai_runs')
      .update({
        status: 'error',
        latency_ms: stats.latencyMs,
        error_message: stats.errorMessage?.substring(0, 1000),
        error_code: stats.errorCode,
        retries: stats.retries || 0,
        completed_at: new Date().toISOString()
      })
      .eq('id', runId);

    if (error) {
      logger.error({ error, runId }, 'Error marking run as failed');
    } else {
      logger.warn({ runId, errorMessage: stats.errorMessage }, 'Run failed');
    }
  }

  /**
   * Get run by ID
   */
  async getById(runId) {
    const { data, error } = await supabase
      .from('ai_runs')
      .select('*')
      .eq('id', runId)
      .single();

    if (error) {
      logger.error({ error, runId }, 'Error getting run');
      throw error;
    }

    return data;
  }

  /**
   * Get runs for conversation
   * @param {string} conversationId
   * @param {number} [limit=50]
   */
  async getForConversation(conversationId, limit = 50) {
    const { data, error } = await supabase
      .from('ai_runs')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error({ error, conversationId }, 'Error getting runs for conversation');
      throw error;
    }

    return data || [];
  }

  /**
   * Get recent runs for user
   * @param {string} userAccountId
   * @param {number} [limit=100]
   */
  async getRecent(userAccountId, limit = 100) {
    const { data, error } = await supabase
      .from('ai_runs')
      .select('*')
      .eq('user_account_id', userAccountId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error({ error, userAccountId }, 'Error getting recent runs');
      throw error;
    }

    return data || [];
  }

  /**
   * Get failed runs for debugging
   * @param {string} userAccountId
   * @param {number} [limit=50]
   */
  async getFailedRuns(userAccountId, limit = 50) {
    const { data, error } = await supabase
      .from('ai_runs')
      .select('*')
      .eq('user_account_id', userAccountId)
      .eq('status', 'error')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error({ error, userAccountId }, 'Error getting failed runs');
      throw error;
    }

    return data || [];
  }

  /**
   * Get aggregated stats for conversation
   * Uses SQL function for efficiency
   */
  async getConversationStats(conversationId) {
    const { data, error } = await supabase
      .rpc('get_conversation_run_stats', { p_conversation_id: conversationId });

    if (error) {
      logger.error({ error, conversationId }, 'Error getting conversation stats');
      return null;
    }

    return data?.[0] || null;
  }

  /**
   * Get stats summary for dashboard
   * @param {string} userAccountId
   * @param {string} [period='7d'] - 1d, 7d, 30d
   */
  async getStatsSummary(userAccountId, period = '7d') {
    const periodDays = { '1d': 1, '7d': 7, '30d': 30 }[period] || 7;
    const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('ai_runs')
      .select('status, latency_ms, input_tokens, output_tokens, agent, domain')
      .eq('user_account_id', userAccountId)
      .gte('created_at', since);

    if (error) {
      logger.error({ error, userAccountId }, 'Error getting stats summary');
      return null;
    }

    const runs = data || [];
    const completed = runs.filter(r => r.status === 'completed');
    const errors = runs.filter(r => r.status === 'error');

    // Agent distribution
    const agentCounts = {};
    runs.forEach(r => {
      if (r.agent) {
        agentCounts[r.agent] = (agentCounts[r.agent] || 0) + 1;
      }
    });

    return {
      totalRuns: runs.length,
      completedRuns: completed.length,
      errorRuns: errors.length,
      errorRate: runs.length > 0 ? (errors.length / runs.length * 100).toFixed(2) : 0,
      avgLatencyMs: completed.length > 0
        ? Math.round(completed.reduce((sum, r) => sum + (r.latency_ms || 0), 0) / completed.length)
        : 0,
      totalInputTokens: runs.reduce((sum, r) => sum + (r.input_tokens || 0), 0),
      totalOutputTokens: runs.reduce((sum, r) => sum + (r.output_tokens || 0), 0),
      agentDistribution: agentCounts,
      period
    };
  }

  /**
   * Cleanup old runs (for maintenance)
   * @param {number} [retentionDays=30]
   */
  async cleanup(retentionDays = 30) {
    const { data, error } = await supabase
      .rpc('cleanup_old_ai_runs', { retention_days: retentionDays });

    if (error) {
      logger.error({ error }, 'Error cleaning up old runs');
      return 0;
    }

    if (data > 0) {
      logger.info({ deletedCount: data, retentionDays }, 'Cleaned up old ai_runs');
    }

    return data || 0;
  }

  // ============================================================
  // HYBRID MCP EXECUTOR OBSERVABILITY
  // ============================================================

  /**
   * Record Hybrid MCP metadata for a run
   * @param {string} runId
   * @param {Object} metadata
   * @param {string} [metadata.sessionId] - MCP session ID
   * @param {string[]} [metadata.allowedTools] - Tools allowed by policy
   * @param {string} [metadata.playbookId] - Playbook ID from policy
   * @param {string} [metadata.intent] - Detected user intent
   * @param {number} [metadata.maxToolCalls] - Max tool calls allowed
   * @param {number} [metadata.toolCallsUsed] - Tool calls used so far
   * @param {Object} [metadata.clarifyingAnswers] - Answers from clarifying gate
   */
  async recordHybridMetadata(runId, metadata) {
    if (!runId || !metadata) return;

    const hybridMetadata = {
      sessionId: metadata.sessionId?.substring(0, 36), // UUID
      allowedTools: metadata.allowedTools,
      playbookId: metadata.playbookId,
      intent: metadata.intent,
      maxToolCalls: metadata.maxToolCalls,
      toolCallsUsed: metadata.toolCallsUsed,
      clarifyingAnswers: metadata.clarifyingAnswers,
      recordedAt: new Date().toISOString()
    };

    const { error } = await supabase
      .from('ai_runs')
      .update({ hybrid_metadata: hybridMetadata })
      .eq('id', runId);

    if (error) {
      logger.error({ error, runId }, 'Error recording hybrid metadata');
    } else {
      logger.debug({
        runId,
        playbookId: metadata.playbookId,
        intent: metadata.intent,
        toolCallsUsed: metadata.toolCallsUsed
      }, 'Recorded hybrid metadata');
    }
  }

  /**
   * Record Hybrid MCP specific error
   * @param {string} runId
   * @param {Object} errorInfo
   * @param {'limit_reached' | 'not_allowed' | 'approval_required' | 'clarifying_timeout'} errorInfo.type
   * @param {string} [errorInfo.tool] - Tool that caused the error
   * @param {string} [errorInfo.message] - Error message
   * @param {Object} [errorInfo.meta] - Additional metadata
   */
  async recordHybridError(runId, errorInfo) {
    if (!runId || !errorInfo) return;

    // Get current hybrid_metadata
    const { data: current } = await supabase
      .from('ai_runs')
      .select('hybrid_metadata')
      .eq('id', runId)
      .single();

    const hybridMetadata = current?.hybrid_metadata || {};

    // Add error to metadata
    const hybridErrors = [...(hybridMetadata.errors || []), {
      type: errorInfo.type,
      tool: errorInfo.tool,
      message: errorInfo.message,
      meta: errorInfo.meta,
      timestamp: new Date().toISOString()
    }];

    hybridMetadata.errors = hybridErrors;
    hybridMetadata.lastError = errorInfo.type;

    const { error } = await supabase
      .from('ai_runs')
      .update({ hybrid_metadata: hybridMetadata })
      .eq('id', runId);

    if (error) {
      logger.error({ error, runId }, 'Error recording hybrid error');
    } else {
      logger.warn({
        runId,
        errorType: errorInfo.type,
        tool: errorInfo.tool
      }, 'Recorded hybrid error');
    }
  }

  /**
   * Get hybrid runs statistics for a playbook
   * @param {string} playbookId
   * @param {number} [limit=100]
   */
  async getHybridStatsByPlaybook(playbookId, limit = 100) {
    const { data, error } = await supabase
      .from('ai_runs')
      .select('id, status, latency_ms, hybrid_metadata, created_at')
      .not('hybrid_metadata', 'is', null)
      .eq('hybrid_metadata->>playbookId', playbookId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error({ error, playbookId }, 'Error getting hybrid stats by playbook');
      return null;
    }

    const runs = data || [];

    // Aggregate stats
    const stats = {
      totalRuns: runs.length,
      completedRuns: runs.filter(r => r.status === 'completed').length,
      errorRuns: runs.filter(r => r.status === 'error').length,
      avgToolCalls: 0,
      limitReachedCount: 0,
      notAllowedCount: 0,
      approvalRequiredCount: 0
    };

    let totalToolCalls = 0;
    runs.forEach(r => {
      const meta = r.hybrid_metadata || {};
      totalToolCalls += meta.toolCallsUsed || 0;

      // Count error types
      (meta.errors || []).forEach(e => {
        if (e.type === 'limit_reached') stats.limitReachedCount++;
        if (e.type === 'not_allowed') stats.notAllowedCount++;
        if (e.type === 'approval_required') stats.approvalRequiredCount++;
      });
    });

    stats.avgToolCalls = runs.length > 0 ? (totalToolCalls / runs.length).toFixed(2) : 0;

    return stats;
  }
}

// Export singleton instance
export const runsStore = new RunsStore();
