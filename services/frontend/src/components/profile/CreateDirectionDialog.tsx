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
import { ChevronDown, AlertCircle, CheckCircle2, QrCode, Cloud } from 'lucide-react';
import type {
  DirectionObjective,
  ConversionChannel,
  CreateDefaultSettingsInput,
  DirectionPlatform,
  TikTokObjective,
  OptimizationLevel,
} from '@/types/direction';
import { OBJECTIVE_DESCRIPTIONS, CONVERSION_CHANNEL_DESCRIPTIONS, TIKTOK_OBJECTIVE_DESCRIPTIONS } from '@/types/direction';
import { CITIES_AND_COUNTRIES, COUNTRY_IDS, DEFAULT_UTM } from '@/constants/cities';
import { defaultSettingsApi } from '@/services/defaultSettingsApi';
import { facebookApi } from '@/services/facebookApi';
import { directionsApi, type DirectionCustomAudience } from '@/services/directionsApi';
// tiktokApi убран - Instant Page ID вводится вручную
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { TooltipKeys } from '@/content/tooltips';
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

// Unified type for CRM field selection in direction CAPI settings
export interface CapiFieldConfig {
  field_id: string | number;
  field_name: string;
  field_type: string;
  enum_id?: string | number | null;
  enum_value?: string | null;
  entity_type?: string; // for Bitrix24
  pipeline_id?: string | number | null;
  status_id?: string | number | null;
}

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

interface ExistingCapiDirection {
  id: string;
  name: string;
  pixel_id: string;
  pixel_name?: string;
}

export type CrmType = 'amocrm' | 'bitrix24';
export type CapiSource = 'whatsapp' | 'crm';
export type ConnectionType = 'evolution' | 'waba';
export type CapiTriggerMode = 'fields' | 'stages';

const MAX_CAPI_FIELDS = 3;
const TIKTOK_MIN_DAILY_BUDGET = 2500;

