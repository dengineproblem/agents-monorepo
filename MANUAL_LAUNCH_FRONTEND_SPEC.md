# Ручной запуск рекламы - Спецификация для фронтенда

## Обзор

Функционал для **ручного запуска рекламы** с выбранными креативами и настройками.

Пользователь:
1. Выбирает **направление** (существующее или создает новое)
2. Выбирает **креативы** (один или несколько)
3. Опционально переопределяет **бюджет и таргетинг**
4. Нажимает **"Запустить рекламу"**

Система создает:
- **Ad Set** в существующей Facebook Campaign направления
- **Ads** (по количеству выбранных креативов)

---

## API Endpoint

### `POST /api/campaign-builder/manual-launch`

**Назначение:** Создать Ad Set с выбранными креативами в рамках направления.

**URL (production):** `https://agents.performanteaiagency.com/api/campaign-builder/manual-launch`

**URL (local):** `http://localhost:8082/api/campaign-builder/manual-launch`

---

## Request

### Headers
```
Content-Type: application/json
```

### Body (JSON)

```typescript
{
  user_account_id: string;          // UUID пользователя (обязательно)
  direction_id: string;              // UUID направления (обязательно)
  creative_ids: string[];            // Массив UUID креативов (минимум 1)
  daily_budget_cents?: number;       // Опционально: бюджет в центах (≥1000)
  targeting?: object;                // Опционально: кастомный таргетинг
}
```

### Примеры

#### Минимальный запрос (используются настройки направления)
```json
{
  "user_account_id": "0f559eb0-53fa-4b6a-a51b-5d3e15e5864b",
  "direction_id": "a872de30-149e-4229-a371-6420ece02333",
  "creative_ids": [
    "b5327814-9035-4087-9bfb-2e4e1ffed313",
    "d1196aff-54f3-4031-b477-7985729aa792"
  ]
}
```

#### С переопределением бюджета
```json
{
  "user_account_id": "0f559eb0-53fa-4b6a-a51b-5d3e15e5864b",
  "direction_id": "a872de30-149e-4229-a371-6420ece02333",
  "creative_ids": [
    "b5327814-9035-4087-9bfb-2e4e1ffed313"
  ],
  "daily_budget_cents": 5000
}
```

#### С кастомным таргетингом
```json
{
  "user_account_id": "0f559eb0-53fa-4b6a-a51b-5d3e15e5864b",
  "direction_id": "a872de30-149e-4229-a371-6420ece02333",
  "creative_ids": [
    "b5327814-9035-4087-9bfb-2e4e1ffed313",
    "d1196aff-54f3-4031-b477-7985729aa792",
    "4946931b-3b45-48ab-9426-49ff88d1180b"
  ],
  "daily_budget_cents": 3000,
  "targeting": {
    "geo_locations": {
      "countries": ["KZ", "BY"]
    },
    "age_min": 25,
    "age_max": 45,
    "genders": [2]
  }
}
```

---

## Response

### Success Response (200 OK)

```typescript
{
  success: true;
  message: string;                 // "Реклама запущена: создано 3 объявлений"
  direction_id: string;
  direction_name: string;
  campaign_id: string;             // Facebook Campaign ID
  adset_id: string;                // Созданный Ad Set ID
  adset_name: string;
  ads_created: number;
  ads: Array<{
    ad_id: string;
    name: string;
  }>;
}
```

**Пример:**
```json
{
  "success": true,
  "message": "Реклама запущена: создано 3 объявлений",
  "direction_id": "a872de30-149e-4229-a371-6420ece02333",
  "direction_name": "ИИ таргетолог",
  "campaign_id": "120235632935580463",
  "adset_id": "120235644928620463",
  "adset_name": "ИИ таргетолог - Ручной запуск - 2025-10-14",
  "ads_created": 3,
  "ads": [
    {
      "ad_id": "120235644931430463",
      "name": "Ad - Крео цм 2.mp4"
    },
    {
      "ad_id": "120235644934470463",
      "name": "Ad - Крео цм 9.mp4"
    },
    {
      "ad_id": "120235644936890463",
      "name": "Ad - смя_1 (4).mp4"
    }
  ]
}
```

