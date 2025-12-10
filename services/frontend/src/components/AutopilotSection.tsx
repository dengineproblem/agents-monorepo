import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Bot,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  Activity,
  FileText,
  Eye
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow, format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { API_BASE_URL } from '@/config/api';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { TooltipKeys } from '@/content/tooltips';

interface BrainExecution {
  id: string;
  user_account_id: string;
  plan_json: any;
  actions_json: any[];
  report_text: string;
  status: string;
  duration_ms: number;
  created_at: string;
}

interface AutopilotSectionProps {
  aiAutopilot: boolean;
  toggleAiAutopilot: (enabled: boolean) => Promise<void>;
  aiAutopilotLoading: boolean;
  userAccountId: string;
}

// Карта типов действий на понятные названия
const ACTION_TYPE_LABELS: Record<string, string> = {
  PauseCampaign: 'Пауза кампании',
  ResumeCampaign: 'Возобновление кампании',
  PauseAdSet: 'Пауза группы',
  ResumeAdSet: 'Возобновление группы',
  PauseAd: 'Пауза объявления',
  UpdateAdSetDailyBudget: 'Изменение бюджета',
  ScaleAdSetBudget: 'Масштабирование',
  GetCampaignStatus: 'Проверка статуса',
  'Direction.CreateAdSetWithCreatives': 'Создание группы',
};

function getActionLabel(actionType: string): string {
  return ACTION_TYPE_LABELS[actionType] || actionType.replace('Direction.', '');
}

// Форматирование параметров действия
function formatActionParams(action: any): string {
  const params = action.params || {};
  const parts: string[] = [];

  if (params.campaign_id) parts.push(`Кампания: ${params.campaign_id}`);
  if (params.adset_id) parts.push(`Группа: ${params.adset_id}`);
  if (params.ad_id) parts.push(`Объявление: ${params.ad_id}`);
  if (params.adset_name) parts.push(`Название: ${params.adset_name}`);
  if (params.daily_budget) parts.push(`Бюджет: $${(params.daily_budget / 100).toFixed(2)}`);
  if (params.daily_budget_cents) parts.push(`Бюджет: $${(params.daily_budget_cents / 100).toFixed(2)}`);
  if (params.status) parts.push(`Статус: ${params.status}`);

  return parts.join(' • ') || 'Нет параметров';
}

