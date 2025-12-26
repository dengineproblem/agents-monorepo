#!/usr/bin/env tsx
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

/**
 * BATCH INSIGHTS SYNC
 *
 * Массовая синхронизация и анализ Ad Insights для всех аккаунтов.
 *
 * Usage:
 *   npx tsx src/scripts/batchInsightsSync.ts [options]
 *
 * Options:
 *   --workers <n>      Параллельных воркеров (default: 5)
 *   --limit <n>        Лимит аккаунтов
 *   --resume <id>      Продолжить существующий job
 *   --dry-run          Только план, без выполнения
 *   --pause-ms <ms>    Пауза между аккаунтами (default: 10000)
 *   --skip-fullsync    Пропустить fullSync
 *   --skip-daily       Пропустить daily enrichment
 *   --skip-burnout     Пропустить burnout predictions
 *   --verbose          Подробный вывод
 *   --help             Показать справку
 */

const HELP_TEXT = `
Batch Insights Sync - Массовая синхронизация Ad Insights

Usage:
  npx tsx src/scripts/batchInsightsSync.ts [options]

Options:
  --workers <n>      Параллельных воркеров (default: 5)
  --limit <n>        Лимит аккаунтов для обработки
  --resume <id>      Продолжить существующий batch job
  --dry-run          Показать план без выполнения
  --pause-ms <ms>    Пауза между аккаунтами в мс (default: 10000)
  --skip-fullsync    Пропустить синхронизацию с FB API
  --skip-daily       Пропустить daily breakdown enrichment
  --skip-burnout     Пропустить burnout predictions
  --verbose          Подробный вывод
  --help             Показать эту справку

Examples:
  # Запуск с 10 воркерами
  npx tsx src/scripts/batchInsightsSync.ts --workers 10

  # Dry run для 50 аккаунтов
  npx tsx src/scripts/batchInsightsSync.ts --limit 50 --dry-run

  # Продолжить прерванный job
  npx tsx src/scripts/batchInsightsSync.ts --resume <job_id>
`;

// Early exit for --help
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(HELP_TEXT);
  process.exit(0);
}

// Services will be loaded dynamically
let supabase: any;
let log: any;
let fullSync: any;
let normalizeAllResults: any;
let ensureClickFamily: any;
let processAdAccount: any;
let predictAllAds: any;
let predictAllRecovery: any;
let enrichDailyBreakdown: any;

async function loadDependencies(): Promise<void> {
  const supabaseModule = await import('../lib/supabaseClient.js');
  supabase = supabaseModule.supabase;

  const loggerModule = await import('../lib/logger.js');
  log = loggerModule.createLogger({ module: 'batchInsightsSync' });

  const adInsightsSyncModule = await import('../services/adInsightsSync.js');
  fullSync = adInsightsSyncModule.fullSync;

  const normalizerModule = await import('../services/resultNormalizer.js');
  normalizeAllResults = normalizerModule.normalizeAllResults;
  ensureClickFamily = normalizerModule.ensureClickFamily;

  const anomalyDetectorModule = await import('../services/anomalyDetector.js');
  processAdAccount = anomalyDetectorModule.processAdAccount;

  const burnoutModule = await import('../services/burnoutAnalyzer.js');
  predictAllAds = burnoutModule.predictAllAds;
  predictAllRecovery = burnoutModule.predictAllRecovery;

  const dailyModule = await import('../services/dailyBreakdownEnricher.js');
  enrichDailyBreakdown = dailyModule.enrichDailyBreakdown;
}

// ============================================================================
// TYPES
// ============================================================================

interface BatchJobConfig {
  workers: number;
  limit?: number;
  resumeJobId?: string;
  dryRun: boolean;
  pauseMs: number;
  skipFullsync: boolean;
  skipDailyEnrichment: boolean;
  skipBurnout: boolean;
  verbose: boolean;
}

interface AdAccount {
  id: string;  // For multi-account: ad_accounts.id, for legacy: user_accounts.id
  user_account_id: string;
  ad_account_id: string;  // FB ad account ID (act_xxx)
  business_id: string | null;
  access_token: string;
  is_active: boolean;
  connection_status: string;
  is_legacy: boolean;  // true for legacy mode (credentials in user_accounts)
}

