import { useQuery } from '@tanstack/react-query';
import { chatbotApi } from '@/services/chatbotApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Bot, Users, Clock, CheckCircle } from 'lucide-react';

export function BotStatsDashboard() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['bot-stats'],
    queryFn: () => chatbotApi.getStats(),
  });

  if (isLoading) {
    return (
      <div className="text-center py-8">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  const statsData = [
    {
      title: 'Всего диалогов',
      value: stats?.totalDialogs || 0,
      icon: Bot,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      title: 'Активных',
      value: stats?.activeDialogs || 0,
      icon: Users,
      color: 'text-green-600',
      bg: 'bg-green-50',
    },
    {
      title: 'В работе',
      value: stats?.inProgressDialogs || 0,
      icon: Clock,
      color: 'text-orange-600',
      bg: 'bg-orange-50',
    },
    {
      title: 'На паузе',
      value: stats?.pausedDialogs || 0,
      icon: CheckCircle,
      color: 'text-gray-600',
      bg: 'bg-gray-50',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {statsData.map((stat) => {
        const Icon = stat.icon;
        return (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {stat.title}
              </CardTitle>
              <div className={`p-2 rounded-lg ${stat.bg}`}>
                <Icon className={`h-4 w-4 ${stat.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${stat.color}`}>
                {stat.value}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}