export function AutopilotSection({
  aiAutopilot,
  toggleAiAutopilot,
  aiAutopilotLoading,
  userAccountId
}: AutopilotSectionProps) {
  const [executions, setExecutions] = useState<BrainExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedExecution, setSelectedExecution] = useState<BrainExecution | null>(null);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [actionsDialogOpen, setActionsDialogOpen] = useState(false);

  useEffect(() => {
    if (!userAccountId) return;

    const fetchData = async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE_URL}/autopilot/executions?userAccountId=${userAccountId}&limit=10`);
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            setExecutions(data.executions || []);
          }
        }
      } catch (error) {
        console.error('Error fetching autopilot data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [userAccountId]);

  const openReport = (exec: BrainExecution) => {
    setSelectedExecution(exec);
    setReportDialogOpen(true);
  };

  const openActions = (exec: BrainExecution) => {
    setSelectedExecution(exec);
    setActionsDialogOpen(true);
  };


  return (
    <>
      <Card className="mb-6 shadow-sm overflow-hidden">
        <CardHeader className="pb-3 bg-gradient-to-r from-gray-50 to-slate-50 dark:from-transparent dark:to-transparent">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={cn(
                "h-10 w-10 rounded-lg flex items-center justify-center shadow-sm transition-all",
                aiAutopilot
                  ? "bg-gradient-to-br from-green-500 to-emerald-600 dark:from-green-600/70 dark:to-emerald-700/70"
                  : "bg-gradient-to-br from-gray-600 to-slate-700 dark:from-gray-700/50 dark:to-slate-800/50"
              )}>
                <Bot className="h-5 w-5 text-white dark:text-gray-300" />
              </div>
              <div>
                <CardTitle className="text-lg flex items-center gap-1">
                  AI автопилот
                  <HelpTooltip tooltipKey={TooltipKeys.AUTOPILOT_STATUS} iconSize="sm" />
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Автоматическое управление кампаниями
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-block w-2.5 h-2.5 rounded-full transition-all",
                  aiAutopilot
                    ? 'bg-gradient-to-br from-green-400 to-emerald-500 dark:from-green-500/70 dark:to-emerald-500/70 shadow-sm animate-pulse'
                    : 'bg-gray-300 dark:bg-gray-600'
                )}
                title={aiAutopilot ? 'Автопилот включен' : 'Автопилот выключен'}
              />
              <Switch
                checked={aiAutopilot}
                onCheckedChange={toggleAiAutopilot}
                disabled={aiAutopilotLoading}
              />
              <HelpTooltip tooltipKey={TooltipKeys.AUTOPILOT_TOGGLE} iconSize="sm" />
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-4">
          {/* История запусков */}
          {executions.length > 0 && (
            <div className="space-y-2">
              {executions.slice(0, historyOpen ? 10 : 3).map((exec) => (
                <div
                  key={exec.id}
                  className="p-3 rounded-lg border bg-white dark:bg-zinc-800/50"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {exec.status === 'success' ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500 dark:text-green-400" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-500 dark:text-red-400" />
                      )}
                      <span className="text-sm font-medium">
                        {format(new Date(exec.created_at), 'd MMM, HH:mm', { locale: ru })}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        ({formatDistanceToNow(new Date(exec.created_at), { addSuffix: true, locale: ru })})
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      {exec.report_text && (
                        <div className="flex items-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => openReport(exec)}
                          >
                            <FileText className="h-3.5 w-3.5 mr-1" />
                            Отчёт
                          </Button>
                          <HelpTooltip tooltipKey={TooltipKeys.AUTOPILOT_REPORT} iconSize="sm" />
                        </div>
                      )}
                      {exec.actions_json && exec.actions_json.length > 0 && (
                        <div className="flex items-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => openActions(exec)}
                          >
                            <Eye className="h-3.5 w-3.5 mr-1" />
                            Действия ({exec.actions_json.length})
                          </Button>
                          <HelpTooltip tooltipKey={TooltipKeys.AUTOPILOT_ACTIONS} iconSize="sm" />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {/* Кнопка показать больше */}
              {executions.length > 3 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground"
                  onClick={() => setHistoryOpen(!historyOpen)}
                >
                  {historyOpen ? (
                    <>
                      <ChevronUp className="h-4 w-4 mr-1" />
                      Свернуть
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-4 w-4 mr-1" />
                      Показать ещё ({executions.length - 3})
                    </>
                  )}
                </Button>
              )}
            </div>
          )}

          {/* Пустое состояние */}
          {!loading && executions.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              {aiAutopilot
                ? 'Автопилот активен. Ожидание первого запуска...'
                : 'Включите автопилот для автоматического управления кампаниями'
              }
            </p>
          )}

          {loading && (
            <div className="flex items-center justify-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900 dark:border-gray-100" />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Диалог отчёта */}
      <Dialog open={reportDialogOpen} onOpenChange={setReportDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] bg-white dark:bg-zinc-900">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Отчёт от {selectedExecution && format(new Date(selectedExecution.created_at), 'd MMMM yyyy, HH:mm', { locale: ru })}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <pre className="text-sm whitespace-pre-wrap font-sans p-4">
              {selectedExecution?.report_text || 'Нет отчёта'}
            </pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Диалог действий */}
      <Dialog open={actionsDialogOpen} onOpenChange={setActionsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] bg-white dark:bg-zinc-900">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Действия ({selectedExecution?.actions_json?.length || 0})
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-2 p-1">
              {selectedExecution?.actions_json?.map((action, index) => {
                const actionLabel = getActionLabel(action.type || action.action);
                return (
                  <div
                    key={index}
                    className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-700"
                  >
                    <p className="text-sm font-medium mb-1">{actionLabel}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatActionParams(action)}
                    </p>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