interface BusinessGroup {
  businessId: string;
  accounts: AdAccount[];
}

interface AccountResult {
  success: boolean;
  error?: string;
  errorType?: 'token_invalid' | 'rate_limited' | 'network_error' | 'data_error' | 'unknown';
  duration: number;
  stats: {
    campaigns?: number;
    adsets?: number;
    ads?: number;
    insights?: number;
    anomalies?: number;
    predictions?: number;
    normalizedResults?: number;
  };
}

interface BatchJob {
  id: string;
  status: string;
  total_accounts: number;
  processed_accounts: number;
  failed_accounts: number;
  skipped_accounts: number;
  params: BatchJobConfig;
  started_at: string | null;
}

// ============================================================================
// CLI PARSING
// ============================================================================

function parseArgs(): BatchJobConfig {
  const args = process.argv.slice(2);

  const getArg = (name: string): string | undefined => {
    const idx = args.indexOf(name);
    if (idx !== -1 && idx + 1 < args.length) {
      return args[idx + 1];
    }
    return undefined;
  };

  return {
    workers: parseInt(getArg('--workers') || '5', 10),
    limit: getArg('--limit') ? parseInt(getArg('--limit')!, 10) : undefined,
    resumeJobId: getArg('--resume'),
    dryRun: args.includes('--dry-run'),
    pauseMs: parseInt(getArg('--pause-ms') || '10000', 10),
    skipFullsync: args.includes('--skip-fullsync'),
    skipDailyEnrichment: args.includes('--skip-daily'),
    skipBurnout: args.includes('--skip-burnout'),
    verbose: args.includes('--verbose'),
  };
}

// ============================================================================
// UTILITIES
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

function formatTime(date: Date): string {
  return date.toTimeString().slice(0, 8);
}

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

async function getAllAccounts(limit?: number): Promise<AdAccount[]> {
  const accounts: AdAccount[] = [];

  // 1. Multi-account: аккаунты из ad_accounts (для пользователей с multi_account_enabled = true)
  const { data: multiAccounts, error: multiError } = await supabase
    .from('ad_accounts')
    .select(`
      id, user_account_id, ad_account_id, business_id, access_token, is_active, connection_status,
      user_accounts!inner(multi_account_enabled)
    `)
    .eq('user_accounts.multi_account_enabled', true)
    .not('access_token', 'is', null)
    .not('ad_account_id', 'is', null);

  if (multiError) {
    throw new Error(`Failed to fetch multi accounts: ${multiError.message}`);
  }

  // Добавляем multi-account
  for (const acc of multiAccounts || []) {
    accounts.push({
      id: acc.id,
      user_account_id: acc.user_account_id,
      ad_account_id: acc.ad_account_id,
      business_id: acc.business_id,
      access_token: acc.access_token,
      is_active: acc.is_active,
      connection_status: acc.connection_status,
      is_legacy: false,
    });
  }

  // 2. Legacy: аккаунты напрямую из user_accounts (credentials в user_accounts)
  const { data: legacyUsers, error: legacyError } = await supabase
    .from('user_accounts')
    .select('id, ad_account_id, access_token, username')
    .or('multi_account_enabled.is.null,multi_account_enabled.eq.false')
    .not('access_token', 'is', null)
    .not('ad_account_id', 'is', null)
    .neq('ad_account_id', '');

  if (legacyError) {
    log.warn({ error: legacyError }, 'Failed to fetch legacy users');
  }

  // Добавляем legacy аккаунты напрямую (без создания записей в ad_accounts)
  for (const user of legacyUsers || []) {
    // Проверяем валидность ad_account_id
    if (!user.ad_account_id.startsWith('act_')) {
      continue;
    }

    accounts.push({
      id: user.id,  // Используем user_account_id как id для legacy
      user_account_id: user.id,
      ad_account_id: user.ad_account_id,
      business_id: null,
      access_token: user.access_token,
      is_active: true,
      connection_status: 'connected',
      is_legacy: true,
    });
  }

  // Применяем лимит
  if (limit && accounts.length > limit) {
    return accounts.slice(0, limit);
  }

  return accounts;
}

