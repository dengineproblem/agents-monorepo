/**
 * Currency Rate CRON Job
 * Updates USD→KZT exchange rate daily from external API
 *
 * Run manually: node currencyRateCron.js
 * Or via cron: 0 6 * * * node /path/to/currencyRateCron.js
 */

import { supabase } from './lib/supabaseClient.js';

const API_URL = 'https://api.exchangerate-api.com/v4/latest/USD';

async function updateCurrencyRates() {
  console.log('[CRON] Starting currency rate update...');

  try {
    // Fetch latest rates from external API
    const response = await fetch(API_URL);

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const data = await response.json();
    const kztRate = data.rates?.KZT;

    if (!kztRate || typeof kztRate !== 'number') {
      throw new Error('Invalid KZT rate in API response');
    }

    console.log(`[CRON] Got USD→KZT rate: ${kztRate}`);

    // Update in database
    const { data: updated, error } = await supabase
      .from('currency_rates')
      .upsert(
        {
          from_currency: 'USD',
          to_currency: 'KZT',
          rate: kztRate,
          source: 'exchangerate-api',
          updated_at: new Date().toISOString()
        },
        {
          onConflict: 'from_currency,to_currency'
        }
      )
      .select()
      .single();

    if (error) {
      throw new Error(`Database update failed: ${error.message}`);
    }

    console.log(`[CRON] USD→KZT rate updated successfully: ${updated.rate}`);
    return { success: true, rate: updated.rate };

  } catch (error) {
    console.error(`[CRON] Failed to update currency rate: ${error.message}`);

    // Don't throw - we'll use the old rate
    return { success: false, error: error.message };
  }
}

// Run if called directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  updateCurrencyRates()
    .then(result => {
      console.log('[CRON] Done:', result);
      process.exit(result.success ? 0 : 1);
    })
    .catch(err => {
      console.error('[CRON] Fatal error:', err);
      process.exit(1);
    });
}

export { updateCurrencyRates };
