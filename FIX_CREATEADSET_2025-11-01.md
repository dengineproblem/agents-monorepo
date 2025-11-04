# 🔧 FIX: Direction.CreateAdSetWithCreatives - Invalid Parameter Error
**Дата:** 1 ноября 2025  
**Статус:** ✅ ИСПРАВЛЕНО И ЗАДЕПЛОЕНО

---

## 📋 ПРОБЛЕМА

### Симптомы:
- Brain Agent создавал действие `Direction.CreateAdSetWithCreatives`
- Действие падало с ошибкой: **"Invalid parameter"**
- Facebook API error_subcode: **1870189**
- Status в БД: `failed`

### Детали ошибки:
```json
{
  "message": "Invalid parameter",
  "details": {
    "fb": {
      "status": 400,
      "type": "OAuthException",
      "code": 100,
      "error_subcode": 1870189,
      "params": {
        "targeting": {
          "age_min": 24,
          "age_max": 48,
          "geo_locations": {"cities": [{"key": "1301648"}]},
          "publisher_platforms": ["instagram"],
          "instagram_positions": ["stream", "story", "explore", "reels"],
          "device_platforms": ["mobile"],
          "targeting_automation": {"advantage_audience": 1}
        }
      }
    }
  }
}
```

---

## 🔍 ПРИЧИНА

В файле `services/agent-service/src/workflows/createAdSetInDirection.ts` добавлялись **лишние поля** в targeting:

```typescript
// ❌ НЕПРАВИЛЬНО (было):
targeting.publisher_platforms = ['instagram'];
targeting.instagram_positions = ['stream', 'story', 'explore', 'reels'];
targeting.device_platforms = ['mobile'];

// И/или:
targeting.targeting_automation = {
  advantage_audience: 1
};
```

### Почему это ошибка?

1. **`publisher_platforms`, `instagram_positions`, `device_platforms`** - эти поля добавляются ТОЛЬКО когда нет детального таргетинга (cities, interests и т.д.)
2. **`targeting_automation.advantage_audience`** - конфликтует с детальным geo_locations.cities
3. В **рабочих workflows** (auto-launch, manual-launch, creativeTest) этих полей НЕТ - там targeting используется как есть из `defaultSettings`

---

## ✅ РЕШЕНИЕ

### Изменения в коде:

**Файл:** `services/agent-service/src/workflows/createAdSetInDirection.ts`

```typescript
// ✅ ПРАВИЛЬНО (стало):
let targeting: any;

if (defaultSettings) {
  // Преобразуем настройки из БД в формат Facebook API
  targeting = convertToFacebookTargeting(defaultSettings);
} else {
  // Fallback на базовый таргетинг
  targeting = {
    geo_locations: { countries: ['RU'] },
    age_min: 18,
    age_max: 65
  };
}

// НЕ добавляем дополнительные поля - используем targeting как есть
// (как в workflowCreateCampaignWithCreative и creativeTest)
```

### Что было убрано:
- ❌ `targeting.publisher_platforms = ['instagram']`
- ❌ `targeting.instagram_positions = [...]`
- ❌ `targeting.device_platforms = ['mobile']`
- ❌ `targeting.targeting_automation = { advantage_audience: 1 }`

### Дополнительно:
- ✅ Добавлено логирование ошибок Facebook API в `agent-brain/src/server.js`
- ✅ Логирование rate limits, invalid parameters, empty responses

---

## 🧪 ТЕСТИРОВАНИЕ

### Локально:
```bash
# 1. Пересобрать без кэша
docker-compose build --no-cache agent-service
docker-compose up -d agent-service

# 2. Проверить что изменения применились
docker exec agents-monorepo-agent-service-1 grep -c "publisher_platforms" /app/dist/workflows/createAdSetInDirection.js
# Результат: 0 (нет вхождений)

# 3. Запустить Brain Agent
curl -s -X POST http://localhost:7080/api/brain/run \
  -H "Content-Type: application/json" \
  -d '{
    "userAccountId": "1a5e2090-1a7e-4e54-854c-d97190618cfa",
    "inputs": { "dispatch": true }
  }'
```

### Результат теста:
```json
{
  "id": 408,
  "type": "Direction.CreateAdSetWithCreatives",
  "status": "success",
  "result_json": {
    "success": true,
    "adset_id": "120232923985510449",
    "ad_id": "120232923986380449",
    "message": "AdSet created in direction \"Мебель для кофеен...\" with 1 ad(s) (status: ACTIVE)"
  }
}
```

✅ **Adset успешно создан в Facebook!**

---

## 🚀 ДЕПЛОЙ НА ПРОД

### Команды:
```bash
# 1. Коммит и пуш
git add services/agent-service/src/workflows/createAdSetInDirection.ts
git add services/agent-brain/src/server.js
git commit -m "fix: Remove invalid targeting fields in CreateAdSetWithCreatives"
git push origin main

# 2. На сервере
ssh root@95.163.241.61
cd ~/agents-monorepo
git pull origin main

# 3. Пересборка и перезапуск
docker-compose build agent-service
docker-compose up -d agent-service

# 4. Проверка
docker exec agents-monorepo-agent-service-1 grep -c "publisher_platforms" /app/dist/workflows/createAdSetInDirection.js
# Должно быть: 0
```

### Результат на проде:
- ✅ Коммит: `3b82679`
- ✅ Дата сборки: Nov 1 06:48
- ✅ Контейнер перезапущен: 2 minutes ago
- ✅ Лишних полей нет: 0 вхождений

---

## 📊 IMPACT

### До фикса:
- ❌ `Direction.CreateAdSetWithCreatives` - **100% failure rate**
- ❌ Brain Agent не мог создавать новые adsets в существующих направлениях
- ❌ Все попытки падали с "Invalid parameter"

### После фикса:
- ✅ `Direction.CreateAdSetWithCreatives` - **работает**
- ✅ Brain Agent может создавать adsets как auto-launch/manual-launch
- ✅ Targeting используется корректно (как в проверенных workflows)

---

## 🔗 СВЯЗАННЫЕ ФАЙЛЫ

### Изменено:
1. `services/agent-service/src/workflows/createAdSetInDirection.ts` - убраны лишние поля targeting
2. `services/agent-brain/src/server.js` - добавлено логирование FB API ошибок

### Для справки (рабочие примеры):
1. `services/agent-service/src/workflows/createCampaignWithCreative.ts` - auto-launch/manual-launch
2. `services/agent-service/src/workflows/creativeTest.ts` - тест креативов
3. `services/agent-service/src/lib/campaignBuilder.ts` - createAdSetInCampaign

---

## 📝 КОММИТЫ

1. **3b82679** - `fix: Remove invalid targeting fields in CreateAdSetWithCreatives`
2. **d37356b** - `docs: Document Direction.CreateAdSetWithCreatives fix in INFRASTRUCTURE.md`

---

## ✅ ЧЕКЛИСТ

- [x] Проблема идентифицирована
- [x] Причина найдена (сравнение с рабочими workflows)
- [x] Код исправлен
- [x] Протестировано локально
- [x] Закоммичено в Git
- [x] Задеплоено на прод
- [x] Проверено на проде
- [x] Документировано в INFRASTRUCTURE.md
- [x] Создан отчет FIX_CREATEADSET_2025-11-01.md

---

**Автор:** AI Assistant  
**Дата:** 1 ноября 2025, 09:28 UTC+5


