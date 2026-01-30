/**
 * Admin Ad Insights Dashboard
 *
 * Страница аналитики рекламы с детекцией аномалий
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  RefreshCw,
  AlertTriangle,
  Flame,
  Activity,
  Wifi,
  TrendingUp,
  Calendar,
  Loader2,
} from 'lucide-react';
import { adInsightsApi } from '@/services/adInsightsApi';
import {
  AnomaliesTable,
  BurnoutCard,
  DecayRecoveryList,
  TrackingHealthCard,
} from '@/components/ad-insights';
import {
  SeasonalityChart,
  MetricsHeatmap,
  PrecursorsCard,
  FamilyBreakdown,
  AccountBreakdown,
  PatternsFilters,
} from '@/components/ad-insights/patterns';
import type {
  Anomaly,
  BurnoutPrediction,
  DecayRecoveryAnalysis,
  TrackingHealthResponse,
  YearlyAudit,
  AnomalySeverity,
  PatternsQueryParams,
  SeasonalityResponse,
  MetricsResponse,
  PatternsSummaryResponse,
} from '@/types/adInsights';
import { API_BASE_URL } from '@/config/api';

interface AdAccount {
  id: string;
  ad_account_id: string;
  name: string;
  type: 'legacy' | 'multi';
  user_account_id: string;
  connection_status?: string;
}

/**
 * Форматирует дату начала недели в диапазон "15 дек — 21 дек"
 */
function formatWeekRange(weekStart: string): string {
  const start = new Date(weekStart);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);

  const formatDate = (d: Date) =>
    d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });

  return `${formatDate(start)} — ${formatDate(end)}`;
}

