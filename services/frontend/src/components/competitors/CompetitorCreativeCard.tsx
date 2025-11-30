import React from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PlayCircle, Image, Images, Eye } from 'lucide-react';
import type { CompetitorCreative } from '@/types/competitor';
import { cn } from '@/lib/utils';

interface CompetitorCreativeCardProps {
  creative: CompetitorCreative;
  onClick?: () => void;
  showCompetitorBadge?: boolean;
}

const mediaTypeIcon = {
  video: PlayCircle,
  image: Image,
  carousel: Images,
};

export function CompetitorCreativeCard({
  creative,
  onClick,
  showCompetitorBadge = false,
}: CompetitorCreativeCardProps) {
  const MediaIcon = mediaTypeIcon[creative.media_type];

  // Получаем URL для превью
  const previewUrl = creative.thumbnail_url || creative.media_urls?.[0] || null;

  // Открываем медиа в новой вкладке
  const handleClick = () => {
    if (onClick) {
      onClick();
    } else if (creative.media_urls?.[0]) {
      window.open(creative.media_urls[0], '_blank');
    }
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

        {/* Badge конкурента */}
        {showCompetitorBadge && creative.competitor && (
          <div className="absolute top-2 left-2">
            <Badge variant="secondary" className="text-xs">
              {creative.competitor.name}
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

      {/* Текст под превью */}
      {creative.body_text && (
        <div className="p-2">
          <p className="text-xs text-muted-foreground line-clamp-2">
            {creative.body_text}
          </p>
        </div>
      )}
    </Card>
  );
}
