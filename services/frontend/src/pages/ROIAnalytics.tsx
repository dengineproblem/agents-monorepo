import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Header from '../components/Header';
import { salesApi, ROIData, CampaignROI } from '../services/salesApi';
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

const ROIAnalytics: React.FC = () => {
  const { checkBusinessId } = useAppContext();
  const [roiData, setRoiData] = useState<ROIData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showBusinessIdWarning, setShowBusinessIdWarning] = useState(false);
  const [businessId, setBusinessId] = useState<string>('');
  // откат периода — показываем как раньше (все)
  


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

  const loadROIData = async (tf?: 7 | 30 | 90 | 'all') => {
    try {
      setLoading(true);
      setError(null);
      setShowBusinessIdWarning(false);
      
      // Проверяем наличие business_id
      const hasBusinessId = await checkBusinessId();
      if (!hasBusinessId) {
        setShowBusinessIdWarning(true);
        setLoading(false);
        return;
      }
      
      const storedUser = localStorage.getItem('user');
      if (!storedUser) {
        throw new Error('Пользователь не авторизован');
      }
      
      const userData = JSON.parse(storedUser);
      if (!userData.business_id) {
        throw new Error('Business ID не найден');
      }

      console.log('🔄 Загружаем ROI данные...');
      const data = tf
        ? await salesApi.getROIData(userData.business_id, tf)
        : await salesApi.getROIData(userData.business_id);
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
    // Устанавливаем businessId один раз при монтировании
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      const userData = JSON.parse(storedUser);
      setBusinessId(userData?.business_id || userData?.id || '');
    }
    
    loadROIData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getROIBadgeVariant = (roi: number) => {
    if (roi > 0) return 'outline';
    return 'destructive';
  };

  const getROIBadgeClass = (roi: number) => {
    if (roi > 0) return 'bg-green-100 text-green-800 border-green-300';
    return '';
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

  if (showBusinessIdWarning) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header onOpenDatePicker={() => {}}  />
        <main className="flex-1 container mx-auto px-4 py-8">
          <Card className="max-w-md mx-auto shadow-sm">
            <CardContent className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="p-3 rounded-full bg-orange-100 inline-flex items-center justify-center mb-4">
                  <AlertCircle className="h-8 w-8 text-orange-600" />
                </div>
                <h2 className="text-lg font-semibold mb-2">Требуется подключение WhatsApp</h2>
                <p className="text-sm text-muted-foreground mb-6">
                  Для отслеживания ROI необходимо подключить WhatsApp аккаунт для отслеживания лидов. 
                  Обратитесь в тех поддержку.
                </p>
                <Button 
                  onClick={() => loadROIData()}
                  variant="outline"
                  className="transition-all duration-200"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Проверить снова
                </Button>
              </div>
            </CardContent>
          </Card>
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
      <Header onOpenDatePicker={() => {}} />
      
      <div className="container mx-auto px-4 py-6 pt-[76px] max-w-full">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl md:text-2xl font-bold">ROI Аналитика</h1>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">Период</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => loadROIData(7)}>7 дней</DropdownMenuItem>
              <DropdownMenuItem onClick={() => loadROIData(30)}>30 дней</DropdownMenuItem>
              <DropdownMenuItem onClick={() => loadROIData(90)}>90 дней</DropdownMenuItem>
              <DropdownMenuItem onClick={() => loadROIData('all')}>Все</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Общая статистика */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-4">
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
        </div>

                {/* Кампании */}
        <div className="mb-6">
          <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Кампании ({roiData?.campaigns?.length || 0})
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
                            <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground">Название кампании</th>
                            <th className="py-2 px-3 text-right text-xs font-medium text-muted-foreground">Выручка</th>
                            <th className="py-2 px-3 text-right text-xs font-medium text-muted-foreground">Затраты</th>
                            <th className="py-2 px-3 text-right text-xs font-medium text-muted-foreground">ROI</th>
                            <th className="py-2 px-3 text-right text-xs font-medium text-muted-foreground">Лиды</th>
                            <th className="py-2 px-3 text-right text-xs font-medium text-muted-foreground">Конверсии</th>
                            <th className="py-2 px-3 text-right text-xs font-medium text-muted-foreground">Конверсия %</th>
                            <th className="py-2 px-3 text-center text-xs font-medium text-muted-foreground">Креатив</th>
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
                      {campaign.creative_url && (
                        <a 
                          href={campaign.creative_url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-xs text-foreground hover:text-foreground/70 flex items-center gap-1 mb-3 transition-colors font-medium"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Посмотреть креатив
                        </a>
                      )}
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
                  <h3 className="text-base font-semibold mb-2">Нет данных по кампаниям</h3>
                  <p className="text-sm text-muted-foreground">
                    Добавьте лиды и продажи, чтобы увидеть ROI по кампаниям
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Список продаж */}
        {businessId && <SalesList businessId={businessId} />}
      </div>
    </div>
  );
};

export default ROIAnalytics; 