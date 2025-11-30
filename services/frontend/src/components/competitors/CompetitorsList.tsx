import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreVertical, RefreshCw, Trash2, Star, Loader2 } from 'lucide-react';
import type { Competitor } from '@/types/competitor';
import { useTranslation } from '@/i18n/LanguageContext';
import { cn } from '@/lib/utils';

interface CompetitorsListProps {
  competitors: Competitor[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onRefresh: (competitor: Competitor) => void;
  onDelete: (competitor: Competitor) => void;
  refreshingId?: string | null;
}

const statusBadge: Record<Competitor['status'], { label: string; variant: 'default' | 'secondary' | 'destructive' }> = {
  active: { label: 'Активен', variant: 'default' },
  pending: { label: 'Загрузка...', variant: 'secondary' },
  error: { label: 'Ошибка', variant: 'destructive' },
};

export function CompetitorsList({
  competitors,
  selectedId,
  onSelect,
  onRefresh,
  onDelete,
  refreshingId,
}: CompetitorsListProps) {
  const { t } = useTranslation();

  if (competitors.length === 0) {
    return (
      <Card className="p-4">
        <p className="text-sm text-muted-foreground text-center">
          {t('competitors.noCompetitors')}
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {/* "Все конкуренты" option */}
      <Card
        className={cn(
          'p-3 cursor-pointer transition-colors hover:bg-accent',
          selectedId === null && 'ring-2 ring-primary'
        )}
        onClick={() => onSelect(null)}
      >
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8">
            <AvatarFallback>ВС</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm">{t('competitors.allCompetitors')}</p>
            <p className="text-xs text-muted-foreground">
              {competitors.reduce((sum, c) => sum + (c.creatives_count || 0), 0)} креативов
            </p>
          </div>
        </div>
      </Card>

      {/* Individual competitors */}
      {competitors.map((competitor) => (
        <Card
          key={competitor.id}
          className={cn(
            'p-3 cursor-pointer transition-colors hover:bg-accent',
            selectedId === competitor.id && 'ring-2 ring-primary'
          )}
          onClick={() => onSelect(competitor.id)}
        >
          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8">
              {competitor.avatar_url ? (
                <AvatarImage src={competitor.avatar_url} alt={competitor.name} />
              ) : null}
              <AvatarFallback>
                {competitor.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-medium text-sm truncate">
                  {competitor.display_name || competitor.name}
                </p>
                {competitor.is_favorite && (
                  <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                )}
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={statusBadge[competitor.status].variant} className="text-xs py-0">
                  {statusBadge[competitor.status].label}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {competitor.creatives_count || 0} креативов
                </span>
              </div>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  {refreshingId === competitor.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <MoreVertical className="h-4 w-4" />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onRefresh(competitor);
                  }}
                  disabled={refreshingId === competitor.id}
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  {t('competitors.refresh')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(competitor);
                  }}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  {t('competitors.delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </Card>
      ))}
    </div>
  );
}
