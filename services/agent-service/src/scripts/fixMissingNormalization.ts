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
  const { normalizeAllResults, ensureClickFamily } = await import('../services/resultNormalizer.js');
  const { processAdAccount } = await import('../services/anomalyDetector.js');

  // Аккаунты для исправления (без Bas Dent - 805414428109857)
  const accountsToFix = [
    { id: 'da0bbf82-c3ff-4cc4-b278-e66d1aeae8cb', name: 'Клиника Aston' },
    { id: '91991aa6-558d-4a7b-9de9-771fe520e330', name: 'Amanat Med' },
    { id: '26430b2d-2cd8-4be0-aeb5-42c169403a2f', name: 'Alimi' },
  ];

  console.log('🔧 Исправление нормализации для аккаунтов без results\n');

  for (const acc of accountsToFix) {
    console.log(`\n📊 ${acc.name}...`);

    try {
      // Step 1: Normalize results
      console.log('   → Нормализация результатов...');
      const normalizeResult = await normalizeAllResults(acc.id);
      console.log(`   ✓ Обработано: ${normalizeResult.processed}, семейства: ${[...normalizeResult.families.keys()].join(', ') || 'нет'}`);

      // Step 2: Add clicks family
      console.log('   → Добавление clicks семейства...');
      const clicksAdded = await ensureClickFamily(acc.id);
      console.log(`   ✓ Clicks добавлено: ${clicksAdded}`);

      // Step 3: Re-run anomaly detection
      console.log('   → Детекция аномалий...');
      const anomalyResult = await processAdAccount(acc.id);
      console.log(`   ✓ Аномалий найдено: ${anomalyResult.anomaliesDetected || 0}`);

    } catch (err: any) {
      console.log(`   ✗ Ошибка: ${err.message}`);
    }
  }

  // Проверяем результаты
  console.log('\n\n📈 РЕЗУЛЬТАТЫ ПОСЛЕ ИСПРАВЛЕНИЯ:\n');

  for (const acc of accountsToFix) {
    const { count: resultsCount } = await supabase
      .from('meta_weekly_results')
      .select('*', { count: 'exact', head: true })
      .eq('ad_account_id', acc.id);

    const { count: anomaliesCount } = await supabase
      .from('ad_weekly_anomalies')
      .select('*', { count: 'exact', head: true })
      .eq('ad_account_id', acc.id);

    console.log(`${acc.name}: results=${resultsCount || 0}, anomalies=${anomaliesCount || 0}`);
  }

  console.log('\n✅ Готово!');
}

main();
