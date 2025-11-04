# WhatsApp CRM - Быстрый старт

## 🚀 Что сделано

✅ **Phase 1 ЗАВЕРШЕН** - Kanban Board с Drag & Drop

### Новые возможности:

1. **Kanban доска** с 7 этапами воронки продаж
2. **Drag & Drop** - перетаскивайте лиды между этапами
3. **Добавление лидов** вручную через форму
4. **Удаление лидов** с подтверждением
5. **Цветовая индикация** по температуре (🔥 HOT, 🟠 WARM, 🔵 COLD)
6. **Фильтры** по интересу, этапу, score
7. **Статистика** в реальном времени

---

## ⚡ Быстрый запуск

### 1. Установить зависимости (уже сделано)

```bash
cd services/frontend
# react-dnd и react-dnd-html5-backend уже установлены ✅
```

### 2. Применить SQL миграции

Откройте Supabase Dashboard → SQL Editor и выполните:

```sql
-- services/frontend/supabase/add_crm_fields.sql
ALTER TABLE dialog_analysis 
  ADD COLUMN IF NOT EXISTS ad_budget TEXT,
  ADD COLUMN IF NOT EXISTS instagram_url TEXT,
  ADD COLUMN IF NOT EXISTS funnel_stage TEXT CHECK (funnel_stage IN ('new_lead', 'not_qualified', 'qualified', 'consultation_booked', 'consultation_completed', 'deal_closed', 'deal_lost')),
  ADD COLUMN IF NOT EXISTS qualification_complete BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE INDEX IF NOT EXISTS idx_dialog_analysis_funnel_stage ON dialog_analysis(funnel_stage);
CREATE INDEX IF NOT EXISTS idx_dialog_analysis_qualification ON dialog_analysis(qualification_complete);

UPDATE dialog_analysis 
SET funnel_stage = 'new_lead' 
WHERE funnel_stage IS NULL;
```

### 3. Перезапустить сервисы

```bash
# Backend
cd services/agent-service
npm run dev

# Frontend
cd services/frontend
npm run dev
```

### 4. Открыть CRM

```
http://localhost:5173/whatsapp-analysis
```

---

## 📖 Как использовать

### Добавить лида вручную

1. Нажмите **"+ Новый лид"**
2. Заполните телефон (обязательно)
3. Выберите этап воронки
4. Нажмите **"Добавить лида"**

### Переместить лида

1. **Захватите** карточку лида мышкой
2. **Перетащите** в нужную колонку
3. Статус автоматически обновится в БД
4. Появится уведомление об успехе

### Просмотреть детали

1. **Кликните** на карточку лида
2. Откроется модальное окно с полной информацией

### Удалить лида

1. Наведите на карточку
2. Нажмите иконку **🗑️**
3. Подтвердите удаление

### Фильтровать лидов

1. Нажмите **"Фильтры"** в header
2. Выберите:
   - Уровень интереса (hot/warm/cold)
   - Этап воронки
   - Минимальный score
3. Kanban автоматически обновится

---

## 📁 Структура Kanban

```
┌────────────┬────────────┬────────────┬────────────┬────────────┬────────────┬────────────┐
│ Новый лид  │ Не квалиф. │Квалифициров│Консультация│Консультация│  Сделка    │  Сделка    │
│            │            │     ан     │  назначена │   прошла   │  закрыта   │ потеряна   │
│    (5)     │    (3)     │    (12)    │     (8)    │     (3)    │    (2)     │    (1)     │
├────────────┼────────────┼────────────┼────────────┼────────────┼────────────┼────────────┤
│            │            │            │            │            │            │            │
│ 🔥 85      │ 🟠 60      │ 🔥 90      │ 🟠 75      │ 🔵 55      │ 🟢 95      │ 🔴 40      │
│ Иван       │ Мария      │ Петр       │ Ольга      │ Дмитрий    │ Анна       │ Сергей     │
│            │            │            │            │            │            │            │
└────────────┴────────────┴────────────┴────────────┴────────────┴────────────┴────────────┘
```

---

## 🎨 Цветовая индикация

- 🔥 **HOT (red)** - горячий лид, высокий приоритет
- 🟠 **WARM (orange)** - теплый лид, средний приоритет
- 🔵 **COLD (blue)** - холодный лид, низкий приоритет

---

## 🔧 API Endpoints (новые)

### Создать лида
```bash
POST /api/dialogs/leads
{
  "phone": "+77001234567",
  "contactName": "Иван Петров",
  "businessType": "Клиника",
  "isMedical": true,
  "funnelStage": "new_lead",
  "userAccountId": "uuid",
  "instanceName": "my-instance"
}
```

### Обновить лида
```bash
PATCH /api/dialogs/leads/:id
{
  "userAccountId": "uuid",
  "funnelStage": "qualified"
}
```

### Удалить лида
```bash
DELETE /api/dialogs/analysis/:id?userAccountId=uuid
```

---

## 📚 Документация

- **[WHATSAPP_CRM_SETUP.md](./WHATSAPP_CRM_SETUP.md)** - полная инструкция по настройке
- **[WHATSAPP_CRM_PHASE1_COMPLETE.md](./WHATSAPP_CRM_PHASE1_COMPLETE.md)** - технический отчет
- **[WHATSAPP_CRM_ROADMAP.md](./WHATSAPP_CRM_ROADMAP.md)** - roadmap всех фаз

---

## ❓ FAQ

**Q: Не работает drag & drop**  
A: Проверьте, что установлены `react-dnd` и `react-dnd-html5-backend`

**Q: Лиды не отображаются**  
A: Выполните SQL миграцию `add_crm_fields.sql` в Supabase

**Q: Как добавить WhatsApp инстанс?**  
A: Убедитесь, что есть запись в таблице `whatsapp_instances` для вашего `user_account_id`

**Q: Можно ли редактировать лида?**  
A: В Phase 1 можно только перемещать между этапами и удалять. Полное редактирование в Phase 2.

---

## 🚀 Что дальше?

### Phase 2 (следующая)
- ✅ Форма редактирования лида
- ✅ Обновление всех полей
- ✅ Валидация данных

### Phase 3
- 📜 История сообщений из WhatsApp
- 💬 Timeline диалога

### Phase 4
- 📤 Отправка сообщений из CRM
- 📋 Шаблоны сообщений

---

**Готово к использованию!** 🎉

Если есть вопросы или проблемы - смотрите подробную документацию в `WHATSAPP_CRM_SETUP.md`

