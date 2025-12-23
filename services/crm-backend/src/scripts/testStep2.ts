import { analyzeDialogs } from './analyzeDialogs.js';

const instanceName = 'instance_0f559eb0_1761736509038';
const userAccountId = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b';

async function main() {
  // Вчерашний день
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const startOfDay = new Date(yesterday);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(yesterday);
  endOfDay.setHours(23, 59, 59, 999);

  console.log('=== ШАГ 2: LLM АНАЛИЗ ДИАЛОГОВ ===');
  console.log('Instance:', instanceName);
  console.log('User:', userAccountId);
  console.log('Period:', startOfDay.toISOString(), '-', endOfDay.toISOString());
  console.log('');

  const stats = await analyzeDialogs({
    instanceName,
    userAccountId,
    minIncoming: 1,       // минимум 1 входящее
    maxDialogs: undefined, // без лимита
    maxContacts: undefined,
    startDate: startOfDay,
    endDate: endOfDay
  });

  console.log('\n=== РЕЗУЛЬТАТ ШАГ 2 ===');
  console.log(JSON.stringify(stats, null, 2));
}

main().catch(console.error);
