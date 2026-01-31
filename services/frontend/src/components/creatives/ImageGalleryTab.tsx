import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, ImagePlus, Eye, Filter } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { galleryApi, GeneratedCreative, IMAGE_STYLE_LABELS } from '@/services/galleryApi';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

interface ImageGalleryTabProps {
  onUseAsReference: (imageUrl: string) => void;
}

// Утилита для получения thumbnail URL
const getThumbnailUrl = (url: string | null | undefined, width = 200, height = 250): string | null => {
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

export const ImageGalleryTab: React.FC<ImageGalleryTabProps> = ({ onUseAsReference }) => {
  const [loading, setLoading] = useState(true);
  const [styleGroups, setStyleGroups] = useState<StyleGroup[]>([]);
  const [selectedStyle, setSelectedStyle] = useState<string>('all');
  const [selectedCreative, setSelectedCreative] = useState<GeneratedCreative | null>(null);

  useEffect(() => {
    loadGallery();
  }, []);

  const loadGallery = async () => {
    setLoading(true);
    try {
      const response = await galleryApi.getGalleryCreatives({
        creative_type: 'image',
        limit: 100
      });

      if (response.success) {
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
    if (creative.image_url) {
      onUseAsReference(creative.image_url);
      toast.success('Изображение добавлено как референс');
    }
  };

  // Фильтруем креативы по выбранному стилю
  const filteredCreatives = selectedStyle === 'all'
    ? styleGroups.flatMap(g => g.creatives)
    : styleGroups.find(g => g.style_id === selectedStyle)?.creatives || [];

  const renderCreativeCard = (creative: GeneratedCreative) => {
    const thumbnailUrl = getThumbnailUrl(creative.image_url, 200, 250);

    return (
      <Card
        key={creative.id}
        className="group cursor-pointer hover:shadow-md transition-shadow overflow-hidden"
      >
        <div className="relative aspect-[4/5] bg-muted/30">
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt="Креатив"
              className="w-full h-full object-cover"
              onClick={() => setSelectedCreative(creative)}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground">
              Нет изображения
            </div>
          )}

          {/* Overlay с действиями */}
          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setSelectedCreative(creative)}
            >
              <Eye className="h-4 w-4 mr-1" />
              Просмотр
            </Button>
            <Button
              size="sm"
              variant="default"
              onClick={() => handleUseAsReference(creative)}
            >
              <ImagePlus className="h-4 w-4 mr-1" />
              Референс
            </Button>
          </div>

          {/* Бейдж стиля */}
          {creative.style_id && (
            <Badge className="absolute top-2 left-2 text-xs" variant="secondary">
              {IMAGE_STYLE_LABELS[creative.style_id] || creative.style_id}
            </Badge>
          )}
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

  const totalCount = styleGroups.reduce((sum, g) => sum + g.count, 0);

  return (
    <div className="space-y-4">
      {/* Фильтр по стилям */}
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

      {/* Описание */}
      <p className="text-sm text-muted-foreground">
        Галерея креативов всех пользователей. Используйте понравившийся креатив как референс для генерации похожего.
      </p>

      {/* Галерея */}
      {filteredCreatives.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>Креативы не найдены</p>
          <p className="text-sm mt-1">Галерея пополняется по мере генерации креативов</p>
        </div>
      ) : (
        <>
          {selectedStyle === 'all' ? (
            // Группировка по стилям
            <div className="space-y-8">
              {styleGroups.map(group => (
                <div key={group.style_id}>
                  <div className="flex items-center gap-2 mb-4">
                    <h3 className="text-lg font-semibold">{group.style_label}</h3>
                    <Badge variant="outline">{group.count}</Badge>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    {group.creatives.slice(0, 10).map(creative => renderCreativeCard(creative))}
                  </div>
                  {group.count > 10 && (
                    <Button
                      variant="ghost"
                      className="mt-2"
                      onClick={() => setSelectedStyle(group.style_id)}
                    >
                      Показать все {group.count} креативов
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            // Плоский список для выбранного стиля
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {filteredCreatives.map(creative => renderCreativeCard(creative))}
            </div>
          )}
        </>
      )}

      {/* Модалка просмотра */}
      <Dialog open={!!selectedCreative} onOpenChange={() => setSelectedCreative(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Просмотр креатива</DialogTitle>
          </DialogHeader>
          {selectedCreative && (
            <div className="space-y-4">
              <div className="flex justify-center bg-muted/30 rounded-lg p-4">
                <img
                  src={selectedCreative.image_url}
                  alt="Креатив"
                  className="max-h-[60vh] object-contain rounded"
                />
              </div>

              {selectedCreative.style_id && (
                <Badge variant="secondary">
                  {IMAGE_STYLE_LABELS[selectedCreative.style_id] || selectedCreative.style_id}
                </Badge>
              )}

              <p className="text-sm text-muted-foreground">
                Создан: {format(new Date(selectedCreative.created_at), 'd MMMM yyyy, HH:mm', { locale: ru })}
              </p>

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
