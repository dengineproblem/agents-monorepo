import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { ChevronDown, Loader2 } from 'lucide-react';
import type {
  Direction,
  UpdateDefaultSettingsInput,
  CapiSource,
  CapiFieldConfig,
  CapiCrmType,
  OptimizationLevel
} from '@/types/direction';
import { OBJECTIVE_DESCRIPTIONS, TIKTOK_OBJECTIVE_DESCRIPTIONS } from '@/types/direction';
import { CITIES_AND_COUNTRIES, COUNTRY_IDS, DEFAULT_UTM } from '@/constants/cities';
import { defaultSettingsApi } from '@/services/defaultSettingsApi';
import { facebookApi } from '@/services/facebookApi';
import { toast } from 'sonner';
import { API_BASE_URL } from '@/config/api';
import {
  getLeadCustomFields as getAmocrmFields,
  getPipelines as getAmocrmPipelines,
  type CustomField as AmocrmCustomField,
  type Pipeline as AmocrmPipeline,
} from '@/services/amocrmApi';
import {
  getBitrix24Status,
  getBitrix24Pipelines,
  getBitrix24LeadCustomFields,
  type CustomField as Bitrix24CustomField,
  type Bitrix24Pipelines,
} from '@/services/bitrix24Api';

const TIKTOK_MIN_DAILY_BUDGET = 2500;
const MAX_CAPI_FIELDS = 3;

type CrmType = CapiCrmType;
type CapiTriggerMode = 'fields' | 'stages';

interface SelectedCapiField {
  fieldId: string | number | null;
  enumId: string | number | null;
}

interface SelectedCapiStage {
  stageKey: string | null;
}

interface CrmStageOption {
  key: string;
  label: string;
  entityType: 'lead' | 'deal';
  pipelineId: string | number;
  statusId: string | number;
}

interface CrmFieldSelectorProps {
  fields: (AmocrmCustomField | Bitrix24CustomField)[];
  selectedFields: SelectedCapiField[];
  setSelectedFields: React.Dispatch<React.SetStateAction<SelectedCapiField[]>>;
  crmType: CrmType;
  isSubmitting: boolean;
  getFieldById: (fieldId: string | number | null) => AmocrmCustomField | Bitrix24CustomField | undefined;
  getFieldId: (field: AmocrmCustomField | Bitrix24CustomField) => string | number;
  getFieldName: (field: AmocrmCustomField | Bitrix24CustomField) => string;
  getFieldType: (field: AmocrmCustomField | Bitrix24CustomField) => string;
  getFieldEnums: (field: AmocrmCustomField | Bitrix24CustomField) => Array<{ id: string | number; value: string }>;
  needsEnumSelection: (field: AmocrmCustomField | Bitrix24CustomField | null) => boolean;
}

