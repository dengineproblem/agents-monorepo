# 🧪 План тестирования инструментов дублирования перед продакшном

## ✅ Что нужно протестировать

1. **Audience.DuplicateAdSetWithAudience** - дубль ad set с новой аудиторией
2. **Workflow.DuplicateAndPauseOriginal** - реанимация кампании
3. **Workflow.DuplicateKeepOriginalActive** - масштабирование

---

## 📋 4-этапный план тестирования

### **Этап 1: Подготовка** ⚙️

```bash
# 1. Включить тестовый режим
sed -i '' 's/BRAIN_TEST_MODE=false/BRAIN_TEST_MODE=true/' docker-compose.yml
sed -i '' 's/FB_VALIDATE_ONLY=false/FB_VALIDATE_ONLY=true/' docker-compose.yml

# 2. Пересобрать контейнеры
docker-compose build --no-cache
docker-compose up -d

# 3. Проверить готовность
curl localhost:7080/api/brain/llm-ping
```

---

### **Этап 2: Валидация схем** 🔍

Проверяем, что agent-service принимает все типы действий:

```bash
chmod +x test-actions-validation.sh
./test-actions-validation.sh
```

**Ожидание:** Все 3 теста должны вернуть `executionId` (успех) или детальную ошибку валидации.

---

### **Этап 3: Провокация LLM** 🎯

Проверяем, что LLM генерирует правильные действия в нужных ситуациях:

```bash
chmod +x test-duplication-tools.sh
./test-duplication-tools.sh
```

**Проверяем:**
- ✅ LLM упоминает дублирование в `planNote`
- ✅ Генерируются правильные `actions` 
- ✅ `reportText` содержит обоснование решений
- ✅ Agent-service принимает actions (validation passed)

---

### **Этап 4: Финальная проверка с реальными данными** 🚀

**Важно:** Этот этап делаем с **ОДНОЙ тестовой кампанией**, которую не жалко!

```bash
# 1. Создать тестовую кампанию в Facebook Ads Manager
#    Назвать: "TEST DUPLICATION - DELETE ME"

# 2. Выключить FB_VALIDATE_ONLY для реальной проверки
sed -i '' 's/FB_VALIDATE_ONLY=true/FB_VALIDATE_ONLY=false/' docker-compose.yml
docker-compose up -d agent-service

# 3. Запустить тест с dispatch=true на ТЕСТОВОЙ кампании
curl -X POST localhost:7080/api/brain/run \
  -H 'Content-Type: application/json' \
  -d '{
    "userAccountId": "...",
    "inputs": {
      "dispatch": true,
      "testCampaignId": "TEST_CAMPAIGN_ID"
    }
  }'

# 4. Проверить в Facebook Ads Manager:
#    - Создан ли дубль кампании/ad set?
#    - Правильно ли скопированы настройки?
#    - Работает ли пауза оригинала (если применимо)?

# 5. УДАЛИТЬ тестовую кампанию после проверки
```

---

## 🎯 Чек-лист перед продакшном

- [ ] Все 3 типа действий валидируются в agent-service
- [ ] LLM корректно генерирует actions при провокации
- [ ] Тест на реальной кампании прошёл успешно
- [ ] Логи agent-service не содержат ошибок
- [ ] Facebook API принимает все запросы
- [ ] Настройки продакшна выставлены:
  ```yaml
  BRAIN_TEST_MODE=false
  FB_VALIDATE_ONLY=false
  BRAIN_DRY_RUN=false
  ```

---

## 🚨 Что делать если тесты провалились?

### Проблема: LLM не генерирует дублирование

**Причины:**
1. Метрики не достаточно плохие/хорошие для триггера
2. SYSTEM_PROMPT не содержит правил дублирования
3. LLM интерпретирует ситуацию иначе

**Решение:**
- Проверить `planNote` и `reportText` - LLM объясняет свои решения
- Увеличить `overrideCPL` для более явной провокации
- Проверить SYSTEM_PROMPT на наличие правил дублирования

### Проблема: Agent-service отклоняет actions

**Причины:**
1. Неправильная схема валидации
2. Отсутствуют обязательные параметры
3. Параметры вне допустимого диапазона

**Решение:**
- Проверить логи agent-service: `docker logs agents-monorepo-agent-service-1`
- Сравнить с схемой в `src/actions/schema.ts`
- Проверить manifest.json

### Проблема: Facebook API возвращает ошибку

**Причины:**
1. Недостаточно прав у access_token
2. Неправильные параметры API
3. Кампания/ad set в неподходящем статусе

**Решение:**
- Проверить permissions токена в Facebook Graph API Explorer
- Включить `FB_VALIDATE_ONLY=true` для отладки
- Проверить статус кампании/ad set

---

## 📊 Матрица тестовых сценариев

| Сценарий | overrideCPL | Ожидаемое действие | Критерий успеха |
|----------|-------------|-------------------|-----------------|
| 1 провал | вебинар: 8.00 | Audience.DuplicateAdSetWithAudience | Action в списке |
| Все плохие | все: >8.00 | Best-of-bad ИЛИ Duplicate+Pause | HS пересчитан |
| Все хорошие | все: <2.00 | Scale (увеличение бюджетов) ИЛИ Duplicate+Keep | Бюджеты увеличены |

---

## 🔐 Безопасность

**НИКОГДА НЕ:**
- Тестировать с `dispatch=true` на боевых кампаниях без `FB_VALIDATE_ONLY=true`
- Оставлять `BRAIN_TEST_MODE=true` в продакшне
- Коммитить API ключи в git

**ВСЕГДА:**
- Тестировать на отдельной тестовой кампании
- Проверять логи перед продакшн-запуском
- Делать бэкап настроек кампаний перед тестами
