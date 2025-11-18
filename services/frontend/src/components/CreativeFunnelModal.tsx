/**
 * Модалка распределения лидов по воронке для конкретного креатива
 * 
 * Показывает таблицу с этапами воронки, количеством лидов и процентами
 */

import React, { useEffect, useState } from 'react';
import { RefreshCw, Loader2, Filter } from 'lucide-react';
import { getCreativeFunnelStats, triggerLeadsSync, FunnelStats } from '../services/amocrmApi';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface CreativeFunnelModalProps {
  isOpen: boolean;
  onClose: () => void;
  creativeId: string;
  creativeName: string;
  userAccountId: string;
  directionId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export function CreativeFunnelModal({
  isOpen,
  onClose,
  creativeId,
  creativeName,
  userAccountId,
  directionId,
  dateFrom,
  dateTo,
}: CreativeFunnelModalProps) {
  const [stats, setStats] = useState<FunnelStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getCreativeFunnelStats({
        userAccountId,
        creativeId,
        directionId,
        dateFrom,
        dateTo,
      });
      setStats(data);
    } catch (err: any) {
      setError(err.message || 'Не удалось загрузить статистику воронки');
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await triggerLeadsSync(userAccountId);
      // Перезагружаем статистику после синхронизации
      await loadStats();
    } catch (err: any) {
      setError(err.message || 'Не удалось синхронизировать лиды');
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadStats();
    }
  }, [isOpen, creativeId, userAccountId, directionId, dateFrom, dateTo]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            Распределение по воронке
          </DialogTitle>
          <DialogDescription className="text-sm">
            {creativeName}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600 dark:text-blue-400" />
            </div>
          ) : error ? (
            <Card className="bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800">
              <CardContent className="p-4">
                <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
              </CardContent>
            </Card>
          ) : stats && stats.total_leads > 0 ? (
            <div className="space-y-4">
              {/* Статистика */}
              <Card className="bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800">
                <CardContent className="p-4">
                  <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">
                    Всего лидов: {stats.total_leads}
                  </p>
                </CardContent>
              </Card>

              {/* Таблица этапов */}
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="min-w-full">
                      <thead className="bg-muted/50 border-b">
                        <tr>
                          <th className="py-3 px-4 text-left text-xs font-medium text-muted-foreground">
                            Этап
                          </th>
                          <th className="py-3 px-4 text-left text-xs font-medium text-muted-foreground">
                            Воронка
                          </th>
                          <th className="py-3 px-4 text-right text-xs font-medium text-muted-foreground">
                            Лидов
                          </th>
                          <th className="py-3 px-4 text-right text-xs font-medium text-muted-foreground">
                            %
                          </th>
                          <th className="py-3 px-4 text-left text-xs font-medium text-muted-foreground">
                            Прогресс
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {stats.stages.map((stage, index) => (
                          <tr key={index} className="hover:bg-muted/30 transition-colors">
                            <td className="py-3 px-4 whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                <div
                                  className="w-3 h-3 rounded-full"
                                  style={{ backgroundColor: stage.color || '#999' }}
                                />
                                <span className="text-sm font-medium">
                                  {stage.stage_name}
                                </span>
                              </div>
                            </td>
                            <td className="py-3 px-4 whitespace-nowrap text-sm text-muted-foreground">
                              {stage.pipeline_name}
                            </td>
                            <td className="py-3 px-4 whitespace-nowrap text-right text-sm font-semibold">
                              {stage.count}
                            </td>
                            <td className="py-3 px-4 whitespace-nowrap text-right">
                              <Badge variant="outline" className="font-semibold">
                                {stage.percentage}%
                              </Badge>
                            </td>
                            <td className="py-3 px-4">
                              <div className="w-full bg-muted rounded-full h-2">
                                <div
                                  className="h-2 rounded-full transition-all duration-300"
                                  style={{
                                    width: `${stage.percentage}%`,
                                    backgroundColor: stage.color || '#3b82f6',
                                  }}
                                />
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <Filter className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground mb-2">
                  Лидов не найдено в AmoCRM для этого креатива
                </p>
                <p className="text-sm text-muted-foreground">
                  Убедитесь, что лиды синхронизированы с AmoCRM и имеют правильный creative_id
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between">
          <Button
            onClick={handleSync}
            disabled={syncing}
            variant="outline"
            size="sm"
          >
            {syncing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Синхронизация...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Обновить из AmoCRM
              </>
            )}
          </Button>
          <Button onClick={onClose} variant="secondary" size="sm">
            Закрыть
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
