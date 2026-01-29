/**
 * Универсальный компонент выбора креатива как референса
 * Поддерживает как креативы конкурентов, так и собственные креативы пользователя
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card } from '@/components/ui/card';
import {
  Users,
  User,
  X,
  Loader2,
  PlayCircle,
  Image as ImageIcon,
  Images,
  Check,
  FileText,
  Mic,
  AlertCircle,
  Eye,
  ScanText,
} from 'lucide-react';
import { toast } from 'sonner';
import { competitorsApi } from '@/services/competitorsApi';
import { creativesApi, UserCreative } from '@/services/creativesApi';
import type { CompetitorCreative } from '@/types/competitor';
import { getScoreCategory } from '@/types/competitor';
import { cn } from '@/lib/utils';

export interface CreativeReference {
  creativeId: string;
  source: 'competitor' | 'own';  // Источник: конкурент или свой
  body_text?: string;
  headline?: string;
  ocr_text?: string;
  transcript?: string;
  media_type: 'video' | 'image' | 'carousel';
  source_name?: string;  // Имя конкурента или "Мой креатив"
  thumbnail_url?: string;
  score?: number;
}

interface ReferenceSelectorProps {
  userAccountId: string;
  selectedReference: CreativeReference | null;
  onSelect: (reference: CreativeReference | null) => void;
  mediaTypeFilter?: 'video' | 'image' | 'carousel' | 'all';
  className?: string;
  accountId?: string | null;  // UUID из ad_accounts.id для мультиаккаунтности
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

export function ReferenceSelector({
  userAccountId,
  selectedReference,
  onSelect,
  mediaTypeFilter = 'all',
  className,
  accountId,
}: ReferenceSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'competitor' | 'own'>('competitor');

  // Competitor state
  const [competitorLoading, setCompetitorLoading] = useState(false);
  const [competitorCreatives, setCompetitorCreatives] = useState<CompetitorCreative[]>([]);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [competitorFilter, setCompetitorFilter] = useState<string>('all');

  // Own creatives state
  const [ownLoading, setOwnLoading] = useState(false);
  const [ownCreatives, setOwnCreatives] = useState<UserCreative[]>([]);
  const [ownTexts, setOwnTexts] = useState<Record<string, string | null>>({});

  // Transcription state
  const [transcribingId, setTranscribingId] = useState<string | null>(null);

  // Video preview state
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  // Common filter
  const [mediaFilter, setMediaFilter] = useState<'all' | 'video' | 'image' | 'carousel'>(
    mediaTypeFilter === 'all' ? 'all' : mediaTypeFilter
  );

  // Загружаем данные при открытии диалога
  useEffect(() => {
    if (isOpen) {
      if (activeTab === 'competitor' && competitorCreatives.length === 0) {
        loadCompetitors();
        loadCompetitorCreatives();
      } else if (activeTab === 'own' && ownCreatives.length === 0) {
        loadOwnCreatives();
      }
    }
  }, [isOpen, activeTab]);

  // Перезагружаем при смене фильтра типа медиа
  useEffect(() => {
    if (isOpen) {
      if (activeTab === 'competitor') {
        loadCompetitorCreatives();
      }
    }
  }, [mediaFilter]);

  const loadCompetitors = async () => {
    try {
      const data = await competitorsApi.list(userAccountId, accountId);
      setCompetitors(data.map(c => ({ id: c.id, name: c.name })));
    } catch (error) {

    }
  };

  const loadCompetitorCreatives = async () => {
    setCompetitorLoading(true);
    try {
      const { creatives: data } = await competitorsApi.getAllCreatives(userAccountId, {
        mediaType: mediaFilter === 'all' ? 'all' : mediaFilter,
        limit: 100,
        top10Only: false,
        includeAll: true,
        accountId: accountId || undefined,
      });
      data.sort((a, b) => (b.score || 0) - (a.score || 0));
      setCompetitorCreatives(data);
    } catch (error) {

    } finally {
      setCompetitorLoading(false);
    }
  };

  const loadOwnCreatives = async () => {
    setOwnLoading(true);
    try {
      const data = await creativesApi.list(accountId);
      // Фильтруем по типу медиа если нужно
      const filtered = mediaFilter === 'all'
        ? data
        : data.filter(c => c.media_type === mediaFilter);
      setOwnCreatives(filtered);

      // Загружаем тексты для всех креативов
      await loadOwnTexts(filtered);
    } catch (error) {

    } finally {
      setOwnLoading(false);
    }
  };

  const loadOwnTexts = async (creatives: UserCreative[]) => {
    const texts: Record<string, string | null> = {};

    // Загружаем тексты параллельно
    await Promise.all(
      creatives.map(async (creative) => {
        if (creative.media_type) {
          const result = await creativesApi.getCreativeText(
            creative.id,
            creative.media_type,
            creative.carousel_data
          );
          texts[creative.id] = result.text;
        }
      })
    );

    setOwnTexts(texts);
  };

  const handleSelectCompetitor = (creative: CompetitorCreative) => {
    const analysisData = Array.isArray(creative.analysis) ? creative.analysis[0] : creative.analysis;
    const hasText = analysisData?.transcript || analysisData?.ocr_text || creative.body_text;

    const reference: CreativeReference = {
      creativeId: creative.id,
      source: 'competitor',
      body_text: creative.body_text,
      headline: creative.headline,
      ocr_text: analysisData?.ocr_text,
      transcript: analysisData?.transcript,
      media_type: creative.media_type,
      source_name: creative.competitor?.name,
      thumbnail_url: creative.thumbnail_url,
      score: creative.score,
    };
    onSelect(reference);
    setIsOpen(false);

    // Toast если нет текста
    if (!hasText) {
      toast.warning('У этого креатива нет транскрипции', {
        description: 'Введите текст референса вручную в поле задачи',
      });
    }
  };

  const handleSelectOwn = (creative: UserCreative) => {
    const text = ownTexts[creative.id];
    const hasText = !!text;

    const reference: CreativeReference = {
      creativeId: creative.id,
      source: 'own',
      transcript: creative.media_type === 'video' ? text || undefined : undefined,
      body_text: creative.media_type !== 'video' ? text || undefined : undefined,
      media_type: creative.media_type || 'video',
      source_name: 'Мой креатив',
      thumbnail_url: creative.thumbnail_url || creative.image_url || undefined,
    };
    onSelect(reference);
    setIsOpen(false);

    // Toast если нет текста
    if (!hasText) {
      if (creative.media_type === 'video') {
        toast.warning('У этого видео нет транскрипции', {
          description: 'Нажмите кнопку транскрибации или введите текст вручную',
        });
      } else {
        toast.warning('У этого креатива нет текста', {
          description: 'Введите текст референса вручную в поле задачи',
        });
      }
    }
  };

  // Транскрибация своего видео
  const handleTranscribe = async (e: React.MouseEvent, creative: UserCreative) => {
    e.stopPropagation(); // Не выбирать креатив при клике на кнопку

    if (transcribingId) return; // Уже идёт транскрибация

    setTranscribingId(creative.id);
    toast.info('Запускаем транскрибацию...', {
      description: 'Это может занять 1-2 минуты',
    });

    try {
      const result = await creativesApi.reTranscribe(creative.id, 'ru');

      if (result.success && result.text) {
        // Обновляем текст в локальном состоянии
        setOwnTexts(prev => ({
          ...prev,
          [creative.id]: result.text!,
        }));

        toast.success('Транскрипция готова!', {
          description: 'Теперь можно выбрать этот креатив как референс',
        });
      } else {
        toast.error('Не удалось транскрибировать', {
          description: result.error || 'Попробуйте позже',
        });
      }
    } catch (error) {

      toast.error('Ошибка транскрибации', {
        description: 'Проверьте подключение и попробуйте снова',
      });
    } finally {
      setTranscribingId(null);
    }
  };

  // Транскрибация креатива конкурента
  const handleTranscribeCompetitor = async (e: React.MouseEvent, creative: CompetitorCreative) => {
    e.stopPropagation(); // Не выбирать креатив при клике на кнопку

    if (transcribingId) return; // Уже идёт транскрибация

    setTranscribingId(creative.id);
    toast.info('Запускаем транскрибацию...', {
      description: creative.media_type === 'video' ? 'Это может занять 1-2 минуты' : 'Извлекаем текст с изображения',
    });

    try {
      const result = await competitorsApi.extractText(creative.id);

      if (result.success && result.text) {
        // Обновляем креатив в локальном состоянии
        setCompetitorCreatives(prev => prev.map(c => {
          if (c.id !== creative.id) return c;
          return {
            ...c,
            analysis: [{
              transcript: result.media_type === 'video' ? result.text : undefined,
              ocr_text: result.media_type !== 'video' ? result.text : undefined,
              processing_status: 'completed' as const,
            }],
          };
        }));

        toast.success(result.media_type === 'video' ? 'Транскрипция готова!' : 'Текст извлечён!', {
          description: 'Теперь можно выбрать этот креатив как референс',
        });
      } else {
        toast.error('Не удалось извлечь текст', {
          description: result.error || 'Попробуйте позже',
        });
      }
    } catch (error) {

      toast.error('Ошибка транскрибации', {
        description: 'Проверьте подключение и попробуйте снова',
      });
    } finally {
      setTranscribingId(null);
    }
  };

  // Просмотр видео конкурента
  const handlePreviewVideo = (e: React.MouseEvent, creative: CompetitorCreative) => {
    e.stopPropagation();
    const videoUrl = creative.media_urls?.[0];
    if (videoUrl) {
      setPreviewVideoUrl(videoUrl);
      setIsPreviewOpen(true);
    } else {
      toast.error('Видео недоступно');
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(null);
  };

  // Фильтруем креативы конкурентов
  const filteredCompetitorCreatives = competitorCreatives.filter(c => {
    const mediaMatch = mediaFilter === 'all' || c.media_type === mediaFilter;
    const competitorMatch = competitorFilter === 'all' || c.competitor?.id === competitorFilter;
    return mediaMatch && competitorMatch;
  });

  // Фильтруем свои креативы
  const filteredOwnCreatives = ownCreatives.filter(c => {
    return mediaFilter === 'all' || c.media_type === mediaFilter;
  });

  return (
    <div className={className}>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
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
                        {selectedReference.source === 'competitor' ? (
                          <>
                            <Users className="w-3 h-3 mr-1" />
                            {selectedReference.source_name || 'Конкурент'}
                          </>
                        ) : (
                          <>
                            <User className="w-3 h-3 mr-1" />
                            Мой креатив
                          </>
                        )}
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
                <FileText className="w-4 h-4" />
                <span>Выбрать референс</span>
              </Button>
            )}
          </div>
        </DialogTrigger>

        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Выберите креатив как референс
            </DialogTitle>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'competitor' | 'own')}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="competitor" className="flex items-center gap-2">
                <Users className="w-4 h-4" />
                Конкуренты
              </TabsTrigger>
              <TabsTrigger value="own" className="flex items-center gap-2">
                <User className="w-4 h-4" />
                Мои креативы
              </TabsTrigger>
            </TabsList>

            {/* Общие фильтры */}
            <div className="flex items-center gap-4 flex-wrap mt-4">
              {/* Фильтр типа медиа */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Тип:</span>
                <Select value={mediaFilter} onValueChange={(v) => setMediaFilter(v as any)}>
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

              {/* Фильтр по конкуренту (только для вкладки конкурентов) */}
              {activeTab === 'competitor' && (
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
              )}

              {/* Количество */}
              <span className="text-sm text-muted-foreground ml-auto">
                {activeTab === 'competitor'
                  ? `${filteredCompetitorCreatives.length} креативов`
                  : `${filteredOwnCreatives.length} креативов`
                }
              </span>
            </div>

            {/* Вкладка конкурентов */}
            <TabsContent value="competitor" className="mt-4">
              <ScrollArea className="h-[45vh]">
                {competitorLoading ? (
                  <div className="flex items-center justify-center h-32">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : filteredCompetitorCreatives.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-32 text-center">
                    <Users className="w-8 h-8 text-muted-foreground mb-2" />
                    <p className="text-muted-foreground">Нет креативов конкурентов</p>
                    <p className="text-sm text-muted-foreground">
                      Добавьте конкурентов в разделе "Конкуренты"
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 pr-4">
                    {filteredCompetitorCreatives.map((creative) => {
                      const MediaIcon = mediaTypeIcon[creative.media_type];
                      const previewUrl = creative.thumbnail_url || creative.media_urls?.[0];
                      const scoreCategory = getScoreCategory(creative.score);
                      const isSelected = selectedReference?.creativeId === creative.id;
                      const creativeAnalysis = Array.isArray(creative.analysis) ? creative.analysis[0] : creative.analysis;
                      const hasText = creativeAnalysis?.transcript || creativeAnalysis?.ocr_text;

                      // Блокируем выбор видео без транскрипции
                      const isDisabled = creative.media_type === 'video' && !hasText;

                      return (
                        <div
                          key={creative.id}
                          className={cn(
                            'flex items-center gap-3 p-2 rounded-lg border transition-all',
                            isDisabled
                              ? 'opacity-60 cursor-not-allowed'
                              : 'cursor-pointer hover:bg-accent/50',
                            isSelected && 'ring-2 ring-primary bg-primary/5'
                          )}
                          onClick={() => !isDisabled && handleSelectCompetitor(creative)}
                          title={isDisabled ? 'Сначала транскрибируйте видео' : undefined}
                        >
                          {/* Миниатюра */}
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

                          {/* Описание */}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm truncate">
                              {creative.body_text || creative.headline || 'Без описания'}
                            </p>
                          </div>

                          {/* Действия: просмотр видео, текст/транскрибация */}
                          <div className="shrink-0 flex items-center gap-1">
                            {/* Кнопка просмотра видео */}
                            {creative.media_type === 'video' && creative.media_urls?.[0] && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={(e) => handlePreviewVideo(e, creative)}
                                title="Смотреть видео"
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                            )}

                            {/* Индикатор текста или кнопка транскрибации */}
                            {hasText ? (
                              <Badge variant="secondary" className="text-xs">
                                <FileText className="w-3 h-3 mr-1" />
                                Текст
                              </Badge>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs gap-1"
                                onClick={(e) => handleTranscribeCompetitor(e, creative)}
                                disabled={transcribingId === creative.id}
                                title={creative.media_type === 'video' ? 'Транскрибировать' : 'Извлечь текст'}
                              >
                                {transcribingId === creative.id ? (
                                  <>
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  </>
                                ) : (
                                  <>
                                    <ScanText className="w-3 h-3" />
                                  </>
                                )}
                              </Button>
                            )}
                          </div>

                          {/* Галочка */}
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
            </TabsContent>

            {/* Вкладка своих креативов */}
            <TabsContent value="own" className="mt-4">
              <ScrollArea className="h-[45vh]">
                {ownLoading ? (
                  <div className="flex items-center justify-center h-32">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : filteredOwnCreatives.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-32 text-center">
                    <User className="w-8 h-8 text-muted-foreground mb-2" />
                    <p className="text-muted-foreground">Нет своих креативов</p>
                    <p className="text-sm text-muted-foreground">
                      Загрузите креативы в разделе "Креативы"
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 pr-4">
                    {filteredOwnCreatives.map((creative) => {
                      const mediaType = creative.media_type || 'video';
                      const MediaIcon = mediaTypeIcon[mediaType];
                      const previewUrl = creative.thumbnail_url || creative.image_url;
                      const isSelected = selectedReference?.creativeId === creative.id;
                      const hasText = !!ownTexts[creative.id];

                      // Блокируем выбор видео без транскрипции
                      const isDisabled = mediaType === 'video' && !hasText;

                      return (
                        <div
                          key={creative.id}
                          className={cn(
                            'flex items-center gap-3 p-2 rounded-lg border transition-all',
                            isDisabled
                              ? 'opacity-60 cursor-not-allowed'
                              : 'cursor-pointer hover:bg-accent/50',
                            isSelected && 'ring-2 ring-primary bg-primary/5'
                          )}
                          onClick={() => !isDisabled && handleSelectOwn(creative)}
                          title={isDisabled ? 'Сначала транскрибируйте видео' : undefined}
                        >
                          {/* Миниатюра */}
                          <div className="shrink-0 w-10 h-10 rounded overflow-hidden bg-muted flex items-center justify-center relative">
                            {previewUrl ? (
                              <img
                                src={previewUrl}
                                alt={creative.title || 'Креатив'}
                                className="w-full h-full object-cover"
                                loading="lazy"
                              />
                            ) : (
                              <MediaIcon className="w-5 h-5 text-muted-foreground" />
                            )}
                            {mediaType === 'video' && (
                              <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                                <PlayCircle className="w-4 h-4 text-white" />
                              </div>
                            )}
                          </div>

                          {/* Тип медиа */}
                          <div className="shrink-0 w-16 text-center">
                            <Badge variant="outline" className="text-xs">
                              {mediaType === 'video' && 'Видео'}
                              {mediaType === 'image' && 'Фото'}
                              {mediaType === 'carousel' && 'Карусель'}
                            </Badge>
                          </div>

                          {/* Название */}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm truncate">
                              {creative.title || 'Без названия'}
                            </p>
                          </div>

                          {/* Индикатор текста или кнопка транскрибации */}
                          <div className="shrink-0 w-24 flex justify-end">
                            {hasText ? (
                              <Badge variant="secondary" className="text-xs">
                                <FileText className="w-3 h-3 mr-1" />
                                Текст
                              </Badge>
                            ) : mediaType === 'video' ? (
                              // Кнопка транскрибации для видео без текста
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs gap-1"
                                onClick={(e) => handleTranscribe(e, creative)}
                                disabled={transcribingId === creative.id}
                              >
                                {transcribingId === creative.id ? (
                                  <>
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    <span className="hidden sm:inline">...</span>
                                  </>
                                ) : (
                                  <>
                                    <Mic className="w-3 h-3" />
                                    <span className="hidden sm:inline">Транскр.</span>
                                  </>
                                )}
                              </Button>
                            ) : (
                              <Badge variant="outline" className="text-xs text-muted-foreground">
                                <AlertCircle className="w-3 h-3 mr-1" />
                                Нет
                              </Badge>
                            )}
                          </div>

                          {/* Галочка */}
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
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Модальное окно просмотра видео */}
      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] p-0">
          <DialogHeader className="p-4 pb-0">
            <DialogTitle className="flex items-center gap-2">
              <PlayCircle className="w-5 h-5" />
              Просмотр видео
            </DialogTitle>
          </DialogHeader>
          <div className="p-4 pt-2">
            {previewVideoUrl && (
              <video
                src={previewVideoUrl}
                controls
                autoPlay
                className="w-full max-h-[70vh] rounded-lg bg-black"
              >
                Ваш браузер не поддерживает видео
              </video>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
