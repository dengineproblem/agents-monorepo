/**
 * Layer Logger for detailed debugging of Chat Assistant processing
 * Emits layer events for streaming when debug mode is enabled
 *
 * Layers (from ARCHITECTURE.md):
 * 1: HTTP Entry Point
 * 2: Orchestrator
 * 3: Meta Orchestrator
 * 4: Meta Tools
 * 5: Domain Router
 * 6: MCP Bridge
 * 7: MCP Executor
 * 8: Domain Handlers
 * 9: Domain Agents
 * 10: Response Assembly
 * 11: Persistence
 */

export const LAYER_NAMES = {
  1: 'HTTP Entry',
  2: 'Orchestrator',
  3: 'Meta Orchestrator',
  4: 'Meta Tools',
  5: 'Domain Router',
  6: 'MCP Bridge',
  7: 'MCP Executor',
  8: 'Domain Handlers',
  9: 'Domain Agents',
  10: 'Response Assembly',
  11: 'Persistence'
};

export class LayerLogger {
  /**
   * @param {Object} options
   * @param {boolean} options.enabled - Whether logging is enabled
   * @param {Function} options.emitter - Function to emit events (e.g., sendEvent for SSE)
   */
  constructor(options = {}) {
    this.enabled = options.enabled || false;
    this.emitter = options.emitter || null;
    this.layers = new Map(); // Map<layer, { startTime, data }>
    this.logs = []; // All logs for persistence
  }

  /**
   * Mark layer as started
   * @param {number} layer - Layer number (1-11)
   * @param {Object} data - Optional data to include
   */
  start(layer, data = {}) {
    if (!this.enabled) return;

    const event = {
      type: 'layer',
      layer,
      name: LAYER_NAMES[layer] || `Layer ${layer}`,
      status: 'start',
      data: this._sanitizeData(data),
      timestamp: Date.now()
    };

    this.layers.set(layer, { startTime: event.timestamp, data });
    this.logs.push(event);

    if (this.emitter) {
      try {
        this.emitter(event);
      } catch (err) {
        // Ignore emit errors
      }
    }
  }

  /**
   * Mark layer as ended
   * @param {number} layer - Layer number (1-11)
   * @param {Object} data - Optional data to include
   */
  end(layer, data = {}) {
    if (!this.enabled) return;

    const startInfo = this.layers.get(layer);
    const duration_ms = startInfo ? Date.now() - startInfo.startTime : 0;

    const event = {
      type: 'layer',
      layer,
      name: LAYER_NAMES[layer] || `Layer ${layer}`,
      status: 'end',
      data: this._sanitizeData(data),
      timestamp: Date.now(),
      duration_ms
    };

    this.layers.delete(layer);
    this.logs.push(event);

    if (this.emitter) {
      try {
        this.emitter(event);
      } catch (err) {
        // Ignore emit errors
      }
    }
  }

  /**
   * Mark layer as errored
   * @param {number} layer - Layer number (1-11)
   * @param {Error|string} error - Error that occurred
   * @param {Object} data - Optional data to include
   */
  error(layer, error, data = {}) {
    if (!this.enabled) return;

    const startInfo = this.layers.get(layer);
    const duration_ms = startInfo ? Date.now() - startInfo.startTime : 0;

    const event = {
      type: 'layer',
      layer,
      name: LAYER_NAMES[layer] || `Layer ${layer}`,
      status: 'error',
      error: error?.message || String(error),
      data: this._sanitizeData(data),
      timestamp: Date.now(),
      duration_ms
    };

    this.layers.delete(layer);
    this.logs.push(event);

    if (this.emitter) {
      try {
        this.emitter(event);
      } catch (err) {
        // Ignore emit errors
      }
    }
  }

  /**
   * Log an info event within a layer (for sub-steps)
   * @param {number} layer - Layer number (1-11)
   * @param {string} message - Info message
   * @param {Object} data - Optional data
   */
  info(layer, message, data = {}) {
    if (!this.enabled) return;

    const event = {
      type: 'layer',
      layer,
      name: LAYER_NAMES[layer] || `Layer ${layer}`,
      status: 'info',
      message,
      data: this._sanitizeData(data),
      timestamp: Date.now()
    };

    this.logs.push(event);

    if (this.emitter) {
      try {
        this.emitter(event);
      } catch (err) {
        // Ignore emit errors
      }
    }
  }

  /**
   * Get all collected logs (for persistence)
   * @returns {Array} All log events
   */
  getAllLogs() {
    return this.logs;
  }

  /**
   * Sanitize data to prevent circular references and large objects
   * @param {Object} data
   * @returns {Object}
   */
  _sanitizeData(data) {
    if (!data || typeof data !== 'object') return data;

    try {
      // Limit depth and size
      const sanitized = {};
      const keys = Object.keys(data).slice(0, 20); // Max 20 keys

      for (const key of keys) {
        const value = data[key];

        // Skip functions and symbols
        if (typeof value === 'function' || typeof value === 'symbol') continue;

        // Truncate long strings
        if (typeof value === 'string') {
          sanitized[key] = value.length > 500 ? value.substring(0, 500) + '...' : value;
        }
        // Truncate arrays
        else if (Array.isArray(value)) {
          sanitized[key] = value.slice(0, 10).map(v =>
            typeof v === 'string' && v.length > 100 ? v.substring(0, 100) + '...' : v
          );
          if (value.length > 10) {
            sanitized[key].push(`... and ${value.length - 10} more`);
          }
        }
        // Shallow copy objects (one level)
        else if (typeof value === 'object' && value !== null) {
          sanitized[key] = `[Object: ${Object.keys(value).slice(0, 5).join(', ')}${Object.keys(value).length > 5 ? '...' : ''}]`;
        }
        else {
          sanitized[key] = value;
        }
      }

      return sanitized;
    } catch (err) {
      return { _error: 'Failed to sanitize data' };
    }
  }

  /**
   * Check if logging is enabled
   * @returns {boolean}
   */
  isEnabled() {
    return this.enabled;
  }
}

/**
 * Create a no-op logger for when logging is disabled
 * @returns {Object} Logger with no-op methods
 */
export function createNoOpLogger() {
  return {
    start: () => {},
    end: () => {},
    error: () => {},
    info: () => {},
    getAllLogs: () => [],
    isEnabled: () => false
  };
}

export default LayerLogger;
