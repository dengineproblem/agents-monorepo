import { ConversationReport } from '@/types/conversationReport';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronRight, MessageSquare, TrendingUp, Clock, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

interface ConversationReportCardProps {
  report: ConversationReport;
  onClick?: () => void;
  compact?: boolean;
}

export function ConversationReportCard({
  report,
  onClick,
  compact = false,
}: ConversationReportCardProps) {
  const interest = report.interest_distribution || { hot: 0, warm: 0, cold: 0 };
  const totalInterest = interest.hot + interest.warm + interest.cold;

  const formattedDate = format(new Date(report.report_date), 'd MMMM yyyy', { locale: ru });

  if (compact) {
    return (
      <Card
        className="cursor-pointer hover:shadow-md transition-shadow"
        onClick={onClick}
      >
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">{formattedDate}</div>
              <div className="text-sm text-gray-500">
                {report.active_dialogs} активных диалогов
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                {interest.hot}
              </Badge>
              <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">
                {interest.warm}
              </Badge>
              <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                {interest.cold}
              </Badge>
              <ChevronRight className="w-4 h-4 text-gray-400" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={onClick}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{formattedDate}</CardTitle>
          <Badge variant="secondary">
            {format(new Date(report.generated_at), 'HH:mm', { locale: ru })}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {/* Основные метрики */}
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-gray-500" />
            <div>
              <div className="text-2xl font-bold">{report.active_dialogs}</div>
              <div className="text-xs text-gray-500">Активных</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-green-500" />
            <div>
              <div className="text-2xl font-bold">{report.new_dialogs}</div>
              <div className="text-xs text-gray-500">Новых</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-blue-500" />
            <div>
              <div className="text-2xl font-bold">
                {report.avg_response_time_minutes
                  ? `${Math.round(report.avg_response_time_minutes)}м`
                  : '—'}
              </div>
              <div className="text-xs text-gray-500">Ответ</div>
            </div>
          </div>
        </div>

        {/* Распределение по интересу */}
        <div className="flex gap-2 mb-4">
          <div className="flex-1 text-center p-2 rounded bg-red-50 border border-red-200">
            <div className="text-lg font-bold text-red-600">{interest.hot}</div>
            <div className="text-xs text-red-700">Hot</div>
          </div>
          <div className="flex-1 text-center p-2 rounded bg-orange-50 border border-orange-200">
            <div className="text-lg font-bold text-orange-600">{interest.warm}</div>
            <div className="text-xs text-orange-700">Warm</div>
          </div>
          <div className="flex-1 text-center p-2 rounded bg-blue-50 border border-blue-200">
            <div className="text-lg font-bold text-blue-600">{interest.cold}</div>
            <div className="text-xs text-blue-700">Cold</div>
          </div>
        </div>

        {/* Инсайты (первые 2) */}
        {report.insights && report.insights.length > 0 && (
          <div className="space-y-1">
            {report.insights.slice(0, 2).map((insight, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <span className="text-yellow-500">💡</span>
                <span className="text-gray-700 line-clamp-1">{insight}</span>
              </div>
            ))}
          </div>
        )}

        {/* Возражения */}
        {report.common_objections && report.common_objections.length > 0 && (
          <div className="mt-3 flex items-center gap-2 text-sm text-orange-700">
            <AlertCircle className="w-4 h-4" />
            <span>
              {report.common_objections.length} частых возражений
            </span>
          </div>
        )}

        <Button variant="ghost" size="sm" className="w-full mt-3">
          Подробнее <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </CardContent>
    </Card>
  );
}
