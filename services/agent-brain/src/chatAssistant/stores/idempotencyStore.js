/**
 * IdempotencyStore - Storage for idempotent operation results
 *
 * Prevents duplicate execution of WRITE operations by:
 * 1. Generating unique operation keys (hash or user-provided)
 * 2. Checking if operation was already executed
 * 3. Caching results for idempotent returns
 */

import { supabase } from '../../lib/supabaseClient.js';
import { logger } from '../../lib/logger.js';
import crypto from 'crypto';

const DEFAULT_TTL_HOURS = 24;

class IdempotencyStore {
  /**
   * Generate an operation key based on context
   *
   * @param {string} toolName - Name of the tool
   * @param {Object} args - Tool arguments
   * @param {string} userAccountId - User account UUID
   * @param {Object} options - Options { hourBucket, forceNew }
   * @returns {string} Operation key (32-char hash or user-provided)
   */
  generateKey(toolName, args, userAccountId, options = {}) {
    // If explicit operation_id provided - use it
    if (args?.operation_id) {
      return args.operation_id;
    }

    // Auto-generate: hash of tool + normalized args + user + hour bucket
    // Hour bucket ensures same operation within 1 hour is considered duplicate
    const hourBucket = options.hourBucket ?? Math.floor(Date.now() / (1000 * 60 * 60));

    const payload = JSON.stringify({
      tool: toolName,
      args: this._normalizeArgs(args),
      user: userAccountId,
      hour: hourBucket
    });

    return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 32);
  }

  /**
   * Normalize arguments for stable hashing
   * - Sorts object keys
   * - Removes operation_id and dry_run (meta-params)
   */
  _normalizeArgs(args) {
    if (!args || typeof args !== 'object') return {};

    // Remove meta-parameters that shouldn't affect idempotency
    const { operation_id, dry_run, ...rest } = args;

    // Sort keys for stable hash
    return Object.keys(rest)
      .sort()
      .reduce((acc, key) => {
        acc[key] = rest[key];
        return acc;
      }, {});
  }

  /**
   * Check if operation was already executed
   *
   * @param {string} operationKey - Operation key to check
   * @param {string} userAccountId - User account UUID
   * @returns {Promise<Object|null>} Cached operation record or null
   */
  async check(operationKey, userAccountId) {
    try {
      const { data, error } = await supabase
        .from('ai_idempotent_operations')
        .select('*')
        .eq('operation_key', operationKey)
        .eq('user_account_id', userAccountId)
        .single();

      // Not found (PGRST116 = no rows)
      if (error && error.code === 'PGRST116') {
        return null;
      }

      if (error) {
        logger.error({ error, operationKey }, 'Error checking idempotency');
        return null;
      }

      // Check if expired
      if (data && data.expires_at) {
        const expiresAt = new Date(data.expires_at);
        if (expiresAt < new Date()) {
          // Expired - delete and return null
          await this._deleteExpired(operationKey, userAccountId);
          return null;
        }
      }

      return data;
    } catch (err) {
      logger.error({ error: err.message, operationKey }, 'Exception checking idempotency');
      return null;
    }
  }

  /**
   * Save operation result for future idempotent returns
   *
   * @param {string} operationKey - Operation key
   * @param {Object} context - Execution context
   * @param {Object} result - Tool execution result
   * @returns {Promise<Object>} Saved record
   */
  async save(operationKey, context, result) {
    const {
      userAccountId,
      adAccountId,
      toolName,
      toolArgs,
      planId,
      conversationId,
      source = 'chat_assistant',
      ttlHours
    } = context;

    // Calculate expiration
    // null = permanent (no expiration)
    const expiresAt = ttlHours === null
      ? null
      : new Date(Date.now() + (ttlHours || DEFAULT_TTL_HOURS) * 60 * 60 * 1000);

    try {
      const { data, error } = await supabase
        .from('ai_idempotent_operations')
        .upsert(
          {
            operation_key: operationKey,
            user_account_id: userAccountId,
            ad_account_id: adAccountId || null,
            tool_name: toolName,
            tool_args: toolArgs || {},
            result: result || {},
            success: result?.success !== false,
            source,
            plan_id: planId || null,
            conversation_id: conversationId || null,
            expires_at: expiresAt
          },
          {
            onConflict: 'operation_key,user_account_id'
          }
        )
        .select()
        .single();

      if (error) {
        logger.error({ error, operationKey, toolName }, 'Error saving idempotent operation');
        throw error;
      }

      logger.info(
        {
          operationKey: operationKey.slice(0, 8) + '...',
          toolName,
          success: result?.success !== false,
          expiresAt
        },
        'Saved idempotent operation'
      );

      return data;
    } catch (err) {
      logger.error({ error: err.message, operationKey }, 'Exception saving idempotent operation');
      throw err;
    }
  }

  /**
   * Invalidate (delete) an operation record
   * Use when you want to allow re-execution
   *
   * @param {string} operationKey - Operation key
   * @param {string} userAccountId - User account UUID
   */
  async invalidate(operationKey, userAccountId) {
    try {
      const { error } = await supabase
        .from('ai_idempotent_operations')
        .delete()
        .eq('operation_key', operationKey)
        .eq('user_account_id', userAccountId);

      if (error) {
        logger.error({ error, operationKey }, 'Error invalidating idempotent operation');
      } else {
        logger.info({ operationKey: operationKey.slice(0, 8) + '...' }, 'Invalidated idempotent operation');
      }
    } catch (err) {
      logger.error({ error: err.message, operationKey }, 'Exception invalidating operation');
    }
  }

  /**
   * Delete expired entry
   * @private
   */
  async _deleteExpired(operationKey, userAccountId) {
    try {
      await supabase
        .from('ai_idempotent_operations')
        .delete()
        .eq('operation_key', operationKey)
        .eq('user_account_id', userAccountId);
    } catch (err) {
      logger.warn({ error: err.message, operationKey }, 'Error deleting expired operation');
    }
  }

  /**
   * Get recent operations for a user (for debugging/admin)
   *
   * @param {string} userAccountId - User account UUID
   * @param {number} limit - Max records to return
   * @returns {Promise<Array>} List of operations
   */
  async getRecent(userAccountId, limit = 20) {
    try {
      const { data, error } = await supabase
        .from('ai_idempotent_operations')
        .select('*')
        .eq('user_account_id', userAccountId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        logger.error({ error }, 'Error getting recent idempotent operations');
        return [];
      }

      return data || [];
    } catch (err) {
      logger.error({ error: err.message }, 'Exception getting recent operations');
      return [];
    }
  }

  /**
   * Get operations for a specific plan (for plan retry detection)
   *
   * @param {string} planId - Plan UUID
   * @returns {Promise<Array>} List of operations for this plan
   */
  async getByPlan(planId) {
    try {
      const { data, error } = await supabase
        .from('ai_idempotent_operations')
        .select('*')
        .eq('plan_id', planId)
        .order('created_at', { ascending: true });

      if (error) {
        logger.error({ error, planId }, 'Error getting operations by plan');
        return [];
      }

      return data || [];
    } catch (err) {
      logger.error({ error: err.message, planId }, 'Exception getting operations by plan');
      return [];
    }
  }
}

// Export singleton instance
export const idempotencyStore = new IdempotencyStore();
export default idempotencyStore;
