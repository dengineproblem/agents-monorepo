---
name: creatives
description: Генерация и анализ рекламных креативов
requires:
  env:
    - AGENT_SERVICE_URL
---

# Creatives Skill

Этот skill позволяет генерировать и анализировать рекламные креативы.

## Базовый формат вызова

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/{toolName} \
  -H "Content-Type: application/json" \
  -d '{...параметры...}'
```

---

## READ Tools (Анализ креативов)

### getCreatives
Получить список креативов.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/getCreatives \
  -H "Content-Type: application/json" \
  -d '{"adAccountId": "act_123", "status": "active", "limit": 20}'
```

### getCreativeDetails
Детали креатива.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/getCreativeDetails \
  -H "Content-Type: application/json" \
  -d '{"creativeId": "123"}'
```

### getCreativeMetrics
Метрики креатива.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/getCreativeMetrics \
  -H "Content-Type: application/json" \
  -d '{"creativeId": "123", "period": "last_7d"}'
```

### getCreativeAnalysis
AI-анализ креатива.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/getCreativeAnalysis \
  -H "Content-Type: application/json" \
  -d '{"creativeId": "123"}'
```

### getTopCreatives
Лучшие креативы по метрикам.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/getTopCreatives \
  -H "Content-Type: application/json" \
  -d '{"adAccountId": "act_123", "period": "last_7d", "metric": "ctr", "limit": 10}'
```

### getWorstCreatives
Худшие креативы.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/getWorstCreatives \
  -H "Content-Type: application/json" \
  -d '{"adAccountId": "act_123", "period": "last_7d", "metric": "ctr", "limit": 10}'
```

### compareCreatives
Сравнить креативы.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/compareCreatives \
  -H "Content-Type: application/json" \
  -d '{"creativeIds": ["123", "456"], "period": "last_7d"}'
```

### getCreativeScores
Оценки креативов.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/getCreativeScores \
  -H "Content-Type: application/json" \
  -d '{"adAccountId": "act_123"}'
```

### getCreativeTests
Активные A/B тесты креативов.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/getCreativeTests \
  -H "Content-Type: application/json" \
  -d '{"adAccountId": "act_123"}'
```

### getCreativeTranscript
Транскрипт видео креатива.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/getCreativeTranscript \
  -H "Content-Type: application/json" \
  -d '{"creativeId": "123"}'
```

---

## WRITE Tools (Генерация и управление)

### generateCreatives
Сгенерировать изображения креативов.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/generateCreatives \
  -H "Content-Type: application/json" \
  -d '{
    "adAccountId": "act_123",
    "prompt": "Реклама курса английского языка",
    "style": "modern",
    "count": 3
  }'
```

### generateCarousel
Сгенерировать карусель.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/generateCarousel \
  -H "Content-Type: application/json" \
  -d '{
    "adAccountId": "act_123",
    "topic": "Преимущества онлайн-обучения",
    "slides": 5
  }'
```

### generateTextCreative
Сгенерировать текстовый креатив.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/generateTextCreative \
  -H "Content-Type: application/json" \
  -d '{
    "adAccountId": "act_123",
    "topic": "Скидка 50% на курсы",
    "style": "urgent"
  }'
```

### generateOffer
Сгенерировать оффер.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/generateOffer \
  -H "Content-Type: application/json" \
  -d '{"topic": "Курсы программирования", "targetAudience": "начинающие"}'
```

### generateBullets
Сгенерировать буллеты.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/generateBullets \
  -H "Content-Type: application/json" \
  -d '{"topic": "Преимущества курса", "count": 5}'
```

### launchCreative
Запустить креатив в рекламу.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/launchCreative \
  -H "Content-Type: application/json" \
  -d '{"creativeId": "123", "adSetId": "456"}'
```

### pauseCreative
Поставить креатив на паузу.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/pauseCreative \
  -H "Content-Type: application/json" \
  -d '{"creativeId": "123", "reason": "Low performance"}'
```

### startCreativeTest
Запустить A/B тест креативов.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/startCreativeTest \
  -H "Content-Type: application/json" \
  -d '{
    "creativeIds": ["123", "456"],
    "adSetId": "789",
    "budget": 5000,
    "duration": 7
  }'
```

### stopCreativeTest
Остановить A/B тест.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/stopCreativeTest \
  -H "Content-Type: application/json" \
  -d '{"testId": "123"}'
```

### triggerCreativeAnalysis
Запустить AI-анализ креатива.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/triggerCreativeAnalysis \
  -H "Content-Type: application/json" \
  -d '{"creativeId": "123"}'
```

---

## Примеры использования

### Анализ и оптимизация
1. Получи топ креативы: `getTopCreatives`
2. Получи худшие: `getWorstCreatives`
3. Поставь на паузу худшие: `pauseCreative`

### Генерация новых креативов
1. Сгенерируй оффер: `generateOffer`
2. Сгенерируй буллеты: `generateBullets`
3. Создай изображения: `generateCreatives`
4. Запусти в рекламу: `launchCreative`
