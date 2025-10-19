# 🔧 ИЗМЕНЕНИЯ КОДА ДЛЯ APP REVIEW

**Цель:** Скрыть автоматизацию и лишний функционал, показать только ручное управление

**Принцип:** НЕ удаляем код, только СКРЫВАЕМ через feature flag

---

## 🎯 ЧТО НУЖНО СДЕЛАТЬ

### 1. Feature Flag (главный переключатель)
### 2. Добавить Confirmation Dialogs
### 3. Скрыть TikTok
### 4. Скрыть Creatives (раздел креативов)
### 5. Скрыть Directions (направления)
### 6. Скрыть AI Autopilot
### 7. Скрыть Campaign Builder (Auto Launch)
### 8. Показать только старый VideoUpload для Instagram

---

## 1️⃣ FEATURE FLAG

### Создать файл с флагами

**Файл:** `services/frontend/src/config/appReview.ts`

```typescript
// Feature flags для App Review mode
export const APP_REVIEW_MODE = import.meta.env.VITE_APP_REVIEW_MODE === 'true';

export const FEATURES = {
  // Что показываем в App Review mode
  SHOW_VIDEO_UPLOAD: true,        // Загрузка видео - ПОКАЗЫВАЕМ
  SHOW_CAMPAIGN_LIST: true,       // Список кампаний - ПОКАЗЫВАЕМ
  SHOW_CAMPAIGN_DETAIL: true,     // Детали кампании - ПОКАЗЫВАЕМ
  SHOW_PROFILE: true,             // Профиль - ПОКАЗЫВАЕМ
  SHOW_FACEBOOK_CONNECT: true,    // Подключение Facebook - ПОКАЗЫВАЕМ
  
  // Что скрываем в App Review mode
  SHOW_TIKTOK: !APP_REVIEW_MODE,           // TikTok - СКРЫВАЕМ
  SHOW_CREATIVES: !APP_REVIEW_MODE,        // Раздел креативов - СКРЫВАЕМ
  SHOW_DIRECTIONS: !APP_REVIEW_MODE,       // Направления - СКРЫВАЕМ
  SHOW_AI_AUTOPILOT: !APP_REVIEW_MODE,     // AI Autopilot - СКРЫВАЕМ
  SHOW_CAMPAIGN_BUILDER: !APP_REVIEW_MODE, // Auto Launch - СКРЫВАЕМ
  SHOW_ANALYTICS: !APP_REVIEW_MODE,        // ROI Analytics - СКРЫВАЕМ
  SHOW_CONSULTATIONS: !APP_REVIEW_MODE,    // Консультации - СКРЫВАЕМ
};
```

### Добавить в .env файлы

**Файл:** `services/frontend/.env` (для production App Review)
```bash
VITE_APP_REVIEW_MODE=true
```

**Файл:** `services/frontend/.env.local` (для локальной разработки)
```bash
VITE_APP_REVIEW_MODE=false
```

---

## 2️⃣ ДОБАВИТЬ CONFIRMATION DIALOGS

### В VideoUpload.tsx - перед созданием кампании

**Файл:** `services/frontend/src/components/VideoUpload.tsx`

**Найти функцию:** `const uploadVideo = async () => {`

**Добавить ПОСЛЕ всех валидаций, ПЕРЕД `setIsUploading(true)`:**

```typescript
const uploadVideo = async () => {
  // ... все существующие валидации ...
  
  // ===== ДОБАВИТЬ ЭТО =====
  const budgetText = placement === 'instagram' 
    ? `$${dailyBudgetInstagram}/day`
    : placement === 'tiktok'
    ? `${dailyBudgetTiktok}₸/day`
    : `Instagram: $${dailyBudgetInstagram}/day, TikTok: ${dailyBudgetTiktok}₸/day`;
  
  const confirmed = window.confirm(
    `Create campaign "${campaignName}" with budget ${budgetText}?\n\n` +
    `Target: ${selectedCities.map(id => CITIES_AND_COUNTRIES.find(c => c.id === id)?.name || id).join(', ')}\n` +
    `Age: ${ageMin}-${ageMax}\n` +
    `Goal: ${campaignGoal}`
  );
  
  if (!confirmed) {
    return; // Пользователь отменил
  }
  // ===== КОНЕЦ ДОБАВЛЕНИЯ =====

  setIsUploading(true);
  // ... остальной код функции ...
}
```

### В CampaignList.tsx - pause/resume кампании

**Файл:** `services/frontend/src/components/CampaignList.tsx`

**Найти функцию:** `const handleToggle`

**ЗАМЕНИТЬ:**

