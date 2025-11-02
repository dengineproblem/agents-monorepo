#!/usr/bin/env tsx
/**
 * Quick script to run dialog analysis for a specific instance
 * Usage: tsx src/scripts/runAnalysis.ts <instanceName>
 */

import { supabase } from '../lib/supabase.js';
import { analyzeDialogs } from './analyzeDialogs.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger({ module: 'runAnalysis' });

async function main() {
  const instanceName = process.argv[2] || 'instance_0f559eb0_1761736509038';
  const minIncoming = parseInt(process.argv[3] || '3', 10);

  console.log(`\n🔍 Ищем instance: ${instanceName}\n`);

  // Get instance info from Supabase
  const { data: instance, error } = await supabase
    .from('whatsapp_instances')
    .select(`
      id,
      instance_name,
      user_account_id,
      phone_number,
      status,
      user_accounts (
        email,
        name
      )
    `)
    .eq('instance_name', instanceName)
    .single();

  if (error || !instance) {
    console.error('❌ Instance не найден:', error?.message || 'Not found');
    process.exit(1);
  }

  console.log('✅ Instance найден:');
  console.log(`   ID: ${instance.id}`);
  console.log(`   Name: ${instance.instance_name}`);
  console.log(`   Phone: ${instance.phone_number || 'N/A'}`);
  console.log(`   Status: ${instance.status}`);
  console.log(`   User ID: ${instance.user_account_id}`);
  console.log(`   User Email: ${(instance.user_accounts as any)?.email || 'N/A'}`);
  console.log(`\n🚀 Запускаем анализ диалогов (minIncoming >= ${minIncoming})...\n`);

  try {
    const stats = await analyzeDialogs({
      instanceName: instance.instance_name,
      userAccountId: instance.user_account_id,
      minIncoming,
    });

    console.log('\n✅ Анализ завершен!');
    console.log('═══════════════════════════════════════');
    console.log(`📊 Всего контактов:      ${stats.total}`);
    console.log(`✓  Проанализировано:     ${stats.analyzed}`);
    console.log(`🔥 Hot leads:            ${stats.hot}`);
    console.log(`🌡️  Warm leads:           ${stats.warm}`);
    console.log(`❄️  Cold leads:           ${stats.cold}`);
    console.log(`❌ Ошибки:               ${stats.errors}`);
    console.log('═══════════════════════════════════════');

    // Show sample results
    console.log('\n📝 Примеры результатов (топ 5 по score):\n');

    const { data: results } = await supabase
      .from('dialog_analysis')
      .select('contact_phone, contact_name, interest_level, score, business_type, next_message')
      .eq('instance_name', instanceName)
      .order('score', { ascending: false })
      .limit(5);

    if (results && results.length > 0) {
      results.forEach((r, i) => {
        console.log(`${i + 1}. ${r.contact_phone} (${r.contact_name || 'N/A'})`);
        console.log(`   🔥 Interest: ${r.interest_level} | Score: ${r.score}/100`);
        console.log(`   💼 Business: ${r.business_type || 'N/A'}`);
        console.log(`   💬 Next message: ${r.next_message.substring(0, 80)}...`);
        console.log('');
      });
    }

    console.log('\n💾 Экспорт в CSV:');
    console.log(`curl "https://app.performanteaiagency.com/api/dialogs/export-csv?userAccountId=${instance.user_account_id}&instanceName=${instanceName}" -o results.csv\n`);

    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ Ошибка анализа:', error.message);
    log.error({ error: error.message, stack: error.stack }, 'Analysis failed');
    process.exit(1);
  }
}

main();