### Error Responses

#### 400 Bad Request - Нет активных креативов
```json
{
  "success": false,
  "error": "No valid creatives found"
}
```

#### 400 Bad Request - Направление без Campaign
```json
{
  "success": false,
  "error": "Direction does not have associated Facebook Campaign"
}
```

#### 404 Not Found - Направление не найдено
```json
{
  "success": false,
  "error": "Direction not found or inactive"
}
```

#### 404 Not Found - Пользователь не найден
```json
{
  "success": false,
  "error": "User account not found"
}
```

#### 500 Internal Server Error - Ошибка Facebook API
```json
{
  "success": false,
  "error": "Выбранные гео-локации заблокированы для вашего рекламного аккаунта",
  "error_details": "(#2641) Your ad includes or excludes locations that are currently restricted. Please remove affected locations from your audience settings: RU."
}
```

---

## UI/UX Спецификация

### 1. Страница "Запуск рекламы"

#### Шаг 1: Выбор направления

**Компонент:** Dropdown / Select

- Показать список активных направлений пользователя
- Если направлений нет — показать кнопку **"Создать направление"**
- Для каждого направления показать:
  - Название
  - Цель (`whatsapp`, `instagram_traffic`, `site_leads`)
  - Дневной бюджет
  - Количество активных креативов

**Пример:**
```
┌─────────────────────────────────────────┐
│ Выберите направление                    │
├─────────────────────────────────────────┤
│ ● ИИ таргетолог                        │
│   WhatsApp • $30/день • 4 креатива     │
├─────────────────────────────────────────┤
│ ○ ИИ менеджер                          │
│   WhatsApp • $10/день • 3 креатива     │
└─────────────────────────────────────────┘
```

#### Шаг 2: Выбор креативов

**Компонент:** Multi-select с превью

- Показать только **активные** креативы из выбранного направления
- Фильтр: `is_active: true`, `status: 'ready'`, `direction_id: selected_direction_id`
- Для каждого креатива показать:
  - Превью видео (thumbnail)
  - Название
  - Дата создания
  - Чекбокс для выбора

**Пример:**
```
┌───────────────────────────────────────────────────────┐
│ Выберите креативы (выбрано: 2 из 4)                  │
├───────────────────────────────────────────────────────┤
│ ☑ [🎬] Крео цм 2.mp4          13 окт 2025           │
│ ☑ [🎬] Крео цм 9.mp4          13 окт 2025           │
│ ☐ [🎬] смя_1 (4).mp4          13 окт 2025           │
│ ☐ [🎬] 0825 (1) (1).mp4       10 окт 2025           │
└───────────────────────────────────────────────────────┘
```

#### Шаг 3: Настройки (опционально)

**Компонент:** Форма с переключателем

- **По умолчанию:** Использовать настройки направления
- **Переключатель:** "Изменить настройки для этого запуска"

Если переключатель активен, показать:
- **Дневной бюджет ($)** — input, min: $10
- **Таргетинг** — ссылка на форму таргетинга (или использовать настройки направления)

**Пример:**
```
┌───────────────────────────────────────────────────────┐
│ ☐ Изменить настройки для этого запуска              │
└───────────────────────────────────────────────────────┘

Если включено:
┌───────────────────────────────────────────────────────┐
│ ☑ Изменить настройки для этого запуска              │
├───────────────────────────────────────────────────────┤
│ Дневной бюджет:  [$50  ]                            │
│ Таргетинг:       [Изменить таргетинг →]             │
└───────────────────────────────────────────────────────┘
```

#### Шаг 4: Подтверждение и запуск

**Компонент:** Summary + Button

- Показать итоговую информацию:
  - Направление
  - Количество креативов
  - Бюджет
  - Таргетинг (кратко)
- Кнопка **"Запустить рекламу"**