const CrmFieldSelector: React.FC<CrmFieldSelectorProps> = ({
  fields,
  selectedFields,
  setSelectedFields,
  crmType,
  isSubmitting,
  getFieldById,
  getFieldId,
  getFieldName,
  getFieldType,
  getFieldEnums,
  needsEnumSelection,
}) => {
  const handleFieldChange = (index: number, value: string) => {
    const fieldId = value === 'none' ? null : (crmType === 'amocrm' ? parseInt(value, 10) : value);
    setSelectedFields(prev => {
      const updated = [...prev];
      updated[index] = { fieldId, enumId: null };
      return updated;
    });
  };

  const handleEnumChange = (index: number, value: string) => {
    const enumId = value === 'none' ? null : (crmType === 'amocrm' ? parseInt(value, 10) : value);
    setSelectedFields(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], enumId };
      return updated;
    });
  };

  const addField = () => {
    if (selectedFields.length < MAX_CAPI_FIELDS) {
      setSelectedFields(prev => [...prev, { fieldId: null, enumId: null }]);
    }
  };

  const removeField = (index: number) => {
    if (selectedFields.length > 1) {
      setSelectedFields(prev => prev.filter((_, i) => i !== index));
    } else {
      setSelectedFields([{ fieldId: null, enumId: null }]);
    }
  };

  const isCheckboxType = (field: AmocrmCustomField | Bitrix24CustomField | null): boolean => {
    if (!field) return false;
    const fieldType = getFieldType(field);
    return fieldType === 'checkbox' || fieldType === 'boolean';
  };

  const getSelectedCheckboxFieldIds = (excludeIndex: number) => {
    return selectedFields
      .filter((_, i) => i !== excludeIndex)
      .filter(sf => {
        if (!sf.fieldId) return false;
        const field = getFieldById(sf.fieldId);
        return field && isCheckboxType(field);
      })
      .map(sf => sf.fieldId)
      .filter(Boolean);
  };

  return (
    <div className="space-y-2">
      {selectedFields.map((sf, index) => {
        const selectedCheckboxIds = getSelectedCheckboxFieldIds(index);
        const currentField = sf.fieldId ? getFieldById(sf.fieldId) : null;

        return (
          <div key={index} className="flex items-start gap-2">
            <div className="flex-1 space-y-1">
              <Select
                value={sf.fieldId?.toString() || 'none'}
                onValueChange={(value) => handleFieldChange(index, value)}
                disabled={isSubmitting || fields.length === 0}
              >
                <SelectTrigger className="w-full bg-white dark:bg-gray-900 h-8 text-sm">
                  <SelectValue placeholder="Выберите поле" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    <span className="text-muted-foreground">Не выбрано</span>
                  </SelectItem>
                  {fields.map((field) => {
                    const fId = getFieldId(field);
                    const isDisabled = isCheckboxType(field) && selectedCheckboxIds.includes(fId);
                    return (
                      <SelectItem
                        key={fId}
                        value={fId.toString()}
                        disabled={isDisabled}
                      >
                        {getFieldName(field)} ({getFieldType(field)})
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>

              {currentField && needsEnumSelection(currentField) && (
                <Select
                  value={sf.enumId?.toString() || 'none'}
                  onValueChange={(value) => handleEnumChange(index, value)}
                  disabled={isSubmitting}
                >
                  <SelectTrigger className="w-full bg-white dark:bg-gray-900 h-8 text-sm">
                    <SelectValue placeholder="Выберите значение" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      <span className="text-muted-foreground">Не выбрано</span>
                    </SelectItem>
                    {getFieldEnums(currentField).map((enumItem) => (
                      <SelectItem key={enumItem.id} value={enumItem.id.toString()}>
                        {enumItem.value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {selectedFields.length > 1 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeField(index)}
                className="h-8 w-8 p-0 text-red-500 hover:text-red-700 flex-shrink-0"
                disabled={isSubmitting}
              >
                <span className="text-lg">&times;</span>
              </Button>
            )}
          </div>
        );
      })}

      {selectedFields.length < MAX_CAPI_FIELDS && fields.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          onClick={addField}
          disabled={isSubmitting}
          className="w-full h-8 text-xs"
        >
          + Добавить поле ({selectedFields.length}/{MAX_CAPI_FIELDS})
        </Button>
      )}
    </div>
  );
};

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
    setSelectedStages(prev => {
      const updated = [...prev];
      updated[index] = { stageKey };
      return updated;
    });
  };

  const addStage = () => {
    if (selectedStages.length < MAX_CAPI_FIELDS) {
      setSelectedStages(prev => [...prev, { stageKey: null }]);
    }
  };

  const removeStage = (index: number) => {
    if (selectedStages.length > 1) {
      setSelectedStages(prev => prev.filter((_, i) => i !== index));
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
    </div>
  );
};

// CAPI settings for update
export interface EditDirectionCapiSettings {
  capi_enabled: boolean;
  capi_source: CapiSource | null;
  capi_crm_type: CrmType | null;
  capi_interest_fields: CapiFieldConfig[];
  capi_qualified_fields: CapiFieldConfig[];
  capi_scheduled_fields: CapiFieldConfig[];
  pixel_id: string | null;
}

interface EditDirectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  direction: Direction | null;
  userAccountId: string;
  accountId?: string | null;
  onSubmit: (data: {
    name: string;
    daily_budget_cents?: number;
    target_cpl_cents?: number;
    tiktok_daily_budget?: number;
    tiktok_target_cpl_kzt?: number;
    is_active: boolean;
    whatsapp_phone_number?: string | null;
    optimization_level?: OptimizationLevel;
    capiSettings?: EditDirectionCapiSettings;
  }) => Promise<void>;
}

export const EditDirectionDialog: React.FC<EditDirectionDialogProps> = ({
  open,
  onOpenChange,
  direction,
  userAccountId,
  accountId,
  onSubmit,
}) => {
  // Ref для порталинга Popover внутрь Dialog
  const dialogContentRef = React.useRef<HTMLDivElement>(null);

  // Основная информация
  const [name, setName] = useState('');
  const [dailyBudget, setDailyBudget] = useState('');
  const [targetCpl, setTargetCpl] = useState('');
  const [tiktokDailyBudget, setTikTokDailyBudget] = useState('');
  const [tiktokTargetCpl, setTikTokTargetCpl] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [optimizationLevel, setOptimizationLevel] = useState<OptimizationLevel>('level_1');

  // Настройки рекламы
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [cityPopoverOpen, setCityPopoverOpen] = useState(false);
  const [ageMin, setAgeMin] = useState<number>(18);
  const [ageMax, setAgeMax] = useState<number>(65);
  const [gender, setGender] = useState<'all' | 'male' | 'female'>('all');
  const [description, setDescription] = useState('Напишите нам, чтобы узнать подробности');
  
  // Специфичные для целей
  const [whatsappPhoneNumber, setWhatsappPhoneNumber] = useState('');
  const [clientQuestion, setClientQuestion] = useState('Здравствуйте! Хочу узнать об этом подробнее.');
  const [instagramUrl, setInstagramUrl] = useState('');
  const [siteUrl, setSiteUrl] = useState('');
  const [pixelId, setPixelId] = useState('');
  const [pixels, setPixels] = useState<Array<{ id: string; name: string }>>([]);
  const [isLoadingPixels, setIsLoadingPixels] = useState(false);
  const [utmTag, setUtmTag] = useState(DEFAULT_UTM);

  const [isLoadingSettings, setIsLoadingSettings] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isTikTok = direction?.platform === 'tiktok';

  // CAPI settings
  const [capiEnabled, setCapiEnabled] = useState(false);
  const [capiSource, setCapiSource] = useState<CapiSource>('whatsapp');
  const [capiCrmType, setCapiCrmType] = useState<CrmType>('amocrm');
  const [capiInterestMode, setCapiInterestMode] = useState<CapiTriggerMode>('fields');
  const [capiQualifiedMode, setCapiQualifiedMode] = useState<CapiTriggerMode>('fields');
  const [capiScheduledMode, setCapiScheduledMode] = useState<CapiTriggerMode>('fields');
  const [capiInterestFields, setCapiInterestFields] = useState<SelectedCapiField[]>([{ fieldId: null, enumId: null }]);
  const [capiQualifiedFields, setCapiQualifiedFields] = useState<SelectedCapiField[]>([{ fieldId: null, enumId: null }]);
  const [capiScheduledFields, setCapiScheduledFields] = useState<SelectedCapiField[]>([{ fieldId: null, enumId: null }]);
  const [capiInterestStages, setCapiInterestStages] = useState<SelectedCapiStage[]>([{ stageKey: null }]);
  const [capiQualifiedStages, setCapiQualifiedStages] = useState<SelectedCapiStage[]>([{ stageKey: null }]);
  const [capiScheduledStages, setCapiScheduledStages] = useState<SelectedCapiStage[]>([{ stageKey: null }]);
  const [connectedCrms, setConnectedCrms] = useState<CrmType[]>([]);
  const [isLoadingCrms, setIsLoadingCrms] = useState(false);
  const [crmFields, setCrmFields] = useState<(AmocrmCustomField | Bitrix24CustomField)[]>([]);
  const [isLoadingCrmFields, setIsLoadingCrmFields] = useState(false);
  const [crmStages, setCrmStages] = useState<CrmStageOption[]>([]);
  const [isLoadingCrmStages, setIsLoadingCrmStages] = useState(false);
  const [capiPixelId, setCapiPixelId] = useState<string>('');

  const isStageFieldConfig = (config: CapiFieldConfig): boolean => {
    const fieldType = String(config.field_type || '').trim().toLowerCase();
    return fieldType === 'pipeline_stage' || fieldType === 'stage';
  };

  const buildStageKeyFromConfig = (config: CapiFieldConfig, crmType: CrmType): string | null => {
    const pipelineId = config.pipeline_id ?? null;
    const statusId = config.status_id ?? null;
    if (pipelineId === null || pipelineId === undefined || statusId === null || statusId === undefined) {
      return null;
    }

    if (crmType === 'amocrm') {
      return `amocrm:lead:${pipelineId}:${statusId}`;
    }

    const entityType = (config.entity_type === 'deal' ? 'deal' : 'lead');
    return `bitrix24:${entityType}:${pipelineId}:${statusId}`;
  };

  const parseLevelConfig = (
    configs: CapiFieldConfig[] | undefined,
    crmType: CrmType
  ): {
    mode: CapiTriggerMode;
    fields: SelectedCapiField[];
    stages: SelectedCapiStage[];
  } => {
    const safeConfigs = Array.isArray(configs) ? configs : [];
    const stageConfigs = safeConfigs.filter((config) => isStageFieldConfig(config));
    const fieldConfigs = safeConfigs.filter((config) => !isStageFieldConfig(config));

    const fields = fieldConfigs
      .map((config) => ({
        fieldId: config.field_id ?? null,
        enumId: config.enum_id ?? null,
      }))
      .filter((item) => item.fieldId !== null);

    const stages = stageConfigs
      .map((config) => buildStageKeyFromConfig(config, crmType))
      .filter((value): value is string => !!value)
      .map((stageKey) => ({ stageKey }));

    const mode: CapiTriggerMode = stageConfigs.length > 0 && fieldConfigs.length === 0 ? 'stages' : 'fields';

    return {
      mode,
      fields: fields.length > 0 ? fields : [{ fieldId: null, enumId: null }],
      stages: stages.length > 0 ? stages : [{ stageKey: null }],
    };
  };

  // Загрузка пикселей - для site_leads или для CAPI
  useEffect(() => {
    const loadPixels = async () => {
      // Загружаем пиксели если site_leads ИЛИ если CAPI включен для других целей
      const needPixels = direction?.objective === 'site_leads' ||
        (direction?.objective !== 'site_leads' && capiEnabled);

      if (!direction || isTikTok || !needPixels) {
        if (direction?.objective !== 'site_leads') {
          // Не сбрасываем пиксели для site_leads
          setPixels([]);
        }
        return;
      }
      setIsLoadingPixels(true);
      try {
        const list = await facebookApi.getPixels();
        console.log('Загружены пиксели (Edit):', list);
        setPixels(Array.isArray(list) ? list : []);
      } catch (e) {
        console.error('Ошибка загрузки пикселей:', e);
        setPixels([]);
      } finally {
        setIsLoadingPixels(false);
      }
    };
    loadPixels();
  }, [direction?.objective, capiEnabled, isTikTok]);

  // Load connected CRMs for CRM-based CAPI source
  useEffect(() => {
    if (!open || isTikTok || !userAccountId) {
      setConnectedCrms([]);
      return;
    }

    const loadConnectedCrms = async () => {
      setIsLoadingCrms(true);
      const crms: CrmType[] = [];

      try {
        const params = new URLSearchParams({ userAccountId });
        if (accountId) {
          params.append('accountId', accountId);
        }
        const amocrmResponse = await fetch(`${API_BASE_URL}/amocrm/pipelines?${params.toString()}`);
        if (amocrmResponse.ok) {
          crms.push('amocrm');
        }
      } catch {
        // ignore
      }

      try {
        const bitrixStatus = await getBitrix24Status(userAccountId, accountId || null);
        if (bitrixStatus.connected) {
          crms.push('bitrix24');
        }
      } catch {
        // ignore
      }

      setConnectedCrms(crms);
      setCapiCrmType((prev) => {
        if (crms.length === 0) return prev;
        if (crms.includes(prev)) return prev;
        return crms[0];
      });
      setIsLoadingCrms(false);
    };

    loadConnectedCrms();
  }, [open, isTikTok, userAccountId, accountId]);

  // Load CRM fields for field-based triggers
  useEffect(() => {
    const loadCrmFields = async () => {
      if (isTikTok || !open || !capiEnabled || capiSource !== 'crm') {
        setCrmFields([]);
        return;
      }

      setIsLoadingCrmFields(true);
      try {
        if (capiCrmType === 'amocrm') {
          const response = await getAmocrmFields(userAccountId);
          setCrmFields(response.fields || []);
        } else if (capiCrmType === 'bitrix24') {
          const response = await getBitrix24LeadCustomFields(userAccountId);
          setCrmFields(response.fields || []);
        } else {
          setCrmFields([]);
        }
      } catch (err) {
        console.error('Failed to load CRM fields:', err);
        setCrmFields([]);
      } finally {
        setIsLoadingCrmFields(false);
      }
    };

    loadCrmFields();
  }, [open, isTikTok, capiEnabled, capiSource, capiCrmType, userAccountId]);

  // Load CRM pipeline stages for stage-based triggers
  useEffect(() => {
    const loadCrmStages = async () => {
      if (isTikTok || !open || !capiEnabled || capiSource !== 'crm') {
        setCrmStages([]);
        return;
      }

      setIsLoadingCrmStages(true);
      try {
        if (capiCrmType === 'amocrm') {
          const pipelines = await getAmocrmPipelines(userAccountId, accountId || undefined) as AmocrmPipeline[];
          const stageOptions: CrmStageOption[] = [];

          for (const pipeline of pipelines || []) {
            for (const stage of pipeline.stages || []) {
              stageOptions.push({
                key: `amocrm:lead:${pipeline.pipeline_id}:${stage.status_id}`,
                label: `${pipeline.pipeline_name} → ${stage.status_name}`,
                entityType: 'lead',
                pipelineId: pipeline.pipeline_id,
                statusId: stage.status_id,
              });
            }
          }

          setCrmStages(stageOptions);
        } else if (capiCrmType === 'bitrix24') {
          const pipelines = await getBitrix24Pipelines(userAccountId, accountId || undefined) as Bitrix24Pipelines;
          const stageOptions: CrmStageOption[] = [];

          for (const leadPipeline of pipelines.leads || []) {
            for (const stage of leadPipeline.stages || []) {
              stageOptions.push({
                key: `bitrix24:lead:${leadPipeline.categoryId}:${stage.statusId}`,
                label: `Лиды / ${leadPipeline.categoryName} → ${stage.statusName}`,
                entityType: 'lead',
                pipelineId: leadPipeline.categoryId,
                statusId: stage.statusId,
              });
            }
          }

          for (const dealPipeline of pipelines.deals || []) {
            for (const stage of dealPipeline.stages || []) {
              stageOptions.push({
                key: `bitrix24:deal:${dealPipeline.categoryId}:${stage.statusId}`,
                label: `Сделки / ${dealPipeline.categoryName} → ${stage.statusName}`,
                entityType: 'deal',
                pipelineId: dealPipeline.categoryId,
                statusId: stage.statusId,
              });
            }
          }

          setCrmStages(stageOptions);
        } else {
          setCrmStages([]);
        }
      } catch (err) {
        console.error('Failed to load CRM stages:', err);
        setCrmStages([]);
      } finally {
        setIsLoadingCrmStages(false);
      }
    };

    loadCrmStages();
  }, [open, isTikTok, capiEnabled, capiSource, capiCrmType, userAccountId, accountId]);

  // Заполнение формы при открытии диалога
  useEffect(() => {
    if (!direction || !open) return;

    // Основная информация
    setName(direction.name);
    setIsActive(direction.is_active);
    setOptimizationLevel(direction.optimization_level || 'level_1');
    setWhatsappPhoneNumber(direction.whatsapp_phone_number || '');
    setError(null);

    // CAPI settings
    setCapiEnabled(!isTikTok && (direction.capi_enabled || false));
    setCapiSource(!isTikTok ? (direction.capi_source || 'whatsapp') : 'whatsapp');
    const initialCrmType: CrmType = direction.capi_crm_type || 'amocrm';
    setCapiCrmType(initialCrmType);

    const interestParsed = parseLevelConfig(direction.capi_interest_fields, initialCrmType);
    const qualifiedParsed = parseLevelConfig(direction.capi_qualified_fields, initialCrmType);
    const scheduledParsed = parseLevelConfig(direction.capi_scheduled_fields, initialCrmType);

    setCapiInterestMode(interestParsed.mode);
    setCapiQualifiedMode(qualifiedParsed.mode);
    setCapiScheduledMode(scheduledParsed.mode);
    setCapiInterestFields(interestParsed.fields);
    setCapiQualifiedFields(qualifiedParsed.fields);
    setCapiScheduledFields(scheduledParsed.fields);
    setCapiInterestStages(interestParsed.stages);
    setCapiQualifiedStages(qualifiedParsed.stages);
    setCapiScheduledStages(scheduledParsed.stages);

    if (isTikTok) {
      setTikTokDailyBudget(
        direction.tiktok_daily_budget ? String(direction.tiktok_daily_budget) : String(TIKTOK_MIN_DAILY_BUDGET)
      );
      setTikTokTargetCpl(
        direction.tiktok_target_cpl_kzt != null
          ? String(direction.tiktok_target_cpl_kzt)
          : direction.tiktok_target_cpl != null
            ? String(direction.tiktok_target_cpl)
            : ''
      );
      setDailyBudget('');
      setTargetCpl('');
    } else {
      setDailyBudget((direction.daily_budget_cents / 100).toFixed(2));
      setTargetCpl((direction.target_cpl_cents / 100).toFixed(2));
      setTikTokDailyBudget('');
      setTikTokTargetCpl('');
    }

    // Загружаем настройки рекламы
    loadAdSettings(direction.id);
  }, [direction, open, isTikTok]);

  const loadAdSettings = async (directionId: string) => {
    setIsLoadingSettings(true);
    try {
      console.log('[EditDirectionDialog] Загрузка настроек для направления:', directionId);
      const settings = await defaultSettingsApi.get(directionId);
      
      if (settings) {
        console.log('[EditDirectionDialog] Настройки загружены:', settings);
        setSettingsId(settings.id);
        setSelectedCities(settings.cities || []);
        setAgeMin(settings.age_min);
        setAgeMax(settings.age_max);
        setGender(settings.gender);
        setDescription(settings.description);
        
        // Специфичные для целей
        if (settings.client_question) setClientQuestion(settings.client_question);
        if (settings.instagram_url) setInstagramUrl(settings.instagram_url);
        if (settings.site_url) setSiteUrl(settings.site_url);
        if (settings.pixel_id) {
          setPixelId(settings.pixel_id);
          setCapiPixelId(settings.pixel_id); // Используем тот же пиксель для CAPI
        }
        if (settings.utm_tag) setUtmTag(settings.utm_tag);
      } else {
        console.log('[EditDirectionDialog] Настройки не найдены, используем дефолты');
        // Сбрасываем к дефолтам
        resetAdSettings();
      }
    } catch (error) {
      console.error('[EditDirectionDialog] Ошибка загрузки настроек:', error);
      resetAdSettings();
    } finally {
      setIsLoadingSettings(false);
    }
  };

  const resetAdSettings = () => {
    setSettingsId(null);
    setSelectedCities([]);
    setAgeMin(18);
    setAgeMax(65);
    setGender('all');
    setDescription('Напишите нам, чтобы узнать подробности');
    setClientQuestion('Здравствуйте! Хочу узнать об этом подробнее.');
    setCapiPixelId('');
    setInstagramUrl('');
    setSiteUrl('');
    setPixelId('');
    setUtmTag(DEFAULT_UTM);
  };

  // Helper functions for CRM field selection
  const getFieldById = (fieldId: string | number | null) => {
    if (!fieldId) return undefined;
    return crmFields.find((field) => {
      if (capiCrmType === 'amocrm') {
        return (field as AmocrmCustomField).field_id === fieldId;
      }
      return (field as Bitrix24CustomField).id === fieldId;
    });
  };

  const getFieldName = (field: AmocrmCustomField | Bitrix24CustomField): string => {
    if (capiCrmType === 'amocrm') {
      return (field as AmocrmCustomField).field_name;
    }
    return (field as Bitrix24CustomField).label || (field as Bitrix24CustomField).fieldName;
  };

  const getFieldId = (field: AmocrmCustomField | Bitrix24CustomField): string | number => {
    if (capiCrmType === 'amocrm') {
      return (field as AmocrmCustomField).field_id;
    }
    return (field as Bitrix24CustomField).id;
  };

  const getFieldType = (field: AmocrmCustomField | Bitrix24CustomField): string => {
    if (capiCrmType === 'amocrm') {
      return (field as AmocrmCustomField).field_type;
    }
    return (field as Bitrix24CustomField).userTypeId;
  };

  const getFieldEnums = (field: AmocrmCustomField | Bitrix24CustomField) => {
    if (capiCrmType === 'amocrm') {
      return (field as AmocrmCustomField).enums || [];
    }
    return (field as Bitrix24CustomField).list || [];
  };

  const isSelectType = (field: AmocrmCustomField | Bitrix24CustomField | null): boolean => {
    if (!field) return false;
    const fieldType = getFieldType(field);
    return ['select', 'multiselect', 'enumeration'].includes(fieldType);
  };

  const needsEnumSelection = (field: AmocrmCustomField | Bitrix24CustomField | null): boolean => {
    if (!field) return false;
    const enums = getFieldEnums(field);
    return isSelectType(field) && enums.length > 0;
  };

  const getStageByKey = (stageKey: string | null): CrmStageOption | null => {
    if (!stageKey) return null;
    return crmStages.find((stage) => stage.key === stageKey) || null;
  };

  const convertFieldsToConfig = (fields: SelectedCapiField[]): CapiFieldConfig[] => {
    return fields
      .filter((item) => item.fieldId !== null)
      .map((item) => {
        const field = getFieldById(item.fieldId);
        if (!field) return null;

        const enums = getFieldEnums(field);
        let enumValue: string | null = null;

        if (item.enumId) {
          const selectedEnum = enums.find((enumItem) => {
            if (capiCrmType === 'amocrm') {
              return (enumItem as { id: number }).id === item.enumId;
            }
            return (enumItem as { id: string }).id === item.enumId;
          });
          enumValue = selectedEnum ? (selectedEnum as { value: string }).value : null;
        }

        return {
          field_id: getFieldId(field),
          field_name: getFieldName(field),
          field_type: getFieldType(field),
          enum_id: item.enumId,
          enum_value: enumValue,
          ...(capiCrmType === 'bitrix24' && { entity_type: 'lead' }),
        };
      })
      .filter(Boolean) as CapiFieldConfig[];
  };

  const convertStagesToConfig = (stages: SelectedCapiStage[]): CapiFieldConfig[] => {
    return stages
      .filter((item) => item.stageKey !== null)
      .map((item) => getStageByKey(item.stageKey))
      .filter((item): item is CrmStageOption => !!item)
      .map((stage) => ({
        field_id: stage.key,
        field_name: stage.label,
        field_type: 'pipeline_stage',
        entity_type: stage.entityType,
        pipeline_id: stage.pipelineId,
        status_id: stage.statusId,
      }));
  };

  const handleCitySelection = (cityId: string) => {
    // Простая логика как в VideoUpload
    let nextSelection = [...selectedCities];
    if (nextSelection.includes(cityId)) {
      // Снимаем выбор
      nextSelection = nextSelection.filter(id => id !== cityId);
    } else {
      // Добавляем выбор
      if (cityId === 'KZ') {
        // "Весь Казахстан" отменяет все остальные города
        nextSelection = ['KZ'];
      } else {
        // Убираем "Весь Казахстан" если был выбран
        nextSelection = nextSelection.filter(id => id !== 'KZ');
        nextSelection = [...nextSelection, cityId];
      }
    }
    setSelectedCities(nextSelection);
  };

  const handleSubmit = async () => {
    if (!direction) return;

    // Валидация основной информации
    if (!name.trim() || name.trim().length < 2) {
      setError('Название должно содержать минимум 2 символа');
      return;
    }

    let budgetValue = 0;
    let cplValue = 0;
    let tiktokBudgetValue = 0;
    let tiktokTargetCplValue: number | null = null;

    if (!isTikTok) {
      budgetValue = parseFloat(dailyBudget);
      if (isNaN(budgetValue) || budgetValue < 5) {
        setError('Минимальный бюджет: $5/день');
        return;
      }

      cplValue = parseFloat(targetCpl);
      const minCost = direction?.objective === 'instagram_traffic' ? 0.10 : 0.50;
      if (isNaN(cplValue) || cplValue < minCost) {
        const label = direction?.objective === 'instagram_traffic' ? 'перехода' : 'заявки';
        setError(`Минимальная стоимость ${label}: $${minCost.toFixed(2)}`);
        return;
      }
    } else {
      tiktokBudgetValue = parseFloat(tiktokDailyBudget);
      if (isNaN(tiktokBudgetValue) || tiktokBudgetValue < TIKTOK_MIN_DAILY_BUDGET) {
        setError(`Минимальный бюджет: ${TIKTOK_MIN_DAILY_BUDGET} KZT/день`);
        return;
      }

      if (tiktokTargetCpl.trim()) {
        const parsedTarget = parseFloat(tiktokTargetCpl);
        if (isNaN(parsedTarget) || parsedTarget < 0) {
          setError('Проверьте целевую стоимость для TikTok');
          return;
        }
        tiktokTargetCplValue = Math.round(parsedTarget);
      }
    }

    // Валидация настроек рекламы
    if (selectedCities.length === 0) {
      setError('Выберите хотя бы один город');
      return;
    }

    if (ageMin < 13 || ageMax > 65 || ageMin >= ageMax) {
      setError('Проверьте возрастной диапазон (13-65 лет)');
      return;
    }

    if (!description.trim()) {
      setError('Введите текст под видео');
      return;
    }

    // Валидация специфичных полей (Facebook)
    if (!isTikTok) {
      if (direction.objective === 'whatsapp' && !clientQuestion.trim()) {
        setError('Введите вопрос клиента для WhatsApp');
        return;
      }

      if (direction.objective === 'instagram_traffic' && !instagramUrl.trim()) {
        setError('Введите Instagram URL');
        return;
      }

      if (direction.objective === 'site_leads' && !siteUrl.trim()) {
        setError('Введите URL сайта');
        return;
      }
    }

    // lead_forms валидация не нужна - lead_form_id уже выбран при создании direction

    const interestConfig = capiInterestMode === 'stages'
      ? convertStagesToConfig(capiInterestStages)
      : convertFieldsToConfig(capiInterestFields);
    const qualifiedConfig = capiQualifiedMode === 'stages'
      ? convertStagesToConfig(capiQualifiedStages)
      : convertFieldsToConfig(capiQualifiedFields);
    const scheduledConfig = capiScheduledMode === 'stages'
      ? convertStagesToConfig(capiScheduledStages)
      : convertFieldsToConfig(capiScheduledFields);

    const isCrmCapiActive = !isTikTok && capiEnabled && !!capiPixelId && capiSource === 'crm';
    if (isCrmCapiActive) {
      if (isLoadingCrms) {
        setError('Подождите завершения проверки подключённых CRM и повторите сохранение');
        return;
      }

      if (connectedCrms.length === 0) {
        setError('Для источника CRM подключите AmoCRM или Bitrix24 в интеграциях');
        return;
      }

      if (!connectedCrms.includes(capiCrmType)) {
        setError('Выбранная CRM недоступна. Обновите подключение и попробуйте снова');
        return;
      }

      if (interestConfig.length === 0) {
        setError('Для Level 1 добавьте хотя бы один CRM-триггер (поле или этап)');
        return;
      }

      if (qualifiedConfig.length === 0) {
        setError('Для Level 2 добавьте хотя бы один CRM-триггер (поле или этап)');
        return;
      }

      if (scheduledConfig.length === 0) {
        setError('Для Level 3 добавьте хотя бы один CRM-триггер (поле или этап)');
        return;
      }

      console.info('[EditDirectionDialog] CRM CAPI validation passed', {
        directionId: direction.id,
        crmType: capiCrmType,
        interestCount: interestConfig.length,
        qualifiedCount: qualifiedConfig.length,
        scheduledCount: scheduledConfig.length,
        interestMode: capiInterestMode,
        qualifiedMode: capiQualifiedMode,
        scheduledMode: capiScheduledMode
      });
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Обновляем основную информацию направления + CAPI settings
      await onSubmit({
        name: name.trim(),
        ...(isTikTok
          ? {
              tiktok_daily_budget: Math.round(tiktokBudgetValue),
              ...(tiktokTargetCplValue !== null && { tiktok_target_cpl_kzt: tiktokTargetCplValue }),
            }
          : {
              daily_budget_cents: Math.round(budgetValue * 100),
              target_cpl_cents: Math.round(cplValue * 100),
              whatsapp_phone_number: whatsappPhoneNumber.trim() || null,
              ...(direction.objective === 'whatsapp_conversions' && { optimization_level: optimizationLevel }),
              capiSettings: {
                capi_enabled: capiEnabled && !!capiPixelId, // CAPI требует пиксель
                capi_source: capiEnabled && capiPixelId ? capiSource : null,
                capi_crm_type: isCrmCapiActive ? capiCrmType : null,
                capi_interest_fields: isCrmCapiActive ? interestConfig : [],
                capi_qualified_fields: isCrmCapiActive ? qualifiedConfig : [],
                capi_scheduled_fields: isCrmCapiActive ? scheduledConfig : [],
                pixel_id: capiEnabled ? capiPixelId || null : null,
              },
            }),
        is_active: isActive,
      });

      // Обновляем или создаём настройки рекламы
      const adSettingsInput: UpdateDefaultSettingsInput = {
        cities: selectedCities,
        age_min: ageMin,
        age_max: ageMax,
        gender,
        description: description.trim(),
        ...(!isTikTok && direction.objective === 'whatsapp' && {
          client_question: clientQuestion.trim(),
          // Сохраняем pixel_id для CAPI
          ...(capiEnabled && capiPixelId && { pixel_id: capiPixelId }),
        }),
        ...(!isTikTok && direction.objective === 'instagram_traffic' && {
          instagram_url: instagramUrl.trim(),
          // Сохраняем pixel_id для CAPI
          ...(capiEnabled && capiPixelId && { pixel_id: capiPixelId }),
        }),
        ...(!isTikTok && direction.objective === 'site_leads' && {
          site_url: siteUrl.trim(),
          pixel_id: pixelId || null,
          utm_tag: utmTag.trim() || DEFAULT_UTM,
        }),
        ...(!isTikTok && direction.objective === 'lead_forms' && {
          site_url: siteUrl.trim() || null,
          // Сохраняем pixel_id для CAPI
          ...(capiEnabled && capiPixelId && { pixel_id: capiPixelId }),
        }),
      };

      if (settingsId) {
        // Обновляем существующие настройки
        console.log('[EditDirectionDialog] Обновление настроек:', settingsId, adSettingsInput);
        const result = await defaultSettingsApi.update(settingsId, adSettingsInput);
        
        if (!result.success) {
          console.error('[EditDirectionDialog] Ошибка обновления настроек:', result.error);
          toast.warning('Направление обновлено, но не удалось сохранить настройки рекламы');
        }
      } else {
        // Создаём новые настройки
        console.log('[EditDirectionDialog] Создание новых настроек для направления:', direction.id);
        const result = await defaultSettingsApi.save({
          direction_id: direction.id,
          campaign_goal: direction.objective,
          ...adSettingsInput,
        });
        
        if (!result.success) {
          console.error('[EditDirectionDialog] Ошибка создания настроек:', result.error);
          toast.warning('Направление обновлено, но не удалось сохранить настройки рекламы');
        }
      }

      onOpenChange(false);
    } catch (err) {
      setError('Произошла ошибка при обновлении направления');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!direction) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        ref={dialogContentRef}
        className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto"
        onInteractOutside={(e) => {
          const el = e.target as HTMLElement;
          if (el.closest('[data-radix-popper-content-wrapper]')) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          const el = e.target as HTMLElement;
          if (el.closest('[data-radix-popper-content-wrapper]')) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Изменить направление: {direction.name}</DialogTitle>
          <DialogDescription>
            Обновите параметры направления и настройки рекламы
          </DialogDescription>
        </DialogHeader>

        {isLoadingSettings ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Загрузка настроек...</span>
          </div>
        ) : (
          <>
            <div className="space-y-6 py-4">
              {/* СЕКЦИЯ 1: Основная информация */}
              <div className="space-y-4">
                <h3 className="font-semibold text-sm">Основная информация</h3>
                
                {/* Название направления */}
                <div className="space-y-2">
                  <Label htmlFor="edit-direction-name">
                    Название направления <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="edit-direction-name"
                    placeholder="Название направления"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={isSubmitting}
                    maxLength={100}
                  />
                </div>

                {/* Тип кампании (только для отображения) */}
                <div className="space-y-2">
                  <Label>Тип кампании</Label>
                  <div className="text-sm text-muted-foreground">
                    {isTikTok
                      ? TIKTOK_OBJECTIVE_DESCRIPTIONS[direction.tiktok_objective || 'traffic']
                      : OBJECTIVE_DESCRIPTIONS[direction.objective]}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    ⚠️ Тип кампании нельзя изменить
                  </p>
                </div>

                {/* Суточный бюджет Instagram */}
                {!isTikTok && (
                  <div className="space-y-2">
                    <Label htmlFor="edit-daily-budget">
                      Суточный бюджет <span className="text-red-500">*</span>
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="edit-daily-budget"
                        type="number"
                        min="5"
                        step="1"
                        value={dailyBudget}
                        onChange={(e) => setDailyBudget(e.target.value)}
                        disabled={isSubmitting}
                        className="flex-1"
                      />
                      <span className="text-sm text-muted-foreground whitespace-nowrap">
                        $ / день
                      </span>
                    </div>
                  </div>
                )}

                {/* Суточный бюджет TikTok */}
                {isTikTok && (
                  <div className="space-y-2">
                    <Label htmlFor="edit-tiktok-daily-budget">
                      Суточный бюджет TikTok <span className="text-red-500">*</span>
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="edit-tiktok-daily-budget"
                        type="number"
                        min={TIKTOK_MIN_DAILY_BUDGET.toString()}
                        step="1"
                        value={tiktokDailyBudget}
                        onChange={(e) => setTikTokDailyBudget(e.target.value)}
                        disabled={isSubmitting}
                        className="flex-1"
                      />
                      <span className="text-sm text-muted-foreground whitespace-nowrap">
                        KZT / день
                      </span>
                    </div>
                  </div>
                )}

                {/* Целевая стоимость Instagram */}
                {!isTikTok && (
                  <div className="space-y-2">
                    <Label htmlFor="edit-target-cpl">
                      {direction?.objective === 'instagram_traffic'
                        ? 'Целевая стоимость перехода (CPC)'
                        : 'Целевая стоимость заявки (CPL)'} <span className="text-red-500">*</span>
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="edit-target-cpl"
                        type="number"
                        min={direction?.objective === 'instagram_traffic' ? '0.1' : '0.5'}
                        step="0.01"
                        value={targetCpl}
                        onChange={(e) => setTargetCpl(e.target.value)}
                        disabled={isSubmitting}
                        className="flex-1"
                      />
                      <span className="text-sm text-muted-foreground whitespace-nowrap">
                        {direction?.objective === 'instagram_traffic' ? '$ / переход' : '$ / заявка'}
                      </span>
                    </div>
                  </div>
                )}

                {/* Целевая стоимость TikTok */}
                {isTikTok && (
                  <div className="space-y-2">
                    <Label htmlFor="edit-tiktok-target-cpl">
                      Целевая стоимость TikTok (опционально)
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="edit-tiktok-target-cpl"
                        type="number"
                        min="0"
                        step="1"
                        placeholder="1500"
                        value={tiktokTargetCpl}
                        onChange={(e) => setTikTokTargetCpl(e.target.value)}
                        disabled={isSubmitting}
                        className="flex-1"
                      />
                      <span className="text-sm text-muted-foreground whitespace-nowrap">
                        KZT
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <Separator />

              {/* СЕКЦИЯ 2: Таргетинг */}
              <div className="space-y-4">
                <h3 className="font-semibold text-sm">📍 Таргетинг</h3>

                {/* География */}
                <div className="space-y-2">
                  <Label>
                    География <span className="text-red-500">*</span>
                  </Label>
                  <Popover open={cityPopoverOpen} onOpenChange={setCityPopoverOpen} modal={false}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" disabled={isSubmitting} className="w-full justify-between">
                        <span>
                          {selectedCities.length === 0 ? 'Выберите города' : `Выбрано: ${selectedCities.length}`}
                        </span>
                        <ChevronDown className="h-4 w-4 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent 
                      container={dialogContentRef.current}
                      className="z-50 w-64 max-h-60 overflow-y-auto p-4 flex flex-col gap-2"
                      side="bottom"
                      align="start"
                      sideOffset={6}
                    >
                      <div className="font-medium text-sm mb-2">Выберите города или страны</div>
                      <div className="flex flex-col gap-1">
                        {CITIES_AND_COUNTRIES.map(city => {
                          const isKZ = city.id === 'KZ';
                          const isOtherCountry = ['BY', 'KG', 'UZ'].includes(city.id);
                          const anyCitySelected = selectedCities.some(id => !COUNTRY_IDS.includes(id));
                          const isKZSelected = selectedCities.includes('KZ');
                          const isDisabled = isSubmitting ||
                            (isKZ && anyCitySelected) ||
                            (!isKZ && !isOtherCountry && isKZSelected);
                          
                          return (
                            <div
                              key={city.id} 
                              className="flex items-center gap-2 cursor-pointer text-sm py-1 hover:bg-accent px-2 rounded select-none"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!isDisabled) {
                                  handleCitySelection(city.id);
                                }
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={selectedCities.includes(city.id)}
                                disabled={isDisabled}
                                onChange={() => {
                                  if (!isDisabled) {
                                    handleCitySelection(city.id);
                                  }
                                }}
                              />
                              <span>{city.name}</span>
                            </div>
                          );
                        })}
                      </div>
                      <Button
                        className="mt-2"
                        onClick={() => setCityPopoverOpen(false)}
                        variant="outline"
                        size="sm"
                      >
                        ОК
                      </Button>
                    </PopoverContent>
                  </Popover>
                </div>

                {/* Возраст */}
                <div className="space-y-2">
                  <Label>
                    Возраст <span className="text-red-500">*</span>
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min="13"
                      max="65"
                      value={ageMin}
                      onChange={(e) => setAgeMin(parseInt(e.target.value) || 13)}
                      disabled={isSubmitting}
                      className="w-24"
                    />
                    <span className="text-muted-foreground">—</span>
                    <Input
                      type="number"
                      min="13"
                      max="65"
                      value={ageMax}
                      onChange={(e) => setAgeMax(parseInt(e.target.value) || 65)}
                      disabled={isSubmitting}
                      className="w-24"
                    />
                    <span className="text-sm text-muted-foreground">лет</span>
                  </div>
                </div>

                {/* Пол */}
                <div className="space-y-2">
                  <Label>Пол</Label>
                  <RadioGroup
                    value={gender}
                    onValueChange={(value) => setGender(value as 'all' | 'male' | 'female')}
                    disabled={isSubmitting}
                    className="flex gap-4"
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="all" id="edit-gender-all" />
                      <Label htmlFor="edit-gender-all" className="font-normal cursor-pointer">
                        Все
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="male" id="edit-gender-male" />
                      <Label htmlFor="edit-gender-male" className="font-normal cursor-pointer">
                        Мужчины
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="female" id="edit-gender-female" />
                      <Label htmlFor="edit-gender-female" className="font-normal cursor-pointer">
                        Женщины
                      </Label>
                    </div>
                  </RadioGroup>
                </div>
              </div>

              <Separator />

              {/* СЕКЦИЯ 3: Контент */}
              <div className="space-y-4">
                <h3 className="font-semibold text-sm">📝 Контент</h3>

                {/* Текст под видео */}
                <div className="space-y-2">
                  <Label htmlFor="edit-description">
                    Текст под видео <span className="text-red-500">*</span>
                  </Label>
                  <Textarea
                    id="edit-description"
                    placeholder="Напишите нам, чтобы узнать подробности"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    disabled={isSubmitting}
                    rows={3}
                  />
                </div>
              </div>

              <Separator />

              {/* СЕКЦИЯ 4: Специфичные настройки в зависимости от цели */}
              {!isTikTok && direction.objective === 'whatsapp' && (
                <div className="space-y-4">
                  <h3 className="font-semibold text-sm">💬 WhatsApp</h3>
                  
                  <div className="space-y-2">
                    <Label htmlFor="edit-whatsapp-number">
                      WhatsApp номер (опционально)
                    </Label>
                    <Input
                      id="edit-whatsapp-number"
                      value={whatsappPhoneNumber}
                      onChange={(e) => setWhatsappPhoneNumber(e.target.value)}
                      placeholder="+77001234567"
                      disabled={isSubmitting}
                      className="font-mono"
                    />
                    <p className="text-xs text-muted-foreground">
                      Международный формат: +[код страны][номер]. Если не указан - будет использован дефолтный из Facebook.
                    </p>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="edit-client-question">
                      Вопрос клиента <span className="text-red-500">*</span>
                    </Label>
                    <Textarea
                      id="edit-client-question"
                      placeholder="Здравствуйте! Хочу узнать об этом подробнее."
                      value={clientQuestion}
                      onChange={(e) => setClientQuestion(e.target.value)}
                      disabled={isSubmitting}
                      rows={2}
                    />
                    <p className="text-xs text-muted-foreground">
                      Это сообщение будет отправлено в WhatsApp от имени клиента
                    </p>
                  </div>
                </div>
              )}

              {!isTikTok && direction.objective === 'whatsapp_conversions' && (
                <div className="space-y-4">
                  <h3 className="font-semibold text-sm">📊 WhatsApp-конверсии (CAPI)</h3>

                  <div className="space-y-2">
                    <Label>
                      Уровень оптимизации <span className="text-red-500">*</span>
                    </Label>
                    <RadioGroup
                      value={optimizationLevel}
                      onValueChange={(value) => setOptimizationLevel(value as OptimizationLevel)}
                      disabled={isSubmitting}
                    >
                      <div className="flex items-start space-x-2">
                        <RadioGroupItem value="level_1" id="edit-opt-level-1" />
                        <div>
                          <Label htmlFor="edit-opt-level-1" className="font-normal cursor-pointer">
                            Level 1: Интерес
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            CompleteRegistration — 3+ сообщения от клиента
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start space-x-2">
                        <RadioGroupItem value="level_2" id="edit-opt-level-2" />
                        <div>
                          <Label htmlFor="edit-opt-level-2" className="font-normal cursor-pointer">
                            Level 2: Квалификация
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            AddToCart/Subscribe — клиент квалифицирован
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start space-x-2">
                        <RadioGroupItem value="level_3" id="edit-opt-level-3" />
                        <div>
                          <Label htmlFor="edit-opt-level-3" className="font-normal cursor-pointer">
                            Level 3: Запись/Покупка
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            Purchase — клиент записался или купил
                          </p>
                        </div>
                      </div>
                    </RadioGroup>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="edit-wa-conv-number">
                      WhatsApp номер (опционально)
                    </Label>
                    <Input
                      id="edit-wa-conv-number"
                      value={whatsappPhoneNumber}
                      onChange={(e) => setWhatsappPhoneNumber(e.target.value)}
                      placeholder="+77001234567"
                      disabled={isSubmitting}
                      className="font-mono"
                    />
                    <p className="text-xs text-muted-foreground">
                      Международный формат: +[код страны][номер]. Если не указан - будет использован дефолтный из Facebook.
                    </p>
                  </div>
                </div>
              )}

              {!isTikTok && direction.objective === 'instagram_traffic' && (
                <div className="space-y-4">
                  <h3 className="font-semibold text-sm">📱 Instagram</h3>
                  
                  <div className="space-y-2">
                    <Label htmlFor="edit-instagram-url">
                      Instagram URL <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="edit-instagram-url"
                      type="url"
                      placeholder="https://instagram.com/your_profile"
                      value={instagramUrl}
                      onChange={(e) => setInstagramUrl(e.target.value)}
                      disabled={isSubmitting}
                    />
                  </div>
                </div>
              )}

              {!isTikTok && direction.objective === 'site_leads' && (
                <div className="space-y-4">
                  <h3 className="font-semibold text-sm">🌐 Лиды на сайте</h3>
                  
                  <div className="space-y-2">
                    <Label htmlFor="edit-site-url">
                      URL сайта <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="edit-site-url"
                      type="url"
                      placeholder="https://yoursite.com"
                      value={siteUrl}
                      onChange={(e) => setSiteUrl(e.target.value)}
                      disabled={isSubmitting}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="edit-pixel-id">Pixel ID (опционально)</Label>
                    <Select
                      value={pixelId || 'none'}
                      onValueChange={(value) => setPixelId(value === 'none' ? '' : value)}
                      disabled={isSubmitting || isLoadingPixels}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={
                          isLoadingPixels
                            ? 'Загрузка...'
                            : pixels.length === 0
                              ? 'Нет доступных пикселей'
                              : 'Выберите пиксель'
                        } />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Без пикселя</SelectItem>
                        {pixels.length === 0 && !isLoadingPixels && (
                          <SelectItem value="no-pixels" disabled>
                            Пиксели не найдены в рекламном кабинете
                          </SelectItem>
                        )}
                        {pixels.map((pixel) => (
                          <SelectItem key={pixel.id} value={pixel.id}>
                            {pixel.name} ({pixel.id})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {pixels.length === 0 && !isLoadingPixels && (
                      <p className="text-xs text-muted-foreground">
                        В вашем рекламном кабинете не найдено пикселей. Вы можете продолжить без пикселя.
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="edit-utm-tag">UTM-метка (опционально)</Label>
                    <Textarea
                      id="edit-utm-tag"
                      placeholder={DEFAULT_UTM}
                      value={utmTag}
                      onChange={(e) => setUtmTag(e.target.value)}
                      disabled={isSubmitting}
                      rows={2}
                    />
                    <p className="text-xs text-muted-foreground">
                      Используйте переменные: {'{'}{'{'} campaign.name {'}'}{'}' }, {'{'}{'{'}  adset.name {'}'}{'}'}, {'{'}{'{'}  ad.name {'}'}{'}'}
                    </p>
                  </div>
                </div>
              )}

              {!isTikTok && direction.objective === 'lead_forms' && (
                <div className="space-y-4">
                  <h3 className="font-semibold text-sm">📝 Лид-формы</h3>

                  <div className="space-y-2">
                    <Label htmlFor="edit-site-url-leadforms">
                      URL сайта (для image креативов)
                    </Label>
                    <Input
                      id="edit-site-url-leadforms"
                      type="url"
                      placeholder="https://yoursite.com"
                      value={siteUrl}
                      onChange={(e) => setSiteUrl(e.target.value)}
                      disabled={isSubmitting}
                    />
                    <p className="text-xs text-muted-foreground">
                      Обязательно для креативов с картинками. Для видео креативов не требуется.
                    </p>
                  </div>
                </div>
              )}

              {/* СЕКЦИЯ: Meta CAPI */}
              {!isTikTok && direction.objective !== 'site_leads' && (
                <div className="space-y-4">
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-sm">📊 Meta Conversions API</h3>
                      <p className="text-xs text-muted-foreground">
                        Отправка событий конверсий в Meta для оптимизации рекламы
                      </p>
                    </div>
                    <Switch
                      checked={capiEnabled}
                      onCheckedChange={setCapiEnabled}
                      disabled={isSubmitting}
                    />
                  </div>

                  {capiEnabled && (
                    <div className="space-y-4 pl-4 border-l-2 border-blue-200">
                      {/* Выбор пикселя */}
                      <div className="space-y-2">
                        <Label>Facebook Pixel <span className="text-red-500">*</span></Label>
                        <Select
                          value={capiPixelId || 'none'}
                          onValueChange={(value) => setCapiPixelId(value === 'none' ? '' : value)}
                          disabled={isSubmitting || isLoadingPixels}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={
                              isLoadingPixels
                                ? 'Загрузка...'
                                : pixels.length === 0
                                  ? 'Нет доступных пикселей'
                                  : 'Выберите пиксель'
                            } />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Без пикселя</SelectItem>
                            {pixels.map((pixel) => (
                              <SelectItem key={pixel.id} value={pixel.id}>
                                {pixel.name} ({pixel.id})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {!capiPixelId && (
                          <p className="text-xs text-amber-600">
                            Выберите пиксель для отправки событий в Meta
                          </p>
                        )}
                      </div>

                      {/* Источник данных - показываем только если выбран пиксель */}
                      {capiPixelId && (
                        <div className="space-y-2">
                          <Label>Источник данных для событий</Label>
                          <RadioGroup
                            value={capiSource}
                            onValueChange={(value) => setCapiSource(value as CapiSource)}
                            disabled={isSubmitting}
                          >
                            <div className="flex items-start space-x-2">
                              <RadioGroupItem value="whatsapp" id="edit-capi-source-whatsapp" className="mt-1" />
                              <div>
                                <Label htmlFor="edit-capi-source-whatsapp" className="font-normal cursor-pointer">
                                  WhatsApp (AI-анализ)
                                </Label>
                                <p className="text-xs text-muted-foreground">
                                  ИИ анализирует диалоги и определяет уровень интереса
                                </p>
                              </div>
                            </div>
                            <div className="flex items-start space-x-2">
                              <RadioGroupItem
                                value="crm"
                                id="edit-capi-source-crm"
                                className="mt-1"
                                disabled={isLoadingCrms || connectedCrms.length === 0}
                              />
                              <div>
                                <Label htmlFor="edit-capi-source-crm" className="font-normal cursor-pointer">
                                  CRM (поля или этапы воронки)
                                </Label>
                                <p className="text-xs text-muted-foreground">
                                  {isLoadingCrms
                                    ? 'Проверяем подключения CRM...'
                                    : connectedCrms.length === 0
                                      ? 'Нет подключённых CRM'
                                      : 'События отправляются при изменении полей или этапов воронки в CRM'}
                                </p>
                              </div>
                            </div>
                          </RadioGroup>

                          {capiSource === 'crm' && (
                            <div className="space-y-4 mt-4">
                              {isLoadingCrms ? (
                                <div className="text-sm text-muted-foreground">Проверяем подключённые CRM...</div>
                              ) : connectedCrms.length === 0 ? (
                                <div className="text-sm text-amber-600">
                                  Нет подключённых CRM. Подключите AmoCRM или Bitrix24 в интеграциях профиля.
                                </div>
                              ) : (
                                <>
                                  {connectedCrms.length > 1 && (
                                    <div className="space-y-2">
                                      <Label>Выберите CRM</Label>
                                      <Select
                                        value={capiCrmType}
                                        onValueChange={(value) => setCapiCrmType(value as CrmType)}
                                        disabled={isSubmitting}
                                      >
                                        <SelectTrigger>
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {connectedCrms.includes('amocrm') && (
                                            <SelectItem value="amocrm">AmoCRM</SelectItem>
                                          )}
                                          {connectedCrms.includes('bitrix24') && (
                                            <SelectItem value="bitrix24">Bitrix24</SelectItem>
                                          )}
                                        </SelectContent>
                                      </Select>
                                    </div>
                                  )}

                                  <div className="space-y-3 p-3 border rounded-lg bg-blue-50 dark:bg-blue-900/20">
                                    <div className="flex items-center gap-2">
                                      <span className="text-blue-600 font-medium text-sm">Level 1: Интерес (Lead)</span>
                                    </div>
                                    <div className="space-y-2">
                                      <Label className="text-xs">Триггер CAPI</Label>
                                      <RadioGroup
                                        value={capiInterestMode}
                                        onValueChange={(value) => setCapiInterestMode(value as CapiTriggerMode)}
                                        disabled={isSubmitting}
                                        className="flex flex-wrap gap-4"
                                      >
                                        <div className="flex items-center space-x-2">
                                          <RadioGroupItem value="fields" id="edit-capi-interest-mode-fields" />
                                          <Label htmlFor="edit-capi-interest-mode-fields" className="font-normal cursor-pointer text-sm">
                                            Поля CRM
                                          </Label>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                          <RadioGroupItem value="stages" id="edit-capi-interest-mode-stages" />
                                          <Label htmlFor="edit-capi-interest-mode-stages" className="font-normal cursor-pointer text-sm">
                                            Этапы воронки
                                          </Label>
                                        </div>
                                      </RadioGroup>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                      {capiInterestMode === 'fields'
                                        ? 'Событие отправляется при установке любого из выбранных полей'
                                        : 'Событие отправляется при переходе лида на любой из выбранных этапов'}
                                    </p>

                                    {capiInterestMode === 'fields' ? (
                                      isLoadingCrmFields ? (
                                        <div className="text-sm text-muted-foreground">Загрузка полей CRM...</div>
                                      ) : crmFields.length === 0 ? (
                                        <div className="text-sm text-amber-600">
                                          В CRM не найдено подходящих полей (Флаг, Список, Мультисписок)
                                        </div>
                                      ) : (
                                        <CrmFieldSelector
                                          fields={crmFields}
                                          selectedFields={capiInterestFields}
                                          setSelectedFields={setCapiInterestFields}
                                          crmType={capiCrmType}
                                          isSubmitting={isSubmitting}
                                          getFieldById={getFieldById}
                                          getFieldId={getFieldId}
                                          getFieldName={getFieldName}
                                          getFieldType={getFieldType}
                                          getFieldEnums={getFieldEnums}
                                          needsEnumSelection={needsEnumSelection}
                                        />
                                      )
                                    ) : isLoadingCrmStages ? (
                                      <div className="text-sm text-muted-foreground">Загрузка этапов воронки...</div>
                                    ) : crmStages.length === 0 ? (
                                      <div className="text-sm text-amber-600">
                                        Этапы воронки не найдены. Проверьте синхронизацию CRM-пайплайнов.
                                      </div>
                                    ) : (
                                      <CrmStageSelector
                                        stages={crmStages}
                                        selectedStages={capiInterestStages}
                                        setSelectedStages={setCapiInterestStages}
                                        isSubmitting={isSubmitting}
                                      />
                                    )}
                                  </div>

                                  <div className="space-y-3 p-3 border rounded-lg bg-green-50 dark:bg-green-900/20">
                                    <div className="flex items-center gap-2">
                                      <span className="text-green-600 font-medium text-sm">Level 2: Квалификация (AddToCart/Subscribe)</span>
                                    </div>
                                    <div className="space-y-2">
                                      <Label className="text-xs">Триггер CAPI</Label>
                                      <RadioGroup
                                        value={capiQualifiedMode}
                                        onValueChange={(value) => setCapiQualifiedMode(value as CapiTriggerMode)}
                                        disabled={isSubmitting}
                                        className="flex flex-wrap gap-4"
                                      >
                                        <div className="flex items-center space-x-2">
                                          <RadioGroupItem value="fields" id="edit-capi-qualified-mode-fields" />
                                          <Label htmlFor="edit-capi-qualified-mode-fields" className="font-normal cursor-pointer text-sm">
                                            Поля CRM
                                          </Label>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                          <RadioGroupItem value="stages" id="edit-capi-qualified-mode-stages" />
                                          <Label htmlFor="edit-capi-qualified-mode-stages" className="font-normal cursor-pointer text-sm">
                                            Этапы воронки
                                          </Label>
                                        </div>
                                      </RadioGroup>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                      {capiQualifiedMode === 'fields'
                                        ? 'Событие отправляется при установке любого из выбранных полей'
                                        : 'Событие отправляется при переходе лида на любой из выбранных этапов'}
                                    </p>

                                    {capiQualifiedMode === 'fields' ? (
                                      isLoadingCrmFields ? (
                                        <div className="text-sm text-muted-foreground">Загрузка полей CRM...</div>
                                      ) : crmFields.length === 0 ? (
                                        <div className="text-sm text-amber-600">
                                          В CRM не найдено подходящих полей (Флаг, Список, Мультисписок)
                                        </div>
                                      ) : (
                                        <CrmFieldSelector
                                          fields={crmFields}
                                          selectedFields={capiQualifiedFields}
                                          setSelectedFields={setCapiQualifiedFields}
                                          crmType={capiCrmType}
                                          isSubmitting={isSubmitting}
                                          getFieldById={getFieldById}
                                          getFieldId={getFieldId}
                                          getFieldName={getFieldName}
                                          getFieldType={getFieldType}
                                          getFieldEnums={getFieldEnums}
                                          needsEnumSelection={needsEnumSelection}
                                        />
                                      )
                                    ) : isLoadingCrmStages ? (
                                      <div className="text-sm text-muted-foreground">Загрузка этапов воронки...</div>
                                    ) : crmStages.length === 0 ? (
                                      <div className="text-sm text-amber-600">
                                        Этапы воронки не найдены. Проверьте синхронизацию CRM-пайплайнов.
                                      </div>
                                    ) : (
                                      <CrmStageSelector
                                        stages={crmStages}
                                        selectedStages={capiQualifiedStages}
                                        setSelectedStages={setCapiQualifiedStages}
                                        isSubmitting={isSubmitting}
                                      />
                                    )}
                                  </div>

                                  <div className="space-y-3 p-3 border rounded-lg bg-purple-50 dark:bg-purple-900/20">
                                    <div className="flex items-center gap-2">
                                      <span className="text-purple-600 font-medium text-sm">Level 3: Запись (Schedule)</span>
                                    </div>
                                    <div className="space-y-2">
                                      <Label className="text-xs">Триггер CAPI</Label>
                                      <RadioGroup
                                        value={capiScheduledMode}
                                        onValueChange={(value) => setCapiScheduledMode(value as CapiTriggerMode)}
                                        disabled={isSubmitting}
                                        className="flex flex-wrap gap-4"
                                      >
                                        <div className="flex items-center space-x-2">
                                          <RadioGroupItem value="fields" id="edit-capi-scheduled-mode-fields" />
                                          <Label htmlFor="edit-capi-scheduled-mode-fields" className="font-normal cursor-pointer text-sm">
                                            Поля CRM
                                          </Label>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                          <RadioGroupItem value="stages" id="edit-capi-scheduled-mode-stages" />
                                          <Label htmlFor="edit-capi-scheduled-mode-stages" className="font-normal cursor-pointer text-sm">
                                            Этапы воронки
                                          </Label>
                                        </div>
                                      </RadioGroup>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                      {capiScheduledMode === 'fields'
                                        ? 'Событие отправляется при установке любого из выбранных полей'
                                        : 'Событие отправляется при переходе лида на любой из выбранных этапов'}
                                    </p>

                                    {capiScheduledMode === 'fields' ? (
                                      isLoadingCrmFields ? (
                                        <div className="text-sm text-muted-foreground">Загрузка полей CRM...</div>
                                      ) : crmFields.length === 0 ? (
                                        <div className="text-sm text-amber-600">
                                          В CRM не найдено подходящих полей (Флаг, Список, Мультисписок)
                                        </div>
                                      ) : (
                                        <CrmFieldSelector
                                          fields={crmFields}
                                          selectedFields={capiScheduledFields}
                                          setSelectedFields={setCapiScheduledFields}
                                          crmType={capiCrmType}
                                          isSubmitting={isSubmitting}
                                          getFieldById={getFieldById}
                                          getFieldId={getFieldId}
                                          getFieldName={getFieldName}
                                          getFieldType={getFieldType}
                                          getFieldEnums={getFieldEnums}
                                          needsEnumSelection={needsEnumSelection}
                                        />
                                      )
                                    ) : isLoadingCrmStages ? (
                                      <div className="text-sm text-muted-foreground">Загрузка этапов воронки...</div>
                                    ) : crmStages.length === 0 ? (
                                      <div className="text-sm text-amber-600">
                                        Этапы воронки не найдены. Проверьте синхронизацию CRM-пайплайнов.
                                      </div>
                                    ) : (
                                      <CrmStageSelector
                                        stages={crmStages}
                                        selectedStages={capiScheduledStages}
                                        setSelectedStages={setCapiScheduledStages}
                                        isSubmitting={isSubmitting}
                                      />
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Ошибка */}
              {error && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                Отмена
              </Button>
              <Button 
                variant="outline"
                onClick={handleSubmit} 
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Сохранение...' : 'Сохранить'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
