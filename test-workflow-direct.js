// Прямой тест workflow без AgentService
import { workflowCreateCampaignWithCreative } from './services/agent-service/dist/workflows/createCampaignWithCreative.js';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ikywuvtavpnjlrjtalqi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlreXd1dnRhdnBuamxyanRhbHFpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NTE0NDc1MywiZXhwIjoyMDYwNzIwNzUzfQ.CAJx7J-CCzbU14EFrZhFcv1qzOLr35dT1-Oh33elOYo';

async function test() {
  try {
    console.log('🧪 Прямой тест workflow...\n');
    
    // 1. Получаем user account
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const { data: userAccount } = await supabase
      .from('user_accounts')
      .select('*')
      .eq('id', '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b')
      .single();
    
    if (!userAccount) {
      throw new Error('User account not found');
    }
    
    console.log('✅ User account найден:', userAccount.username);
    console.log('   Ad Account:', userAccount.ad_account_id);
    console.log('   Page ID:', userAccount.page_id);
    console.log('   Instagram ID:', userAccount.instagram_id);
    console.log('');
    
    // 2. Вызываем workflow
    const result = await workflowCreateCampaignWithCreative(
      {
        user_creative_id: '48b5599f-68d5-4142-8e63-5f8d109439b8',
        objective: 'WhatsApp',
        campaign_name: 'TEST DIRECT — Кампания WhatsApp',
        daily_budget_cents: 1000,
        page_id: userAccount.page_id,
        instagram_id: userAccount.instagram_id
      },
      {
        user_account_id: userAccount.id,
        ad_account_id: userAccount.ad_account_id
      },
      userAccount.access_token
    );
    
    console.log('✅ Workflow выполнен успешно!');
    console.log(JSON.stringify(result, null, 2));
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

test();
