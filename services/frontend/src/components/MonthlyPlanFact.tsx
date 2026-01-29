import React, { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Settings, BarChart3, TrendingUp, TrendingDown, Target, Users, DollarSign } from 'lucide-react';
import { format, getDaysInMonth, startOfMonth } from 'date-fns';
import { ru } from 'date-fns/locale';
import { facebookApi, CampaignStat, Campaign } from '@/services/facebookApi';
import { 
  getUserDirectionsWithPlans, 
  saveUserDirectionPlans,
  DirectionPlanInput,
  DirectionWithPlans 
} from '@/services/plansApi';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

// Используем типы из plansApi вместо локального интерфейса

interface MonthlyStats {
  totalLeads: number;
  totalSpend: number;
  projectedLeads: number;
  projectedSpend: number;
  avgCPL: number;
  daysInMonth: number;
  daysPassed: number;
  progressPercent: number;
}

const MonthlyPlanFact: React.FC = () => {
  const [selectedDirection, setSelectedDirection] = useState<string>('all');
  const [plansDialogOpen, setPlansDialogOpen] = useState(false);
  const [directionsWithPlans, setDirectionsWithPlans] = useState<DirectionWithPlans[]>([]);
  const [monthlyStats, setMonthlyStats] = useState<CampaignStat[]>([]);
  const [activeCampaigns, setActiveCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingPlans, setSavingPlans] = useState(false);
  const [tempPlans, setTempPlans] = useState<DirectionPlanInput[]>([]);

  const today = new Date();
  const currentMonth = format(today, 'LLLL yyyy', { locale: ru });
  const firstDayOfMonth = startOfMonth(today);
  const daysInMonth = getDaysInMonth(today);
  const daysPassed = today.getDate();
  const progressPercent = daysPassed / daysInMonth;

  // Загрузка данных с начала месяца - ТОЛЬКО ОДИН РАЗ
  useEffect(() => {
    const loadMonthlyData = async () => {
      try {
        setLoading(true);
        const currentDate = new Date();
        const firstDay = startOfMonth(currentDate);
        const monthRange = {
          since: format(firstDay, 'yyyy-MM-dd'),
          until: format(currentDate, 'yyyy-MM-dd')
        };

        // Получаем пользователя из localStorage
        const storedUser = localStorage.getItem('user');
        if (!storedUser) {

          return;
        }
        const user = JSON.parse(storedUser);
        
        // Загружаем тариф пользователя
        const { data: userData } = await supabase
          .from('user_accounts')
          .select('tarif')
          .eq('id', user.id)
          .single();
        
        const userTarif = userData?.tarif || null;
        const includeLeadForms = userTarif === 'target';
        
        // Загружаем сначала кампании, потом статистику (передаём campaigns чтобы не дублировать запрос)
        const campaigns = await facebookApi.getCampaigns();

        // Загружаем статистику и планы параллельно
        const [stats, plansData] = await Promise.all([
          facebookApi.getCampaignStats(monthRange, includeLeadForms, campaigns),
          getUserDirectionsWithPlans(user.id).catch(error => {

            return []; // Возвращаем пустой массив при ошибке
          })
        ]);
        
        // Фильтруем только активные кампании
        const activeCampaignsOnly = campaigns.filter(campaign => campaign.status === 'ACTIVE');
        const activeCampaignIds = new Set(activeCampaignsOnly.map(c => c.id));
        
        // Фильтруем статистику только для активных кампаний
        const activeStats = stats.filter(stat => activeCampaignIds.has(stat.campaign_id));
        
        setActiveCampaigns(activeCampaignsOnly);
        setMonthlyStats(activeStats);
        setDirectionsWithPlans(plansData);



      } catch (error) {

        setActiveCampaigns([]);
        setMonthlyStats([]);
      } finally {
        setLoading(false);
      }
    };

    loadMonthlyData();
  }, []); // ПУСТЫЕ ЗАВИСИМОСТИ - загружаем только один раз

  // Парсинг названий кампаний для извлечения направлений
  const parseCampaignName = (campaignName: string): { mainDirection: string; subDirection: string | null } => {
    const parts = campaignName.split(' | ').map(part => part.trim());
    
    return {
      mainDirection: parts[0] || campaignName,
      subDirection: parts[1] || null
    };
  };

  // Получение доступных направлений из АКТИВНЫХ кампаний
  const availableDirections = useMemo(() => {
    const directions = [{ value: 'all', label: 'Все направления' }];
    
    if (!activeCampaigns || activeCampaigns.length === 0) return directions;

    const uniqueDirections = new Set<string>();
    
    // Используем активные кампании для построения списка направлений
    activeCampaigns.forEach(campaign => {
      const parsed = parseCampaignName(campaign.name);
      const directionKey = `${parsed.mainDirection}${parsed.subDirection ? '|' + parsed.subDirection : ''}`;
      const directionLabel = parsed.subDirection 
        ? `${parsed.mainDirection} → ${parsed.subDirection}`
        : parsed.mainDirection;
      
      if (!uniqueDirections.has(directionKey)) {
        uniqueDirections.add(directionKey);
        directions.push({
          value: directionKey,
          label: directionLabel
        });
      }
    });
    
    return directions;
  }, [activeCampaigns]);

  // Подготовка временных планов при открытии модала
  const prepareTempPlans = () => {
    if (!activeCampaigns || activeCampaigns.length === 0) return;

    const existingDirections = new Set<string>();
    const newTempPlans: DirectionPlanInput[] = [];
    
    // Добавляем существующие планы из базы данных
    directionsWithPlans.forEach(item => {
      const directionKey = `${item.direction.main_direction}${item.direction.sub_direction ? '|' + item.direction.sub_direction : ''}`;
      existingDirections.add(directionKey);
      
      newTempPlans.push({
        mainDirection: item.direction.main_direction,
        subDirection: item.direction.sub_direction,
        monthlyLeadsPlan: item.leadsPlanned,
        monthlySpendPlan: item.spendPlanned
      });
    });
    
    // Добавляем направления из активных кампаний, которых еще нет в планах
    activeCampaigns.forEach(campaign => {
      const parsed = parseCampaignName(campaign.name);
      const directionKey = `${parsed.mainDirection}${parsed.subDirection ? '|' + parsed.subDirection : ''}`;
      
      if (!existingDirections.has(directionKey)) {
        existingDirections.add(directionKey);
        newTempPlans.push({
          mainDirection: parsed.mainDirection,
          subDirection: parsed.subDirection,
          monthlyLeadsPlan: 0,
          monthlySpendPlan: 0
        });
      }
    });
    
    setTempPlans(newTempPlans);
  };

  // Расчет месячной статистики
  const calculatedStats = useMemo((): MonthlyStats => {
    if (!monthlyStats || monthlyStats.length === 0) {
      return {
        totalLeads: 0,
        totalSpend: 0,
        projectedLeads: 0,
        projectedSpend: 0,
        avgCPL: 0,
        daysInMonth,
        daysPassed,
        progressPercent
      };
    }

    // Фильтруем статистику по выбранному направлению
    let filteredStats = monthlyStats;
    
    if (selectedDirection !== 'all') {
      const [mainDir, subDir] = selectedDirection.split('|');
      filteredStats = monthlyStats.filter(stat => {
        const parsed = parseCampaignName(stat.campaign_name);
        return parsed.mainDirection === mainDir && 
               (subDir ? parsed.subDirection === subDir : parsed.subDirection === null);
      });
    }

    const totalLeads = filteredStats.reduce((sum, stat) => sum + (stat.leads || 0), 0);
    const totalSpend = filteredStats.reduce((sum, stat) => sum + (stat.spend || 0), 0);
    
    const projectedLeads = Math.round(totalLeads / progressPercent);
    const projectedSpend = Math.round((totalSpend / progressPercent) * 100) / 100;
    const avgCPL = totalLeads > 0 ? totalSpend / totalLeads : 0;

    return {
      totalLeads,
      totalSpend,
      projectedLeads,
      projectedSpend,
      avgCPL,
      daysInMonth,
      daysPassed,
      progressPercent: Math.round(progressPercent * 100)
    };
  }, [monthlyStats, selectedDirection, progressPercent, daysInMonth, daysPassed]);

  // Получение плана для выбранного направления
  const getCurrentPlan = () => {
    if (selectedDirection === 'all') {
      return {
        leadsPlan: directionsWithPlans.reduce((sum, item) => sum + item.leadsPlanned, 0),
        spendPlan: directionsWithPlans.reduce((sum, item) => sum + item.spendPlanned, 0)
      };
    } else {
      const [mainDir, subDir] = selectedDirection.split('|');
      const planItem = directionsWithPlans.find(item => 
        item.direction.main_direction === mainDir && 
        (subDir ? item.direction.sub_direction === subDir : item.direction.sub_direction === null)
      );
      return {
        leadsPlan: planItem?.leadsPlanned || 0,
        spendPlan: planItem?.spendPlanned || 0
      };
    }
  };

  const currentPlan = getCurrentPlan();

  // Обработчики
  const handlePlanChange = (planIndex: number, field: 'monthlyLeadsPlan' | 'monthlySpendPlan', value: string) => {
    const numValue = parseFloat(value) || 0;
    setTempPlans(plans => 
      plans.map((plan, index) => 
        index === planIndex 
          ? { ...plan, [field]: numValue }
          : plan
      )
    );
  };

  const handleSavePlans = async () => {
    try {
      setSavingPlans(true);
      
      // Получаем пользователя из localStorage
      const storedUser = localStorage.getItem('user');
      if (!storedUser) {
        throw new Error('Пользователь не найден');
      }
      const user = JSON.parse(storedUser);
      
      // Сохраняем планы в базу данных
      await saveUserDirectionPlans(user.id, tempPlans);
      
      // Перезагружаем данные планов
      const updatedPlans = await getUserDirectionsWithPlans(user.id);
      setDirectionsWithPlans(updatedPlans);
      
      toast({
        title: "Планы сохранены",
        description: `Успешно сохранено ${tempPlans.length} направлений с планами.`,
      });
      
      setPlansDialogOpen(false);
    } catch (error) {

      toast({
        title: "Ошибка сохранения",
        description: "Не удалось сохранить планы. Попробуйте еще раз.",
        variant: "destructive",
      });
    } finally {
      setSavingPlans(false);
    }
  };

  const handleOpenPlansDialog = () => {
    prepareTempPlans();
    setPlansDialogOpen(true);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  const formatDirectionName = (plan: DirectionPlanInput) => {
    return plan.subDirection 
      ? `${plan.mainDirection} → ${plan.subDirection}`
      : plan.mainDirection;
  };

  // Расчет отклонений от плана
  const leadsDeviation = calculatedStats.totalLeads - currentPlan.leadsPlan;
  const spendDeviation = calculatedStats.totalSpend - currentPlan.spendPlan;
  const projectedLeadsDeviation = calculatedStats.projectedLeads - currentPlan.leadsPlan;
  const projectedSpendDeviation = calculatedStats.projectedSpend - currentPlan.spendPlan;
  
  // Расчет CPL планового и отклонения
  const plannedCPL = currentPlan.leadsPlan > 0 && currentPlan.spendPlan > 0 
    ? currentPlan.spendPlan / currentPlan.leadsPlan 
    : 0;
  const cplDeviation = calculatedStats.avgCPL - plannedCPL;
  const projectedCPL = calculatedStats.projectedLeads > 0 
    ? calculatedStats.projectedSpend / calculatedStats.projectedLeads 
    : 0;
  const projectedCPLDeviation = projectedCPL - plannedCPL;

  if (loading) {
    return (
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 mb-3">
            <BarChart3 className="h-5 w-5" />
            План/Факт анализ ({currentMonth})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4 animate-in fade-in duration-300">
            {/* Progress bar skeleton */}
            <div className="space-y-2">
              <div className="h-4 w-32 bg-muted/70 rounded animate-pulse" />
              <div className="h-3 rounded-full bg-muted overflow-hidden">
                <div className="h-full w-1/2 bg-gradient-to-r from-muted via-muted/50 to-muted animate-pulse" />
              </div>
            </div>
            
            {/* Stats grid skeleton */}
            <div className="grid grid-cols-2 gap-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="p-3 border rounded-lg space-y-2">
                  <div className="h-3 w-24 bg-muted/70 rounded animate-pulse" />
                  <div className="relative h-7 w-28 overflow-hidden rounded-md">
                    <div className="absolute inset-0 bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 animate-pulse" />
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/60 to-transparent animate-shimmer" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 mb-3">
          <BarChart3 className="h-5 w-5" />
          План/Факт анализ ({currentMonth})
        </CardTitle>
        
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Направление:</span>
              <Select value={selectedDirection} onValueChange={setSelectedDirection}>
                <SelectTrigger className="h-8 w-48">
                  <SelectValue placeholder="Выберите направление" />
                </SelectTrigger>
                <SelectContent>
                  {availableDirections.map((direction) => (
                    <SelectItem key={direction.value} value={direction.value}>
                      {direction.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <Button 
              variant="outline" 
              size="sm" 
              className="h-8 w-8 p-0"
              onClick={handleOpenPlansDialog}
            >
              <Settings className="h-4 w-4" />
            </Button>
            
            <Dialog open={plansDialogOpen} onOpenChange={setPlansDialogOpen}>
              <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Планы на месяц по направлениям</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="text-sm text-muted-foreground mb-4">
                    Установите месячные планы для каждого направления:
                  </div>
                  
                  {tempPlans.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <div className="text-lg mb-2">🎯</div>
                      <div>Направления будут созданы автоматически</div>
                      <div className="text-xs">на основе названий ваших кампаний</div>
                    </div>
                  ) : (
                    tempPlans.map((plan, index) => (
                    <div key={`${plan.mainDirection}-${plan.subDirection || 'main'}-${index}`} className="grid grid-cols-3 gap-4 items-center p-3 border rounded-lg">
                      <div className="font-medium">
                        {formatDirectionName(plan)}
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`leads-${index}`} className="text-xs">Лиды в месяц</Label>
                        <Input
                          id={`leads-${index}`}
                          type="number"
                          min="0"
                          value={plan.monthlyLeadsPlan}
                          onChange={(e) => handlePlanChange(index, 'monthlyLeadsPlan', e.target.value)}
                          className="h-8"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`spend-${index}`} className="text-xs">Затраты в месяц</Label>
                        <Input
                          id={`spend-${index}`}
                          type="number"
                          min="0"
                          step="0.01"
                          value={plan.monthlySpendPlan}
                          onChange={(e) => handlePlanChange(index, 'monthlySpendPlan', e.target.value)}
                          className="h-8"
                        />
                      </div>
                    </div>
                    ))
                  )}
                  
                  <div className="flex justify-end gap-2 pt-4 border-t">
                    <Button variant="outline" onClick={() => setPlansDialogOpen(false)}>
                      Отмена
                    </Button>
                    <Button onClick={handleSavePlans} disabled={savingPlans}>
                      <Settings className="h-4 w-4 mr-1" />
                      {savingPlans ? 'Сохранение...' : 'Сохранить планы'}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="animate-in fade-in duration-500">
        {/* Прогресс месяца */}
        <div className="mb-6 p-4 bg-muted/30 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Прогресс месяца</span>
            <span className="text-sm text-muted-foreground">{daysPassed} из {daysInMonth} дней</span>
          </div>
          <div className="w-full bg-background rounded-full h-2 overflow-hidden">
            <div 
              className="bg-gradient-to-r from-gray-500 to-slate-600 h-2 rounded-full transition-all duration-700 ease-out"
              style={{ width: `${calculatedStats.progressPercent}%` }}
            />
          </div>
          <div className="flex items-center justify-between mt-1">
            <div className="text-xs text-muted-foreground">{calculatedStats.progressPercent}% месяца прошло</div>
            {monthlyStats && monthlyStats.length > 0 && (
              <div className="text-xs text-muted-foreground">
                {monthlyStats.some(stat => stat._is_real_data) ? (
                  <span className="text-green-600">Реальные данные</span>
                ) : (
                  <span className="text-orange-600">Тестовые данные</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Карточки статистики */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {/* Лиды */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3 mb-3">
                <Users className="h-5 w-5 text-blue-600" />
                <div>
                  <div className="text-sm text-muted-foreground">Лиды за месяц</div>
                  <div className="text-2xl font-bold">{calculatedStats.totalLeads}</div>
                </div>
              </div>
              
              {currentPlan.leadsPlan > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>План: {currentPlan.leadsPlan}</span>
                    <span className={leadsDeviation >= 0 ? 'text-green-600' : 'text-red-600'}>
                      {leadsDeviation >= 0 ? '+' : ''}{leadsDeviation}
                    </span>
                  </div>
                  
                  <div className="flex items-center justify-between text-sm">
                    <span>Прогноз: {calculatedStats.projectedLeads}</span>
                    <span className={projectedLeadsDeviation >= 0 ? 'text-green-600' : 'text-red-600'}>
                      {projectedLeadsDeviation >= 0 ? (
                        <TrendingUp className="h-4 w-4" />
                      ) : (
                        <TrendingDown className="h-4 w-4" />
                      )}
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Затраты */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3 mb-3">
                <DollarSign className="h-5 w-5 text-green-600" />
                <div>
                  <div className="text-sm text-muted-foreground">Затраты за месяц</div>
                  <div className="text-2xl font-bold">{formatCurrency(calculatedStats.totalSpend)}</div>
                </div>
              </div>
              
              {currentPlan.spendPlan > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>План: {formatCurrency(currentPlan.spendPlan)}</span>
                    <span className={spendDeviation <= 0 ? 'text-green-600' : 'text-red-600'}>
                      {spendDeviation >= 0 ? '+' : ''}{formatCurrency(spendDeviation)}
                    </span>
                  </div>
                  
                  <div className="flex items-center justify-between text-sm">
                    <span>Прогноз: {formatCurrency(calculatedStats.projectedSpend)}</span>
                    <span className={projectedSpendDeviation <= 0 ? 'text-green-600' : 'text-red-600'}>
                      {projectedSpendDeviation <= 0 ? (
                        <TrendingUp className="h-4 w-4" />
                      ) : (
                        <TrendingDown className="h-4 w-4" />
                      )}
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* CPL */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3 mb-3">
                <Target className="h-5 w-5 text-purple-600" />
                <div>
                  <div className="text-sm text-muted-foreground">Стоимость лида</div>
                  <div className="text-2xl font-bold">{formatCurrency(calculatedStats.avgCPL)}</div>
                </div>
              </div>
              
              {plannedCPL > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>План: {formatCurrency(plannedCPL)}</span>
                    <span className={cplDeviation <= 0 ? 'text-green-600' : 'text-red-600'}>
                      {cplDeviation >= 0 ? '+' : ''}{formatCurrency(cplDeviation)}
                    </span>
                  </div>
                  
                  {projectedCPL > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span>Прогноз: {formatCurrency(projectedCPL)}</span>
                      <span className={projectedCPLDeviation <= 0 ? 'text-green-600' : 'text-red-600'}>
                        {projectedCPLDeviation <= 0 ? (
                          <TrendingUp className="h-4 w-4" />
                        ) : (
                          <TrendingDown className="h-4 w-4" />
                        )}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Дополнительная информация */}
        {(currentPlan.leadsPlan === 0 && currentPlan.spendPlan === 0) && (
          <div className="text-center py-6 text-muted-foreground">
            <Settings className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <div>Настройте планы для отображения анализа план/факт</div>
            <div className="text-xs">Нажмите на кнопку настроек выше</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default MonthlyPlanFact;