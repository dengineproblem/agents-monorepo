# 🧪 БЫСТРЫЙ ТЕСТ — ШПАРГАЛКА ДЛЯ FRONTEND

## 📍 WEBHOOK

```
POST https://agents.performanteaiagency.com/api/creative-test/start
```

---

## 📤 ЗАПРОС

```javascript
fetch('https://agents.performanteaiagency.com/api/creative-test/start', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    user_creative_id: "UUID креатива",
    user_id: "UUID пользователя"
  })
})
```

---

## 📥 ОТВЕТ

### ✅ Успех (200)
```json
{
  "success": true,
  "test_id": "uuid",
  "campaign_id": "...",
  "adset_id": "...",
  "ad_id": "...",
  "message": "Creative test started. Budget: $20/day, Target: 1000 impressions"
}
```

### ❌ Ошибки
- `400` — Тест уже запущен / Креатив не готов
- `404` — Креатив/Пользователь не найден

---

## 📊 ДАННЫЕ ИЗ SUPABASE

**Таблица:** `creative_tests`

**Читать по:**
```javascript
const { data } = await supabase
  .from('creative_tests')
  .select('*')
  .eq('user_creative_id', creativeId)
  .single();
```

---

## 📋 ОСНОВНЫЕ ПОЛЯ

```typescript
{
  id: string;                    // UUID теста
  status: 'running' | 'completed'; // Статус
  
  // Прогресс
  impressions: number;           // Текущие показы
  test_impressions_limit: 1000,  // Лимит (всегда 1000)
  
  // Результаты (после завершения)
  llm_score: number;             // 0-100
  llm_verdict: string;           // 'excellent' | 'good' | 'average' | 'poor'
  llm_reasoning: string;         // Текст анализа
  
  // Метрики
  spend_cents: number;           // Потрачено
  leads: number;                 // Лиды
  ctr: number;                   // CTR %
  cpl_cents: number;             // Стоимость лида
}
```

---

## 🔄 МОНИТОРИНГ (Realtime)

```javascript
supabase
  .channel('test')
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'creative_tests',
    filter: `id=eq.${testId}`
  }, (payload) => {
    const test = payload.new;
    
    if (test.status === 'completed') {
      showResults(test);
    }
  })
  .subscribe();
```

---

## 🎨 UI FLOW

```
1. Кнопка "Быстрый тест" (если нет активного теста)
   ↓
2. POST запрос → получаем test_id
   ↓
3. Показываем "Тестируется... 456/1000 показов"
   ↓
4. Мониторим через Realtime (или polling каждые 30 сек)
   ↓
5. При status='completed' показываем:
   - LLM Score: 78/100
   - Verdict: Хорошо 👍
   - Анализ + рекомендации
```

---

## ⏱️ ВРЕМЯ ВЫПОЛНЕНИЯ

**~2-4 часа** до 1000 показов

---

## 💰 БЮДЖЕТ

**$20/день** (фиксированный)

Не влияет на общий бюджет аккаунта.

---

## 🚫 ОГРАНИЧЕНИЯ

- **1 тест = 1 креатив** (нельзя запустить два теста для одного креатива)
- Требуется `fb_creative_id_whatsapp` (WhatsApp версия)
- Креатив должен быть `status='ready'` и `is_active=true`

---

## 📚 ПОЛНАЯ ДОКУМЕНТАЦИЯ

👉 `FRONTEND_QUICK_TEST_API.md`

