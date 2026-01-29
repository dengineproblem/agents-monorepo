import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Copy, Check, Clock, Eye, Filter } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { galleryApi, TextGeneration, TEXT_TYPE_LABELS } from '@/services/galleryApi';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

interface TextHistoryTabProps {
  userId: string | null;
  onUseAsReference: (text: string, textType: string) => void;
}

export const TextHistoryTab: React.FC<TextHistoryTabProps> = ({ userId, onUseAsReference }) => {
  const [loading, setLoading] = useState(true);
  const [texts, setTexts] = useState<TextGeneration[]>([]);
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedText, setSelectedText] = useState<TextGeneration | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (userId) {
      loadHistory();
    }
  }, [userId]);

  const loadHistory = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const response = await galleryApi.getTextHistory({
        user_id: userId,
        limit: 100
      });

      if (response.success) {
        setTexts(response.texts);
      } else {
        toast.error('Не удалось загрузить историю');
      }
    } catch (error) {

      toast.error('Ошибка загрузки истории');
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

  // Фильтруем тексты по типу
  const filteredTexts = selectedType === 'all'
    ? texts
    : texts.filter(t => t.text_type === selectedType);

  // Группируем по типам для подсчёта
  const typeCounts = texts.reduce((acc, t) => {
    acc[t.text_type] = (acc[t.text_type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Фильтр по типам */}
      <div className="flex items-center gap-3">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Select value={selectedType} onValueChange={setSelectedType}>
          <SelectTrigger className="w-[250px]">
            <SelectValue placeholder="Все типы" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все типы ({texts.length})</SelectItem>
            {Object.entries(typeCounts).map(([type, count]) => (
              <SelectItem key={type} value={type}>
                {TEXT_TYPE_LABELS[type] || type} ({count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Список текстов */}
      {filteredTexts.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>У вас пока нет сгенерированных текстов</p>
          <p className="text-sm mt-1">Создайте свой первый текст на вкладке "Генерация"</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredTexts.map(text => (
            <Card key={text.id} className="hover:shadow-sm transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="secondary">
                        {TEXT_TYPE_LABELS[text.text_type] || text.text_type}
                      </Badge>
                      <span className="text-xs text-muted-foreground flex items-center">
                        <Clock className="h-3 w-3 mr-1" />
                        {format(new Date(text.created_at), 'd MMM yyyy, HH:mm', { locale: ru })}
                      </span>
                    </div>

                    {/* Промпт (задача) */}
                    {text.user_prompt && (
                      <p className="text-xs text-muted-foreground mb-2 line-clamp-1">
                        Задача: {text.user_prompt}
                      </p>
                    )}

                    {/* Текст */}
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
          ))}
        </div>
      )}

      {/* Модалка просмотра */}
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
                  {format(new Date(selectedText.created_at), 'd MMMM yyyy, HH:mm', { locale: ru })}
                </span>
              </div>

              {selectedText.user_prompt && (
                <div>
                  <p className="text-sm font-medium mb-1">Задача:</p>
                  <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded">
                    {selectedText.user_prompt}
                  </p>
                </div>
              )}

              <div>
                <p className="text-sm font-medium mb-1">Текст:</p>
                <div className="bg-muted/30 p-4 rounded-lg">
                  <p className="text-sm whitespace-pre-line leading-relaxed">
                    {selectedText.generated_text}
                  </p>
                </div>
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
