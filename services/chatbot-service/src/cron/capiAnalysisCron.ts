import cron from 'node-cron';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import {
  getDialogForCapi,
  processDialogForCapi,
} from '../lib/qualificationAgent.js';

const log = createLogger({ module: 'capiAnalysisCron' });

// Configuration from ENV
const CAPI_CRON_ENABLED = process.env.CAPI_CRON_ENABLED !== 'false';
const CAPI_CRON_SCHEDULE = process.env.CAPI_CRON_SCHEDULE || '0 * * * *'; // Every hour
const CAPI_CRON_BATCH_SIZE = Number(process.env.CAPI_CRON_BATCH_SIZE) || 50;
const CAPI_CRON_ACTIVITY_WINDOW = Number(process.env.CAPI_CRON_ACTIVITY_WINDOW) || 60; // minutes
const CAPI_CRON_DELAY_MS = Number(process.env.CAPI_CRON_DELAY_MS) || 100; // delay between API calls

// Lock to prevent concurrent execution
let isRunning = false;

interface DialogForAnalysis {
  id: string;
  user_account_id: string;
  instance_name: string;
  contact_phone: string;
  direction_id: string;
  incoming_count: number;
  last_message: string;
  direction_name?: string;
}

interface CronStats {
  found: number;
  processed: number;
  skipped: number;
  errors: number;
  durationMs: number;
}

/**
 * Get dialogs that need CAPI Level 2-3 analysis
 * Criteria:
 * - Interest sent (Level 1 confirmed)
 * - No Qualified or Scheduled yet
 * - Had activity in the last hour
 * - Has direction_id with capi_enabled = true
 */
async function getDialogsForCapiAnalysis(): Promise<DialogForAnalysis[]> {
  const activityThreshold = new Date(Date.now() - CAPI_CRON_ACTIVITY_WINDOW * 60 * 1000).toISOString();

  log.debug({
    activityThreshold,
    batchSize: CAPI_CRON_BATCH_SIZE,
  }, 'Querying dialogs for CAPI analysis');

  // Query with JOIN to check capi_enabled on direction level
  const { data: dialogs, error } = await supabase
    .from('dialog_analysis')
    .select(`
      id,
      user_account_id,
      instance_name,
      contact_phone,
      direction_id,
      incoming_count,
      last_message,
      account_directions!inner (
        name,
        capi_enabled,
        capi_source
      )
    `)
    .eq('capi_interest_sent', true)
    .eq('capi_qualified_sent', false)
    .eq('capi_scheduled_sent', false)
    .not('direction_id', 'is', null)
    .gte('last_message', activityThreshold)
    .eq('account_directions.capi_enabled', true)
    .order('last_message', { ascending: false })
    .limit(CAPI_CRON_BATCH_SIZE);

  if (error) {
    log.error({
      error: error.message,
      code: error.code,
      details: error.details,
    }, 'Error fetching dialogs for CAPI analysis');
    return [];
  }

  // Transform to flat structure
  const result = (dialogs || []).map((d: any) => ({
    id: d.id,
    user_account_id: d.user_account_id,
    instance_name: d.instance_name,
    contact_phone: d.contact_phone,
    direction_id: d.direction_id,
    incoming_count: d.incoming_count,
    last_message: d.last_message,
    direction_name: d.account_directions?.name,
  }));

  log.debug({
    count: result.length,
    activityThreshold,
  }, 'Dialogs query completed');

  return result;
}

/**
 * Process a single dialog for CAPI Level 2-3 events
 * Uses processDialogForCapi from qualificationAgent which handles both WhatsApp and CRM sources
 */
async function processDialogForCapiCron(
  dialogInfo: DialogForAnalysis
): Promise<{ processed: boolean; skipped: boolean; error?: string }> {
  const startTime = Date.now();

  try {
    log.info({
      dialogId: dialogInfo.id,
      contactPhone: dialogInfo.contact_phone,
      directionId: dialogInfo.direction_id,
      directionName: dialogInfo.direction_name,
      incomingCount: dialogInfo.incoming_count,
      lastMessage: dialogInfo.last_message,
    }, 'Starting CAPI analysis for dialog');

    // Get full dialog data with messages
    const dialog = await getDialogForCapi(dialogInfo.instance_name, dialogInfo.contact_phone);

    if (!dialog) {
      log.warn({
        dialogId: dialogInfo.id,
        contactPhone: dialogInfo.contact_phone,
        instanceName: dialogInfo.instance_name,
      }, 'Dialog not found in getDialogForCapi - may have been deleted');
      return { processed: false, skipped: true, error: 'dialog_not_found' };
    }

    log.debug({
      dialogId: dialog.id,
      messagesCount: dialog.messages?.length || 0,
      hasCtwaClid: !!dialog.ctwa_clid,
      hasLeadId: !!dialog.lead_id,
    }, 'Dialog data loaded, starting processDialogForCapi');

    // Use existing processDialogForCapi which handles:
    // - Direction CAPI settings check
    // - WhatsApp source: AI analysis via GPT-4o-mini
    // - CRM source: field matching from leads table
    // - Sending CAPI events atomically
    await processDialogForCapi(dialog);

    const durationMs = Date.now() - startTime;

    log.info({
      dialogId: dialogInfo.id,
      contactPhone: dialogInfo.contact_phone,
      directionName: dialogInfo.direction_name,
      durationMs,
    }, 'CAPI analysis completed for dialog');

    return { processed: true, skipped: false };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const durationMs = Date.now() - startTime;

    log.error({
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      dialogId: dialogInfo.id,
      contactPhone: dialogInfo.contact_phone,
      directionId: dialogInfo.direction_id,
      durationMs,
    }, 'Error processing dialog for CAPI cron');

    return { processed: false, skipped: false, error: errorMessage };
  }
}

