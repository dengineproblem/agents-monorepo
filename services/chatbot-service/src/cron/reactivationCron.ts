import cron from 'node-cron';
import { supabase } from '../lib/supabase.js';
import { 
  selectLeadsForReactivation, 
  distributeMessages,
  scheduleReactivationMessages 
} from '../lib/reactivationEngine.js';

/**
 * Cron задача: выбор лидов для реанимации
 * Запускается ежедневно в 00:00
 */
export function startReactivationCron() {
  // Запускать каждый день в полночь
  cron.schedule('0 0 * * *', async () => {
    console.log('[Reactivation Cron] Starting daily reactivation campaign selection...');
    
    try {
      // Получить всех активных пользователей
      const { data: users, error } = await supabase
        .from('user_accounts')
        .select('id')
        .eq('active', true);
      
      if (error || !users) {
        console.error('[Reactivation Cron] Error fetching users:', error);
        return;
      }
      
      for (const user of users) {
        try {
          // 1. Выбрать топ-300 лидов для реанимации
          const leads = await selectLeadsForReactivation({
            userAccountId: user.id,
            limit: 300
          });
          
          if (leads.length === 0) {
            console.log(`[Reactivation Cron] No leads found for user ${user.id}`);
            continue;
          }
          
          // 2. Распределить равномерно с 10:00 до 20:00 (Пн-Пт)
          const schedule = distributeMessages(leads, {
            startHour: 10,
            endHour: 20,
            daysOfWeek: [1, 2, 3, 4, 5] // Пн-Пт
          });
          
          // 3. Сохранить в очередь Redis
          await scheduleReactivationMessages(schedule);
          
          console.log(`[Reactivation Cron] Scheduled ${schedule.length} messages for user ${user.id}`);
        } catch (userError: any) {
          console.error(`[Reactivation Cron] Error processing user ${user.id}:`, userError.message);
        }
      }
      
      console.log('[Reactivation Cron] Daily campaign selection completed');
    } catch (error: any) {
      console.error('[Reactivation Cron] Error in reactivation cron:', error.message);
    }
  });
  
  console.log('Reactivation cron scheduled (daily at 00:00)');
}