const AdminAdInsights: React.FC = () => {
  // Account selection
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>('');

  // Data states
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [burnoutPredictions, setBurnoutPredictions] = useState<BurnoutPrediction[]>([]);
  const [decayRecovery, setDecayRecovery] = useState<DecayRecoveryAnalysis[]>([]);
  const [trackingHealth, setTrackingHealth] = useState<TrackingHealthResponse | null>(null);
  const [yearlyAudit, setYearlyAudit] = useState<YearlyAudit | null>(null);

  // Loading states
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Stats
  const [stats, setStats] = useState({
    criticalAnomalies: 0,
    highBurnout: 0,
    recoveryPotential: 0,
  });

  // Patterns state (cross-account)
  const [activeTab, setActiveTab] = useState('anomalies');
  const [patternsParams, setPatternsParams] = useState<PatternsQueryParams>({ granularity: 'month' });
  const [seasonality, setSeasonality] = useState<SeasonalityResponse | null>(null);
  const [patternsMetrics, setPatternsMetrics] = useState<MetricsResponse | null>(null);
  const [patternsSummary, setPatternsSummary] = useState<PatternsSummaryResponse | null>(null);
  const [loadingPatterns, setLoadingPatterns] = useState(false);

  // Load ad accounts
  useEffect(() => {
    const loadAccounts = async () => {
      const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
      try {
        const res = await fetch(`${API_BASE_URL}/admin/ad-insights/accounts`, {
          headers: { 'x-user-id': currentUser.id || '' },
        });
        if (res.ok) {
          const data = await res.json();
          setAccounts(data.accounts || []);
          if (data.accounts?.length > 0) {
            // Используем id аккаунта (для legacy это legacy_xxx, для multi это UUID)
            setSelectedAccount(data.accounts[0].id);
          }
        }
      } catch (err) {
        console.error('Error loading accounts:', err);
      } finally {
        setLoadingAccounts(false);
      }
    };
    loadAccounts();
  }, []);

  // Load data when account changes
  const loadData = useCallback(async () => {
    if (!selectedAccount) return;

    setLoadingData(true);
    try {
      const [anomaliesRes, burnoutRes, decayRecoveryRes, trackingRes, auditRes] =
        await Promise.all([
          adInsightsApi.getAnomalies(selectedAccount, { acknowledged: false }),
          adInsightsApi.getBurnoutPredictions(selectedAccount),
          adInsightsApi.getDecayRecoveryAnalysis(selectedAccount),
          adInsightsApi.getTrackingHealth(selectedAccount),
          adInsightsApi.getYearlyAudit(selectedAccount),
        ]);

      setAnomalies(anomaliesRes?.anomalies || []);
      setBurnoutPredictions(burnoutRes?.predictions || []);
      setDecayRecovery(decayRecoveryRes?.analysis || []);
      setTrackingHealth(trackingRes);
      setYearlyAudit(auditRes);

      // Calculate stats with safe defaults
      const anomaliesList = anomaliesRes?.anomalies || [];
      const burnoutList = burnoutRes?.predictions || [];
      const analysisList = decayRecoveryRes?.analysis || [];

      const critical = anomaliesList.filter((a) => a.severity === 'critical').length;
      const highBurnout = burnoutList.filter(
        (p) => p.burnout_level === 'high' || p.burnout_level === 'critical'
      ).length;
      const recovery = analysisList.filter(
        (a) => a.recovery && a.recovery.score >= 0.5
      ).length;

      setStats({ criticalAnomalies: critical, highBurnout, recoveryPotential: recovery });
    } catch (err) {
      console.error('Error loading data:', err);
    } finally {
      setLoadingData(false);
    }
  }, [selectedAccount]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Sync handler
  const handleSync = async () => {
    if (!selectedAccount) return;

    setSyncing(true);
    try {
      const result = await adInsightsApi.sync(selectedAccount, { weeks: 12 });
      if (result.success) {
        await loadData();
      }
    } catch (err) {
      console.error('Sync error:', err);
    } finally {
      setSyncing(false);
    }
  };

  // Acknowledge anomaly
  const handleAcknowledge = async (id: string) => {
    if (!selectedAccount) return;
    const success = await adInsightsApi.acknowledgeAnomaly(selectedAccount, id);
    if (success) {
      setAnomalies((prev) => prev.filter((a) => a.id !== id));
    }
  };

  // Filter anomalies
  const handleAnomalyFilter = async (severity: AnomalySeverity | 'all') => {
    if (!selectedAccount) return;
    const res = await adInsightsApi.getAnomalies(selectedAccount, {
      severity: severity === 'all' ? undefined : severity,
      acknowledged: false,
    });
    setAnomalies(res.anomalies);
  };

  // Load patterns data (cross-account)
  const loadPatternsData = useCallback(async () => {
    setLoadingPatterns(true);
    try {
      const [seasonalityRes, metricsRes, summaryRes] = await Promise.all([
        adInsightsApi.getSeasonality(patternsParams),
        adInsightsApi.getPatternsMetrics(patternsParams),
        adInsightsApi.getPatternsSummary(),
      ]);
      setSeasonality(seasonalityRes);
      setPatternsMetrics(metricsRes);
      setPatternsSummary(summaryRes);
    } catch (err) {
      console.error('Error loading patterns:', err);
    } finally {
      setLoadingPatterns(false);
    }
  }, [patternsParams]);

  // Load patterns when tab is selected
  useEffect(() => {
    if (activeTab === 'patterns' && !seasonality) {
      loadPatternsData();
    }
  }, [activeTab, loadPatternsData, seasonality]);

  // Reload patterns when params change
  useEffect(() => {
    if (activeTab === 'patterns') {
      loadPatternsData();
    }
  }, [patternsParams]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loadingAccounts) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Ad Insights</h1>
          <p className="text-muted-foreground">
            {activeTab === 'patterns'
              ? 'Cross-account анализ паттернов аномалий'
              : 'Аналитика и детекция аномалий'}
          </p>
        </div>
        {/* Hide account selector on patterns tab (cross-account) */}
        {activeTab !== 'patterns' && (
          <div className="flex items-center gap-4">
            <Select value={selectedAccount} onValueChange={setSelectedAccount}>
              <SelectTrigger className="w-72">
                <SelectValue placeholder="Выберите аккаунт" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((acc) => (
                  <SelectItem key={acc.id} value={acc.id}>
                    <div className="flex items-center gap-2">
                      <span>{acc.name || acc.ad_account_id}</span>
                      <Badge variant={acc.type === 'legacy' ? 'secondary' : 'outline'} className="text-xs">
                        {acc.type}
                      </Badge>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleSync} disabled={syncing || !selectedAccount}>
              {syncing ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Синхронизация
            </Button>
          </div>
        )}
      </div>

      {/* Quick Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Критические аномалии</CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.criticalAnomalies}</div>
            <p className="text-xs text-muted-foreground">Всего аномалий: {anomalies.length}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">High Burnout</CardTitle>
            <Flame className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.highBurnout}</div>
            <p className="text-xs text-muted-foreground">Ads с высоким риском выгорания</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Recovery Potential</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.recoveryPotential}</div>
            <p className="text-xs text-muted-foreground">Ads с потенциалом восстановления</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Tracking Health</CardTitle>
            <Wifi className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {trackingHealth?.overallHealth ?? '-'}%
            </div>
            <p className="text-xs text-muted-foreground">
              {trackingHealth?.issues.length ?? 0} проблем
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="anomalies" className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Аномалии
            {anomalies.length > 0 && (
              <Badge variant="secondary" className="ml-1">
                {anomalies.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="burnout" className="flex items-center gap-2">
            <Flame className="h-4 w-4" />
            Burnout
          </TabsTrigger>
          <TabsTrigger value="decay-recovery" className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Decay / Recovery
          </TabsTrigger>
          <TabsTrigger value="tracking" className="flex items-center gap-2">
            <Wifi className="h-4 w-4" />
            Tracking
          </TabsTrigger>
          <TabsTrigger value="yearly" className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Годовой аудит
          </TabsTrigger>
          <TabsTrigger value="patterns" className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Паттерны
            {patternsSummary?.total_anomalies && (
              <Badge variant="secondary" className="ml-1">
                {patternsSummary.total_anomalies}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Anomalies Tab */}
        <TabsContent value="anomalies">
          <AnomaliesTable
            anomalies={anomalies}
            loading={loadingData}
            onAcknowledge={handleAcknowledge}
            onFilterChange={handleAnomalyFilter}
          />
        </TabsContent>

        {/* Burnout Tab */}
        <TabsContent value="burnout">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium">Прогнозы выгорания</h3>
              <Badge variant="outline">{burnoutPredictions.length} ads</Badge>
            </div>
            {loadingData ? (
              <div className="flex items-center justify-center h-32">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : burnoutPredictions.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  Нет прогнозов выгорания. Запустите синхронизацию для анализа.
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {burnoutPredictions.map((prediction) => (
                  <BurnoutCard key={`${prediction.fb_ad_id}-${prediction.week_start_date}`} prediction={prediction} />
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* Decay/Recovery Tab */}
        <TabsContent value="decay-recovery">
          <DecayRecoveryList analysis={decayRecovery} loading={loadingData} />
        </TabsContent>

        {/* Tracking Health Tab */}
        <TabsContent value="tracking">
          <div className="grid gap-4 lg:grid-cols-2">
            <TrackingHealthCard data={trackingHealth} loading={loadingData} />
            <Card>
              <CardHeader>
                <CardTitle>Что проверяется</CardTitle>
                <CardDescription>Типы проблем с трекингом</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500" />
                    <span className="font-medium">Клики без результатов</span>
                  </div>
                  <p className="text-sm text-muted-foreground ml-5">
                    Объявление получает клики, но не фиксируются конверсии.
                    Возможно проблема с пикселем или CAPI.
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-yellow-500" />
                    <span className="font-medium">Падение результатов</span>
                  </div>
                  <p className="text-sm text-muted-foreground ml-5">
                    Резкое снижение конверсий при стабильном трафике.
                    Может указывать на технические проблемы.
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-blue-500" />
                    <span className="font-medium">Высокая волатильность</span>
                  </div>
                  <p className="text-sm text-muted-foreground ml-5">
                    Нестабильные результаты неделя к неделе.
                    Может указывать на проблемы с атрибуцией.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Yearly Audit Tab */}
        <TabsContent value="yearly">
          {loadingData ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : !yearlyAudit ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Нет данных для годового аудита. Нужно больше исторических данных.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Pareto Analysis */}
              <Card>
                <CardHeader>
                  <CardTitle>Pareto анализ (80/20)</CardTitle>
                  <CardDescription>Распределение результатов</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center p-4 bg-green-50 dark:bg-green-950 rounded-lg">
                      <p className="text-2xl font-bold text-green-600">
                        {Math.round((yearlyAudit.pareto?.top20pct_results_share ?? 0) * 100)}%
                      </p>
                      <p className="text-sm text-muted-foreground">
                        от {yearlyAudit.pareto?.top20pct_ads ?? 0} топ ads
                      </p>
                    </div>
                    <div className="text-center p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                      <p className="text-2xl font-bold">
                        {yearlyAudit.pareto?.bottom80pct_results ?? 0}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        от {yearlyAudit.pareto?.bottom80pct_ads ?? 0} остальных
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Waste Analysis */}
              <Card>
                <CardHeader>
                  <CardTitle>Waste анализ</CardTitle>
                  <CardDescription>Потенциально потраченные средства</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Zero results</span>
                      <span className="font-medium">
                        ${(yearlyAudit.waste?.zeroResultsSpend ?? 0).toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">High CPR</span>
                      <span className="font-medium">
                        ${(yearlyAudit.waste?.highCprSpend ?? 0).toFixed(2)}
                      </span>
                    </div>
                    <div className="border-t pt-2 flex justify-between">
                      <span className="font-medium">Всего waste</span>
                      <span className="font-bold text-red-500">
                        ${(yearlyAudit.waste?.totalWaste ?? 0).toFixed(2)} ({(yearlyAudit.waste?.wastePercentage ?? 0).toFixed(1)}%)
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Best Weeks */}
              <Card>
                <CardHeader>
                  <CardTitle>Лучшие недели</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {(yearlyAudit.bestWeeks || []).slice(0, 5).map((week, idx) => (
                      <div key={idx} className="flex justify-between items-center">
                        <span className="text-sm">{formatWeekRange(week.week)}</span>
                        <div className="text-right">
                          <span className="font-medium text-green-600">{week.results} res</span>
                          <span className="text-muted-foreground ml-2">
                            @ ${(week.cpr ?? 0).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Worst Weeks */}
              <Card>
                <CardHeader>
                  <CardTitle>Худшие недели</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {(yearlyAudit.worstWeeks || []).slice(0, 5).map((week, idx) => (
                      <div key={idx} className="flex justify-between items-center">
                        <span className="text-sm">{formatWeekRange(week.week)}</span>
                        <div className="text-right">
                          <span className="font-medium text-red-600">{week.results} res</span>
                          <span className="text-muted-foreground ml-2">
                            @ ${(week.cpr ?? 0).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Stability */}
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Стабильность</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <p className="text-2xl font-bold">
                        {((yearlyAudit.stability?.avgWeeklyVariation ?? 0) * 100).toFixed(1)}%
                      </p>
                      <p className="text-sm text-muted-foreground">Средняя вариация</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold">
                        {((yearlyAudit.stability?.maxDrawdown ?? 0) * 100).toFixed(1)}%
                      </p>
                      <p className="text-sm text-muted-foreground">Макс. просадка</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{yearlyAudit.stability?.consistentWeeks ?? 0}</p>
                      <p className="text-sm text-muted-foreground">Стабильных недель</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* Patterns Tab (Cross-Account) */}
        <TabsContent value="patterns" className="space-y-6">
          {/* Filters */}
          <PatternsFilters
            params={patternsParams}
            onChange={(newParams) => setPatternsParams((prev) => ({ ...prev, ...newParams }))}
          />

          {/* Summary Cards */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Всего аномалий</CardTitle>
                <AlertTriangle className="h-4 w-4 text-red-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{patternsSummary?.total_anomalies ?? 0}</div>
                <p className="text-xs text-muted-foreground">
                  {patternsSummary?.period?.from && patternsSummary?.period?.to
                    ? `${patternsSummary.period.from} — ${patternsSummary.period.to}`
                    : 'За весь период'}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Anomaly Rate</CardTitle>
                <Activity className="h-4 w-4 text-blue-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{patternsSummary?.overall_anomaly_rate?.toFixed(2) ?? 0}%</div>
                <p className="text-xs text-muted-foreground">
                  {patternsSummary?.total_eligible_weeks ?? 0} eligible weeks
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Top месяц</CardTitle>
                <Calendar className="h-4 w-4 text-amber-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{patternsSummary?.top_month?.bucket ?? '-'}</div>
                <p className="text-xs text-muted-foreground">
                  {patternsSummary?.top_month?.anomaly_count ?? 0} аномалий
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Top предвестник</CardTitle>
                <TrendingUp className="h-4 w-4 text-purple-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {patternsSummary?.top_precursors?.[0]?.metric ?? '-'}
                </div>
                <p className="text-xs text-muted-foreground">
                  {patternsSummary?.top_precursors?.[0]
                    ? `${patternsSummary.top_precursors[0].significant_pct.toFixed(0)}% аномалий`
                    : 'Нет данных'}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Seasonality Chart */}
          <SeasonalityChart
            buckets={seasonality?.buckets ?? []}
            summary={seasonality?.summary ?? { total_eligible: 0, total_anomalies: 0, avg_rate: 0, rate_stddev: 0 }}
            granularity={patternsParams.granularity || 'month'}
            isLoading={loadingPatterns}
          />

          {/* Metrics Heatmap + Precursors */}
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <MetricsHeatmap
                week0={patternsMetrics?.week_0 ?? []}
                weekMinus1={patternsMetrics?.week_minus_1 ?? []}
                weekMinus2={patternsMetrics?.week_minus_2 ?? []}
                totalAnomalies={patternsMetrics?.total_anomalies ?? 0}
                isLoading={loadingPatterns}
              />
            </div>
            <div>
              <PrecursorsCard
                precursors={patternsSummary?.top_precursors ?? []}
                isLoading={loadingPatterns}
              />
            </div>
          </div>

          {/* Account & Family Breakdown */}
          <div className="grid gap-4 lg:grid-cols-2">
            <AccountBreakdown
              breakdown={patternsSummary?.account_breakdown ?? []}
              totalAnomalies={patternsSummary?.total_anomalies ?? 0}
              isLoading={loadingPatterns}
            />
            <FamilyBreakdown
              breakdown={patternsSummary?.family_breakdown ?? []}
              totalAnomalies={patternsSummary?.total_anomalies ?? 0}
              isLoading={loadingPatterns}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AdminAdInsights;