async function getAccountsToProcess(jobId: string, limit?: number): Promise<AdAccount[]> {
  // Получаем уже обработанные аккаунты
  const { data: logs } = await supabase
    .from('batch_sync_account_log')
    .select('ad_account_id, status, error_type, attempts')
    .eq('batch_job_id', jobId);

  type LogEntry = { ad_account_id: string; status: string; error_type: string | null; attempts: number | null };

  const completedIds = new Set(
    logs?.filter((l: LogEntry) => l.status === 'completed').map((l: LogEntry) => l.ad_account_id)
  );

  // Аккаунты для retry (network/rate_limit ошибки с attempts < 3)
  const retryIds = new Set(
    logs
      ?.filter((l: LogEntry) =>
        l.status === 'failed' &&
        ['network_error', 'rate_limited'].includes(l.error_type || '') &&
        (l.attempts || 0) < 3
      )
      .map((l: LogEntry) => l.ad_account_id)
  );

  // Получаем все аккаунты
  const allAccounts = await getAllAccounts(limit);

  // Фильтруем: не обработанные + retry
  return allAccounts.filter(a =>
    !completedIds.has(a.id) || retryIds.has(a.id)
  );
}

async function createBatchJob(config: BatchJobConfig, totalAccounts: number): Promise<BatchJob> {
  const { data, error } = await supabase
    .from('batch_sync_jobs')
    .insert({
      job_type: 'full_insights_sync',
      status: 'pending',
      total_accounts: totalAccounts,
      params: config,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create batch job: ${error.message}`);
  }

  return data;
}

async function loadExistingJob(jobId: string): Promise<BatchJob> {
  const { data, error } = await supabase
    .from('batch_sync_jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (error || !data) {
    throw new Error(`Batch job not found: ${jobId}`);
  }

  return data;
}

async function updateJobStatus(jobId: string, status: string, extra?: Record<string, any>): Promise<void> {
  const update: Record<string, any> = {
    status,
    last_activity_at: new Date().toISOString(),
    ...extra,
  };

  if (status === 'running' && !extra?.started_at) {
    update.started_at = new Date().toISOString();
  }
  if (status === 'completed' || status === 'failed') {
    update.completed_at = new Date().toISOString();
  }

  await supabase
    .from('batch_sync_jobs')
    .update(update)
    .eq('id', jobId);
}

async function updateJobProgress(jobId: string, processed: number, failed: number, skipped: number): Promise<void> {
  await supabase
    .from('batch_sync_jobs')
    .update({
      processed_accounts: processed,
      failed_accounts: failed,
      skipped_accounts: skipped,
      last_activity_at: new Date().toISOString(),
    })
    .eq('id', jobId);
}

async function createAccountLog(jobId: string, accountId: string): Promise<void> {
  await supabase
    .from('batch_sync_account_log')
    .upsert({
      batch_job_id: jobId,
      ad_account_id: accountId,
      status: 'pending',
      attempts: 0,
    }, {
      onConflict: 'batch_job_id,ad_account_id',
    });
}

async function updateAccountLog(
  jobId: string,
  accountId: string,
  updates: {
    status?: string;
    step_fullsync?: string;
    step_features?: string;
    step_anomalies?: string;
    step_daily?: string;
    step_burnout?: string;
    result_summary?: Record<string, any>;
    last_error?: string;
    error_type?: string;
    started_at?: string;
    completed_at?: string;
    duration_seconds?: number;
    worker_id?: number;
  }
): Promise<void> {
  // Increment attempts if failed
  if (updates.status === 'failed') {
    // Get current attempts and increment
    const { data } = await supabase
      .from('batch_sync_account_log')
      .select('attempts')
      .eq('batch_job_id', jobId)
      .eq('ad_account_id', accountId)
      .single();

    (updates as any).attempts = (data?.attempts || 0) + 1;
  }

  await supabase
    .from('batch_sync_account_log')
    .update(updates)
    .eq('batch_job_id', jobId)
    .eq('ad_account_id', accountId);
}

// ============================================================================
// ERROR CLASSIFICATION
// ============================================================================

function classifyError(error: any): AccountResult['errorType'] {
  const message = (error.message || '').toLowerCase();

  // Token errors
  if (
    message.includes('oauthexception') ||
    message.includes('invalid oauth') ||
    message.includes('access token') ||
    message.includes('session has expired') ||
    message.includes('error validating') ||
    message.includes('user has not authorized')
  ) {
    return 'token_invalid';
  }

  // Rate limit
  if (
    message.includes('rate limit') ||
    message.includes('too many calls') ||
    message.includes('user request limit') ||
    message.includes('application request limit')
  ) {
    return 'rate_limited';
  }

  // Network
  if (
    message.includes('fetch failed') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('enotfound') ||
    message.includes('network') ||
    message.includes('socket hang up') ||
    message.includes('connection refused')
  ) {
    return 'network_error';
  }

  // Data errors
  if (
    message.includes('no data') ||
    message.includes('not found') ||
    message.includes('does not exist') ||
    message.includes('invalid id')
  ) {
    return 'data_error';
  }

  return 'unknown';
}

// ============================================================================
// BUSINESS GROUPING
// ============================================================================

function groupByBusiness(accounts: AdAccount[]): BusinessGroup[] {
  const groups = new Map<string, AdAccount[]>();

  for (const account of accounts) {
    // Если нет business_id, используем account.id как уникальную группу
    const key = account.business_id || `solo_${account.id}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(account);
  }

  return Array.from(groups.entries())
    .map(([businessId, accounts]) => ({
      businessId,
      accounts,
    }))
    .sort((a, b) => b.accounts.length - a.accounts.length); // Сначала большие группы
}

// ============================================================================
// ACCOUNT PROCESSING
// ============================================================================

async function processAccount(
  jobId: string,
  account: AdAccount,
  config: BatchJobConfig,
  workerId: number
): Promise<AccountResult> {
  const startTime = Date.now();
  const stats: AccountResult['stats'] = {};

  await updateAccountLog(jobId, account.id, {
    status: 'running',
    started_at: new Date().toISOString(),
    worker_id: workerId,
  });

  try {
    // Step 1: Full Sync
    if (!config.skipFullsync) {
      await updateAccountLog(jobId, account.id, { step_fullsync: 'running' });

      // Для legacy передаём credentials напрямую, для multi-account - только id
      const syncResult = account.is_legacy
        ? await fullSync(account.user_account_id, {
            accessToken: account.access_token,
            fbAdAccountId: account.ad_account_id,
            isLegacy: true,
          })
        : await fullSync(account.id);

      stats.campaigns = syncResult.campaigns || 0;
      stats.adsets = syncResult.adsets || 0;
      stats.ads = syncResult.ads || 0;
      stats.insights = syncResult.insights?.inserted || 0;

      // Normalize results (critical for anomaly detection)
      const normalizeResult = await normalizeAllResults(account.id);
      await ensureClickFamily(account.id);

      stats.normalizedResults = normalizeResult.processed || 0;

      await updateAccountLog(jobId, account.id, { step_fullsync: 'completed' });
    } else {
      await updateAccountLog(jobId, account.id, { step_fullsync: 'skipped' });
    }

    // Step 2: Compute Features + Detect Anomalies
    await updateAccountLog(jobId, account.id, {
      step_features: 'running',
      step_anomalies: 'running',
    });

    const anomalyResult = await processAdAccount(account.id);
    stats.anomalies = anomalyResult.anomaliesDetected || 0;

    await updateAccountLog(jobId, account.id, {
      step_features: 'completed',
      step_anomalies: 'completed',
    });

    // Step 3: Daily Breakdown Enrichment
    if (!config.skipDailyEnrichment) {
      await updateAccountLog(jobId, account.id, { step_daily: 'running' });

      await enrichDailyBreakdown(account.id);

      await updateAccountLog(jobId, account.id, { step_daily: 'completed' });
    } else {
      await updateAccountLog(jobId, account.id, { step_daily: 'skipped' });
    }

    // Step 4: Burnout Predictions
    if (!config.skipBurnout) {
      await updateAccountLog(jobId, account.id, { step_burnout: 'running' });

      const predictions = await predictAllAds(account.id);
      const recoveries = await predictAllRecovery(account.id);
      stats.predictions = predictions.length + recoveries.length;

      await updateAccountLog(jobId, account.id, { step_burnout: 'completed' });
    } else {
      await updateAccountLog(jobId, account.id, { step_burnout: 'skipped' });
    }

    const duration = Date.now() - startTime;

    await updateAccountLog(jobId, account.id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      duration_seconds: Math.round(duration / 1000),
      result_summary: stats,
    });

    return { success: true, duration, stats };

  } catch (error: any) {
    const duration = Date.now() - startTime;
    const errorType = classifyError(error);

    await updateAccountLog(jobId, account.id, {
      status: 'failed',
      last_error: error.message?.slice(0, 500),
      error_type: errorType,
      duration_seconds: Math.round(duration / 1000),
    });

    return {
      success: false,
      error: error.message,
      errorType,
      duration,
      stats,
    };
  }
}

