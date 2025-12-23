import { supabase } from '../lib/supabase.js';

const userAccountId = process.argv[2] || '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b';

async function main() {
  // Определяем вчерашний день
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const startOfDay = new Date(yesterday);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(yesterday);
  endOfDay.setHours(23, 59, 59, 999);

  console.log('User:', userAccountId);
  console.log('Period:', startOfDay.toISOString(), '-', endOfDay.toISOString());

  // Находим диалоги за вчера
  const { data: dialogs, error } = await supabase
    .from('dialog_analysis')
    .select('id, contact_phone, last_message')
    .eq('user_account_id', userAccountId)
    .gte('last_message', startOfDay.toISOString())
    .lte('last_message', endOfDay.toISOString());

  console.log('Found dialogs for yesterday:', dialogs?.length || 0);

  if (error) {
    console.error('Error fetching dialogs:', error.message);
    process.exit(1);
  }

  if (dialogs && dialogs.length > 0) {
    // Удаляем их для переанализа
    const ids = dialogs.map(d => d.id);
    const { error: deleteError } = await supabase
      .from('dialog_analysis')
      .delete()
      .in('id', ids);

    if (deleteError) {
      console.error('Delete error:', deleteError.message);
      process.exit(1);
    } else {
      console.log('Deleted', ids.length, 'records for re-analysis');
    }
  }
}

main().catch(console.error);
