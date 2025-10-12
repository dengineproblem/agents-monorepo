# Интеграция Направлений — Инструкция для фронтенда

## 🌐 API URLs

### **Локальная разработка:**
```
http://localhost:8082
```

### **Продакшн:**
```
https://agents.performanteaiagency.com
```

---

## ✅ НАСТРОЙКА: Конфиг API

### **Создайте файл конфигурации:**

```typescript
// config/api.ts или lib/api.ts

export const API_CONFIG = {
  // Автоматически определяет окружение
  baseURL: process.env.NEXT_PUBLIC_API_URL || 
           (process.env.NODE_ENV === 'production' 
             ? 'https://agents.performanteaiagency.com'
             : 'http://localhost:8082'
           ),
};

// Или проще:
export const API_BASE_URL = 
  process.env.NEXT_PUBLIC_API_URL || 
  'https://agents.performanteaiagency.com';  // Всегда продакшн URL, локально переопределяется через .env
```

### **Создайте `.env.local` для локальной разработки:**

```bash
# .env.local (не коммитить в git!)
NEXT_PUBLIC_API_URL=http://localhost:8082
```

### **В `.env.production` (или не создавайте, будет дефолт):**

```bash
# .env.production (опционально)
NEXT_PUBLIC_API_URL=https://agents.performanteaiagency.com
```

---

## 📡 API Методы для Directions

### **1. Создайте сервисный файл:**

```typescript
// services/directionsApi.ts

import { API_BASE_URL } from '@/config/api';

export interface Direction {
  id: string;
  user_account_id: string;
  name: string;
  objective: 'whatsapp' | 'instagram_traffic' | 'site_leads';
  fb_campaign_id: string | null;
  campaign_status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'DELETED';
  daily_budget_cents: number;
  target_cpl_cents: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateDirectionInput {
  userAccountId: string;
  name: string;
  objective: 'whatsapp' | 'instagram_traffic' | 'site_leads';
  daily_budget_cents: number;
  target_cpl_cents: number;
}

export interface UpdateDirectionInput {
  name?: string;
  daily_budget_cents?: number;
  target_cpl_cents?: number;
  is_active?: boolean;
}

// ========================================
// API МЕТОДЫ
// ========================================

/**
 * Получить все направления пользователя
 */
export async function fetchDirections(userAccountId: string): Promise<Direction[]> {
  const response = await fetch(
    `${API_BASE_URL}/api/directions?userAccountId=${userAccountId}`,
    {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    }
  );

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Failed to fetch directions');
  }

  return data.directions;
}

/**
 * Создать новое направление
 */
export async function createDirection(input: CreateDirectionInput): Promise<Direction> {
  const response = await fetch(
    `${API_BASE_URL}/api/directions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }
  );

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Failed to create direction');
  }

  return data.direction;
}

/**
 * Обновить направление
 */
export async function updateDirection(
  directionId: string,
  updates: UpdateDirectionInput
): Promise<Direction> {
  const response = await fetch(
    `${API_BASE_URL}/api/directions/${directionId}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    }
  );

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Failed to update direction');
  }

  return data.direction;
}

/**
 * Удалить направление
 */
export async function deleteDirection(directionId: string): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/api/directions/${directionId}`,
    {
      method: 'DELETE',
    }
  );

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Failed to delete direction');
  }
}

// ========================================
// HELPER ФУНКЦИИ
// ========================================

/**
 * Конвертация центов в доллары
 */
export function centsToDollars(cents: number): number {
  return cents / 100;
}

/**
 * Конвертация долларов в центы
 */
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/**
 * Читаемое название objective
 */
export function getObjectiveLabel(objective: Direction['objective']): string {
  const labels = {
    whatsapp: 'WhatsApp (переписки)',
    instagram_traffic: 'Instagram Traffic (переходы)',
    site_leads: 'Site Leads (заявки на сайте)',
  };
  return labels[objective];
}
```

---

## 🎨 Использование в компонентах

### **Пример: Список направлений**

```typescript
// components/DirectionsCard.tsx

'use client';

import { useEffect, useState } from 'react';
import { 
  fetchDirections, 
  Direction, 
  centsToDollars, 
  getObjectiveLabel 
} from '@/services/directionsApi';

