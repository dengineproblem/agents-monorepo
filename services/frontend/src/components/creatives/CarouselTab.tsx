import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sparkles, Loader2, ImageIcon, Download, ChevronLeft, ChevronRight } from 'lucide-react';
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
      {/* Шаг 1: Ввод идеи и выбор количества */}
      <Card>
        <CardHeader>
          <CardTitle>Шаг 1: Опишите идею карусели</CardTitle>
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

      {/* Шаг 2: Редактирование текстов карточек */}
      {carouselCards.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              Шаг 2: Редактирование карточек ({currentCardIndex + 1}/{carouselCards.length})
            </CardTitle>
            <CardDescription>
              Отредактируйте тексты, добавьте кастомные промпты или референсные изображения
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Навигация по карточкам */}
            <div className="flex items-center gap-4">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCurrentCardIndex(Math.max(0, currentCardIndex - 1))}
                disabled={currentCardIndex === 0}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>

              <div className="flex-1 flex gap-2 justify-center">
                {carouselCards.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrentCardIndex(i)}
                    className={`w-3 h-3 rounded-full transition-colors ${
                      i === currentCardIndex ? 'bg-primary' : 'bg-gray-300 hover:bg-gray-400'
                    }`}
                    title={`Карточка ${i + 1}`}
                  />
                ))}
              </div>

              <Button
                size="sm"
                variant="outline"
                onClick={() => setCurrentCardIndex(Math.min(carouselCards.length - 1, currentCardIndex + 1))}
                disabled={currentCardIndex === carouselCards.length - 1}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {/* Текущая карточка */}
            <div className="space-y-4 border rounded-lg p-6 bg-gray-50">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <Label htmlFor={`card-text-${currentCardIndex}`}>
                    Текст карточки {currentCardIndex + 1}
                    {currentCardIndex === 0 && <Badge className="ml-2" variant="secondary">Хук</Badge>}
                    {currentCardIndex === carouselCards.length - 1 && <Badge className="ml-2" variant="secondary">CTA</Badge>}
                  </Label>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleRegenerateCardText(currentCardIndex)}
                    disabled={isRegeneratingText || hasGeneratedImages}
                  >
                    {isRegeneratingText ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4 mr-2" />
                    )}
                    Перегенерировать
                  </Button>
                </div>
                <Textarea
                  id={`card-text-${currentCardIndex}`}
                  value={carouselCards[currentCardIndex].text}
                  onChange={(e) => updateCardText(currentCardIndex, e.target.value)}
                  rows={3}
                  disabled={hasGeneratedImages}
                />
              </div>

              <div>
                <Label htmlFor={`custom-prompt-${currentCardIndex}`}>
                  Дополнительный промпт (опционально)
                </Label>
                <Input
                  id={`custom-prompt-${currentCardIndex}`}
                  value={carouselCards[currentCardIndex].custom_prompt || ''}
                  onChange={(e) => updateCardCustomPrompt(currentCardIndex, e.target.value)}
                  placeholder="Например: добавь больше контраста..."
                  disabled={hasGeneratedImages}
                />
              </div>

              <div>
                <Label htmlFor={`reference-image-${currentCardIndex}`}>
                  Референсное изображение (опционально)
                </Label>
                <Input
                  id={`reference-image-${currentCardIndex}`}
                  type="file"
                  accept="image/*"
                  onChange={(e) => handleReferenceImageUpload(currentCardIndex, e)}
                  disabled={hasGeneratedImages}
                />
                {carouselCards[currentCardIndex].reference_image && (
                  <p className="text-sm text-green-600 mt-1">✓ Изображение загружено</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Шаг 3: Генерация карусели */}
      {carouselCards.length > 0 && !hasGeneratedImages && (
        <Card>
          <CardHeader>
            <CardTitle>Шаг 3: Генерация карусели</CardTitle>
            <CardDescription>
              Сгенерировать изображения для всех карточек
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
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
          </CardContent>
        </Card>
      )}

      {/* Шаг 4: Preview и действия */}
      {hasGeneratedImages && (
        <Card>
          <CardHeader>
            <CardTitle>Preview карусели</CardTitle>
            <CardDescription>
              {carouselCards.length} {carouselCards.length === 1 ? 'карточка' : carouselCards.length < 5 ? 'карточки' : 'карточек'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Горизонтальная карусель */}
            <div className="overflow-x-auto">
              <div className="flex gap-4 pb-4">
                {carouselCards.map((card, i) => (
                  <div key={i} className="flex-shrink-0 w-[280px]">
                    <div className="space-y-2">
                      <div className="relative aspect-[9/16] bg-gray-100 rounded-lg overflow-hidden">
                        <img
                          src={card.image_url}
                          alt={`Карточка ${i + 1}`}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute top-2 left-2">
                          <Badge variant="secondary">{i + 1}</Badge>
                        </div>
                      </div>
                      <p className="text-sm text-gray-600 line-clamp-2">
                        {card.text}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Действия */}
            <div className="flex flex-col gap-4">
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
          </CardContent>
        </Card>
      )}
    </div>
  );
};