// ============================================================================
// WORKER POOL
// ============================================================================

// Shared state for workers
let globalProcessed = 0;
let globalFailed = 0;
let globalSkipped = 0;
const globalLock = { locked: false };

async function runWorkerPool(
  jobId: string,
  groups: BusinessGroup[],
  config: BatchJobConfig,
  totalAccounts: number
): Promise<void> {
  const queue = [...groups];
  const startTime = Date.now();
  const workers: Promise<void>[] = [];

  async function worker(workerId: number) {
    while (queue.length > 0) {
      // Atomic pop from queue
      const group = queue.shift();
      if (!group) break;

      if (config.verbose) {
        console.log(`[Worker ${workerId}] Processing business group ${group.businessId} (${group.accounts.length} accounts)`);
      }

      for (const account of group.accounts) {
        // Create log entry if not exists
        await createAccountLog(jobId, account.id);

        const result = await processAccount(jobId, account, config, workerId);

        // Update global counters (thread-safe enough for Node.js)
        if (result.success) {
          globalProcessed++;
        } else if (result.errorType === 'token_invalid' || result.errorType === 'data_error') {
          globalSkipped++;
        } else {
          globalFailed++;
        }

        // Update job progress
        await updateJobProgress(jobId, globalProcessed, globalFailed, globalSkipped);

        // Log progress
        const total = globalProcessed + globalFailed + globalSkipped;
        const pct = Math.round((total / totalAccounts) * 100);
        const elapsed = formatDuration(Date.now() - startTime);
        const avgPerAccount = (Date.now() - startTime) / total;
        const remaining = formatDuration(avgPerAccount * (totalAccounts - total));

        console.log(
          `[${formatTime(new Date())}] ` +
          `${result.success ? '✓' : '✗'} ${account.ad_account_id} ` +
          `(${formatDuration(result.duration)}) | ` +
          `Progress: ${total}/${totalAccounts} (${pct}%) | ` +
          `Elapsed: ${elapsed} | Remaining: ~${remaining}`
        );

        if (!result.success) {
          console.log(`   Error: [${result.errorType}] ${result.error?.slice(0, 100)}`);
        } else if (config.verbose) {
          console.log(`   Stats: insights=${result.stats.insights}, anomalies=${result.stats.anomalies}, predictions=${result.stats.predictions}`);
        }

        // Rate limit pause if needed
        if (result.errorType === 'rate_limited') {
          console.log(`[Worker ${workerId}] Rate limited, waiting 5 minutes...`);
          await sleep(5 * 60 * 1000);
        } else {
          // Normal pause between accounts
          await sleep(config.pauseMs);
        }
      }
    }
  }

  // Start workers
  const numWorkers = Math.min(config.workers, groups.length);
  console.log(`\nStarting ${numWorkers} workers for ${groups.length} business groups...\n`);

  for (let i = 0; i < numWorkers; i++) {
    workers.push(worker(i + 1));
  }

  await Promise.all(workers);
}

