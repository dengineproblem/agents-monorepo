#!/usr/bin/env node

// Локальный тест scoring логики
const ACCESS_TOKEN = 'EAAYNZCXReLZAoBO4XqBAkBBCaQTt36IphOKlbZBYFB0nCJOeutwZCaiWKZAbZBnj8tFUx7nXSaOZBy4YGdLxBbH1kqzHiTAZBTeauWOZCZB8FvoOMxmFwNcgoe6GYfjzATmKqDYLyzVjzhvnwTCSWF0FUjOoAQjTL40wc6hiwojsALaz7ZAkbdunVGkHQOt';
const AD_ACCOUNT_ID = 'act_1090206589147369';

// Mock данные из Supabase (user_creatives)
const USER_CREATIVES = [
  {
    id: '2df70bec-3efc-4b00-b2fa-a8f7925bf9a5',
    title: '1 ролик.mov',
    fb_creative_id_whatsapp: '1297581724889438',
    fb_creative_id_instagram_traffic: '1197859198838451',
    fb_creative_id_site_leads: null,
    is_active: true,
    status: 'ready'
  },
  {
    id: 'b0339620-ae58-4d6f-9dd3-0c50e954b560',
    title: '2 ролик (1).mov',
    fb_creative_id_whatsapp: '1716819762366252',
    fb_creative_id_instagram_traffic: null,
    fb_creative_id_site_leads: null,
    is_active: true,
    status: 'ready'
  }
];

async function getActiveCreativeIdsFromFacebook() {
  const url = `https://graph.facebook.com/v20.0/${AD_ACCOUNT_ID}/ads?fields=id,name,status,effective_status,creative{id}&limit=500&access_token=${ACCESS_TOKEN}`;
  
  const response = await fetch(url);
  const result = await response.json();
  
  if (result.error) {
    throw new Error(`FB API Error: ${result.error.message}`);
  }
  
  // Фильтруем только ACTIVE ads
  const activeAds = (result.data || []).filter(ad => 
    ad.status === 'ACTIVE' && ad.effective_status === 'ACTIVE'
  );
  
  console.log(`\n📊 Found ${activeAds.length} ACTIVE ads in Facebook:\n`);
  activeAds.forEach(ad => {
    console.log(`  - ${ad.name} (creative_id: ${ad.creative?.id})`);
  });
  
  // Извлекаем creative IDs
  const creativeIds = activeAds
    .map(ad => ad.creative?.id)
    .filter(id => id);
  
  return new Set(creativeIds);
}

async function testUnusedCreatives() {
  console.log('🧪 Testing unused creatives logic locally...\n');
  
  try {
    // 1. Получаем активные creative_id из Facebook
    const activeCreativeIds = await getActiveCreativeIdsFromFacebook();
    
    console.log(`\n✅ Active creative IDs in Facebook:`);
    console.log(Array.from(activeCreativeIds).join(', '));
    
    // 2. Фильтруем креативы пользователя
    const unusedCreatives = [];
    
    console.log(`\n\n🎨 Processing ${USER_CREATIVES.length} user creatives:\n`);
    
    for (const uc of USER_CREATIVES) {
      // Проверяем все fb_creative_id этого креатива
      const creativeIds = [
        uc.fb_creative_id_whatsapp,
        uc.fb_creative_id_instagram_traffic,
        uc.fb_creative_id_site_leads
      ].filter(id => id);
      
      console.log(`📝 "${uc.title}"`);
      console.log(`   Creative IDs: ${creativeIds.join(', ')}`);
      
      // Если НИ ОДИН из creative_id не используется в активных ads
      const isUnused = creativeIds.length > 0 && 
                       !creativeIds.some(id => activeCreativeIds.has(id));
      
      console.log(`   Is unused: ${isUnused}`);
      
      if (creativeIds.some(id => activeCreativeIds.has(id))) {
        const usedIds = creativeIds.filter(id => activeCreativeIds.has(id));
        console.log(`   ⚠️  ИСПОЛЬЗУЕТСЯ! Creative IDs: ${usedIds.join(', ')}`);
      }
      
      if (isUnused) {
        // Определяем рекомендуемый objective
        let recommendedObjective = 'WhatsApp';
        if (uc.fb_creative_id_whatsapp) recommendedObjective = 'WhatsApp';
        else if (uc.fb_creative_id_instagram_traffic) recommendedObjective = 'Instagram';
        else if (uc.fb_creative_id_site_leads) recommendedObjective = 'SiteLeads';
        
        unusedCreatives.push({
          id: uc.id,
          title: uc.title,
          fb_creative_id_whatsapp: uc.fb_creative_id_whatsapp,
          fb_creative_id_instagram_traffic: uc.fb_creative_id_instagram_traffic,
          fb_creative_id_site_leads: uc.fb_creative_id_site_leads,
          recommended_objective: recommendedObjective,
          created_at: new Date().toISOString()
        });
      }
      
      console.log('');
    }
    
    // 3. Результат
    console.log(`\n${'='.repeat(60)}`);
    console.log(`\n🎯 РЕЗУЛЬТАТ: ${unusedCreatives.length} неиспользуемых креативов\n`);
    
    if (unusedCreatives.length > 0) {
      console.log('Список для LLM (unused_creatives):');
      console.log(JSON.stringify(unusedCreatives, null, 2));
    } else {
      console.log('⚠️  Все креативы используются в активных ads!');
      console.log('   LLM получит пустой массив unused_creatives: []');
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testUnusedCreatives();

