/**
 * Admin Ads
 *
 * Реклама: кампании, креативы и CPL анализ
 *
 * @module pages/admin/AdminAds
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart3,
  Image,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Filter,
  ArrowUpDown,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { API_BASE_URL } from '@/config/api';
import { cn } from '@/lib/utils';

interface Campaign {
  id: string;
  name: string;
  status: string;
  user_username: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  cpl: number;
}

interface Creative {
  id: string;
  name: string;
  user_username: string;
  thumbnail_url?: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  leads: number;
  cpl: number;
}

interface CplAnalysis {
  user_id: string;
  user_username: string;
  direction_id: string;
  direction_name: string;
  planned_cpl: number;
  actual_cpl: number;
  deviation_percent: number;
  leads_count: number;
  spend: number;
}

const PERIODS = [
  { value: '7d', label: '7 дней' },
  { value: '14d', label: '14 дней' },
  { value: '30d', label: '30 дней' },
  { value: 'all', label: 'Всё время' },
];

const AdminAds: React.FC = () => {
  const [period, setPeriod] = useState('7d');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [cplAnalysis, setCplAnalysis] = useState<CplAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'deviation' | 'spend'>('deviation');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch campaigns
      const campaignsRes = await fetch(`${API_BASE_URL}/admin/ads/campaigns?period=${period}`);
      if (campaignsRes.ok) {
        const data = await campaignsRes.json();
        setCampaigns(data.campaigns || []);
      }

      // Fetch creatives
      const creativesRes = await fetch(`${API_BASE_URL}/admin/ads/creatives?period=${period}`);
      if (creativesRes.ok) {
        const data = await creativesRes.json();
        setCreatives(data.creatives || []);
      }

      // Fetch CPL analysis
      const cplRes = await fetch(`${API_BASE_URL}/admin/ads/cpl-analysis?period=${period}`);
      if (cplRes.ok) {
        const data = await cplRes.json();
        setCplAnalysis(data.analysis || []);
      }
    } catch (err) {
      console.error('Error fetching ads data:', err);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const formatCurrency = (cents: number) => {
    return `$${(cents / 100).toFixed(2)}`;
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return String(num);
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'active':
        return 'bg-green-500';
      case 'paused':
        return 'bg-yellow-500';
      default:
        return 'bg-gray-500';
    }
  };

  // Sort CPL analysis
  const sortedCplAnalysis = [...cplAnalysis].sort((a, b) => {
    if (sortBy === 'deviation') {
      return Math.abs(b.deviation_percent) - Math.abs(a.deviation_percent);
    }
    return b.spend - a.spend;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Реклама</h1>
          <p className="text-muted-foreground">Кампании, креативы и CPL анализ</p>
        </div>

        <div className="flex items-center gap-2">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button variant="outline" onClick={fetchData}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      <Tabs defaultValue="cpl" className="space-y-4">
        <TabsList>
          <TabsTrigger value="cpl" className="gap-2">
            <TrendingUp className="h-4 w-4" />
            CPL Анализ
          </TabsTrigger>
          <TabsTrigger value="campaigns" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            Кампании
          </TabsTrigger>
          <TabsTrigger value="creatives" className="gap-2">
            <Image className="h-4 w-4" />
            Креативы
          </TabsTrigger>
        </TabsList>

        {/* CPL Analysis Tab */}
        <TabsContent value="cpl" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>CPL Анализ по направлениям</CardTitle>
                  <CardDescription>
                    Сравнение планового и реального CPL
                  </CardDescription>
                </div>
                <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
                  <SelectTrigger className="w-[180px]">
                    <ArrowUpDown className="h-4 w-4 mr-2" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="deviation">По отклонению</SelectItem>
                    <SelectItem value="spend">По расходу</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : sortedCplAnalysis.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">Нет данных</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Пользователь</TableHead>
                      <TableHead>Направление</TableHead>
                      <TableHead className="text-right">Плановый CPL</TableHead>
                      <TableHead className="text-right">Реальный CPL</TableHead>
                      <TableHead className="text-right">Отклонение</TableHead>
                      <TableHead className="text-right">Лидов</TableHead>
                      <TableHead className="text-right">Расход</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedCplAnalysis.map((item) => (
                      <TableRow key={`${item.user_id}-${item.direction_id}`}>
                        <TableCell className="font-medium">
                          {item.user_username}
                        </TableCell>
                        <TableCell>{item.direction_name}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(item.planned_cpl)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(item.actual_cpl)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge
                            variant="outline"
                            className={cn(
                              'gap-1',
                              item.deviation_percent < 0
                                ? 'text-green-600 border-green-600'
                                : item.deviation_percent > 20
                                ? 'text-red-600 border-red-600'
                                : 'text-yellow-600 border-yellow-600'
                            )}
                          >
                            {item.deviation_percent < 0 ? (
                              <TrendingDown className="h-3 w-3" />
                            ) : (
                              <TrendingUp className="h-3 w-3" />
                            )}
                            {item.deviation_percent > 0 ? '+' : ''}
                            {item.deviation_percent.toFixed(1)}%
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">{item.leads_count}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(item.spend)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Campaigns Tab */}
        <TabsContent value="campaigns" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Все кампании</CardTitle>
              <CardDescription>
                {campaigns.length} кампаний за выбранный период
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : campaigns.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">Нет кампаний</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Кампания</TableHead>
                      <TableHead>Пользователь</TableHead>
                      <TableHead>Статус</TableHead>
                      <TableHead className="text-right">Расход</TableHead>
                      <TableHead className="text-right">Показы</TableHead>
                      <TableHead className="text-right">Клики</TableHead>
                      <TableHead className="text-right">Лиды</TableHead>
                      <TableHead className="text-right">CPL</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {campaigns.map((campaign) => (
                      <TableRow key={campaign.id}>
                        <TableCell className="font-medium max-w-[200px] truncate">
                          {campaign.name}
                        </TableCell>
                        <TableCell>{campaign.user_username}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="gap-1">
                            <div
                              className={`w-2 h-2 rounded-full ${getStatusColor(campaign.status)}`}
                            />
                            {campaign.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(campaign.spend)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatNumber(campaign.impressions)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatNumber(campaign.clicks)}
                        </TableCell>
                        <TableCell className="text-right">{campaign.leads}</TableCell>
                        <TableCell className="text-right">
                          {campaign.cpl > 0 ? formatCurrency(campaign.cpl) : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Creatives Tab */}
        <TabsContent value="creatives" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Топ креативов</CardTitle>
              <CardDescription>
                Сортировка по эффективности
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : creatives.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">Нет креативов</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Креатив</TableHead>
                      <TableHead>Пользователь</TableHead>
                      <TableHead className="text-right">Расход</TableHead>
                      <TableHead className="text-right">Показы</TableHead>
                      <TableHead className="text-right">CTR</TableHead>
                      <TableHead className="text-right">Лиды</TableHead>
                      <TableHead className="text-right">CPL</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {creatives.map((creative) => (
                      <TableRow key={creative.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            {creative.thumbnail_url ? (
                              <img
                                src={creative.thumbnail_url}
                                alt={creative.name}
                                className="w-10 h-10 rounded object-cover"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded bg-muted flex items-center justify-center">
                                <Image className="h-4 w-4" />
                              </div>
                            )}
                            <span className="font-medium max-w-[150px] truncate">
                              {creative.name}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>{creative.user_username}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(creative.spend)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatNumber(creative.impressions)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge
                            variant="outline"
                            className={cn(
                              creative.ctr >= 2
                                ? 'text-green-600'
                                : creative.ctr < 1
                                ? 'text-red-600'
                                : ''
                            )}
                          >
                            {creative.ctr.toFixed(2)}%
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">{creative.leads}</TableCell>
                        <TableCell className="text-right">
                          {creative.cpl > 0 ? formatCurrency(creative.cpl) : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AdminAds;
