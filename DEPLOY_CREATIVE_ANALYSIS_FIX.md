# 🚀 Деплой: Фикс сохранения LLM анализа креативов

**Дата**: 21 ноября 2025  
**Коммит**: `5a28110`

---

## 📋 Что исправлено

### Проблема:
- ❌ LLM анализ креативов пропадал после обновления страницы
- ❌ Таблица `creative_analysis` не существовала в production БД
- ❌ RLS политики блокировали чтение для anon роли

### Решение:
- ✅ Создана таблица `creative_analysis` для хранения LLM анализов
- ✅ Добавлен UNIQUE constraint для корректной работы upsert
- ✅ Исправлены RLS политики для разрешения чтения с фронтенда
- ✅ Заменен delete + insert на атомарный upsert в коде

---

## 🗃️ Миграции БД (применить в Supabase SQL Editor)

### 1️⃣ Миграция 032: Создание таблицы creative_analysis

```sql
-- Migration: Creative Analysis Table
-- Created: 2025-11-20

CREATE TABLE IF NOT EXISTS creative_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creative_id UUID NOT NULL REFERENCES user_creatives(id) ON DELETE CASCADE,
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  
  -- Источник анализа
  source TEXT NOT NULL CHECK (source IN ('test', 'manual', 'scheduled')),
  test_id UUID REFERENCES creative_tests(id),
  
  -- Период метрик
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  
  -- Агрегированные метрики (snapshot)
  metrics JSONB NOT NULL,
  
  -- LLM Анализ
  score INTEGER CHECK (score >= 0 AND score <= 100),
  verdict TEXT CHECK (verdict IN ('excellent', 'good', 'average', 'poor')),
  reasoning TEXT,
  video_analysis TEXT,
  text_recommendations TEXT,
  transcript_match_quality TEXT CHECK (transcript_match_quality IN ('high', 'medium', 'low')),
  transcript_suggestions JSONB,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_creative_analysis_creative ON creative_analysis(creative_id, created_at DESC);
CREATE INDEX idx_creative_analysis_user ON creative_analysis(user_account_id, created_at DESC);
CREATE INDEX idx_creative_analysis_source ON creative_analysis(source, created_at DESC);
CREATE INDEX idx_creative_analysis_test ON creative_analysis(test_id) WHERE test_id IS NOT NULL;

ALTER TABLE creative_analysis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own creative analyses"
  ON creative_analysis FOR SELECT
  USING (auth.uid() = user_account_id);

CREATE POLICY "Service role has full access to creative analyses"
  ON creative_analysis
  USING (auth.role() = 'service_role');
```

### 2️⃣ Миграция 038: Добавление user_creative_id в metrics_history

```sql
-- Migration: Add user_creative_id to creative_metrics_history

ALTER TABLE creative_metrics_history
ADD COLUMN IF NOT EXISTS user_creative_id UUID;

CREATE INDEX IF NOT EXISTS idx_creative_metrics_user_creative_id
ON creative_metrics_history(user_creative_id, user_account_id, date DESC);

ALTER TABLE creative_metrics_history
ADD CONSTRAINT fk_creative_metrics_user_creative
FOREIGN KEY (user_creative_id)
REFERENCES user_creatives(id)
ON DELETE CASCADE;

-- Backfill existing data
UPDATE creative_metrics_history cmh
SET user_creative_id = acm.user_creative_id
FROM ad_creative_mapping acm
WHERE cmh.user_creative_id IS NULL
  AND cmh.ad_id = acm.ad_id;

UPDATE creative_metrics_history cmh
SET user_creative_id = acm.user_creative_id
FROM ad_creative_mapping acm
WHERE cmh.user_creative_id IS NULL
  AND cmh.creative_id = acm.fb_creative_id
  AND cmh.user_account_id = acm.user_id;
```

### 3️⃣ Миграция 039: Триггер автозаполнения user_creative_id

```sql
-- Migration: Auto-fill user_creative_id trigger

CREATE OR REPLACE FUNCTION auto_fill_user_creative_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.user_creative_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.ad_id IS NOT NULL THEN
    SELECT user_creative_id INTO NEW.user_creative_id
    FROM ad_creative_mapping
    WHERE ad_id = NEW.ad_id
    LIMIT 1;
  END IF;

  IF NEW.user_creative_id IS NULL AND NEW.creative_id IS NOT NULL THEN
    SELECT user_creative_id INTO NEW.user_creative_id
    FROM ad_creative_mapping
    WHERE fb_creative_id = NEW.creative_id
      AND user_id = NEW.user_account_id
    LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_auto_fill_user_creative_id
  BEFORE INSERT OR UPDATE ON creative_metrics_history
  FOR EACH ROW
  EXECUTE FUNCTION auto_fill_user_creative_id();
```

