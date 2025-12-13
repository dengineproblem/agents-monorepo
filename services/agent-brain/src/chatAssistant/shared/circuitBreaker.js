/**
 * Circuit Breaker Pattern Implementation
 *
 * Protects against cascading failures by stopping requests
 * when a service is experiencing high error rates.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Failures exceeded threshold, requests are rejected immediately
 * - HALF_OPEN: Testing if service recovered, limited requests allowed
 */

import { logger } from '../../lib/logger.js';

// Circuit Breaker States
export const CircuitState = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN'
};

// Default configuration
const DEFAULT_CONFIG = {
  failureThreshold: 5,          // Number of failures before opening
  successThreshold: 2,          // Number of successes in HALF_OPEN to close
  timeout: 30000,               // Time in ms before trying HALF_OPEN (30 sec)
  volumeThreshold: 5,           // Minimum requests before calculating failure rate
  failureRateThreshold: 50,     // Percentage of failures to trip the circuit
  halfOpenMaxAttempts: 3        // Max concurrent requests in HALF_OPEN
};

/**
 * Circuit Breaker class
 */
export class CircuitBreaker {
  constructor(name, config = {}) {
    this.name = name;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // State
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.halfOpenAttempts = 0;

    // Metrics for failure rate calculation
    this.requestCount = 0;
    this.recentFailures = [];  // Timestamps of recent failures
    this.windowMs = 60000;     // 1 minute window for failure rate
  }

  /**
   * Execute a function with circuit breaker protection
   * @param {Function} fn - Async function to execute
   * @returns {Promise<any>}
   * @throws {CircuitOpenError} when circuit is open
   */
  async execute(fn) {
    // Check if circuit should transition from OPEN to HALF_OPEN
    this._checkTimeout();

    // Reject immediately if circuit is OPEN
    if (this.state === CircuitState.OPEN) {
      logger.warn({
        circuit: this.name,
        state: this.state,
        failureCount: this.failureCount,
        lastFailure: this.lastFailureTime
      }, 'Circuit breaker is OPEN, rejecting request');

      throw new CircuitOpenError(
        `Circuit breaker "${this.name}" is OPEN. Service temporarily unavailable.`,
        this.name,
        this._getTimeUntilHalfOpen()
      );
    }

    // In HALF_OPEN, limit concurrent attempts
    if (this.state === CircuitState.HALF_OPEN) {
      if (this.halfOpenAttempts >= this.config.halfOpenMaxAttempts) {
        throw new CircuitOpenError(
          `Circuit breaker "${this.name}" is testing recovery, please wait.`,
          this.name,
          5000  // Short wait time in half-open
        );
      }
      this.halfOpenAttempts++;
    }

    try {
      this.requestCount++;
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (error) {
      this._onFailure(error);
      throw error;
    }
  }

  /**
   * Handle successful execution
   * @private
   */
  _onSuccess() {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      this.halfOpenAttempts = Math.max(0, this.halfOpenAttempts - 1);

      logger.debug({
        circuit: this.name,
        successCount: this.successCount,
        threshold: this.config.successThreshold
      }, 'Success in HALF_OPEN state');

      // Enough successes to close the circuit
      if (this.successCount >= this.config.successThreshold) {
        this._transitionTo(CircuitState.CLOSED);
      }
    } else if (this.state === CircuitState.CLOSED) {
      // Reset failure count on success in closed state
      // (failures only matter in a sequence)
      this.failureCount = 0;
    }
  }

  /**
   * Handle failed execution
   * @private
   */
  _onFailure(error) {
    const now = Date.now();
    this.lastFailureTime = now;
    this.failureCount++;

    // Track recent failures for rate calculation
    this.recentFailures.push(now);
    this._cleanupOldFailures();

    if (this.state === CircuitState.HALF_OPEN) {
      this.halfOpenAttempts = Math.max(0, this.halfOpenAttempts - 1);
      // Any failure in HALF_OPEN opens the circuit again
      logger.warn({
        circuit: this.name,
        error: error.message
      }, 'Failure in HALF_OPEN, reopening circuit');
      this._transitionTo(CircuitState.OPEN);
      return;
    }

    // In CLOSED state, check if we should open
    if (this.state === CircuitState.CLOSED) {
      const shouldOpen = this._shouldOpenCircuit();

      if (shouldOpen) {
        logger.warn({
          circuit: this.name,
          failureCount: this.failureCount,
          recentFailures: this.recentFailures.length,
          error: error.message
        }, 'Opening circuit due to failures');
        this._transitionTo(CircuitState.OPEN);
      }
    }
  }