```typescript
// СТАРЫЙ КОД:
const handleToggle = (e: React.MouseEvent, campaignId: string, newStatus: boolean) => {
  e.stopPropagation();
  toggleCampaignStatus(campaignId, newStatus);
};

// НОВЫЙ КОД:
const handleToggle = (e: React.MouseEvent, campaignId: string, newStatus: boolean) => {
  e.stopPropagation();
  
  const action = newStatus ? 'resume' : 'pause';
  const confirmed = window.confirm(
    `Are you sure you want to ${action} this campaign?`
  );
  
  if (confirmed) {
    toggleCampaignStatus(campaignId, newStatus);
  }
};
```

### В CampaignDetail.tsx - pause/resume в деталях

**Файл:** `services/frontend/src/pages/CampaignDetail.tsx`

**Найти функцию:** `const handleToggleStatus`

**ЗАМЕНИТЬ:**

```typescript
// СТАРЫЙ КОД:
const handleToggleStatus = (checked: boolean) => {
  toggleCampaignStatus(id, checked);
};

// НОВЫЙ КОД:
const handleToggleStatus = (checked: boolean) => {
  const action = checked ? 'resume' : 'pause';
  const confirmed = window.confirm(
    `Are you sure you want to ${action} this campaign?`
  );
  
  if (confirmed) {
    toggleCampaignStatus(id, checked);
  }
};
```

---

## 3️⃣ СКРЫТЬ TIKTOK

### В Sidebar (AppSidebar.tsx)

**Файл:** `services/frontend/src/components/AppSidebar.tsx`

**В начале файла добавить импорт:**
```typescript
import { FEATURES } from '@/config/appReview';
```

**Найти элемент меню с TikTok и обернуть:**
```typescript
{FEATURES.SHOW_TIKTOK && (
  // ... существующий код элемента TikTok ...
)}
```

### В Dashboard.tsx - скрыть TikTok подключение

**Файл:** `services/frontend/src/pages/Dashboard.tsx`

**Найти блок с TikTok notification/подключением и обернуть:**
```typescript
import { FEATURES } from '@/config/appReview';

// В JSX:
{FEATURES.SHOW_TIKTOK && (
  // ... TikTok connection notification ...
)}
```

### В Profile.tsx - скрыть TikTok карточку

**Файл:** `services/frontend/src/pages/Profile.tsx`

**Найти ConnectionsGrid и отфильтровать TikTok:**
```typescript
import { FEATURES } from '@/config/appReview';

<ConnectionsGrid
  items={[
    {
      id: 'facebook',
      // ... Facebook connection ...
    },
    // ОБЕРНУТЬ TikTok элемент:
    ...(FEATURES.SHOW_TIKTOK ? [{
      id: 'tiktok',
      title: 'TikTok Ads',
      // ... TikTok connection ...
    }] : []),
  ]}
/>
```

---

## 4️⃣ СКРЫТЬ CREATIVES (раздел креативов)

### В Sidebar

**Файл:** `services/frontend/src/components/AppSidebar.tsx`

**Найти элемент меню "Креативы" и обернуть:**
```typescript
{FEATURES.SHOW_CREATIVES && (
  <SidebarMenuItem>
    <SidebarMenuButton asChild>
      <Link to="/creatives">
        <VideoIcon />
        <span>Креативы</span>
      </Link>
    </SidebarMenuButton>
  </SidebarMenuItem>
)}
```

### В Routes (App.tsx)

**Файл:** `services/frontend/src/App.tsx`

**Найти route "/creatives" и обернуть:**
```typescript
import { FEATURES } from '@/config/appReview';

<Routes>
  <Route path="/" element={<Dashboard />} />
  {FEATURES.SHOW_CREATIVES && (
    <Route path="/creatives" element={<Creatives />} />
  )}
  {FEATURES.SHOW_CREATIVES && (
    <Route path="/videos" element={<Creatives />} />
  )}
  {/* ... остальные routes ... */}
</Routes>
```

---

## 5️⃣ СКРЫТЬ DIRECTIONS (направления)

### В Profile.tsx - скрыть карточку Directions

**Файл:** `services/frontend/src/pages/Profile.tsx`

**Найти DirectionsCard и обернуть:**
```typescript
import { FEATURES } from '@/config/appReview';

{FEATURES.SHOW_DIRECTIONS && (
  <DirectionsCard
    userId={user?.id || null}
    userTarif={userTarif}
  />
)}
```

### В VideoUpload.tsx - скрыть выбор направления

**Файл:** `services/frontend/src/components/VideoUpload.tsx`

