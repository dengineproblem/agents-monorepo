# Сессия 2025-11-10: WhatsApp CRM - Онбординг и Кампании

## Что сделано

### Первая итерация (коммит: `1d28d97`)
✅ Онбординг клиента с AI-генерацией персонализированных промптов  
✅ Автоматические реактивационные кампании с слотовой отправкой  
✅ UI для аудио/заметок/автопилота на каждом лиде  
✅ Dashboard метрик кампаний  
✅ Исправлены баги загрузки лидов и генерации очереди  

### Вторая итерация (текущая)
✅ Убрано дублирование генерации сообщений (только при формировании очереди)  
✅ Смягчены критерии отбора лидов (~300 вместо 9 из 1000)  
✅ Расширен онбординг: 3 шага с воронкой, критериями, сигналами  
✅ Обновлён META_PROMPT под новые переменные брифа  
✅ Добавлен персонализированный контекст в генератор сообщений  
✅ Обновлена схема БД и API валидация  

**Следующий коммит**: см. [CRM_QUEUE_IMPROVEMENTS_SUMMARY.md](./CRM_QUEUE_IMPROVEMENTS_SUMMARY.md)

## Документация

- [INFRASTRUCTURE.md](./INFRASTRUCTURE.md) - архитектура, порты, деплой (раздел "WhatsApp CRM & Chatbot")
- [FRONTEND_API_CONVENTIONS.md](./FRONTEND_API_CONVENTIONS.md) - правила работы с API (раздел "CRM & CHATBOT API")

## Ключевые файлы CRM

**Backend:**
- [services/crm-backend/src/routes/businessProfile.ts](./services/crm-backend/src/routes/businessProfile.ts) - онбординг
- [services/crm-backend/src/lib/promptGenerator.ts](./services/crm-backend/src/lib/promptGenerator.ts) - AI промпты
- [services/crm-backend/src/scripts/analyzeDialogs.ts](./services/crm-backend/src/scripts/analyzeDialogs.ts) - анализ лидов

**Frontend:**
- [services/crm-frontend/src/components/onboarding/OnboardingModal.tsx](./services/crm-frontend/src/components/onboarding/OnboardingModal.tsx) - UI онбординга
- [services/crm-frontend/src/pages/WhatsAppCRM.tsx](./services/crm-frontend/src/pages/WhatsAppCRM.tsx) - главная страница CRM
- [services/crm-frontend/src/pages/ReactivationCampaigns.tsx](./services/crm-frontend/src/pages/ReactivationCampaigns.tsx) - кампании

**Chatbot:**
- [services/chatbot-service/src/routes/campaign.ts](./services/chatbot-service/src/routes/campaign.ts) - API кампаний
- [services/chatbot-service/src/workers/campaignWorker.ts](./services/chatbot-service/src/workers/campaignWorker.ts) - автоотправка
- [services/chatbot-service/src/lib/campaignScoringAgent.ts](./services/chatbot-service/src/lib/campaignScoringAgent.ts) - скоринг лидов

## Миграции

- Выполнить вручную в Supabase: `services/crm-backend/migrations/002_business_profile.sql`

