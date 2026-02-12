import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  PlayCircle,
  Image,
  Images,
  ExternalLink,
  FileText,
  ScanText,
  Sparkles,
  Pencil,
} from 'lucide-react';
import { toast } from 'sonner';
import { competitorsApi } from '@/services/competitorsApi';
import type { CompetitorCreative, CompetitorsPagination } from '@/types/competitor';
import { getScoreCategory, isNewInTop10 } from '@/types/competitor';
import { cn } from '@/lib/utils';

interface CompetitorCreativesListProps {
  creatives: CompetitorCreative[];
  loading: boolean;
  pagination: CompetitorsPagination;
  onPageChange: (page: number) => void;
  onExtractText?: (creativeId: string) => Promise<void>;
  extractingCreativeId?: string | null;
}

// Цвета для score с поддержкой dark mode
const scoreColorClasses = {
  green: 'bg-green-100 text-green-700 border-green-500/30 dark:bg-green-900/40 dark:text-green-200',
  yellow: 'bg-yellow-100 text-yellow-700 border-yellow-500/30 dark:bg-yellow-900/40 dark:text-yellow-200',
  orange: 'bg-orange-100 text-orange-700 border-orange-500/30 dark:bg-orange-900/40 dark:text-orange-200',
  red: 'bg-red-100 text-red-700 border-red-500/30 dark:bg-red-900/40 dark:text-red-200',
  gray: 'bg-gray-100 text-gray-700 border-gray-500/30 dark:bg-gray-800/40 dark:text-gray-300',
};

// Конфигурация типов медиа — как в Creatives.tsx
const mediaTypeConfig = {
  video: {
    icon: PlayCircle,
    label: 'Видео',
    className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200'
  },
  image: {
    icon: Image,
    label: 'Картинка',
    className: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200'
  },
  carousel: {
    icon: Images,
    label: 'Карусель',
    className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-200'
  },
};

// Форматирование даты
const formatDate = (dateString?: string): string => {
  if (!dateString) return '—';
  const date = new Date(dateString);
  return date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
};

// Получение текста анализа
const getAnalysisText = (creative: CompetitorCreative): string | null => {
  const analysis = Array.isArray(creative.analysis)
    ? creative.analysis[0]
    : creative.analysis;
  return analysis?.transcript || analysis?.ocr_text || null;
};