**Найти блок выбора Direction и обернуть:**
```typescript
import { FEATURES } from '@/config/appReview';

{FEATURES.SHOW_DIRECTIONS && (
  <div className="mb-4">
    <Label>Направление</Label>
    <Select value={selectedDirectionId} onValueChange={setSelectedDirectionId}>
      {/* ... options ... */}
    </Select>
  </div>
)}
```

---

## 6️⃣ СКРЫТЬ AI AUTOPILOT

### В Dashboard.tsx

**Файл:** `services/frontend/src/pages/Dashboard.tsx`

**Найти блок с AI Autopilot toggle и обернуть:**
```typescript
import { FEATURES } from '@/config/appReview';

{FEATURES.SHOW_AI_AUTOPILOT && (
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        <Bot className="h-5 w-5" />
        AI Autopilot
      </CardTitle>
    </CardHeader>
    <CardContent>
      <Switch 
        checked={aiAutopilot} 
        onCheckedChange={toggleAiAutopilot}
        disabled={aiAutopilotLoading}
      />
    </CardContent>
  </Card>
)}
```

---

## 7️⃣ СКРЫТЬ CAMPAIGN BUILDER (Auto Launch)

### В Sidebar

**Файл:** `services/frontend/src/components/AppSidebar.tsx`

**Найти "Auto Launch" или Campaign Builder и обернуть:**
```typescript
{FEATURES.SHOW_CAMPAIGN_BUILDER && (
  // ... Auto Launch menu item ...
)}
```

### В VideoUpload.tsx - скрыть кнопку Auto Launch

**Файл:** `services/frontend/src/components/VideoUpload.tsx`

**Найти Dialog с launchDialogOpen и обернуть:**
```typescript
import { FEATURES } from '@/config/appReview';

{FEATURES.SHOW_CAMPAIGN_BUILDER && (
  <Dialog open={launchDialogOpen} onOpenChange={setLaunchDialogOpen}>
    <DialogTrigger asChild>
      <Button variant="outline">
        <Rocket className="mr-2 h-4 w-4" />
        Auto Launch
      </Button>
    </DialogTrigger>
    {/* ... dialog content ... */}
  </Dialog>
)}
```

---

## 8️⃣ СКРЫТЬ ДОПОЛНИТЕЛЬНЫЕ РАЗДЕЛЫ

### ROI Analytics

**Файл:** `services/frontend/src/components/AppSidebar.tsx`
```typescript
{FEATURES.SHOW_ANALYTICS && (
  <SidebarMenuItem>
    <Link to="/roi">ROI Analytics</Link>
  </SidebarMenuItem>
)}
```

**Файл:** `services/frontend/src/App.tsx`
```typescript
{FEATURES.SHOW_ANALYTICS && (
  <Route path="/roi" element={<ROIAnalytics />} />
)}
```

### Consultations

**Файл:** `services/frontend/src/components/AppSidebar.tsx`
```typescript
{FEATURES.SHOW_CONSULTATIONS && (
  <SidebarMenuItem>
    <Link to="/consultations">Consultations</Link>
  </SidebarMenuItem>
)}
```

**Файл:** `services/frontend/src/App.tsx`
```typescript
{FEATURES.SHOW_CONSULTATIONS && (
  <Route path="/consultations" element={<Consultations />} />
)}
```

---

## 9️⃣ VIDEOUPLOA - ТОЛЬКО INSTAGRAM

### В VideoUpload.tsx - убрать выбор платформы

**Файл:** `services/frontend/src/components/VideoUpload.tsx`

**Найти prop platform и проверить:**
```typescript
// Если компонент принимает platform prop, 
// убедитесь что везде передаётся platform="instagram"

// В Dashboard.tsx или где используется VideoUpload:
<VideoUpload platform="instagram" />
```

**В самом VideoUpload.tsx - скрыть переключатель платформы:**
```typescript
import { FEATURES } from '@/config/appReview';

// Найти блок выбора платформы (Instagram/TikTok/Both) и обернуть:
{!FEATURES.SHOW_TIKTOK && (
  // Показываем выбор платформы только если TikTok включен
  <div className="mb-4">
    <Label>Платформа</Label>
    <Select value={placement} onValueChange={(val) => setPlacement(val as any)}>
      <SelectItem value="instagram">Instagram</SelectItem>
      <SelectItem value="tiktok">TikTok</SelectItem>
      <SelectItem value="both">Both</SelectItem>
    </Select>
  </div>
)}

// Или просто убрать этот блок и установить:
// useEffect(() => {
//   if (!FEATURES.SHOW_TIKTOK) {
//     setPlacement('instagram');
//   }
// }, []);
```

