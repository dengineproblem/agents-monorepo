/**
 * Token Budget Management for Context Gathering
 *
 * Provides:
 * - Token estimation (approximate, ~4 chars per token)
 * - Budget allocation by blocks with priorities
 * - Smart trimming to fit within budget
 */

import { logger } from '../../lib/logger.js';

// Approximate characters per token for GPT models
// Conservative estimate (actual varies by content)
const CHARS_PER_TOKEN = 4;

/**
 * Default token budget allocation
 * Total ~8K tokens for context (leaving room for system prompt + response)
 */
export const DEFAULT_BUDGET = {
  total: 8000,          // Total context budget
  systemPrompt: 2000,   // Reserved for system prompt (not managed here)
  chatHistory: 3000,    // Recent messages
  specs: 800,           // Business specs (procedural memory)
  notes: 600,           // Agent notes (mid-term memory)
  metrics: 400,         // Today's metrics
  contexts: 400,        // Active promotional contexts
  reserved: 800         // Buffer for tool responses
};

/**
 * Estimate token count for text
 * Simple approximation — for production consider tiktoken
 * @param {string|null|undefined} text
 * @returns {number}
 */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / CHARS_PER_TOKEN);
}

/**
 * Estimate tokens for an object (JSON stringified)
 * @param {any} obj
 * @returns {number}
 */
export function estimateObjectTokens(obj) {
  if (obj === null || obj === undefined) return 0;

  try {
    return estimateTokens(JSON.stringify(obj));
  } catch {
    return 0;
  }
}

/**
 * Context block with metadata
 */
class ContextBlock {
  /**
   * @param {string} name - Block name (e.g., 'chatHistory', 'metrics')
   * @param {any} content - Block content
   * @param {number} priority - Higher = more important, kept first
   * @param {number} maxTokens - Maximum tokens for this block
   */
  constructor(name, content, priority, maxTokens) {
    this.name = name;
    this.content = content;
    this.priority = priority;
    this.maxTokens = maxTokens;
    this.tokens = estimateObjectTokens(content);
  }
}

/**
 * Token Budget Manager
 * Collects context blocks and builds optimized context within budget
 */
export class TokenBudget {
  /**
   * @param {Object} budget - Budget configuration (overrides DEFAULT_BUDGET)
   */
  constructor(budget = {}) {
    this.budget = { ...DEFAULT_BUDGET, ...budget };
    this.blocks = [];
  }

  /**
   * Add a context block
   * @param {string} name - Block identifier
   * @param {any} content - Block content
   * @param {number} priority - Priority (higher = more important)
   * @param {number} maxTokens - Optional max tokens (defaults to budget[name] or 500)
   * @returns {TokenBudget} this (for chaining)
   */
  addBlock(name, content, priority, maxTokens = null) {
    // Skip empty/null content
    if (content === null || content === undefined) {
      return this;
    }

    // For arrays, skip if empty
    if (Array.isArray(content) && content.length === 0) {
      return this;
    }

    // For objects, skip if empty
    if (typeof content === 'object' && !Array.isArray(content) && Object.keys(content).length === 0) {
      return this;
    }

    const block = new ContextBlock(
      name,
      content,
      priority,
      maxTokens || this.budget[name] || 500
    );

    this.blocks.push(block);
    return this;
  }

  /**
   * Trim a block to fit within its token budget
   * @param {ContextBlock} block
   * @returns {any} Trimmed content
   */
  trimBlock(block) {
    if (block.tokens <= block.maxTokens) {
      return block.content;
    }

    const content = block.content;

    // Array trimming (e.g., chat history, messages)
    // Keep most recent (from end)
    if (Array.isArray(content)) {
      let trimmed = [...content];

      // Remove from beginning (oldest) until within budget
      while (estimateObjectTokens(trimmed) > block.maxTokens && trimmed.length > 1) {
        trimmed.shift();
      }

      return trimmed;
    }

    // Object trimming — truncate long string values
    if (typeof content === 'object' && content !== null) {
      const trimmed = {};
      const keys = Object.keys(content);
      const tokensPerField = Math.floor(block.maxTokens / Math.max(keys.length, 1));
      const charsPerField = tokensPerField * CHARS_PER_TOKEN;

      for (const key of keys) {
        const value = content[key];

        if (typeof value === 'string' && value.length > charsPerField) {
          // Truncate long strings
          trimmed[key] = value.slice(0, charsPerField) + '...';
        } else if (Array.isArray(value) && value.length > 5) {
          // Keep first 5 items of arrays
          trimmed[key] = value.slice(0, 5);
        } else {
          trimmed[key] = value;
        }
      }

      return trimmed;
    }

    // String trimming
    if (typeof content === 'string') {
      const maxChars = block.maxTokens * CHARS_PER_TOKEN;
      if (content.length > maxChars) {
        return content.slice(0, maxChars) + '...';
      }
    }

    return content;
  }

  /**
   * Build optimized context within budget
   * @returns {{ context: Object, stats: Object }}
   */
  build() {
    // Sort blocks by priority (descending — highest priority first)
    this.blocks.sort((a, b) => b.priority - a.priority);

    // Calculate available budget
    const availableBudget = this.budget.total - this.budget.systemPrompt - this.budget.reserved;

    let usedTokens = 0;
    const result = {};
    const includedBlocks = [];

    for (const block of this.blocks) {
      // How much budget remains?
      const remainingBudget = availableBudget - usedTokens;

      if (remainingBudget <= 0) {
        logger.debug({ block: block.name }, 'Skipping block — no budget remaining');
        continue;
      }

      // Adjust block's max tokens to what's available
      const effectiveMaxTokens = Math.min(block.maxTokens, remainingBudget);

      // Create a temporary block with adjusted max for trimming
      const tempBlock = new ContextBlock(block.name, block.content, block.priority, effectiveMaxTokens);
      const trimmedContent = this.trimBlock(tempBlock);
      const trimmedTokens = estimateObjectTokens(trimmedContent);

      if (trimmedTokens > 0) {
        result[block.name] = trimmedContent;
        usedTokens += trimmedTokens;
        includedBlocks.push({
          name: block.name,
          priority: block.priority,
          originalTokens: block.tokens,
          finalTokens: trimmedTokens,
          trimmed: block.tokens > trimmedTokens
        });
      }
    }

    const stats = {
      usedTokens,
      budget: availableBudget,
      utilization: Math.round((usedTokens / availableBudget) * 100),
      blocksIncluded: includedBlocks.length,
      blocksTotal: this.blocks.length,
      blocks: includedBlocks
    };

    logger.debug({ contextStats: stats }, 'Context built with token budgeting');

    return { context: result, stats };
  }

  /**
   * Get current stats without building
   * @returns {Object}
   */
  getStats() {
    const totalTokens = this.blocks.reduce((sum, b) => sum + b.tokens, 0);
    const availableBudget = this.budget.total - this.budget.systemPrompt - this.budget.reserved;

    return {
      totalBlocks: this.blocks.length,
      totalTokens,
      availableBudget,
      overBudget: totalTokens > availableBudget
    };
  }
}

export default TokenBudget;
