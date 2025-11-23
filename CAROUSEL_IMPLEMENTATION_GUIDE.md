# 🎨 Руководство по завершению функционала Каруселей

## ✅ Что уже готово (100%)

### Backend (Полностью завершен)

1. **База данных:**
   - ✅ Миграция `migrations/036_add_carousel_support.sql` применена
   - ✅ Таблица `generated_creatives` поддерживает `creative_type: 'carousel'`
   - ✅ JSONB поле `carousel_data` для хранения карточек

2. **API Endpoints (порт 8085):**
   ```
   POST /generate-carousel-texts       - Генерация текстов для N карточек
   POST /regenerate-carousel-card-text - Перегенерация текста одной карточки
   POST /generate-carousel             - Генерация всех изображений
   POST /regenerate-carousel-card      - Перегенерация одной карточки
   POST /upscale-carousel-to-4k        - Upscale всех карточек до 4K
   ```

3. **Сервисы:**
   - ✅ `carouselTextGenerator.ts` - генерация связанных текстов через GPT-4o-mini
   - ✅ `carouselPromptGenerator.ts` - создание промптов для Gemini (премиальный минимализм)
   - ✅ `gemini-carousel.ts` - генерация изображений с консистентностью стиля
     - Стратегия: 1-я картинка → 2-я (с 1-й как референс) → остальные (со 2-й как референс)

### Frontend (API слой готов)

1. **Типы:**
   - ✅ `services/frontend/src/types/carousel.ts` - все интерфейсы

2. **API сервис:**
   - ✅ `services/frontend/src/services/carouselApi.ts` - все методы для работы с backend

---

## 🚧 Что нужно завершить (Frontend UI)

### Шаг 1: Рефакторинг главной страницы с вкладками

**Файл:** `services/frontend/src/pages/CreativeGeneration.tsx`

**Задача:** Обернуть текущий контент вкладками и вынести логику картинок в отдельный компонент.

#### Примерная структура:

```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ImageTab } from "@/components/creatives/ImageTab"
import { CarouselTab } from "@/components/creatives/CarouselTab"
import { VideoScriptsTab } from "@/components/creatives/VideoScriptsTab"

const CreativeGeneration = () => {
  const [userId, setUserId] = useState<string | null>(null);
  const [creativeGenerationsAvailable, setCreativeGenerationsAvailable] = useState(0);
  const { directions } = useDirections(userId);

  // Общие данные для всех вкладок
  const sharedProps = {
    userId,
    creativeGenerationsAvailable,
    setCreativeGenerationsAvailable,
    directions
  };

  return (
    <div className="flex flex-col h-screen">
      <Header />
      <PageHero
        title="Генерация креативов"
        description="Создавайте профессиональные креативы с помощью AI"
      />

      <div className="flex-1 overflow-auto p-6">
        <Tabs defaultValue="images" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="images">Картинки</TabsTrigger>
            <TabsTrigger value="carousels">Карусели</TabsTrigger>
            <TabsTrigger value="video-scripts">Видео-сценарии</TabsTrigger>
          </TabsList>

          <TabsContent value="images">
            <ImageTab {...sharedProps} />
          </TabsContent>

          <TabsContent value="carousels">
            <CarouselTab {...sharedProps} />
          </TabsContent>

          <TabsContent value="video-scripts">
            <VideoScriptsTab {...sharedProps} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};
```

---

### Шаг 2: Создание компонента ImageTab

**Файл:** `services/frontend/src/components/creatives/ImageTab.tsx`

**Задача:** Вынести весь текущий функционал генерации картинок из `CreativeGeneration.tsx` в отдельный компонент.

**Что перенести:**
- Весь state для генерации картинок
- Все функции (`generateText`, `generateCreative`, `downloadImage`, и т.д.)
- Весь JSX для генерации картинок

**Пример структуры:**
```tsx
interface ImageTabProps {
  userId: string | null;
  creativeGenerationsAvailable: number;
  setCreativeGenerationsAvailable: (value: number) => void;
  directions: any[];
}

export const ImageTab: React.FC<ImageTabProps> = ({
  userId,
  creativeGenerationsAvailable,
  setCreativeGenerationsAvailable,
  directions
}) => {
  // Весь state и логика из текущего CreativeGeneration.tsx
  // ...

  return (
    <div className="space-y-6">
      {/* Весь текущий UI для генерации картинок */}
    </div>
  );
};
```

