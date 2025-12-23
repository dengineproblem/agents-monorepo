import { supabase } from '../lib/supabase.js';

async function check() {
  const { data } = await supabase
    .from('dialog_analysis')
    .select('contact_name, interest_level, engagement_trend, drop_point, hidden_objections, score')
    .eq('user_account_id', '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b')
    .order('updated_at', { ascending: false })
    .limit(5);

  console.log('=== Последние 5 анализов ===');
  data?.forEach((d, i) => {
    console.log(`\n${i+1}. ${d.contact_name || 'Без имени'}`);
    console.log(`   Interest: ${d.interest_level}, Score: ${d.score}`);
    console.log(`   Trend: ${d.engagement_trend || 'N/A'}`);
    console.log(`   Drop point: ${d.drop_point || 'N/A'}`);
    console.log(`   Hidden objections: ${JSON.stringify(d.hidden_objections)}`);
  });
}

check().catch(console.error);
