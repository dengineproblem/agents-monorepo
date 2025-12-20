import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Settings, ChevronDown, ChevronUp, Info } from 'lucide-react';
import { Bitrix24KeyStageSelector } from './Bitrix24KeyStageSelector';
import { syncBitrix24Leads } from '@/services/bitrix24Api';
import { salesApi, type Direction } from '@/services/salesApi';

interface Bitrix24KeyStageSettingsProps {
  userAccountId: string;
  entityType: 'lead' | 'deal' | 'both';
  onClose?: () => void;
}

export const Bitrix24KeyStageSettings: React.FC<Bitrix24KeyStageSettingsProps> = ({
  userAccountId,
  entityType,
  onClose,
}) => {
  const [directions, setDirections] = useState<Direction[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedDirections, setExpandedDirections] = useState<Set<string>>(new Set());
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [activeEntityType, setActiveEntityType] = useState<'lead' | 'deal'>(
    entityType === 'deal' ? 'deal' : 'lead'
  );

  useEffect(() => {
    loadDirections();
  }, [userAccountId]);

  const loadDirections = async () => {
    try {
      setLoading(true);
      setError(null);
      const { data, error: dirError } = await salesApi.getDirections(userAccountId);

      if (dirError) {
        throw new Error(dirError);
      }

      setDirections(data);
      setExpandedDirections(new Set(data.map(d => d.id)));
    } catch (err: any) {
      console.error('[Bitrix24KeyStageSettings] Failed to load directions:', err);
      setError(err.message || 'Не удалось загрузить направления');
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    try {
      setSyncing(true);
      setError(null);
      setSuccessMessage(null);

      const result = await syncBitrix24Leads(userAccountId, entityType === 'both' ? undefined : entityType);

      setSuccessMessage(
        `Синхронизация завершена! Обновлено: ${result.updated}, ошибок: ${result.errors}`
      );

      setTimeout(() => {
        setSuccessMessage(null);
      }, 5000);
    } catch (err: any) {
      console.error('[Bitrix24KeyStageSettings] Failed to sync:', err);
      if (err.message?.includes('Failed to fetch')) {
        setError('Bitrix24 недоступен (локальная разработка). На production это будет работать.');
      } else {
        setError(err.message || 'Не удалось синхронизировать данные');
      }
    } finally {
      setSyncing(false);
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
            Настройка ключевых этапов (Bitrix24)
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Выберите ключевой этап для каждого направления
          </p>
        </div>
      </div>

      {/* Entity type selector for 'both' mode */}
      {entityType === 'both' && (
        <div className="flex gap-2">
          <Button
            variant={activeEntityType === 'lead' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveEntityType('lead')}
          >
            Лиды
          </Button>
          <Button
            variant={activeEntityType === 'deal' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveEntityType('deal')}
          >
            Сделки
          </Button>
        </div>
      )}

      {/* Info alert */}
      <Alert className="bg-blue-50 border-blue-200">
        <Info className="h-4 w-4 text-blue-600" />
        <AlertDescription className="text-sm text-blue-900">
          <strong>Ключевой этап</strong> - это этап воронки Bitrix24, достижение которого означает квалификацию.
          Например: "Качественный лид", "Оплачено" или "Договор подписан".
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
              У вас пока нет направлений. Создайте направление в разделе Направления.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {directions.map((direction) => {
            const isExpanded = expandedDirections.has(direction.id);
            const hasConfig = direction.bitrix24_key_stage_1_status_id;

            return (
              <Card key={direction.id} className="border-2">
                <CardHeader className="pb-3">
                  <div
                    className="flex items-center justify-between cursor-pointer"
                    onClick={() => toggleDirection(direction.id)}
                  >
                    <CardTitle className="text-base font-medium flex items-center gap-2">
                      {direction.name}
                      {hasConfig && (
                        <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">
                          Настроено
                        </Badge>
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
                    <Bitrix24KeyStageSelector
                      directionId={direction.id}
                      directionName={direction.name}
                      userAccountId={userAccountId}
                      entityType={entityType === 'both' ? activeEntityType : entityType}
                      direction={direction}
                      onSave={() => {
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
          onClick={handleSync}
          disabled={syncing || directions.length === 0}
          variant="outline"
          className="flex-1"
        >
          {syncing ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2" />
              Синхронизация...
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4 mr-2" />
              Синхронизировать с Bitrix24
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
