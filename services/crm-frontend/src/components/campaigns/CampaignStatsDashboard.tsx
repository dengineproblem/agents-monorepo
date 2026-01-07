import { useQuery } from '@tanstack/react-query';
import { 
  getAnalyticsOverview, 
  getAnalyticsByStrategy, 
  getAnalyticsByTemperature,
  getTemperatureDynamics,
  getAnalyticsByStage 
} from '@/services/campaignApi';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MessageSquare, Target, Clock, TrendingUp, Flame, Wind, Snowflake } from 'lucide-react';
import { 
  LineChart, 
  Line, 
  PieChart, 
  Pie, 
  Cell, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer 
} from 'recharts';

const USER_ACCOUNT_ID = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b';

const TEMPERATURE_COLORS = {
  hot: '#ef4444',
  warm: '#f59e0b',
  cold: '#3b82f6',
};

export function CampaignStatsDashboard() {
  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['campaign-analytics-overview', USER_ACCOUNT_ID],
    queryFn: () => getAnalyticsOverview(USER_ACCOUNT_ID),
    refetchInterval: 60000,
  });

  const { data: byStrategy } = useQuery({
    queryKey: ['campaign-analytics-strategy', USER_ACCOUNT_ID],
    queryFn: () => getAnalyticsByStrategy(USER_ACCOUNT_ID),
    refetchInterval: 60000,
  });

  const { data: byTemperature } = useQuery({
    queryKey: ['campaign-analytics-temperature', USER_ACCOUNT_ID],
    queryFn: () => getAnalyticsByTemperature(USER_ACCOUNT_ID),
    refetchInterval: 60000,
  });

  const { data: dynamics } = useQuery({
    queryKey: ['campaign-temperature-dynamics', USER_ACCOUNT_ID],
    queryFn: () => getTemperatureDynamics(USER_ACCOUNT_ID, 30),
    refetchInterval: 60000,
  });

  const { data: byStage } = useQuery({
    queryKey: ['campaign-analytics-stage', USER_ACCOUNT_ID],
    queryFn: () => getAnalyticsByStage(USER_ACCOUNT_ID),
    refetchInterval: 60000,
  });

  if (overviewLoading) {
    return (
      <div className="text-center py-8">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  // Prepare pie chart data for temperature distribution
  const pieData = byTemperature?.map(t => ({
    name: t.interest_level === 'hot' ? 'Горячие' : t.interest_level === 'warm' ? 'Тёплые' : 'Холодные',
    value: t.sent,
    color: TEMPERATURE_COLORS[t.interest_level as keyof typeof TEMPERATURE_COLORS] || '#6b7280',
  })) || [];

  // Prepare line chart data for dynamics
  const lineData = dynamics?.map(d => ({
    date: new Date(d.snapshot_date).toLocaleDateString('ru-RU', { month: 'short', day: 'numeric' }),
    Горячие: d.hot_count,
    Тёплые: d.warm_count,
    Холодные: d.cold_count,
  })).reverse() || [];

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Общая статистика</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Отправлено</CardTitle>
              <MessageSquare className="h-4 w-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">
                {overview?.totalSent || 0}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Процент ответов</CardTitle>
              <TrendingUp className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {overview?.replyRate?.toFixed(1) || 0}%
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Конверсия</CardTitle>
              <Target className="h-4 w-4 text-purple-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-purple-600">
                {overview?.conversionRate?.toFixed(1) || 0}%
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Время до ответа</CardTitle>
              <Clock className="h-4 w-4 text-orange-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600">
                {overview?.avgTimeToReply?.toFixed(1) || 0}ч
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Время до действия</CardTitle>
              <Clock className="h-4 w-4 text-indigo-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-indigo-600">
                {overview?.avgTimeToAction?.toFixed(1) || 0}д
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Temperature Distribution and Dynamics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Распределение по температуре</CardTitle>
            <CardDescription>Текущее состояние базы лидов</CardDescription>
          </CardHeader>
          <CardContent>
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-gray-500">
                Нет данных
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Динамика изменения температуры</CardTitle>
            <CardDescription>Последние 30 дней</CardDescription>
          </CardHeader>
          <CardContent>
            {lineData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={lineData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="Горячие" stroke="#ef4444" strokeWidth={2} />
                  <Line type="monotone" dataKey="Тёплые" stroke="#f59e0b" strokeWidth={2} />
                  <Line type="monotone" dataKey="Холодные" stroke="#3b82f6" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-gray-500">
                Нет данных
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Strategy Effectiveness */}
      <Card>
        <CardHeader>
          <CardTitle>Эффективность стратегий</CardTitle>
          <CardDescription>Результаты по типам сообщений</CardDescription>
        </CardHeader>
        <CardContent>
          {byStrategy && byStrategy.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-4">Стратегия</th>
                    <th className="text-right py-2 px-4">Отправлено</th>
                    <th className="text-right py-2 px-4">Ответы</th>
                    <th className="text-right py-2 px-4">% Ответов</th>
                    <th className="text-right py-2 px-4">Конверсии</th>
                    <th className="text-right py-2 px-4">% Конверсий</th>
                  </tr>
                </thead>
                <tbody>
                  {byStrategy.map((s, idx) => {
                    const replyRate = parseFloat(s.replyRate);
                    const conversionRate = parseFloat(s.conversionRate);
                    return (
                      <tr key={idx} className="border-b hover:bg-gray-50">
                        <td className="py-2 px-4 font-medium">{s.strategy_type}</td>
                        <td className="text-right py-2 px-4">{s.sent}</td>
                        <td className="text-right py-2 px-4">{s.replies}</td>
                        <td className="text-right py-2 px-4">
                          <span className={`font-semibold ${
                            replyRate >= 30 ? 'text-green-600' : 
                            replyRate >= 15 ? 'text-yellow-600' : 
                            'text-red-600'
                          }`}>
                            {s.replyRate}%
                          </span>
                        </td>
                        <td className="text-right py-2 px-4">{s.conversions}</td>
                        <td className="text-right py-2 px-4">
                          <span className={`font-semibold ${
                            conversionRate >= 20 ? 'text-green-600' : 
                            conversionRate >= 10 ? 'text-yellow-600' : 
                            'text-red-600'
                          }`}>
                            {s.conversionRate}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">Нет данных</div>
          )}
        </CardContent>
      </Card>

      {/* Temperature Effectiveness */}
      <Card>
        <CardHeader>
          <CardTitle>Эффективность по температуре лидов</CardTitle>
          <CardDescription>Результаты в зависимости от теплоты лида</CardDescription>
        </CardHeader>
        <CardContent>
          {byTemperature && byTemperature.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {byTemperature.map((t, idx) => {
                const Icon = t.interest_level === 'hot' ? Flame : t.interest_level === 'warm' ? Wind : Snowflake;
                const color = t.interest_level === 'hot' ? 'red' : t.interest_level === 'warm' ? 'orange' : 'blue';

                return (
                  <Card key={idx}>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">
                        {t.interest_level === 'hot' ? 'Горячие' : t.interest_level === 'warm' ? 'Тёплые' : 'Холодные'}
                      </CardTitle>
                      <Icon className={`h-5 w-5 text-${color}-600`} />
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-600">Отправлено:</span>
                          <span className="font-semibold">{t.sent}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-600">Ответы:</span>
                          <span className="font-semibold">{t.replies} ({t.replyRate}%)</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-600">Конверсии:</span>
                          <span className="font-semibold">{t.conversions} ({t.conversionRate}%)</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">Нет данных</div>
          )}
        </CardContent>
      </Card>

      {/* Stage Effectiveness */}
      <Card>
        <CardHeader>
          <CardTitle>Эффективность по этапам воронки</CardTitle>
          <CardDescription>Результаты в зависимости от этапа на момент отправки</CardDescription>
        </CardHeader>
        <CardContent>
          {byStage && byStage.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-4">Этап воронки</th>
                    <th className="text-right py-2 px-4">Отправлено</th>
                    <th className="text-right py-2 px-4">Ответы</th>
                    <th className="text-right py-2 px-4">Конверсии</th>
                  </tr>
                </thead>
                <tbody>
                  {byStage.map((s, idx) => (
                    <tr key={idx} className="border-b hover:bg-gray-50">
                      <td className="py-2 px-4 font-medium">{s.funnel_stage}</td>
                      <td className="text-right py-2 px-4">{s.sent}</td>
                      <td className="text-right py-2 px-4">{s.replies}</td>
                      <td className="text-right py-2 px-4">{s.conversions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">Нет данных</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
