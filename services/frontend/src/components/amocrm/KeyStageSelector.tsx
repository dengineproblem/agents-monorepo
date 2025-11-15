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
import { Check, X, Target } from 'lucide-react';
import { getPipelines, setDirectionKeyStage, type Pipeline } from '@/services/amocrmApi';

interface KeyStageSelectorProps {
  directionId: string;
  directionName: string;
  userAccountId: string;
  currentPipelineId?: number | null;
  currentStatusId?: number | null;
  onSave?: () => void;
}

export const KeyStageSelector: React.FC<KeyStageSelectorProps> = ({
  directionId,
  directionName,
  userAccountId,
  currentPipelineId,
  currentStatusId,
  onSave,
}) => {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<number | undefined>(
    currentPipelineId ?? undefined
  );
  const [selectedStatusId, setSelectedStatusId] = useState<number | undefined>(
    currentStatusId ?? undefined
  );
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
      setPipelines(data);
    } catch (err: any) {
      console.error('Failed to load pipelines:', err);
      setError(err.message || 'Не удалось загрузить воронки');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!selectedPipelineId || !selectedStatusId) {
      setError('Выберите воронку и этап');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setSuccessMessage(null);

      await setDirectionKeyStage(directionId, selectedPipelineId, selectedStatusId);

      setSuccessMessage('Ключевой этап сохранен');

      // Call parent callback
      if (onSave) {
        onSave();
      }

      // Clear success message after 3 seconds
      setTimeout(() => {
        setSuccessMessage(null);
      }, 3000);

    } catch (err: any) {
      console.error('Failed to save key stage:', err);
      setError(err.message || 'Не удалось сохранить ключевой этап');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setSelectedPipelineId(currentPipelineId ?? undefined);
    setSelectedStatusId(currentStatusId ?? undefined);
    setError(null);
    setSuccessMessage(null);
  };

  // Get selected pipeline
  const selectedPipeline = pipelines.find(p => p.pipeline_id === selectedPipelineId);

  // Get selected stage name
  const selectedStage = selectedPipeline?.stages.find(s => s.status_id === selectedStatusId);

  // Check if values changed
  const hasChanges =
    selectedPipelineId !== currentPipelineId || selectedStatusId !== currentStatusId;

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
      {/* Direction name */}
      <div className="flex items-center gap-2">
        <Target className="h-4 w-4 text-blue-600" />
        <h4 className="text-sm font-medium">{directionName}</h4>
        {currentPipelineId && currentStatusId && !hasChanges && (
          <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">
            <Check className="h-3 w-3 mr-1" />
            Настроено
          </Badge>
        )}
      </div>

      {/* Pipeline selector */}
      <div className="space-y-2">
        <label className="text-xs text-muted-foreground">Воронка</label>
        <Select
          value={selectedPipelineId?.toString()}
          onValueChange={(value) => {
            setSelectedPipelineId(parseInt(value));
            setSelectedStatusId(undefined); // Reset stage when pipeline changes
            setError(null);
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Выберите воронку" />
          </SelectTrigger>
          <SelectContent>
            {pipelines.map((pipeline) => (
              <SelectItem key={pipeline.pipeline_id} value={pipeline.pipeline_id.toString()}>
                {pipeline.pipeline_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Stage selector */}
      {selectedPipelineId && selectedPipeline && (
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Ключевой этап квалификации</label>
          <Select
            value={selectedStatusId?.toString()}
            onValueChange={(value) => {
              setSelectedStatusId(parseInt(value));
              setError(null);
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Выберите этап" />
            </SelectTrigger>
            <SelectContent>
              {selectedPipeline.stages
                .sort((a, b) => a.sort_order - b.sort_order)
                .map((stage) => (
                  <SelectItem key={stage.status_id} value={stage.status_id.toString()}>
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: stage.status_color || '#ccc' }}
                      />
                      <span>{stage.status_name}</span>
                    </div>
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Current selection summary */}
      {selectedPipeline && selectedStage && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="text-xs text-blue-900 space-y-1">
            <p className="font-medium">Выбранный ключевой этап:</p>
            <p>
              <span className="text-blue-600">{selectedPipeline.pipeline_name}</span>
              {' → '}
              <span className="font-semibold text-blue-800">{selectedStage.status_name}</span>
            </p>
            <p className="text-blue-700 mt-2">
              Лиды, достигшие этого этапа, будут считаться квалифицированными.
            </p>
          </div>
        </div>
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
      {hasChanges && (
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || !selectedPipelineId || !selectedStatusId}
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