---

### Шаг 3: Создание компонента CarouselTab (Основная работа)

**Файл:** `services/frontend/src/components/creatives/CarouselTab.tsx`

**UI Flow:**

#### 3.1. Шаг 1: Ввод идеи и выбор количества

```tsx
<Card>
  <CardHeader>
    <CardTitle>Шаг 1: Опишите идею карусели</CardTitle>
  </CardHeader>
  <CardContent className="space-y-4">
    <div>
      <Label>Идея карусели</Label>
      <Textarea
        value={carouselIdea}
        onChange={(e) => setCarouselIdea(e.target.value)}
        placeholder="Опишите, какую историю должна рассказать карусель..."
        rows={4}
      />
    </div>

    <div>
      <Label>Количество карточек</Label>
      <Select value={cardsCount.toString()} onValueChange={(v) => setCardsCount(Number(v))}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {[2,3,4,5,6,7,8,9,10].map(n => (
            <SelectItem key={n} value={n.toString()}>{n} карточек</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>

    <Button
      onClick={handleGenerateTexts}
      disabled={!carouselIdea || isGeneratingTexts}
    >
      {isGeneratingTexts && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      Сгенерировать тексты
    </Button>
  </CardContent>
</Card>
```

#### 3.2. Шаг 2: Редактирование текстов карточек

Горизонтальная карусель с текстовыми карточками (как на скриншоте):

```tsx
{carouselCards.length > 0 && (
  <Card>
    <CardHeader>
      <CardTitle>Шаг 2: Редактирование текстов ({currentCardIndex + 1}/{carouselCards.length})</CardTitle>
    </CardHeader>
    <CardContent>
      {/* Горизонтальная навигация */}
      <div className="flex items-center gap-4 mb-4">
        <Button
          size="sm"
          onClick={() => setCurrentCardIndex(Math.max(0, currentCardIndex - 1))}
          disabled={currentCardIndex === 0}
        >
          ← Предыдущая
        </Button>

        <div className="flex-1 flex gap-2 justify-center">
          {carouselCards.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrentCardIndex(i)}
              className={`w-3 h-3 rounded-full ${i === currentCardIndex ? 'bg-primary' : 'bg-gray-300'}`}
            />
          ))}
        </div>

        <Button
          size="sm"
          onClick={() => setCurrentCardIndex(Math.min(carouselCards.length - 1, currentCardIndex + 1))}
          disabled={currentCardIndex === carouselCards.length - 1}
        >
          Следующая →
        </Button>
      </div>

      {/* Текущая карточка */}
      <div className="space-y-4 border rounded-lg p-6">
        <div>
          <div className="flex justify-between items-center mb-2">
            <Label>Текст карточки {currentCardIndex + 1}</Label>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleRegenerateCardText(currentCardIndex)}
              disabled={isRegeneratingText}
            >
              <Sparkles className="h-4 w-4 mr-2" />
              Перегенерировать
            </Button>
          </div>
          <Textarea
            value={carouselCards[currentCardIndex].text}
            onChange={(e) => updateCardText(currentCardIndex, e.target.value)}
            rows={3}
          />
        </div>

        <div>
          <Label>Дополнительный промпт (опционально)</Label>
          <Input
            value={carouselCards[currentCardIndex].custom_prompt || ''}
            onChange={(e) => updateCardCustomPrompt(currentCardIndex, e.target.value)}
            placeholder="Например: добавь больше контраста..."
          />
        </div>

        <div>
          <Label>Референсное изображение (опционально)</Label>
          <Input
            type="file"
            accept="image/*"
            onChange={(e) => handleReferenceImageUpload(currentCardIndex, e)}
          />
          {carouselCards[currentCardIndex].reference_image && (
            <div className="mt-2">
              <img
                src={carouselCards[currentCardIndex].reference_image}
                alt="Reference"
                className="h-20 rounded"
              />
            </div>
          )}
        </div>
      </div>
    </CardContent>
  </Card>
)}
```

#### 3.3. Шаг 3: Генерация карусели

