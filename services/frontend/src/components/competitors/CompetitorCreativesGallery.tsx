import React from 'react';
import { CompetitorCreativeCard } from './CompetitorCreativeCard';
import { Button } from '@/components/ui/button';
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import type { CompetitorCreative, CompetitorsPagination } from '@/types/competitor';
import { useTranslation } from '@/i18n/LanguageContext';

interface CompetitorCreativesGalleryProps {
  creatives: CompetitorCreative[];
  loading: boolean;
  pagination: CompetitorsPagination;
  onPageChange: (page: number) => void;
  onCreativeClick?: (creative: CompetitorCreative) => void;
  showCompetitorBadge?: boolean;
}

export function CompetitorCreativesGallery({
  creatives,
  loading,
  pagination,
  onPageChange,
  onCreativeClick,
  showCompetitorBadge = false,
}: CompetitorCreativesGalleryProps) {
  const { t } = useTranslation();

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
        <p className="text-muted-foreground">{t('competitors.noCreatives')}</p>
        <p className="text-sm text-muted-foreground mt-1">
          {t('competitors.noCreativesHint')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Grid креативов */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {creatives.map((creative) => (
          <CompetitorCreativeCard
            key={creative.id}
            creative={creative}
            onClick={() => onCreativeClick?.(creative)}
            showCompetitorBadge={showCompetitorBadge}
          />
        ))}
      </div>

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
