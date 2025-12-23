import { getFilteredDialogsForAnalysis } from '../lib/evolutionDb.js';

const instanceName = 'instance_0f559eb0_1761736509038';

async function main() {
  // Вчерашний день
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const startOfDay = new Date(yesterday);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(yesterday);
  endOfDay.setHours(23, 59, 59, 999);

  console.log('Fetching dialogs from Evolution DB...');
  console.log('Instance:', instanceName);
  console.log('Period:', startOfDay.toISOString(), '-', endOfDay.toISOString());

  // getFilteredDialogsForAnalysis(instanceName, minIncoming, maxDialogs, excludePhones, startDate, endDate)
  const dialogs = await getFilteredDialogsForAnalysis(
    instanceName,
    1,           // minIncoming - минимум 1 входящее сообщение
    undefined,   // maxDialogs - без лимита
    [],          // excludePhones
    startOfDay,  // startDate - начало вчера
    endOfDay     // endDate - конец вчера
  );

  console.log('\n=== РЕЗУЛЬТАТ ШАГ 1 ===');
  console.log('Всего записей:', dialogs.length);

  if (dialogs.length > 0) {
    // Смотрим структуру первой записи
    console.log('\nСтруктура первой записи:');
    console.log(JSON.stringify(dialogs[0], null, 2).substring(0, 500));

    // Группируем по remoteJid
    const byContact: Record<string, any[]> = {};
    dialogs.forEach((m: any) => {
      const jid = m.remote_jid || m.remoteJid || m.key?.remoteJid;
      if (jid) {
        if (!byContact[jid]) byContact[jid] = [];
        byContact[jid].push(m);
      }
    });

    const contacts = Object.keys(byContact);
    console.log('\nУникальных контактов:', contacts.length);

    console.log('\nПервые 3 контакта:');
    contacts.slice(0, 3).forEach((jid, i) => {
      const msgs = byContact[jid];
      console.log(`\n${i+1}. ${jid}`);
      console.log(`   Сообщений: ${msgs.length}`);
      if (msgs.length > 0) {
        const first = msgs[0];
        console.log(`   Имя: ${first.contact_name || first.pushName || 'Без имени'}`);
        // Текст в message_data.conversation или message_data.extendedTextMessage.text
        const text = first.message_data?.conversation ||
                     first.message_data?.extendedTextMessage?.text ||
                     '[без текста]';
        console.log(`   Пример текста: ${text.substring(0, 80)}`);
        // Показываем дату первого сообщения
        const date = new Date(first.timestamp * 1000);
        console.log(`   Первое сообщение: ${date.toLocaleString('ru-RU')}`);
      }
    });
  }
}

main().catch(console.error);
