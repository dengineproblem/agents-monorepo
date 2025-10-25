# Исправление полей анализа LLM креативов

**Дата:** 25 октября 2025

## 🎯 Проблема

При анализе креатива на сервере отсутствовали поля:
- `transcript_match_quality` (соответствие транскрипта: high/medium/low)
- `transcript_suggestions` (конкретные рекомендации по фразам)

**Причина:**
Старые тесты (от 24 октября) были проанализированы версией кода, которая не сохраняла эти поля в БД. При последующих запросах код читал из БД неполные данные.

## ✅ Решение

### Файл: `services/agent-brain/src/analyzerService.js`

**Изменение 1 (строки 661-672):**
Добавлена проверка на наличие `transcript_suggestions` при чтении из БД. Если поле `null`, делается новый LLM анализ.

```javascript
// Было:
if (test && test.llm_score !== null && test.llm_verdict !== null) {
  // читать из БД
}

// Стало:
if (test && test.llm_score !== null && test.llm_verdict !== null && test.transcript_suggestions !== null) {
  analysis = {
    score: test.llm_score,
    verdict: test.llm_verdict,
    reasoning: test.llm_reasoning,
    video_analysis: test.llm_video_analysis,
    text_recommendations: test.llm_text_recommendations,
    transcript_match_quality: test.transcript_match_quality,  // ← добавлено
    transcript_suggestions: test.transcript_suggestions        // ← добавлено
  };
}
```

**Изменение 2 (строки 686-700):**
При новом LLM анализе теперь сохраняются ВСЕ поля в БД.

```javascript
.update({
  llm_score: analysis.score,
  llm_verdict: analysis.verdict,
  llm_reasoning: analysis.reasoning,
  llm_video_analysis: analysis.video_analysis,
  llm_text_recommendations: analysis.text_recommendations,
  transcript_match_quality: analysis.transcript_match_quality,  // ← добавлено
  transcript_suggestions: analysis.transcript_suggestions,      // ← добавлено
  updated_at: new Date().toISOString()
})
```

## 📊 Результат

После деплоя на сервер:

1. **Старые тесты с `null` полями:**
   - Автоматически будут перезапрошены через LLM
   - Получат полный анализ с рекомендациями
   - Данные сохранятся в БД

2. **Новые тесты:**
   - Сразу сохраняются со всеми полями
   - Последующие запросы берут полные данные из БД

3. **Фронтенд:**
   - Будет отображать секцию "Предложения по тексту"
   - С конкретными фразами для замены
   - С указанием позиций (начало/середина/конец)

## 🚀 Деплой

```bash
# 1. Закоммитить изменения
git add services/agent-brain/src/analyzerService.js
git commit -m "fix: add transcript_suggestions fields to LLM analysis"

# 2. Запушить на сервер
git push origin main

# 3. На сервере перезапустить сервис
ssh your_server
cd /path/to/agents-monorepo
git pull origin main
docker-compose restart agent-brain
# или
pm2 restart agent-brain
```

## ✓ Проверка

После деплоя проверьте тот же креатив:
```
https://agents.performanteaiagency.com/api/analyzer/creative-analytics/5b5f5d1b-ddf2-4be5-8385-18fc0d8ee1e7?user_id=0f559eb0-53fa-4b6a-a51b-5d3e15e5864b
```

Должны появиться поля:
```json
{
  "analysis": {
    "transcript_match_quality": "medium",
    "transcript_suggestions": [
      {
        "from": "старая фраза",
        "to": "новая фраза",
        "reason": "почему нужно изменить",
        "position": "начало|середина|конец"
      }
    ]
  }
}
```