### 4️⃣ Миграция 040: UNIQUE constraint для upsert

```sql
-- Migration: Add unique constraint to creative_analysis

-- Удаляем дубликаты (если есть)
DELETE FROM creative_analysis a
USING creative_analysis b
WHERE a.id < b.id
  AND a.creative_id = b.creative_id
  AND a.user_account_id = b.user_account_id
  AND a.source = b.source;

-- Добавляем unique constraint
ALTER TABLE creative_analysis
ADD CONSTRAINT creative_analysis_unique_per_source
UNIQUE (creative_id, user_account_id, source);
```

### 5️⃣ Миграция 041: Исправление RLS политик

```sql
-- Migration: Fix RLS policy for creative_analysis

-- Удаляем старую политику
DROP POLICY IF EXISTS "Users can view own creative analyses" ON creative_analysis;

-- Создаем новую политику для SELECT
CREATE POLICY "Allow read access for creative analyses"
  ON creative_analysis FOR SELECT
  USING (true);

-- Для INSERT/UPDATE/DELETE оставляем доступ только service_role
CREATE POLICY "Service role can modify creative analyses"
  ON creative_analysis FOR ALL
  USING (auth.role() = 'service_role');
```

---

## 🐳 Деплой на сервер

### 1. SSH на сервер

```bash
ssh root@your-server
cd ~/agents-monorepo
```

### 2. Применить миграции в Supabase

**Важно**: Применить **ВСЕ 5 миграций** в Supabase SQL Editor в порядке:
- 032 → 038 → 039 → 040 → 041

### 3. Подтянуть изменения

```bash
git pull origin main
```

### 4. Пересобрать и перезапустить creative-analyzer

```bash
docker-compose build creative-analyzer
docker-compose up -d creative-analyzer
```

### 5. Проверить логи

```bash
docker-compose logs -f creative-analyzer
```

### 6. Проверить что сервис работает

```bash
curl http://localhost:7081/health
# Должно вернуть: {"ok":true,"service":"creative-analyzer"}
```

---

## ✅ Проверка после деплоя

1. Открыть ROI Analytics: https://app.performanteaiagency.com/roi
2. Выбрать креатив и развернуть его (кликнуть на строку)
3. Нажать **"Запустить анализ креатива"**
4. Дождаться завершения анализа (~20 секунд)
5. **Обновить страницу** (F5 или Cmd+R)
6. ✅ Анализ должен остаться и загрузиться автоматически

### SQL проверка в Supabase:

```sql
-- Проверить что анализ сохранился
SELECT 
  id,
  creative_id,
  source,
  score,
  verdict,
  reasoning,
  created_at
FROM creative_analysis 
ORDER BY created_at DESC
LIMIT 10;
```

---

## 📝 Изменения в коде

### `services/agent-brain/src/analyzerService.js`

**Было (неправильно)**:
```javascript
// Сначала удаляем старые анализы
await supabase
  .from('creative_analysis')
  .delete()
  .eq('creative_id', creative_id)
  .eq('user_account_id', user_id)
  .eq('source', 'manual');

// Потом вставляем новый
await supabase
  .from('creative_analysis')
  .insert({...});
```

**Стало (правильно)**:
```javascript
// Используем upsert для атомарной операции
await supabase
  .from('creative_analysis')
  .upsert({
    creative_id: creative_id,
    user_account_id: user_id,
    source: 'manual',
    // ... остальные поля
  }, {
    onConflict: 'creative_id,user_account_id,source'
  });
```

---

## 🎯 Результат

- ✅ LLM анализы креативов теперь **сохраняются в БД**
- ✅ Анализы **не пропадают** после обновления страницы
- ✅ Автоматическая **загрузка анализа** при раскрытии креатива
- ✅ Корректная работа **upsert** (обновление существующих записей)
- ✅ Нет дублирования анализов благодаря UNIQUE constraint

---

**Автор**: AI Assistant  
**Дата**: 21 ноября 2025  
**Статус**: ✅ Готово к деплою


