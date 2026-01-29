/**
 * Компонент выбора креатива конкурента как референса
 * Используется при генерации текстов, картинок, карусели
 */

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card } from '@/components/ui/card';
import {
  Users,
  X,
  Loader2,
  PlayCircle,
  Image as ImageIcon,
  Images,
  Check,
  FileText,
} from 'lucide-react';
import { competitorsApi } from '@/services/competitorsApi';
import type { CompetitorCreative } from '@/types/competitor';
import { getScoreCategory } from '@/types/competitor';
import { cn } from '@/lib/utils';

export interface CompetitorReference {
  creativeId: string;
  body_text?: string;
  headline?: string;
  ocr_text?: string;
  transcript?: string;
  media_type: 'video' | 'image' | 'carousel';
  competitor_name?: string;
  thumbnail_url?: string;
  score?: number;
}

interface CompetitorReferenceSelectorProps {
  userAccountId: string;
  selectedReference: CompetitorReference | null;
  onSelect: (reference: CompetitorReference | null) => void;
  mediaTypeFilter?: 'video' | 'image' | 'carousel' | 'all';
  className?: string;
  accountId?: string | null;  // UUID из ad_accounts.id для мультиаккаунтности
  // Для внешнего управления открытием (без триггера)
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;  // Скрыть встроенный триггер
}

const mediaTypeIcon = {
  video: PlayCircle,
  image: ImageIcon,
  carousel: Images,
};

const scoreColorClasses = {
  green: 'bg-green-500/20 text-green-700 border-green-500/30',
  yellow: 'bg-yellow-500/20 text-yellow-700 border-yellow-500/30',
  orange: 'bg-orange-500/20 text-orange-700 border-orange-500/30',
  red: 'bg-red-500/20 text-red-700 border-red-500/30',
  gray: 'bg-gray-500/20 text-gray-700 border-gray-500/30',
};

interface Competitor {
  id: string;
  name: string;
}

