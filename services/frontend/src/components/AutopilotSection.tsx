import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
  Eye,
  Brain
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow, format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { API_BASE_URL } from '@/config/api';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { TooltipKeys } from '@/content/tooltips';
import { useAppContext } from '@/context/AppContext';

interface BrainExecution {
  id: string;
  user_account_id: string;
  plan_json: any;
  actions_json: any[];
  report_text: string;
  status: string;
  duration_ms: number;
  created_at: string;
  execution_mode?: 'batch' | 'manual_trigger' | 'interactive';
  platform?: string | null;
}

interface AutopilotSectionProps {
  aiAutopilot: boolean;
  toggleAiAutopilot: (enabled: boolean) => Promise<void>;
  aiAutopilotLoading: boolean;
  userAccountId: string;
  currentAdAccountId?: string | null;  // Для фильтрации данных
  isMultiAccountMode?: boolean;  // true = мультиаккаунт (без toggle), false = legacy (с toggle)
  onOptimize?: () => void;  // Callback для запуска AI Optimization
}

// Карта типов действий на понятные названия
const ACTION_TYPE_LABELS: Record<string, string> = {
  PauseCampaign: 'Пауза кампании',
  ResumeCampaign: 'Возобновление кампании',
  PauseAdSet: 'Пауза группы',
  ResumeAdSet: 'Возобновление группы',
  PauseAd: 'Пауза объявления',
  ResumeAd: 'Включение объявления',
  UpdateAdSetDailyBudget: 'Изменение бюджета',
  ScaleAdSetBudget: 'Масштабирование',
  GetCampaignStatus: 'Проверка статуса',
  'Direction.CreateAdSetWithCreatives': 'Создание группы',
  // Brain Mini actions
  updateBudget: '💰 Изменение бюджета',
  pauseAdSet: '⏸️ Пауза группы',
  pauseAd: '⏸️ Пауза объявления',
  enableAdSet: '▶️ Включение группы',
  enableAd: '▶️ Включение объявления',
  createAdSet: '➕ Создание группы',
  launchNewCreatives: '🚀 Запуск креативов',
  review: '👀 Требует внимания',
};

function getActionLabel(actionType: string): string {
  return ACTION_TYPE_LABELS[actionType] || actionType.replace('Direction.', '');
}

// Форматирование параметров действия для отображения
function formatActionParams(action: any): string {
  const params = action.params || {};
  const parts: string[] = [];
  const actionType = action.type || action.action;

  // Направление (если есть)
  if (params.direction_name) {
    parts.push(`📁 ${params.direction_name}`);
  }

  // Название сущности (адсет/объявление)
  if (params.entity_name) {
    parts.push(params.entity_name);
  }

  // Для бюджетных действий - показываем изменения
  if (actionType === 'updateBudget' || actionType === 'UpdateAdSetDailyBudget' || actionType === 'ScaleAdSetBudget') {
    const currentBudgetCents = params.current_budget_cents;
    const newBudgetCents = params.new_budget_cents || params.daily_budget_cents;
    const currentBudgetKzt = params.current_budget ?? params.current_budget_kzt;
    const newBudgetKzt = params.new_budget ?? params.daily_budget ?? params.daily_budget_kzt;
    const hasCents = currentBudgetCents !== undefined || newBudgetCents !== undefined;

    if (hasCents && currentBudgetCents && newBudgetCents) {
      const current = `$${(currentBudgetCents / 100).toFixed(2)}`;
      const next = `$${(newBudgetCents / 100).toFixed(2)}`;
      const percentChange = params.increase_percent
        ? `+${params.increase_percent}%`
        : params.decrease_percent
          ? `-${params.decrease_percent}%`
          : '';
      parts.push(`${current} → ${next}${percentChange ? ` (${percentChange})` : ''}`);
    } else if (hasCents && newBudgetCents) {
      parts.push(`Бюджет: $${(newBudgetCents / 100).toFixed(2)}`);
    } else if (!hasCents && (currentBudgetKzt || newBudgetKzt)) {
      if (currentBudgetKzt && newBudgetKzt) {
        parts.push(`${Number(currentBudgetKzt).toLocaleString('ru-RU')} ₸ → ${Number(newBudgetKzt).toLocaleString('ru-RU')} ₸`);
      } else if (newBudgetKzt) {
        parts.push(`Бюджет: ${Number(newBudgetKzt).toLocaleString('ru-RU')} ₸`);
      }
    }
  }

  // Fallback на ID если нет имён
  if (parts.length === 0) {
    if (params.adset_name) parts.push(`Группа: ${params.adset_name}`);
    else if (params.adset_id) parts.push(`Группа: ${params.adset_id}`);
    if (params.ad_id && !params.entity_name) parts.push(`Объявление: ${params.ad_id}`);
    if (params.campaign_id) parts.push(`Кампания: ${params.campaign_id}`);
    if (params.status) parts.push(`Статус: ${params.status}`);
  }

  return parts.join(' • ') || 'Нет параметров';
}

