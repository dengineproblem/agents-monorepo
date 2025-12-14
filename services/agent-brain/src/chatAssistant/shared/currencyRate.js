/**
 * Currency Rate Utilities
 * Helper functions for USD→KZT conversion with caching
 */

import { supabase } from '../../lib/supabaseClient.js';
import { logger } from '../../lib/logger.js';

// Default fallback rate if DB is unavailable
const DEFAULT_USD_KZT = 530;

// In-memory cache
let cachedRate = null;
let cacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour in ms

/**
 * Get current USD to KZT exchange rate
 * Uses in-memory cache with 1 hour TTL
 * @returns {Promise<number>} Exchange rate
 */
export async function getUsdToKzt() {
  // Return cached value if fresh
  if (cachedRate && Date.now() - cacheTime < CACHE_TTL) {
    return cachedRate;
  }

  try {
    const { data, error } = await supabase
      .from('currency_rates')
      .select('rate, updated_at')
      .eq('from_currency', 'USD')
      .eq('to_currency', 'KZT')
      .single();

    if (error) {
      logger.warn({ error: error.message }, 'Failed to get currency rate from DB, using default');
      return DEFAULT_USD_KZT;
    }

    cachedRate = parseFloat(data.rate) || DEFAULT_USD_KZT;
    cacheTime = Date.now();

    logger.debug({ rate: cachedRate, updatedAt: data.updated_at }, 'Currency rate loaded');
    return cachedRate;
  } catch (err) {
    logger.error({ error: err.message }, 'Error fetching currency rate');
    return DEFAULT_USD_KZT;
  }
}

/**
 * Convert USD to KZT
 * @param {number} usdAmount - Amount in USD
 * @param {number} [rate] - Optional rate override
 * @returns {number} Amount in KZT (rounded)
 */
export function convertUsdToKzt(usdAmount, rate = null) {
  const actualRate = rate || cachedRate || DEFAULT_USD_KZT;
  return Math.round(usdAmount * actualRate);
}

/**
 * Convert KZT to USD
 * @param {number} kztAmount - Amount in KZT
 * @param {number} [rate] - Optional rate override
 * @returns {number} Amount in USD
 */
export function convertKztToUsd(kztAmount, rate = null) {
  const actualRate = rate || cachedRate || DEFAULT_USD_KZT;
  return kztAmount / actualRate;
}

/**
 * Format amount with currency symbol
 * @param {number} amount - Amount
 * @param {string} currency - 'USD' or 'KZT'
 * @returns {string} Formatted string
 */
export function formatCurrency(amount, currency = 'KZT') {
  if (currency === 'USD') {
    return `$${amount.toFixed(2)}`;
  }
  // KZT formatting: 150K ₸ or 1.5M ₸
  if (amount >= 1000000) {
    return `${(amount / 1000000).toFixed(1)}M ₸`;
  }
  if (amount >= 1000) {
    return `${(amount / 1000).toFixed(0)}K ₸`;
  }
  return `${Math.round(amount)} ₸`;
}

/**
 * Invalidate cached rate (for testing or forced refresh)
 */
export function invalidateRateCache() {
  cachedRate = null;
  cacheTime = 0;
}

export default {
  getUsdToKzt,
  convertUsdToKzt,
  convertKztToUsd,
  formatCurrency,
  invalidateRateCache
};