export function CompetitorCreativesList({
  creatives,
  loading,
  pagination,
  onPageChange,
  onExtractText,
  extractingCreativeId,
}: CompetitorCreativesListProps) {
  const navigate = useNavigate();
  const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({});

  // Обработчик ошибки загрузки изображения
  const handleImageError = (creativeId: string) => {
    setImageErrors(prev => ({ ...prev, [creativeId]: true }));
  };

  // Переход на страницу генерации текстов с текстом и ID креатива
  const handleRewriteScript = (creative: CompetitorCreative) => {
    const text = getAnalysisText(creative);
    if (!text) {
      toast.error('Сначала извлеките текст из креатива');
      return;
    }

    const encodedText = encodeURIComponent(text);
    // Передаём creativeId чтобы автоматически выбрать этот креатив как референс
    navigate(`/creatives?tab=video-scripts&textType=reference&prompt=${encodedText}&competitorCreativeId=${creative.id}`);
  };

  // Открыть оригинал в новой вкладке (через API для получения свежего URL)
  const handleOpenOriginal = async (creative: CompetitorCreative) => {
    try {
      const freshUrl = await competitorsApi.getMediaUrl(creative.id);
      if (freshUrl) {
        window.open(freshUrl, '_blank');
      } else {
        toast.error('Не удалось получить актуальный URL медиа');
      }
    } catch {
      toast.error('Ошибка при получении URL медиа');
    }
  };

  if (loading && creatives.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (creatives.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <p className="text-muted-foreground">Нет креативов</p>
        <p className="text-sm text-muted-foreground mt-1">
          Выберите конкурента или обновите данные
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Список креативов */}
      <Accordion type="single" collapsible className="w-full">
        {creatives.map((creative) => {
          const mediaConfig = mediaTypeConfig[creative.media_type];
          const MediaIcon = mediaConfig?.icon || Image;
          const mediaClassName = mediaConfig?.className || 'bg-gray-100 text-gray-700 dark:bg-gray-800/40 dark:text-gray-300';
          const scoreCategory = getScoreCategory(creative.score);
          const isNew = isNewInTop10(creative.entered_top10_at);
          const analysisText = getAnalysisText(creative);
          const previewUrl = creative.cached_thumbnail_url || creative.thumbnail_url || creative.media_urls?.[0];

          return (
            <AccordionItem key={creative.id} value={creative.id}>
              <div className="flex items-center gap-3 py-2">
                {/* Миниатюра */}
                <div className="shrink-0 w-10 h-10 rounded overflow-hidden bg-muted flex items-center justify-center">
                  {previewUrl && !imageErrors[creative.id] ? (
                    <img
                      src={previewUrl}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                      onError={() => handleImageError(creative.id)}
                    />
                  ) : (
                    <MediaIcon className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>

                {/* Текст и badges */}
                <div className="min-w-0 flex-1 flex items-center gap-2">
                  <AccordionTrigger className="hover:no-underline min-w-0 flex-1 py-0">
                    <span className="text-sm font-medium truncate text-left">
                      {creative.body_text?.slice(0, 60) || creative.headline || 'Без текста'}
                      {creative.body_text && creative.body_text.length > 60 && '...'}
                    </span>
                  </AccordionTrigger>

                  {/* Badge типа медиа — только иконка, как в Creatives.tsx */}
                  <div className="flex-shrink-0 hidden sm:block">
                    <Badge className={cn('text-xs px-2 py-0.5 gap-1 flex items-center', mediaClassName)}>
                      <MediaIcon className="h-3 w-3" />
                    </Badge>
                  </div>

                  {/* Badge конкурента */}
                  {creative.competitor && (
                    <div className="flex-shrink-0 hidden sm:block">
                      <Badge variant="secondary" className="text-xs">
                        {creative.competitor.name}
                      </Badge>
                    </div>
                  )}

                  {/* Badge "Новый" */}
                  {isNew && (
                    <div className="flex-shrink-0">
                      <Badge className="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200 text-xs gap-1">
                        <Sparkles className="w-3 h-3" />
                        <span className="hidden sm:inline">Новый</span>
                      </Badge>
                    </div>
                  )}

                  {/* Score badge — скрыт из интерфейса */}
                </div>

                {/* Дата */}
                <div className="shrink-0 text-xs text-muted-foreground whitespace-nowrap hidden sm:block">
                  {formatDate(creative.first_shown_date || creative.created_at)}
                </div>

                {/* Статус активности (только индикатор) */}
                <div className="shrink-0">
                  <span
                    className={cn(
                      'inline-block w-2.5 h-2.5 rounded-full',
                      creative.is_active
                        ? 'bg-gradient-to-br from-green-400 to-emerald-500 shadow-sm'
                        : 'bg-gray-300 dark:bg-gray-600'
                    )}
                    title={creative.is_active ? 'Активен' : 'Неактивен'}
                  />
                </div>
              </div>

              <AccordionContent>
                <div className="space-y-4 pt-2">
                  {/* Превью изображения/видео */}
                  {previewUrl && !imageErrors[creative.id] && (
                    <Card className="bg-muted/30">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <MediaIcon className="w-4 h-4" />
                          Превью
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="flex justify-center">
                          <img
                            src={previewUrl}
                            alt="Превью креатива"
                            className="max-w-full h-auto rounded-lg border max-h-[400px] object-contain cursor-pointer hover:opacity-90 transition-opacity"
                            onClick={() => handleOpenOriginal(creative)}
                            onError={() => handleImageError(creative.id)}
                          />
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Текст объявления */}
                  {creative.body_text && (
                    <Card className="bg-muted/30">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Текст объявления</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm whitespace-pre-wrap">{creative.body_text}</p>
                      </CardContent>
                    </Card>
                  )}

                  {/* Транскрипция/OCR */}
                  {analysisText ? (
                    <Card className="bg-muted/30">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <FileText className="w-4 h-4" />
                          {creative.media_type === 'video' ? 'Транскрипция' : 'Текст с изображения'}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm whitespace-pre-wrap text-muted-foreground max-h-48 overflow-y-auto">
                          {analysisText}
                        </p>
                      </CardContent>
                    </Card>
                  ) : onExtractText && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => onExtractText(creative.id)}
                      disabled={extractingCreativeId === creative.id}
                    >
                      {extractingCreativeId === creative.id ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          {creative.media_type === 'video' ? 'Транскрибируем...' : 'Извлекаем текст...'}
                        </>
                      ) : (
                        <>
                          <ScanText className="w-4 h-4 mr-2" />
                          {creative.media_type === 'video' ? 'Транскрибировать' : 'Извлечь текст'}
                        </>
                      )}
                    </Button>
                  )}

                  {/* Дополнительная информация */}
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {creative.duration_days !== undefined && (
                      <span>Показывается {creative.duration_days} дн.</span>
                    )}
                    {creative.ad_variations !== undefined && creative.ad_variations > 1 && (
                      <span>• {creative.ad_variations} вариаций</span>
                    )}
                    {creative.platforms?.length > 0 && (
                      <span>
                        • {creative.platforms.map(p => p === 'facebook' ? 'FB' : p === 'instagram' ? 'IG' : p).join(', ')}
                      </span>
                    )}
                  </div>

                  {/* Кнопки действий */}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRewriteScript(creative)}
                      disabled={!analysisText}
                      title={!analysisText ? 'Сначала извлеките текст' : undefined}
                    >
                      <Pencil className="w-4 h-4 mr-2" />
                      Переписать сценарий
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleOpenOriginal(creative)}
                    >
                      <ExternalLink className="w-4 h-4 mr-2" />
                      Открыть оригинал
                    </Button>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>

      {/* Loading overlay */}
      {loading && creatives.length > 0 && (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Пагинация */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between pt-4 border-t">
          <p className="text-sm text-muted-foreground">
            Показано {(pagination.page - 1) * pagination.limit + 1}-
            {Math.min(pagination.page * pagination.limit, pagination.total)} из {pagination.total}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(pagination.page - 1)}
              disabled={pagination.page <= 1 || loading}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm">
              {pagination.page} / {pagination.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages || loading}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
