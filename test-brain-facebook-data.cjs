// Тест для проверки данных от Facebook API как brain
const { createClient } = require('@supabase/supabase-js');
const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function computeLeadsFromActions(stat) {
  let messagingLeads = 0;
  let qualityLeads = 0;
  let siteLeads = 0;
  let formLeads = 0;
  const actions = Array.isArray(stat?.actions) ? stat.actions : [];

  for (const action of actions) {
    const t = action?.action_type;
    const v = parseInt(action?.value || '0', 10) || 0;

    if (t === 'onsite_conversion.total_messaging_connection') {
      messagingLeads = v;
    } else if (t === 'onsite_conversion.messaging_user_depth_2_message_send') {
      qualityLeads = v;
    } else if (t === 'lead' || t === 'fb_form_lead' || t === 'leadgen' || t === 'leadgen.other') {
      formLeads += v;
    } else if (t === 'offsite_conversion.fb_pixel_lead') {
      siteLeads = v;
    } else if (typeof t === 'string' && t.startsWith('offsite_conversion.custom')) {
      siteLeads += v;
    }
  }

  const leads = messagingLeads + siteLeads + formLeads;
  return { messagingLeads, qualityLeads, siteLeads, formLeads, leads };
}

async function main() {
  const userId = 'feb9ae84-7365-4d88-bfcf-486a2a2870ed';

  const { data: user, error } = await supabase
    .from('user_accounts')
    .select('access_token, ad_account_id, current_campaign_goal')
    .eq('id', userId)
    .single();

  if (error) {
    console.error('❌ Ошибка загрузки пользователя:', error);
    return;
  }

  console.log(`✅ Пользователь найден: ${user.ad_account_id}`);
  console.log(`   Цель кампании: ${user.current_campaign_goal}\n`);

  const url = `https://graph.facebook.com/v21.0/${user.ad_account_id}/insights?fields=campaign_name,campaign_id,spend,actions,cpm,ctr,impressions,frequency&date_preset=yesterday&level=campaign&action_breakdowns=action_type&limit=500&access_token=${user.access_token}`;

  console.log('🔍 Запрашиваем данные от Facebook API...\n');

  https.get(url, (res) => {
    let data = '';

    res.on('data', (chunk) => {
      data += chunk;
    });

    res.on('end', () => {
      try {
        const response = JSON.parse(data);

        if (response.error) {
          console.error('❌ Ошибка от Facebook API:', response.error);
          return;
        }

        const rows = response.data || [];

        console.log(`\n=== ОТВЕТ ОТ FACEBOOK API ===`);
        console.log(`Всего строк получено: ${rows.length}\n`);

        // Группируем по campaign_id
        const campaignGroups = new Map();
        rows.forEach(row => {
          const id = row.campaign_id;
          if (!campaignGroups.has(id)) {
            campaignGroups.set(id, []);
          }
          campaignGroups.get(id).push(row);
        });

        console.log(`Уникальных кампаний: ${campaignGroups.size}\n`);

        if (rows.length > campaignGroups.size) {
          console.warn(`⚠️  ВНИМАНИЕ! Facebook вернул ${rows.length} строк для ${campaignGroups.size} кампаний`);
          console.warn(`⚠️  Это означает что есть ДУБЛИКАТЫ!\n`);
        }

        console.log('=== ДЕТАЛИ ПО КАЖДОЙ КАМПАНИИ ===\n');

        let totalLeadsWithDuplicates = 0;
        let totalLeadsWithoutDuplicates = 0;
        let totalSpendWithDuplicates = 0;
        let totalSpendWithoutDuplicates = 0;

        campaignGroups.forEach((rows, campaign_id) => {
          console.log(`Кампания: ${rows[0].campaign_name}`);
          console.log(`  ID: ${campaign_id}`);
          console.log(`  Facebook вернул: ${rows.length} строк${rows.length > 1 ? ' ⚠️  ДУБЛИКАТЫ!' : ''}\n`);

          rows.forEach((row, idx) => {
            const leads = computeLeadsFromActions(row);
            const spend = Number(row.spend) || 0;

            console.log(`    Строка #${idx + 1}:`);
            console.log(`      - spend: $${spend.toFixed(2)}`);
            console.log(`      - impressions: ${row.impressions}`);
            console.log(`      - leads: ${leads.leads} (messaging: ${leads.messagingLeads}, site: ${leads.siteLeads}, form: ${leads.formLeads})`);

            // Показываем все actions
            if (row.actions && row.actions.length > 0) {
              console.log(`      - actions (${row.actions.length}):`);
              row.actions.forEach(a => {
                console.log(`          ${a.action_type}: ${a.value}`);
              });
            }
            console.log('');

            // Считаем сумму ВСЕХ строк (как было раньше - НЕВЕРНО)
            totalLeadsWithDuplicates += leads.leads;
            totalSpendWithDuplicates += spend;
          });

          // Берём только первую строку (как должно быть - ПРАВИЛЬНО)
          const firstRow = rows[0];
          const firstLeads = computeLeadsFromActions(firstRow);
          const firstSpend = Number(firstRow.spend) || 0;

          totalLeadsWithoutDuplicates += firstLeads.leads;
          totalSpendWithoutDuplicates += firstSpend;

          console.log(`  ✅ ПРАВИЛЬНО (берём только первую строку):`);
          console.log(`      - spend: $${firstSpend.toFixed(2)}`);
          console.log(`      - leads: ${firstLeads.leads}\n`);

          if (rows.length > 1) {
            console.warn(`  ❌ ПРОПУСКАЕМ (${rows.length - 1} дубликатов):`);
            rows.slice(1).forEach((row, idx) => {
              const skippedLeads = computeLeadsFromActions(row);
              const skippedSpend = Number(row.spend) || 0;
              console.warn(`      - Строка #${idx + 2}: spend=$${skippedSpend.toFixed(2)}, leads=${skippedLeads.leads}`);
            });
            console.log('');
          }

          console.log('─'.repeat(80) + '\n');
        });

        console.log('\n=== ИТОГОВАЯ СВОДКА ===\n');
        console.log(`❌ НЕВЕРНЫЙ подход (если бы суммировали все строки, включая дубликаты):`);
        console.log(`  - Total Spend: $${totalSpendWithDuplicates.toFixed(2)}`);
        console.log(`  - Total Leads: ${totalLeadsWithDuplicates}`);
        console.log(`  - CPL: $${totalLeadsWithDuplicates > 0 ? (totalSpendWithDuplicates / totalLeadsWithDuplicates).toFixed(2) : 'N/A'}\n`);

        console.log(`✅ ПРАВИЛЬНЫЙ подход (берём только первую строку для каждой кампании):`);
        console.log(`  - Total Spend: $${totalSpendWithoutDuplicates.toFixed(2)}`);
        console.log(`  - Total Leads: ${totalLeadsWithoutDuplicates}`);
        console.log(`  - CPL: $${totalLeadsWithoutDuplicates > 0 ? (totalSpendWithoutDuplicates / totalLeadsWithoutDuplicates).toFixed(2) : 'N/A'}\n`);

        if (totalLeadsWithDuplicates !== totalLeadsWithoutDuplicates) {
          const difference = totalLeadsWithDuplicates - totalLeadsWithoutDuplicates;
          const percentDiff = ((difference / totalLeadsWithoutDuplicates) * 100).toFixed(1);
          console.log(`⚠️  РАЗНИЦА: ${difference} лидов (${percentDiff}% завышение)!\n`);
        } else {
          console.log(`✅ Дубликатов нет, данные корректные\n`);
        }

        process.exit(0);
      } catch (e) {
        console.error('❌ Ошибка парсинга ответа:', e.message);
        console.log('Сырой ответ:', data);
        process.exit(1);
      }
    });
  }).on('error', (e) => {
    console.error('❌ Ошибка запроса:', e.message);
    process.exit(1);
  });
}

main();
