import { DialogStats as DialogStatsType } from '@/types/dialogAnalysis';
import { Card, CardContent } from '@/components/ui/card';

interface DialogStatsProps {
  stats: DialogStatsType | null;
  loading?: boolean;
}

export function DialogStats({ stats, loading }: DialogStatsProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="p-6">
              <div className="h-4 bg-gray-200 rounded w-20 mb-2"></div>
              <div className="h-8 bg-gray-200 rounded w-12"></div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="space-y-4 mb-6">
      {/* Interest Levels */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="text-sm text-gray-500 mb-1">Всего</div>
            <div className="text-3xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-2xl">🔥</span>
              <span className="text-sm text-red-700 font-medium">HOT</span>
            </div>
            <div className="text-3xl font-bold text-red-600">{stats.hot}</div>
          </CardContent>
        </Card>
        
        <Card className="border-orange-200 bg-orange-50">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-2xl">🌤️</span>
              <span className="text-sm text-orange-700 font-medium">WARM</span>
            </div>
            <div className="text-3xl font-bold text-orange-600">{stats.warm}</div>
          </CardContent>
        </Card>
        
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-2xl">❄️</span>
              <span className="text-sm text-blue-700 font-medium">COLD</span>
            </div>
            <div className="text-3xl font-bold text-blue-600">{stats.cold}</div>
          </CardContent>
        </Card>
      </div>

      {/* Funnel Stages */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <Card className="border-gray-300">
          <CardContent className="p-4">
            <div className="text-xs text-gray-500 mb-1">Новые лиды</div>
            <div className="text-xl font-semibold">{stats.new_lead}</div>
          </CardContent>
        </Card>
        
        <Card className="border-yellow-300">
          <CardContent className="p-4">
            <div className="text-xs text-gray-500 mb-1">Не квалифицированы</div>
            <div className="text-xl font-semibold">{stats.not_qualified}</div>
          </CardContent>
        </Card>
        
        <Card className="border-green-300">
          <CardContent className="p-4">
            <div className="text-xs text-gray-500 mb-1">Квалифицированы</div>
            <div className="text-xl font-semibold text-green-600">{stats.qualified}</div>
          </CardContent>
        </Card>
        
        <Card className="border-blue-300">
          <CardContent className="p-4">
            <div className="text-xs text-gray-500 mb-1">Записан</div>
            <div className="text-xl font-semibold text-blue-600">{stats.consultation_booked}</div>
          </CardContent>
        </Card>
        
        <Card className="border-purple-300">
          <CardContent className="p-4">
            <div className="text-xs text-gray-500 mb-1">Прошел</div>
            <div className="text-xl font-semibold">{stats.consultation_completed}</div>
          </CardContent>
        </Card>
        
        <Card className="border-green-500 bg-green-50">
          <CardContent className="p-4">
            <div className="text-xs text-green-700 mb-1 font-medium">Закрыто ✓</div>
            <div className="text-xl font-bold text-green-600">{stats.deal_closed}</div>
          </CardContent>
        </Card>
        
        <Card className="border-red-300">
          <CardContent className="p-4">
            <div className="text-xs text-gray-500 mb-1">Проиграно</div>
            <div className="text-xl font-semibold text-gray-400">{stats.deal_lost}</div>
          </CardContent>
        </Card>
      </div>

      {/* Additional Info */}
      <div className="flex gap-4 text-sm text-gray-600">
        <div>
          <span className="font-medium">Средний score:</span> {stats.avgScore}
        </div>
        <div>
          <span className="font-medium">Всего сообщений:</span> {stats.totalMessages}
        </div>
        <div>
          <span className="font-medium">Квалифицировано:</span> {stats.qualified_count}
        </div>
      </div>
    </div>
  );
}

