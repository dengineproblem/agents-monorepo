import React, { useMemo, useEffect, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { formatShortDate, formatCurrency, formatNumber } from '../utils/formatters';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar
} from 'recharts';
import { facebookApi } from '../services/facebookApi';

interface MetricsChartProps {
  campaignId: string;
}

const MetricsChart: React.FC<MetricsChartProps> = ({ campaignId }) => {
  const { dateRange } = useAppContext();
  const [chartStats, setChartStats] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    facebookApi.getCampaignStatsByDay(campaignId, dateRange)
      .then(setChartStats)
      .finally(() => setLoading(false));
  }, [campaignId, dateRange]);

  const chartData = useMemo(() => {
    if (!chartStats || chartStats.length === 0) return [];
    return chartStats
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map(stat => ({
        date: stat.date,
        spend: stat.spend,
        leads: stat.leads,
        rawDate: stat.date,
      }));
  }, [chartStats]);
  
  // Диагностика: выводим все campaignStats по кампании
  const debugStats = chartStats.filter(stat => stat.campaign_id === campaignId);
  console.log('DEBUG campaignStats for campaignId', campaignId, debugStats.map(s => s.date));

  if (loading || chartData.length === 0) {
    return (
      <div className="space-y-4 animate-in fade-in duration-300">
        <div className="relative h-64 w-full overflow-hidden rounded-lg">
          <div className="absolute inset-0 bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 animate-pulse" />
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/60 to-transparent animate-shimmer" />
        </div>
        <div className="relative h-64 w-full overflow-hidden rounded-lg">
          <div className="absolute inset-0 bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 animate-pulse" />
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/60 to-transparent animate-shimmer" />
        </div>
      </div>
    );
  }
  
  return (
    <div className="space-y-4">
      <div className="p-4 bg-card rounded-lg border border-border">
        <h3 className="text-sm font-medium mb-2">Расход по дням</h3>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart
            data={chartData}
            margin={{
              top: 5,
              right: 5,
              left: 5,
              bottom: 5,
            }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis 
              dataKey="date" 
              tick={{ fontSize: 12 }} 
              tickLine={false}
              axisLine={false}
              interval={Math.ceil(chartData.length / 10)}
            />
            <YAxis 
              tick={{ fontSize: 12 }} 
              tickLine={false} 
              axisLine={false} 
              tickFormatter={(value) => `₽${value}`}
              width={40}
            />
            <Tooltip 
              formatter={(value) => [formatCurrency(Number(value)), 'Расход']}
              labelFormatter={(label) => `Дата: ${label}`}
            />
            <Bar dataKey="spend" fill="#0088cc" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="p-4 bg-card rounded-lg border border-border">
        <h3 className="text-sm font-medium mb-2">Лиды по дням</h3>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart
            data={chartData}
            margin={{
              top: 5,
              right: 5,
              left: 5,
              bottom: 5,
            }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis 
              dataKey="date" 
              tick={{ fontSize: 12 }} 
              tickLine={false}
              axisLine={false}
              interval={Math.ceil(chartData.length / 10)}
            />
            <YAxis 
              tick={{ fontSize: 12 }} 
              tickLine={false} 
              axisLine={false}
              width={25}
            />
            <Tooltip 
              formatter={(value) => [formatNumber(Number(value)), 'Лиды']}
              labelFormatter={(label) => `Дата: ${label}`}
            />
            <Line 
              type="monotone" 
              dataKey="leads" 
              stroke="#54a9eb" 
              strokeWidth={2} 
              dot={{ r: 3 }} 
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default MetricsChart;
