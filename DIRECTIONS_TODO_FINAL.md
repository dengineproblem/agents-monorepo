# 🚨 КРИТИЧНО: Восстановить потерянные изменения

## ❌ ЧТО БЫЛО ПОТЕРЯНО

Все изменения в Brain Agent и Scoring Agent для интеграции с направлениями **НЕ БЫЛИ СОХРАНЕНЫ** в файлы!

---

## ✅ ЧТО УЖЕ ВОССТАНОВЛЕНО

### 1. Brain Agent - Функции для работы с направлениями ✅

Добавлены в `services/agent-brain/src/server.js` (строка 321-353):
```javascript
async function getUserDirections(userAccountId)
async function getDirectionByCampaignId(campaignId)
```

---

## ❌ ЧТО ЕЩЁ НУЖНО ВОССТАНОВИТЬ

### 2. Brain Agent - Интеграция в `/api/brain/run`

**Файл:** `services/agent-brain/src/server.js`
**Где:** Около строки 1904 (где создаётся `llmInput`)

**Что добавить:**

```javascript
// ПЕРЕД созданием llmInput добавить:
const directions = await getUserDirections(userAccountId);

// В структуру llmInput добавить:
const llmInput = {
  userAccountId,
  ad_account_id: ua?.ad_account_id || null,
  // ... existing fields ...
  
  // ========================================
  // НАПРАВЛЕНИЯ БИЗНЕСА
  // ========================================
  directions: directions.map(d => ({
    id: d.id,
    name: d.name,
    objective: d.objective,
    fb_campaign_id: d.fb_campaign_id,
    campaign_status: d.campaign_status,
    daily_budget_cents: d.daily_budget_cents,
    target_cpl_cents: d.target_cpl_cents,
  })),
  
  // ... rest of fields ...
};
```

**И обновить секцию campaigns:**

```javascript
// Для каждой кампании найти направление:
analysis: {
  campaigns: await Promise.all(campaigns.map(async (c) => {
    const direction = await getDirectionByCampaignId(c.id);
    
    return {
      ...c, // existing fields
      direction_id: direction?.id || null,
      direction_name: direction?.name || null,
      direction_daily_budget_cents: direction?.daily_budget_cents || null,
      direction_target_cpl_cents: direction?.target_cpl_cents || null,
    };
  })),
  // ...
}
```

---

### 3. Brain Agent - SYSTEM_PROMPT

**Файл:** `services/agent-brain/src/server.js`
**Где:** Около строки 777-818 (в SYSTEM_PROMPT)

**Что добавить ПОСЛЕ строки `'- Бизнес-цель: ...'`:**

```javascript
const SYSTEM_PROMPT = (clientPrompt, reportOnlyMode = false) => [
  // ... existing ...
  
  '📊 НАПРАВЛЕНИЯ БИЗНЕСА (КРИТИЧНО!)',
  '- У клиента могут быть несколько НАПРАВЛЕНИЙ (например: "Имплантация", "Виниры", "Брекеты").',
  '- Каждое направление = отдельная Facebook Campaign с фиксированным ID.',
  '- Каждое направление имеет СВОЙ суточный бюджет (daily_budget_cents) и СВОЙ целевой CPL (target_cpl_cents).',
  '- Внутри кампании направления могут быть МНОЖЕСТВО ad sets (группы объявлений).',
  '- ⚠️ ВАЖНО: Бюджеты направлений НЕ суммируются! Каждое направление управляется ОТДЕЛЬНО.',
  '- ⚠️ ВАЖНО: При изменении бюджетов ad sets в рамках направления, СУММА бюджетов всех активных ad sets НЕ ДОЛЖНА превышать daily_budget_cents направления.',
  '- ⚠️ ВАЖНО: Целевой CPL берется из direction_target_cpl_cents, а НЕ из targets.cpl_cents (который устарел).',
  '',
  'КАК РАБОТАТЬ С НАПРАВЛЕНИЯМИ:',
  '1. В данных (llmInput) ты видишь:',
  '   - directions[] — список направлений с их бюджетами и целевыми CPL',
  '   - analysis.campaigns[] — кампании, где КАЖДАЯ кампания имеет direction_id, direction_name, direction_daily_budget_cents, direction_target_cpl_cents',
  '   - analysis.adsets[] — ad sets, где каждый принадлежит кампании (и соответственно направлению через campaign_id)',
  '2. Для КАЖДОГО направления отдельно:',
  '   - Определи все ad sets этого направления (через campaign_id → direction_id)',
  '   - Посчитай текущую сумму бюджетов всех активных ad sets этого направления',
  '   - Убедись, что сумма НЕ превышает direction_daily_budget_cents',
  '   - Оценивай CPL относительно direction_target_cpl_cents (а не глобального targets.cpl_cents)',
  '3. При формировании действий (actions):',
  '   - Если меняешь бюджеты ad sets, проверяй что итоговая сумма по направлению в лимите',
  '   - Если создаешь новые ad sets (через CreateCampaignWithCreative), они должны добавляться в существующую кампанию направления',
  '4. В отчете (reportText):',
  '   - Группируй результаты ПО НАПРАВЛЕНИЯМ (например: "🎯 Имплантация: 3 заявки, CPL $2.10")',
  '   - Указывай для каждого направления: текущий бюджет, факт расхода, целевой vs фактический CPL',
  '',
  
  // ... rest of SYSTEM_PROMPT ...
];
```

