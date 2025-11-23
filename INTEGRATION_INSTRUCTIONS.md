# 🔧 Инструкции по интеграции вкладок в CreativeGeneration

## ✅ Что уже создано:

1. **Backend** - полностью готов на 100%
2. **Frontend компоненты:**
   - ✅ [CarouselTab.tsx](services/frontend/src/components/creatives/CarouselTab.tsx) - полный функционал каруселей
   - ✅ [VideoScriptsTab.tsx](services/frontend/src/components/creatives/VideoScriptsTab.tsx) - заглушка
   - ✅ [carouselApi.ts](services/frontend/src/services/carouselApi.ts) - API сервис
   - ✅ [carousel.ts](services/frontend/src/types/carousel.ts) - типы

## 🔨 Что нужно сделать (простой способ):

### Вариант A: Модификация существующего CreativeGeneration.tsx

Обновите файл `services/frontend/src/pages/CreativeGeneration.tsx`:

1. **Добавьте импорты в начало файла:**

```typescript
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CarouselTab } from '@/components/creatives/CarouselTab';
import { VideoScriptsTab } from '@/components/creatives/VideoScriptsTab';
```

2. **Найдите строку с `return (` (около строки 102) и оберните весь контент в Tabs:**

Замените:
```typescript
return (
  <div className="flex flex-col h-screen">
    <Header />
    <PageHero ... />

    <div className="flex-1 overflow-auto">
      <div className="container mx-auto px-4">
        {/* Весь текущий контент генерации картинок */}
      </div>
    </div>
  </div>
);
```

На:
```typescript
return (
  <div className="flex flex-col h-screen">
    <Header />
    <PageHero
      title="Генерация креативов"
      description="Создавайте профессиональные креативы для Instagram с помощью AI"
    />

    <div className="flex-1 overflow-auto">
      <div className="container mx-auto px-4 py-6">
        <Tabs defaultValue="images" className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-6">
            <TabsTrigger value="images">Картинки</TabsTrigger>
            <TabsTrigger value="carousels">Карусели</TabsTrigger>
            <TabsTrigger value="video-scripts">Видео-сценарии</TabsTrigger>
          </TabsList>

          <TabsContent value="images" className="mt-0">
            {/* Весь текущий контент генерации картинок перенести сюда */}
          </TabsContent>

          <TabsContent value="carousels" className="mt-0">
            <CarouselTab
              userId={userId}
              creativeGenerationsAvailable={creativeGenerationsAvailable}
              setCreativeGenerationsAvailable={setCreativeGenerationsAvailable}
              directions={directions}
            />
          </TabsContent>

          <TabsContent value="video-scripts" className="mt-0">
            <VideoScriptsTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  </div>
);
```

### Вариант B: Создание отдельного компонента ImageTab (рекомендуется)

Если хотите более чистую архитектуру:

1. **Создайте** `services/frontend/src/components/creatives/ImageTab.tsx`

2. **Скопируйте** в него всю логику генерации картинок из `CreativeGeneration.tsx` (state, функции, JSX)

3. **Обновите** `CreativeGeneration.tsx` согласно Варианту A, но для вкладки "images" используйте:

```typescript
<TabsContent value="images" className="mt-0">
  <ImageTab
    userId={userId}
    creativeGenerationsAvailable={creativeGenerationsAvailable}
    setCreativeGenerationsAvailable={setCreativeGenerationsAvailable}
    directions={directions}
  />
</TabsContent>
```

---

## 🎯 Быстрый старт (минимальная интеграция):

Если нужно быстро протестировать функционал каруселей **без рефакторинга** существующей страницы:

### 1. Создайте временную страницу для тестирования:

```bash
# Создайте файл services/frontend/src/pages/CarouselTest.tsx
```

```typescript
import React, { useState, useEffect } from 'react';
import Header from '@/components/Header';
import PageHero from '@/components/common/PageHero';
import { CarouselTab } from '@/components/creatives/CarouselTab';
import { supabase } from '@/integrations/supabase/client';
import { useDirections } from '@/hooks/useDirections';

const CarouselTest = () => {
  const [userId, setUserId] = useState<string | null>(null);
  const [creativeGenerationsAvailable, setCreativeGenerationsAvailable] = useState(0);
  const { directions } = useDirections(userId);

  useEffect(() => {
    const fetchUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserId(user.id);

        const { data } = await supabase
          .from('user_accounts')
          .select('creative_generations_available')
          .eq('id', user.id)
          .single();

        if (data) {
          setCreativeGenerationsAvailable(data.creative_generations_available || 0);
        }
      }
    };
    fetchUser();
  }, []);

  return (
    <div className="flex flex-col h-screen">
      <Header />
      <PageHero title="Тест каруселей" description="Тестирование функционала каруселей" />

      <div className="flex-1 overflow-auto">
        <div className="container mx-auto px-4 py-6">
          <CarouselTab
            userId={userId}
            creativeGenerationsAvailable={creativeGenerationsAvailable}
            setCreativeGenerationsAvailable={setCreativeGenerationsAvailable}
            directions={directions}
          />
        </div>
      </div>
    </div>
  );
};

export default CarouselTest;
```

### 2. Добавьте роут в App.tsx:

```typescript
import CarouselTest from './pages/CarouselTest';

// В блоке Routes добавьте:
<Route path="/carousel-test" element={<CarouselTest />} />
```

### 3. Откройте `/carousel-test` в браузере для тестирования

---

## 🚀 Запуск backend:

```bash
cd services/creative-generation-service
npm run dev
```

Backend будет доступен на `http://localhost:8085`

Проверьте endpoints: `http://localhost:8085/`

---

## 🧪 Тестирование flow:

1. Введите идею карусели (например: "Путь клиента от проблемы к решению")
2. Выберите количество карточек (3-5 для начала)
3. Нажмите "Сгенерировать тексты"
4. Отредактируйте тексты при необходимости
5. Нажмите "Сгенерировать карусель"
6. Дождитесь генерации (может занять несколько минут)
7. Просмотрите результат
8. Скачайте картинки или создайте креатив

---

## ⚠️ Известные ограничения:

1. **Facebook интеграция** - кнопка "Создать креатив" показывает уведомление, требуется доработка
2. **Fullscreen preview** - пока не реализован (можно добавить позже)
3. **Drag-n-drop** - переупорядочивание карточек не реализовано (можно добавить позже)

---

## 📝 TODO для production:

- [ ] Интегрировать вкладки в основную страницу CreativeGeneration
- [ ] Добавить fullscreen preview для каруселей
- [ ] Реализовать интеграцию с Facebook carousel_ad API
- [ ] Добавить возможность редактирования порядка карточек (drag-n-drop)
- [ ] Оптимизировать UI/UX на основе feedback
- [ ] Добавить аналитику использования каруселей

---

**Создано:** Claude Code
**Backend готов на 100%**
**Frontend компоненты готовы, требуется интеграция в основную страницу**
