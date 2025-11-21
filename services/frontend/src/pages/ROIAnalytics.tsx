import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  Play
} from 'lucide-react';
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
import { CreativeFunnelModal } from '@/components/CreativeFunnelModal';
import { Filter } from 'lucide-react';
import { API_BASE_URL, ANALYTICS_API_BASE_URL } from '@/config/api';
import { creativesApi } from '@/services/creativesApi';

const ROIAnalytics: React.FC = () => {
  const [roiData, setRoiData] = useState<ROIData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userAccountId, setUserAccountId] = useState<string>('');
  const [directions, setDirections] = useState<Direction[]>([]);
  const [selectedDirectionId, setSelectedDirectionId] = useState<string | null>(null);
  const [isPeriodMenuOpen, setIsPeriodMenuOpen] = useState(false);

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
        tf || 'all'
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

  // Перезагрузка при смене направления
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
  }, [selectedDirectionId, directions]);

  const getROIBadgeVariant = (roi: number) => {
    if (roi > 0) return 'outline';
    return 'destructive';
  };

  const getROIBadgeClass = (roi: number) => {
    if (roi > 0) return 'bg-green-100 text-green-800 border-green-300';
    return '';
  };

  const handleOpenFunnelModal = (creativeId: string, creativeName: string) => {
    setSelectedCreative({ id: creativeId, name: creativeName });
    setFunnelModalOpen(true);
  };

  // Загрузка метрик креатива, транскрипции и анализа
  const loadCreativeMetrics = async (creativeId: string) => {
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
    
    try {
      // Параллельная загрузка метрик, анализа и транскрипции
      const [metricsResult, analysisResult, transcriptText] = await Promise.all([
        salesApi.getCreativeMetrics(creativeId, userAccountId, 30),
        salesApi.getCreativeAnalysis(creativeId, userAccountId),
        creativesApi.getTranscript(creativeId).catch(() => null)
      ]);
      
      if (metricsResult.error) {
        console.error('Ошибка загрузки метрик:', metricsResult.error);
        setCreativeMetrics([]);
      } else {
        setCreativeMetrics(metricsResult.data || []);
      }
      
      if (analysisResult.error) {
        console.log('Анализ не найден (ожидаемо при первой загрузке)');
        setCreativeAnalysis(null);
      } else {
        setCreativeAnalysis(analysisResult.data);
      }
      
      setCreativeTranscript(transcriptText);
      
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
      const analyzerUrl = ANALYTICS_API_BASE_URL 
        ? `${ANALYTICS_API_BASE_URL}/api/analyzer/analyze-creative`
        : 'http://localhost:7080/api/analyzer/analyze-creative';
      
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
          <h1 className="text-3xl font-bold tracking-tight">ROI Аналитика</h1>
          <p className="text-muted-foreground mt-2">Отслеживайте окупаемость ваших рекламных кампаний</p>
        </div>
        
        {/* Фильтр по направлениям */}
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
            
            {/* Мобилка: кнопка-бургер */}
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

        {/* Общая статистика */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
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

                {/* Креативы */}
        <div className="mb-6">
          <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Креативы ({roiData?.campaigns?.length || 0})
          </h2>
          
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
                            <th className="py-2 px-3 text-right text-xs font-medium text-muted-foreground">Выручка</th>
                            <th className="py-2 px-3 text-right text-xs font-medium text-muted-foreground">Затраты</th>
                            <th className="py-2 px-3 text-right text-xs font-medium text-muted-foreground">ROI</th>
                            <th className="py-2 px-3 text-right text-xs font-medium text-muted-foreground">Лиды</th>
                            <th className="py-2 px-3 text-right text-xs font-medium text-muted-foreground">Конверсии</th>
                            <th className="py-2 px-3 text-right text-xs font-medium text-muted-foreground">Конверсия %</th>
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
                              <tr className="border-b hover:bg-muted/30 transition-colors">
                                <td className="py-2 px-3">
                                  <div className="font-medium text-sm">{campaign.name}</div>
                                </td>
                                <td className="py-2 px-3 text-right text-sm font-medium text-green-600 dark:text-green-500/70">
                                  {formatCurrency(campaign.revenue)}
                                </td>
                                <td className="py-2 px-3 text-right text-sm font-medium text-slate-600">
                                  {formatCurrency(campaign.spend)}
                                </td>
                                <td className="py-2 px-3 text-right">
                                  <Badge 
                                    variant={getROIBadgeVariant(campaign.roi)}
                                    className={`text-xs ${getROIBadgeClass(campaign.roi)}`}
                                  >
                                    {formatPercent(campaign.roi)}
                                  </Badge>
                                </td>
                                <td className="py-2 px-3 text-right text-sm">
                                  {formatNumber(campaign.leads)}
                                </td>
                                <td className="py-2 px-3 text-right text-sm">
                                  {formatNumber(campaign.conversions)}
                                </td>
                                <td className="py-2 px-3 text-right text-sm">
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
                                    className="inline-flex items-center justify-center text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
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
                                    onClick={() => loadCreativeMetrics(campaign.id)}
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
                                  <td colSpan={10} className="p-4 bg-muted/20">
                                    {loadingMetrics ? (
                                      <div className="text-center py-4">
                                        <RefreshCw className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                                        <p className="text-sm text-muted-foreground mt-2">Загрузка метрик...</p>
                                      </div>
                                    ) : (
                                      <div className="space-y-4">
                                        {/* Транскрипция */}
                                        <Card className="bg-muted/30">
                                          <CardHeader className="pb-3">
                                            <CardTitle className="text-sm flex items-center gap-2">
                                              📝 Транскрибация видео
                                            </CardTitle>
                                          </CardHeader>
                                          <CardContent>
                                            <div className="text-sm whitespace-pre-wrap text-muted-foreground">
                                              {creativeTranscript || 'Транскрибация еще не готова. Она появится после обработки видео.'}
                                            </div>
                                          </CardContent>
                                        </Card>

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
                                                {totalMetrics.video_views > 0 && (
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
                  <Card key={campaign.id} className="shadow-sm hover:shadow-md transition-all duration-200">
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-medium truncate pr-2">
                          {campaign.name}
                        </h3>
                        <Badge 
                          variant={getROIBadgeVariant(campaign.roi)}
                          className={`text-xs ${getROIBadgeClass(campaign.roi)}`}
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
                          className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 flex items-center gap-1 transition-colors font-medium"
                        >
                          <Filter className="h-3 w-3" />
                          Воронка
                        </button>
                        <button
                          onClick={() => loadCreativeMetrics(campaign.id)}
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
                              {/* Транскрипция */}
                              <div className="bg-muted/30 rounded p-3">
                                <div className="text-xs font-semibold mb-2">📝 Транскрибация видео</div>
                                <div className="text-xs whitespace-pre-wrap text-muted-foreground">
                                  {creativeTranscript || 'Транскрибация еще не готова.'}
                                </div>
                              </div>

                              {/* Кнопка анализа */}
                              <div className="flex items-center justify-between">
                                <h5 className="font-semibold text-xs">LLM Анализ</h5>
                                <Button
                                  size="sm"
                                  onClick={() => analyzeCreative(campaign.id)}
                                  disabled={analyzingCreative === campaign.id}
                                  className="flex items-center gap-1 text-xs h-7"
                                >
                                  {analyzingCreative === campaign.id ? (
                                    <>
                                      <RefreshCw className="h-3 w-3 animate-spin" />
                                      Анализ...
                                    </>
                                  ) : (
                                    <>
                                      <Play className="h-3 w-3" />
                                      Анализ
                                    </>
                                  )}
                                </Button>
                              </div>

                              {/* LLM Анализ */}
                              {creativeAnalysis && creativeAnalysis.score !== null && (
                                <div className="border-primary/30 bg-primary/5 rounded p-3 space-y-2">
                                  <div className="flex items-center gap-2">
                                    <span className={`rounded-full px-2 py-0.5 text-xs ${verdictMeta[creativeAnalysis.verdict]?.className || ''}`}>
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
                                      <span className="font-medium text-foreground">Текст:</span> {creativeAnalysis.text_recommendations}
                                    </div>
                                  )}
                                  {creativeAnalysis.transcript_suggestions && Array.isArray(creativeAnalysis.transcript_suggestions) && creativeAnalysis.transcript_suggestions.length > 0 && (
                                    <div className="space-y-2">
                                      <div className="text-xs font-medium text-foreground">Предложения по тексту</div>
                                      {creativeAnalysis.transcript_suggestions.map((suggestion: any, index: number) => (
                                        <div key={`${suggestion.from}-${index}`} className="rounded border p-2 space-y-1">
                                          <div className="text-xs text-muted-foreground">"{suggestion.from}"</div>
                                          <div className="text-xs font-medium text-foreground">→ "{suggestion.to}"</div>
                                          <div className="text-xs text-muted-foreground">{suggestion.reason}</div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}

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
                                    <h5 className="font-semibold text-xs mb-2 text-primary">📊 Статистика креатива</h5>
                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                      <div className="font-medium"><span className="text-muted-foreground">Показы:</span> {formatNumber(totalMetrics.impressions)}</div>
                                      <div className="font-medium"><span className="text-muted-foreground">Охват:</span> {formatNumber(totalMetrics.reach)}</div>
                                      <div className="font-medium"><span className="text-muted-foreground">Клики:</span> {formatNumber(totalMetrics.clicks)}</div>
                                      <div className="font-medium"><span className="text-muted-foreground">CTR:</span> {totalCTR.toFixed(2)}%</div>
                                      <div className="font-medium"><span className="text-muted-foreground">Лиды:</span> {formatNumber(totalMetrics.leads)}</div>
                                      <div className="font-medium"><span className="text-muted-foreground">Расход:</span> {formatUSD(totalMetrics.spend)}</div>
                                      <div className="font-medium"><span className="text-muted-foreground">CPM:</span> {formatUSD(totalCPM)}</div>
                                      <div className="font-medium"><span className="text-muted-foreground">CPL:</span> {totalMetrics.leads > 0 ? formatUSD(totalCPL) : '—'}</div>
                                      {totalMetrics.video_views > 0 && (
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

        {/* Список продаж */}
        {userAccountId && <SalesList userAccountId={userAccountId} />}

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