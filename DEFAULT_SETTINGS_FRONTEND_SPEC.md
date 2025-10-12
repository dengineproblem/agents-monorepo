# Default Ad Settings для Направлений — Спецификация для фронтенда

## 🎯 Концепция

Каждое **направление** может иметь свои **дефолтные настройки рекламы**:
- Города (таргетинг)
- Возраст и пол аудитории
- Текст под видео
- Специфичные настройки для цели (WhatsApp вопрос, Instagram URL, Pixel ID и т.д.)

**1 направление = 1 набор настроек**

---

## 🌐 API Endpoints

### Base URL:
- **Локально:** `http://localhost:8082`
- **Production:** `https://agents.performanteaiagency.com`

---

## 📡 1. GET /api/default-settings

Получить настройки для направления.

### Request:
```javascript
GET /api/default-settings?directionId=YOUR_DIRECTION_UUID
```

### Response 200 (настройки существуют):
```json
{
  "success": true,
  "settings": {
    "id": "uuid",
    "direction_id": "direction-uuid",
    "user_id": null,
    "campaign_goal": "whatsapp",
    "cities": ["2643743", "1526273"],
    "age_min": 25,
    "age_max": 45,
    "gender": "all",
    "description": "Узнайте подробности в WhatsApp!",
    "client_question": "Здравствуйте! Хочу узнать об услуге.",
    "instagram_url": null,
    "site_url": null,
    "pixel_id": null,
    "utm_tag": "utm_source=facebook&utm_medium=cpc&utm_campaign={{campaign.name}}",
    "created_at": "2025-10-12T15:00:00Z",
    "updated_at": "2025-10-12T15:00:00Z"
  }
}
```

### Response 200 (настройки НЕ существуют):
```json
{
  "success": true,
  "settings": null
}
```

### Response 400:
```json
{
  "success": false,
  "error": "directionId is required"
}
```

---

## 📡 2. POST /api/default-settings

Создать или обновить настройки направления (upsert).

### Request:
```javascript
POST /api/default-settings
Content-Type: application/json

{
  "direction_id": "direction-uuid",
  "campaign_goal": "whatsapp",  // должен совпадать с direction.objective!
  "cities": ["2643743"],
  "age_min": 25,
  "age_max": 45,
  "gender": "all",
  "description": "Узнайте подробности!",
  "client_question": "Здравствуйте! Интересует ваше предложение."
}
```

### Поля в зависимости от campaign_goal:

#### WhatsApp (`campaign_goal: "whatsapp"`):
```javascript
{
  "direction_id": "uuid",
  "campaign_goal": "whatsapp",
  "cities": [...],
  "age_min": 25,
  "age_max": 45,
  "gender": "all",
  "description": "Текст под видео",
  "client_question": "Вопрос клиента для чата"  // ← специфично для WhatsApp
}
```

#### Instagram Traffic (`campaign_goal: "instagram_traffic"`):
```javascript
{
  "direction_id": "uuid",
  "campaign_goal": "instagram_traffic",
  "cities": [...],
  "age_min": 18,
  "age_max": 65,
  "gender": "female",
  "description": "Текст под видео",
  "instagram_url": "https://instagram.com/your_profile"  // ← специфично для Instagram
}
```

#### Site Leads (`campaign_goal: "site_leads"`):
```javascript
{
  "direction_id": "uuid",
  "campaign_goal": "site_leads",
  "cities": [...],
  "age_min": 30,
  "age_max": 55,
  "gender": "all",
  "description": "Текст под видео",
  "site_url": "https://yoursite.com",       // ← специфично для сайта
  "pixel_id": "1234567890",                 // ← опционально
  "utm_tag": "utm_source=facebook&utm_medium=cpc"  // ← опционально
}
```

### Response 201 (создано):
```json
{
  "success": true,
  "settings": {
    "id": "new-uuid",
    "direction_id": "direction-uuid",
    "campaign_goal": "whatsapp",
    // ... все поля
  }
}
```

### Response 200 (обновлено):
```json
{
  "success": true,
  "settings": {
    "id": "existing-uuid",
    // ... обновлённые поля
  }
}
```

### Response 400 (ошибки валидации):
```json
{
  "success": false,
  "error": "Validation error",
  "details": [
    {
      "code": "invalid_type",
      "path": ["age_min"],
      "message": "Expected number, received string"
    }
  ]
}
```

### Response 400 (campaign_goal не совпадает с direction.objective):
```json
{
  "success": false,
  "error": "campaign_goal (instagram_traffic) must match direction.objective (whatsapp)"
}
```

---

## 📡 3. PATCH /api/default-settings/:id

Частичное обновление настроек (можно отправить только изменённые поля).