export function CompetitorReferenceSelector({
  userAccountId,
  selectedReference,
  onSelect,
  mediaTypeFilter = 'all',
  className,
  accountId,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  hideTrigger = false,
}: CompetitorReferenceSelectorProps) {
  const [internalOpen, setInternalOpen] = useState(false);

  // Поддержка controlled и uncontrolled режимов
  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setIsOpen = controlledOnOpenChange || setInternalOpen;
  const [loading, setLoading] = useState(false);
  const [creatives, setCreatives] = useState<CompetitorCreative[]>([]);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [filter, setFilter] = useState<'all' | 'video' | 'image' | 'carousel'>(mediaTypeFilter);
  const [competitorFilter, setCompetitorFilter] = useState<string>('all');

  // Загружаем конкурентов и креативы при открытии диалога
  useEffect(() => {
    if (isOpen && creatives.length === 0) {
      loadCompetitors();
      loadCreatives();
    }
  }, [isOpen]);

  const loadCompetitors = async () => {
    try {
      // Передаём accountId для фильтрации по рекламному аккаунту
      const data = await competitorsApi.list(userAccountId, accountId);
      setCompetitors(data.map(c => ({ id: c.id, name: c.name })));
    } catch (error) {

    }
  };

  const loadCreatives = async () => {
    setLoading(true);
    try {
      // Загружаем ВСЕ креативы (не только TOP-10), сортированные по score
      // Передаём accountId для фильтрации по рекламному аккаунту
      const { creatives: data } = await competitorsApi.getAllCreatives(userAccountId, {
        mediaType: filter === 'all' ? 'all' : filter,
        limit: 100,
        top10Only: false,
        includeAll: true,
        accountId: accountId || undefined,
      });
      // Сортируем по score descending
      data.sort((a, b) => (b.score || 0) - (a.score || 0));
      setCreatives(data);
    } catch (error) {

    } finally {
      setLoading(false);
    }
  };

  // Перезагружаем при изменении фильтра типа медиа
  useEffect(() => {
    if (isOpen) {
      loadCreatives();
    }
  }, [filter]);

  const handleSelect = (creative: CompetitorCreative) => {
    // analysis может быть массивом от Supabase
    const analysisData = Array.isArray(creative.analysis) ? creative.analysis[0] : creative.analysis;
    const reference: CompetitorReference = {
      creativeId: creative.id,
      body_text: creative.body_text,
      headline: creative.headline,
      ocr_text: analysisData?.ocr_text,
      transcript: analysisData?.transcript,
      media_type: creative.media_type,
      competitor_name: creative.competitor?.name,
      thumbnail_url: creative.thumbnail_url,
      score: creative.score,
    };
    onSelect(reference);
    setIsOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(null);
  };

  // Фильтруем креативы по типу и конкуренту
  const filteredCreatives = creatives.filter(c => {
    const mediaMatch = filter === 'all' || c.media_type === filter;
    const competitorMatch = competitorFilter === 'all' || c.competitor?.id === competitorFilter;
    return mediaMatch && competitorMatch;
  });

  return (
    <div className={className}>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        {!hideTrigger && (
          <DialogTrigger asChild>
            <div>
              {selectedReference ? (
                <Card className="p-3 cursor-pointer hover:bg-accent/50 transition-colors">
                  <div className="flex items-start gap-3">
                    {/* Превью */}
                    <div className="relative w-16 h-20 rounded overflow-hidden bg-muted flex-shrink-0">
                      {selectedReference.thumbnail_url ? (
                        <img
                          src={selectedReference.thumbnail_url}
                          alt="Референс"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          {React.createElement(mediaTypeIcon[selectedReference.media_type], {
                            className: 'w-6 h-6 text-muted-foreground',
                          })}
                        </div>
                      )}
                    </div>

                    {/* Информация */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="secondary" className="text-xs">
                          <Users className="w-3 h-3 mr-1" />
                          {selectedReference.competitor_name || 'Конкурент'}
                        </Badge>
                        {selectedReference.score !== undefined && (
                          <Badge
                            variant="outline"
                            className={cn('text-xs', scoreColorClasses[getScoreCategory(selectedReference.score).color])}
                          >
                            {getScoreCategory(selectedReference.score).emoji} {selectedReference.score}
                          </Badge>
                        )}
                      </div>
                      {selectedReference.body_text && (
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {selectedReference.body_text}
                        </p>
                      )}
                      {(selectedReference.transcript || selectedReference.ocr_text) && (
                        <div className="flex items-center gap-1 mt-1 text-xs text-primary">
                          <FileText className="w-3 h-3" />
                          <span>Есть текст креатива</span>
                        </div>
                      )}
                    </div>

                    {/* Кнопка удаления */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 flex-shrink-0"
                      onClick={handleClear}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </Card>
              ) : (
                <Button variant="outline" className="w-full justify-start gap-2">
                  <Users className="w-4 h-4" />
                  <span>Выбрать референс конкурента</span>
                </Button>
              )}
            </div>
          </DialogTrigger>
        )}

        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Выберите креатив конкурента как референс
            </DialogTitle>
          </DialogHeader>

          {/* Фильтры */}
          <div className="flex items-center gap-4 flex-wrap">
            {/* Фильтр по конкуренту */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Конкурент:</span>
              <Select value={competitorFilter} onValueChange={setCompetitorFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Все конкуренты" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все конкуренты</SelectItem>
                  {competitors.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Фильтр типа медиа */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Тип:</span>
              <Select value={filter} onValueChange={(v) => setFilter(v as any)}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все</SelectItem>
                  <SelectItem value="video">Видео</SelectItem>
                  <SelectItem value="image">Изображения</SelectItem>
                  <SelectItem value="carousel">Карусели</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Количество */}
            <span className="text-sm text-muted-foreground ml-auto">
              {filteredCreatives.length} креативов
            </span>
          </div>

          {/* Список креативов */}
          <ScrollArea className="h-[50vh]">
            {loading ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredCreatives.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-center">
                <Users className="w-8 h-8 text-muted-foreground mb-2" />
                <p className="text-muted-foreground">Нет креативов конкурентов</p>
                <p className="text-sm text-muted-foreground">
                  Добавьте конкурентов в разделе "Конкуренты"
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2 pr-4">
                {filteredCreatives.map((creative) => {
                  const MediaIcon = mediaTypeIcon[creative.media_type];
                  const previewUrl = creative.thumbnail_url || creative.media_urls?.[0];
                  const scoreCategory = getScoreCategory(creative.score);
                  const isSelected = selectedReference?.creativeId === creative.id;
                  const creativeAnalysis = Array.isArray(creative.analysis) ? creative.analysis[0] : creative.analysis;
                  const hasText = creativeAnalysis?.transcript || creativeAnalysis?.ocr_text;

                  return (
                    <div
                      key={creative.id}
                      className={cn(
                        'flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-all',
                        'hover:bg-accent/50',
                        isSelected && 'ring-2 ring-primary bg-primary/5'
                      )}
                      onClick={() => handleSelect(creative)}
                    >
                      {/* Миниатюра 40x40 */}
                      <div className="shrink-0 w-10 h-10 rounded overflow-hidden bg-muted flex items-center justify-center relative">
                        {previewUrl ? (
                          <img
                            src={previewUrl}
                            alt={creative.headline || 'Креатив'}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <MediaIcon className="w-5 h-5 text-muted-foreground" />
                        )}
                        {creative.media_type === 'video' && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                            <PlayCircle className="w-4 h-4 text-white" />
                          </div>
                        )}
                      </div>

                      {/* Score */}
                      <div className="shrink-0 w-16 text-center">
                        {creative.score !== undefined ? (
                          <Badge
                            variant="outline"
                            className={cn('text-xs font-bold', scoreColorClasses[scoreCategory.color])}
                          >
                            {scoreCategory.emoji} {creative.score}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>

                      {/* Конкурент */}
                      <div className="shrink-0 w-24 truncate text-xs text-muted-foreground">
                        {creative.competitor?.name || '—'}
                      </div>

                      {/* Описание и наличие текста */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">
                          {creative.body_text || creative.headline || 'Без описания'}
                        </p>
                      </div>

                      {/* Индикатор наличия текста */}
                      <div className="shrink-0 w-16">
                        {hasText ? (
                          <Badge variant="secondary" className="text-xs">
                            <FileText className="w-3 h-3 mr-1" />
                            Текст
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>

                      {/* Галочка выбора */}
                      <div className="shrink-0 w-6">
                        {isSelected && (
                          <div className="bg-primary rounded-full p-1">
                            <Check className="w-3 h-3 text-primary-foreground" />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
