import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import Header from '../components/Header';
import { salesApi, ROIData, CampaignROI, Direction } from '../services/salesApi';
import { useAppContext } from '@/context/AppContext';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Target,
  Users,
  BarChart3,
  ExternalLink,
  RefreshCw,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Edit,
  Trash2,
  Save,
  X,
  ShoppingCart,
  Play,
  Filter,
  Sparkles,
  Video,
  Image,
  Images,
  Download
} from 'lucide-react';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { TooltipKeys } from '@/content/tooltips';
import { exportToCSV, formatAmountForExport } from '@/lib/exportUtils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import SalesList from '@/components/SalesList';
import { LeadsTab } from '@/components/roi/LeadsTab';
import { CreativeFunnelModal } from '@/components/CreativeFunnelModal';
import { API_BASE_URL, ANALYTICS_API_BASE_URL } from '@/config/api';
import { creativesApi } from '@/services/creativesApi';

// Конфигурация для badge типа медиа
type MediaType = 'video' | 'image' | 'carousel' | null | undefined;

const MEDIA_TYPE_CONFIG: Record<string, { icon: React.ComponentType<{ className?: string }>; label: string; className: string }> = {
  video: {
    icon: Video,
    label: 'Видео',
    className: 'bg-muted text-muted-foreground'
  },
  image: {
    icon: Image,
    label: 'Картинка',
    className: 'bg-muted text-muted-foreground'
  },
  carousel: {
    icon: Images,
    label: 'Карусель',
    className: 'bg-muted text-muted-foreground'
  }
};

// Компонент Badge типа медиа
const MediaTypeBadge: React.FC<{ mediaType: MediaType; showLabel?: boolean }> = ({ mediaType, showLabel = true }) => {
  if (!mediaType) return null;

  const config = MEDIA_TYPE_CONFIG[mediaType];
  if (!config) return null;

  const Icon = config.icon;

  return (
    <Badge className={`text-xs px-2 py-0.5 gap-1 flex items-center ${config.className}`}>
      <Icon className="h-3 w-3" />
      {showLabel && <span>{config.label}</span>}
    </Badge>
  );
};

