# ✅ Чеклист деплоя функции "Направления"

## 📋 ЧТО УЖЕ ГОТОВО (Backend)

✅ **Миграция базы данных:**
- `008_account_directions.sql` — создание таблицы
- `009_add_objective_to_directions.sql` — добавление поля `objective`

✅ **API Endpoints:**
- `GET /api/directions?userAccountId={uuid}`
- `POST /api/directions`
- `PATCH /api/directions/{id}`
- `DELETE /api/directions/{id}`

✅ **Backend сервис:**
- `services/agent-service/src/routes/directions.ts` — маршруты
- `services/agent-service/src/server.ts` — регистрация routes
- Автоматическое создание Facebook Campaign при создании направления

✅ **Nginx конфигурация:**
- Обновлён порт: `8080` → `8082`

✅ **Документация:**
- `DIRECTIONS_FRONTEND_SPEC.md` — спецификация для фронтенда
- `DIRECTIONS_FRONTEND_INTEGRATION.md` — код интеграции

---

## 🎯 ЧТО НУЖНО СДЕЛАТЬ

### **1. База данных (Supabase)**

```bash
# Применить миграцию в Supabase SQL Editor:
```

Скопируй и выполни файл: `migrations/009_add_objective_to_directions.sql`

**Проверка:**
```sql
-- Проверить что поле добавлено:
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'account_directions';

-- Должно быть поле: objective | text
```

---

### **2. Backend (Сервер)**

```bash
# SSH на сервер и выполни:

cd /path/to/agents-monorepo

# Забери изменения
git pull origin main

# Пересобери сервисы
docker-compose build agent-service agent-brain

# Перезапусти
docker-compose down
docker-compose up -d

# Обнови nginx (если изменилась конфигурация)
sudo cp nginx.conf /etc/nginx/sites-available/agents
sudo nginx -t
sudo systemctl reload nginx

# Проверь что сервисы запустились
docker-compose ps

# Проверь логи
docker-compose logs -f agent-service
```

**Проверка API:**
```bash
# Health check
curl https://agents.performanteaiagency.com/health

# Directions API (замени YOUR_UUID на реальный)
curl "https://agents.performanteaiagency.com/api/directions?userAccountId=YOUR_UUID"

# Должен вернуть:
# { "success": true, "directions": [...] }
```

---

### **3. Frontend (Код)**

#### **3.1. Создать конфиг API:**

```typescript
// config/api.ts
export const API_BASE_URL = 
  process.env.NEXT_PUBLIC_API_URL || 
  'https://agents.performanteaiagency.com';
```

#### **3.2. Создать `.env.local` для локальной разработки:**

```bash
# .env.local
NEXT_PUBLIC_API_URL=http://localhost:8082
```

#### **3.3. Создать `services/directionsApi.ts`**

Скопируй весь код из файла: `DIRECTIONS_FRONTEND_INTEGRATION.md` (раздел "API Методы для Directions")

#### **3.4. Обновить компонент DirectionsCard**

**Было (прямое обращение к Supabase):**
```typescript
const { data, error } = await supabase
  .from('account_directions')
  .select('*')
  .eq('user_account_id', userAccountId);
```

**Стало (через Backend API):**
```typescript
import { fetchDirections } from '@/services/directionsApi';

const directions = await fetchDirections(userAccountId);
```

#### **3.5. Обновить создание направления**

Использовать метод `createDirection()` из `directionsApi.ts` вместо прямого Supabase INSERT.

---

### **4. Тестирование**

#### **Локально:**

1. Запусти backend:
```bash
docker-compose up -d
```

2. Проверь что API работает:
```bash
curl "http://localhost:8082/api/directions?userAccountId=YOUR_UUID"
```

3. Запусти frontend и проверь что данные загружаются

#### **На продакшене:**

1. После деплоя проверь:
```bash
curl "https://agents.performanteaiagency.com/api/directions?userAccountId=YOUR_UUID"
```

2. Открой фронтенд → Личный кабинет → Направления
3. Проверь что:
   - Направления отображаются
   - Можно создать новое направление
   - Можно изменить направление
   - Можно удалить направление

---

## 🐛 Troubleshooting

### **Проблема: API возвращает 404**

```bash
# Проверь что agent-service запущен на порту 8082
docker-compose ps

# Проверь логи
docker-compose logs agent-service | grep directions

# Пересобери если нужно
docker-compose build agent-service
docker-compose up -d agent-service
```

### **Проблема: Nginx возвращает 502 Bad Gateway**

```bash
# Проверь что backend запущен
curl http://localhost:8082/health

# Проверь nginx логи
sudo tail -f /var/log/nginx/agents_error.log

# Проверь что порт правильный в nginx.conf (должен быть 8082)
sudo cat /etc/nginx/sites-available/agents | grep proxy_pass
```

### **Проблема: Frontend не может подключиться к API**

1. Проверь консоль браузера (DevTools → Console)
2. Проверь Network tab — какой URL используется?
3. Должен быть:
   - Локально: `http://localhost:8082/api/directions`
   - Продакшн: `https://agents.performanteaiagency.com/api/directions`
4. Проверь что `API_BASE_URL` правильно настроен

### **Проблема: RLS политики блокируют доступ**

```sql
-- Проверь политики в Supabase:
SELECT * FROM pg_policies WHERE tablename = 'account_directions';

-- Должна быть политика для service_role с USING (true)
```

Если политики неправильные — backend использует `SUPABASE_SERVICE_ROLE`, который игнорирует RLS.

---

## 📊 Финальная проверка

После деплоя проверь что всё работает:

- [ ] Миграция применена в Supabase
- [ ] Backend пересобран и запущен
- [ ] API `/api/directions` возвращает `200 OK`
- [ ] Nginx конфигурация обновлена (порт 8082)
- [ ] Frontend использует Backend API (не прямой Supabase)
- [ ] Локально работает (http://localhost:8082)
- [ ] На продакшене работает (https://agents.performanteaiagency.com)
- [ ] Можно создать направление
- [ ] Можно изменить направление
- [ ] Можно удалить направление
- [ ] Направления отображаются в личном кабинете

---

## 🎉 Готово!

Если все пункты отмечены ✅ — функция "Направления" полностью работает! 🚀

**Домены:**
- Frontend: (твой домен фронтенда)
- Backend API: `https://agents.performanteaiagency.com`
- Brain Agent: `https://brain2.performanteaiagency.com`