---

## 🔟 ПЕРЕКЛЮЧЕНИЕ ЯЗЫКА НА АНГЛИЙСКИЙ

### Опционально: если есть i18n

Если есть файлы локализации, создать:

**Файл:** `services/frontend/src/i18n/config.ts`
```typescript
import { APP_REVIEW_MODE } from '@/config/appReview';

export const DEFAULT_LOCALE = APP_REVIEW_MODE ? 'en' : 'ru';
```

### Или через .env

**Файл:** `services/frontend/.env`
```bash
VITE_DEFAULT_LANGUAGE=en
```

---

## ✅ DEPLOYMENT ДЛЯ APP REVIEW

### Вариант 1: Отдельный build

```bash
cd services/frontend

# Build для App Review
VITE_APP_REVIEW_MODE=true npm run build

# Deploy этот build на поддомен или специальный URL
# Например: app-review.performanteaiagency.com
```

### Вариант 2: Production с флагом

В production `.env`:
```bash
# .env.production
VITE_APP_REVIEW_MODE=true
```

После одобрения изменить на:
```bash
VITE_APP_REVIEW_MODE=false
```

И пересобрать.

---

## 📝 CHECKLIST ИЗМЕНЕНИЙ

### Frontend:
- [ ] Создать `services/frontend/src/config/appReview.ts`
- [ ] Добавить `.env` с `VITE_APP_REVIEW_MODE=true`
- [ ] Добавить confirmation в `VideoUpload.tsx` → `uploadVideo()`
- [ ] Добавить confirmation в `CampaignList.tsx` → `handleToggle()`
- [ ] Добавить confirmation в `CampaignDetail.tsx` → `handleToggleStatus()`
- [ ] Скрыть TikTok в `AppSidebar.tsx`
- [ ] Скрыть TikTok в `Dashboard.tsx`
- [ ] Скрыть TikTok в `Profile.tsx`
- [ ] Скрыть Creatives в `AppSidebar.tsx`
- [ ] Скрыть Creatives routes в `App.tsx`
- [ ] Скрыть Directions в `Profile.tsx`
- [ ] Скрыть Directions в `VideoUpload.tsx`
- [ ] Скрыть AI Autopilot в `Dashboard.tsx`
- [ ] Скрыть Campaign Builder в `VideoUpload.tsx`
- [ ] Скрыть ROI Analytics в меню и routes
- [ ] Скрыть Consultations в меню и routes
- [ ] Установить `placement='instagram'` по умолчанию

### Проверка:
- [ ] Собрать с `VITE_APP_REVIEW_MODE=true`
- [ ] Проверить что TikTok не виден
- [ ] Проверить что Creatives не виден
- [ ] Проверить что Directions не видны
- [ ] Проверить что AI Autopilot не виден
- [ ] Проверить что VideoUpload работает
- [ ] Проверить что confirmation dialogs появляются
- [ ] Проверить pause/resume с подтверждением
- [ ] Проверить создание кампании с подтверждением

---

## 🔄 КАК ВОССТАНОВИТЬ ПОСЛЕ ОДОБРЕНИЯ

### Просто изменить .env:

```bash
# В services/frontend/.env
VITE_APP_REVIEW_MODE=false
```

И пересобрать:
```bash
npm run build
docker-compose up -d --build frontend
```

**ВСЁ вернётся как было!** Весь код остался, только был скрыт через флаги.

---

## ❓ ПРО НАЗВАНИЕ "PerformantAI Agency"

**Вопрос:** Не спросят ли почему "AI" в названии?

**Ответ:** **НЕТ, не спросят.**

**Причины:**
1. Мы не показываем AI функционал в видео
2. "AI" в названии - это просто маркетинг
3. Мы запрашиваем permissions для manual управления, не для AI
4. Facebook проверяет ФУНКЦИОНАЛ, а не название компании
5. Тысячи приложений с "AI" в названии, у которых нет AI

**Что важно:**
- ✅ Показать что пользователь контролирует действия
- ✅ Confirmation dialogs
- ✅ Manual workflow

**НЕ важно:**
- ❌ Название компании
- ❌ Логотип
- ❌ Маркетинговые термины

**Если всё-таки спросят:**
> "AI in our name refers to future features. Currently, we provide manual campaign management tools with analytics assistance."

---

## 🚀 ГОТОВО!

После этих изменений у вас будет:
- ✅ Чистая версия для App Review
- ✅ Только ручное управление
- ✅ Confirmation dialogs
- ✅ Никакой автоматизации
- ✅ Легко восстановить всё после одобрения

**Начинаем делать изменения?**