```tsx
{carouselCards.length > 0 && !generatedCarouselId && (
  <Card>
    <CardHeader>
      <CardTitle>Шаг 3: Генерация карусели</CardTitle>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="flex items-center gap-4">
        <Badge variant="secondary">
          Стоимость: {carouselCards.length} генераций
        </Badge>
        <Badge>
          Доступно: {creativeGenerationsAvailable}
        </Badge>
      </div>

      {isGeneratingCarousel && (
        <div className="space-y-2">
          <div className="text-sm text-gray-600">
            Генерируется карточка {currentGeneratingCard + 1} из {carouselCards.length}...
          </div>
          <Progress value={(currentGeneratingCard / carouselCards.length) * 100} />
        </div>
      )}

      <Button
        onClick={handleGenerateCarousel}
        disabled={isGeneratingCarousel || creativeGenerationsAvailable < carouselCards.length}
        className="w-full"
      >
        {isGeneratingCarousel ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Генерация карусели...
          </>
        ) : (
          <>
            <ImageIcon className="mr-2 h-4 w-4" />
            Сгенерировать карусель
          </>
        )}
      </Button>
    </CardContent>
  </Card>
)}
```

#### 3.4. Шаг 4: Preview и действия

```tsx
{generatedCarouselId && carouselCards.every(c => c.image_url) && (
  <Card>
    <CardHeader>
      <CardTitle>Preview карусели</CardTitle>
    </CardHeader>
    <CardContent className="space-y-4">
      {/* Горизонтальная карусель */}
      <div className="relative">
        <div className="overflow-x-auto flex gap-4 pb-4 snap-x snap-mandatory">
          {carouselCards.map((card, i) => (
            <div key={i} className="flex-shrink-0 snap-center">
              <div className="w-[300px] space-y-2">
                <img
                  src={card.image_url}
                  alt={`Card ${i + 1}`}
                  className="w-full aspect-[9/16] object-cover rounded-lg cursor-pointer hover:opacity-90"
                  onClick={() => openFullscreen(i)}
                />
                <div className="text-sm text-gray-600 line-clamp-2">
                  {card.text}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Кнопки действий */}
      <div className="flex gap-2">
        <Button onClick={handleDownloadAll}>
          <Download className="mr-2 h-4 w-4" />
          Скачать все
        </Button>

        {/* Direction selector + Create button */}
        <div className="flex gap-2 flex-1">
          <Select value={selectedDirectionId} onValueChange={setSelectedDirectionId}>
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Выберите направление" />
            </SelectTrigger>
            <SelectContent>
              {directions.map(d => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            onClick={handleCreateCarouselCreative}
            disabled={!selectedDirectionId || isCreatingCreative}
          >
            {isCreatingCreative && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Создать креатив
          </Button>
        </div>
      </div>
    </CardContent>
  </Card>
)}
```

---

### Шаг 4: Основные функции CarouselTab

