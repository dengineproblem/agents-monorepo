import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sparkles, Loader2, ImageIcon, Download, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { carouselApi } from '@/services/carouselApi';
import type { CarouselCard } from '@/types/carousel';

interface CarouselTabProps {
  userId: string | null;
  creativeGenerationsAvailable: number;
  setCreativeGenerationsAvailable: (value: number) => void;
  directions: any[];
}

export const CarouselTab: React.FC<CarouselTabProps> = ({
  userId,
  creativeGenerationsAvailable,
  setCreativeGenerationsAvailable,
  directions
}) => {
  // State для шага 1: Ввод идеи
  const [carouselIdea, setCarouselIdea] = useState('');
  const [cardsCount, setCardsCount] = useState(3);
  const [isGeneratingTexts, setIsGeneratingTexts] = useState(false);

  // State для шага 2: Карточки с текстами
  const [carouselCards, setCarouselCards] = useState<CarouselCard[]>([]);
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [isRegeneratingText, setIsRegeneratingText] = useState(false);

  // State для шага 3: Генерация изображений
  const [isGeneratingCarousel, setIsGeneratingCarousel] = useState(false);
  const [generatedCarouselId, setGeneratedCarouselId] = useState('');

  // State для шага 4: Создание креатива
  const [selectedDirectionId, setSelectedDirectionId] = useState('');
  const [isCreatingCreative, setIsCreatingCreative] = useState(false);

  // State для перегенерации отдельной карточки
  const [regeneratingCardIndex, setRegeneratingCardIndex] = useState<number | null>(null);
  const [cardRegenerationPrompts, setCardRegenerationPrompts] = useState<{[key: number]: string}>({});
  const [cardRegenerationImages, setCardRegenerationImages] = useState<{[key: number]: string}>({});

  // Генерация текстов для карточек
  const handleGenerateTexts = async () => {
    if (!userId || !carouselIdea) {
      toast.error('Введите идею карусели');
      return;
    }

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
        setCurrentCardIndex(0);
        toast.success(`Сгенерировано ${response.texts.length} текстов`);
      } else {
        toast.error(response.error || 'Ошибка генерации текстов');
      }
    } catch (error) {
      console.error('Error generating texts:', error);
      toast.error('Ошибка при генерации текстов');
    } finally {
      setIsGeneratingTexts(false);
    }
  };

  // Обновление текста карточки
  const updateCardText = (index: number, text: string) => {
    const updated = [...carouselCards];
    updated[index].text = text;
    setCarouselCards(updated);
  };

  // Обновление кастомного промпта карточки
  const updateCardCustomPrompt = (index: number, prompt: string) => {
    const updated = [...carouselCards];
    updated[index].custom_prompt = prompt;
    setCarouselCards(updated);
  };

  // Upload референсного изображения
  const handleReferenceImageUpload = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      const base64Data = base64.split(',')[1]; // Убираем data:image/...;base64,

      const updated = [...carouselCards];
      updated[index].reference_image = base64Data;
      setCarouselCards(updated);
      toast.success('Изображение загружено');
    };
    reader.readAsDataURL(file);
  };

  // Перегенерация текста одной карточки
  const handleRegenerateCardText = async (index: number) => {
    if (!userId || !carouselCards.length) return;

    setIsRegeneratingText(true);
    try {
      const existingTexts = carouselCards.map(c => c.text);

      const response = await carouselApi.regenerateCardText({
        user_id: userId,
        carousel_id: generatedCarouselId || 'temp',
        card_index: index,
        existing_texts: existingTexts
      });

      if (response.success && response.text) {
        updateCardText(index, response.text);
        toast.success('Текст перегенерирован');
      } else {
        toast.error(response.error || 'Ошибка перегенерации');
      }
    } catch (error) {
      console.error('Error regenerating text:', error);
      toast.error('Ошибка при перегенерации текста');
    } finally {
      setIsRegeneratingText(false);
    }
  };

  // Генерация карусели (всех изображений)
  const handleGenerateCarousel = async () => {
    if (!userId) return;

    if (creativeGenerationsAvailable < carouselCards.length) {
      toast.error(`Недостаточно генераций. Нужно ${carouselCards.length}, доступно ${creativeGenerationsAvailable}`);
      return;
    }

    setIsGeneratingCarousel(true);
    try {
      const texts = carouselCards.map(c => c.text);
      const customPrompts = carouselCards.map(c => c.custom_prompt || null);
      const referenceImages = carouselCards.map(c => c.reference_image || null);

      const response = await carouselApi.generateCarousel({
        user_id: userId,
        carousel_texts: texts,
        custom_prompts: customPrompts,
        reference_images: referenceImages,
        direction_id: selectedDirectionId || undefined
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
      console.error('Error generating carousel:', error);
      toast.error('Ошибка при генерации карусели');
    } finally {
      setIsGeneratingCarousel(false);
    }
  };

  // Перегенерация отдельной карточки
  const handleRegenerateCard = async (cardIndex: number) => {
    if (!userId || !generatedCarouselId) return;

    setRegeneratingCardIndex(cardIndex);
    try {
      const customPrompt = cardRegenerationPrompts[cardIndex] || undefined;
      const referenceImage = cardRegenerationImages[cardIndex] || undefined;

      const response = await carouselApi.regenerateCard({
        user_id: userId,
        carousel_id: generatedCarouselId,
        card_index: cardIndex,
        custom_prompt: customPrompt,
        reference_image: referenceImage
      });

      if (response.success && response.card_data) {
        // Обновляем конкретную карточку
        const updatedCards = [...carouselCards];
        updatedCards[cardIndex] = response.card_data;
        setCarouselCards(updatedCards);

        // Обновляем доступные генерации
        if (response.generations_remaining !== undefined) {
          setCreativeGenerationsAvailable(response.generations_remaining);
        }

        // Очищаем промпт и изображение после успешной регенерации
        const newPrompts = {...cardRegenerationPrompts};
        delete newPrompts[cardIndex];
        setCardRegenerationPrompts(newPrompts);

        const newImages = {...cardRegenerationImages};
        delete newImages[cardIndex];
        setCardRegenerationImages(newImages);

        toast.success(`Карточка ${cardIndex + 1} перегенерирована!`);
      } else {
        toast.error(response.error || 'Ошибка перегенерации карточки');
      }
    } catch (error) {
      console.error('Error regenerating card:', error);
      toast.error('Ошибка при перегенерации карточки');
    } finally {
      setRegeneratingCardIndex(null);
    }
  };

  // Upload референсного изображения для перегенерации
  const handleCardRegenerationImageUpload = (cardIndex: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      const base64Data = base64.split(',')[1];

      setCardRegenerationImages({
        ...cardRegenerationImages,
        [cardIndex]: base64Data
      });
      toast.success('Референсное изображение загружено');
    };
    reader.readAsDataURL(file);
  };

  // Скачивание всех картинок
  const handleDownloadAll = async () => {
    if (!userId || !generatedCarouselId) return;

    toast.info('Upscale до 4K...');

    try {
      const response = await carouselApi.upscaleToThe4K({
        user_id: userId,
        carousel_id: generatedCarouselId
      });

      if (response.success && response.carousel_data) {
        // Обновляем карточки с 4K URLs
        setCarouselCards(response.carousel_data);

        // Скачиваем все картинки
        for (const card of response.carousel_data) {
          if (card.image_url_4k) {
            const link = document.createElement('a');
            link.href = card.image_url_4k;
            link.download = `carousel_card_${card.order + 1}_4k.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            // Небольшая задержка между скачиваниями
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }

        toast.success('Все картинки скачаны!');
      } else {
        toast.error(response.error || 'Ошибка upscale');
      }
    } catch (error) {
      console.error('Error downloading:', error);
      toast.error('Ошибка при скачивании');
    }
  };

  // Создание креатива (TODO: интеграция с Facebook)
  const handleCreateCreative = () => {
    toast.info('Функция интеграции с Facebook в разработке');
    // TODO: Реализовать загрузку в Facebook как carousel_ad
  };

  // Сброс формы
  const handleReset = () => {
    setCarouselIdea('');
    setCarouselCards([]);
    setGeneratedCarouselId('');
    setCurrentCardIndex(0);
    setSelectedDirectionId('');
  };

  const hasGeneratedImages = carouselCards.length > 0 && carouselCards.every(c => c.image_url);

  return (
    <div className="space-y-6 py-6">
      {/* Ввод идеи карусели */}
      <Card>
        <CardHeader>
          <CardTitle>Идея карусели</CardTitle>
          <CardDescription>
            Введите общую идею, и AI создаст связанный storytelling из нескольких карточек
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="carousel-idea">Идея карусели</Label>
            <Textarea
              id="carousel-idea"
              value={carouselIdea}
              onChange={(e) => setCarouselIdea(e.target.value)}
              placeholder="Например: показать путь клиента от проблемы к решению..."
              rows={4}
              disabled={carouselCards.length > 0}
            />
          </div>

          <div>
            <Label htmlFor="cards-count">Количество карточек</Label>
            <Select
              value={cardsCount.toString()}
              onValueChange={(v) => setCardsCount(Number(v))}
              disabled={carouselCards.length > 0}
            >
              <SelectTrigger id="cards-count">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                  <SelectItem key={n} value={n.toString()}>
                    {n} {n === 1 ? 'карточка' : n < 5 ? 'карточки' : 'карточек'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleGenerateTexts}
              disabled={!carouselIdea || isGeneratingTexts || carouselCards.length > 0}
              className="flex-1"
            >
              {isGeneratingTexts && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Sparkles className="mr-2 h-4 w-4" />
              Сгенерировать тексты
            </Button>

            {carouselCards.length > 0 && (
              <Button variant="outline" onClick={handleReset}>
                Начать заново
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Редактирование карточек */}
      {carouselCards.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              {hasGeneratedImages ? 'Карусель' : 'Редактирование карточек'} ({currentCardIndex + 1}/{carouselCards.length})
            </CardTitle>
            <CardDescription>
              {hasGeneratedImages
                ? 'Просмотрите и отредактируйте готовые карточки карусели'
                : 'Отредактируйте тексты, добавьте кастомные промпты или референсные изображения'
              }
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Карточка с навигацией */}
            <div className="flex items-center justify-center gap-6">
              {/* Кнопка назад */}
              <Button
                size="icon"
                variant="outline"
                onClick={() => setCurrentCardIndex(Math.max(0, currentCardIndex - 1))}
                disabled={currentCardIndex === 0}
                className="flex-shrink-0"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>

              {/* Карточка 4:5 */}
              <div className="w-full max-w-md">
                <div className="space-y-3">
                  {/* Карточка, имитирующая пост 4:5 */}
                  <div className="relative aspect-[4/5] bg-gradient-to-br from-muted/80 to-muted border border-border rounded-lg overflow-hidden">
                    {/* Если есть изображение - показываем его */}
                    {hasGeneratedImages && carouselCards[currentCardIndex].image_url ? (
                      <img
                        src={carouselCards[currentCardIndex].image_url}
                        alt={`Карточка ${currentCardIndex + 1}`}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      /* Иначе показываем текстовое поле */
                      <div className="w-full h-full flex items-center justify-center p-8">
                        <Textarea
                          value={carouselCards[currentCardIndex].text}
                          onChange={(e) => updateCardText(currentCardIndex, e.target.value)}
                          disabled={hasGeneratedImages}
                          className="w-full h-full resize-none bg-transparent border-none text-center text-lg font-medium leading-relaxed focus-visible:ring-0 focus-visible:ring-offset-0"
                          placeholder="Текст карточки..."
                        />
                      </div>
                    )}

                    {/* Бейдж с номером карточки */}
                    <div className="absolute top-3 left-3">
                      <Badge variant="secondary">
                        {currentCardIndex + 1}
                      </Badge>
                    </div>

                    {/* Бейдж хук/CTA */}
                    <div className="absolute top-3 right-3">
                      {currentCardIndex === 0 && <Badge variant="default">Хук</Badge>}
                      {currentCardIndex === carouselCards.length - 1 && <Badge variant="default">CTA</Badge>}
                    </div>
                  </div>

                  {/* Точки-индикаторы под карточкой */}
                  <div className="flex gap-2 justify-center">
                    {carouselCards.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setCurrentCardIndex(i)}
                        className={`w-2 h-2 rounded-full transition-colors ${
                          i === currentCardIndex ? 'bg-primary' : 'bg-muted-foreground/30 hover:bg-muted-foreground/50'
                        }`}
                        title={`Карточка ${i + 1}`}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Кнопка вперед */}
              <Button
                size="icon"
                variant="outline"
                onClick={() => setCurrentCardIndex(Math.min(carouselCards.length - 1, currentCardIndex + 1))}
                disabled={currentCardIndex === carouselCards.length - 1}
                className="flex-shrink-0"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {/* Инструменты редактирования под карточкой */}
            <div className="max-w-md mx-auto space-y-3">
              {hasGeneratedImages ? (
                /* Инструменты для перегенерации изображения */
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleRegenerateCard(currentCardIndex)}
                    disabled={regeneratingCardIndex === currentCardIndex}
                    className="w-full"
                  >
                    {regeneratingCardIndex === currentCardIndex ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-2" />
                    )}
                    Перегенерировать карточку
                  </Button>

                  <div>
                    <Label htmlFor={`regen-prompt-${currentCardIndex}`} className="text-xs">
                      Дополнительный промпт (опционально)
                    </Label>
                    <Input
                      id={`regen-prompt-${currentCardIndex}`}
                      value={cardRegenerationPrompts[currentCardIndex] || ''}
                      onChange={(e) => setCardRegenerationPrompts({
                        ...cardRegenerationPrompts,
                        [currentCardIndex]: e.target.value
                      })}
                      placeholder="Например: добавь больше контраста..."
                      disabled={regeneratingCardIndex === currentCardIndex}
                      className="mt-1"
                    />
                  </div>

                  <div>
                    <Label htmlFor={`regen-image-${currentCardIndex}`} className="text-xs">
                      Референсное изображение (опционально)
                    </Label>
                    <Input
                      id={`regen-image-${currentCardIndex}`}
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleCardRegenerationImageUpload(currentCardIndex, e)}
                      disabled={regeneratingCardIndex === currentCardIndex}
                      className="mt-1"
                    />
                    {cardRegenerationImages[currentCardIndex] && (
                      <p className="text-sm text-green-600 dark:text-green-400 mt-1">✓ Изображение загружено</p>
                    )}
                  </div>
                </>
              ) : (
                /* Инструменты для редактирования текста */
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleRegenerateCardText(currentCardIndex)}
                    disabled={isRegeneratingText}
                    className="w-full"
                  >
                    {isRegeneratingText ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4 mr-2" />
                    )}
                    Перегенерировать текст
                  </Button>

                  <div>
                    <Label htmlFor={`custom-prompt-${currentCardIndex}`} className="text-xs">
                      Дополнительный промпт (опционально)
                    </Label>
                    <Input
                      id={`custom-prompt-${currentCardIndex}`}
                      value={carouselCards[currentCardIndex].custom_prompt || ''}
                      onChange={(e) => updateCardCustomPrompt(currentCardIndex, e.target.value)}
                      placeholder="Например: добавь больше контраста..."
                      className="mt-1"
                    />
                  </div>

                  <div>
                    <Label htmlFor={`reference-image-${currentCardIndex}`} className="text-xs">
                      Референсное изображение (опционально)
                    </Label>
                    <Input
                      id={`reference-image-${currentCardIndex}`}
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleReferenceImageUpload(currentCardIndex, e)}
                      className="mt-1"
                    />
                    {carouselCards[currentCardIndex].reference_image && (
                      <p className="text-sm text-green-600 dark:text-green-400 mt-1">✓ Изображение загружено</p>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Кнопка генерации и действия */}
            {!hasGeneratedImages ? (
              /* Показываем кнопку генерации, если картинок ещё нет */
              <div className="max-w-md mx-auto space-y-4 pt-4 border-t border-border">
                <div className="flex items-center gap-4 justify-center">
                  <Badge variant="secondary">
                    Стоимость: {carouselCards.length} {carouselCards.length === 1 ? 'генерация' : carouselCards.length < 5 ? 'генерации' : 'генераций'}
                  </Badge>
                  <Badge variant={creativeGenerationsAvailable >= carouselCards.length ? "default" : "destructive"}>
                    Доступно: {creativeGenerationsAvailable}
                  </Badge>
                </div>

                <Button
                  onClick={handleGenerateCarousel}
                  disabled={isGeneratingCarousel || creativeGenerationsAvailable < carouselCards.length}
                  className="w-full"
                  size="lg"
                >
                  {isGeneratingCarousel ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Генерация карусели... Это может занять несколько минут
                    </>
                  ) : (
                    <>
                      <ImageIcon className="mr-2 h-5 w-5" />
                      Сгенерировать карусель
                    </>
                  )}
                </Button>
              </div>
            ) : (
              /* Показываем действия после генерации */
              <div className="max-w-md mx-auto space-y-3 pt-4 border-t border-border">
                <Button onClick={handleDownloadAll} variant="outline" className="w-full">
                  <Download className="mr-2 h-4 w-4" />
                  Скачать все (4K)
                </Button>

                <div className="flex gap-2">
                  <Select value={selectedDirectionId} onValueChange={setSelectedDirectionId} disabled={!directions.length}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Выберите направление" />
                    </SelectTrigger>
                    <SelectContent>
                      {directions.map(d => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Button
                    onClick={handleCreateCreative}
                    disabled={!selectedDirectionId || isCreatingCreative}
                  >
                    {isCreatingCreative && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Создать креатив
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};
