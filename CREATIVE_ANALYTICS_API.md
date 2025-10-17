# 📊 Creative Analytics API

**Дата создания:** 17 октября 2025  
**Версия:** 1.0

---

## 🎯 Назначение

Новый API для получения полной аналитики креативов с учетом:
- Результатов быстрого теста (если проводился)
- Реальных метрик из production (если используется в рекламе)
- LLM анализа с единым скорингом

**Ключевая особенность:** Автоматически выбирает актуальный источник данных:
- Если креатив используется в production → анализ по production
- Если только тест → анализ по тесту
- Единый формат скоринга и метрик

---

## 🚀 Endpoint

```
GET /api/analyzer/creative-analytics/:user_creative_id
```

**Параметры:**
- `user_creative_id` (path, required) - UUID креатива из `user_creatives`
- `user_id` (query, required) - UUID пользователя
- `force` (query, optional) - Принудительное обновление (игнорировать кеш)

**Пример запроса:**
```bash
curl "http://localhost:7081/api/analyzer/creative-analytics/abc-123?user_id=user-456"
```

---

## 📦 Структура ответа

### Успешный ответ (200 OK)

```json
{
  "creative": {
    "id": "abc-123",
    "title": "Осенняя акция",
    "status": "ready",
    "direction_id": "dir-789",
    "direction_name": "Имплантация"
  },
  
  "data_source": "production",
  
  "test": {
    "exists": true,
    "status": "completed",
    "completed_at": "2025-10-10T12:00:00Z",
    "metrics": {
      "impressions": 1050,
      "reach": 920,
      "leads": 12,
      "cpl_cents": 150,
      "ctr": 4.29,
      "video_views": 850,
      "video_views_25_percent": 720,
      "video_views_50_percent": 520,
      "video_views_75_percent": 310,
      "video_views_95_percent": 180
    },
    "llm_analysis": {
      "score": 75,
      "verdict": "good",
      "reasoning": "Хороший CPL и CTR..."
    }
  },
  
  "production": {
    "in_use": true,
    "metrics": {
      "impressions": 45230,
      "reach": 41000,
      "frequency": 1.1,
      "clicks": 1453,
      "link_clicks": 1200,
      "ctr": 3.21,
      "link_ctr": 2.65,
      "leads": 450,
      "spend_cents": 89050,
      "cpm_cents": 1967,
      "cpc_cents": 61,
      "cpl_cents": 198,
      "video_views": 38000,
      "video_views_25_percent": 32000,
      "video_views_50_percent": 23000,
      "video_views_75_percent": 14000,
      "video_views_95_percent": 7500,
      "video_avg_watch_time_sec": 42.5
    }
  },
  
  "analysis": {
    "score": 72,
    "verdict": "good",
    "reasoning": "Креатив показал стабильные результаты в production. CPL $1.98 - в пределах нормы для направления. Видео retention хороший - 36.8% досматривают до 75%.",
    "video_analysis": "Падение retention на 75% видео говорит о слабом CTA в конце. Первые 50% удерживают внимание отлично.",
    "text_recommendations": "Усилить призыв к действию в последней четверти видео. Добавить конкретное предложение.",
    "transcript_match_quality": "high",
    "transcript_suggestions": [
      {
        "from": "Спасибо за внимание",
        "to": "Напишите нам в WhatsApp сейчас и получите скидку 10%",
        "reason": "Слабый CTA в конце видео",
        "position": "конец"
      }
    ],
    "based_on": "production",
    "note": "Анализ основан на реальных данных из рекламы"
  },
  
  "from_cache": false
}
```

---

## 📊 Поле `data_source`

Определяет источник данных для анализа:

| Значение | Описание | Логика |
|----------|----------|--------|
| `production` | Креатив используется в рекламе | Анализ по lifetime метрикам из Facebook |
| `test` | Только тест, не в production | Анализ по результатам теста |
| `none` | Нет данных | Ни теста, ни production |

---

## 🔄 Приоритет источников

```
1. Production метрики (если креатив используется) ← ПРИОРИТЕТ
2. Результаты теста (если test проведен)
3. Нет данных (если ничего нет)
```

**Почему приоритет у production?**
- Реальные данные всегда актуальнее теста
- Больший объем данных = надежнее скоринг
- Тест - это 1000 показов, production - десятки тысяч

---

## 💾 Кеширование

**Время жизни кеша:** 10 минут

**Логика:**
- Первый запрос → Facebook API + LLM → кеш
- Повторные запросы (до 10 мин) → кеш (мгновенно)
- После 10 мин → обновление

**Принудительное обновление:**
```bash
curl "http://localhost:7081/api/analyzer/creative-analytics/abc-123?user_id=user-456&force=true"
```

**Индикатор кеша в ответе:**
```json
{
  "from_cache": true,
  "cached_at": "2025-10-17T14:30:00Z"
}
```

---

## 🎬 Видео метрики

Включены в оба источника (test и production):