// ============================================================================
// DISPLAY PLAN
// ============================================================================

function displayPlan(
  accounts: AdAccount[],
  groups: BusinessGroup[],
  config: BatchJobConfig
): void {
  const avgAccountsPerGroup = accounts.length / groups.length;

  // Estimate time
  const avgTimePerAccount = 5 * 60 * 1000; // 5 minutes
  const parallelFactor = Math.min(config.workers, groups.length);
  const optimisticTime = (accounts.length / parallelFactor) * 3 * 60 * 1000;
  const realisticTime = (accounts.length / parallelFactor) * avgTimePerAccount;
  const pessimisticTime = realisticTime * 1.5;

  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                    BATCH INSIGHTS SYNC                        ║
╠═══════════════════════════════════════════════════════════════╣
║  Total accounts:     ${accounts.length.toString().padEnd(40)}║
║  Business groups:    ${groups.length.toString().padEnd(40)}║
║  Avg accounts/group: ${avgAccountsPerGroup.toFixed(1).padEnd(40)}║
║  Workers:            ${config.workers.toString().padEnd(40)}║
║  Pause between:      ${(config.pauseMs / 1000).toFixed(0)}s${' '.repeat(36)}║
╠═══════════════════════════════════════════════════════════════╣
║  Skip fullsync:      ${(config.skipFullsync ? 'Yes' : 'No').padEnd(40)}║
║  Skip daily enrich:  ${(config.skipDailyEnrichment ? 'Yes' : 'No').padEnd(40)}║
║  Skip burnout:       ${(config.skipBurnout ? 'Yes' : 'No').padEnd(40)}║
╠═══════════════════════════════════════════════════════════════╣
║  ESTIMATED TIME                                               ║
║  ─────────────                                               ║
║  Optimistic:   ${formatDuration(optimisticTime).padEnd(46)}║
║  Realistic:    ${formatDuration(realisticTime).padEnd(46)}║
║  With issues:  ${formatDuration(pessimisticTime).padEnd(46)}║
╚═══════════════════════════════════════════════════════════════╝
`);

  // Show top business groups
  if (config.verbose) {
    console.log('Top 10 Business Groups by size:');
    groups.slice(0, 10).forEach((g, i) => {
      console.log(`  ${i + 1}. ${g.businessId} (${g.accounts.length} accounts)`);
    });
    console.log('');
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  // Load dependencies first
  await loadDependencies();

  const config = parseArgs();

  console.log('\n🚀 Batch Insights Sync\n');

  try {
    let job: BatchJob;
    let accounts: AdAccount[];

    if (config.resumeJobId) {
      // Resume existing job
      console.log(`Resuming job: ${config.resumeJobId}\n`);
      job = await loadExistingJob(config.resumeJobId);
      accounts = await getAccountsToProcess(job.id, config.limit);
      console.log(`Found ${accounts.length} accounts remaining to process\n`);
    } else {
      // New job
      accounts = await getAllAccounts(config.limit);
      console.log(`Found ${accounts.length} accounts to process\n`);

      if (accounts.length === 0) {
        console.log('No accounts to process. Exiting.');
        process.exit(0);
      }

      job = await createBatchJob(config, accounts.length);
      console.log(`Created batch job: ${job.id}\n`);
    }

    // Group by business
    const groups = groupByBusiness(accounts);

    // Display plan
    displayPlan(accounts, groups, config);

    if (config.dryRun) {
      console.log('DRY RUN - exiting without processing\n');
      console.log(`To run for real, remove --dry-run flag\n`);
      console.log(`To resume later: npx tsx src/scripts/batchInsightsSync.ts --resume ${job.id}\n`);
      process.exit(0);
    }

    // Wait for confirmation
    console.log('Press Ctrl+C to cancel or wait 5 seconds to start...\n');
    await sleep(5000);

    // Start processing
    await updateJobStatus(job.id, 'running');
    console.log(`Job started at ${formatTime(new Date())}\n`);
    console.log('─'.repeat(70));

    await runWorkerPool(job.id, groups, config, accounts.length);

    // Finalize
    await updateJobStatus(job.id, 'completed');

    console.log('─'.repeat(70));
    console.log(`\n✅ Batch sync completed at ${formatTime(new Date())}\n`);
    console.log(`   Processed: ${globalProcessed}`);
    console.log(`   Failed:    ${globalFailed}`);
    console.log(`   Skipped:   ${globalSkipped}`);
    console.log(`\n   Job ID: ${job.id}`);

    if (globalFailed > 0) {
      console.log(`\n⚠️  Some accounts failed. To retry:\n   npx tsx src/scripts/batchInsightsSync.ts --resume ${job.id}\n`);
    }

    process.exit(0);

  } catch (error: any) {
    console.error('\n❌ Fatal error:', error.message);
    log.error({ error: error.message, stack: error.stack }, 'Batch sync failed');
    process.exit(1);
  }
}

// Run
main();

// ESM module marker
export {};
