import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { RefreshCw, Settings, ChevronDown, ChevronUp, Info } from 'lucide-react';
import { KeyStageSelector } from './KeyStageSelector';
import { recalculateKeyStageStats } from '@/services/amocrmApi';
import { salesApi, type Direction } from '@/services/salesApi';

interface AmoCRMKeyStageSettingsProps {
  userAccountId: string;
  onClose?: () => void;
}

export const AmoCRMKeyStageSettings: React.FC<AmoCRMKeyStageSettingsProps> = ({
  userAccountId,
  onClose,
}) => {
  const [directions, setDirections] = useState<Direction[]>([]);
  const [loading, setLoading] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedDirections, setExpandedDirections] = useState<Set<string>>(new Set());
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    loadDirections();
  }, [userAccountId]);

  const loadDirections = async () => {
    try {
      setLoading(true);
      setError(null);
      console.log('[AmoCRMKeyStageSettings] Loading directions for userAccountId:', userAccountId);
      const { data, error: dirError } = await salesApi.getDirections(userAccountId);

      if (dirError) {
        console.error('[AmoCRMKeyStageSettings] Error loading directions:', dirError);
        throw new Error(dirError);
      }

      console.log('[AmoCRMKeyStageSettings] Loaded directions:', data);
      setDirections(data);

      // Auto-expand all directions initially
      setExpandedDirections(new Set(data.map(d => d.id)));
    } catch (err: any) {
      console.error('[AmoCRMKeyStageSettings] Failed to load directions:', {
        userAccountId,
        error: err,
        message: err.message,
        stack: err.stack
      });
      setError(err.message || 'Не удалось загрузить направления');
    } finally {
      setLoading(false);
    }
  };

  const handleRecalculate = async () => {
    try {
      setRecalculating(true);
      setError(null);
      setSuccessMessage(null);

      console.log('[AmoCRMKeyStageSettings] Recalculating key stage stats for userAccountId:', userAccountId);
      const result = await recalculateKeyStageStats(userAccountId);
      console.log('[AmoCRMKeyStageSettings] Recalculation result:', result);

      setSuccessMessage(
        `Статистика пересчитана успешно! Обновлено лидов: ${result.synced}`
      );

      // Clear success message after 5 seconds
      setTimeout(() => {
        setSuccessMessage(null);
      }, 5000);
    } catch (err: any) {
      console.error('[AmoCRMKeyStageSettings] Failed to recalculate stats:', {
        userAccountId,
        error: err,
        message: err.message,
        stack: err.stack
      });
      // На локалхосте без AmoCRM показываем информативное сообщение
      if (err.message?.includes('Failed to fetch') || err.message?.includes('амокрм')) {
        setError('AmoCRM недоступен (локальная разработка). На production это будет работать.');
      } else {
        setError(err.message || 'Не удалось пересчитать статистику');
      }
    } finally {
      setRecalculating(false);
    }
  };

  const toggleDirection = (directionId: string) => {
    setExpandedDirections(prev => {
      const next = new Set(prev);
      if (next.has(directionId)) {
        next.delete(directionId);
      } else {
        next.add(directionId);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-3 text-sm text-muted-foreground">Загрузка направлений...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Настройка ключевых этапов воронки
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Выберите ключевой этап для каждого направления
          </p>
        </div>
      </div>

      {/* Info alert */}
      <Alert className="bg-blue-50 border-blue-200">
        <Info className="h-4 w-4 text-blue-600" />
        <AlertDescription className="text-sm text-blue-900">
          <strong>Ключевой этап</strong> - это этап воронки, достижение которого означает квалификацию лида.
          Например: "Оплата получена", "Консультация проведена" или "Договор подписан".
          <br />
          <strong>Процент квалов</strong> будет рассчитываться на основе этого этапа.
        </AlertDescription>
      </Alert>

      {/* Error */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Success */}
      {successMessage && (
        <Alert className="bg-green-50 border-green-200">
          <AlertDescription className="text-green-900">{successMessage}</AlertDescription>
        </Alert>
      )}

      {/* Directions list */}
      {directions.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">
              У вас пока нет направлений. Создайте направление в разделе Directions.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {directions.map((direction) => {
            const isExpanded = expandedDirections.has(direction.id);

            return (
              <Card key={direction.id} className="border-2">
                <CardHeader className="pb-3">
                  <div
                    className="flex items-center justify-between cursor-pointer"
                    onClick={() => toggleDirection(direction.id)}
                  >
                    <CardTitle className="text-base font-medium flex items-center gap-2">
                      {direction.name}
                      {direction.key_stage_pipeline_id && direction.key_stage_status_id && (
                        <span className="text-xs text-green-600 font-normal">✓ Настроено</span>
                      )}
                    </CardTitle>
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </CardHeader>

                {isExpanded && (
                  <CardContent className="pt-0">
                    <KeyStageSelector
                      directionId={direction.id}
                      directionName={direction.name}
                      userAccountId={userAccountId}
                      direction={direction}
                      onSave={() => {
                        // Reload directions to get updated data
                        loadDirections();
                      }}
                    />
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        <Button
          onClick={handleRecalculate}
          disabled={recalculating || directions.length === 0}
          variant="outline"
          className="flex-1"
        >
          {recalculating ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2" />
              Пересчёт...
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4 mr-2" />
              Пересчитать статистику
            </>
          )}
        </Button>

        {onClose && (
          <Button onClick={onClose} variant="secondary">
            Закрыть
          </Button>
        )}
      </div>
    </div>
  );
};