**Пример:**
```
┌───────────────────────────────────────────────────────┐
│ Вы запускаете рекламу:                               │
│                                                       │
│ Направление:    ИИ таргетолог (WhatsApp)            │
│ Креативов:      2                                    │
│ Бюджет:         $30/день                             │
│ Таргетинг:      Казахстан, 18-65 лет               │
│                                                       │
│         [ Запустить рекламу ]                        │
└───────────────────────────────────────────────────────┘
```

### 2. Обработка результата

#### Success
- Показать **toast-уведомление**: "Реклама запущена: создано 3 объявлений"
- **Опционально:** Показать модальное окно с деталями:
  - Название Ad Set
  - Ссылки на созданные объявления в Facebook Ads Manager
  - Кнопка "Перейти к статистике"

#### Error
- Показать **toast-уведомление** с ошибкой: `error` из response
- **Опционально:** Кнопка "Подробнее" → модальное окно с `error_details`

---

## Код для фронтенда

### TypeScript Types

```typescript
// Request
interface ManualLaunchRequest {
  user_account_id: string;
  direction_id: string;
  creative_ids: string[];
  daily_budget_cents?: number;
  targeting?: {
    geo_locations?: {
      countries?: string[];
      cities?: Array<{ key: string }>;
    };
    age_min?: number;
    age_max?: number;
    genders?: number[];
  };
}

// Response
interface ManualLaunchResponse {
  success: boolean;
  message?: string;
  direction_id?: string;
  direction_name?: string;
  campaign_id?: string;
  adset_id?: string;
  adset_name?: string;
  ads_created?: number;
  ads?: Array<{
    ad_id: string;
    name: string;
  }>;
  error?: string;
  error_details?: string;
}
```

### API Client

```typescript
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8082';

export async function manualLaunchAds(
  request: ManualLaunchRequest
): Promise<ManualLaunchResponse> {
  const response = await fetch(`${API_URL}/api/campaign-builder/manual-launch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to launch ads');
  }

  return response.json();
}
```

### React Hook Example

```typescript
import { useState } from 'react';
import { manualLaunchAds, ManualLaunchRequest, ManualLaunchResponse } from '@/lib/api';
import { toast } from 'sonner'; // or your toast library

export function useManualLaunch() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ManualLaunchResponse | null>(null);

  const launch = async (request: ManualLaunchRequest) => {
    setLoading(true);
    setResult(null);

    try {
      const response = await manualLaunchAds(request);

      if (response.success) {
        toast.success(response.message || 'Реклама успешно запущена!');
        setResult(response);
        return response;
      } else {
        toast.error(response.error || 'Ошибка запуска рекламы');
        return null;
      }
    } catch (error: any) {
      toast.error(error.message || 'Ошибка запуска рекламы');
      return null;
    } finally {
      setLoading(false);
    }
  };

  return { launch, loading, result };
}
```

### Usage Example

```typescript
'use client';

import { useState } from 'react';
import { useManualLaunch } from '@/hooks/useManualLaunch';

