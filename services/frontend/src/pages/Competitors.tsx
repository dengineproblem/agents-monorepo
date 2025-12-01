import React, { useState, useEffect, useCallback } from 'react';
import Header from '@/components/Header';
import PageHero from '@/components/common/PageHero';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Users2, Eye, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { competitorsApi } from '@/services/competitorsApi';
import {
  AddCompetitorDialog,
  CompetitorsList,
  CompetitorCreativesGallery,
} from '@/components/competitors';
import type { Competitor, CompetitorCreative, CompetitorsPagination } from '@/types/competitor';
import { useTranslation } from '@/i18n/LanguageContext';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export default function Competitors() {
  const { t } = useTranslation();

  // User state
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Competitors state
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [selectedCompetitorId, setSelectedCompetitorId] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  // Creatives state
  const [creatives, setCreatives] = useState<CompetitorCreative[]>([]);
  const [creativesLoading, setCreativesLoading] = useState(false);
  const [pagination, setPagination] = useState<CompetitorsPagination>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
  const [mediaTypeFilter, setMediaTypeFilter] = useState<'all' | 'video' | 'image' | 'carousel'>('all');

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [competitorToDelete, setCompetitorToDelete] = useState<Competitor | null>(null);

  // Extract text state
  const [extractingCreativeId, setExtractingCreativeId] = useState<string | null>(null);

  // Get user ID from localStorage
  useEffect(() => {
    try {
      const storedUser = localStorage.getItem('user');
      if (storedUser) {
        const userData = JSON.parse(storedUser);
        if (userData?.id) {
          setUserId(userData.id);
        }
      }
    } catch (error) {
      console.error('Error parsing user from localStorage:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch competitors
  const fetchCompetitors = useCallback(async () => {
    if (!userId) return;

    try {
      const data = await competitorsApi.list(userId);
      setCompetitors(data);
    } catch (error) {
      console.error('Error fetching competitors:', error);
      toast.error('Ошибка загрузки конкурентов');
    }
  }, [userId]);

  useEffect(() => {
    if (userId) {
      fetchCompetitors();
    }
  }, [userId, fetchCompetitors]);

  // Fetch creatives
  const fetchCreatives = useCallback(async (page: number = 1) => {
    if (!userId) return;

    setCreativesLoading(true);

    try {
      let result;

      if (selectedCompetitorId) {
        // Креативы конкретного конкурента
        result = await competitorsApi.getCreatives(selectedCompetitorId, {
          page,
          limit: 20,
          mediaType: mediaTypeFilter,
        });
      } else {
        // Все креативы всех конкурентов
        result = await competitorsApi.getAllCreatives(userId, {
          page,
          limit: 20,
          mediaType: mediaTypeFilter,
        });
      }

      setCreatives(result.creatives);
      setPagination(result.pagination);
    } catch (error) {
      console.error('Error fetching creatives:', error);
      toast.error('Ошибка загрузки креативов');
    } finally {
      setCreativesLoading(false);
    }
  }, [userId, selectedCompetitorId, mediaTypeFilter]);

  useEffect(() => {
    if (userId && competitors.length > 0) {
      fetchCreatives(1);
    } else if (userId && competitors.length === 0) {
      setCreatives([]);
      setPagination({ page: 1, limit: 20, total: 0, totalPages: 0 });
    }
  }, [userId, selectedCompetitorId, mediaTypeFilter, competitors.length, fetchCreatives]);

  // Handlers
  const handleCompetitorAdded = (competitor: Competitor) => {
    setCompetitors((prev) => [competitor, ...prev]);
    setSelectedCompetitorId(competitor.id);
  };

  const handleRefresh = async (competitor: Competitor) => {
    setRefreshingId(competitor.id);

    try {
      const result = await competitorsApi.refresh(competitor.id);

      if (result.success) {
        toast.success(`Найдено ${result.result?.creatives_found || 0} креативов`);
        fetchCompetitors();
        if (selectedCompetitorId === competitor.id || selectedCompetitorId === null) {
          fetchCreatives(1);
        }
      } else {
        if (result.nextAllowedAt) {
          const nextTime = new Date(result.nextAllowedAt).toLocaleTimeString();
          toast.error(`Слишком частые обновления. Попробуйте после ${nextTime}`);
        } else {
          toast.error(result.error || 'Ошибка обновления');
        }
      }
    } catch (error) {
      toast.error('Ошибка обновления креативов');
    } finally {
      setRefreshingId(null);
    }
  };

  const handleDeleteClick = (competitor: Competitor) => {
    setCompetitorToDelete(competitor);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!competitorToDelete || !userId) return;

    try {
      const result = await competitorsApi.delete(competitorToDelete.user_competitor_id, userId);

      if (result.success) {
        toast.success('Конкурент удалён');
        setCompetitors((prev) => prev.filter((c) => c.id !== competitorToDelete.id));
        if (selectedCompetitorId === competitorToDelete.id) {
          setSelectedCompetitorId(null);
        }
      } else {
        toast.error(result.error || 'Ошибка удаления');
      }
    } catch (error) {
      toast.error('Ошибка удаления конкурента');
    } finally {
      setDeleteDialogOpen(false);
      setCompetitorToDelete(null);
    }
  };

  const handleCreativeClick = (creative: CompetitorCreative) => {
    // TODO: Открыть модалку с детальным просмотром
    console.log('Creative clicked:', creative);
  };

  const handleExtractText = async (creativeId: string) => {
    setExtractingCreativeId(creativeId);
    try {
      const result = await competitorsApi.extractText(creativeId);
      if (result.success) {
        toast.success(`Извлечено ${result.text?.length || 0} символов текста`);
        // Обновляем креативы чтобы показать текст
        fetchCreatives(pagination.page);
      } else {
        toast.error(result.error || 'Ошибка извлечения текста');
      }
    } catch (error) {
      toast.error('Ошибка извлечения текста');
    } finally {
      setExtractingCreativeId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">Необходима авторизация</p>
      </div>
    );
  }

  return (
    <>
      <Header />
      <PageHero
        title={t('competitors.title')}
        subtitle={t('competitors.subtitle')}
      />

      <div className="container mx-auto px-4 py-6">
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Левая колонка - список конкурентов */}
          <div className="w-full lg:w-72 flex-shrink-0 space-y-4">
            {/* Кнопка добавления */}
            <AddCompetitorDialog
              userAccountId={userId}
              onAdded={handleCompetitorAdded}
            />

            {/* Список конкурентов */}
            <CompetitorsList
              competitors={competitors}
              selectedId={selectedCompetitorId}
              onSelect={setSelectedCompetitorId}
              onRefresh={handleRefresh}
              onDelete={handleDeleteClick}
              refreshingId={refreshingId}
            />
          </div>

          {/* Правая колонка - галерея креативов */}
          <div className="flex-1">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Eye className="w-5 h-5" />
                    {t('competitors.creatives')}
                  </CardTitle>

                  <div className="flex items-center gap-2">
                    {/* Фильтр по типу медиа */}
                    <Select
                      value={mediaTypeFilter}
                      onValueChange={(value) => setMediaTypeFilter(value as any)}
                    >
                      <SelectTrigger className="w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('competitors.allTypes')}</SelectItem>
                        <SelectItem value="video">{t('competitors.video')}</SelectItem>
                        <SelectItem value="image">{t('competitors.image')}</SelectItem>
                        <SelectItem value="carousel">{t('competitors.carousel')}</SelectItem>
                      </SelectContent>
                    </Select>

                    {/* Кнопка обновить все */}
                    {selectedCompetitorId && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const competitor = competitors.find((c) => c.id === selectedCompetitorId);
                          if (competitor) handleRefresh(competitor);
                        }}
                        disabled={refreshingId !== null}
                      >
                        {refreshingId === selectedCompetitorId ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <RefreshCw className="w-4 h-4" />
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>

              <CardContent>
                {competitors.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-64 text-center">
                    <Users2 className="w-12 h-12 text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">{t('competitors.noCompetitors')}</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {t('competitors.addFirst')}
                    </p>
                  </div>
                ) : (
                  <CompetitorCreativesGallery
                    creatives={creatives}
                    loading={creativesLoading}
                    pagination={pagination}
                    onPageChange={fetchCreatives}
                    onCreativeClick={handleCreativeClick}
                    showCompetitorBadge={selectedCompetitorId === null}
                    onExtractText={handleExtractText}
                    extractingCreativeId={extractingCreativeId}
                  />
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('competitors.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('competitors.deleteDescription', { name: competitorToDelete?.name || '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>
              {t('competitors.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
