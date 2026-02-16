import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  Activity,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  FileText,
  Building2,
  Brain
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow, format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { API_BASE_URL } from '@/config/api';
import { useAppContext } from '@/context/AppContext';
import type { OptimizationScope } from '@/hooks/useOptimization';

interface BrainExecution {
  id: string;
  user_account_id: string;
  account_id: string | null;
  plan_json: any;
  actions_json: any[];
  report_text: string;
  status: string;
  duration_ms: number;
  created_at: string;
  execution_mode?: 'batch' | 'manual_trigger' | 'interactive';
  platform?: string | null;
}

interface AdAccount {
  id: string;
  name: string;
}

interface AllAccountsExecutionsSectionProps {
  userAccountId: string;
  adAccounts: AdAccount[];
  onOptimize?: (scope: OptimizationScope) => void;
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

export function AllAccountsExecutionsSection({
  userAccountId,
  adAccounts,
  onOptimize
}: AllAccountsExecutionsSectionProps) {
  const { platform } = useAppContext();
  const [executions, setExecutions] = useState<BrainExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedExecution, setSelectedExecution] = useState<BrainExecution | null>(null);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);

  // Создаём map для быстрого поиска имени аккаунта по ID
  const accountsMap = React.useMemo(() => {
    const map = new Map<string, string>();
    adAccounts.forEach(acc => map.set(acc.id, acc.name));
    return map;
  }, [adAccounts]);

  useEffect(() => {
    if (!userAccountId) return;

    const fetchData = async () => {
      setLoading(true);
      try {
        // Запрашиваем ВСЕ executions без фильтра по accountId
        const url = new URL(`${API_BASE_URL}/autopilot/executions`);
        url.searchParams.set('userAccountId', userAccountId);
        url.searchParams.set('limit', '20');
        url.searchParams.set('platform', platform === 'tiktok' ? 'tiktok' : 'facebook');
        // НЕ передаём accountId - получаем все

        const res = await fetch(url.toString());
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            setExecutions(data.executions || []);
          }
        }
      } catch (error) {
        console.error('[AllAccountsExecutionsSection] Error:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [userAccountId, platform]);

  const openReport = (exec: BrainExecution) => {
    setSelectedExecution(exec);
    setReportDialogOpen(true);
  };

  const getAccountName = (accountId: string | null): string => {
    if (!accountId) return 'Legacy аккаунт';
    return accountsMap.get(accountId) || 'Неизвестный аккаунт';
  };

  // Группируем executions по аккаунтам
  const groupedByAccount = React.useMemo(() => {
    const grouped = new Map<string, BrainExecution[]>();
    executions.forEach(exec => {
      const key = exec.account_id || 'legacy';
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(exec);
    });
    return grouped;
  }, [executions]);

  if (!userAccountId) return null;

  return (
    <>
      <Card className="mt-6 shadow-sm overflow-hidden">
        <CardHeader className="pb-3 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-transparent dark:to-transparent">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg flex items-center justify-center shadow-sm bg-gradient-to-br from-indigo-500 to-purple-600 dark:from-indigo-600/70 dark:to-purple-700/70">
                <Activity className="h-5 w-5 text-white dark:text-gray-300" />
              </div>
              <div>
                <CardTitle className="text-lg">
                  Отчёты и действия
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  История оптимизаций по всем аккаунтам
                </p>
              </div>
            </div>
            {onOptimize && (
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => {
                  // Если есть аккаунты - оптимизируем первый, иначе без accountId (legacy)
                  const defaultAccount = adAccounts[0];
                  onOptimize({
                    accountId: defaultAccount?.id || '',
                    accountName: defaultAccount?.name || 'Все кампании',
                  });
                }}
              >
                <Brain className="h-4 w-4" />
                Brain Mini
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="pt-4">
          {/* История по аккаунтам */}
          {executions.length > 0 && (
            <div className="space-y-4">
              {Array.from(groupedByAccount.entries())
                .slice(0, historyOpen ? undefined : 1) // Показываем 1 группу или все
                .map(([accountKey, accountExecutions]) => (
                  <div key={accountKey} className="space-y-2">
                    {/* Заголовок аккаунта */}
                    <div className="flex items-center gap-2 pb-1 border-b">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">
                        {getAccountName(accountKey === 'legacy' ? null : accountKey)}
                      </span>
                      <Badge variant="secondary" className="text-xs">
                        {accountExecutions.length}
                      </Badge>
                    </div>

                    {/* Executions для этого аккаунта */}
                    {accountExecutions
                      .slice(0, historyOpen ? 5 : 2)
                      .map((exec) => (
                        <div
                          key={exec.id}
                          className="p-3 rounded-lg border bg-white dark:bg-zinc-800/50"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {exec.status === 'success' ? (
                                <CheckCircle2 className="h-4 w-4 text-green-500 dark:text-green-400 flex-shrink-0" />
                              ) : (
                                <XCircle className="h-4 w-4 text-red-500 dark:text-red-400 flex-shrink-0" />
                              )}
                              {/* Дата: на мобильных без времени, на десктопе с временем */}
                              <span className="text-sm font-medium">
                                <span className="md:hidden">{format(new Date(exec.created_at), 'd MMM', { locale: ru })}</span>
                                <span className="hidden md:inline">{format(new Date(exec.created_at), 'd MMM, HH:mm', { locale: ru })}</span>
                              </span>
                              <span className="text-xs text-muted-foreground hidden sm:inline">
                                ({formatDistanceToNow(new Date(exec.created_at), { addSuffix: true, locale: ru })})
                              </span>
                              {exec.execution_mode === 'manual_trigger' && (
                                <Badge variant="outline" className="text-xs px-1.5 py-0 h-5 hidden sm:inline-flex">
                                  Brain Mini
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              {(exec.report_text || (exec.actions_json && exec.actions_json.length > 0)) && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-1 md:px-2 text-xs"
                                  onClick={() => openReport(exec)}
                                >
                                  <FileText className="h-3.5 w-3.5 md:mr-1" />
                                  <span className="hidden md:inline">Отчёт</span>
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                ))}

              {/* Кнопка показать больше */}
              {(groupedByAccount.size > 1 || executions.length > 2) && (
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
                      Показать все ({executions.length})
                    </>
                  )}
                </Button>
              )}
            </div>
          )}

          {/* Пустое состояние */}
          {!loading && executions.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              Нет истории оптимизаций
            </p>
          )}

          {loading && (
            <div className="flex items-center justify-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900 dark:border-gray-100" />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Диалог отчёта (объединённый: текст + действия) */}
      <Dialog open={reportDialogOpen} onOpenChange={setReportDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] bg-white dark:bg-zinc-900">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Отчёт от {selectedExecution && format(new Date(selectedExecution.created_at), 'd MMMM yyyy, HH:mm', { locale: ru })}
            </DialogTitle>
            {selectedExecution?.account_id && (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                {getAccountName(selectedExecution.account_id)}
              </p>
            )}
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            {/* Текст отчёта */}
            {selectedExecution?.report_text && (
              <pre className="text-sm whitespace-pre-wrap font-sans p-4 pb-2">
                {selectedExecution.report_text}
              </pre>
            )}

            {/* Карточки действий */}
            {selectedExecution?.actions_json && selectedExecution.actions_json.length > 0 && (
              <div className="px-4 pb-4 space-y-3">
                {selectedExecution.report_text && (
                  <div className="border-t pt-3">
                    <p className="text-sm font-medium text-muted-foreground mb-2">
                      Детали действий ({selectedExecution.actions_json.length})
                    </p>
                  </div>
                )}
                {(() => {
                  const actions = selectedExecution.actions_json;
                  const grouped = new Map<string, typeof actions>();
                  actions.forEach((action: any) => {
                    const dirName = action.params?.direction_name || 'Общие';
                    if (!grouped.has(dirName)) grouped.set(dirName, []);
                    grouped.get(dirName)!.push(action);
                  });
                  const showGroups = grouped.size > 1 || !grouped.has('Общие');

                  return Array.from(grouped.entries()).map(([dirName, groupActions]) => (
                    <div key={dirName} className="space-y-2">
                      {showGroups && (
                        <div className="flex items-center gap-2 mt-2 mb-1">
                          <Badge variant="outline" className="text-xs font-medium">📁 {dirName}</Badge>
                          <span className="text-xs text-muted-foreground">({groupActions.length})</span>
                        </div>
                      )}
                      {groupActions.map((action: any, index: number) => {
                        const actionType = action.type || action.action;
                        const actionLabel = getActionLabel(actionType);
                        const entityName = action.params?.entity_name;
                        const params = action.params || {};
                        const isSuccess = action.success !== false;
                        const reason = action.params?.reason;

                        let budgetDetail = null;
                        if (actionType === 'updateBudget' || actionType === 'UpdateAdSetDailyBudget') {
                          const current = params.current_budget_cents;
                          const newBudget = params.new_budget_cents || params.daily_budget_cents;
                          if (current && newBudget) {
                            const percent = params.increase_percent ? `+${params.increase_percent}%` : params.decrease_percent ? `-${params.decrease_percent}%` : '';
                            budgetDetail = `$${(current / 100).toFixed(2)} → $${(newBudget / 100).toFixed(2)}${percent ? ` (${percent})` : ''}`;
                          }
                        }

                        return (
                          <div key={`${dirName}-${index}`} className={cn("p-3 rounded-lg border", isSuccess ? "border-zinc-200 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-800/30" : "border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/20")}>
                            <div className="flex items-start gap-2">
                              {isSuccess ? <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" /> : <XCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium">{actionLabel}</p>
                                {entityName && <p className="text-xs text-muted-foreground mt-0.5">{entityName}</p>}
                                {budgetDetail && <p className="text-xs text-blue-600 dark:text-blue-400 mt-1 font-medium">{budgetDetail}</p>}
                                {reason && <p className="text-xs text-muted-foreground mt-1 italic">{reason}</p>}
                                {action.message && !isSuccess && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{action.message}</p>}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ));
                })()}
              </div>
            )}

            {/* Пустое состояние */}
            {!selectedExecution?.report_text && (!selectedExecution?.actions_json || selectedExecution.actions_json.length === 0) && (
              <p className="text-sm text-muted-foreground text-center p-4">Нет данных</p>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default AllAccountsExecutionsSection;
