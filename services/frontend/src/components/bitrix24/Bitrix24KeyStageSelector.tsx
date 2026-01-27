import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Check, X, Target, Plus, Trash2 } from 'lucide-react';
import {
  getBitrix24Pipelines,
  updateBitrix24Stage,
  saveBitrix24DirectionKeyStages,
  type Bitrix24Pipeline,
  type Bitrix24Stage,
} from '@/services/bitrix24Api';

interface Bitrix24KeyStageSelectorProps {
  directionId: string;
  directionName: string;
  userAccountId: string;
  entityType: 'lead' | 'deal';
  direction: any;
  onSave?: () => void;
}

interface KeyStageData {
  categoryId: number | undefined;
  statusId: string | undefined;
}

export const Bitrix24KeyStageSelector: React.FC<Bitrix24KeyStageSelectorProps> = ({
  directionId,
  directionName,
  userAccountId,
  entityType,
  direction,
  onSave,
}) => {
  const [pipelines, setPipelines] = useState<Bitrix24Pipeline[]>([]);
  const [keyStages, setKeyStages] = useState<KeyStageData[]>([{ categoryId: undefined, statusId: undefined }]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Initialize key stages from direction
  const getInitialKeyStages = (): KeyStageData[] => {
    const stages: KeyStageData[] = [];

    if (!direction) {
      return [{ categoryId: undefined, statusId: undefined }];
    }

    // Add stage 1 if configured (using bitrix24 fields)
    if (direction.bitrix24_key_stage_1_category_id && direction.bitrix24_key_stage_1_status_id) {
      stages.push({
        categoryId: direction.bitrix24_key_stage_1_category_id,
        statusId: direction.bitrix24_key_stage_1_status_id,
      });
    }

    // Add stage 2 if configured
    if (direction.bitrix24_key_stage_2_category_id && direction.bitrix24_key_stage_2_status_id) {
      stages.push({
        categoryId: direction.bitrix24_key_stage_2_category_id,
        statusId: direction.bitrix24_key_stage_2_status_id,
      });
    }

    // Add stage 3 if configured
    if (direction.bitrix24_key_stage_3_category_id && direction.bitrix24_key_stage_3_status_id) {
      stages.push({
        categoryId: direction.bitrix24_key_stage_3_category_id,
        statusId: direction.bitrix24_key_stage_3_status_id,
      });
    }

    if (stages.length === 0) {
      stages.push({ categoryId: undefined, statusId: undefined });
    }

    return stages;
  };

  useEffect(() => {
    loadPipelines();
  }, [userAccountId, entityType]);

  useEffect(() => {
    setKeyStages(getInitialKeyStages());
  }, [direction]);

  const loadPipelines = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getBitrix24Pipelines(userAccountId);

      // Get pipelines based on entity type
      const pipelinesData = entityType === 'lead' ? data.leads : data.deals;

      if (Array.isArray(pipelinesData)) {
        setPipelines(pipelinesData);
      } else {
        console.error('[Bitrix24KeyStageSelector] Pipelines data is not an array:', pipelinesData);
        setError('Некорректный формат данных воронок');
        setPipelines([]);
      }
    } catch (err: any) {
      console.error('[Bitrix24KeyStageSelector] Failed to load pipelines:', err);
      if (err.message?.includes('Failed to fetch') || err.message?.includes('битрикс')) {
        setError('Bitrix24 недоступен. На production это будет работать.');
      } else {
        setError(err.message || 'Не удалось загрузить воронки');
      }
      setPipelines([]);
    } finally {
      setLoading(false);
    }
  };

  const updateKeyStage = (index: number, field: 'categoryId' | 'statusId', value: number | string | undefined) => {
    const newStages = [...keyStages];
    newStages[index] = { ...newStages[index], [field]: value };

    // Reset statusId when category changes
    if (field === 'categoryId') {
      newStages[index].statusId = undefined;
    }

    setKeyStages(newStages);
    setError(null);
  };

  const addKeyStage = () => {
    if (keyStages.length >= 3) {
      setError('Максимум 3 ключевых этапа');
      return;
    }
    setKeyStages([...keyStages, { categoryId: undefined, statusId: undefined }]);
  };

  const removeKeyStage = (index: number) => {
    const newStages = keyStages.filter((_, i) => i !== index);
    if (newStages.length === 0) {
      newStages.push({ categoryId: undefined, statusId: undefined });
    }
    setKeyStages(newStages);
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccessMessage(null);

      // Filter out incomplete stages and format for API
      const validStages = keyStages
        .filter(stage => stage.categoryId !== undefined && stage.statusId)
        .map(stage => ({
          categoryId: stage.categoryId!,
          statusId: stage.statusId!,
        }));

      // Save key stages to direction via API
      const result = await saveBitrix24DirectionKeyStages(
        directionId,
        userAccountId,
        entityType,
        validStages
      );

      setSuccessMessage(result.message || `Сохранено ${validStages.length} ключевых этапов`);

      if (onSave) {
        onSave();
      }

      setTimeout(() => {
        setSuccessMessage(null);
      }, 3000);

    } catch (err: any) {
      console.error('Failed to save key stages:', err);
      setError(err.message || 'Не удалось сохранить ключевые этапы');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setKeyStages(getInitialKeyStages());
    setError(null);
    setSuccessMessage(null);
  };

  const hasChanges = (): boolean => {
    const initial = getInitialKeyStages();
    if (initial.length !== keyStages.length) return true;

    return keyStages.some((stage, i) => {
      const initStage = initial[i];
      if (!initStage) return true;
      return stage.categoryId !== initStage.categoryId || stage.statusId !== initStage.statusId;
    });
  };

  const getConfiguredCount = (): number => {
    return keyStages.filter(stage => stage.categoryId !== undefined && stage.statusId).length;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
        <span className="ml-2 text-sm text-muted-foreground">Загрузка воронок Bitrix24...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Direction header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-blue-600" />
          <h4 className="text-sm font-medium">{directionName}</h4>
          {getConfiguredCount() > 0 && !hasChanges() && (
            <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">
              <Check className="h-3 w-3 mr-1" />
              {getConfiguredCount()} этапов
            </Badge>
          )}
        </div>
        <Badge variant="secondary" className="text-xs">
          {entityType === 'lead' ? 'Лиды' : 'Сделки'}
        </Badge>
      </div>

      {/* Key stages list */}
      <div className="space-y-3">
        {keyStages.map((stage, index) => {
          const selectedPipeline = pipelines.find(p => p.categoryId === stage.categoryId);
          const selectedStage = selectedPipeline?.stages?.find(s => s.statusId === stage.statusId);

          return (
            <div key={index} className="border rounded-lg p-3 space-y-3">
              {/* Stage header */}
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  Ключевой этап {index + 1}
                </span>
                {keyStages.length > 1 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => removeKeyStage(index)}
                    className="h-6 w-6 p-0"
                  >
                    <Trash2 className="h-3 w-3 text-red-600" />
                  </Button>
                )}
              </div>

              {/* Pipeline/Category selector */}
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">
                  {entityType === 'lead' ? 'Направление' : 'Воронка'}
                </label>
                <Select
                  value={stage.categoryId?.toString()}
                  onValueChange={(value) => updateKeyStage(index, 'categoryId', parseInt(value))}
                  disabled={pipelines.length === 0}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={pipelines.length === 0 ? "Нет воронок" : "Выберите воронку"} />
                  </SelectTrigger>
                  <SelectContent>
                    {pipelines.map((pipeline) => (
                      <SelectItem key={pipeline.categoryId} value={pipeline.categoryId.toString()}>
                        {pipeline.categoryName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Stage selector */}
              {stage.categoryId !== undefined && selectedPipeline && (
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Этап квалификации</label>
                  <Select
                    value={stage.statusId}
                    onValueChange={(value) => updateKeyStage(index, 'statusId', value)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Выберите этап" />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedPipeline.stages
                        .sort((a, b) => a.statusSort - b.statusSort)
                        .map((s) => (
                          <SelectItem key={s.statusId} value={s.statusId}>
                            <div className="flex items-center gap-2">
                              {s.statusColor && (
                                <div
                                  className="w-3 h-3 rounded-full"
                                  style={{ backgroundColor: s.statusColor }}
                                />
                              )}
                              <span>{s.statusName}</span>
                              {s.isSuccessStage && (
                                <Badge variant="outline" className="text-xs text-green-600 border-green-300">
                                  Успех
                                </Badge>
                              )}
                              {s.isFailStage && (
                                <Badge variant="outline" className="text-xs text-red-600 border-red-300">
                                  Провал
                                </Badge>
                              )}
                            </div>
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Selected stage summary */}
              {selectedPipeline && selectedStage && (
                <div className="bg-blue-50 border border-blue-200 rounded p-2">
                  <div className="text-xs text-blue-800">
                    <span className="font-medium">{selectedPipeline.categoryName}</span>
                    {' → '}
                    <span className="font-semibold">{selectedStage.statusName}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add stage button */}
      {keyStages.length < 3 && (
        <Button
          size="sm"
          variant="outline"
          onClick={addKeyStage}
          className="w-full"
        >
          <Plus className="h-3 w-3 mr-2" />
          Добавить ключевой этап ({keyStages.length}/3)
        </Button>
      )}

      {/* Error message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
          <X className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-800">{error}</p>
        </div>
      )}

      {/* Success message */}
      {successMessage && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-start gap-2">
          <Check className="h-4 w-4 text-green-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-green-800">{successMessage}</p>
        </div>
      )}

      {/* Action buttons */}
      {hasChanges() && (
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving}
            className="flex-1"
          >
            {saving ? (
              <>
                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-2" />
                Сохранение...
              </>
            ) : (
              <>
                <Check className="h-3 w-3 mr-2" />
                Сохранить
              </>
            )}
          </Button>
          <Button size="sm" variant="outline" onClick={handleReset} disabled={saving}>
            <X className="h-3 w-3 mr-2" />
            Отмена
          </Button>
        </div>
      )}
    </div>
  );
};
