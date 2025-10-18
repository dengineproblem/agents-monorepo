# Тестовые сценарии для провокации LLM использовать инструменты дублирования

## Сценарий 1: Провокация "Audience.DuplicateAdSetWithAudience"
**Условия срабатывания:**
- HS ad set = slightly_bad или bad
- CPL_ratio ≥ 2.0 (фактический CPL/QCPL в 2+ раза выше плана)
- Объём: impressions_yesterday ≥ 1000 ИЛИ impressions_last_3d ≥ 1500

**Тестовые данные (восстанавливаем логику overrideCPL):**
```json
{
  "userAccountId": "0f559eb0-53fa-4b6a-a51b-5d3e15e5864b",
  "inputs": {
    "dispatch": false,
    "overrideCPL": [
      { "adset_id": "120234845322690463", "qcpl": 8.00 }
    ]
  }
}
```
**Ожидание:** LLM должен рекомендовать дубль на LAL 3% IG Engagers 365d

---

## Сценарий 2: Провокация "Workflow.DuplicateAndPauseOriginal" (реанимация)
**Условия срабатывания:**
- HS = bad (≤ -25)
- CPL_ratio ≥ 2.0
- Рекомендация дубля кампании с паузой оригинала

**Тестовые данные:**
```json
{
  "userAccountId": "0f559eb0-53fa-4b6a-a51b-5d3e15e5864b",
  "inputs": {
    "dispatch": false,
    "overrideCPL": [
      { "adset_id": "120234845741880463", "qcpl": 10.00 },
      { "adset_id": "120234845322690463", "qcpl": 12.00 },
      { "adset_id": "120234844633260463", "qcpl": 11.00 }
    ]
  }
}
```
**Ожидание:** Все ad sets плохие → LLM может рекомендовать дубль кампании

---

## Сценарий 3: Провокация "Workflow.DuplicateKeepOriginalActive" (масштабирование)
**Условия срабатывания:**
- HS = very_good (≥ +25)
- Вся кампания успешна
- Можно масштабировать дублем

**Тестовые данные:**
```json
{
  "userAccountId": "0f559eb0-53fa-4b6a-a51b-5d3e15e5864b",
  "inputs": {
    "dispatch": false,
    "overrideCPL": [
      { "adset_id": "120234845741880463", "qcpl": 1.20 },
      { "adset_id": "120234845322690463", "qcpl": 1.50 },
      { "adset_id": "120234844633260463", "qcpl": 1.30 }
    ]
  }
}
```
**Ожидание:** Все успешны → LLM может рекомендовать scale через дубль кампании

---

## Как проверять результаты:

### Шаг 1: Проверить planNote и reportText
```bash
curl ... | jq '{planNote, reportText}' | grep -i "дубл"
```

### Шаг 2: Проверить actions
```bash
curl ... | jq '.actions[] | select(.type | contains("Duplicate"))'
```

### Шаг 3: Включить FB_VALIDATE_ONLY=true и dispatch=true
Проверить, что Facebook принимает запрос (но не выполняет)