  /**
   * Check if circuit should open based on failures
   * @private
   */
  _shouldOpenCircuit() {
    // Simple threshold check
    if (this.failureCount >= this.config.failureThreshold) {
      return true;
    }

    // Failure rate check (if we have enough volume)
    if (this.requestCount >= this.config.volumeThreshold) {
      const failureRate = (this.recentFailures.length / this.requestCount) * 100;
      if (failureRate >= this.config.failureRateThreshold) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if timeout passed and should try HALF_OPEN
   * @private
   */
  _checkTimeout() {
    if (this.state === CircuitState.OPEN && this.lastFailureTime) {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.config.timeout) {
        logger.info({
          circuit: this.name,
          elapsed,
          timeout: this.config.timeout
        }, 'Circuit timeout elapsed, transitioning to HALF_OPEN');
        this._transitionTo(CircuitState.HALF_OPEN);
      }
    }
  }

  /**
   * Get time until circuit will try HALF_OPEN
   * @private
   */
  _getTimeUntilHalfOpen() {
    if (this.state !== CircuitState.OPEN || !this.lastFailureTime) {
      return 0;
    }
    const elapsed = Date.now() - this.lastFailureTime;
    return Math.max(0, this.config.timeout - elapsed);
  }

  /**
   * Transition to a new state
   * @private
   */
  _transitionTo(newState) {
    const oldState = this.state;
    this.state = newState;

    logger.info({
      circuit: this.name,
      from: oldState,
      to: newState
    }, 'Circuit breaker state transition');

    // Reset counters on state change
    if (newState === CircuitState.CLOSED) {
      this.failureCount = 0;
      this.successCount = 0;
      this.requestCount = 0;
      this.recentFailures = [];
    } else if (newState === CircuitState.HALF_OPEN) {
      this.successCount = 0;
      this.halfOpenAttempts = 0;
    } else if (newState === CircuitState.OPEN) {
      this.successCount = 0;
    }
  }

  /**
   * Clean up failures outside the time window
   * @private
   */
  _cleanupOldFailures() {
    const cutoff = Date.now() - this.windowMs;
    this.recentFailures = this.recentFailures.filter(t => t > cutoff);
  }

  /**
   * Get current state for monitoring
   */
  getState() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      requestCount: this.requestCount,
      recentFailures: this.recentFailures.length,
      lastFailureTime: this.lastFailureTime,
      timeUntilHalfOpen: this._getTimeUntilHalfOpen()
    };
  }

  /**
   * Manually reset the circuit (for admin/testing)
   */
  reset() {
    logger.info({ circuit: this.name }, 'Circuit breaker manually reset');
    this._transitionTo(CircuitState.CLOSED);
  }
}

/**
 * Error thrown when circuit is open
 */
export class CircuitOpenError extends Error {
  constructor(message, circuitName, retryAfterMs) {
    super(message);
    this.name = 'CircuitOpenError';
    this.circuitName = circuitName;
    this.retryAfterMs = retryAfterMs;
    this.isCircuitOpen = true;
  }
}

// ============================================================
// Circuit Breaker Registry (Singleton instances for each service)
// ============================================================

const circuitRegistry = new Map();

/**
 * Get or create a circuit breaker for a named service
 * @param {string} name - Service name (e.g., 'facebook', 'supabase')
 * @param {Object} config - Optional config override
 * @returns {CircuitBreaker}
 */
export function getCircuitBreaker(name, config = {}) {
  if (!circuitRegistry.has(name)) {
    circuitRegistry.set(name, new CircuitBreaker(name, config));
  }
  return circuitRegistry.get(name);
}

/**
 * Execute function with circuit breaker by name
 * Convenience wrapper for getCircuitBreaker(name).execute(fn)
 *
 * @param {string} name - Circuit breaker name
 * @param {Function} fn - Async function to execute
 * @param {Object} config - Optional config for new circuit
 * @returns {Promise<any>}
 */
export async function withCircuitBreaker(name, fn, config = {}) {
  const breaker = getCircuitBreaker(name, config);
  return breaker.execute(fn);
}

/**
 * Get all circuit breakers' states (for monitoring)
 */
export function getAllCircuitStates() {
  const states = {};
  for (const [name, breaker] of circuitRegistry) {
    states[name] = breaker.getState();
  }
  return states;
}

/**
 * Reset a circuit breaker by name
 */
export function resetCircuit(name) {
  const breaker = circuitRegistry.get(name);
  if (breaker) {
    breaker.reset();
    return true;
  }
  return false;
}

export default {
  CircuitBreaker,
  CircuitOpenError,
  CircuitState,
  getCircuitBreaker,
  withCircuitBreaker,
  getAllCircuitStates,
  resetCircuit
};
