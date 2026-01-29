import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, ImagePlus, Trash2, Clock, FileEdit, Eye, ChevronLeft, ChevronRight } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { galleryApi, GeneratedCreative, CAROUSEL_STYLE_LABELS, CarouselCard } from '@/services/galleryApi';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

interface CarouselHistoryTabProps {
  userId: string | null;
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

export const CarouselHistoryTab: React.FC<CarouselHistoryTabProps> = ({ userId, onUseAsReference }) => {
  const [loading, setLoading] = useState(true);
  const [activeSubTab, setActiveSubTab] = useState<'published' | 'drafts'>('published');
  const [drafts, setDrafts] = useState<GeneratedCreative[]>([]);
  const [published, setPublished] = useState<GeneratedCreative[]>([]);
  const [selectedCreative, setSelectedCreative] = useState<GeneratedCreative | null>(null);
  const [selectedCardIndex, setSelectedCardIndex] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (userId) {
      loadHistory();
    }
  }, [userId]);

  const loadHistory = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const response = await galleryApi.getHistoryCreatives({
        user_id: userId,
        creative_type: 'carousel',
        include_drafts: true
      });

      if (response.success) {
        setDrafts(response.drafts);
        setPublished(response.published);
      } else {
        toast.error('Не удалось загрузить историю');
      }
    } catch (error) {

      toast.error('Ошибка загрузки истории');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (creative: GeneratedCreative) => {
    if (!userId) return;
    setDeletingId(creative.id);
    try {
      const response = await galleryApi.deleteDraft(creative.id, userId);
      if (response.success) {
        setDrafts(prev => prev.filter(d => d.id !== creative.id));
        toast.success('Черновик удалён');
      } else {
        toast.error('Не удалось удалить черновик');
      }
    } catch (error) {
      toast.error('Ошибка удаления');
    } finally {
      setDeletingId(null);
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

    // Показываем первые 3 карточки как превью
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

  const renderCreativeCard = (creative: GeneratedCreative, isDraft: boolean) => {
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

          {/* Overlay с действиями */}
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

          {/* Бейдж стиля */}
          {creative.visual_style && (
            <Badge className="absolute top-1 left-1 text-xs" variant="secondary">
              {CAROUSEL_STYLE_LABELS[creative.visual_style] || creative.visual_style}
            </Badge>
          )}

          {/* Бейдж количества карточек */}
          <Badge className="absolute top-1 right-1 text-xs" variant="outline">
            {cardCount} карт.
          </Badge>

          {/* Бейдж черновика */}
          {isDraft && (
            <Badge className="absolute bottom-1 right-1 text-xs bg-amber-500/90">
              <FileEdit className="h-3 w-3 mr-1" />
              Черновик
            </Badge>
          )}
        </div>

        <CardContent className="p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center text-xs text-muted-foreground">
              <Clock className="h-3 w-3 mr-1" />
              {format(new Date(creative.created_at), 'd MMM yyyy', { locale: ru })}
            </div>
            {isDraft && (
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 text-destructive hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(creative);
                }}
                disabled={deletingId === creative.id}
              >
                {deletingId === creative.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
              </Button>
            )}
          </div>
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

  const selectedCards = selectedCreative?.carousel_data as CarouselCard[] | undefined;

  return (
    <div className="space-y-4">
      <Tabs value={activeSubTab} onValueChange={(v) => setActiveSubTab(v as 'published' | 'drafts')}>
        <TabsList>
          <TabsTrigger value="published">
            Сгенерированные ({published.length})
          </TabsTrigger>
          <TabsTrigger value="drafts">
            Черновики ({drafts.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="published" className="mt-4">
          {published.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p>У вас пока нет сгенерированных каруселей</p>
              <p className="text-sm mt-1">Создайте свою первую карусель на вкладке "Генерация"</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {published.map(creative => renderCreativeCard(creative, false))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="drafts" className="mt-4">
          {drafts.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p>У вас нет черновиков каруселей</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {drafts.map(creative => renderCreativeCard(creative, true))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Модалка просмотра карусели */}
      <Dialog open={!!selectedCreative} onOpenChange={() => setSelectedCreative(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Просмотр карусели</DialogTitle>
          </DialogHeader>
          {selectedCreative && selectedCards && (
            <div className="space-y-4">
              {/* Основное изображение */}
              <div className="relative bg-muted/30 rounded-lg p-4">
                <div className="flex justify-center">
                  <img
                    src={selectedCards[selectedCardIndex]?.image_url || ''}
                    alt={`Карточка ${selectedCardIndex + 1}`}
                    className="max-h-[50vh] object-contain rounded"
                  />
                </div>

                {/* Навигация */}
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

                {/* Индикатор */}
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

              {/* Превью всех карточек */}
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

              {/* Текст карточки */}
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

              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    handleUseAsReference(selectedCreative);
                    setSelectedCreative(null);
                  }}
                  className="flex-1"
                >
                  <ImagePlus className="h-4 w-4 mr-2" />
                  Использовать как референс
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
