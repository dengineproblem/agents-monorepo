import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Copy, Check, Eye, Filter } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { galleryApi, TextGeneration, TEXT_TYPE_LABELS } from '@/services/galleryApi';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

interface TextGalleryTabProps {
  onUseAsReference: (text: string, textType: string) => void;
}

interface TypeGroup {
  type_id: string;
  type_label: string;
  count: number;
  texts: TextGeneration[];
}

export const TextGalleryTab: React.FC<TextGalleryTabProps> = ({ onUseAsReference }) => {
  const [loading, setLoading] = useState(true);
  const [typeGroups, setTypeGroups] = useState<TypeGroup[]>([]);
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedText, setSelectedText] = useState<TextGeneration | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    loadGallery();
  }, []);

  const loadGallery = async () => {
    setLoading(true);
    try {
      const response = await galleryApi.getTextGallery({ limit: 200 });

      if (response.success) {
        setTypeGroups(response.types);
      } else {
        toast.error('Не удалось загрузить галерею');
      }
    } catch (error) {

      toast.error('Ошибка загрузки галереи');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async (text: TextGeneration) => {
    try {
      await navigator.clipboard.writeText(text.generated_text);
      setCopiedId(text.id);
      toast.success('Текст скопирован!');
      setTimeout(() => setCopiedId(null), 2000);
    } catch (error) {
      toast.error('Не удалось скопировать');
    }
  };

  const handleUseAsReference = (text: TextGeneration) => {
    onUseAsReference(text.generated_text, text.text_type);
    toast.success('Текст добавлен как референс');
  };

  // Фильтруем тексты
  const filteredTexts = selectedType === 'all'
    ? typeGroups.flatMap(g => g.texts)
    : typeGroups.find(g => g.type_id === selectedType)?.texts || [];

  const totalCount = typeGroups.reduce((sum, g) => sum + g.count, 0);

  const renderTextCard = (text: TextGeneration) => (
    <Card key={text.id} className="hover:shadow-sm transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="secondary" className="text-xs">
                {TEXT_TYPE_LABELS[text.text_type] || text.text_type}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {format(new Date(text.created_at), 'd MMM', { locale: ru })}
              </span>
            </div>
            <p className="text-sm line-clamp-3 whitespace-pre-line">
              {text.generated_text}
            </p>
          </div>

          <div className="flex flex-col gap-1 shrink-0">
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={() => handleCopy(text)}
              title="Копировать"
            >
              {copiedId === text.id ? (
                <Check className="h-4 w-4 text-green-600" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={() => setSelectedText(text)}
              title="Просмотр"
            >
              <Eye className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Фильтр */}
      <div className="flex items-center gap-3">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Select value={selectedType} onValueChange={setSelectedType}>
          <SelectTrigger className="w-[250px]">
            <SelectValue placeholder="Все типы" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все типы ({totalCount})</SelectItem>
            {typeGroups.map(group => (
              <SelectItem key={group.type_id} value={group.type_id}>
                {group.type_label} ({group.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p className="text-sm text-muted-foreground">
        Галерея текстов всех пользователей. Используйте понравившийся текст как референс для генерации похожего.
      </p>

      {/* Галерея */}
      {filteredTexts.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>Тексты не найдены</p>
        </div>
      ) : (
        <>
          {selectedType === 'all' ? (
            // Группировка по типам
            <div className="space-y-8">
              {typeGroups.map(group => (
                <div key={group.type_id}>
                  <div className="flex items-center gap-2 mb-4">
                    <h3 className="text-lg font-semibold">{group.type_label}</h3>
                    <Badge variant="outline">{group.count}</Badge>
                  </div>
                  <div className="space-y-3">
                    {group.texts.slice(0, 5).map(text => renderTextCard(text))}
                  </div>
                  {group.count > 5 && (
                    <Button
                      variant="ghost"
                      className="mt-2"
                      onClick={() => setSelectedType(group.type_id)}
                    >
                      Показать все {group.count} текстов
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            // Плоский список
            <div className="space-y-3">
              {filteredTexts.map(text => renderTextCard(text))}
            </div>
          )}
        </>
      )}

      {/* Модалка */}
      <Dialog open={!!selectedText} onOpenChange={() => setSelectedText(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Просмотр текста</DialogTitle>
          </DialogHeader>
          {selectedText && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">
                  {TEXT_TYPE_LABELS[selectedText.text_type] || selectedText.text_type}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {format(new Date(selectedText.created_at), 'd MMMM yyyy', { locale: ru })}
                </span>
              </div>

              <div className="bg-muted/30 p-4 rounded-lg">
                <p className="text-sm whitespace-pre-line leading-relaxed">
                  {selectedText.generated_text}
                </p>
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={() => handleCopy(selectedText)}
                  variant="outline"
                  className="flex-1"
                >
                  {copiedId === selectedText.id ? (
                    <>
                      <Check className="h-4 w-4 mr-2 text-green-600" />
                      Скопировано
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4 mr-2" />
                      Копировать
                    </>
                  )}
                </Button>
                <Button
                  onClick={() => {
                    handleUseAsReference(selectedText);
                    setSelectedText(null);
                  }}
                  className="flex-1"
                >
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