// Утилита для получения thumbnail URL через Supabase Transform
const getThumbnailUrl = (url: string | null | undefined, width = 200, height = 250): string | null => {
  if (!url) return null;

  // Проверяем, что это Supabase Storage URL
  if (!url.includes('supabase')) return url;

  // Добавляем параметры трансформации
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}width=${width}&height=${height}`;
};

const ROIAnalytics: React.FC = () => {
  // Получаем currentAdAccountId из контекста для мультиаккаунтности
  const { currentAdAccountId } = useAppContext();

  const [roiData, setRoiData] = useState<ROIData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userAccountId, setUserAccountId] = useState<string>('');
  const [directions, setDirections] = useState<Direction[]>([]);
  const [selectedDirectionId, setSelectedDirectionId] = useState<string | null>(null);
  const [isPeriodMenuOpen, setIsPeriodMenuOpen] = useState(false);
  const [mediaTypeFilter, setMediaTypeFilter] = useState<'all' | 'video' | 'image' | 'carousel'>('all');
  const [activeMainTab, setActiveMainTab] = useState<'creatives' | 'leads' | 'sales'>('creatives');

  // Funnel modal state
  const [funnelModalOpen, setFunnelModalOpen] = useState(false);
  const [selectedCreative, setSelectedCreative] = useState<{ id: string; name: string } | null>(null);

  // Creative metrics state
  const [expandedCreativeId, setExpandedCreativeId] = useState<string | null>(null);
  const [creativeMetrics, setCreativeMetrics] = useState<any[]>([]);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [analyzingCreative, setAnalyzingCreative] = useState<string | null>(null);
  
  // Creative analysis and transcript state
  const [creativeAnalysis, setCreativeAnalysis] = useState<any>(null);
  const [creativeTranscript, setCreativeTranscript] = useState<string | null>(null);

  // Refresh/sync state
  const [isSyncing, setIsSyncing] = useState(false);

  /* TEMPORARILY HIDDEN: Key Stages Qualification Stats
  // Qualification stats state - now supports up to 3 key stages
  const [qualificationStats, setQualificationStats] = useState<{
    total_leads: number;
    key_stages: Array<{
      index: number;
      pipeline_name: string;
      status_name: string;
      qualified_leads: number;
      qualification_rate: number;
      creative_stats: Array<{
        creative_id: string;
        rate: number;
      }>;
    }>;
  } | null>(null);
  */



  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'KZT',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Форматирование в долларах (для метрик из Facebook)
  const formatUSD = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('ru-RU').format(num);
  };

  const formatPercent = (percent: number) => {
    return `${percent.toFixed(1)}%`;
  };

  const getMediaTypeLabel = (type: string | null | undefined) => {
    switch (type) {
      case 'video': return 'Видео';
      case 'image': return 'Картинка';
      case 'carousel': return 'Карусель';
      default: return '';
    }
  };

  const handleExportCreatives = () => {
    if (!roiData?.campaigns) return;

    exportToCSV(roiData.campaigns, [
      { header: 'Название', accessor: (c) => c.name },
      { header: 'Тип', accessor: (c) => getMediaTypeLabel(c.media_type) },
      { header: 'Выручка', accessor: (c) => formatAmountForExport(c.revenue) },
      { header: 'Затраты', accessor: (c) => formatAmountForExport(c.spend) },
      { header: 'ROI %', accessor: (c) => c.roi.toFixed(1) },
      { header: 'Лиды', accessor: (c) => c.leads },
      { header: '% квал', accessor: (c) => c.qualification?.rate !== undefined ? c.qualification.rate.toFixed(1) : '' },
      { header: 'Конверсия %', accessor: (c) => c.leads > 0 ? ((c.conversions / c.leads) * 100).toFixed(1) : '0' },
    ], 'creatives');
  };

  // Verdict metadata для отображения оценки
  const verdictMeta: Record<string, { label: string; emoji: string; className: string }> = {
    excellent: { label: "Отлично", emoji: "🌟", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200" },
    good: { label: "Хорошо", emoji: "👍", className: "bg-blue-100 text-blue-700 dark:bg-gray-800/40 dark:text-gray-300" },
    average: { label: "Средне", emoji: "😐", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200" },
    poor: { label: "Слабо", emoji: "👎", className: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200" },
  };

  /* TEMPORARILY HIDDEN: Key Stages Functions
  // Получить проценты квалификации по ключевым этапам для креатива
  const getCreativeKeyStageRates = (creativeId: string): string | null => {
    if (!qualificationStats || !qualificationStats.key_stages || qualificationStats.key_stages.length === 0) {
      return null;
    }

    const rates = qualificationStats.key_stages.map((stage) => {
      const creativeStats = stage.creative_stats.find(cs => cs.creative_id === creativeId);
      const rate = creativeStats?.rate || 0;
      return `КЭ${stage.index}: ${rate.toFixed(1)}%`;
    });

    return rates.join(' | ');
  };
  */

  // Загрузка направлений
  const loadDirections = async (userAccountId: string) => {
    try {
      const { data, error } = await salesApi.getDirections(userAccountId);
      if (error) {
        console.error('Ошибка загрузки направлений:', error);
        return;
      }
      setDirections(data);
    } catch (err) {
      console.error('Ошибка загрузки направлений:', err);
    }
  };

  /* TEMPORARILY HIDDEN: Key Stages Stats Loading
  // Загрузка статистики квалификации для выбранного направления (до 3 ключевых этапов)
  const loadQualificationStats = async (directionId: string) => {
    try {
      const { getDirectionKeyStageStats } = await import('@/services/amocrmApi');
      const stats = await getDirectionKeyStageStats(directionId);
      console.log('📊 Loaded qualification stats:', stats);
      setQualificationStats(stats);
    } catch (err) {
      console.error('❌ Ошибка загрузки статистики квалификации:', err);
      // Просто скрываем карточку при ошибке, не показываем моки
      setQualificationStats(null);
    }
  };
  */

  const loadROIData = async (tf?: 7 | 30 | 90 | 'all') => {
    try {
      setLoading(true);
      setError(null);
      
      const storedUser = localStorage.getItem('user');
      if (!storedUser) {
        throw new Error('Пользователь не авторизован');
      }
      
      const userData = JSON.parse(storedUser);
      const userId = userData?.id;
      
      if (!userId) {
        throw new Error('User ID не найден');
      }

      console.log('🔄 Загружаем ROI данные...', {
        userId,
        directionId: selectedDirectionId || 'все',
        timeframe: tf || 'all'
      });
      
      const data = await salesApi.getROIData(
        userId,
        selectedDirectionId,
        tf || 'all',
        mediaTypeFilter === 'all' ? null : mediaTypeFilter,
        currentAdAccountId || undefined  // UUID для мультиаккаунтности
      );
      
      console.log('✅ ROI данные загружены:', data);
      setRoiData(data);
    } catch (err) {
      console.error('Ошибка загрузки ROI данных:', err);
      setError(err instanceof Error ? err.message : 'Ошибка загрузки данных');
    } finally {
      setLoading(false);
    }
  };

  // Обновление таблицы + фоновая синхронизация AmoCRM для всех креативов
  const handleRefresh = async () => {
    // 1. Сначала обновляем таблицу
    await loadROIData();

    // 2. Запускаем синхронизацию AmoCRM фоном (если есть подключение)
    if (!userAccountId || !roiData?.campaigns?.length) return;

    setIsSyncing(true);
    try {
      // Получаем все уникальные creative_id из текущих данных
      const creativeIds = roiData.campaigns.map(c => c.id);

      // Синхронизируем каждый креатив фоном (параллельно, но с ограничением)
      const syncPromises = creativeIds.map(async (creativeId) => {
        try {
          await fetch(`${API_BASE_URL}/amocrm/sync-creative-leads?userAccountId=${userAccountId}&creativeId=${creativeId}`, {
            method: 'POST'
          });
        } catch (e) {
          // Игнорируем ошибки отдельных креативов
          console.warn(`Ошибка синхронизации креатива ${creativeId}:`, e);
        }
      });

      await Promise.all(syncPromises);

      // 3. После синхронизации обновляем таблицу ещё раз чтобы показать новые данные
      await loadROIData();
    } catch (err) {
      console.error('Ошибка синхронизации AmoCRM:', err);
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    // Инициализация при монтировании
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      const userData = JSON.parse(storedUser);
      const userId = userData?.id || '';
      setUserAccountId(userId);
      
      // Загружаем направления
      if (userId) {
        loadDirections(userId);
      }
    }
    
    loadROIData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Перезагрузка при смене направления, типа медиа или аккаунта
  useEffect(() => {
    if (userAccountId) {
      loadROIData();

      /* TEMPORARILY HIDDEN: Key Stages Stats Loading in useEffect
      // Load qualification stats only if direction is selected and has at least one key stage configured
      if (selectedDirectionId && directions.length > 0) {
        const direction = directions.find(d => d.id === selectedDirectionId);
        console.log('🔍 Direction found:', direction);
        console.log('🔍 Key stages:', {
          stage1: { pipeline: direction?.key_stage_1_pipeline_id, status: direction?.key_stage_1_status_id },
          stage2: { pipeline: direction?.key_stage_2_pipeline_id, status: direction?.key_stage_2_status_id },
          stage3: { pipeline: direction?.key_stage_3_pipeline_id, status: direction?.key_stage_3_status_id }
        });

        const hasKeyStage = (
          (direction?.key_stage_1_pipeline_id && direction?.key_stage_1_status_id) ||
          (direction?.key_stage_2_pipeline_id && direction?.key_stage_2_status_id) ||
          (direction?.key_stage_3_pipeline_id && direction?.key_stage_3_status_id)
        );

        if (hasKeyStage) {
          console.log('✅ Has key stages, loading stats for direction:', selectedDirectionId);
          loadQualificationStats(selectedDirectionId);
        } else {
          console.log('⚠️ No key stages configured for direction:', selectedDirectionId);
          setQualificationStats(null);
        }
      } else {
        setQualificationStats(null);
      }
      */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDirectionId, directions, mediaTypeFilter, currentAdAccountId]);

  const getROIBadgeVariant = (roi: number) => {
    if (roi > 0) return 'outline';
    return 'destructive';
  };

  const getROIBadgeClass = (roi: number) => {
    if (roi > 0) return 'bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700';
    return '';
  };

  const handleOpenFunnelModal = (creativeId: string, creativeName: string) => {
    setSelectedCreative({ id: creativeId, name: creativeName });
    setFunnelModalOpen(true);
  };

  // Загрузка метрик креатива, транскрипции/текста и анализа
  const loadCreativeMetrics = async (creativeId: string, campaign?: CampaignROI) => {
    if (expandedCreativeId === creativeId) {
      // Закрыть, если уже открыт
      setExpandedCreativeId(null);
      setCreativeMetrics([]);
      setCreativeAnalysis(null);
      setCreativeTranscript(null);
      return;
    }

    setExpandedCreativeId(creativeId);
    setLoadingMetrics(true);

    // Определяем тип медиа для креатива
    const mediaType = campaign?.media_type || 'video';

    try {
      // Параллельная загрузка метрик, анализа и текста/транскрипции
      const [metricsResult, analysisResult, textData] = await Promise.all([
        salesApi.getCreativeMetrics(creativeId, userAccountId, 30),
        salesApi.getCreativeAnalysis(creativeId, userAccountId),
        // Используем универсальный метод: для video - транскрипция, для image/carousel - текст
        creativesApi.getCreativeText(creativeId, mediaType, campaign?.carousel_data).catch(() => ({ text: null }))
      ]);

      if (metricsResult.error) {
        console.error('Ошибка загрузки метрик:', metricsResult.error);
        setCreativeMetrics([]);
      } else {
        setCreativeMetrics(metricsResult.data || []);
      }

      if (analysisResult.error) {
        console.log('Анализ не найден (ожидаемо при первой загрузке)', analysisResult.error);
        setCreativeAnalysis(null);
      } else {
        console.log('✅ Загружен анализ креатива:', analysisResult.data);
        setCreativeAnalysis(analysisResult.data);
      }

      setCreativeTranscript(textData.text);

    } catch (err) {
      console.error('Ошибка загрузки данных креатива:', err);
      setCreativeMetrics([]);
      setCreativeAnalysis(null);
      setCreativeTranscript(null);
    } finally {
      setLoadingMetrics(false);
    }
  };

  // Запуск анализа креатива
  const analyzeCreative = async (creativeId: string) => {
    setAnalyzingCreative(creativeId);
    
    try {
      // Вызываем API для анализа креатива (agent-brain)
      // Используем относительный путь, чтобы запрос шел через Vite proxy
      const analyzerUrl = ANALYTICS_API_BASE_URL 
        ? `${ANALYTICS_API_BASE_URL}/api/analyzer/analyze-creative`
        : '/api/analyzer/analyze-creative';
      
      const response = await fetch(analyzerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          creative_id: creativeId,
          user_id: userAccountId,
        }),
      });

      if (!response.ok) {
        throw new Error('Ошибка при запуске анализа');
      }

      const result = await response.json();
      console.log('✅ Анализ креатива завершен:', result);
      
      // Обновляем состояние анализа напрямую из результата
      if (result.analysis) {
        setCreativeAnalysis(result.analysis);
      }
      
      // Перезагружаем метрики и анализ
      const [metricsResult, analysisResult] = await Promise.all([
        salesApi.getCreativeMetrics(creativeId, userAccountId, 30),
        salesApi.getCreativeAnalysis(creativeId, userAccountId)
      ]);
      
      if (!metricsResult.error) {
        setCreativeMetrics(metricsResult.data || []);
      }
      
      if (!analysisResult.error && analysisResult.data) {
        setCreativeAnalysis(analysisResult.data);
      }
      
    } catch (err) {
      console.error('Ошибка анализа креатива:', err);
      alert('Ошибка при запуске анализа креатива');
    } finally {
      setAnalyzingCreative(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header onOpenDatePicker={() => {}}  />
        <main className="flex-1 container mx-auto py-4">
          <div className="mb-6">
            <div className="h-8 w-48 bg-muted rounded animate-pulse" />
          </div>
          
          {/* Общая статистика скелетон */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 animate-in fade-in duration-300">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <div className="h-4 w-32 bg-muted/70 rounded animate-pulse" />
                  <div className="h-4 w-4 bg-muted/70 rounded-full animate-pulse" />
                </CardHeader>
                <CardContent>
                  <div className="relative h-8 w-36 overflow-hidden rounded-md">
                    <div className="absolute inset-0 bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 animate-pulse" />
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/60 to-transparent animate-shimmer" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </main>
      </div>
    );
  }


  if (error) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header onOpenDatePicker={() => {}}  />
        <main className="flex-1 container mx-auto px-4 py-8">
          <Card className="max-w-md mx-auto shadow-sm">
            <CardContent className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="p-3 rounded-full bg-red-100 inline-flex items-center justify-center mb-4">
                  <AlertCircle className="h-8 w-8 text-red-600 dark:text-red-500/70" />
                </div>
                <h2 className="text-lg font-semibold mb-2">Ошибка загрузки</h2>
                <p className="text-sm text-muted-foreground mb-6">{error}</p>
                <Button 
                  onClick={() => loadROIData()}
                  variant="outline"
                  className="transition-all duration-200"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Попробовать снова
                </Button>
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="w-full max-w-full overflow-x-hidden">
      <Header onOpenDatePicker={() => setIsPeriodMenuOpen(true)} />
      
      {/* Меню периодов - позиционируется относительно кнопки календаря */}
      {isPeriodMenuOpen && (
        <div 
          className="fixed inset-0 z-50" 
          onClick={() => setIsPeriodMenuOpen(false)}
        >
          <div 
            className="absolute top-[60px] right-[120px] bg-popover text-popover-foreground rounded-md border shadow-md p-1 min-w-[8rem]"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
              onClick={() => { loadROIData(7); setIsPeriodMenuOpen(false); }}
            >
              7 дней
            </div>
            <div
              className="relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
              onClick={() => { loadROIData(30); setIsPeriodMenuOpen(false); }}
            >
              30 дней
            </div>
            <div
              className="relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
              onClick={() => { loadROIData(90); setIsPeriodMenuOpen(false); }}
            >
              90 дней
            </div>
            <div
              className="relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
              onClick={() => { loadROIData('all'); setIsPeriodMenuOpen(false); }}
            >
              Всё время
            </div>
          </div>
        </div>
      )}
      
      <div className="container mx-auto px-4 py-6 pt-[76px] max-w-full">
        {/* Хедер с заголовком */}
        <div className="mb-6">
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold tracking-tight">ROI Аналитика</h1>
            <HelpTooltip tooltipKey={TooltipKeys.ROI_OVERVIEW} iconSize="md" />
          </div>
          <p className="text-muted-foreground mt-2">Отслеживайте окупаемость ваших рекламных кампаний</p>
        </div>
        
        {/* Подраздел: Обзор */}
        <div className="mb-6">
          <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Обзор
          </h2>

          {/* Фильтр по направлениям - в стиле табов */}
          {directions.length > 0 && (
            <div className="mb-4">
              {/* Десктоп: табы */}
              <div className="hidden md:block">
                <Tabs value={selectedDirectionId || 'all'} onValueChange={(value) => setSelectedDirectionId(value === 'all' ? null : value)}>
                  <TabsList className="bg-muted">
                    <TabsTrigger value="all">Все направления</TabsTrigger>
                    {directions.map((direction) => (
                      <TabsTrigger key={direction.id} value={direction.id}>
                        {direction.name}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </div>

              {/* Мобилка: выпадающий список */}
              <div className="md:hidden">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="w-full justify-between">
                      <span>
                        {selectedDirectionId
                          ? directions.find(d => d.id === selectedDirectionId)?.name
                          : 'Все направления'}
                      </span>
                      <ChevronDown className="h-4 w-4 ml-2" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-[calc(100vw-2rem)]">
                    <DropdownMenuItem onClick={() => setSelectedDirectionId(null)}>
                      Все направления
                    </DropdownMenuItem>
                    {directions.map((direction) => (
                      <DropdownMenuItem
                        key={direction.id}
                        onClick={() => setSelectedDirectionId(direction.id)}
                      >
                        {direction.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          <Card className="transition-all duration-200 hover:shadow-md shadow-sm">
            <CardContent className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="p-1.5 rounded-lg bg-muted flex-shrink-0">
                  <DollarSign className="h-4 w-4 text-green-600 dark:text-green-500/70" />
                </div>
                <p className="text-xs text-muted-foreground leading-tight flex-1">Общая выручка</p>
              </div>
              <p className="text-lg font-semibold text-green-600 dark:text-green-500/70">
                {formatCurrency(roiData?.totalRevenue || 0)}
              </p>
            </CardContent>
          </Card>

          <Card className="transition-all duration-200 hover:shadow-md shadow-sm">
            <CardContent className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="p-1.5 rounded-lg bg-muted flex-shrink-0">
                  <TrendingDown className="h-4 w-4 text-slate-600" />
                </div>
                <p className="text-xs text-muted-foreground leading-tight flex-1">Общие затраты</p>
              </div>
              <p className="text-lg font-semibold text-slate-600">
                {formatCurrency(roiData?.totalSpend || 0)}
              </p>
            </CardContent>
          </Card>

          <Card className="transition-all duration-200 hover:shadow-md shadow-sm">
            <CardContent className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="p-1.5 rounded-lg bg-muted flex-shrink-0">
                  {roiData?.totalROI && roiData.totalROI > 0 ? (
                    <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-500/70" />
                  ) : (
                    <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-500/70" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground leading-tight flex-1">Общий ROI</p>
              </div>
              <p className={`text-lg font-semibold ${roiData?.totalROI && roiData.totalROI > 0 ? 'text-green-600 dark:text-green-500/70' : 'text-red-600 dark:text-red-500/70'}`}>
                {formatPercent(roiData?.totalROI || 0)}
              </p>
            </CardContent>
          </Card>

          {/* TEMPORARILY HIDDEN: Key Stages Card
          <Card className="transition-all duration-200 hover:shadow-md shadow-sm">
            <CardContent className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="p-1.5 rounded-lg bg-muted flex-shrink-0">
                  <Target className="h-4 w-4 text-blue-600 dark:text-blue-500/70" />
                </div>
                <p className="text-xs text-muted-foreground leading-tight flex-1">Ключевые этапы</p>
              </div>
              {qualificationStats && qualificationStats.key_stages.length > 0 ? (
                <div className="space-y-1.5">
                  {qualificationStats.key_stages.map((stage) => (
                    <div key={stage.index} className="space-y-0.5">
                      <div className="flex justify-between items-center">
                        <p className="text-xs text-muted-foreground">
                          КЭ{stage.index}: {stage.status_name}
                        </p>
                        <p className="text-sm font-semibold text-blue-600 dark:text-blue-500/70">
                          {formatPercent(stage.qualification_rate)}
                        </p>
                      </div>
                      <div className="flex justify-between items-center">
                        <p className="text-xs text-muted-foreground/80">
                          Лидов на этапе:
                        </p>
                        <p className="text-xs font-medium text-blue-600 dark:text-blue-500/70">
                          {stage.qualified_leads} из {qualificationStats.total_leads}
                        </p>
                      </div>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground mt-2 pt-2 border-t border-slate-200">
                    Всего лидов: {qualificationStats.total_leads}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {selectedDirectionId ? 'Не настроено' : 'Выберите направление'}
                </p>
              )}
            </CardContent>
          </Card>
          */}
          </div>
        </div>

        {/* Главные табы: Креативы / Лиды / Продажи */}
        <Tabs value={activeMainTab} onValueChange={(v) => setActiveMainTab(v as typeof activeMainTab)} className="mb-6">
          <TabsList className="bg-muted mb-4">
            <TabsTrigger value="creatives" className="flex items-center gap-1.5">
              <BarChart3 className="h-3.5 w-3.5" />
              Креативы ({roiData?.campaigns?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="leads" className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" />
              Лиды
            </TabsTrigger>
            <TabsTrigger value="sales" className="flex items-center gap-1.5">
              <ShoppingCart className="h-3.5 w-3.5" />
              Продажи
            </TabsTrigger>
          </TabsList>

          {/* Контент: Креативы */}
          <TabsContent value="creatives">
        {/* Подраздел: Креативы */}
        <div className="mb-6">
          {/* Фильтр по типу медиа - в стиле табов + кнопка экспорта */}
          <div className="mb-4 flex items-center justify-between gap-4">
            {/* Десктоп: табы */}
            <div className="hidden md:block">
              <Tabs value={mediaTypeFilter} onValueChange={(v) => setMediaTypeFilter(v as typeof mediaTypeFilter)}>
                <TabsList className="bg-muted">
                  <TabsTrigger value="all">Все типы</TabsTrigger>
                  <TabsTrigger value="video" className="flex items-center gap-1.5">
                    <Video className="h-3.5 w-3.5" />
                    Видео
                  </TabsTrigger>
                  <TabsTrigger value="image" className="flex items-center gap-1.5">
                    <Image className="h-3.5 w-3.5" />
                    Картинки
                  </TabsTrigger>
                  <TabsTrigger value="carousel" className="flex items-center gap-1.5">
                    <Images className="h-3.5 w-3.5" />
                    Карусели
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {/* Мобилка: выпадающий список */}
            <div className="md:hidden flex-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full justify-between">
                    <span className="flex items-center gap-2">
                      {mediaTypeFilter === 'all' && 'Все типы'}
                      {mediaTypeFilter === 'video' && <><Video className="h-3.5 w-3.5" /> Видео</>}
                      {mediaTypeFilter === 'image' && <><Image className="h-3.5 w-3.5" /> Картинки</>}
                      {mediaTypeFilter === 'carousel' && <><Images className="h-3.5 w-3.5" /> Карусели</>}
                    </span>
                    <ChevronDown className="h-4 w-4 ml-2" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-[calc(100vw-2rem)]">
                  <DropdownMenuItem onClick={() => setMediaTypeFilter('all')}>
                    Все типы
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setMediaTypeFilter('video')} className="flex items-center gap-2">
                    <Video className="h-3.5 w-3.5" /> Видео
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setMediaTypeFilter('image')} className="flex items-center gap-2">
                    <Image className="h-3.5 w-3.5" /> Картинки
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setMediaTypeFilter('carousel')} className="flex items-center gap-2">
                    <Images className="h-3.5 w-3.5" /> Карусели
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Кнопки обновления и экспорта - справа */}
            <div className="flex items-center gap-2 ml-auto">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs flex-shrink-0"
                onClick={handleRefresh}
                disabled={loading || isSyncing}
              >
                <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", isSyncing && "animate-spin")} />
                {isSyncing ? 'Синхронизация...' : 'Обновить'}
              </Button>
              {roiData?.campaigns && roiData.campaigns.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs flex-shrink-0"
                  onClick={handleExportCreatives}
                >
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  Экспорт
                </Button>
              )}
            </div>
          </div>

          {roiData?.campaigns && roiData.campaigns.length > 0 ? (
            <>
              {/* Десктопная таблица */}
              <div className="hidden md:block">
                <Card className="shadow-sm">
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="min-w-full">
                        <thead className="bg-muted/50 border-b">
                          <tr>
                            <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground">Название креатива</th>
                            <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground">Тип</th>
                            <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground">Выручка</th>
                            <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground">Затраты</th>
                            <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground">ROI</th>
                            <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground">Лиды</th>
                            <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground">CPL</th>
                            <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground">% квал</th>
                            <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground">Конверсия %</th>
                            {/* TEMPORARILY HIDDEN: Key Stages Column Header
                            {qualificationStats && qualificationStats.key_stages.length > 0 && (
                              <th className="py-2 px-3 text-center text-xs font-medium text-muted-foreground">Ключевые этапы</th>
                            )}
                            */}
                            <th className="py-2 px-3 text-center text-xs font-medium text-muted-foreground">Воронка</th>
                            <th className="py-2 px-3 text-center text-xs font-medium text-muted-foreground">Ссылка</th>
                            <th className="py-2 px-3 text-center text-xs font-medium text-muted-foreground">Детали</th>
                          </tr>
                        </thead>
                        <tbody>
                          {roiData.campaigns.map((campaign, index) => (
                            <React.Fragment key={campaign.id}>
                              <tr className={cn(
                                "border-b hover:bg-muted/30 transition-all duration-200",
                                expandedCreativeId === campaign.id && "ring-2 ring-primary/50 bg-primary/5"
                              )}>
                                <td className="py-2 px-3">
                                  <div className="flex items-center gap-2">
                                    {/* Миниатюра креатива 40x40 */}
                                    <div className="shrink-0 w-10 h-10 rounded overflow-hidden bg-muted flex items-center justify-center">
                                      {(() => {
                                        // Для видео - используем thumbnail_url
                                        // Для картинки - image_url
                                        // Для карусели - первая картинка из carousel_data
                                        const previewUrl = campaign.media_type === 'video'
                                          ? campaign.thumbnail_url
                                          : campaign.media_type === 'carousel' && campaign.carousel_data?.[0]
                                            ? (campaign.carousel_data[0].image_url || campaign.carousel_data[0].image_url_4k)
                                            : campaign.image_url;

                                        if (previewUrl) {
                                          return (
                                            <img
                                              src={getThumbnailUrl(previewUrl, 80, 80) || previewUrl}
                                              alt=""
                                              className="w-full h-full object-cover"
                                              loading="lazy"
                                            />
                                          );
                                        }

                                        // Fallback - иконка типа медиа
                                        const Icon = campaign.media_type ? MEDIA_TYPE_CONFIG[campaign.media_type]?.icon : Image;
                                        return Icon ? <Icon className="w-5 h-5 text-muted-foreground" /> : null;
                                      })()}
                                    </div>
                                    <div className="font-medium text-sm">{campaign.name}</div>
                                  </div>
                                </td>
                                <td className="py-2 px-3 text-left">
                                  <MediaTypeBadge mediaType={campaign.media_type} showLabel={false} />
                                </td>
                                <td className="py-2 px-3 text-left text-sm font-medium text-green-600 dark:text-green-500/70">
                                  {formatCurrency(campaign.revenue)}
                                </td>
                                <td className="py-2 px-3 text-left text-sm font-medium text-slate-600">
                                  {formatCurrency(campaign.spend)}
                                </td>
                                <td className="py-2 px-3 text-left">
                                  <Badge
                                    variant={getROIBadgeVariant(campaign.roi)}
                                    className={`text-xs ${getROIBadgeClass(campaign.roi)}`}
                                  >
                                    {formatPercent(campaign.roi)}
                                  </Badge>
                                </td>
                                <td className="py-2 px-3 text-left text-sm">
                                  {formatNumber(campaign.leads)}
                                </td>
                                <td className="py-2 px-3 text-left text-sm">
                                  {campaign.leads > 0
                                    ? formatUSD(campaign.spend / 530 / campaign.leads)
                                    : '—'
                                  }
                                </td>
                                <td className="py-2 px-3 text-left text-sm">
                                  {campaign.qualification?.rate !== undefined
                                    ? `${campaign.qualification.rate.toFixed(1)}%`
                                    : '—'
                                  }
                                </td>
                                <td className="py-2 px-3 text-left text-sm">
                                  {campaign.leads > 0 ?
                                    `${((campaign.conversions / campaign.leads) * 100).toFixed(1)}%`
                                    : '0%'
                                  }
                                </td>
                                {/* TEMPORARILY HIDDEN: Key Stages Cell
                                {qualificationStats && qualificationStats.key_stages.length > 0 && (
                                  <td className="py-2 px-3 text-center">
                                    <div className="text-xs text-blue-700 dark:text-blue-400 font-medium whitespace-nowrap">
                                      {getCreativeKeyStageRates(campaign.id)}
                                    </div>
                                  </td>
                                )}
                                */}
                                <td className="py-2 px-3 text-center">
                                  <button
                                    onClick={() => handleOpenFunnelModal(campaign.id, campaign.name)}
                                    className="inline-flex items-center justify-center text-slate-600 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300 transition-colors"
                                    title="View funnel distribution"
                                  >
                                    <Filter className="h-4 w-4" />
                                  </button>
                                </td>
                                <td className="py-2 px-3 text-center">
                                  {campaign.creative_url ? (
                                    <a
                                      href={campaign.creative_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center justify-center text-foreground hover:text-foreground/70 transition-colors"
                                    >
                                      <ExternalLink className="h-4 w-4" />
                                    </a>
                                  ) : (
                                    <span className="text-muted-foreground text-xs">—</span>
                                  )}
                                </td>
                                <td className="py-2 px-3 text-center">
                                  <button
                                    onClick={() => loadCreativeMetrics(campaign.id, campaign)}
                                    className="inline-flex items-center justify-center text-foreground hover:text-foreground/70 transition-colors"
                                    title="Показать детали"
                                  >
                                    {expandedCreativeId === campaign.id ? (
                                      <ChevronUp className="h-4 w-4" />
                                    ) : (
                                      <ChevronDown className="h-4 w-4" />
                                    )}
                                  </button>
                                </td>
                              </tr>
                              {expandedCreativeId === campaign.id && (
                                <tr className="border-b">
                                  <td colSpan={12} className="p-4 bg-muted/20">
                                    {loadingMetrics ? (
                                      <div className="text-center py-4">
                                        <RefreshCw className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                                        <p className="text-sm text-muted-foreground mt-2">Загрузка метрик...</p>
                                      </div>
                                    ) : (
                                      <div className="space-y-4">
                                        {/* Миниатюры для image/carousel */}
                                        {campaign.media_type === 'image' && campaign.image_url && (
                                          <Card className="bg-muted/30">
                                            <CardHeader className="pb-3">
                                              <CardTitle className="text-sm flex items-center gap-2">
                                                🖼️ Превью креатива
                                              </CardTitle>
                                            </CardHeader>
                                            <CardContent>
                                              <img
                                                src={getThumbnailUrl(campaign.image_url) || campaign.image_url}
                                                alt={campaign.name}
                                                className="rounded-lg max-w-[200px] max-h-[250px] object-contain"
                                                loading="lazy"
                                              />
                                            </CardContent>
                                          </Card>
                                        )}

                                        {campaign.media_type === 'carousel' && campaign.carousel_data && campaign.carousel_data.length > 0 && (
                                          <Card className="bg-muted/30">
                                            <CardHeader className="pb-3">
                                              <CardTitle className="text-sm flex items-center gap-2">
                                                🖼️ Карточки карусели ({campaign.carousel_data.length})
                                              </CardTitle>
                                            </CardHeader>
                                            <CardContent>
                                              <div className="flex gap-3 overflow-x-auto pb-2">
                                                {campaign.carousel_data
                                                  .sort((a, b) => a.order - b.order)
                                                  .map((card, idx) => (
                                                    <div key={idx} className="flex-shrink-0">
                                                      <img
                                                        src={getThumbnailUrl(card.image_url || card.image_url_4k) || card.image_url || card.image_url_4k}
                                                        alt={`Карточка ${idx + 1}`}
                                                        className="rounded-lg w-[150px] h-[188px] object-cover"
                                                        loading="lazy"
                                                      />
                                                      <div className="text-xs text-muted-foreground mt-1 text-center">
                                                        Карточка {idx + 1}
                                                      </div>
                                                    </div>
                                                  ))}
                                              </div>
                                            </CardContent>
                                          </Card>
                                        )}

                                        {/* Текст/Транскрипция */}
                                        <Card className="bg-muted/30">
                                          <CardHeader className="pb-3">
                                            <CardTitle className="text-sm flex items-center gap-2">
                                              {campaign.media_type === 'video' ? '📝 Транскрибация видео' : '📝 Текст креатива'}
                                            </CardTitle>
                                          </CardHeader>
                                          <CardContent>
                                            <div className="text-sm whitespace-pre-wrap text-muted-foreground">
                                              {creativeTranscript || (
                                                campaign.media_type === 'video'
                                                  ? 'Транскрибация еще не готова. Она появится после обработки видео.'
                                                  : 'Текст недоступен'
                                              )}
                                            </div>
                                          </CardContent>
                                        </Card>

                                        {/* Видео досмотры */}
                                        {(() => {
                                          const totalMetrics = creativeMetrics.reduce((acc, metric) => ({
                                            video_views: acc.video_views + (metric.video_views || 0),
                                            video_views_25: acc.video_views_25 + (metric.video_views_25_percent || 0),
                                            video_views_50: acc.video_views_50 + (metric.video_views_50_percent || 0),
                                            video_views_75: acc.video_views_75 + (metric.video_views_75_percent || 0),
                                            video_views_95: acc.video_views_95 + (metric.video_views_95_percent || 0),
                                            video_avg_watch_time_sec: metric.video_avg_watch_time_sec || 0
                                          }), { video_views: 0, video_views_25: 0, video_views_50: 0, video_views_75: 0, video_views_95: 0, video_avg_watch_time_sec: 0 });
                                          
                                          if (totalMetrics.video_views === 0) return null;

                                          const formatSeconds = (sec: number) => {
                                            if (!sec || sec === 0) return '0с';
                                            if (sec < 60) return `${Math.round(sec)}с`;
                                            const m = Math.floor(sec / 60);
                                            const s = Math.round(sec % 60);
                                            return `${m}м ${s}с`;
                                          };

                                          return (
                                            <div className="space-y-3">
                                              <div className="flex items-center gap-2">
                                                <TrendingUp className="h-4 w-4 text-primary" />
                                                <div className="text-sm font-medium">Досмотры видео</div>
                                              </div>
                                              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                                <div className="rounded-lg border p-3 space-y-1">
                                                  <div className="text-xs text-muted-foreground">25%</div>
                                                  <div className="text-lg font-semibold">{formatNumber(totalMetrics.video_views_25)}</div>
                                                  <div className="text-xs text-muted-foreground">
                                                    {totalMetrics.video_views > 0 ? Math.round((totalMetrics.video_views_25 / totalMetrics.video_views) * 100) : 0}% от просмотров
                                                  </div>
                                                </div>
                                                <div className="rounded-lg border p-3 space-y-1">
                                                  <div className="text-xs text-muted-foreground">50%</div>
                                                  <div className="text-lg font-semibold">{formatNumber(totalMetrics.video_views_50)}</div>
                                                  <div className="text-xs text-muted-foreground">
                                                    {totalMetrics.video_views > 0 ? Math.round((totalMetrics.video_views_50 / totalMetrics.video_views) * 100) : 0}% от просмотров
                                                  </div>
                                                </div>
                                                <div className="rounded-lg border p-3 space-y-1">
                                                  <div className="text-xs text-muted-foreground">75%</div>
                                                  <div className="text-lg font-semibold">{formatNumber(totalMetrics.video_views_75)}</div>
                                                  <div className="text-xs text-muted-foreground">
                                                    {totalMetrics.video_views > 0 ? Math.round((totalMetrics.video_views_75 / totalMetrics.video_views) * 100) : 0}% от просмотров
                                                  </div>
                                                </div>
                                                <div className="rounded-lg border p-3 space-y-1">
                                                  <div className="text-xs text-muted-foreground">95%</div>
                                                  <div className="text-lg font-semibold">{formatNumber(totalMetrics.video_views_95)}</div>
                                                  <div className="text-xs text-muted-foreground">
                                                    {totalMetrics.video_views > 0 ? Math.round((totalMetrics.video_views_95 / totalMetrics.video_views) * 100) : 0}% от просмотров
                                                  </div>
                                                </div>
                                              </div>
                                              <div className="text-xs text-muted-foreground">
                                                Среднее время просмотра: {formatSeconds(totalMetrics.video_avg_watch_time_sec)} · Всего просмотров: {formatNumber(totalMetrics.video_views)}
                                              </div>
                                            </div>
                                          );
                                        })()}

                                        {/* Кнопка запуска анализа */}
                                        <div className="flex items-center justify-between">
                                          <h4 className="font-semibold text-sm">LLM Анализ креатива</h4>
                                          <Button
                                            size="sm"
                                            onClick={() => analyzeCreative(campaign.id)}
                                            disabled={analyzingCreative === campaign.id}
                                            className="flex items-center gap-2"
                                          >
                                            {analyzingCreative === campaign.id ? (
                                              <>
                                                <RefreshCw className="h-3 w-3 animate-spin" />
                                                Анализ...
                                              </>
                                            ) : (
                                              <>
                                                <Play className="h-3 w-3" />
                                                Запустить анализ
                                              </>
                                            )}
                                          </Button>
                                        </div>

                                        {/* LLM Анализ */}
                                        {creativeAnalysis && creativeAnalysis.score !== null && (
                                          <Card className="border-primary/30 bg-primary/5">
                                            <CardHeader className="pb-2">
                                              <CardTitle className="text-sm flex items-center gap-2">
                                                <span className={`rounded-full px-2 py-0.5 text-xs ${verdictMeta[creativeAnalysis.verdict]?.className || ''}`}>
                                                  {verdictMeta[creativeAnalysis.verdict]?.emoji} {verdictMeta[creativeAnalysis.verdict]?.label}
                                                </span>
                                                <span className="text-muted-foreground">Оценка: {creativeAnalysis.score}/100</span>
                                              </CardTitle>
                                            </CardHeader>
                                            <CardContent className="space-y-2 text-sm text-muted-foreground">
                                              {creativeAnalysis.reasoning && <div>{creativeAnalysis.reasoning}</div>}
                                              {creativeAnalysis.video_analysis && (
                                                <div>
                                                  <span className="font-medium text-foreground">Видео:</span> {creativeAnalysis.video_analysis}
                                                </div>
                                              )}
                                              {creativeAnalysis.text_recommendations && (
                                                <div>
                                                  <span className="font-medium text-foreground">Текст:</span> {creativeAnalysis.text_recommendations}
                                                </div>
                                              )}
                                              {creativeAnalysis.transcript_match_quality && (
                                                <div>
                                                  <span className="font-medium text-foreground">Соответствие транскрипта:</span> {creativeAnalysis.transcript_match_quality}
                                                </div>
                                              )}
                                              {creativeAnalysis.transcript_suggestions && Array.isArray(creativeAnalysis.transcript_suggestions) && creativeAnalysis.transcript_suggestions.length > 0 && (
                                                <div className="space-y-2">
                                                  <div className="font-medium text-foreground">Предложения по тексту</div>
                                                  <div className="space-y-2">
                                                    {creativeAnalysis.transcript_suggestions.map((suggestion: any, index: number) => (
                                                      <div key={`${suggestion.from}-${index}`} className="rounded-md border p-2">
                                                        <div className="text-xs text-muted-foreground">Исходный текст</div>
                                                        <div className="text-sm font-medium">"{suggestion.from}"</div>
                                                        <div className="text-xs text-muted-foreground mt-2">Новый текст</div>
                                                        <div className="text-sm font-medium text-foreground">"{suggestion.to}"</div>
                                                        <div className="text-xs text-muted-foreground mt-2">Почему: {suggestion.reason}</div>
                                                      </div>
                                                    ))}
                                                  </div>
                                                </div>
                                              )}
                                            </CardContent>
                                          </Card>
                                        )}

                                        {/* История метрик */}
                                        {creativeMetrics.length > 0 && (() => {
                                          // Вычисляем СУММУ за весь период
                                          const totalMetrics = creativeMetrics.reduce((acc, metric) => ({
                                            impressions: acc.impressions + (metric.impressions || 0),
                                            reach: acc.reach + (metric.reach || 0),
                                            clicks: acc.clicks + (metric.clicks || 0),
                                            leads: acc.leads + (metric.leads || 0),
                                            spend: acc.spend + (metric.spend || 0),
                                            video_views: acc.video_views + (metric.video_views || 0),
                                            video_views_25: acc.video_views_25 + (metric.video_views_25_percent || 0),
                                            video_views_50: acc.video_views_50 + (metric.video_views_50_percent || 0),
                                            video_views_75: acc.video_views_75 + (metric.video_views_75_percent || 0)
                                          }), { impressions: 0, reach: 0, clicks: 0, leads: 0, spend: 0, video_views: 0, video_views_25: 0, video_views_50: 0, video_views_75: 0 });
                                          
                                          const totalCTR = totalMetrics.impressions > 0 
                                            ? (totalMetrics.clicks / totalMetrics.impressions) * 100 
                                            : 0;
                                          const totalCPM = totalMetrics.impressions > 0 
                                            ? (totalMetrics.spend / totalMetrics.impressions) * 1000 
                                            : 0;
                                          const totalCPL = totalMetrics.leads > 0 
                                            ? totalMetrics.spend / totalMetrics.leads 
                                            : 0;
                                          
                                          return (
                                            <div className="bg-primary/5 rounded-lg p-3 border border-primary/10">
                                              <h4 className="font-semibold text-sm mb-2 text-primary">📊 Статистика креатива</h4>
                                              <div className="grid grid-cols-4 gap-2 text-xs">
                                                <div className="font-medium"><span className="text-muted-foreground">Показы:</span> {formatNumber(totalMetrics.impressions)}</div>
                                                <div className="font-medium"><span className="text-muted-foreground">Охват:</span> {formatNumber(totalMetrics.reach)}</div>
                                                <div className="font-medium"><span className="text-muted-foreground">Клики:</span> {formatNumber(totalMetrics.clicks)}</div>
                                                <div className="font-medium"><span className="text-muted-foreground">CTR:</span> {totalCTR.toFixed(2)}%</div>
                                                <div className="font-medium"><span className="text-muted-foreground">Лиды:</span> {formatNumber(totalMetrics.leads)}</div>
                                                <div className="font-medium"><span className="text-muted-foreground">Расход:</span> {formatUSD(totalMetrics.spend)}</div>
                                                <div className="font-medium"><span className="text-muted-foreground">CPM:</span> {formatUSD(totalCPM)}</div>
                                                <div className="font-medium"><span className="text-muted-foreground">CPL:</span> {totalMetrics.leads > 0 ? formatUSD(totalCPL) : '—'}</div>
                                                {/* Показываем видео-метрики только после анализа */}
                                                {creativeAnalysis && totalMetrics.video_views > 0 && (
                                                  <>
                                                    <div className="font-medium"><span className="text-muted-foreground">Видео 25%:</span> {formatNumber(totalMetrics.video_views_25)}</div>
                                                    <div className="font-medium"><span className="text-muted-foreground">Видео 50%:</span> {formatNumber(totalMetrics.video_views_50)}</div>
                                                    <div className="font-medium"><span className="text-muted-foreground">Видео 75%:</span> {formatNumber(totalMetrics.video_views_75)}</div>
                                                  </>
                                                )}
                                              </div>
                                            </div>
                                          );
                                        })()}
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Мобильные карточки */}
              <div className="md:hidden space-y-2">
                {roiData.campaigns.map((campaign) => (
                  <Card
                    key={campaign.id}
                    className={cn(
                      "shadow-sm hover:shadow-md transition-all duration-200",
                      expandedCreativeId === campaign.id && "ring-2 ring-primary shadow-lg shadow-primary/20"
                    )}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          {/* Миниатюра креатива 40x40 */}
                          <div className="shrink-0 w-10 h-10 rounded overflow-hidden bg-muted flex items-center justify-center">
                            {(() => {
                              const previewUrl = campaign.media_type === 'video'
                                ? campaign.thumbnail_url
                                : campaign.media_type === 'carousel' && campaign.carousel_data?.[0]
                                  ? (campaign.carousel_data[0].image_url || campaign.carousel_data[0].image_url_4k)
                                  : campaign.image_url;

                              if (previewUrl) {
                                return (
                                  <img
                                    src={getThumbnailUrl(previewUrl, 80, 80) || previewUrl}
                                    alt=""
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                  />
                                );
                              }

                              const Icon = campaign.media_type ? MEDIA_TYPE_CONFIG[campaign.media_type]?.icon : Image;
                              return Icon ? <Icon className="w-5 h-5 text-muted-foreground" /> : null;
                            })()}
                          </div>
                          <h3 className="text-sm font-medium truncate pr-2">
                            {campaign.name}
                          </h3>
                        </div>
                        <Badge
                          variant={getROIBadgeVariant(campaign.roi)}
                          className={`text-xs flex-shrink-0 ${getROIBadgeClass(campaign.roi)}`}
                        >
                          {formatPercent(campaign.roi)}
                        </Badge>
                      </div>
                      <div className="flex gap-2 mb-3 flex-wrap">
                        {campaign.creative_url && (
                          <a
                            href={campaign.creative_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-foreground hover:text-foreground/70 flex items-center gap-1 transition-colors font-medium"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Посмотреть креатив
                          </a>
                        )}
                        <button
                          onClick={() => handleOpenFunnelModal(campaign.id, campaign.name)}
                          className="text-xs text-slate-600 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300 flex items-center gap-1 transition-colors font-medium"
                        >
                          <Filter className="h-3 w-3" />
                          Воронка
                        </button>
                        <button
                          onClick={() => loadCreativeMetrics(campaign.id, campaign)}
                          className="text-xs text-foreground hover:text-foreground/70 flex items-center gap-1 transition-colors font-medium"
                        >
                          {expandedCreativeId === campaign.id ? (
                            <>
                              <ChevronUp className="h-3 w-3" />
                              Скрыть детали
                            </>
                          ) : (
                            <>
                              <ChevronDown className="h-3 w-3" />
                              Показать детали
                            </>
                          )}
                        </button>
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Выручка:</span>
                          <span className="font-medium text-green-600 dark:text-green-500/70">
                            {formatCurrency(campaign.revenue)}
                          </span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Затраты:</span>
                          <span className="font-medium text-slate-600">
                            {formatCurrency(campaign.spend)}
                          </span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Лиды:</span>
                          <span className="font-medium">
                            {formatNumber(campaign.leads)}
                          </span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">CPL:</span>
                          <span className="font-medium">
                            {campaign.leads > 0
                              ? formatUSD(campaign.spend / 530 / campaign.leads)
                              : '—'
                            }
                          </span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">% квал:</span>
                          <span className="font-medium">
                            {campaign.qualification?.rate !== undefined
                              ? `${campaign.qualification.rate.toFixed(1)}%`
                              : '—'
                            }
                          </span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Конверсии:</span>
                          <span className="font-medium">
                            {formatNumber(campaign.conversions)}
                          </span>
                        </div>
                        {campaign.leads > 0 && (
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Конверсия:</span>
                            <span className="font-medium">
                              {((campaign.conversions / campaign.leads) * 100).toFixed(1)}%
                            </span>
                          </div>
                        )}
                        {/* TEMPORARILY HIDDEN: Key stages qualification rates
                        {qualificationStats && qualificationStats.key_stages.length > 0 && (
                          <div className="pt-1.5 mt-1.5 border-t border-slate-200">
                            <div className="text-xs text-blue-700 dark:text-blue-400 font-medium">
                              {getCreativeKeyStageRates(campaign.id)}
                            </div>
                          </div>
                        )}
                        */}
                      </div>
                      
                      {/* Раскрывающаяся секция с метриками для мобильной версии */}
                      {expandedCreativeId === campaign.id && (
                        <div className="mt-3 pt-3 border-t space-y-3">
                          {loadingMetrics ? (
                            <div className="text-center py-4">
                              <RefreshCw className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                              <p className="text-xs text-muted-foreground mt-2">Загрузка данных...</p>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {/* Миниатюры для image/carousel */}
                              {campaign.media_type === 'image' && campaign.image_url && (
                                <Card className="bg-muted/30">
                                  <CardHeader className="pb-3">
                                    <CardTitle className="text-xs flex items-center gap-2">
                                      🖼️ Превью креатива
                                    </CardTitle>
                                  </CardHeader>
                                  <CardContent>
                                    <img
                                      src={getThumbnailUrl(campaign.image_url) || campaign.image_url}
                                      alt={campaign.name}
                                      className="rounded-lg max-w-[150px] max-h-[188px] object-contain"
                                      loading="lazy"
                                    />
                                  </CardContent>
                                </Card>
                              )}

                              {campaign.media_type === 'carousel' && campaign.carousel_data && campaign.carousel_data.length > 0 && (
                                <Card className="bg-muted/30">
                                  <CardHeader className="pb-3">
                                    <CardTitle className="text-xs flex items-center gap-2">
                                      🖼️ Карточки ({campaign.carousel_data.length})
                                    </CardTitle>
                                  </CardHeader>
                                  <CardContent>
                                    <div className="flex gap-2 overflow-x-auto pb-2">
                                      {campaign.carousel_data
                                        .sort((a, b) => a.order - b.order)
                                        .map((card, idx) => (
                                          <img
                                            key={idx}
                                            src={getThumbnailUrl(card.image_url || card.image_url_4k, 100, 125) || card.image_url || card.image_url_4k}
                                            alt={`Карточка ${idx + 1}`}
                                            className="rounded-lg w-[100px] h-[125px] object-cover flex-shrink-0"
                                            loading="lazy"
                                          />
                                        ))}
                                    </div>
                                  </CardContent>
                                </Card>
                              )}

                              {/* Текст/Транскрипция */}
                              <Card className="bg-muted/30">
                                <CardHeader className="pb-3">
                                  <CardTitle className="text-xs flex items-center gap-2">
                                    {campaign.media_type === 'video' ? '📝 Транскрибация видео' : '📝 Текст креатива'}
                                  </CardTitle>
                                </CardHeader>
                                <CardContent>
                                  <div className="text-xs whitespace-pre-wrap text-muted-foreground">
                                    {creativeTranscript || (
                                      campaign.media_type === 'video'
                                        ? 'Транскрибация еще не готова. Она появится после обработки видео.'
                                        : 'Текст недоступен'
                                    )}
                                  </div>
                                </CardContent>
                              </Card>

                              {/* Статистика креатива за выбранный период */}
                              {creativeMetrics.length > 0 && (() => {
                                // Вычисляем СУММУ за весь период
                                const totalMetrics = creativeMetrics.reduce((acc, metric) => ({
                                  impressions: acc.impressions + (metric.impressions || 0),
                                  reach: acc.reach + (metric.reach || 0),
                                  clicks: acc.clicks + (metric.clicks || 0),
                                  leads: acc.leads + (metric.leads || 0),
                                  spend: acc.spend + (metric.spend || 0),
                                  video_views: acc.video_views + (metric.video_views || 0),
                                  video_views_25: acc.video_views_25 + (metric.video_views_25_percent || 0),
                                  video_views_50: acc.video_views_50 + (metric.video_views_50_percent || 0),
                                  video_views_75: acc.video_views_75 + (metric.video_views_75_percent || 0)
                                }), { impressions: 0, reach: 0, clicks: 0, leads: 0, spend: 0, video_views: 0, video_views_25: 0, video_views_50: 0, video_views_75: 0 });
                                
                                const totalCTR = totalMetrics.impressions > 0 
                                  ? (totalMetrics.clicks / totalMetrics.impressions) * 100 
                                  : 0;
                                const totalCPM = totalMetrics.impressions > 0 
                                  ? (totalMetrics.spend / totalMetrics.impressions) * 1000 
                                  : 0;
                                const totalCPL = totalMetrics.leads > 0 
                                  ? totalMetrics.spend / totalMetrics.leads 
                                  : 0;
                                
                                return (
                                  <div className="bg-primary/5 rounded-lg p-3 border border-primary/10">
                                    <h5 className="font-semibold text-xs mb-2 text-primary">Статистика креатива</h5>
                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                      <div className="font-medium"><span className="text-muted-foreground">Показы:</span> {formatNumber(totalMetrics.impressions)}</div>
                                      <div className="font-medium"><span className="text-muted-foreground">Охват:</span> {formatNumber(totalMetrics.reach)}</div>
                                      <div className="font-medium"><span className="text-muted-foreground">Клики:</span> {formatNumber(totalMetrics.clicks)}</div>
                                      <div className="font-medium"><span className="text-muted-foreground">CTR:</span> {totalCTR.toFixed(2)}%</div>
                                      <div className="font-medium"><span className="text-muted-foreground">Лиды:</span> {formatNumber(totalMetrics.leads)}</div>
                                      <div className="font-medium"><span className="text-muted-foreground">Расход:</span> {formatUSD(totalMetrics.spend)}</div>
                                      <div className="font-medium"><span className="text-muted-foreground">CPM:</span> {formatUSD(totalCPM)}</div>
                                      <div className="font-medium"><span className="text-muted-foreground">CPL:</span> {totalMetrics.leads > 0 ? formatUSD(totalCPL) : '—'}</div>
                                      {/* Показываем видео-метрики только после анализа */}
                                      {creativeAnalysis && totalMetrics.video_views > 0 && (
                                        <>
                                          <div className="font-medium"><span className="text-muted-foreground">Видео 25%:</span> {formatNumber(totalMetrics.video_views_25)}</div>
                                          <div className="font-medium"><span className="text-muted-foreground">Видео 50%:</span> {formatNumber(totalMetrics.video_views_50)}</div>
                                          <div className="font-medium"><span className="text-muted-foreground">Видео 75%:</span> {formatNumber(totalMetrics.video_views_75)}</div>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                );
                              })()}

                              {/* Кнопка AI анализа */}
                              <Button
                                size="sm"
                                onClick={() => analyzeCreative(campaign.id)}
                                disabled={analyzingCreative === campaign.id}
                                className="w-full flex items-center justify-center gap-2 h-9 bg-slate-600 hover:bg-slate-700 text-white shadow-md hover:shadow-lg transition-all duration-200"
                              >
                                {analyzingCreative === campaign.id ? (
                                  <>
                                    <RefreshCw className="h-4 w-4 animate-spin" />
                                    Анализирую...
                                  </>
                                ) : (
                                  <>
                                    <Sparkles className="h-4 w-4" />
                                    Анализ с AI
                                  </>
                                )}
                              </Button>

                              {/* Результаты LLM анализа */}
                              {creativeAnalysis && creativeAnalysis.score !== null && (
                                <div className="border border-primary/20 bg-primary/5 rounded-lg p-3 space-y-2">
                                  <div className="flex items-center gap-2">
                                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${verdictMeta[creativeAnalysis.verdict]?.className || ''}`}>
                                      {verdictMeta[creativeAnalysis.verdict]?.emoji} {verdictMeta[creativeAnalysis.verdict]?.label}
                                    </span>
                                    <span className="text-xs text-muted-foreground">Оценка: {creativeAnalysis.score}/100</span>
                                  </div>
                                  {creativeAnalysis.reasoning && (
                                    <div className="text-xs text-muted-foreground">{creativeAnalysis.reasoning}</div>
                                  )}
                                  {creativeAnalysis.video_analysis && (
                                    <div className="text-xs">
                                      <span className="font-medium text-foreground">Видео:</span> {creativeAnalysis.video_analysis}
                                    </div>
                                  )}
                                  {creativeAnalysis.text_recommendations && (
                                    <div className="text-xs">
                                      <span className="font-medium text-foreground">Рекомендации:</span> {creativeAnalysis.text_recommendations}
                                    </div>
                                  )}
                                  {creativeAnalysis.transcript_suggestions && Array.isArray(creativeAnalysis.transcript_suggestions) && creativeAnalysis.transcript_suggestions.length > 0 && (
                                    <div className="space-y-2 pt-2 border-t border-primary/10">
                                      <div className="text-xs font-medium text-foreground">Предложения по тексту:</div>
                                      {creativeAnalysis.transcript_suggestions.map((suggestion: any, index: number) => (
                                        <div key={`${suggestion.from}-${index}`} className="rounded border border-muted p-2 space-y-1 bg-background/50">
                                          <div className="text-xs text-muted-foreground line-through">"{suggestion.from}"</div>
                                          <div className="text-xs font-medium text-foreground">→ "{suggestion.to}"</div>
                                          <div className="text-xs text-muted-foreground italic">{suggestion.reason}</div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          ) : (
            <Card className="shadow-sm">
              <CardContent className="flex items-center justify-center py-12">
                <div className="text-center">
                  <div className="p-3 rounded-full bg-muted inline-flex items-center justify-center mb-4">
                    <BarChart3 className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <h3 className="text-base font-semibold mb-2">Нет данных по креативам</h3>
                  <p className="text-sm text-muted-foreground">
                    Добавьте лиды и продажи, чтобы увидеть ROI по креативам
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
          </TabsContent>

          {/* Контент: Лиды */}
          <TabsContent value="leads">
            {userAccountId && (
              <LeadsTab
                userAccountId={userAccountId}
                directionId={selectedDirectionId}
                accountId={currentAdAccountId}
              />
            )}
          </TabsContent>

          {/* Контент: Продажи */}
          <TabsContent value="sales">
            {userAccountId && <SalesList userAccountId={userAccountId} accountId={currentAdAccountId} />}
          </TabsContent>
        </Tabs>

        {/* Funnel Modal */}
        {selectedCreative && (
          <CreativeFunnelModal
            isOpen={funnelModalOpen}
            onClose={() => setFunnelModalOpen(false)}
            creativeId={selectedCreative.id}
            creativeName={selectedCreative.name}
            userAccountId={userAccountId}
            directionId={selectedDirectionId || undefined}
          />
        )}
      </div>
    </div>
  );
};

export default ROIAnalytics; 