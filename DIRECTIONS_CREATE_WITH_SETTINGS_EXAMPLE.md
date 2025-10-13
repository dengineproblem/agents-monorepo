# 🎯 Пример: Создание направления с дефолтными настройками (один запрос)

## Проблема

Раньше для создания направления с дефолтными настройками рекламы нужно было делать **два отдельных запроса**:
1. `POST /api/directions` → создать направление
2. `POST /api/default-settings` → создать настройки для этого направления

Это неудобно для фронтенда и замедляет процесс.

---

## Решение

Теперь можно передать `default_settings` **опционально** в `POST /api/directions`, и настройки будут созданы автоматически вместе с направлением.

---

## Пример 1: Минимальный (без дефолтных настроек)

```javascript
const createDirection = async () => {
  const response = await fetch(`${API_URL}/api/directions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userAccountId: userAccountId,
      name: "Имплантация",
      objective: "whatsapp",
      daily_budget_cents: 5000,    // $50
      target_cpl_cents: 200         // $2.00
    })
  });

  const data = await response.json();
  console.log(data);
  // {
  //   "success": true,
  //   "direction": { ... },
  //   "default_settings": null  ← настройки НЕ созданы
  // }
};
```

---

## Пример 2: С дефолтными настройками (рекомендуется!)

```javascript
const createDirectionWithSettings = async (formData) => {
  const response = await fetch(`${API_URL}/api/directions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userAccountId: userAccountId,
      name: formData.name,
      objective: formData.objective,
      daily_budget_cents: Math.round(formData.daily_budget * 100),
      target_cpl_cents: Math.round(formData.target_cpl * 100),
      
      // 🔥 Опциональные дефолтные настройки
      default_settings: {
        cities: formData.cities || [],
        age_min: formData.age_min || 18,
        age_max: formData.age_max || 65,
        gender: formData.gender || "all",
        description: formData.description || "",
        
        // Поля в зависимости от objective:
        ...(formData.objective === 'whatsapp' && {
          client_question: formData.client_question
        }),
        ...(formData.objective === 'instagram_traffic' && {
          instagram_url: formData.instagram_url
        }),
        ...(formData.objective === 'site_leads' && {
          site_url: formData.site_url,
          pixel_id: formData.pixel_id,
          utm_tag: formData.utm_tag
        })
      }
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create direction');
  }

  const data = await response.json();
  console.log(data);
  // {
  //   "success": true,
  //   "direction": { ... },
  //   "default_settings": { ... }  ← настройки СОЗДАНЫ!
  // }
  
  return data;
};
```

---

## Пример 3: React компонент с формой

```jsx
import React, { useState } from 'react';

const CreateDirectionForm = ({ userAccountId, onSuccess }) => {
  const [formData, setFormData] = useState({
    name: '',
    objective: 'whatsapp',
    daily_budget: 50,
    target_cpl: 2.0,
    // Default settings
    cities: [],
    age_min: 25,
    age_max: 55,
    gender: 'all',
    description: '',
    client_question: '',
    instagram_url: '',
    site_url: '',
    pixel_id: '',
    utm_tag: ''
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${process.env.REACT_APP_API_URL}/api/directions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userAccountId: userAccountId,
          name: formData.name,
          objective: formData.objective,
          daily_budget_cents: Math.round(formData.daily_budget * 100),
          target_cpl_cents: Math.round(formData.target_cpl * 100),
          
          // Отправляем default_settings только если хотя бы одно поле заполнено
          default_settings: {
            cities: formData.cities,
            age_min: formData.age_min,
            age_max: formData.age_max,
            gender: formData.gender,
            description: formData.description,
            ...(formData.objective === 'whatsapp' && {
              client_question: formData.client_question
            }),
            ...(formData.objective === 'instagram_traffic' && {
              instagram_url: formData.instagram_url
            }),
            ...(formData.objective === 'site_leads' && {
              site_url: formData.site_url,
              pixel_id: formData.pixel_id,
              utm_tag: formData.utm_tag
            })
          }
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create direction');
      }

      const data = await response.json();
      console.log('Direction created:', data);
      
      // Показываем успех
      alert('Направление создано успешно!');
      
      // Вызываем callback для обновления списка
      onSuccess(data.direction);
      
    } catch (err) {
      console.error('Error creating direction:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <h2>Создать направление</h2>

      {/* Основные поля */}
      <input
        type="text"
        placeholder="Название направления"
        value={formData.name}
        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
        required
      />

      <select
        value={formData.objective}
        onChange={(e) => setFormData({ ...formData, objective: e.target.value })}
        required
      >
        <option value="whatsapp">WhatsApp (переписки)</option>
        <option value="instagram_traffic">Instagram Traffic (переходы)</option>
        <option value="site_leads">Site Leads (заявки на сайте)</option>
      </select>

      <input
        type="number"
        placeholder="Суточный бюджет ($)"
        value={formData.daily_budget}
        onChange={(e) => setFormData({ ...formData, daily_budget: parseFloat(e.target.value) })}
        min="10"
        step="1"
        required
      />

      <input
        type="number"
        placeholder="Целевой CPL ($)"
        value={formData.target_cpl}
        onChange={(e) => setFormData({ ...formData, target_cpl: parseFloat(e.target.value) })}
        min="0.5"
        step="0.01"
        required
      />

      {/* Дефолтные настройки рекламы */}
      <h3>Дефолтные настройки рекламы (опционально)</h3>

      <input
        type="number"
        placeholder="Минимальный возраст"
        value={formData.age_min}
        onChange={(e) => setFormData({ ...formData, age_min: parseInt(e.target.value) })}
        min="18"
        max="65"
      />

      <input
        type="number"
        placeholder="Максимальный возраст"
        value={formData.age_max}
        onChange={(e) => setFormData({ ...formData, age_max: parseInt(e.target.value) })}
        min="18"
        max="65"
      />

      <select
        value={formData.gender}
        onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
      >
        <option value="all">Все</option>
        <option value="male">Мужчины</option>
        <option value="female">Женщины</option>
      </select>

      <textarea
        placeholder="Описание рекламы"
        value={formData.description}
        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
      />

      {/* Поля в зависимости от objective */}
      {formData.objective === 'whatsapp' && (
        <input
          type="text"
          placeholder="Вопрос клиента (например: Сколько стоит имплантация?)"
          value={formData.client_question}
          onChange={(e) => setFormData({ ...formData, client_question: e.target.value })}
        />
      )}

      {formData.objective === 'instagram_traffic' && (
        <input
          type="url"
          placeholder="Instagram URL"
          value={formData.instagram_url}
          onChange={(e) => setFormData({ ...formData, instagram_url: e.target.value })}
        />
      )}

      {formData.objective === 'site_leads' && (
        <>
          <input
            type="url"
            placeholder="URL сайта"
            value={formData.site_url}
            onChange={(e) => setFormData({ ...formData, site_url: e.target.value })}
          />
          <input
            type="text"
            placeholder="Pixel ID"
            value={formData.pixel_id}
            onChange={(e) => setFormData({ ...formData, pixel_id: e.target.value })}
          />
          <input
            type="text"
            placeholder="UTM tag"
            value={formData.utm_tag}
            onChange={(e) => setFormData({ ...formData, utm_tag: e.target.value })}
          />
        </>
      )}

      {error && <div className="error">{error}</div>}

      <button type="submit" disabled={loading}>
        {loading ? 'Создание...' : 'Создать направление'}
      </button>
    </form>
  );
};

export default CreateDirectionForm;
```

---

## Валидация

Backend автоматически валидирует:
- ✅ `name`: 2-100 символов
- ✅ `objective`: только `whatsapp` | `instagram_traffic` | `site_leads`
- ✅ `daily_budget_cents`: минимум 1000 (= $10)
- ✅ `target_cpl_cents`: минимум 50 (= $0.50)
- ✅ `default_settings.age_min/age_max`: 18-65
- ✅ `default_settings.gender`: только `all` | `male` | `female`
- ✅ `default_settings.instagram_url`, `site_url`: валидные URL

При ошибке валидации вернётся `400 Bad Request` с деталями.

---

## Резюме

✅ **Можно создать направление БЕЗ дефолтных настроек** (просто не передавать `default_settings`)
✅ **Можно создать направление С дефолтными настройками** (передать `default_settings` в теле запроса)
✅ **Один запрос вместо двух** → улучшенный UX
✅ **Обратная совместимость** → старый код (без `default_settings`) продолжит работать

---

## Тестирование

```bash
# 1. Создать направление БЕЗ дефолтных настроек
curl -X POST http://localhost:8082/api/directions \
  -H "Content-Type: application/json" \
  -d '{
    "userAccountId": "YOUR_UUID",
    "name": "Тест 1",
    "objective": "whatsapp",
    "daily_budget_cents": 5000,
    "target_cpl_cents": 200
  }'

# 2. Создать направление С дефолтными настройками
curl -X POST http://localhost:8082/api/directions \
  -H "Content-Type: application/json" \
  -d '{
    "userAccountId": "YOUR_UUID",
    "name": "Тест 2",
    "objective": "whatsapp",
    "daily_budget_cents": 5000,
    "target_cpl_cents": 200,
    "default_settings": {
      "cities": ["Москва"],
      "age_min": 25,
      "age_max": 45,
      "gender": "all",
      "description": "Тестовое описание",
      "client_question": "Сколько стоит?"
    }
  }'
```

---

🎉 **Готово!** Теперь фронтенд может создавать направления и дефолтные настройки одним запросом!

