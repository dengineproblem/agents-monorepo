#!/usr/bin/env tsx
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const serviceDir = resolve(__dirname, '../..');

dotenv.config({ path: resolve(serviceDir, '.env.local') });
dotenv.config({ path: resolve(serviceDir, '.env') });

async function main() {
  const { supabase } = await import('../lib/supabaseClient.js');

  const { data: jobs } = await supabase
    .from('batch_sync_jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1);

  const job = jobs?.[0];
  if (!job) return console.log('No job found');

  const { data: accounts } = await supabase
    .from('batch_sync_account_log')
    .select('status, error_message')
    .eq('job_id', job.id);

  const completed = accounts?.filter(a => a.status === 'completed').length || 0;
  const failed = accounts?.filter(a => a.status === 'failed').length || 0;
  const running = accounts?.filter(a => a.status === 'running').length || 0;

  console.log('=== BATCH SYNC ИТОГИ ===');
  console.log('Job ID:', job.id);
  console.log('Status:', job.status);
  console.log('Total accounts:', job.total_accounts);
  console.log('Completed:', completed);
  console.log('Failed:', failed);
  console.log('Running:', running);

  // Аномалии
  const { count: anomalies } = await supabase
    .from('ad_weekly_anomalies')
    .select('*', { count: 'exact', head: true });

  console.log('\nВсего аномалий в базе:', anomalies);

  // Burnout predictions
  const { count: burnout } = await supabase
    .from('ad_burnout_predictions')
    .select('*', { count: 'exact', head: true });

  console.log('Burnout predictions:', burnout);

  // Уникальные ошибки
  const errors = accounts?.filter(a => a.error_message).map(a => a.error_message) || [];
  const uniqueErrors = [...new Set(errors)];
  console.log('\nУникальные ошибки (' + uniqueErrors.length + '):');
  uniqueErrors.slice(0, 10).forEach((e, i) => console.log((i+1) + '. ' + e?.substring(0, 100)));
}

main();
