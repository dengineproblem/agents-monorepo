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

  // Проверим какие таблицы вообще есть
  const { data: allTables, error: tablesError } = await supabase
    .from('information_schema.tables')
    .select('table_name')
    .eq('table_schema', 'public');

  if (tablesError) {
    // Попробуем через RPC
    const { data: rpcTables } = await supabase.rpc('get_tables');
    console.log('Tables via RPC:', rpcTables);
  } else {
    console.log('=== ВСЕ ТАБЛИЦЫ ===');
    allTables?.forEach(t => console.log(t.table_name));
  }

  // Актуальные названия таблиц
  const tables = [
    'meta_insights_weekly',
    'meta_insights_daily',
    'meta_weekly_results',
    'meta_ads',
    'meta_adsets',
    'ad_weekly_features',
    'ad_weekly_anomalies',
    'burnout_predictions',
  ];

  console.log('=== ДАННЫЕ В ТАБЛИЦАХ ===');

  for (const table of tables) {
    const { data, error } = await supabase
      .from(table)
      .select('id')
      .limit(10000);

    if (error) {
      console.log(`${table}: ERROR - ${error.message}`);
    } else {
      console.log(`${table}: ${data?.length || 0}`);
    }
  }

  // Последние аномалии
  console.log('\n=== ПОСЛЕДНИЕ 5 АНОМАЛИЙ ===');
  const { data: recentAnomalies, error: anomError } = await supabase
    .from('ad_weekly_anomalies')
    .select('fb_ad_id, week_start_date, anomaly_type, current_value, baseline_value, delta_pct')
    .order('created_at', { ascending: false })
    .limit(5);

  if (anomError) {
    console.log('Error:', anomError.message);
  } else {
    recentAnomalies?.forEach((a, i) => {
      const delta = a.delta_pct ? `${a.delta_pct > 0 ? '+' : ''}${(a.delta_pct * 100).toFixed(1)}%` : '';
      console.log(`${i + 1}. ${a.fb_ad_id} | ${a.week_start_date} | ${a.anomaly_type} | ${delta}`);
    });
  }

  // Burnout predictions
  console.log('\n=== ПОСЛЕДНИЕ 5 BURNOUT PREDICTIONS ===');
  const { data: recentBurnout, error: burnoutError } = await supabase
    .from('ad_burnout_predictions')
    .select('id, fb_ad_id, burnout_level, burnout_score')
    .order('created_at', { ascending: false })
    .limit(5);

  if (burnoutError) {
    console.log('Error:', burnoutError.message);
  } else {
    recentBurnout?.forEach((b, i) => {
      console.log(`${i + 1}. ${b.fb_ad_id} | ${b.burnout_level} | score: ${b.burnout_score}`);
    });
  }

  // Проверяем batch_sync_account_log
  console.log('\n=== BATCH SYNC ACCOUNT LOG ===');
  const { data: batchLogs, error: batchError } = await supabase
    .from('batch_sync_account_log')
    .select('ad_account_id, status, step_fullsync, step_features, step_anomalies, step_burnout, last_error, result_summary')
    .order('created_at', { ascending: false })
    .limit(10);

  if (batchError) {
    console.log('Error:', batchError.message);
  } else {
    batchLogs?.forEach((l, i) => {
      const summary = l.result_summary ? JSON.stringify(l.result_summary) : 'N/A';
      console.log(`${i + 1}. ${l.ad_account_id}`);
      console.log(`   Status: ${l.status} | fullsync: ${l.step_fullsync} | features: ${l.step_features} | anomalies: ${l.step_anomalies} | burnout: ${l.step_burnout}`);
      console.log(`   Summary: ${summary}`);
      if (l.last_error) console.log(`   Error: ${l.last_error}`);
    });
  }

  // Проверяем какие ad_account_id есть в anomalies и в ad_accounts
  console.log('\n=== AD_ACCOUNT_ID В АНОМАЛИЯХ vs AD_ACCOUNTS ===');

  const { data: anomalyAccounts } = await supabase
    .from('ad_weekly_anomalies')
    .select('ad_account_id')
    .limit(1000);

  const uniqueAnomalyAccounts = [...new Set(anomalyAccounts?.map(a => a.ad_account_id) || [])];
  console.log(`Уникальных ad_account_id в аномалиях: ${uniqueAnomalyAccounts.length}`);
  uniqueAnomalyAccounts.forEach(id => console.log(`  - ${id}`));

  const { data: adAccounts } = await supabase
    .from('ad_accounts')
    .select('id, ad_account_id, name')
    .not('access_token', 'is', null);

  console.log(`\nAd accounts с токенами: ${adAccounts?.length}`);
  adAccounts?.forEach(a => console.log(`  - ${a.id} | ${a.ad_account_id} | ${a.name}`));

  // Сравниваем и показываем статистику по каждому аккаунту
  console.log('\n=== ДЕТАЛЬНАЯ СТАТИСТИКА ПО АККАУНТАМ ===');
  for (const acc of adAccounts || []) {
    const hasAnomalies = uniqueAnomalyAccounts.includes(acc.id);

    // Считаем features
    const { count: featuresCount } = await supabase
      .from('ad_weekly_features')
      .select('*', { count: 'exact', head: true })
      .eq('ad_account_id', acc.id);

    // Считаем insights
    const { count: insightsCount } = await supabase
      .from('meta_insights_weekly')
      .select('*', { count: 'exact', head: true })
      .eq('ad_account_id', acc.id);

    // Считаем аномалии
    const { count: anomaliesCount } = await supabase
      .from('ad_weekly_anomalies')
      .select('*', { count: 'exact', head: true })
      .eq('ad_account_id', acc.id);

    // Считаем burnout predictions
    const { count: burnoutCount } = await supabase
      .from('ad_burnout_predictions')
      .select('*', { count: 'exact', head: true })
      .eq('ad_account_id', acc.id);

    // Считаем normalized results
    const { count: resultsCount } = await supabase
      .from('meta_weekly_results')
      .select('*', { count: 'exact', head: true })
      .eq('ad_account_id', acc.id);

    console.log(`${acc.name}:`);
    console.log(`   insights: ${insightsCount || 0}, results: ${resultsCount || 0}, features: ${featuresCount || 0}, anomalies: ${anomaliesCount || 0}, burnout: ${burnoutCount || 0}`);
  }

  // Проверяем структуру insights
  console.log('\n=== СТРУКТУРА INSIGHTS ===');
  const accountsToCheck = [
    { id: 'da0bbf82-c3ff-4cc4-b278-e66d1aeae8cb', name: 'Клиника Aston' },
    { id: '91454447-2906-4d89-892b-12c817584b0f', name: 'Bas Dent' },
  ];

  for (const acc of accountsToCheck) {
    const { data: sample } = await supabase
      .from('meta_insights_weekly')
      .select('*')
      .eq('ad_account_id', acc.id)
      .limit(1)
      .single();

    if (sample) {
      const keys = Object.keys(sample).filter(k => sample[k] !== null);
      console.log(`\n${acc.name} - поля с данными:`);
      console.log(`   ${keys.join(', ')}`);

      // Проверяем ключевые поля для нормализации
      console.log(`   spend: ${sample.spend}, impressions: ${sample.impressions}, clicks: ${sample.clicks}`);
      console.log(`   actions: ${sample.actions ? 'есть' : 'null'}`);
      console.log(`   cost_per_action_type: ${sample.cost_per_action_type ? 'есть' : 'null'}`);
      console.log(`   conversions: ${sample.conversions ? 'есть' : 'null'}`);
    }
  }

  // Проверяем actions_json для обоих аккаунтов
  console.log('\n=== ACTIONS_JSON СРАВНЕНИЕ ===');

  // Bas Dent - с actions
  const { data: basDentWithActions } = await supabase
    .from('meta_insights_weekly')
    .select('fb_ad_id, actions_json, cost_per_action_type_json')
    .eq('ad_account_id', '91454447-2906-4d89-892b-12c817584b0f')
    .not('actions_json', 'is', null)
    .limit(1)
    .single();

  console.log('Bas Dent (с actions_json):');
  if (basDentWithActions) {
    console.log(`   actions_json: ${JSON.stringify(basDentWithActions.actions_json)?.substring(0, 200)}`);
  } else {
    console.log('   Нет записей с actions_json!');
  }

  // Aston - с actions
  const { data: astonWithActions } = await supabase
    .from('meta_insights_weekly')
    .select('fb_ad_id, actions_json, cost_per_action_type_json')
    .eq('ad_account_id', 'da0bbf82-c3ff-4cc4-b278-e66d1aeae8cb')
    .not('actions_json', 'is', null)
    .limit(1)
    .single();

  console.log('\nКлиника Aston (с actions_json):');
  if (astonWithActions) {
    console.log(`   actions_json: ${JSON.stringify(astonWithActions.actions_json)?.substring(0, 200)}`);
  } else {
    console.log('   Нет записей с actions_json!');
  }

  // Подсчёт записей с actions_json
  const { count: basDentActionsCount } = await supabase
    .from('meta_insights_weekly')
    .select('*', { count: 'exact', head: true })
    .eq('ad_account_id', '91454447-2906-4d89-892b-12c817584b0f')
    .not('actions_json', 'is', null);

  const { count: astonActionsCount } = await supabase
    .from('meta_insights_weekly')
    .select('*', { count: 'exact', head: true })
    .eq('ad_account_id', 'da0bbf82-c3ff-4cc4-b278-e66d1aeae8cb')
    .not('actions_json', 'is', null);

  console.log(`\nЗаписей с actions_json:`);
  console.log(`   Bas Dent: ${basDentActionsCount || 0}`);
  console.log(`   Клиника Aston: ${astonActionsCount || 0}`);
}

main();
