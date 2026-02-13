import React from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CheckCircle2 } from 'lucide-react';

export interface CrmStageOption {
  key: string;
  label: string;
  entityType: 'lead' | 'deal';
  pipelineId: string | number;
  statusId: string | number;
}

export interface SelectedCapiStage {
  stageKey: string | null;
}

const MAX_CAPI_FIELDS = 5;

interface CrmStageSelectorProps {
  stages: CrmStageOption[];
  selectedStages: SelectedCapiStage[];
  setSelectedStages: React.Dispatch<React.SetStateAction<SelectedCapiStage[]>>;
  isSubmitting: boolean;
}

const CrmStageSelector: React.FC<CrmStageSelectorProps> = ({
  stages,
  selectedStages,
  setSelectedStages,
  isSubmitting,
}) => {
  const handleStageChange = (index: number, value: string) => {
    const stageKey = value === 'none' ? null : value;
    setSelectedStages((prev) => {
      const updated = [...prev];
      updated[index] = { stageKey };
      return updated;
    });
  };

  const addStage = () => {
    if (selectedStages.length < MAX_CAPI_FIELDS) {
      setSelectedStages((prev) => [...prev, { stageKey: null }]);
    }
  };

  const removeStage = (index: number) => {
    if (selectedStages.length > 1) {
      setSelectedStages((prev) => prev.filter((_, i) => i !== index));
    } else {
      setSelectedStages([{ stageKey: null }]);
    }
  };

  const getSelectedStageKeys = (excludeIndex: number) => {
    return selectedStages
      .filter((_, i) => i !== excludeIndex)
      .map((item) => item.stageKey)
      .filter((value): value is string => !!value);
  };

  const activeStagesCount = selectedStages.filter((item) => item.stageKey !== null).length;

  return (
    <div className="space-y-2">
      {selectedStages.map((item, index) => {
        const selectedStageKeys = getSelectedStageKeys(index);

        return (
          <div key={index} className="flex items-start gap-2">
            <div className="flex-1">
              <Select
                value={item.stageKey || 'none'}
                onValueChange={(value) => handleStageChange(index, value)}
                disabled={isSubmitting || stages.length === 0}
              >
                <SelectTrigger className="w-full bg-white dark:bg-gray-900 h-8 text-sm">
                  <SelectValue placeholder="Выберите этап воронки" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    <span className="text-muted-foreground">Не выбрано</span>
                  </SelectItem>
                  {stages.map((stage) => (
                    <SelectItem
                      key={stage.key}
                      value={stage.key}
                      disabled={selectedStageKeys.includes(stage.key)}
                    >
                      {stage.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedStages.length > 1 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeStage(index)}
                className="h-8 w-8 p-0 text-red-500 hover:text-red-700 flex-shrink-0"
                disabled={isSubmitting}
              >
                <span className="text-lg">&times;</span>
              </Button>
            )}
          </div>
        );
      })}

      {selectedStages.length < MAX_CAPI_FIELDS && stages.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          onClick={addStage}
          disabled={isSubmitting}
          className="w-full h-8 text-xs"
        >
          + Добавить этап ({selectedStages.length}/{MAX_CAPI_FIELDS})
        </Button>
      )}

      {activeStagesCount > 0 && (
        <p className="text-xs text-green-600 flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" />
          {activeStagesCount === 1 ? 'Выбран 1 этап' : `Выбрано ${activeStagesCount} этапа`}
        </p>
      )}
    </div>
  );
};

export default CrmStageSelector;
