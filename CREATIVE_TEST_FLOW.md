# 🔄 ПОЛНЫЙ FLOW ТЕСТИРОВАНИЯ КРЕАТИВОВ

## 📅 Дата: 6 октября 2025

---

## 🎯 ВЕСЬ ПРОЦЕСС ОТ ЗАГРУЗКИ ДО АНАЛИЗА

```
┌─────────────────────────────────────────────────────────────────┐
│                    ШАГ 1: ЗАГРУЗКА ВИДЕО                        │
└─────────────────────────────────────────────────────────────────┘

ФРОНТ → POST /api/process-video (agent-service:8080)
  {
    "user_id": "uuid",
    "video": <multipart file>,
    "description": "Текст",
    "language": "ru"
  }

AGENT-SERVICE:
  1. Извлекает аудио из видео (FFmpeg)
  2. Транскрибирует через OpenAI Whisper
  3. Создает запись в user_creatives:
     ↓
     user_creatives:
     - id: "creative-uuid-123"
     - user_id: "user-uuid"
     - title: "Мое видео"
     - status: "processing" → "ready"
     - fb_video_id: null → "fb-video-123"
     - fb_creative_id_whatsapp: null → "fb-creative-wa-456"
     - fb_creative_id_instagram_traffic: null → "fb-creative-ig-789"
     - fb_creative_id_site_leads: null → "fb-creative-sl-012"
  
  4. Загружает видео в Facebook
  5. Создает 3 креатива параллельно (WhatsApp, Instagram, SiteLeads)
  6. Сохраняет транскрибацию:
     ↓
     creative_transcripts:
     - id: "transcript-uuid-456"
     - creative_id: "creative-uuid-123" ← СВЯЗЬ с user_creatives.id
     - text: "Привет, это мое видео..."
     - lang: "ru"
     - status: "ready"

✅ РЕЗУЛЬТАТ: Креатив готов к использованию!

┌─────────────────────────────────────────────────────────────────┐
│              ШАГ 2: НАЖАТИЕ "БЫСТРЫЙ ТЕСТ"                      │
└─────────────────────────────────────────────────────────────────┘

ФРОНТ → POST /api/agent/actions (agent-service:8080)
  {
    "account": {
      "userAccountId": "user-uuid"
    },
    "actions": [
      {
        "type": "StartCreativeTest",
        "params": {
          "user_creative_id": "creative-uuid-123"
        }
      }
    ]
  }

AGENT-SERVICE (actions.ts):
  1. Валидация параметров
  2. Резолвит токен и ad_account_id из user_accounts
  3. Вызывает workflowStartCreativeTest()

WORKFLOW (creativeTest.ts):
  1. Проверяет креатив в user_creatives:
     - Существует?
     - status = 'ready'?
     - fb_creative_id_whatsapp присутствует?
  
  2. Создает Campaign в Facebook:
     - objective: OUTCOME_ENGAGEMENT
     - name: "Test — Creative #xxx"
     - status: ACTIVE
  
  3. Создает AdSet в Facebook:
     - daily_budget: 2000 центов ($20)
     - optimization_goal: CONVERSATIONS
     - destination_type: WHATSAPP
     - status: ACTIVE
  
  4. Создает Ad в Facebook:
     - creative_id: fb_creative_id_whatsapp
     - status: ACTIVE
  
  5. Создает Facebook Auto Rule:
     - evaluation: EVERY_15_MIN
     - filter: impressions > 1000
     - action: PAUSE
  
  6. Сохраняет в creative_tests:
     ↓
     creative_tests:
     - id: "test-uuid-789"
     - user_creative_id: "creative-uuid-123" ← СВЯЗЬ с user_creatives.id
     - user_id: "user-uuid" (денормализация для RLS)
     - campaign_id: "fb-campaign-111"
     - adset_id: "fb-adset-222"
     - ad_id: "fb-ad-333"
     - rule_id: "fb-rule-444"
     - status: "running"
     - started_at: NOW()
     - test_budget_cents: 2000
     - test_impressions_limit: 1000
     - objective: "WhatsApp"

✅ РЕЗУЛЬТАТ: Тест запущен на Facebook!

┌─────────────────────────────────────────────────────────────────┐
│           ШАГ 3: FACEBOOK ПОКАЗЫВАЕТ РЕКЛАМУ                    │
└─────────────────────────────────────────────────────────────────┘

FACEBOOK:
  - Крутит рекламу
  - Каждые 15 минут проверяет Auto Rule
  - Когда impressions > 1000 → ПАУЗИТ AdSet автоматически
  
МЕТРИКИ НАКАПЛИВАЮТСЯ:
  - Impressions
  - Reach
  - Clicks
  - Leads
  - Spend
  - Video views (25%, 50%, 75%, 95%)

┌─────────────────────────────────────────────────────────────────┐
│          ШАГ 4: CRON ПРОВЕРЯЕТ АКТИВНЫЕ ТЕСТЫ                   │
└─────────────────────────────────────────────────────────────────┘

CRON JOB (каждые 5 минут):
  → GET /api/creative-test/status (agent-service)
  
  Возвращает все тесты со status='running'

Для каждого теста:
  → POST /api/creative-test/check/:test_id

AGENT-SERVICE (creativeTest.ts):
  1. Получает test из creative_tests
  2. Проверяет: test.status = 'running'?
  3. Делает запрос к Facebook Insights API:
     ↓
     GET /v20.0/{ad_id}/insights?fields=impressions,reach,clicks,leads,...
  
  4. Обновляет метрики в creative_tests:
     ↓
     UPDATE creative_tests SET
       impressions = 1050,
       reach = 920,
       clicks = 45,
       leads = 12,
       spend_cents = 1800,
       cpm_cents = 171,
       cpc_cents = 40,
       cpl_cents = 150,
       video_views = 850,
       video_views_25_percent = 720,
       video_views_50_percent = 520,
       video_views_75_percent = 310,
       video_views_95_percent = 180,
       ...
     WHERE id = 'test-uuid-789'
  
  5. Проверяет: impressions >= 1000?
     
     ✅ ДА → ВЫЗЫВАЕТ ANALYZER!

┌─────────────────────────────────────────────────────────────────┐
│            ШАГ 5: АНАЛИЗ РЕЗУЛЬТАТОВ (LLM)                      │
└─────────────────────────────────────────────────────────────────┘

AGENT-SERVICE:
  → POST http://localhost:7081/api/analyzer/analyze-test
    { "test_id": "test-uuid-789" }

ANALYZER-SERVICE (analyzerService.js) — ОТДЕЛЬНЫЙ МИКРОСЕРВИС!

  1. Читает тест из Supabase:
     ↓
     SELECT * FROM creative_tests
     LEFT JOIN user_creatives ON creative_tests.user_creative_id = user_creatives.id
     WHERE creative_tests.id = 'test-uuid-789'
  
  2. Читает транскрибацию:
     ↓
     SELECT text FROM creative_transcripts
     WHERE creative_id = 'creative-uuid-123'  ← СВЯЗЬ!
     ORDER BY created_at DESC
     LIMIT 1
  
  3. Подготавливает данные для LLM:
     testData = {
       creative_title: "Мое видео",
       impressions: 1050,
       reach: 920,
       clicks: 45,
       ctr: 4.29,
       leads: 12,
       cpl_cents: 150,
       video_views: 850,
       video_views_25_percent: 720,
       video_views_50_percent: 520,
       video_views_75_percent: 310,
       ...
     }
     
     transcriptText = "Привет, это мое видео..."
  
  4. Вызывает OpenAI LLM (creativeAnalyzer.js):
     ↓
     ПРОМПТ:
     "Ты эксперт по Facebook рекламе. Проанализируй результаты теста.
      
      Метрики:
      - Impressions: 1050
      - CPL: $1.50
      - CTR: 4.29%
      - Video 75%: 310 (36.5%)
      
      Транскрибация:
      'Привет, это мое видео...'
      
      Задача:
      1. Оцени 0-100
      2. Вердикт: excellent/good/average/poor
      3. Анализ видео: где теряем внимание?
      4. Рекомендации: какие фразы изменить?"
  
  5. Получает ответ от LLM:
     {
       "score": 75,
       "verdict": "good",
       "reasoning": "Хороший CTR и низкий CPL. Но 36% уходят после 75% видео.",
       "video_analysis": "Падение на 75% говорит о слабом призыве к действию.",
       "text_recommendations": "Усилить CTA в конце: 'Напишите сейчас!'",
       "transcript_match_quality": "high",
       "transcript_suggestions": [
         {
           "from": "Спасибо за внимание",
           "to": "Напишите нам сейчас в WhatsApp!",
           "reason": "Слабый CTA в конце",
           "position": "конец"
         }
       ]
     }
  
  6. Сохраняет результаты в Supabase:
     ↓
     UPDATE creative_tests SET
       status = 'completed',
       completed_at = NOW(),
       llm_score = 75,
       llm_verdict = 'good',
       llm_reasoning = '...',
       llm_video_analysis = '...',
       llm_text_recommendations = '...',
       transcript_match_quality = 'high',
       transcript_suggestions = '[...]'
     WHERE id = 'test-uuid-789'

✅ РЕЗУЛЬТАТ: Тест завершен, результаты в БД!

┌─────────────────────────────────────────────────────────────────┐
│              ШАГ 6: ОТОБРАЖЕНИЕ НА ФРОНТЕ                       │
└─────────────────────────────────────────────────────────────────┘

ФРОНТ (React/Vue/etc):

1. Подписка на Supabase Realtime:
   ↓
   const subscription = supabase
     .channel('creative_tests')
     .on('postgres_changes', {
       event: 'UPDATE',
       schema: 'public',
       table: 'creative_tests',
       filter: `user_id=eq.${userId}`
     }, (payload) => {
       if (payload.new.status === 'completed') {
         showTestResults(payload.new);
       }
     })
     .subscribe();

2. Получает обновление автоматически:
   ↓
   {
     "id": "test-uuid-789",
     "status": "completed",
     "impressions": 1050,
     "leads": 12,
     "cpl_cents": 150,
     "llm_score": 75,
     "llm_verdict": "good",
     "llm_reasoning": "...",
     "llm_video_analysis": "...",
     "transcript_suggestions": [...]
   }

3. Отображает результаты:
   ↓
   ┌─────────────────────────────────┐
   │ Результаты теста                │
   ├─────────────────────────────────┤
   │ ⭐ Оценка: 75/100 (Good)        │
   │                                 │
   │ 📊 Метрики:                     │
   │ • CPL: $1.50                    │
   │ • CTR: 4.29%                    │
   │ • Leads: 12                     │
   │                                 │
   │ 🎬 Анализ видео:                │
   │ "Падение на 75%..."             │
   │                                 │
   │ 💡 Рекомендации:                │
   │ • "Спасибо за внимание"         │
   │   → "Напишите нам сейчас!"      │
   │   Причина: Слабый CTA           │
   └─────────────────────────────────┘

✅ РЕЗУЛЬТАТ: Пользователь видит анализ!

```