### Request:
```javascript
PATCH /api/default-settings/settings-uuid
Content-Type: application/json

{
  "age_min": 30,
  "age_max": 50
}
```

### Response 200:
```json
{
  "success": true,
  "settings": {
    "id": "settings-uuid",
    // ... все поля с обновлёнными значениями
  }
}
```

### Response 404:
```json
{
  "success": false,
  "error": "Settings not found"
}
```

---

## 📡 4. DELETE /api/default-settings/:id

Удалить настройки.

### Request:
```javascript
DELETE /api/default-settings/settings-uuid
```

### Response 200:
```json
{
  "success": true,
  "message": "Settings deleted successfully"
}
```

---

## 🎨 UI/UX для фронтенда

### 1. Страница "Направления" — добавляем кнопку "Настройки"

```
┌────────────────────────────────────────────────┐
│ 🎯 Имплантация                                 │
│ ├─ Цель: WhatsApp (переписка)                  │
│ ├─ Бюджет: $50/день                            │
│ ├─ Целевая стоимость: $2.00/лид                │
│ └─ Статус: ✅ Активно                          │
│                                                │
│ [⚙️ Настройки рекламы]  [✏️ Изменить]  [🗑️]   │
└────────────────────────────────────────────────┘
```

### 2. Модальное окно "Настройки рекламы"

При клике на **"⚙️ Настройки рекламы"** открывается модалка:

```
┌──────────────────────────────────────────────────┐
│ Настройки рекламы: Имплантация                   │
│                                                  │
│ 📍 Таргетинг                                     │
│ ├─ Города: [Алматы, Астана] [+ Добавить город]  │
│ ├─ Возраст: [25] - [45]                         │
│ └─ Пол: [● Все ○ Мужчины ○ Женщины]             │
│                                                  │
│ 📝 Контент                                       │
│ └─ Текст под видео:                              │
│    [Узнайте подробности в WhatsApp!]             │
│                                                  │
│ 💬 WhatsApp (специфично для цели)               │
│ └─ Вопрос клиента:                               │
│    [Здравствуйте! Хочу узнать об услуге.]       │
│                                                  │
│ [Отмена]  [Сохранить]                            │
└──────────────────────────────────────────────────┘
```

### 3. Динамические поля в зависимости от direction.objective

**Если direction.objective = "whatsapp":**
```javascript
{
  // Общие поля
  cities: [...],
  age_min: 25,
  age_max: 45,
  gender: "all",
  description: "...",
  
  // WhatsApp специфичные
  client_question: "..."  // ← Показываем в UI
}
```

**Если direction.objective = "instagram_traffic":**
```javascript
{
  // Общие поля
  // ...
  
  // Instagram специфичные
  instagram_url: "https://instagram.com/..."  // ← Показываем в UI
}
```

**Если direction.objective = "site_leads":**
```javascript
{
  // Общие поля
  // ...
  
  // Site Leads специфичные
  site_url: "https://...",       // ← Показываем в UI
  pixel_id: "1234567890",        // ← Опционально
  utm_tag: "utm_source=..."      // ← Опционально, для продвинутых
}
```

---

## 💻 Пример кода для фронтенда

### TypeScript интерфейсы:

```typescript
export interface DefaultAdSettings {
  id: string;
  direction_id: string;
  user_id: string | null;
  campaign_goal: 'whatsapp' | 'instagram_traffic' | 'site_leads';
  cities: string[] | null;
  age_min: number;
  age_max: number;
  gender: 'all' | 'male' | 'female';
  description: string;
  // WhatsApp
  client_question: string | null;
  // Instagram
  instagram_url: string | null;
  // Site Leads
  site_url: string | null;
  pixel_id: string | null;
  utm_tag: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateDefaultSettingsInput {
  direction_id: string;
  campaign_goal: 'whatsapp' | 'instagram_traffic' | 'site_leads';
  cities?: string[];
  age_min?: number;
  age_max?: number;
  gender?: 'all' | 'male' | 'female';
  description?: string;
  client_question?: string;
  instagram_url?: string;
  site_url?: string;
  pixel_id?: string;
  utm_tag?: string;
}
```

### Функции для работы с API:

```typescript
// config/api.ts
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 
  'https://agents.performanteaiagency.com';

// services/defaultSettingsApi.ts
import { API_BASE_URL } from '@/config/api';

export async function getDefaultSettings(directionId: string): Promise<DefaultAdSettings | null> {
  const response = await fetch(`${API_BASE_URL}/api/default-settings?directionId=${directionId}`);
  const data = await response.json();
  
  if (!data.success) {
    throw new Error(data.error);
  }
  
  return data.settings; // может быть null
}

export async function saveDefaultSettings(input: CreateDefaultSettingsInput): Promise<DefaultAdSettings> {
  const response = await fetch(`${API_BASE_URL}/api/default-settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  
  const data = await response.json();
  
  if (!data.success) {
    throw new Error(data.error);
  }
  
  return data.settings;
}