export default function ManualLaunchPage() {
  const [selectedDirection, setSelectedDirection] = useState('');
  const [selectedCreatives, setSelectedCreatives] = useState<string[]>([]);
  const { launch, loading } = useManualLaunch();

  const handleLaunch = async () => {
    if (!selectedDirection || selectedCreatives.length === 0) {
      alert('Выберите направление и хотя бы один креатив');
      return;
    }

    await launch({
      user_account_id: 'USER_ID', // из контекста/сессии
      direction_id: selectedDirection,
      creative_ids: selectedCreatives,
    });
  };

  return (
    <div>
      <h1>Запуск рекламы</h1>
      
      {/* Шаг 1: Выбор направления */}
      <select
        value={selectedDirection}
        onChange={(e) => setSelectedDirection(e.target.value)}
      >
        <option value="">Выберите направление</option>
        {/* Загрузить directions из API */}
      </select>

      {/* Шаг 2: Выбор креативов */}
      {/* Multi-select с превью */}

      {/* Шаг 4: Запуск */}
      <button
        onClick={handleLaunch}
        disabled={loading || !selectedDirection || selectedCreatives.length === 0}
      >
        {loading ? 'Запуск...' : 'Запустить рекламу'}
      </button>
    </div>
  );
}
```

---

## Environment Variables

### Local Development
```env
NEXT_PUBLIC_API_URL=http://localhost:8082
```

### Production
```env
NEXT_PUBLIC_API_URL=https://agents.performanteaiagency.com
```

---

## Testing

### 1. Проверка с одним креативом
```bash
curl -X POST https://agents.performanteaiagency.com/api/campaign-builder/manual-launch \
  -H "Content-Type: application/json" \
  -d '{
    "user_account_id": "0f559eb0-53fa-4b6a-a51b-5d3e15e5864b",
    "direction_id": "a872de30-149e-4229-a371-6420ece02333",
    "creative_ids": ["b5327814-9035-4087-9bfb-2e4e1ffed313"]
  }'
```

### 2. Проверка с несколькими креативами
```bash
curl -X POST https://agents.performanteaiagency.com/api/campaign-builder/manual-launch \
  -H "Content-Type: application/json" \
  -d '{
    "user_account_id": "0f559eb0-53fa-4b6a-a51b-5d3e15e5864b",
    "direction_id": "a872de30-149e-4229-a371-6420ece02333",
    "creative_ids": [
      "b5327814-9035-4087-9bfb-2e4e1ffed313",
      "d1196aff-54f3-4031-b477-7985729aa792",
      "4946931b-3b45-48ab-9426-49ff88d1180b"
    ]
  }'
```

### 3. Проверка с кастомным бюджетом
```bash
curl -X POST https://agents.performanteaiagency.com/api/campaign-builder/manual-launch \
  -H "Content-Type: application/json" \
  -d '{
    "user_account_id": "0f559eb0-53fa-4b6a-a51b-5d3e15e5864b",
    "direction_id": "a872de30-149e-4229-a371-6420ece02333",
    "creative_ids": ["b5327814-9035-4087-9bfb-2e4e1ffed313"],
    "daily_budget_cents": 5000
  }'
```

---

## Валидация

### Backend Validation

- ✅ `user_account_id` — обязателен, UUID
- ✅ `direction_id` — обязателен, UUID, должен принадлежать пользователю, `is_active: true`
- ✅ `creative_ids` — обязателен, массив UUID, минимум 1 креатив
- ✅ Креативы должны:
  - Принадлежать пользователю
  - Принадлежать выбранному направлению
  - Быть активными (`is_active: true`)
  - Иметь статус `'ready'`
- ✅ `daily_budget_cents` (если указан) — ≥ 1000 (минимум $10)
- ✅ Направление должно иметь `fb_campaign_id`

### Frontend Validation

**Перед отправкой:**
- Проверить, что выбрано направление
- Проверить, что выбран хотя бы 1 креатив
- Если указан кастомный бюджет — ≥ $10
- Показать подтверждение перед запуском

---

## FAQ

### 1. Можно ли запустить рекламу без направления?
Нет, направление обязательно. Если у пользователя нет направлений, сначала нужно создать направление.

### 2. Сколько креативов можно выбрать?
Минимум 1, максимума нет (но рекомендуется до 5-10 для оптимальной производительности).

### 3. Что происходит, если некоторые креативы неактивны?
Они будут отфильтрованы backend'ом. Если после фильтрации не останется ни одного креатива, вернется ошибка `"No valid creatives found"`.

### 4. Можно ли изменить настройки после запуска?
Нет, после создания Ad Set его настройки можно изменить только в Facebook Ads Manager. Но можно создать новый Ad Set с другими настройками, вызвав `/manual-launch` снова.

### 5. В каком состоянии создается Ad Set?
`ACTIVE` — готов к показу сразу после создания.

---

**Готово к интеграции!** 🚀

