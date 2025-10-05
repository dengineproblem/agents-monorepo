const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.agent' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

async function checkToken() {
  // Получаем данные пользователя
  const { data, error } = await supabase
    .from('user_accounts')
    .select('id, username, ad_account_id, access_token')
    .eq('id', '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b')
    .single();

  if (error || !data) {
    console.error('Error:', error);
    return;
  }

  console.log('User:', data.username);
  console.log('Ad Account ID:', data.ad_account_id);
  console.log('Token (first 30 chars):', data.access_token.substring(0, 30));
  
  // Проверяем токен через FB API
  const token = data.access_token;
  const response = await fetch(`https://graph.facebook.com/v20.0/me/adaccounts?access_token=${token}&fields=id,name,account_status`);
  const result = await response.json();
  
  console.log('\n=== ДОСТУПНЫЕ AD ACCOUNTS ===');
  if (result.data) {
    result.data.forEach(acc => {
      console.log(`  ${acc.id} - ${acc.name} (${acc.account_status})`);
      if (acc.id === data.ad_account_id) {
        console.log('  ✅ СОВПАДЕНИЕ!');
      }
    });
  } else {
    console.log('Error:', result);
  }
  
  console.log('\n=== ПРОВЕРКА ===');
  console.log('В базе:', data.ad_account_id);
  const found = result.data?.find(acc => acc.id === data.ad_account_id);
  if (found) {
    console.log('✅ Ad Account найден в списке доступных!');
  } else {
    console.log('❌ Ad Account НЕ найден! Нужно обновить ad_account_id в базе.');
  }
}

checkToken().catch(console.error);
