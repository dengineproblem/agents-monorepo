import { ConversationReport } from '@/types/conversationReport';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  MessageSquare,
  TrendingUp,
  Clock,
  AlertCircle,
  Lightbulb,
  CheckCircle,
  ArrowLeft,
  Copy,
} from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { toast } from 'sonner';

interface ConversationReportDetailProps {
  report: ConversationReport;
  onBack?: () => void;
}

export function ConversationReportDetail({
  report,
  onBack,
}: ConversationReportDetailProps) {
  const interest = report.interest_distribution || { hot: 0, warm: 0, cold: 0 };
  const funnel = report.funnel_distribution || {};

  const formattedDate = format(new Date(report.report_date), 'd MMMM yyyy', { locale: ru });

  const copyReportText = () => {
    if (report.report_text) {
      navigator.clipboard.writeText(report.report_text);
      toast.success('Отчёт скопирован');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {onBack && (
            <Button variant="ghost" size="icon" onClick={onBack}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
          )}
          <div>
            <h1 className="text-2xl font-bold">{formattedDate}</h1>
            <p className="text-gray-500">
              Сгенерирован: {format(new Date(report.generated_at), 'HH:mm', { locale: ru })}
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={copyReportText}>
          <Copy className="w-4 h-4 mr-2" />
          Копировать
        </Button>
      </div>

      {/* Основные метрики */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-gray-500 mb-1">
              <MessageSquare className="w-4 h-4" />
              <span className="text-sm">Всего диалогов</span>
            </div>
            <div className="text-3xl font-bold">{report.total_dialogs}</div>
          </CardContent>
        </Card>

        <Card className="border-green-200 bg-green-50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-green-700 mb-1">
              <TrendingUp className="w-4 h-4" />
              <span className="text-sm">Активных</span>
            </div>
            <div className="text-3xl font-bold text-green-600">{report.active_dialogs}</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-gray-500 mb-1">
              <MessageSquare className="w-4 h-4" />
              <span className="text-sm">Новых</span>
            </div>
            <div className="text-3xl font-bold">{report.new_dialogs}</div>
          </CardContent>
        </Card>

        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-blue-700 mb-1">
              <Clock className="w-4 h-4" />
              <span className="text-sm">Ср. ответ</span>
            </div>
            <div className="text-3xl font-bold text-blue-600">
              {report.avg_response_time_minutes
                ? `${Math.round(report.avg_response_time_minutes)} мин`
                : '—'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Сообщения */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Сообщения за период</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-8">
            <div>
              <div className="text-sm text-gray-500">Входящих</div>
              <div className="text-2xl font-bold text-green-600">
                📥 {report.total_incoming_messages}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Исходящих</div>
              <div className="text-2xl font-bold text-blue-600">
                📤 {report.total_outgoing_messages}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Распределение по интересу */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Распределение по интересу</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-4 rounded-lg bg-red-50 border border-red-200">
              <div className="text-3xl font-bold text-red-600">{interest.hot}</div>
              <div className="text-sm text-red-700 font-medium mt-1">🔥 Hot</div>
            </div>
            <div className="text-center p-4 rounded-lg bg-orange-50 border border-orange-200">
              <div className="text-3xl font-bold text-orange-600">{interest.warm}</div>
              <div className="text-sm text-orange-700 font-medium mt-1">☀️ Warm</div>
            </div>
            <div className="text-center p-4 rounded-lg bg-blue-50 border border-blue-200">
              <div className="text-3xl font-bold text-blue-600">{interest.cold}</div>
              <div className="text-sm text-blue-700 font-medium mt-1">❄️ Cold</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Воронка */}
      {Object.keys(funnel).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Распределение по воронке</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
              {[
                { key: 'new_lead', label: 'Новые', color: 'gray' },
                { key: 'not_qualified', label: 'Не квалиф.', color: 'yellow' },
                { key: 'qualified', label: 'Квалиф.', color: 'green' },
                { key: 'consultation_booked', label: 'Записан', color: 'blue' },
                { key: 'consultation_completed', label: 'Прошёл', color: 'purple' },
                { key: 'deal_closed', label: 'Закрыто', color: 'emerald' },
                { key: 'deal_lost', label: 'Проиграно', color: 'red' },
              ].map((stage) => (
                <div
                  key={stage.key}
                  className={`text-center p-3 rounded border bg-${stage.color}-50 border-${stage.color}-200`}
                >
                  <div className="text-xl font-bold">{funnel[stage.key] || 0}</div>
                  <div className="text-xs text-gray-600">{stage.label}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Инсайты */}
      {report.insights && report.insights.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Lightbulb className="w-5 h-5 text-yellow-500" />
              Инсайты
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {report.insights.map((insight, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="text-yellow-500 mt-0.5">💡</span>
                  <span className="text-gray-700">{insight}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Частые возражения */}
      {report.common_objections && report.common_objections.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-orange-500" />
              Частые возражения
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {report.common_objections.map((obj, i) => (
                <div key={i} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-orange-700">"{obj.objection}"</span>
                    <Badge variant="outline">{obj.count}x</Badge>
                  </div>
                  {obj.suggested_response && (
                    <div className="text-sm text-gray-600 bg-gray-50 p-3 rounded mt-2">
                      <span className="text-green-600 font-medium">Рекомендуемый ответ: </span>
                      {obj.suggested_response}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Причины отказа */}
      {report.rejection_reasons && report.rejection_reasons.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Причины отказа</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {report.rejection_reasons.map((reason, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-red-50 rounded">
                  <span className="text-red-700">{reason.reason}</span>
                  <Badge variant="destructive">{reason.count}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Рекомендации */}
      {report.recommendations && report.recommendations.length > 0 && (
        <Card className="border-green-200">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2 text-green-700">
              <CheckCircle className="w-5 h-5" />
              Рекомендации
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {report.recommendations.map((rec, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="text-green-500 font-bold">{i + 1}.</span>
                  <span className="text-gray-700">{rec}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Текст отчёта */}
      {report.report_text && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Полный текст отчёта</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap text-sm bg-gray-50 p-4 rounded-lg font-mono">
              {report.report_text}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