---

## 🔗 СВЯЗИ МЕЖДУ ТАБЛИЦАМИ

```sql
user_accounts (id)
    ↓
user_creatives (user_id, id)
    ↓                     ↓
creative_transcripts   creative_tests
(creative_id)          (user_creative_id, user_id)
```

**ВАЖНО:**
- `creative_transcripts.creative_id` → `user_creatives.id`
- `creative_tests.user_creative_id` → `user_creatives.id`
- `creative_tests.user_id` — денормализация для RLS

---

## 📊 СХЕМА ДАННЫХ

### 1. user_creatives
```
id: UUID (PK)
user_id: UUID (FK → user_accounts)
title: TEXT
status: 'processing' | 'ready' | 'failed'
fb_video_id: TEXT
fb_creative_id_whatsapp: TEXT
fb_creative_id_instagram_traffic: TEXT
fb_creative_id_site_leads: TEXT
created_at: TIMESTAMPTZ
```

### 2. creative_transcripts
```
id: UUID (PK)
creative_id: UUID (FK → user_creatives.id)
text: TEXT
lang: TEXT
source: 'whisper' | 'manual' | 'auto'
status: 'ready'
created_at: TIMESTAMPTZ
```

### 3. creative_tests
```
id: UUID (PK)
user_creative_id: UUID (FK → user_creatives.id)
user_id: UUID (денормализация для RLS)
campaign_id, adset_id, ad_id, rule_id: TEXT
status: 'pending' | 'running' | 'completed' | 'failed'
test_budget_cents: 2000
test_impressions_limit: 1000

-- Метрики из Facebook
impressions, reach, clicks, leads, spend_cents
cpm_cents, cpc_cents, cpl_cents
video_views, video_views_25/50/75/95_percent

-- LLM анализ
llm_score: INTEGER (0-100)
llm_verdict: 'excellent' | 'good' | 'average' | 'poor'
llm_reasoning: TEXT
llm_video_analysis: TEXT
llm_text_recommendations: TEXT
transcript_match_quality: 'high' | 'medium' | 'low'
transcript_suggestions: JSONB

created_at, completed_at: TIMESTAMPTZ
```

---

## 🚀 МИКРОСЕРВИСЫ

### 1. agent-service:8080
- POST /api/process-video (загрузка видео)
- POST /api/agent/actions (запуск теста)
- GET /api/creative-test/status (cron)
- POST /api/creative-test/check/:id (cron)

### 2. analyzer-service:7081 (ОТДЕЛЬНЫЙ!)
- POST /api/analyzer/analyze-test
- POST /api/analyzer/analyze-batch

### 3. agent-brain:7080 (НЕ ЗАТРОНУТ!)
- Основной Brain Agent
- Промпт не изменен

---

## ✅ ВСЕ СВЯЗИ ПРАВИЛЬНЫЕ!

1. ✅ Загрузка видео → user_creatives + creative_transcripts
2. ✅ StartCreativeTest → creative_tests (связь через user_creative_id)
3. ✅ Analyzer → читает метрики из creative_tests
4. ✅ Analyzer → читает транскрипцию из creative_transcripts (через creative_id)
5. ✅ Фронт → читает из creative_tests через Realtime

**НЕТ КОНФЛИКТОВ!** Все поля правильно названы и связаны! 🎉