```typescript
const handleGenerateTexts = async () => {
  if (!userId || !carouselIdea) return;

  setIsGeneratingTexts(true);
  try {
    const response = await carouselApi.generateTexts({
      user_id: userId,
      carousel_idea: carouselIdea,
      cards_count: cardsCount
    });

    if (response.success && response.texts) {
      setCarouselCards(response.texts.map((text, i) => ({
        order: i,
        text,
        custom_prompt: '',
        reference_image: undefined
      })));
      toast.success(`Сгенерировано ${response.texts.length} текстов`);
    } else {
      toast.error(response.error || 'Ошибка генерации текстов');
    }
  } catch (error) {
    toast.error('Ошибка при генерации текстов');
  } finally {
    setIsGeneratingTexts(false);
  }
};

const handleGenerateCarousel = async () => {
  if (!userId) return;

  setIsGeneratingCarousel(true);
  setCurrentGeneratingCard(0);

  try {
    // Подготовка данных
    const texts = carouselCards.map(c => c.text);
    const customPrompts = carouselCards.map(c => c.custom_prompt || null);
    const referenceImages = carouselCards.map(c => c.reference_image || null);

    const response = await carouselApi.generateCarousel({
      user_id: userId,
      carousel_texts: texts,
      custom_prompts: customPrompts,
      reference_images: referenceImages,
      direction_id: selectedDirectionId
    });

    if (response.success && response.carousel_data) {
      setGeneratedCarouselId(response.carousel_id!);
      setCarouselCards(response.carousel_data);
      setCreativeGenerationsAvailable(response.generations_remaining!);
      toast.success('Карусель успешно сгенерирована!');
    } else {
      toast.error(response.error || 'Ошибка генерации карусели');
    }
  } catch (error) {
    toast.error('Ошибка при генерации карусели');
  } finally {
    setIsGeneratingCarousel(false);
  }
};

const handleDownloadAll = async () => {
  if (!userId || !generatedCarouselId) return;

  // Upscale до 4K
  const response = await carouselApi.upscaleToThe4K({
    user_id: userId,
    carousel_id: generatedCarouselId
  });

  if (response.success && response.carousel_data) {
    // Скачать все картинки
    for (const card of response.carousel_data) {
      if (card.image_url_4k) {
        const link = document.createElement('a');
        link.href = card.image_url_4k;
        link.download = `carousel_card_${card.order + 1}_4k.png`;
        link.click();
      }
    }
    toast.success('Все картинки скачаны!');
  }
};

const handleCreateCarouselCreative = async () => {
  // TODO: Интеграция с Facebook API для carousel_ad
  // Нужно обновить creativesApi.uploadToWebhook() для поддержки каруселей
  toast.info('Функция в разработке');
};
```

---

### Шаг 5: Заглушка VideoScriptsTab

**Файл:** `services/frontend/src/components/creatives/VideoScriptsTab.tsx`

```tsx
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Video } from 'lucide-react';

export const VideoScriptsTab = () => {
  return (
    <div className="flex items-center justify-center h-[60vh]">
      <Card className="max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center">
            <Video className="h-8 w-8 text-gray-400" />
          </div>
          <CardTitle>Видео-сценарии</CardTitle>
          <CardDescription>
            Генерация текстов и сценариев для видео-креативов
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center text-sm text-gray-500">
          Эта функция будет доступна в следующем обновлении
        </CardContent>
      </Card>
    </div>
  );
};
```

---

## 📝 Необходимые дополнительные компоненты

### Progress component (если нет)

```tsx
// components/ui/progress.tsx
import * as React from "react"

interface ProgressProps {
  value: number;
  className?: string;
}

export const Progress: React.FC<ProgressProps> = ({ value, className }) => {
  return (
    <div className={`w-full bg-gray-200 rounded-full h-2 ${className}`}>
      <div
        className="bg-primary h-2 rounded-full transition-all"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
};
```

---

## 🔧 Интеграция с Facebook (TODO)

После завершения UI нужно обновить `creativesApi.uploadToWebhook()` для поддержки каруселей:

```typescript
// Добавить в creativesApi.ts:

async uploadCarouselToWebhook(
  carouselId: string,
  directionId: string,
  userId: string
): Promise<void> {
  // 1. Получить carousel_data из generated_creatives
  // 2. Upscale все картинки до 4K
  // 3. Изучить Facebook Marketing API для carousel_ad:
  //    https://developers.facebook.com/docs/marketing-api/carousel-ads
  // 4. Создать carousel creative в Facebook
  // 5. Создать запись в user_creatives с fb_creative_id
}
```

---

## 🎯 Приоритеты

1. **Высокий:** Базовый flow (ввод идеи → генерация текстов → генерация картинок → preview)
2. **Средний:** Редактирование текстов, кастомные промпты, референсные изображения
3. **Низкий:** Fullscreen preview, drag-n-drop переупорядочивание

---

## ✅ Чеклист завершения

- [ ] Создать ImageTab компонент
- [ ] Создать CarouselTab компонент с базовым flow
- [ ] Создать VideoScriptsTab заглушку
- [ ] Обновить CreativeGeneration.tsx с Tabs
- [ ] Протестировать генерацию текстов
- [ ] Протестировать генерацию карусели
- [ ] Добавить скачивание всех картинок
- [ ] Интеграция с Facebook API
- [ ] Финальное тестирование

---

**Документация создана:** Claude Code
**Backend готов на 100%, Frontend API готов, UI требует реализации**
