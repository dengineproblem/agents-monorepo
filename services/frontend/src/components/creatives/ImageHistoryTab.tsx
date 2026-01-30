import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, ImagePlus, Trash2, Clock, FileEdit, Eye } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { galleryApi, GeneratedCreative, IMAGE_STYLE_LABELS } from '@/services/galleryApi';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

interface ImageHistoryTabProps {
  userId: string | null;
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

export const ImageHistoryTab: React.FC<ImageHistoryTabProps> = ({ userId, onUseAsReference }) => {
  const [loading, setLoading] = useState(true);
  const [activeSubTab, setActiveSubTab] = useState<'published' | 'drafts'>('published');
  const [drafts, setDrafts] = useState<GeneratedCreative[]>([]);
  const [published, setPublished] = useState<GeneratedCreative[]>([]);
  const [selectedCreative, setSelectedCreative] = useState<GeneratedCreative | null>(null);
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
        creative_type: 'image',
        include_drafts: true
      });

      if (response.success) {
        setDrafts(response.drafts);
        setPublished(response.published);
      } else {
        toast.error('Не удалось загрузить историю');
      }
    } catch (error) {
      console.error('Error loading history:', error);
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
    if (creative.image_url) {
      onUseAsReference(creative.image_url);
      toast.success('Изображение добавлено как референс');
    }
  };

  const renderCreativeCard = (creative: GeneratedCreative, isDraft: boolean) => {
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

          {/* Бейдж черновика */}
          {isDraft && (
            <Badge className="absolute top-2 right-2 text-xs" variant="outline">
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
          {creative.offer && (
            <p className="text-xs mt-2 line-clamp-2 text-muted-foreground">
              {creative.offer}
            </p>
          )}
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
              <p>У вас пока нет сгенерированных креативов</p>
              <p className="text-sm mt-1">Создайте свой первый креатив на вкладке "Генерация"</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {published.map(creative => renderCreativeCard(creative, false))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="drafts" className="mt-4">
          {drafts.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p>У вас нет черновиков</p>
              <p className="text-sm mt-1">Сохраняйте незавершённые креативы как черновики</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {drafts.map(creative => renderCreativeCard(creative, true))}
            </div>
          )}
        </TabsContent>
      </Tabs>

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

              {selectedCreative.offer && (
                <div>
                  <p className="text-sm font-medium">Заголовок:</p>
                  <p className="text-sm text-muted-foreground">{selectedCreative.offer}</p>
                </div>
              )}

              {selectedCreative.bullets && (
                <div>
                  <p className="text-sm font-medium">Буллеты:</p>
                  <p className="text-sm text-muted-foreground whitespace-pre-line">{selectedCreative.bullets}</p>
                </div>
              )}

              {selectedCreative.profits && (
                <div>
                  <p className="text-sm font-medium">Выгода:</p>
                  <p className="text-sm text-muted-foreground">{selectedCreative.profits}</p>
                </div>
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
