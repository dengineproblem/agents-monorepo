import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, ImagePlus, Eye, Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { galleryApi, GeneratedCreative, CAROUSEL_STYLE_LABELS, CarouselCard } from '@/services/galleryApi';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

interface CarouselGalleryTabProps {
  onUseAsReference: (imageUrls: string[]) => void;
}

// Утилита для получения thumbnail URL
const getThumbnailUrl = (url: string | null | undefined, width = 150, height = 150): string | null => {
  if (!url) return null;
  if (!url.includes('supabase')) return url;
  const urlParts = url.split('/storage/v1/object/public/');
  if (urlParts.length !== 2) return url;
  const baseUrl = urlParts[0];
  const pathPart = urlParts[1];
  return `${baseUrl}/storage/v1/render/image/public/${pathPart}?width=${width}&height=${height}&resize=contain`;
};

interface StyleGroup {
  style_id: string;
  style_label: string;
  count: number;
  creatives: GeneratedCreative[];
}

export const CarouselGalleryTab: React.FC<CarouselGalleryTabProps> = ({ onUseAsReference }) => {
  const [loading, setLoading] = useState(true);
  const [styleGroups, setStyleGroups] = useState<StyleGroup[]>([]);
  const [selectedStyle, setSelectedStyle] = useState<string>('all');
  const [selectedCreative, setSelectedCreative] = useState<GeneratedCreative | null>(null);
  const [selectedCardIndex, setSelectedCardIndex] = useState(0);

  useEffect(() => {
    loadGallery();
  }, []);

  const loadGallery = async () => {
    setLoading(true);
    try {
      const response = await galleryApi.getGalleryCreatives({
        creative_type: 'carousel',
        limit: 100
      });

      if (response.success) {
        // Бэкенд уже возвращает только карусели (creative_type: 'carousel')
        setStyleGroups(response.styles);
      } else {
        toast.error('Не удалось загрузить галерею');
      }
    } catch (error) {
      console.error('Error loading gallery:', error);
      toast.error('Ошибка загрузки галереи');
    } finally {
      setLoading(false);
    }
  };

  const handleUseAsReference = (creative: GeneratedCreative) => {
    const cards = creative.carousel_data as CarouselCard[] | undefined;
    if (cards && cards.length > 0) {
      const imageUrls = cards
        .filter(card => card.image_url)
        .map(card => card.image_url as string);
      if (imageUrls.length > 0) {
        onUseAsReference(imageUrls);
        toast.success('Карусель добавлена как референс');
      }
    }
  };

  const renderCarouselPreview = (creative: GeneratedCreative) => {
    const cards = creative.carousel_data as CarouselCard[] | undefined;
    if (!cards || cards.length === 0) return null;

    const previewCards = cards.slice(0, 3);

    return (
      <div className="flex gap-1 overflow-hidden">
        {previewCards.map((card, index) => {
          const thumbnailUrl = getThumbnailUrl(card.image_url, 80, 100);
          return (
            <div key={index} className="w-1/3 aspect-[4/5] bg-muted/30 rounded overflow-hidden flex-shrink-0">
              {thumbnailUrl ? (
                <img
                  src={thumbnailUrl}
                  alt={`Карточка ${index + 1}`}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
                  {index + 1}
                </div>
              )}
            </div>
          );
        })}
        {cards.length > 3 && (
          <div className="w-1/3 aspect-[4/5] bg-muted/50 rounded flex items-center justify-center text-xs text-muted-foreground flex-shrink-0">
            +{cards.length - 3}
          </div>
        )}
      </div>
    );
  };

  const renderCreativeCard = (creative: GeneratedCreative) => {
    const cards = creative.carousel_data as CarouselCard[] | undefined;
    const cardCount = cards?.length || 0;

    return (
      <Card
        key={creative.id}
        className="group cursor-pointer hover:shadow-md transition-shadow overflow-hidden"
      >
        <div className="relative p-3 bg-muted/20" onClick={() => {
          setSelectedCreative(creative);
          setSelectedCardIndex(0);
        }}>
          {renderCarouselPreview(creative)}

          {/* Overlay */}
          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedCreative(creative);
                setSelectedCardIndex(0);
              }}
            >
              <Eye className="h-4 w-4 mr-1" />
              Просмотр
            </Button>
            <Button
              size="sm"
              variant="default"
              onClick={(e) => {
                e.stopPropagation();
                handleUseAsReference(creative);
              }}
            >
              <ImagePlus className="h-4 w-4 mr-1" />
              Референс
            </Button>
          </div>

          {/* Бейджи */}
          {creative.visual_style && (
            <Badge className="absolute top-1 left-1 text-xs" variant="secondary">
              {CAROUSEL_STYLE_LABELS[creative.visual_style] || creative.visual_style}
            </Badge>
          )}
          <Badge className="absolute top-1 right-1 text-xs" variant="outline">
            {cardCount} карт.
          </Badge>
        </div>

        <CardContent className="p-3">
          <p className="text-xs text-muted-foreground">
            {format(new Date(creative.created_at), 'd MMM yyyy', { locale: ru })}
          </p>
        </CardContent>
      </Card>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const filteredCreatives = selectedStyle === 'all'
    ? styleGroups.flatMap(g => g.creatives)
    : styleGroups.find(g => g.style_id === selectedStyle)?.creatives || [];

  const totalCount = styleGroups.reduce((sum, g) => sum + g.count, 0);
  const selectedCards = selectedCreative?.carousel_data as CarouselCard[] | undefined;

  return (
    <div className="space-y-4">
      {/* Фильтр */}
      <div className="flex items-center gap-3">
        <Filter className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <Select value={selectedStyle} onValueChange={setSelectedStyle}>
          <SelectTrigger className="w-full sm:w-[250px]">
            <SelectValue placeholder="Все стили" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все стили ({totalCount})</SelectItem>
            {styleGroups.map(group => (
              <SelectItem key={group.style_id} value={group.style_id}>
                {group.style_label} ({group.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p className="text-sm text-muted-foreground">
        Галерея каруселей всех пользователей. Используйте понравившуюся карусель как референс.
      </p>

      {/* Галерея */}
      {filteredCreatives.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>Карусели не найдены</p>
        </div>
      ) : (
        <>
          {selectedStyle === 'all' ? (
            <div className="space-y-8">
              {styleGroups.map(group => (
                <div key={group.style_id}>
                  <div className="flex items-center gap-2 mb-4">
                    <h3 className="text-lg font-semibold">{group.style_label}</h3>
                    <Badge variant="outline">{group.count}</Badge>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                    {group.creatives.slice(0, 8).map(creative => renderCreativeCard(creative))}
                  </div>
                  {group.count > 8 && (
                    <Button
                      variant="ghost"
                      className="mt-2"
                      onClick={() => setSelectedStyle(group.style_id)}
                    >
                      Показать все {group.count} каруселей
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {filteredCreatives.map(creative => renderCreativeCard(creative))}
            </div>
          )}
        </>
      )}

      {/* Модалка */}
      <Dialog open={!!selectedCreative} onOpenChange={() => setSelectedCreative(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Просмотр карусели</DialogTitle>
          </DialogHeader>
          {selectedCreative && selectedCards && (
            <div className="space-y-4">
              <div className="relative bg-muted/30 rounded-lg p-4">
                <div className="flex justify-center">
                  <img
                    src={selectedCards[selectedCardIndex]?.image_url || ''}
                    alt={`Карточка ${selectedCardIndex + 1}`}
                    className="max-h-[50vh] object-contain rounded"
                  />
                </div>

                {selectedCards.length > 1 && (
                  <>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="absolute left-2 top-1/2 -translate-y-1/2"
                      onClick={() => setSelectedCardIndex(prev => prev > 0 ? prev - 1 : selectedCards.length - 1)}
                    >
                      <ChevronLeft className="h-6 w-6" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="absolute right-2 top-1/2 -translate-y-1/2"
                      onClick={() => setSelectedCardIndex(prev => prev < selectedCards.length - 1 ? prev + 1 : 0)}
                    >
                      <ChevronRight className="h-6 w-6" />
                    </Button>
                  </>
                )}

                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                  {selectedCards.map((_, index) => (
                    <button
                      key={index}
                      className={`w-2 h-2 rounded-full transition-colors ${
                        index === selectedCardIndex ? 'bg-primary' : 'bg-muted-foreground/30'
                      }`}
                      onClick={() => setSelectedCardIndex(index)}
                    />
                  ))}
                </div>
              </div>

              <div className="flex gap-2 overflow-x-auto pb-2">
                {selectedCards.map((card, index) => (
                  <button
                    key={index}
                    className={`flex-shrink-0 w-16 h-20 rounded overflow-hidden border-2 transition-colors ${
                      index === selectedCardIndex ? 'border-primary' : 'border-transparent'
                    }`}
                    onClick={() => setSelectedCardIndex(index)}
                  >
                    <img
                      src={getThumbnailUrl(card.image_url, 64, 80) || ''}
                      alt={`Карточка ${index + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>

              {selectedCards[selectedCardIndex]?.text && (
                <div>
                  <p className="text-sm font-medium">Текст карточки {selectedCardIndex + 1}:</p>
                  <p className="text-sm text-muted-foreground">{selectedCards[selectedCardIndex].text}</p>
                </div>
              )}

              {selectedCreative.visual_style && (
                <Badge variant="secondary">
                  {CAROUSEL_STYLE_LABELS[selectedCreative.visual_style] || selectedCreative.visual_style}
                </Badge>
              )}

              <Button
                onClick={() => {
                  handleUseAsReference(selectedCreative);
                  setSelectedCreative(null);
                }}
                className="w-full"
              >
                <ImagePlus className="h-4 w-4 mr-2" />
                Использовать как референс
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
