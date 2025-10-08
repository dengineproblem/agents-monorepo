// Тестируем как формируется promoted_object

function toParams(p) {
  const o = {};
  for (const [k, v] of Object.entries(p)) {
    if (v !== undefined && v !== null) {
      o[k] = typeof v === 'object' ? JSON.stringify(v) : v;
    }
  }
  return o;
}

// Тест 1: БЕЗ номера WhatsApp (как работало раньше)
console.log('\n=== ТЕСТ 1: БЕЗ WhatsApp номера ===');
const adsetBody1 = {
  name: 'Test AdSet',
  campaign_id: '123456',
  status: 'ACTIVE',
  billing_event: 'IMPRESSIONS',
  optimization_goal: 'CONVERSATIONS',
  daily_budget: 2000,
  targeting: {
    age_min: 18,
    age_max: 65,
    geo_locations: {
      countries: ['KZ']
    }
  },
  destination_type: 'WHATSAPP',
  promoted_object: {
    page_id: '114323838439928'
  }
};

const params1 = toParams(adsetBody1);
console.log('Что отправится в Facebook:');
console.log(JSON.stringify(params1, null, 2));

// Тест 2: С номером WhatsApp (что ты хочешь)
console.log('\n=== ТЕСТ 2: С WhatsApp номером ===');
const whatsapp_phone_number = '+77074094375';
const adsetBody2 = {
  name: 'Test AdSet',
  campaign_id: '123456',
  status: 'ACTIVE',
  billing_event: 'IMPRESSIONS',
  optimization_goal: 'CONVERSATIONS',
  daily_budget: 2000,
  targeting: {
    age_min: 18,
    age_max: 65,
    geo_locations: {
      countries: ['KZ']
    }
  },
  destination_type: 'WHATSAPP',
  promoted_object: {
    page_id: '114323838439928',
    ...(whatsapp_phone_number && { whatsapp_phone_number })
  }
};

const params2 = toParams(adsetBody2);
console.log('Что отправится в Facebook:');
console.log(JSON.stringify(params2, null, 2));

// Показываем как выглядит promoted_object в запросе
console.log('\n=== КАК ВЫГЛЯДИТ promoted_object В ЗАПРОСЕ ===');
console.log('Без номера:', params1.promoted_object);
console.log('С номером:', params2.promoted_object);