// CRM Field Selector Component
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
    const fieldId = value === 'none' ? null : (crmType === 'amocrm' ? parseInt(value) : value);
    setSelectedFields(prev => {
      const updated = [...prev];
      updated[index] = { fieldId, enumId: null };
      return updated;
    });
  };

  const handleEnumChange = (index: number, value: string) => {
    const enumId = value === 'none' ? null : (crmType === 'amocrm' ? parseInt(value) : value);
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

  const activeFieldsCount = selectedFields.filter(sf => sf.fieldId !== null).length;

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

      {activeFieldsCount > 0 && (
        <p className="text-xs text-green-600 flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" />
          {activeFieldsCount === 1 ? 'Выбрано 1 поле' : `Выбрано ${activeFieldsCount} поля`}
        </p>
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

// CAPI settings to be passed to parent
export interface DirectionCapiSettings {
  capi_enabled: boolean;
  capi_source: CapiSource | null;
  capi_crm_type: CrmType | null;
  capi_interest_fields: CapiFieldConfig[];
  capi_qualified_fields: CapiFieldConfig[];
  capi_scheduled_fields: CapiFieldConfig[];
}

interface CreateDirectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CreateDirectionFormData) => Promise<void>;
  userAccountId: string;
  accountId?: string | null; // UUID из ad_accounts.id для мультиаккаунтности
  defaultPlatform?: DirectionPlatform;
  hasInstagramId?: boolean; // Есть ли Instagram Account ID у текущего аккаунта
}

export interface CreateDirectionFormData {
  name: string;
  platform: DirectionPlatform;
  objective?: DirectionObjective;
  optimization_level?: OptimizationLevel;
  use_instagram?: boolean;
  advantage_audience_enabled?: boolean;
  custom_audience_id?: string | null;
  daily_budget_cents?: number;
  target_cpl_cents?: number;
  tiktok_objective?: TikTokObjective;
  tiktok_daily_budget?: number;
  tiktok_target_cpl_kzt?: number;
  tiktok_instant_page_id?: string;
  whatsapp_phone_number?: string;
  whatsapp_connection_type?: ConnectionType;
  whatsapp_waba_phone_id?: string;
  adSettings?: CreateDefaultSettingsInput;
  facebookAdSettings?: CreateDefaultSettingsInput;
  tiktokAdSettings?: CreateDefaultSettingsInput;
  capiSettings?: DirectionCapiSettings;
}

export const CreateDirectionDialog: React.FC<CreateDirectionDialogProps> = ({
  open,
  onOpenChange,
  onSubmit,
  userAccountId,
  accountId,
  defaultPlatform = 'facebook',
  hasInstagramId = true,
}) => {
  // Ref для порталинга Popover внутрь Dialog
  const dialogContentRef = React.useRef<HTMLDivElement>(null);

  // Основная информация
  const [name, setName] = useState('');
  const [directionPlatform, setDirectionPlatform] = useState<DirectionPlatform>(defaultPlatform);
  const [objective, setObjective] = useState<DirectionObjective>('whatsapp');
  const [conversionChannel, setConversionChannel] = useState<ConversionChannel>('whatsapp');
  const [optimizationLevel, setOptimizationLevel] = useState<OptimizationLevel>('level_1');
  const [useInstagram, setUseInstagram] = useState(hasInstagramId !== false);
  const [advantageAudienceEnabled, setAdvantageAudienceEnabled] = useState(true);
  const [customAudienceId, setCustomAudienceId] = useState('');
  const [customAudiences, setCustomAudiences] = useState<DirectionCustomAudience[]>([]);
  const [isLoadingCustomAudiences, setIsLoadingCustomAudiences] = useState(false);
  const [dailyBudget, setDailyBudget] = useState('50');
  const [targetCpl, setTargetCpl] = useState('2.00');
  const [tiktokObjective, setTiktokObjective] = useState<TikTokObjective>('traffic');
  const [tiktokDailyBudget, setTikTokDailyBudget] = useState(String(TIKTOK_MIN_DAILY_BUDGET));
  const [tiktokTargetCpl, setTikTokTargetCpl] = useState('');
  const [separateTikTokSettings, setSeparateTikTokSettings] = useState(false);
  
  // WhatsApp номер (вводится напрямую)
  const [whatsappPhoneNumber, setWhatsappPhoneNumber] = useState<string>('');
  const [whatsappConnectionType, setWhatsappConnectionType] = useState<ConnectionType>('evolution');
  const [whatsappWabaPhoneId, setWhatsappWabaPhoneId] = useState<string>('');

  // Настройки рекламы - Таргетинг
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [cityPopoverOpen, setCityPopoverOpen] = useState(false);
  const [ageMin, setAgeMin] = useState<number>(18);
  const [ageMax, setAgeMax] = useState<number>(65);
  const [gender, setGender] = useState<'all' | 'male' | 'female'>('all');
  const [tiktokSelectedCities, setTikTokSelectedCities] = useState<string[]>([]);
  const [tiktokCityPopoverOpen, setTikTokCityPopoverOpen] = useState(false);
  const [tiktokAgeMin, setTikTokAgeMin] = useState<number>(18);
  const [tiktokAgeMax, setTikTokAgeMax] = useState<number>(65);
  const [tiktokGender, setTikTokGender] = useState<'all' | 'male' | 'female'>('all');
  
  // Настройки рекламы - Контент
  const [description, setDescription] = useState('Напишите нам, чтобы узнать подробности');
  const [tiktokDescription, setTikTokDescription] = useState('Напишите нам, чтобы узнать подробности');
  
  // Настройки рекламы - Специфичные для целей
  const [clientQuestion, setClientQuestion] = useState('Здравствуйте! Хочу узнать об этом подробнее.');
  const [instagramUrl, setInstagramUrl] = useState('');
  const [siteUrl, setSiteUrl] = useState('');
  const [pixelId, setPixelId] = useState('');
  const [pixels, setPixels] = useState<Array<{ id: string; name: string }>>([]);
  const [isLoadingPixels, setIsLoadingPixels] = useState(false);
  const [utmTag, setUtmTag] = useState(DEFAULT_UTM);

  // Lead Forms специфичные (Facebook)
  const [leadFormId, setLeadFormId] = useState('');
  const [leadForms, setLeadForms] = useState<Array<{ id: string; name: string; status: string }>>([]);
  const [isLoadingLeadForms, setIsLoadingLeadForms] = useState(false);
  const [appStoreUrl, setAppStoreUrl] = useState('');

  // TikTok Instant Page ID (Lead Forms) - ручной ввод
  const [tiktokInstantPageId, setTikTokInstantPageId] = useState('');

  // CAPI Configuration (direction-level)
  const [capiEnabled, setCapiEnabled] = useState(false);
  const [capiSource, setCapiSource] = useState<CapiSource>('whatsapp');
  const [capiCrmType, setCapiCrmType] = useState<CrmType>('amocrm');
  const [capiInterestMode, setCapiInterestMode] = useState<CapiTriggerMode>('fields');
  const [capiQualifiedMode, setCapiQualifiedMode] = useState<CapiTriggerMode>('fields');
  const [capiScheduledMode, setCapiScheduledMode] = useState<CapiTriggerMode>('fields');

  // CRM field selections for each CAPI level
  const [capiInterestFields, setCapiInterestFields] = useState<SelectedCapiField[]>([{ fieldId: null, enumId: null }]);
  const [capiQualifiedFields, setCapiQualifiedFields] = useState<SelectedCapiField[]>([{ fieldId: null, enumId: null }]);
  const [capiScheduledFields, setCapiScheduledFields] = useState<SelectedCapiField[]>([{ fieldId: null, enumId: null }]);
  const [capiInterestStages, setCapiInterestStages] = useState<SelectedCapiStage[]>([{ stageKey: null }]);
  const [capiQualifiedStages, setCapiQualifiedStages] = useState<SelectedCapiStage[]>([{ stageKey: null }]);
  const [capiScheduledStages, setCapiScheduledStages] = useState<SelectedCapiStage[]>([{ stageKey: null }]);

  // Connected CRMs
  const [connectedCrms, setConnectedCrms] = useState<CrmType[]>([]);
  const [isLoadingCrms, setIsLoadingCrms] = useState(false);

  // CRM custom fields (loaded based on selected CRM type)
  const [crmFields, setCrmFields] = useState<(AmocrmCustomField | Bitrix24CustomField)[]>([]);
  const [isLoadingCrmFields, setIsLoadingCrmFields] = useState(false);
  const [crmStages, setCrmStages] = useState<CrmStageOption[]>([]);
  const [isLoadingCrmStages, setIsLoadingCrmStages] = useState(false);

  // Existing directions with CAPI (for reuse pixel option)
  const [existingCapiDirections, setExistingCapiDirections] = useState<ExistingCapiDirection[]>([]);
  const [useExistingPixel, setUseExistingPixel] = useState(false);
  const [selectedExistingPixelId, setSelectedExistingPixelId] = useState<string>('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsFacebook = directionPlatform === 'facebook' || directionPlatform === 'both';
  const needsTikTok = directionPlatform === 'tiktok' || directionPlatform === 'both';

  const mapTikTokObjectiveToDirectionObjective = (value: TikTokObjective): DirectionObjective => {
    switch (value) {
      case 'lead_generation':
        return 'lead_forms';
      case 'conversions':
        return 'site_leads';
      case 'traffic':
      default:
        return 'instagram_traffic';
    }
  };

  useEffect(() => {
    if (open) {
      setDirectionPlatform(defaultPlatform);
    }
  }, [open, defaultPlatform]);

  useEffect(() => {
    if (directionPlatform !== 'both' && separateTikTokSettings) {
      setSeparateTikTokSettings(false);
    }
  }, [directionPlatform, separateTikTokSettings]);

  useEffect(() => {
    if (separateTikTokSettings) {
      setTikTokSelectedCities(selectedCities);
      setTikTokAgeMin(ageMin);
      setTikTokAgeMax(ageMax);
      setTikTokGender(gender);
      setTikTokDescription(description);
    }
  }, [separateTikTokSettings]);

  // Загрузка пикселей для всех типов целей (для Meta CAPI)
  // Для site_leads пиксель обязателен, для остальных — опционален
  useEffect(() => {
    if (!open || !needsFacebook) {
      setPixels([]);
      return;
    }

    const loadPixels = async () => {
      setIsLoadingPixels(true);
      try {
        const list = await facebookApi.getPixels();
        console.log('Загружены пиксели:', list);
        setPixels(Array.isArray(list) ? list : []);
      } catch (e) {
        console.error('Ошибка загрузки пикселей:', e);
        setPixels([]);
      } finally {
        setIsLoadingPixels(false);
      }
    };
    loadPixels();
  }, [open, needsFacebook]); // Загружаем при открытии диалога для Facebook

  // Загрузка кастомных аудиторий из Meta кабинета
  useEffect(() => {
    if (!open || !needsFacebook || !userAccountId) {
      setCustomAudiences([]);
      setCustomAudienceId('');
      return;
    }

    const loadCustomAudiences = async () => {
      setIsLoadingCustomAudiences(true);
      try {
        const audiences = await directionsApi.listCustomAudiences(userAccountId, accountId || null);
        setCustomAudiences(audiences);
        setCustomAudienceId((prev) => (
          prev && !audiences.some((aud) => aud.id === prev) ? '' : prev
        ));
      } catch (e) {
        console.error('Ошибка загрузки custom audiences:', e);
        setCustomAudiences([]);
      } finally {
        setIsLoadingCustomAudiences(false);
      }
    };

    loadCustomAudiences();
  }, [open, needsFacebook, userAccountId, accountId]);

  // Обновление дефолта целевой стоимости при смене objective
  useEffect(() => {
    // Для instagram_traffic дефолт $0.10, для остальных $2.00
    const defaultValue = objective === 'instagram_traffic' ? '0.10' : '2.00';
    setTargetCpl(defaultValue);
  }, [objective]);

  // Загрузка лидформ при выборе цели "Lead Forms" или "Конверсии" + канал "lead_form"
  const needsLeadFormLoad = objective === 'lead_forms' || (objective === 'conversions' && conversionChannel === 'lead_form');
  useEffect(() => {
    const loadLeadForms = async () => {
      if (!open || !needsFacebook || !needsLeadFormLoad) {
        // Сброс лидформ при переключении на другую цель или платформу
        setLeadForms([]);
        setLeadFormId('');
        return;
      }
      setIsLoadingLeadForms(true);
      try {
        const list = await facebookApi.getLeadForms();
        console.log('Загружены лидформы:', list);
        setLeadForms(Array.isArray(list) ? list : []);
      } catch (e) {
        console.error('Ошибка загрузки лидформ:', e);
        setLeadForms([]);
      } finally {
        setIsLoadingLeadForms(false);
      }
    };
    loadLeadForms();
  }, [objective, conversionChannel, open, needsFacebook, needsLeadFormLoad]);

  // Сброс Instant Page ID при смене цели
  useEffect(() => {
    if (!open || !needsTikTok || tiktokObjective !== 'lead_generation') {
      setTikTokInstantPageId('');
    }
  }, [tiktokObjective, open, needsTikTok]);

  // Load connected CRMs on mount
  useEffect(() => {
    if (!open || !needsFacebook) {
      setConnectedCrms([]);
      return;
    }

    const loadConnectedCrms = async () => {
      setIsLoadingCrms(true);
      const crms: CrmType[] = [];

      try {
        // Check AmoCRM connection (check if user has amocrm token via API)
        const params = new URLSearchParams({ userAccountId });
        if (accountId) {
          params.append('accountId', accountId);
        }
        const amocrmResponse = await fetch(
          `${API_BASE_URL}/amocrm/pipelines?${params.toString()}`
        );
        if (amocrmResponse.ok) {
          crms.push('amocrm');
        }
      } catch {
        // Not connected
      }

      try {
        // Check Bitrix24 connection
        const bitrixStatus = await getBitrix24Status(userAccountId, accountId || null);
        if (bitrixStatus.connected) {
          crms.push('bitrix24');
        }
      } catch {
        // Not connected
      }

      setConnectedCrms(crms);
      // Set default CRM type if only one is connected
      if (crms.length === 1) {
        setCapiCrmType(crms[0]);
      }
      setIsLoadingCrms(false);
    };

    if (userAccountId) {
      loadConnectedCrms();
    }
  }, [accountId, open, userAccountId, needsFacebook]);

  // Load CRM fields when CRM type changes and CAPI source is CRM
  useEffect(() => {
    const loadCrmFields = async () => {
      if (!needsFacebook || !capiEnabled || capiSource !== 'crm') {
        setCrmFields([]);
        return;
      }

      setIsLoadingCrmFields(true);
      try {
        if (capiCrmType === 'amocrm') {
          const response = await getAmocrmFields(userAccountId);
          setCrmFields(response.fields || []);
        } else if (capiCrmType === 'bitrix24') {
          // Load lead or deal fields based on entity type preference
          // For now, load lead fields
          const response = await getBitrix24LeadCustomFields(userAccountId);
          setCrmFields(response.fields || []);
        }
      } catch (err) {
        console.error('Failed to load CRM fields:', err);
        setCrmFields([]);
      } finally {
        setIsLoadingCrmFields(false);
      }
    };

    loadCrmFields();
  }, [capiEnabled, capiSource, capiCrmType, userAccountId, needsFacebook]);

  // Load CRM pipeline stages for stage-based CAPI triggers
  useEffect(() => {
    const loadCrmStages = async () => {
      if (!needsFacebook || !capiEnabled || capiSource !== 'crm') {
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
  }, [accountId, capiEnabled, capiSource, capiCrmType, needsFacebook, userAccountId]);

  // Load existing CAPI directions for pixel reuse option
  useEffect(() => {
    if (!open || !needsFacebook || !userAccountId || pixels.length === 0) {
      setExistingCapiDirections([]);
      return;
    }

    const loadExistingCapiDirections = async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/directions?userAccountId=${userAccountId}`
        );
        if (!response.ok) return;

        const directions = await response.json();
        const capiDirs: ExistingCapiDirection[] = [];

        for (const dir of directions) {
          // Check if direction has CAPI enabled with pixel
          const pixelId = dir.default_ad_settings?.pixel_id;
          if (pixelId) {
            const pixel = pixels.find(p => p.id === pixelId);
            capiDirs.push({
              id: dir.id,
              name: dir.name,
              pixel_id: pixelId,
              pixel_name: pixel?.name,
            });
          }
        }

        setExistingCapiDirections(capiDirs);
      } catch {
        // Ignore errors
      }
    };

    loadExistingCapiDirections();
  }, [open, userAccountId, pixels, needsFacebook]);

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

  const handleTikTokCitySelection = (cityId: string) => {
    let nextSelection = [...tiktokSelectedCities];
    if (nextSelection.includes(cityId)) {
      nextSelection = nextSelection.filter(id => id !== cityId);
    } else {
      if (cityId === 'KZ') {
        nextSelection = ['KZ'];
      } else {
        nextSelection = nextSelection.filter(id => id !== 'KZ');
        nextSelection = [...nextSelection, cityId];
      }
    }
    setTikTokSelectedCities(nextSelection);
  };

  const handleSubmit = async () => {
    // Валидация основной информации
    if (!name.trim() || name.trim().length < 2) {
      setError('Название должно содержать минимум 2 символа');
      return;
    }

    let budgetValue = 0;
    let cplValue = 0;
    let tiktokBudgetValue = 0;
    let tiktokTargetCplValue: number | null = null;

    if (needsFacebook) {
      budgetValue = parseFloat(dailyBudget);
      if (isNaN(budgetValue) || budgetValue < 5) {
        setError('Минимальный бюджет: $5/день');
        return;
      }

      cplValue = parseFloat(targetCpl);
      const minCost = objective === 'instagram_traffic' ? 0.10 : 0.50;
      if (isNaN(cplValue) || cplValue < minCost) {
        const label = objective === 'instagram_traffic' ? 'перехода' : 'заявки';
        setError(`Минимальная стоимость ${label}: $${minCost.toFixed(2)}`);
        return;
      }
    }

    if (needsTikTok) {
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

      // Валидация Instant Page ID для Lead Generation
      if (tiktokObjective === 'lead_generation' && !tiktokInstantPageId) {
        setError('Введите Instant Page ID для лидогенерации TikTok');
        return;
      }
    }

    // Валидация настроек рекламы
    const usesSharedSettings = needsFacebook || (!separateTikTokSettings && needsTikTok);
    if (usesSharedSettings) {
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
    }

    if (needsTikTok && separateTikTokSettings) {
      if (tiktokSelectedCities.length === 0) {
        setError('Выберите хотя бы один город для TikTok');
        return;
      }

      if (tiktokAgeMin < 13 || tiktokAgeMax > 65 || tiktokAgeMin >= tiktokAgeMax) {
        setError('Проверьте возрастной диапазон TikTok (13-65 лет)');
        return;
      }

      if (!tiktokDescription.trim()) {
        setError('Введите текст под видео для TikTok');
        return;
      }
    }

    // Валидация специфичных полей (Facebook)
    if (needsFacebook) {
      const needsWhatsAppFields = objective === 'whatsapp' || (objective === 'conversions' && conversionChannel === 'whatsapp');
      const needsLeadFormFields = objective === 'lead_forms' || (objective === 'conversions' && conversionChannel === 'lead_form');
      const needsSiteFields = objective === 'site_leads' || (objective === 'conversions' && conversionChannel === 'site');

      if (needsWhatsAppFields) {
        if (!clientQuestion.trim()) {
          setError('Введите вопрос клиента для WhatsApp');
          return;
        }

        // Валидация номера WhatsApp (если указан)
        if (whatsappPhoneNumber.trim() && !whatsappPhoneNumber.match(/^\+[1-9][0-9]{7,14}$/)) {
          setError('Неверный формат WhatsApp номера. Используйте международный формат: +12345678901');
          return;
        }

        // Валидация WABA Phone ID (обязательно для WABA типа подключения)
        if (whatsappPhoneNumber.trim() && whatsappConnectionType === 'waba' && !whatsappWabaPhoneId.trim()) {
          setError('Введите WABA Phone Number ID для подключения через Meta Cloud API');
          return;
        }
      }

      if (objective === 'instagram_traffic' && !instagramUrl.trim()) {
        setError('Введите Instagram URL');
        return;
      }

      if (needsSiteFields && !siteUrl.trim()) {
        setError('Введите URL сайта');
        return;
      }

      if (needsLeadFormFields && !leadFormId) {
        setError('Выберите лидформу');
        return;
      }

      if (objective === 'app_installs' && !appStoreUrl.trim()) {
        setError('Введите ссылку на приложение (App Store / Google Play)');
        return;
      }

    }

    setIsSubmitting(true);
    setError(null);

    try {
      const facebookAdSettings: CreateDefaultSettingsInput | undefined = needsFacebook
        ? {
            direction_id: '', // Будет установлен после создания направления
            campaign_goal: objective,
            cities: selectedCities,
            age_min: ageMin,
            age_max: ageMax,
            gender,
            description: description.trim(),
            // ✅ НОВОЕ: pixel_id передаётся для ВСЕХ типов целей (для Meta CAPI)
            // Для site_leads обязателен, для остальных — опционален
            pixel_id: pixelId || null,
            ...((objective === 'whatsapp' || (objective === 'conversions' && conversionChannel === 'whatsapp')) && { client_question: clientQuestion.trim() }),
            ...(objective === 'instagram_traffic' && { instagram_url: instagramUrl.trim() }),
            ...((objective === 'site_leads' || (objective === 'conversions' && conversionChannel === 'site')) && {
              site_url: siteUrl.trim(),
              utm_tag: utmTag.trim() || DEFAULT_UTM,
            }),
            ...((objective === 'lead_forms' || (objective === 'conversions' && conversionChannel === 'lead_form')) && {
              lead_form_id: leadFormId,
              ...(siteUrl.trim() && { site_url: siteUrl.trim() }),
            }),
            ...(objective === 'app_installs' && {
              app_store_url: appStoreUrl.trim(),
            }),
          }
        : undefined;

      const tiktokAdSettings: CreateDefaultSettingsInput | undefined = needsTikTok
        ? {
            direction_id: '',
            campaign_goal: mapTikTokObjectiveToDirectionObjective(tiktokObjective),
            cities: separateTikTokSettings ? tiktokSelectedCities : selectedCities,
            age_min: separateTikTokSettings ? tiktokAgeMin : ageMin,
            age_max: separateTikTokSettings ? tiktokAgeMax : ageMax,
            gender: separateTikTokSettings ? tiktokGender : gender,
            description: (separateTikTokSettings ? tiktokDescription : description).trim(),
          }
        : undefined;

      const interestConfig = capiInterestMode === 'stages'
        ? convertStagesToConfig(capiInterestStages)
        : convertFieldsToConfig(capiInterestFields);
      const qualifiedConfig = capiQualifiedMode === 'stages'
        ? convertStagesToConfig(capiQualifiedStages)
        : convertFieldsToConfig(capiQualifiedFields);
      const scheduledConfig = capiScheduledMode === 'stages'
        ? convertStagesToConfig(capiScheduledStages)
        : convertFieldsToConfig(capiScheduledFields);

      // Build CAPI settings if enabled
      const capiSettings: DirectionCapiSettings | undefined = needsFacebook && capiEnabled && pixelId ? {
        capi_enabled: true,
        capi_source: capiSource,
        capi_crm_type: capiSource === 'crm' ? capiCrmType : null,
        capi_interest_fields: capiSource === 'crm' ? interestConfig : [],
        capi_qualified_fields: capiSource === 'crm' ? qualifiedConfig : [],
        capi_scheduled_fields: capiSource === 'crm' ? scheduledConfig : [],
      } : undefined;

      await onSubmit({
        name: name.trim(),
        platform: directionPlatform,
        ...(needsFacebook && {
          objective,
          ...(objective === 'conversions' && { optimization_level: optimizationLevel, conversion_channel: conversionChannel }),
          use_instagram: useInstagram,
          advantage_audience_enabled: advantageAudienceEnabled,
          custom_audience_id: customAudienceId || null,
          daily_budget_cents: Math.round(budgetValue * 100),
          target_cpl_cents: Math.round(cplValue * 100),
          whatsapp_phone_number: whatsappPhoneNumber.trim() || undefined,
          ...(whatsappPhoneNumber.trim() && {
            whatsapp_connection_type: whatsappConnectionType,
            ...(whatsappConnectionType === 'waba' && { whatsapp_waba_phone_id: whatsappWabaPhoneId.trim() }),
          }),
        }),
        ...(needsTikTok && {
          tiktok_objective: tiktokObjective,
          tiktok_daily_budget: Math.round(tiktokBudgetValue),
          ...(tiktokTargetCplValue !== null && { tiktok_target_cpl_kzt: tiktokTargetCplValue }),
          ...(tiktokObjective === 'lead_generation' && tiktokInstantPageId && {
            tiktok_instant_page_id: tiktokInstantPageId,
          }),
        }),
        ...(separateTikTokSettings && needsFacebook && needsTikTok
          ? {
              facebookAdSettings,
              tiktokAdSettings,
            }
          : {
              adSettings: facebookAdSettings || tiktokAdSettings,
            }),
        capiSettings,
      });

      // Сброс формы
      resetForm();
      onOpenChange(false);
    } catch (err) {
      setError('Произошла ошибка при создании направления');
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setName('');
    setDirectionPlatform(defaultPlatform);
    setObjective('whatsapp');
    setConversionChannel('whatsapp');
    setOptimizationLevel('level_1');
    setAdvantageAudienceEnabled(true);
    setCustomAudienceId('');
    setDailyBudget('50');
    setTargetCpl('2.00');
    setTiktokObjective('traffic');
    setTikTokDailyBudget(String(TIKTOK_MIN_DAILY_BUDGET));
    setTikTokTargetCpl('');
    setSeparateTikTokSettings(false);
    setWhatsappPhoneNumber('');
    setWhatsappConnectionType('evolution');
    setWhatsappWabaPhoneId('');
    setSelectedCities([]);
    setAgeMin(18);
    setAgeMax(65);
    setGender('all');
    setTikTokSelectedCities([]);
    setTikTokAgeMin(18);
    setTikTokAgeMax(65);
    setTikTokGender('all');
    setDescription('Напишите нам, чтобы узнать подробности');
    setTikTokDescription('Напишите нам, чтобы узнать подробности');
    setClientQuestion('Здравствуйте! Хочу узнать об этом подробнее.');
    setInstagramUrl('');
    setSiteUrl('');
    setPixelId('');
    setUtmTag(DEFAULT_UTM);
    setLeadFormId('');
    setAppStoreUrl('');
    // CAPI settings
    setCapiEnabled(false);
    setCapiSource('whatsapp');
    setCapiCrmType('amocrm');
    setCapiInterestMode('fields');
    setCapiQualifiedMode('fields');
    setCapiScheduledMode('fields');
    setCapiInterestFields([{ fieldId: null, enumId: null }]);
    setCapiQualifiedFields([{ fieldId: null, enumId: null }]);
    setCapiScheduledFields([{ fieldId: null, enumId: null }]);
    setCapiInterestStages([{ stageKey: null }]);
    setCapiQualifiedStages([{ stageKey: null }]);
    setCapiScheduledStages([{ stageKey: null }]);
    setCrmStages([]);
    setUseExistingPixel(false);
    setSelectedExistingPixelId('');
  };

  // Helper functions for CRM field selection
  const getFieldById = (fieldId: string | number | null) => {
    if (!fieldId) return null;
    return crmFields.find(f => {
      if (capiCrmType === 'amocrm') {
        return (f as AmocrmCustomField).field_id === fieldId;
      } else {
        return (f as Bitrix24CustomField).id === fieldId;
      }
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
    // AmoCRM: select, multiselect
    // Bitrix24: enumeration (type_id)
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
      .filter(sf => sf.fieldId !== null)
      .map(sf => {
        const field = getFieldById(sf.fieldId);
        if (!field) return null;

        const enums = getFieldEnums(field);
        let enumValue: string | null = null;
        if (sf.enumId) {
          const selectedEnum = enums.find(e => {
            if (capiCrmType === 'amocrm') {
              return (e as { id: number }).id === sf.enumId;
            }
            return (e as { id: string }).id === sf.enumId;
          });
          enumValue = selectedEnum ? (selectedEnum as { value: string }).value : null;
        }

        return {
          field_id: getFieldId(field),
          field_name: getFieldName(field),
          field_type: getFieldType(field),
          enum_id: sf.enumId,
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
          <DialogTitle>Создать направление</DialogTitle>
          <DialogDescription>
            Заполните информацию о направлении и настройки рекламы
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* СЕКЦИЯ 1: Основная информация */}
          <div className="space-y-4">
            <h3 className="font-semibold text-sm">Основная информация</h3>
            
            {/* Название направления */}
            <div className="space-y-2">
              <Label htmlFor="direction-name">
                Название направления <span className="text-red-500">*</span>
              </Label>
              <Input
                id="direction-name"
                placeholder='Например: "Имплантация", "Виниры", "Брекеты"'
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isSubmitting}
                maxLength={100}
              />
              <p className="text-xs text-muted-foreground">
                Минимум 2 символа, максимум 100
              </p>
            </div>

            {/* Площадка */}
            <div className="space-y-2">
              <Label>
                Площадка <span className="text-red-500">*</span>
              </Label>
              <Select
                value={directionPlatform}
                onValueChange={(value) => setDirectionPlatform(value as DirectionPlatform)}
                disabled={isSubmitting}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Выберите площадку" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="facebook">Instagram</SelectItem>
                  <SelectItem value="tiktok">TikTok</SelectItem>
                  <SelectItem value="both">Instagram + TikTok</SelectItem>
                </SelectContent>
              </Select>
              {directionPlatform === 'both' && (
                <p className="text-xs text-muted-foreground">
                  Будут созданы два независимых направления для каждой площадки
                </p>
              )}
            </div>

            {/* Цель Instagram */}
            {needsFacebook && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label>
                    Цель Instagram <span className="text-red-500">*</span>
                  </Label>
                  <HelpTooltip tooltipKey={TooltipKeys.DIRECTION_OBJECTIVE} />
                </div>
                <RadioGroup
                  value={objective}
                  onValueChange={(value) => setObjective(value as DirectionObjective)}
                  disabled={isSubmitting}
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="whatsapp" id="obj-whatsapp" />
                    <Label htmlFor="obj-whatsapp" className="font-normal cursor-pointer">
                      {OBJECTIVE_DESCRIPTIONS.whatsapp}
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="conversions" id="obj-conversions" />
                    <Label htmlFor="obj-conversions" className="font-normal cursor-pointer">
                      {OBJECTIVE_DESCRIPTIONS.conversions}
                    </Label>
                  </div>
                  {hasInstagramId && (
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="instagram_traffic" id="obj-instagram" />
                      <Label htmlFor="obj-instagram" className="font-normal cursor-pointer">
                        {OBJECTIVE_DESCRIPTIONS.instagram_traffic}
                      </Label>
                    </div>
                  )}
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="site_leads" id="obj-site" />
                    <Label htmlFor="obj-site" className="font-normal cursor-pointer">
                      {OBJECTIVE_DESCRIPTIONS.site_leads}
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="lead_forms" id="obj-lead-forms" />
                    <Label htmlFor="obj-lead-forms" className="font-normal cursor-pointer">
                      {OBJECTIVE_DESCRIPTIONS.lead_forms}
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="app_installs" id="obj-app-installs" />
                    <Label htmlFor="obj-app-installs" className="font-normal cursor-pointer">
                      {OBJECTIVE_DESCRIPTIONS.app_installs}
                    </Label>
                  </div>
                </RadioGroup>
              </div>
            )}

            {/* Канал конверсий */}
            {needsFacebook && objective === 'conversions' && (
              <div className="space-y-2">
                <Label>
                  Канал конверсий <span className="text-red-500">*</span>
                </Label>
                <RadioGroup
                  value={conversionChannel}
                  onValueChange={(value) => {
                    setConversionChannel(value as ConversionChannel);
                    // Для lead_form и site — только CRM источник CAPI
                    if (value !== 'whatsapp') {
                      setCapiSource('crm');
                    }
                  }}
                  disabled={isSubmitting}
                >
                  <div className="flex items-start space-x-2">
                    <RadioGroupItem value="whatsapp" id="channel-whatsapp" />
                    <div>
                      <Label htmlFor="channel-whatsapp" className="font-normal cursor-pointer">
                        {CONVERSION_CHANNEL_DESCRIPTIONS.whatsapp}
                      </Label>
                    </div>
                  </div>
                  <div className="flex items-start space-x-2">
                    <RadioGroupItem value="lead_form" id="channel-lead-form" />
                    <div>
                      <Label htmlFor="channel-lead-form" className="font-normal cursor-pointer">
                        {CONVERSION_CHANNEL_DESCRIPTIONS.lead_form}
                      </Label>
                    </div>
                  </div>
                  <div className="flex items-start space-x-2">
                    <RadioGroupItem value="site" id="channel-site" />
                    <div>
                      <Label htmlFor="channel-site" className="font-normal cursor-pointer">
                        {CONVERSION_CHANNEL_DESCRIPTIONS.site}
                      </Label>
                    </div>
                  </div>
                </RadioGroup>
              </div>
            )}

            {/* Уровень оптимизации для конверсий */}
            {needsFacebook && objective === 'conversions' && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label>
                    Уровень оптимизации <span className="text-red-500">*</span>
                  </Label>
                </div>
                <RadioGroup
                  value={optimizationLevel}
                  onValueChange={(value) => setOptimizationLevel(value as OptimizationLevel)}
                  disabled={isSubmitting}
                >
                  <div className="flex items-start space-x-2">
                    <RadioGroupItem value="level_1" id="opt-level-1" />
                    <div>
                      <Label htmlFor="opt-level-1" className="font-normal cursor-pointer">
                        Level 1: Интерес
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        CompleteRegistration — 3+ сообщения от клиента
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start space-x-2">
                    <RadioGroupItem value="level_2" id="opt-level-2" />
                    <div>
                      <Label htmlFor="opt-level-2" className="font-normal cursor-pointer">
                        Level 2: Квалификация
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        AddToCart/Subscribe — клиент квалифицирован
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start space-x-2">
                    <RadioGroupItem value="level_3" id="opt-level-3" />
                    <div>
                      <Label htmlFor="opt-level-3" className="font-normal cursor-pointer">
                        Level 3: Запись/Покупка
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Purchase — клиент записался или купил
                      </p>
                    </div>
                  </div>
                </RadioGroup>
              </div>
            )}

            {/* Чекбокс использования Instagram аккаунта */}
            {needsFacebook && (
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="use-instagram"
                  checked={hasInstagramId ? useInstagram : false}
                  onChange={(e) => setUseInstagram(e.target.checked)}
                  disabled={isSubmitting || !hasInstagramId}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <Label htmlFor="use-instagram" className={`font-normal ${hasInstagramId ? 'cursor-pointer' : 'cursor-not-allowed text-muted-foreground'}`}>
                  Использовать Instagram аккаунт
                </Label>
              </div>
            )}
            {needsFacebook && (!useInstagram || !hasInstagramId) && (
              <p className="text-xs text-muted-foreground">
                {!hasInstagramId
                  ? 'Instagram аккаунт не привязан — реклама будет показываться только на Facebook'
                  : 'Реклама будет показываться от имени Facebook страницы без привязки к Instagram'}
              </p>
            )}

            {/* Цель TikTok */}
            {needsTikTok && (
              <div className="space-y-2">
                <Label>
                  Цель TikTok <span className="text-red-500">*</span>
                </Label>
                <RadioGroup
                  value={tiktokObjective}
                  onValueChange={(value) => setTiktokObjective(value as TikTokObjective)}
                  disabled={isSubmitting}
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="traffic" id="obj-tt-traffic" />
                    <Label htmlFor="obj-tt-traffic" className="font-normal cursor-pointer">
                      {TIKTOK_OBJECTIVE_DESCRIPTIONS.traffic}
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="conversions" id="obj-tt-conversions" />
                    <Label htmlFor="obj-tt-conversions" className="font-normal cursor-pointer">
                      {TIKTOK_OBJECTIVE_DESCRIPTIONS.conversions}
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="lead_generation" id="obj-tt-lead-gen" />
                    <Label htmlFor="obj-tt-lead-gen" className="font-normal cursor-pointer">
                      {TIKTOK_OBJECTIVE_DESCRIPTIONS.lead_generation}
                    </Label>
                  </div>
                </RadioGroup>
              </div>
            )}

            {/* TikTok Instant Page ID (Lead Generation) */}
            {needsTikTok && tiktokObjective === 'lead_generation' && (
              <div className="space-y-2">
                <Label htmlFor="tiktok-instant-page-id">
                  Instant Page ID <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="tiktok-instant-page-id"
                  value={tiktokInstantPageId}
                  onChange={(e) => setTikTokInstantPageId(e.target.value.trim())}
                  placeholder="Например: 7123456789012345678"
                  disabled={isSubmitting}
                  className="bg-white dark:bg-gray-900"
                />
                <p className="text-xs text-muted-foreground">
                  Скопируйте ID из TikTok Ads Manager → Tools → Instant Page
                </p>
              </div>
            )}

            {/* Суточный бюджет Instagram */}
            {needsFacebook && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="daily-budget">
                    Суточный бюджет Instagram <span className="text-red-500">*</span>
                  </Label>
                  <HelpTooltip tooltipKey={TooltipKeys.DIRECTION_BUDGET} />
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    id="daily-budget"
                    type="number"
                    min="5"
                    step="1"
                    placeholder="50"
                    value={dailyBudget}
                    onChange={(e) => setDailyBudget(e.target.value)}
                    disabled={isSubmitting}
                    className="flex-1"
                  />
                  <span className="text-sm text-muted-foreground whitespace-nowrap">
                    $ / день
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">Минимум: $5/день</p>
              </div>
            )}

            {/* Суточный бюджет TikTok */}
            {needsTikTok && (
              <div className="space-y-2">
                <Label htmlFor="tiktok-daily-budget">
                  Суточный бюджет TikTok <span className="text-red-500">*</span>
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="tiktok-daily-budget"
                    type="number"
                    min={TIKTOK_MIN_DAILY_BUDGET.toString()}
                    step="1"
                    placeholder={TIKTOK_MIN_DAILY_BUDGET.toString()}
                    value={tiktokDailyBudget}
                    onChange={(e) => setTikTokDailyBudget(e.target.value)}
                    disabled={isSubmitting}
                    className="flex-1"
                  />
                  <span className="text-sm text-muted-foreground whitespace-nowrap">
                    KZT / день
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Минимум: {TIKTOK_MIN_DAILY_BUDGET} KZT/день
                </p>
              </div>
            )}

            {/* Целевая стоимость Instagram */}
            {needsFacebook && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="target-cpl">
                    {objective === 'instagram_traffic'
                      ? 'Целевая стоимость перехода (CPC)'
                      : 'Целевая стоимость заявки (CPL)'} <span className="text-red-500">*</span>
                  </Label>
                  <HelpTooltip tooltipKey={objective === 'instagram_traffic' ? TooltipKeys.DIRECTION_TARGET_CPC : TooltipKeys.DIRECTION_TARGET_CPL} />
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    id="target-cpl"
                    type="number"
                    min={objective === 'instagram_traffic' ? '0.1' : '0.5'}
                    step="0.01"
                    placeholder={objective === 'instagram_traffic' ? '0.10' : '2.00'}
                    value={targetCpl}
                    onChange={(e) => setTargetCpl(e.target.value)}
                    disabled={isSubmitting}
                    className="flex-1"
                  />
                  <span className="text-sm text-muted-foreground whitespace-nowrap">
                    {objective === 'instagram_traffic' ? '$ / переход' : '$ / заявка'}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {objective === 'instagram_traffic' ? 'Минимум: $0.10/переход' : 'Минимум: $0.50/заявка'}
                </p>
              </div>
            )}

            {/* Целевая стоимость TikTok */}
            {needsTikTok && (
              <div className="space-y-2">
                <Label htmlFor="tiktok-target-cpl">
                  Целевая стоимость TikTok (опционально)
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="tiktok-target-cpl"
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
                <p className="text-xs text-muted-foreground">
                  Можно оставить пустым — будет использовано значение по умолчанию
                </p>
              </div>
            )}
          </div>

          <Separator />

          {/* СЕКЦИЯ 2: Таргетинг */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">📍 Таргетинг</h3>
              {needsFacebook && needsTikTok && (
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">
                    Отдельные настройки TikTok
                  </Label>
                  <Switch
                    checked={separateTikTokSettings}
                    onCheckedChange={setSeparateTikTokSettings}
                    disabled={isSubmitting}
                  />
                </div>
              )}
            </div>

            {!separateTikTokSettings && (
              <>
                {/* География */}
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <Label>
                      География <span className="text-red-500">*</span>
                    </Label>
                    <HelpTooltip tooltipKey={TooltipKeys.DIRECTION_CITIES} />
                  </div>
                  <Popover 
                    open={cityPopoverOpen} 
                    onOpenChange={setCityPopoverOpen} 
                    modal={false}
                  >
                    <PopoverTrigger asChild>
                      <Button 
                        variant="outline" 
                        disabled={isSubmitting} 
                        className="w-full justify-between"
                      >
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
                  <div className="flex items-center gap-1.5">
                    <Label>
                      Возраст <span className="text-red-500">*</span>
                    </Label>
                    <HelpTooltip tooltipKey={TooltipKeys.DIRECTION_AGE} />
                  </div>
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
                  <div className="flex items-center gap-1.5">
                    <Label>Пол</Label>
                    <HelpTooltip tooltipKey={TooltipKeys.DIRECTION_GENDER} />
                  </div>
                  <RadioGroup
                    value={gender}
                    onValueChange={(value) => setGender(value as 'all' | 'male' | 'female')}
                    disabled={isSubmitting}
                    className="flex gap-4"
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="all" id="gender-all" />
                      <Label htmlFor="gender-all" className="font-normal cursor-pointer">
                        Все
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="male" id="gender-male" />
                      <Label htmlFor="gender-male" className="font-normal cursor-pointer">
                        Мужчины
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="female" id="gender-female" />
                      <Label htmlFor="gender-female" className="font-normal cursor-pointer">
                        Женщины
                      </Label>
                    </div>
                  </RadioGroup>
                </div>
              </>
            )}

            {separateTikTokSettings && needsFacebook && needsTikTok && (
              <>
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-muted-foreground">Instagram</h4>
                  {/* География */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5">
                      <Label>
                        География <span className="text-red-500">*</span>
                      </Label>
                      <HelpTooltip tooltipKey={TooltipKeys.DIRECTION_CITIES} />
                    </div>
                    <Popover 
                      open={cityPopoverOpen} 
                      onOpenChange={setCityPopoverOpen} 
                      modal={false}
                    >
                      <PopoverTrigger asChild>
                        <Button 
                          variant="outline" 
                          disabled={isSubmitting} 
                          className="w-full justify-between"
                        >
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
                    <div className="flex items-center gap-1.5">
                      <Label>
                        Возраст <span className="text-red-500">*</span>
                      </Label>
                      <HelpTooltip tooltipKey={TooltipKeys.DIRECTION_AGE} />
                    </div>
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
                    <div className="flex items-center gap-1.5">
                      <Label>Пол</Label>
                      <HelpTooltip tooltipKey={TooltipKeys.DIRECTION_GENDER} />
                    </div>
                    <RadioGroup
                      value={gender}
                      onValueChange={(value) => setGender(value as 'all' | 'male' | 'female')}
                      disabled={isSubmitting}
                      className="flex gap-4"
                    >
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="all" id="gender-all" />
                        <Label htmlFor="gender-all" className="font-normal cursor-pointer">
                          Все
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="male" id="gender-male" />
                        <Label htmlFor="gender-male" className="font-normal cursor-pointer">
                          Мужчины
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="female" id="gender-female" />
                        <Label htmlFor="gender-female" className="font-normal cursor-pointer">
                          Женщины
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-muted-foreground">TikTok</h4>
                  {/* География */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5">
                      <Label>
                        География <span className="text-red-500">*</span>
                      </Label>
                      <HelpTooltip tooltipKey={TooltipKeys.DIRECTION_CITIES} />
                    </div>
                    <Popover 
                      open={tiktokCityPopoverOpen} 
                      onOpenChange={setTikTokCityPopoverOpen} 
                      modal={false}
                    >
                      <PopoverTrigger asChild>
                        <Button 
                          variant="outline" 
                          disabled={isSubmitting} 
                          className="w-full justify-between"
                        >
                          <span>
                            {tiktokSelectedCities.length === 0 ? 'Выберите города' : `Выбрано: ${tiktokSelectedCities.length}`}
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
                            const anyCitySelected = tiktokSelectedCities.some(id => !COUNTRY_IDS.includes(id));
                            const isKZSelected = tiktokSelectedCities.includes('KZ');
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
                                    handleTikTokCitySelection(city.id);
                                  }
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={tiktokSelectedCities.includes(city.id)}
                                  disabled={isDisabled}
                                  onChange={() => {
                                    if (!isDisabled) {
                                      handleTikTokCitySelection(city.id);
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
                          onClick={() => setTikTokCityPopoverOpen(false)}
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
                    <div className="flex items-center gap-1.5">
                      <Label>
                        Возраст <span className="text-red-500">*</span>
                      </Label>
                      <HelpTooltip tooltipKey={TooltipKeys.DIRECTION_AGE} />
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min="13"
                        max="65"
                        value={tiktokAgeMin}
                        onChange={(e) => setTikTokAgeMin(parseInt(e.target.value) || 13)}
                        disabled={isSubmitting}
                        className="w-24"
                      />
                      <span className="text-muted-foreground">—</span>
                      <Input
                        type="number"
                        min="13"
                        max="65"
                        value={tiktokAgeMax}
                        onChange={(e) => setTikTokAgeMax(parseInt(e.target.value) || 65)}
                        disabled={isSubmitting}
                        className="w-24"
                      />
                      <span className="text-sm text-muted-foreground">лет</span>
                    </div>
                  </div>

                  {/* Пол */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5">
                      <Label>Пол</Label>
                      <HelpTooltip tooltipKey={TooltipKeys.DIRECTION_GENDER} />
                    </div>
                    <RadioGroup
                      value={tiktokGender}
                      onValueChange={(value) => setTikTokGender(value as 'all' | 'male' | 'female')}
                      disabled={isSubmitting}
                      className="flex gap-4"
                    >
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="all" id="gender-tt-all" />
                        <Label htmlFor="gender-tt-all" className="font-normal cursor-pointer">
                          Все
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="male" id="gender-tt-male" />
                        <Label htmlFor="gender-tt-male" className="font-normal cursor-pointer">
                          Мужчины
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="female" id="gender-tt-female" />
                        <Label htmlFor="gender-tt-female" className="font-normal cursor-pointer">
                          Женщины
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>
                </div>
              </>
            )}

            {needsFacebook && (
              <div className="space-y-3 rounded-md border p-3 bg-muted/20">
                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <Label>Advantage+ Audience</Label>
                    <p className="text-xs text-muted-foreground">
                      Можно отключить, если нужен строго фиксированный таргетинг.
                    </p>
                  </div>
                  <Switch
                    checked={advantageAudienceEnabled}
                    onCheckedChange={setAdvantageAudienceEnabled}
                    disabled={isSubmitting}
                  />
                </div>
              </div>
            )}

            {needsFacebook && (
              <div className="space-y-2 rounded-md border p-3 bg-muted/20">
                <Label htmlFor="direction-custom-audience">Custom Audience (опционально)</Label>
                <Select
                  value={customAudienceId || 'none'}
                  onValueChange={(value) => setCustomAudienceId(value === 'none' ? '' : value)}
                  disabled={isSubmitting || isLoadingCustomAudiences}
                >
                  <SelectTrigger id="direction-custom-audience">
                    <SelectValue placeholder={
                      isLoadingCustomAudiences
                        ? 'Загрузка...'
                        : customAudiences.length === 0
                          ? 'Аудитории не найдены'
                          : 'Выберите аудиторию'
                    } />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Без Custom Audience</SelectItem>
                    {customAudiences.length === 0 && !isLoadingCustomAudiences && (
                      <SelectItem value="no-audiences" disabled>
                        Нет доступных Custom Audience
                      </SelectItem>
                    )}
                    {customAudiences.map((audience) => (
                      <SelectItem key={audience.id} value={audience.id}>
                        {audience.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Список подтягивается из текущего рекламного кабинета Meta.
                </p>
              </div>
            )}
          </div>

          <Separator />

          {/* СЕКЦИЯ 3: Контент */}
          <div className="space-y-4">
            <h3 className="font-semibold text-sm">📝 Контент</h3>

            {!separateTikTokSettings && (
              <div className="space-y-2">
                <Label htmlFor="description">
                  Текст под видео <span className="text-red-500">*</span>
                </Label>
                <Textarea
                  id="description"
                  placeholder="Напишите нам, чтобы узнать подробности"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={isSubmitting}
                  rows={3}
                />
              </div>
            )}

            {separateTikTokSettings && needsFacebook && needsTikTok && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="description">
                    Текст под видео (Instagram) <span className="text-red-500">*</span>
                  </Label>
                  <Textarea
                    id="description"
                    placeholder="Напишите нам, чтобы узнать подробности"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    disabled={isSubmitting}
                    rows={3}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="tiktok-description">
                    Текст под видео (TikTok) <span className="text-red-500">*</span>
                  </Label>
                  <Textarea
                    id="tiktok-description"
                    placeholder="Напишите нам, чтобы узнать подробности"
                    value={tiktokDescription}
                    onChange={(e) => setTikTokDescription(e.target.value)}
                    disabled={isSubmitting}
                    rows={3}
                  />
                </div>
              </>
            )}
          </div>

          <Separator />

          {/* СЕКЦИЯ 4: Специфичные настройки в зависимости от цели */}
          {needsFacebook && (objective === 'whatsapp' || (objective === 'conversions' && conversionChannel === 'whatsapp')) && (
            <div className="space-y-4">
              <h3 className="font-semibold text-sm">💬 WhatsApp</h3>

              {/* Ввод WhatsApp номера */}
              <div className="space-y-2">
                <Label htmlFor="whatsapp-number">
                  WhatsApp номер (опционально)
                </Label>
                <Input
                  id="whatsapp-number"
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

              {/* Тип подключения WhatsApp (показываем только если номер указан) */}
              {whatsappPhoneNumber.trim() && (
                <>
                  <div className="space-y-2">
                    <Label>Тип подключения</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setWhatsappConnectionType('evolution');
                          setWhatsappWabaPhoneId('');
                        }}
                        disabled={isSubmitting}
                        className={`flex items-center gap-2 p-3 rounded-lg border-2 transition-colors ${
                          whatsappConnectionType === 'evolution'
                            ? 'border-primary bg-primary/5'
                            : 'border-muted hover:border-muted-foreground/50'
                        }`}
                      >
                        <QrCode className="w-5 h-5" />
                        <div className="text-left">
                          <div className="font-medium text-sm">QR-код</div>
                          <div className="text-xs text-muted-foreground">Evolution API</div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => setWhatsappConnectionType('waba')}
                        disabled={isSubmitting}
                        className={`flex items-center gap-2 p-3 rounded-lg border-2 transition-colors ${
                          whatsappConnectionType === 'waba'
                            ? 'border-primary bg-primary/5'
                            : 'border-muted hover:border-muted-foreground/50'
                        }`}
                      >
                        <Cloud className="w-5 h-5" />
                        <div className="text-left">
                          <div className="font-medium text-sm">WABA</div>
                          <div className="text-xs text-muted-foreground">Meta Cloud API</div>
                        </div>
                      </button>
                    </div>
                  </div>

                  {/* WABA Phone ID - только для WABA */}
                  {whatsappConnectionType === 'waba' && (
                    <div className="space-y-2">
                      <Label htmlFor="waba-phone-id">
                        WABA Phone Number ID <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="waba-phone-id"
                        value={whatsappWabaPhoneId}
                        onChange={(e) => setWhatsappWabaPhoneId(e.target.value)}
                        placeholder="123456789012345"
                        disabled={isSubmitting}
                        className="font-mono"
                      />
                      <p className="text-xs text-muted-foreground">
                        Найти в Meta Business Suite → WhatsApp Manager → Phone Numbers
                      </p>
                    </div>
                  )}
                </>
              )}

              <div className="space-y-2">
                <Label htmlFor="client-question">
                  Вопрос клиента <span className="text-red-500">*</span>
                </Label>
                <Textarea
                  id="client-question"
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

          {needsFacebook && objective === 'instagram_traffic' && (
            <div className="space-y-4">
              <h3 className="font-semibold text-sm">📱 Instagram</h3>
              
              <div className="space-y-2">
                <Label htmlFor="instagram-url">
                  Instagram URL <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="instagram-url"
                  type="url"
                  placeholder="https://instagram.com/your_profile"
                  value={instagramUrl}
                  onChange={(e) => setInstagramUrl(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>
            </div>
          )}

          {needsFacebook && (objective === 'site_leads' || (objective === 'conversions' && conversionChannel === 'site')) && (
            <div className="space-y-4">
              <h3 className="font-semibold text-sm">🌐 Лиды на сайте</h3>
              
              <div className="space-y-2">
                <Label htmlFor="site-url">
                  URL сайта <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="site-url"
                  type="url"
                  placeholder="https://yoursite.com"
                  value={siteUrl}
                  onChange={(e) => setSiteUrl(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="pixel-id">Pixel ID (опционально)</Label>
                  <HelpTooltip tooltipKey={TooltipKeys.DIRECTION_PIXEL_ID} />
                </div>
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
                <Label htmlFor="utm-tag">UTM-метка (опционально)</Label>
                <Textarea
                  id="utm-tag"
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

          {needsFacebook && (objective === 'lead_forms' || (objective === 'conversions' && conversionChannel === 'lead_form')) && (
            <div className="space-y-4">
              <h3 className="font-semibold text-sm">📋 Лидформы Facebook</h3>

              <div className="space-y-2">
                <Label htmlFor="lead-form-id">
                  Лидформа <span className="text-red-500">*</span>
                </Label>
                <Select
                  value={leadFormId || 'none'}
                  onValueChange={(value) => setLeadFormId(value === 'none' ? '' : value)}
                  disabled={isSubmitting || isLoadingLeadForms}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={
                      isLoadingLeadForms
                        ? 'Загрузка...'
                        : leadForms.length === 0
                          ? 'Нет доступных лидформ'
                          : 'Выберите лидформу'
                    } />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none" disabled>Выберите лидформу</SelectItem>
                    {leadForms.length === 0 && !isLoadingLeadForms && (
                      <SelectItem value="no-forms" disabled>
                        Лидформы не найдены на странице Facebook
                      </SelectItem>
                    )}
                    {leadForms.map((form) => (
                      <SelectItem key={form.id} value={form.id}>
                        {form.name} ({form.status})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {leadForms.length === 0 && !isLoadingLeadForms && (
                  <p className="text-xs text-muted-foreground">
                    На вашей Facebook странице не найдено лидформ. Создайте лидформу в Facebook Ads Manager.
                  </p>
                )}
                {leadForms.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Выберите лидформу, которая будет использоваться для сбора заявок
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="lead-form-site-url">
                  URL сайта (для изображений и каруселей)
                </Label>
                <Input
                  id="lead-form-site-url"
                  type="url"
                  placeholder="https://yoursite.com"
                  value={siteUrl}
                  onChange={(e) => setSiteUrl(e.target.value)}
                  disabled={isSubmitting}
                />
                <p className="text-xs text-amber-600">
                  ⚠️ Обязательно для объявлений с изображениями и каруселями. Для видео — не требуется.
                </p>
                <p className="text-xs text-muted-foreground">
                  Если не указан, вы сможете создавать только видео объявления на эту лид-форму.
                </p>
              </div>
            </div>
          )}

          {needsFacebook && objective === 'app_installs' && (
            <div className="space-y-4">
              <h3 className="font-semibold text-sm">📲 Установки приложения</h3>
              <div className="space-y-2">
                <Label htmlFor="app-store-url">
                  Ссылка на приложение (App Store / Google Play) <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="app-store-url"
                  type="url"
                  value={appStoreUrl}
                  onChange={(e) => setAppStoreUrl(e.target.value)}
                  placeholder="https://apps.apple.com/app/id1234567890"
                  disabled={isSubmitting}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                App ID и SKAdNetwork берутся из глобальных env на сервере.
              </p>
            </div>
          )}

          {needsFacebook && objective === 'conversions' && (
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
                    {existingCapiDirections.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="use-existing-pixel"
                            checked={useExistingPixel}
                            onChange={(e) => {
                              setUseExistingPixel(e.target.checked);
                              if (e.target.checked && existingCapiDirections.length > 0) {
                                const first = existingCapiDirections[0];
                                setSelectedExistingPixelId(first.pixel_id);
                                setPixelId(first.pixel_id);
                              } else {
                                setSelectedExistingPixelId('');
                                setPixelId('');
                              }
                            }}
                            disabled={isSubmitting}
                          />
                          <Label htmlFor="use-existing-pixel" className="font-normal cursor-pointer">
                            Использовать пиксель из другого направления
                          </Label>
                        </div>
                        {useExistingPixel && (
                          <div className="ml-6">
                            <Select
                              value={selectedExistingPixelId}
                              onValueChange={(value) => {
                                setSelectedExistingPixelId(value);
                                setPixelId(value);
                              }}
                              disabled={isSubmitting}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Выберите направление" />
                              </SelectTrigger>
                              <SelectContent>
                                {existingCapiDirections.map((dir) => (
                                  <SelectItem key={dir.id} value={dir.pixel_id}>
                                    {dir.name} - {dir.pixel_name || dir.pixel_id}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                              <AlertCircle className="h-3 w-3" />
                              Лиды будут объединены в одну аудиторию с выбранным направлением
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    {!useExistingPixel && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-1.5">
                          <Label>Facebook Pixel</Label>
                          <HelpTooltip tooltipKey={TooltipKeys.DIRECTION_PIXEL_ID} />
                        </div>
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
                            {pixels.map((pixel) => (
                              <SelectItem key={pixel.id} value={pixel.id}>
                                {pixel.name} ({pixel.id})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>

                  {/* Источник данных */}
                  {pixelId && (
                    <div className="space-y-3">
                      <Label>Источник данных для событий</Label>
                      {conversionChannel !== 'whatsapp' ? (
                        <p className="text-sm text-muted-foreground">
                          CRM-система (для канала {CONVERSION_CHANNEL_DESCRIPTIONS[conversionChannel]})
                        </p>
                      ) : (
                      <RadioGroup
                        value={capiSource}
                        onValueChange={(value) => setCapiSource(value as CapiSource)}
                        disabled={isSubmitting}
                      >
                        <div className="flex items-start space-x-2">
                          <RadioGroupItem value="whatsapp" id="capi-source-whatsapp" className="mt-1" />
                          <div>
                            <Label htmlFor="capi-source-whatsapp" className="font-normal cursor-pointer">
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
                            id="capi-source-crm"
                            className="mt-1"
                            disabled={connectedCrms.length === 0}
                          />
                          <div>
                            <Label
                              htmlFor="capi-source-crm"
                              className={`font-normal cursor-pointer ${connectedCrms.length === 0 ? 'text-muted-foreground' : ''}`}
                            >
                              CRM (поля или этапы воронки)
                            </Label>
                            <p className="text-xs text-muted-foreground">
                              {connectedCrms.length === 0
                                ? 'Нет подключённых CRM'
                                : 'События отправляются при изменении полей в CRM'}
                            </p>
                          </div>
                        </div>
                      </RadioGroup>
                      )}

                      {/* CRM Configuration */}
                      {(capiSource === 'crm' || conversionChannel !== 'whatsapp') && connectedCrms.length > 0 && (
                        <div className="space-y-4 mt-4">
                          {/* CRM Type Selection */}
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

                          {/* Level 1: Interest (Lead) */}
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
                                  <RadioGroupItem value="fields" id="capi-interest-mode-fields" />
                                  <Label htmlFor="capi-interest-mode-fields" className="font-normal cursor-pointer text-sm">
                                    Поля CRM
                                  </Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                  <RadioGroupItem value="stages" id="capi-interest-mode-stages" />
                                  <Label htmlFor="capi-interest-mode-stages" className="font-normal cursor-pointer text-sm">
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

                          {/* Level 2: Qualified (AddToCart/Subscribe) */}
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
                                  <RadioGroupItem value="fields" id="capi-qualified-mode-fields" />
                                  <Label htmlFor="capi-qualified-mode-fields" className="font-normal cursor-pointer text-sm">
                                    Поля CRM
                                  </Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                  <RadioGroupItem value="stages" id="capi-qualified-mode-stages" />
                                  <Label htmlFor="capi-qualified-mode-stages" className="font-normal cursor-pointer text-sm">
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

                          {/* Level 3: Schedule */}
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
                                  <RadioGroupItem value="fields" id="capi-scheduled-mode-fields" />
                                  <Label htmlFor="capi-scheduled-mode-fields" className="font-normal cursor-pointer text-sm">
                                    Поля CRM
                                  </Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                  <RadioGroupItem value="stages" id="capi-scheduled-mode-stages" />
                                  <Label htmlFor="capi-scheduled-mode-stages" className="font-normal cursor-pointer text-sm">
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
            {isSubmitting ? 'Создание...' : 'Создать'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
