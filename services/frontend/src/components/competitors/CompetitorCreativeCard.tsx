import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PlayCircle, Image, Images, Eye, Sparkles, ChevronDown, ChevronUp, FileText, ScanText, Loader2 } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { CompetitorCreative } from '@/types/competitor';
import { getScoreCategory, isNewInTop10 } from '@/types/competitor';
import { cn } from '@/lib/utils';

interface CompetitorCreativeCardProps {
  creative: CompetitorCreative;
  onClick?: () => void;
  showCompetitorBadge?: boolean;
  onExtractText?: (creativeId: string) => Promise<void>;
  isExtracting?: boolean;
}

const scoreColorClasses = {
  green: 'bg-green-500/20 text-green-700 border-green-500/30',
  yellow: 'bg-yellow-500/20 text-yellow-700 border-yellow-500/30',
  orange: 'bg-orange-500/20 text-orange-700 border-orange-500/30',
  red: 'bg-red-500/20 text-red-700 border-red-500/30',
  gray: 'bg-gray-500/20 text-gray-700 border-gray-500/30',
};

const mediaTypeIcon = {
  video: PlayCircle,
  image: Image,
  carousel: Images,
};

export function CompetitorCreativeCard({
  creative,
  onClick,
  showCompetitorBadge = false,
  onExtractText,
  isExtracting = false,
}: CompetitorCreativeCardProps) {
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(false);
  const MediaIcon = mediaTypeIcon[creative.media_type];

  // Получаем URL для превью
  const previewUrl = creative.thumbnail_url || creative.media_urls?.[0] || null;

  // Получаем категорию score
  const scoreCategory = getScoreCategory(creative.score);
  const isNew = isNewInTop10(creative.entered_top10_at);

  // Текст транскрипции/OCR (analysis может быть массивом от Supabase)
  const analysisData = Array.isArray(creative.analysis) ? creative.analysis[0] : creative.analysis;
  const transcriptText = analysisData?.transcript || analysisData?.ocr_text;

  // Открываем медиа в новой вкладке
  const handleClick = () => {
    if (onClick) {
      onClick();
    } else if (creative.media_urls?.[0]) {
      window.open(creative.media_urls[0], '_blank');
    }
  };

  // Останавливаем propagation для collapsible
  const handleTranscriptClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <Card
      className={cn(
        'overflow-hidden cursor-pointer group relative',
        'hover:ring-2 hover:ring-primary transition-all'
      )}
      onClick={handleClick}
    >
      {/* Превью изображения */}
      <div className="relative aspect-[4/5] bg-muted">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt={creative.headline || 'Креатив'}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <MediaIcon className="w-12 h-12 text-muted-foreground" />
          </div>
        )}

        {/* Overlay при hover */}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <div className="flex items-center gap-2 text-white">
            <Eye className="w-5 h-5" />
            <span className="text-sm font-medium">Просмотр</span>
          </div>
        </div>

        {/* Иконка типа медиа */}
        {creative.media_type === 'video' && (
          <div className="absolute top-2 right-2">
            <div className="bg-black/70 rounded-full p-1.5">
              <PlayCircle className="w-4 h-4 text-white" />
            </div>
          </div>
        )}

        {/* Верхний левый угол: конкурент + "Новый" */}
        <div className="absolute top-2 left-2 flex flex-col gap-1">
          {showCompetitorBadge && creative.competitor && (
            <Badge variant="secondary" className="text-xs">
              {creative.competitor.name}
            </Badge>
          )}
          {isNew && (
            <Badge className="bg-green-500 hover:bg-green-600 text-white text-xs">
              <Sparkles className="w-3 h-3 mr-1" />
              Новый
            </Badge>
          )}
        </div>

        {/* Score badge (верхний правый, под иконкой видео) */}
        {creative.score !== undefined && (
          <div className={cn(
            'absolute right-2',
            creative.media_type === 'video' ? 'top-10' : 'top-2'
          )}>
            <Badge
              variant="outline"
              className={cn('text-xs font-bold', scoreColorClasses[scoreCategory.color])}
            >
              {scoreCategory.emoji} {creative.score}
            </Badge>
          </div>
        )}

        {/* Badges платформ */}
        <div className="absolute bottom-2 left-2 flex gap-1">
          {creative.platforms?.includes('facebook') && (
            <Badge variant="outline" className="bg-background/80 text-xs py-0">
              FB
            </Badge>
          )}
          {creative.platforms?.includes('instagram') && (
            <Badge variant="outline" className="bg-background/80 text-xs py-0">
              IG
            </Badge>
          )}
        </div>

        {/* Badge активности */}
        <div className="absolute bottom-2 right-2">
          <Badge
            variant={creative.is_active ? 'default' : 'secondary'}
            className="text-xs py-0"
          >
            {creative.is_active ? 'Активен' : 'Неактивен'}
          </Badge>
        </div>
      </div>

      {/* Информация под превью */}
      <div className="p-2 space-y-2">
        {/* Текст объявления */}
        {creative.body_text && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {creative.body_text}
          </p>
        )}

        {/* Дополнительная информация */}
        {(creative.duration_days !== undefined || creative.ad_variations !== undefined) && (
          <div className="flex gap-2 text-xs text-muted-foreground">
            {creative.duration_days !== undefined && (
              <span>{creative.duration_days} дн.</span>
            )}
            {creative.ad_variations !== undefined && creative.ad_variations > 1 && (
              <span>{creative.ad_variations} вар.</span>
            )}
          </div>
        )}

        {/* Транскрипция/OCR */}
        {transcriptText ? (
          <div onClick={handleTranscriptClick}>
            <Collapsible open={isTranscriptOpen} onOpenChange={setIsTranscriptOpen}>
              <CollapsibleTrigger className="flex items-center gap-1 text-xs text-primary hover:underline w-full">
                <FileText className="w-3 h-3" />
                <span>Текст креатива</span>
                {isTranscriptOpen ? (
                  <ChevronUp className="w-3 h-3 ml-auto" />
                ) : (
                  <ChevronDown className="w-3 h-3 ml-auto" />
                )}
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-1">
                <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2 max-h-32 overflow-y-auto">
                  {transcriptText}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        ) : onExtractText && (
          <div onClick={handleTranscriptClick}>
            <Button
              variant="outline"
              size="sm"
              className="w-full h-7 text-xs"
              onClick={() => onExtractText(creative.id)}
              disabled={isExtracting}
            >
              {isExtracting ? (
                <>
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  {creative.media_type === 'video' ? 'Транскрибируем...' : 'Извлекаем...'}
                </>
              ) : (
                <>
                  <ScanText className="w-3 h-3 mr-1" />
                  {creative.media_type === 'video' ? 'Транскрибировать' : 'Извлечь текст'}
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
