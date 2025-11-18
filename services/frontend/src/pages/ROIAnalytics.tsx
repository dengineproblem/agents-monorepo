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
  Edit,
  Trash2,
  Save,
  X,
  ShoppingCart
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



  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'KZT',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('ru-RU').format(num);
  };

  const formatPercent = (percent: number) => {
    return `${percent.toFixed(1)}%`;
  };

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

  // Загрузка статистики квалификации для выбранного направления (до 3 ключевых этапов)
  const loadQualificationStats = async (directionId: string) => {
    try {
      const { getDirectionKeyStageStats } = await import('@/services/amocrmApi');
      const stats = await getDirectionKeyStageStats(directionId);
      console.log('📊 Loaded qualification stats:', stats);
      setQualificationStats(stats);
    } catch (err) {
      console.error('Ошибка загрузки статистики квалификации:', err);
      
      // На локалхосте без AmoCRM показываем нули для проверки интерфейса
      const direction = directions.find(d => d.id === directionId);
      if (direction) {
        const mockStats: typeof qualificationStats = {
          total_leads: 0,
          key_stages: []
        };

        // Добавляем mock этапы для каждого настроенного ключевого этапа
        if (direction.key_stage_1_pipeline_id && direction.key_stage_1_status_id) {
          mockStats.key_stages.push({
            index: 1,
            pipeline_name: 'Воронка 1',
            status_name: 'Этап 1',
            qualified_leads: 0,
            qualification_rate: 0,
            creative_stats: []
          });
        }
        if (direction.key_stage_2_pipeline_id && direction.key_stage_2_status_id) {
          mockStats.key_stages.push({
            index: 2,
            pipeline_name: 'Воронка 2',
            status_name: 'Этап 2',
            qualified_leads: 0,
            qualification_rate: 0,
            creative_stats: []
          });
        }
        if (direction.key_stage_3_pipeline_id && direction.key_stage_3_status_id) {
          mockStats.key_stages.push({
            index: 3,
            pipeline_name: 'Воронка 3',
            status_name: 'Этап 3',
            qualified_leads: 0,
            qualification_rate: 0,
            creative_stats: []
          });
        }

        console.log('🧪 Using mock stats for local development:', mockStats);
        setQualificationStats(mockStats);
      } else {
        setQualificationStats(null);
      }
    }
  };

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

      // Load qualification stats only if direction is selected and has at least one key stage configured
      if (selectedDirectionId) {
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDirectionId]);

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
                            {qualificationStats && qualificationStats.key_stages.length > 0 && (
                              <th className="py-2 px-3 text-center text-xs font-medium text-muted-foreground">Ключевые этапы</th>
                            )}
                            <th className="py-2 px-3 text-center text-xs font-medium text-muted-foreground">Воронка</th>
                            <th className="py-2 px-3 text-center text-xs font-medium text-muted-foreground">Ссылка</th>
                          </tr>
                        </thead>
                        <tbody>
                          {roiData.campaigns.map((campaign, index) => (
                            <tr key={campaign.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
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
                              {qualificationStats && qualificationStats.key_stages.length > 0 && (
                                <td className="py-2 px-3 text-center">
                                  <div className="text-xs text-blue-700 dark:text-blue-400 font-medium whitespace-nowrap">
                                    {getCreativeKeyStageRates(campaign.id)}
                                  </div>
                                </td>
                              )}
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
                            </tr>
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
                      <div className="flex gap-2 mb-3">
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
                        {/* Key stages qualification rates */}
                        {qualificationStats && qualificationStats.key_stages.length > 0 && (
                          <div className="pt-1.5 mt-1.5 border-t border-slate-200">
                            <div className="text-xs text-blue-700 dark:text-blue-400 font-medium">
                              {getCreativeKeyStageRates(campaign.id)}
                            </div>
                          </div>
                        )}
                      </div>
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