export function DirectionsCard({ userAccountId }: { userAccountId: string }) {
  const [directions, setDirections] = useState<Direction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDirections();
  }, [userAccountId]);

  async function loadDirections() {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchDirections(userAccountId);
      setDirections(data);
    } catch (err: any) {
      setError(err.message);
      console.error('Failed to load directions:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div>Загрузка направлений...</div>;
  if (error) return <div>Ошибка: {error}</div>;
  if (directions.length === 0) {
    return (
      <div>
        <h3>У вас пока нет направлений</h3>
        <button onClick={() => {/* открыть модалку создания */}}>
          + Создать направление
        </button>
      </div>
    );
  }

  return (
    <div>
      <h2>Направления бизнеса</h2>
      {directions.map(direction => (
        <div key={direction.id} className="direction-card">
          <h3>{direction.name}</h3>
          <p>Тип: {getObjectiveLabel(direction.objective)}</p>
          <p>Бюджет: ${centsToDollars(direction.daily_budget_cents)}/день</p>
          <p>Целевой CPL: ${centsToDollars(direction.target_cpl_cents)}</p>
          <p>Статус: {direction.is_active ? 'Активно ✓' : 'Неактивно'}</p>
          <p>Facebook Campaign: {direction.fb_campaign_id}</p>
        </div>
      ))}
    </div>
  );
}
```

### **Пример: Создание направления**

```typescript
// components/CreateDirectionModal.tsx

'use client';

import { useState } from 'react';
import { createDirection, dollarsToCents } from '@/services/directionsApi';

export function CreateDirectionModal({ 
  userAccountId, 
  onSuccess, 
  onClose 
}: { 
  userAccountId: string;
  onSuccess: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [objective, setObjective] = useState<'whatsapp' | 'instagram_traffic' | 'site_leads'>('whatsapp');
  const [dailyBudget, setDailyBudget] = useState(50);
  const [targetCpl, setTargetCpl] = useState(2.00);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    
    if (dailyBudget < 10) {
      setError('Минимальный бюджет: $10/день');
      return;
    }

    if (targetCpl < 0.50) {
      setError('Минимальный CPL: $0.50');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      await createDirection({
        userAccountId,
        name,
        objective,
        daily_budget_cents: dollarsToCents(dailyBudget),
        target_cpl_cents: dollarsToCents(targetCpl),
      });

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message);
      console.error('Failed to create direction:', err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal">
      <h2>Создать направление</h2>
      <form onSubmit={handleSubmit}>
        <label>
          Название направления *
          <input 
            type="text" 
            value={name} 
            onChange={e => setName(e.target.value)}
            placeholder="Например: Имплантация"
            required
            minLength={2}
            maxLength={100}
          />
        </label>

        <label>
          Тип кампании *
          <select value={objective} onChange={e => setObjective(e.target.value as any)}>
            <option value="whatsapp">WhatsApp (переписки)</option>
            <option value="instagram_traffic">Instagram Traffic (переходы)</option>
            <option value="site_leads">Site Leads (заявки на сайте)</option>
          </select>
        </label>

        <label>
          Суточный бюджет * (минимум $10)
          <input 
            type="number" 
            value={dailyBudget} 
            onChange={e => setDailyBudget(parseFloat(e.target.value))}
            min={10}
            step={1}
            required
          />
        </label>

        <label>
          Целевой CPL * (минимум $0.50)
          <input 
            type="number" 
            value={targetCpl} 
            onChange={e => setTargetCpl(parseFloat(e.target.value))}
            min={0.50}
            step={0.01}
            required
          />
        </label>

        {error && <div className="error">{error}</div>}

        <div className="buttons">
          <button type="button" onClick={onClose} disabled={loading}>
            Отмена
          </button>
          <button type="submit" disabled={loading}>
            {loading ? 'Создаём...' : 'Создать'}
          </button>
        </div>
      </form>
    </div>
  );
}
```

---

## 🚀 ДЕПЛОЙ НА ПРОДАКШН

### **На сервере выполни:**

```bash
# 1. Перейди в проект
cd /path/to/agents-monorepo

# 2. Забери изменения
git pull origin main

# 3. Пересобери сервисы
docker-compose build agent-service agent-brain

# 4. Перезапусти
docker-compose up -d

# 5. Обнови nginx конфигурацию (если изменилась)
sudo cp nginx.conf /etc/nginx/sites-available/agents
sudo nginx -t
sudo systemctl reload nginx

# 6. Проверь что сервисы работают
curl https://agents.performanteaiagency.com/health
```

### **Проверка API на продакшене:**

```bash
# Получить направления
curl "https://agents.performanteaiagency.com/api/directions?userAccountId=YOUR_UUID"

# Должен вернуть:
# {
#   "success": true,
#   "directions": [...]
# }
```

---

## ✅ ЧЕКЛИСТ

- [ ] Создан `config/api.ts` с `API_BASE_URL`
- [ ] Создан `.env.local` с `NEXT_PUBLIC_API_URL=http://localhost:8082`
- [ ] Создан `services/directionsApi.ts` с методами API
- [ ] Убрано прямое обращение к Supabase для `account_directions`
- [ ] Все компоненты используют API методы из `directionsApi.ts`
- [ ] Протестировано локально (http://localhost:8082)
- [ ] Backend пересобран и запущен
- [ ] Nginx конфигурация обновлена (порт 8082)
- [ ] Протестировано на продакшене (https://agents.performanteaiagency.com)

---

## 🎯 ИТОГО

**Локально:**
```
Frontend → http://localhost:8082/api/directions
```

**На продакшене:**
```
Frontend → https://agents.performanteaiagency.com/api/directions
        ↓
      Nginx (порт 443)
        ↓
    agent-service (порт 8082)
        ↓
    Supabase (через service_role)
```

Всё готово! 🚀