```json
{
  "video_views": 38000,
  "video_views_25_percent": 32000,
  "video_views_50_percent": 23000,
  "video_views_75_percent": 14000,
  "video_views_95_percent": 7500,
  "video_avg_watch_time_sec": 42.5
}
```

**LLM анализирует:**
- Где падает retention
- Какая часть видео удерживает внимание
- Проблемные места в транскрипции

---

## 🏆 Скоринг

**Формат ИДЕНТИЧНЫЙ тесту:**

```json
{
  "score": 72,
  "verdict": "good",
  "reasoning": "...",
  "video_analysis": "...",
  "text_recommendations": "...",
  "transcript_match_quality": "high",
  "transcript_suggestions": [...]
}
```

**Шкала:**
- 80-100: `excellent` ⭐⭐⭐
- 60-79: `good` ⭐⭐
- 40-59: `average` ⭐
- 0-39: `poor` ❌

---

## 📋 Сценарии использования

### Сценарий 1: Креатив только что создан

**Запрос:**
```bash
GET /api/analyzer/creative-analytics/new-creative?user_id=user-123
```

**Ответ:**
```json
{
  "creative": {...},
  "data_source": "none",
  "message": "Креатив не тестировался и не используется в рекламе",
  "test": null,
  "production": null,
  "analysis": null
}
```

### Сценарий 2: Тест прошел, не в production

**Ответ:**
```json
{
  "data_source": "test",
  "test": { "exists": true, "metrics": {...}, "llm_analysis": {...} },
  "production": null,
  "analysis": {
    "based_on": "test",
    "note": "Анализ основан на результатах теста"
  }
}
```

### Сценарий 3: В production

**Ответ:**
```json
{
  "data_source": "production",
  "test": { "exists": true, ... },
  "production": { "in_use": true, "metrics": {...} },
  "analysis": {
    "based_on": "production",
    "note": "Анализ основан на реальных данных из рекламы"
  }
}
```

---

## 🔧 Технические детали

### Откуда берутся production метрики?

**Facebook Graph API:**
```
GET /{ad_account_id}/insights
  ?level=ad
  &filtering=[{"field":"ad.creative_id","operator":"EQUAL","value":"123"}]
  &date_preset=lifetime
  &fields=impressions,reach,spend,ctr,cpm,video_*,...
```

**Агрегация:**
- Если креатив используется в нескольких ads → суммируем метрики
- Lifetime = весь период использования

### Какой fb_creative_id используется?

**Приоритет:**
1. `fb_creative_id_whatsapp`
2. `fb_creative_id_instagram_traffic`
3. `fb_creative_id_site_leads`

Берется первый доступный.

### Используемая LLM функция

**Существующая функция:** `analyzeCreativeTest()` из `creativeAnalyzer.js`

**Промпт:** Тот же самый, что для тестов (без изменений!)

**Модель:** `gpt-4o` (по умолчанию)

---

## ⚠️ Ошибки

### 400 Bad Request
```json
{
  "error": "user_creative_id and user_id are required"
}
```

### 404 Not Found
```json
{
  "error": "Creative not found"
}
```

### 500 Internal Server Error
```json
{
  "error": "FB production insights failed: 400 ..."
}
```

---

## 🧪 Тестирование

### Локальный запуск analyzer-service

```bash
cd services/agent-brain
ANALYZER_PORT=7081 \
OPENAI_API_KEY=sk-... \
SUPABASE_URL=https://... \
SUPABASE_SERVICE_ROLE_KEY=... \
node src/analyzerService.js
```

### Проверка health

```bash
curl http://localhost:7081/health
# { "ok": true, "service": "creative-analyzer" }
```

### Тестовый запрос

```bash
# 1. Получить user_creative_id из Supabase
# 2. Запросить аналитику
curl "http://localhost:7081/api/analyzer/creative-analytics/YOUR_CREATIVE_ID?user_id=YOUR_USER_ID"
```

### Проверка кеша

```bash
# Первый запрос (медленно, ~3-5 сек)
time curl "http://localhost:7081/api/analyzer/creative-analytics/abc?user_id=123"

# Второй запрос (мгновенно, <100ms)
time curl "http://localhost:7081/api/analyzer/creative-analytics/abc?user_id=123"
# from_cache: true
```

---

## 📚 Связанная документация

- **Тестирование креативов:** `CREATIVE_TEST_FLOW.md`
- **Скоринг агент:** `SCORING_SUMMARY.md`
- **Обзор проекта:** `PROJECT_OVERVIEW_RU.md`

---

## 🎉 Преимущества нового API

✅ **Единый endpoint** для всей аналитики креатива  
✅ **Умный выбор источника** (production приоритетнее теста)  
✅ **Кеширование** защищает от частых LLM запросов  
✅ **Идентичный формат** скоринга (легко для фронта)  
✅ **Видео метрики** включены по умолчанию  
✅ **НЕ трогает** существующий тестовый flow  

---

## 🔮 Будущие улучшения

- [ ] Сравнение с другими креативами направления
- [ ] История изменений метрик (графики)
- [ ] Webhook уведомления при изменении скора
- [ ] Batch endpoint для получения аналитики по нескольким креативам