/**
 * Sleep helper for rate limiting
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Core processing logic shared between scheduled and manual runs
 */
async function processDialogsBatch(dialogs: DialogForAnalysis[]): Promise<CronStats> {
  const startTime = Date.now();

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < dialogs.length; i++) {
    const dialog = dialogs[i];
    const progress = `${i + 1}/${dialogs.length}`;

    log.debug({
      dialogId: dialog.id,
      contactPhone: dialog.contact_phone,
      progress,
    }, 'Processing dialog');

    const result = await processDialogForCapiCron(dialog);

    if (result.processed) processed++;
    if (result.skipped) skipped++;
    if (result.error && !result.skipped) errors++;

    // Rate limiting delay between dialogs
    if (i < dialogs.length - 1) {
      await sleep(CAPI_CRON_DELAY_MS);
    }
  }

  const durationMs = Date.now() - startTime;

  return {
    found: dialogs.length,
    processed,
    skipped,
    errors,
    durationMs,
  };
}

/**
 * Main cron job function
 */
async function runCapiAnalysisCron(): Promise<void> {
  // Prevent concurrent execution
  if (isRunning) {
    log.warn('CAPI analysis cron is already running, skipping this execution');
    return;
  }

  isRunning = true;
  const startTime = Date.now();

  log.info({
    batchSize: CAPI_CRON_BATCH_SIZE,
    activityWindow: `${CAPI_CRON_ACTIVITY_WINDOW} minutes`,
    schedule: CAPI_CRON_SCHEDULE,
  }, '=== Starting CAPI analysis cron ===');

  try {
    const dialogs = await getDialogsForCapiAnalysis();

    if (dialogs.length === 0) {
      log.info({
        activityWindow: `${CAPI_CRON_ACTIVITY_WINDOW} minutes`,
      }, 'No dialogs found for CAPI analysis');
      return;
    }

    log.info({
      count: dialogs.length,
      dialogs: dialogs.map(d => ({
        id: d.id,
        phone: d.contact_phone,
        direction: d.direction_name,
        lastMessage: d.last_message,
      })),
    }, 'Found dialogs for CAPI analysis');

    const stats = await processDialogsBatch(dialogs);

    log.info({
      ...stats,
      avgTimePerDialog: Math.round(stats.durationMs / stats.found),
    }, '=== CAPI analysis cron completed ===');

  } catch (error) {
    const durationMs = Date.now() - startTime;
    log.error({
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      durationMs,
    }, '=== CAPI analysis cron failed ===');
  } finally {
    isRunning = false;
  }
}

/**
 * Start the CAPI analysis cron job
 */
export function startCapiAnalysisCron(): void {
  if (!CAPI_CRON_ENABLED) {
    log.info('CAPI analysis cron is disabled (CAPI_CRON_ENABLED=false)');
    return;
  }

  log.info({
    schedule: CAPI_CRON_SCHEDULE,
    batchSize: CAPI_CRON_BATCH_SIZE,
    activityWindow: `${CAPI_CRON_ACTIVITY_WINDOW} minutes`,
    delayMs: CAPI_CRON_DELAY_MS,
  }, 'Initializing CAPI analysis cron');

  cron.schedule(CAPI_CRON_SCHEDULE, async () => {
    await runCapiAnalysisCron();
  });

  console.log(`[capiAnalysisCron] CAPI analysis cron scheduled (${CAPI_CRON_SCHEDULE})`);
}

/**
 * Manual trigger for testing
 * Returns detailed stats about the run
 */
export async function triggerCapiAnalysisCron(): Promise<CronStats> {
  // Check if already running
  if (isRunning) {
    log.warn('CAPI analysis cron is already running, cannot trigger manually');
    return {
      found: 0,
      processed: 0,
      skipped: 0,
      errors: 0,
      durationMs: 0,
    };
  }

  isRunning = true;

  log.info({
    batchSize: CAPI_CRON_BATCH_SIZE,
    activityWindow: `${CAPI_CRON_ACTIVITY_WINDOW} minutes`,
  }, '=== Manual trigger of CAPI analysis cron ===');

  try {
    const dialogs = await getDialogsForCapiAnalysis();

    if (dialogs.length === 0) {
      log.info('No dialogs found for manual CAPI analysis');
      return {
        found: 0,
        processed: 0,
        skipped: 0,
        errors: 0,
        durationMs: 0,
      };
    }

    log.info({
      count: dialogs.length,
    }, 'Found dialogs for manual CAPI analysis');

    const stats = await processDialogsBatch(dialogs);

    log.info({
      ...stats,
    }, '=== Manual CAPI analysis completed ===');

    return stats;
  } catch (error) {
    log.error({
      error: error instanceof Error ? error.message : String(error),
    }, '=== Manual CAPI analysis failed ===');

    return {
      found: 0,
      processed: 0,
      skipped: 0,
      errors: 1,
      durationMs: 0,
    };
  } finally {
    isRunning = false;
  }
}