---

### 4. Scoring Agent - Фильтрация креативов

**Файл:** `services/agent-brain/src/scoring.js`
**Функция:** `getActiveCreatives()`
**Где:** Около строки 453

**Заменить:**

```javascript
// БЫЛО:
async function getActiveCreatives(supabase, userAccountId) {
  const { data, error } = await supabase
    .from('user_creatives')
    .select('id, title, fb_video_id, fb_creative_id_whatsapp, ...')
    .eq('user_id', userAccountId)
    .eq('is_active', true)
    .eq('status', 'ready');
  
  if (error) throw new Error(`Failed to get active creatives: ${error.message}`);
  return data || [];
}

// СТАЛО:
async function getActiveCreatives(supabase, userAccountId) {
  // Получаем креативы с информацией о направлении
  const { data, error } = await supabase
    .from('user_creatives')
    .select(`
      id, 
      title, 
      fb_video_id, 
      fb_creative_id_whatsapp, 
      fb_creative_id_instagram_traffic, 
      fb_creative_id_site_leads, 
      is_active, 
      status, 
      created_at,
      direction_id,
      account_directions!inner(is_active)
    `)
    .eq('user_id', userAccountId)
    .eq('is_active', true)
    .eq('status', 'ready')
    .eq('account_directions.is_active', true); // ТОЛЬКО из активных направлений!
  
  if (error) throw new Error(`Failed to get active creatives: ${error.message}`);
  
  // Также включаем креативы БЕЗ направления (legacy)
  const { data: legacyCreatives, error: legacyError } = await supabase
    .from('user_creatives')
    .select('id, title, fb_video_id, fb_creative_id_whatsapp, fb_creative_id_instagram_traffic, fb_creative_id_site_leads, is_active, status, created_at')
    .eq('user_id', userAccountId)
    .eq('is_active', true)
    .eq('status', 'ready')
    .is('direction_id', null); // Креативы без направления
  
  if (legacyError) throw new Error(`Failed to get legacy creatives: ${legacyError.message}`);
  
  return [...(data || []), ...(legacyCreatives || [])];
}
```

---

## 🚀 БЫСТРЫЙ ЧЕКЛИСТ

- [ ] Brain Agent: getUserDirections добавлены ✅ (УЖЕ СДЕЛАНО)
- [ ] Brain Agent: Интегрировать directions[] в llmInput
- [ ] Brain Agent: Добавить direction_id к campaigns
- [ ] Brain Agent: Обновить SYSTEM_PROMPT
- [ ] Scoring Agent: Обновить getActiveCreatives
- [ ] Пересобрать сервисы: `docker-compose build agent-brain`
- [ ] Протестировать полный цикл

---

## 📝 ПОСЛЕ ЗАВЕРШЕНИЯ

```bash
# Проверить что всё работает:
git status
git diff services/agent-brain/src/server.js | grep -i direction

# Если всё ОК - коммит:
git add .
git commit -m "feat: Add Directions (business directions) support

- Add account_directions table with Facebook Campaign integration
- Add API endpoints for Directions CRUD
- Integrate Directions into Brain Agent (llmInput + SYSTEM_PROMPT)
- Filter creatives by active directions in Scoring Agent
- Update nginx config (port 8082)
- Add comprehensive documentation for frontend integration"

git push origin main
```

---

**ВАЖНО:** Все эти изменения УЖЕ ОБСУЖДАЛИСЬ в этом чате, но НЕ БЫЛИ СОХРАНЕНЫ в файлы!

