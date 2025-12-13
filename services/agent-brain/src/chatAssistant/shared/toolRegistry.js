/**
 * Tool Registry — centralized validation and metadata for all agent tools
 *
 * Provides:
 * - Zod schema validation for tool arguments
 * - Tool metadata (timeout, retryable, dangerous)
 * - Future: OpenAI function definitions generation
 */

import { logger } from '../../lib/logger.js';

// Default metadata for tools without explicit config
const DEFAULT_METADATA = {
  timeout: 30000,     // 30 seconds
  retryable: true,    // Network errors can be retried
  maxRetries: 2,      // Up to 2 retries
  dangerous: false    // Not dangerous by default
};

/**
 * Tool Registry class
 * Singleton that stores all tool schemas and metadata
 */
class ToolRegistry {
  constructor() {
    // Map: toolName -> { schema: ZodSchema, description: string }
    this.schemas = new Map();

    // Map: toolName -> { timeout, retryable, maxRetries, dangerous }
    this.metadata = new Map();
  }

  /**
   * Register a single tool
   * @param {string} name - Tool name
   * @param {Object} definition - { description, schema, meta }
   */
  register(name, definition) {
    const { description, schema, meta = {} } = definition;

    if (schema) {
      this.schemas.set(name, { schema, description });
    }

    this.metadata.set(name, {
      ...DEFAULT_METADATA,
      ...meta
    });

    logger.debug({ tool: name, hasSсhema: !!schema }, 'Tool registered');
  }

  /**
   * Register multiple tools from a ToolDefs object
   * @param {Object} toolDefs - { toolName: { description, schema, meta } }
   */
  registerFromDefs(toolDefs) {
    for (const [name, definition] of Object.entries(toolDefs)) {
      this.register(name, definition);
    }

    logger.info({ count: Object.keys(toolDefs).length }, 'Tools registered from defs');
  }

  /**
   * Validate tool arguments against schema
   * @param {string} toolName - Name of the tool
   * @param {Object} args - Arguments to validate
   * @returns {{ success: true, data: Object } | { success: false, error: string }}
   */
  validate(toolName, args) {
    const entry = this.schemas.get(toolName);

    // No schema registered — pass through (backward compatibility)
    if (!entry) {
      return { success: true, data: args || {} };
    }

    const { schema } = entry;

    try {
      const result = schema.safeParse(args);

      if (!result.success) {
        // Format Zod errors into readable message
        const errors = result.error.issues.map(issue => {
          const path = issue.path.length > 0 ? issue.path.join('.') : 'value';
          return `${path}: ${issue.message}`;
        }).join('; ');

        return {
          success: false,
          error: `Invalid arguments: ${errors}`
        };
      }

      // Return parsed and transformed data
      return { success: true, data: result.data };

    } catch (error) {
      // Unexpected error during validation
      logger.error({ toolName, error: error.message }, 'Validation error');
      return {
        success: false,
        error: `Validation error: ${error.message}`
      };
    }
  }

  /**
   * Get metadata for a tool
   * @param {string} toolName - Name of the tool
   * @returns {Object} { timeout, retryable, maxRetries, dangerous }
   */
  getMetadata(toolName) {
    return this.metadata.get(toolName) || { ...DEFAULT_METADATA };
  }

  /**
   * Check if tool is registered
   * @param {string} toolName
   * @returns {boolean}
   */
  has(toolName) {
    return this.schemas.has(toolName) || this.metadata.has(toolName);
  }

  /**
   * Check if tool is dangerous (always requires approval)
   * @param {string} toolName
   * @returns {boolean}
   */
  isDangerous(toolName) {
    return this.getMetadata(toolName).dangerous === true;
  }

  /**
   * Check if tool is retryable
   * @param {string} toolName
   * @returns {boolean}
   */
  isRetryable(toolName) {
    return this.getMetadata(toolName).retryable !== false;
  }

  /**
   * Get all registered tool names
   * @returns {string[]}
   */
  getToolNames() {
    return [...new Set([...this.schemas.keys(), ...this.metadata.keys()])];
  }

  /**
   * Get stats about registered tools
   * @returns {Object}
   */
  getStats() {
    const names = this.getToolNames();
    return {
      total: names.length,
      withSchema: this.schemas.size,
      dangerous: names.filter(n => this.isDangerous(n)).length,
      nonRetryable: names.filter(n => !this.isRetryable(n)).length
    };
  }

  /**
   * Clear all registrations (for testing)
   */
  clear() {
    this.schemas.clear();
    this.metadata.clear();
  }
}

// Export singleton instance
export const toolRegistry = new ToolRegistry();

// Also export class for testing
export { ToolRegistry };

export default toolRegistry;
