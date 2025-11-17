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
import { getPipelines, setDirectionKeyStages, type Pipeline } from '@/services/amocrmApi';
import { Direction } from '@/types/direction';

interface KeyStageSelectorProps {
  directionId: string;
  directionName: string;
  userAccountId: string;
  direction: Direction; // Full direction object with all key stages
  onSave?: () => void;
}

interface KeyStageData {
  pipelineId: number | undefined;
  statusId: number | undefined;
}

export const KeyStageSelector: React.FC<KeyStageSelectorProps> = ({
  directionId,
  directionName,
  userAccountId,
  direction,
  onSave,
}) => {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);

  // Initialize key stages from direction (filter out empty stages)
  const getInitialKeyStages = (): KeyStageData[] => {
    const stages: KeyStageData[] = [];

    // Add stage 1 if configured
    if (direction.key_stage_1_pipeline_id && direction.key_stage_1_status_id) {
      stages.push({
        pipelineId: direction.key_stage_1_pipeline_id,
        statusId: direction.key_stage_1_status_id,
      });
    }

    // Add stage 2 if configured
    if (direction.key_stage_2_pipeline_id && direction.key_stage_2_status_id) {
      stages.push({
        pipelineId: direction.key_stage_2_pipeline_id,
        statusId: direction.key_stage_2_status_id,
      });
    }

    // Add stage 3 if configured
    if (direction.key_stage_3_pipeline_id && direction.key_stage_3_status_id) {
      stages.push({
        pipelineId: direction.key_stage_3_pipeline_id,
        statusId: direction.key_stage_3_status_id,
      });
    }

    // If no stages configured, start with one empty stage
    if (stages.length === 0) {
      stages.push({ pipelineId: undefined, statusId: undefined });
    }

    return stages;
  };

  const [keyStages, setKeyStages] = useState<KeyStageData[]>(getInitialKeyStages());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Load pipelines on mount
  useEffect(() => {
    loadPipelines();
  }, [userAccountId]);

  const loadPipelines = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getPipelines(userAccountId);

      // Ensure data is an array
      if (Array.isArray(data)) {
        setPipelines(data);
      } else {
        console.error('[KeyStageSelector] Pipelines data is not an array:', data);
        setError('Некорректный формат данных воронок');
        setPipelines([]);
      }
    } catch (err: any) {
      console.error('[KeyStageSelector] Failed to load pipelines:', err);
      setError(err.message || 'Не удалось загрузить воронки');
      setPipelines([]);
    } finally {
      setLoading(false);
    }
  };

  const updateKeyStage = (index: number, field: 'pipelineId' | 'statusId', value: number | undefined) => {
    const newStages = [...keyStages];
    newStages[index] = { ...newStages[index], [field]: value };

    // Reset statusId when pipeline changes
    if (field === 'pipelineId') {
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
    setKeyStages([...keyStages, { pipelineId: undefined, statusId: undefined }]);
  };

  const removeKeyStage = (index: number) => {
    const newStages = keyStages.filter((_, i) => i !== index);
    // Keep at least one stage
    if (newStages.length === 0) {
      newStages.push({ pipelineId: undefined, statusId: undefined });
    }
    setKeyStages(newStages);
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccessMessage(null);

      // Filter out incomplete stages and map to API format
      const validStages = keyStages
        .filter(stage => stage.pipelineId && stage.statusId)
        .map(stage => ({
          pipelineId: stage.pipelineId!,
          statusId: stage.statusId!,
        }));

      await setDirectionKeyStages(directionId, validStages);

      setSuccessMessage(`Сохранено ${validStages.length} ключевых этапов`);

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

  // Check if values changed
  const hasChanges = (): boolean => {
    const initial = getInitialKeyStages();
    if (initial.length !== keyStages.length) return true;

    return keyStages.some((stage, i) => {
      const initStage = initial[i];
      if (!initStage) return true;
      return stage.pipelineId !== initStage.pipelineId || stage.statusId !== initStage.statusId;
    });
  };

  const getConfiguredCount = (): number => {
    return keyStages.filter(stage => stage.pipelineId && stage.statusId).length;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
        <span className="ml-2 text-sm text-muted-foreground">Загрузка воронок...</span>
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
      </div>

      {/* Key stages list */}
      <div className="space-y-3">
        {keyStages.map((stage, index) => {
          const selectedPipeline = Array.isArray(pipelines)
            ? pipelines.find(p => p.pipeline_id === stage.pipelineId)
            : undefined;
          const selectedStage = selectedPipeline?.stages?.find(s => s.status_id === stage.statusId);

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

              {/* Pipeline selector */}
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Воронка</label>
                <Select
                  value={stage.pipelineId?.toString()}
                  onValueChange={(value) => updateKeyStage(index, 'pipelineId', parseInt(value))}
                  disabled={!Array.isArray(pipelines) || pipelines.length === 0}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={!Array.isArray(pipelines) || pipelines.length === 0 ? "Нет воронок" : "Выберите воронку"} />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.isArray(pipelines) && pipelines.map((pipeline) => (
                      <SelectItem key={pipeline.pipeline_id} value={pipeline.pipeline_id.toString()}>
                        {pipeline.pipeline_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Stage selector */}
              {stage.pipelineId && selectedPipeline && (
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Этап квалификации</label>
                  <Select
                    value={stage.statusId?.toString()}
                    onValueChange={(value) => updateKeyStage(index, 'statusId', parseInt(value))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Выберите этап" />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedPipeline.stages
                        .sort((a, b) => a.sort_order - b.sort_order)
                        .map((s) => (
                          <SelectItem key={s.status_id} value={s.status_id.toString()}>
                            <div className="flex items-center gap-2">
                              <div
                                className="w-3 h-3 rounded-full"
                                style={{ backgroundColor: s.status_color || '#ccc' }}
                              />
                              <span>{s.status_name}</span>
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
                    <span className="font-medium">{selectedPipeline.pipeline_name}</span>
                    {' → '}
                    <span className="font-semibold">{selectedStage.status_name}</span>
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