export async function updateDefaultSettings(
  id: string, 
  updates: Partial<CreateDefaultSettingsInput>
): Promise<DefaultAdSettings> {
  const response = await fetch(`${API_BASE_URL}/api/default-settings/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  
  const data = await response.json();
  
  if (!data.success) {
    throw new Error(data.error);
  }
  
  return data.settings;
}

export async function deleteDefaultSettings(id: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/default-settings/${id}`, {
    method: 'DELETE',
  });
  
  const data = await response.json();
  
  if (!data.success) {
    throw new Error(data.error);
  }
}
```

### React компонент (пример):

```typescript
// components/DefaultSettingsDialog.tsx
import { useState, useEffect } from 'react';
import { getDefaultSettings, saveDefaultSettings } from '@/services/defaultSettingsApi';

export function DefaultSettingsDialog({ direction, onClose }) {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSettings();
  }, [direction.id]);

  async function loadSettings() {
    try {
      const data = await getDefaultSettings(direction.id);
      setSettings(data || {
        // Дефолты
        age_min: 18,
        age_max: 65,
        gender: 'all',
        description: 'Напишите нам, чтобы узнать подробности',
      });
    } catch (error) {
      console.error('Failed to load settings:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    try {
      await saveDefaultSettings({
        direction_id: direction.id,
        campaign_goal: direction.objective, // ВАЖНО: должны совпадать!
        ...settings,
      });
      onClose();
    } catch (error) {
      alert(`Ошибка: ${error.message}`);
    }
  }

  if (loading) return <div>Загрузка...</div>;

  return (
    <div className="modal">
      <h2>Настройки рекламы: {direction.name}</h2>
      
      {/* Общие поля */}
      <div>
        <label>Возраст:</label>
        <input 
          type="number" 
          value={settings.age_min} 
          onChange={(e) => setSettings({...settings, age_min: +e.target.value})}
        />
        -
        <input 
          type="number" 
          value={settings.age_max} 
          onChange={(e) => setSettings({...settings, age_max: +e.target.value})}
        />
      </div>

      {/* Специфичные для цели поля */}
      {direction.objective === 'whatsapp' && (
        <div>
          <label>Вопрос клиента:</label>
          <textarea 
            value={settings.client_question || ''}
            onChange={(e) => setSettings({...settings, client_question: e.target.value})}
          />
        </div>
      )}

      {direction.objective === 'instagram_traffic' && (
        <div>
          <label>Instagram URL:</label>
          <input 
            type="url" 
            value={settings.instagram_url || ''}
            onChange={(e) => setSettings({...settings, instagram_url: e.target.value})}
          />
        </div>
      )}

      {direction.objective === 'site_leads' && (
        <>
          <div>
            <label>URL сайта:</label>
            <input 
              type="url" 
              value={settings.site_url || ''}
              onChange={(e) => setSettings({...settings, site_url: e.target.value})}
            />
          </div>
          <div>
            <label>Pixel ID (опционально):</label>
            <input 
              type="text" 
              value={settings.pixel_id || ''}
              onChange={(e) => setSettings({...settings, pixel_id: e.target.value})}
            />
          </div>
        </>
      )}

      <button onClick={onClose}>Отмена</button>
      <button onClick={handleSave}>Сохранить</button>
    </div>
  );
}
```

---

## 🧪 Тестирование

### 1. Создать настройки для нового направления:
```bash
curl -X POST https://agents.performanteaiagency.com/api/default-settings \
  -H "Content-Type: application/json" \
  -d '{
    "direction_id": "YOUR_DIRECTION_UUID",
    "campaign_goal": "whatsapp",
    "cities": ["2643743"],
    "age_min": 25,
    "age_max": 45,
    "gender": "all",
    "description": "Узнайте подробности!",
    "client_question": "Здравствуйте! Хочу узнать."
  }'
```

### 2. Получить настройки:
```bash
curl "https://agents.performanteaiagency.com/api/default-settings?directionId=YOUR_DIRECTION_UUID"
```

### 3. Обновить частично:
```bash
curl -X PATCH https://agents.performanteaiagency.com/api/default-settings/SETTINGS_UUID \
  -H "Content-Type: application/json" \
  -d '{"age_min": 30}'
```

---

## 📝 Примечания

1. **campaign_goal ОБЯЗАН совпадать с direction.objective** — backend проверяет это!
2. **Одна запись на направление** — POST автоматически обновит если настройки уже есть
3. **Дефолты применяются автоматически** — не нужно передавать все поля
4. **RLS политики работают** — доступ только к своим настройкам

---

**Готово к интеграции!** 🚀

