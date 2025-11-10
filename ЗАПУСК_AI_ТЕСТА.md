# 🤖 Запуск теста AI-автолонча

## ✅ Что уже сделано:
- Фронтенд переключен на `/auto-launch` (AI версия)
- OPENAI_API_KEY настроен
- Тестовые скрипты созданы
- Пользователь для теста: `performante` (ID: 0f559eb0-53fa-4b6a-a51b-5d3e15e5864b)

---

## 🚀 Инструкция по запуску:

### Вариант 1: Тест через фронтенд (рекомендуется)

**Терминал 1 - Запуск agent-service:**
```bash
cd /Users/anatolijstepanov/agents-monorepo/services/agent-service
npm run dev
```

**Терминал 2 - Запуск фронтенда:**
```bash
cd /Users/anatolijstepanov/agents-monorepo/services/frontend
npm run dev
```

**Терминал 3 - Мониторинг логов AI:**
```bash
cd /Users/anatolijstepanov/agents-monorepo/services/agent-service
# Смотрим логи в реальном времени, фильтруем AI-активность
tail -f *.log 2>/dev/null | grep -E --line-buffered "(Building campaign action|Calling OpenAI|Action created from LLM|selected_creatives|reasoning)"
```

**Действия:**
1. Откройте браузер: http://localhost:5173
2. Залогиньтесь как пользователь `performante`
3. Нажмите кнопку **"Autostart"**
4. Наблюдайте в Терминале 3 за работой AI!

---

### Вариант 2: Прямой тест через curl (быстрее)

**Терминал 1 - Запуск agent-service:**
```bash
cd /Users/anatolijstepanov/agents-monorepo/services/agent-service
npm run dev
```

**Терминал 2 - Запуск теста:**
```bash
cd /Users/anatolijstepanov/agents-monorepo
./test-ai-direct.sh
```

Скрипт отправит запрос и покажет результат.

---

## 🔍 Что вы увидите в логах AI-агента:

### 1. Начало работы AI:
```json
{
  "level": "info",
  "message": "Building campaign action...",
  "userAccountId": "0f559eb0-53fa-4b6a-a51b-5d3e15e5864b",
  "objective": "whatsapp"
}
```

### 2. Вызов OpenAI API:
```json
{
  "level": "info",
  "message": "Calling OpenAI API",
  "model": "gpt-4o",
  "creativesCount": 9,
  "budgetConstraints": {...}
}
```

### 3. Результат от AI:
```json
{
  "level": "info",
  "message": "Action created from LLM",
  "action": {
    "type": "CreateCampaignWithCreative",
    "params": {
      "user_creative_ids": ["uuid-1", "uuid-2", "uuid-3"],
      "objective": "WhatsApp",
      "daily_budget_cents": 4500
    },
    "selected_creatives": [
      {
        "user_creative_id": "uuid-1",
        "title": "Креатив 1",
        "reason": "Low risk (15), хороший CTR 2.3%"
      }
    ],
    "reasoning": "Выбрано 3 креатива на основе анализа risk score...",
    "confidence": "high"
  }
}
```

---

## 🎯 Доказательства работы AI:

✅ **Вызов OpenAI API** - видим "Calling OpenAI API"  
✅ **Анализ креативов** - AI получает risk_score, creative_score  
✅ **Интеллектуальный выбор** - selected_creatives с объяснением (reason)  
✅ **Reasoning** - AI объясняет свое решение  
✅ **Confidence** - AI оценивает уверенность в решении  

---

## 🆚 Разница с auto-launch-v2:

| Параметр | v2 (без AI) | AI версия |
|----------|-------------|-----------|
| Выбор креативов | Первые 5 | Анализ risk_score, выбор лучших |
| Бюджет | Фиксированный | Оптимальное распределение |
| Логи | "Processing direction" | "Building campaign action", "Calling OpenAI" |
| Объяснение | Нет | Есть reasoning от AI |

---

## ⚡ Готовы? Запускайте!

Выберите Вариант 1 или 2 и следуйте инструкциям выше.