export function AutopilotSection({
  aiAutopilot,
  toggleAiAutopilot,
  aiAutopilotLoading,
  userAccountId,
  currentAdAccountId,
  isMultiAccountMode = false,
  onOptimize
}: AutopilotSectionProps) {
  const { platform } = useAppContext();
  const [executions, setExecutions] = useState<BrainExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedExecution, setSelectedExecution] = useState<BrainExecution | null>(null);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [actionsDialogOpen, setActionsDialogOpen] = useState(false);

  useEffect(() => {
    if (!userAccountId) return;

    const fetchData = async () => {
      const mode = currentAdAccountId ? 'multi_account' : 'legacy';
      console.log('[AutopilotSection] fetchData called:', {
        userAccountId,
        currentAdAccountId,
        mode
      });

      setLoading(true);
      try {
        // Формируем URL с учётом мультиаккаунтного режима
        const url = new URL(`${API_BASE_URL}/autopilot/executions`);
        url.searchParams.set('userAccountId', userAccountId);
        url.searchParams.set('limit', '10');
        url.searchParams.set('platform', platform === 'tiktok' ? 'tiktok' : 'facebook');

        // В мультиаккаунтном режиме фильтруем по конкретному аккаунту
        if (currentAdAccountId) {
          url.searchParams.set('accountId', currentAdAccountId);
        }

        console.log('[AutopilotSection] Fetching executions:', {
          url: url.toString(),
          mode,
          filter: currentAdAccountId ? `accountId=${currentAdAccountId}` : 'all accounts (legacy)'
        });

        const res = await fetch(url.toString());
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            setExecutions(data.executions || []);
            console.log('[AutopilotSection] Executions loaded:', {
              count: data.executions?.length || 0,
              mode,
              accountId: currentAdAccountId || 'legacy'
            });
          } else {
            console.warn('[AutopilotSection] API returned success=false:', data);
          }
        } else {
          console.error('[AutopilotSection] Fetch failed:', {
            status: res.status,
            statusText: res.statusText
          });
        }
      } catch (error) {
        console.error('[AutopilotSection] Error fetching autopilot data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [userAccountId, currentAdAccountId, platform]);

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
                isMultiAccountMode
                  ? "bg-gradient-to-br from-blue-500 to-indigo-600 dark:from-blue-600/70 dark:to-indigo-700/70"
                  : aiAutopilot
                    ? "bg-gradient-to-br from-green-500 to-emerald-600 dark:from-green-600/70 dark:to-emerald-700/70"
                    : "bg-gradient-to-br from-gray-600 to-slate-700 dark:from-gray-700/50 dark:to-slate-800/50"
              )}>
                {isMultiAccountMode ? (
                  <FileText className="h-5 w-5 text-white dark:text-gray-300" />
                ) : (
                  <Bot className="h-5 w-5 text-white dark:text-gray-300" />
                )}
              </div>
              <div>
                <CardTitle className="text-lg flex items-center gap-1">
                  {isMultiAccountMode ? 'Отчёты и действия' : 'AI автопилот'}
                  <HelpTooltip tooltipKey={TooltipKeys.AUTOPILOT_STATUS} iconSize="sm" />
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isMultiAccountMode ? 'История оптимизаций' : 'Автоматическое управление кампаниями'}
                </p>
              </div>
            </div>
            {/* Тогл автопилота и кнопка оптимизации для legacy аккаунтов */}
            {!isMultiAccountMode && (
              <div className="flex items-center gap-3">
                {onOptimize && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={onOptimize}
                  >
                    <Brain className="h-4 w-4" />
                    AI Optimization
                  </Button>
                )}
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
            )}
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
                      {exec.execution_mode === 'manual_trigger' && (
                        <Badge variant="outline" className="text-xs px-1.5 py-0 h-5">
                          Brain Mini
                        </Badge>
                      )}
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
              {isMultiAccountMode
                ? 'Нет истории оптимизаций'
                : aiAutopilot
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
            <div className="space-y-3 p-1">
              {(() => {
                const actions = selectedExecution?.actions_json || [];
                // Группируем по direction_name
                const grouped = new Map<string, typeof actions>();
                actions.forEach((action: any) => {
                  const dirName = action.params?.direction_name || 'Общие';
                  if (!grouped.has(dirName)) {
                    grouped.set(dirName, []);
                  }
                  grouped.get(dirName)!.push(action);
                });

                const showGroups = grouped.size > 1 || !grouped.has('Общие');

                return Array.from(grouped.entries()).map(([dirName, groupActions]) => (
                  <div key={dirName} className="space-y-2">
                    {showGroups && (
                      <div className="flex items-center gap-2 mt-2 mb-1">
                        <Badge variant="outline" className="text-xs font-medium">
                          📁 {dirName}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          ({groupActions.length})
                        </span>
                      </div>
                    )}
                    {groupActions.map((action: any, index: number) => {
                      const actionType = action.type || action.action;
                      const actionLabel = getActionLabel(actionType);
                      const entityName = action.params?.entity_name;
                      const params = action.params || {};

                      // Детали для бюджетных изменений
                      let budgetDetail = null;
                      if (actionType === 'updateBudget' || actionType === 'UpdateAdSetDailyBudget') {
                        const current = params.current_budget_cents;
                        const newBudget = params.new_budget_cents || params.daily_budget_cents;
                        if (current && newBudget) {
                          const percent = params.increase_percent
                            ? `+${params.increase_percent}%`
                            : params.decrease_percent
                              ? `-${params.decrease_percent}%`
                              : '';
                          budgetDetail = `$${(current / 100).toFixed(2)} → $${(newBudget / 100).toFixed(2)}${percent ? ` (${percent})` : ''}`;
                        }
                      }

                      return (
                        <div
                          key={`${dirName}-${index}`}
                          className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-800/30"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium">{actionLabel}</p>
                              {entityName && (
                                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                  {entityName}
                                </p>
                              )}
                              {budgetDetail && (
                                <p className="text-xs text-blue-600 dark:text-blue-400 mt-1 font-medium">
                                  {budgetDetail}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ));
              })()}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
