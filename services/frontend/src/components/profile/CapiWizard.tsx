import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { MessageCircle, FileText, Globe, ArrowLeft, ArrowRight, Loader2, Info } from 'lucide-react';
import { toast } from 'sonner';
import {
  capiSettingsApi,
  type CapiSettingsRecord,
  type CapiChannel,
  type CapiSource,
  type CrmType,
  type CapiFieldConfig,
  CHANNEL_LABELS,
} from '@/services/capiSettingsApi';
import CrmFieldSelector, {
  type SelectedCapiField,
  type CrmType as CrmFieldCrmType,
} from '@/components/capi/CrmFieldSelector';
import CrmStageSelector, {
  type CrmStageOption,
  type SelectedCapiStage,
} from '@/components/capi/CrmStageSelector';
import {
  getLeadCustomFields as getAmocrmFields,
  getPipelines as getAmocrmPipelines,
  type CustomField as AmocrmCustomField,
  type Pipeline as AmocrmPipeline,
} from '@/services/amocrmApi';
import {
  getBitrix24Pipelines,
  getBitrix24LeadCustomFields,
  getBitrix24DealCustomFields,
  type CustomField as Bitrix24CustomField,
  type Bitrix24Pipelines,
} from '@/services/bitrix24Api';

interface CapiWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingSettings: CapiSettingsRecord | null;
  userAccountId: string;
  accountId: string | null;
  amocrmConnected: boolean;
  bitrix24Connected: boolean;
  availableChannels: CapiChannel[];
  onComplete: () => void;
}

const CHANNEL_OPTIONS: { value: CapiChannel; label: string; icon: React.ReactNode; description: string }[] = [
  { value: 'whatsapp', label: 'WhatsApp', icon: <MessageCircle className="h-5 w-5" />, description: 'Конверсии из переписок в WhatsApp' },
  { value: 'lead_forms', label: 'Lead Forms', icon: <FileText className="h-5 w-5" />, description: 'Конверсии из лид-форм Meta' },
  { value: 'site', label: 'Сайт', icon: <Globe className="h-5 w-5" />, description: 'Конверсии из вашего сайта' },
];

type ConfigMode = 'fields' | 'stages';

const CapiWizard: React.FC<CapiWizardProps> = ({
  open,
  onOpenChange,
  editingSettings,
  userAccountId,
  accountId,
  amocrmConnected,
  bitrix24Connected,
  availableChannels,
  onComplete,
}) => {
  const isEditing = !!editingSettings;
  const hasCrm = amocrmConnected || bitrix24Connected;

  // Step tracking
  const [step, setStep] = useState(1);

  // Step 1: Channel
  const [channel, setChannel] = useState<CapiChannel | null>(editingSettings?.channel || null);

  // Step 2: Source
  const [source, setSource] = useState<CapiSource>(editingSettings?.capi_source || 'whatsapp');

  // Step 3: Pixel + Token
  const [pixelId, setPixelId] = useState(editingSettings?.pixel_id || '');
  const [accessToken, setAccessToken] = useState(editingSettings?.capi_access_token || '');

  // Step 4: Configuration
  // AI mode
  const [aiL2Description, setAiL2Description] = useState(editingSettings?.ai_l2_description || '');
  const [aiL3Description, setAiL3Description] = useState(editingSettings?.ai_l3_description || '');
  const [aiGeneratedPrompt, setAiGeneratedPrompt] = useState(editingSettings?.ai_generated_prompt || '');

  // CRM mode
  const [crmType, setCrmType] = useState<CrmType>(editingSettings?.capi_crm_type || (amocrmConnected ? 'amocrm' : 'bitrix24'));
  const [configMode, setConfigMode] = useState<ConfigMode>('fields');

  // CRM fields
  const [crmFields, setCrmFields] = useState<(AmocrmCustomField | Bitrix24CustomField)[]>([]);
  const [isLoadingCrmFields, setIsLoadingCrmFields] = useState(false);
  const [crmStages, setCrmStages] = useState<CrmStageOption[]>([]);
  const [isLoadingCrmStages, setIsLoadingCrmStages] = useState(false);

  // L1 Interest
  const [interestFields, setInterestFields] = useState<SelectedCapiField[]>([{ fieldId: null, enumId: null }]);
  const [interestStages, setInterestStages] = useState<SelectedCapiStage[]>([{ stageKey: null }]);
  // L2 Qualified
  const [qualifiedFields, setQualifiedFields] = useState<SelectedCapiField[]>([{ fieldId: null, enumId: null }]);
  const [qualifiedStages, setQualifiedStages] = useState<SelectedCapiStage[]>([{ stageKey: null }]);
  // L3 Scheduled
  const [scheduledFields, setScheduledFields] = useState<SelectedCapiField[]>([{ fieldId: null, enumId: null }]);
  const [scheduledStages, setScheduledStages] = useState<SelectedCapiStage[]>([{ stageKey: null }]);

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Initialize from editingSettings
  useEffect(() => {
    if (editingSettings) {
      setChannel(editingSettings.channel);
      setSource(editingSettings.capi_source);
      setPixelId(editingSettings.pixel_id);
      setAccessToken(editingSettings.capi_access_token || '');
      setAiL2Description(editingSettings.ai_l2_description || '');
      setAiL3Description(editingSettings.ai_l3_description || '');
      setAiGeneratedPrompt(editingSettings.ai_generated_prompt || '');
      if (editingSettings.capi_crm_type) setCrmType(editingSettings.capi_crm_type);

      // Restore CRM field/stage selections from saved config
      // Pass crmType explicitly to avoid stale closure (setState is async)
      const effectiveCrmType = editingSettings.capi_crm_type || (amocrmConnected ? 'amocrm' : 'bitrix24');
      restoreFieldsFromConfig(editingSettings.capi_interest_fields, setInterestFields, setInterestStages, effectiveCrmType);
      restoreFieldsFromConfig(editingSettings.capi_qualified_fields, setQualifiedFields, setQualifiedStages, effectiveCrmType);
      restoreFieldsFromConfig(editingSettings.capi_scheduled_fields, setScheduledFields, setScheduledStages, effectiveCrmType);

      // Start at step 2 for editing (skip channel — it can't change)
      // Step 2 = source (if needsSourceStep) or pixel (otherwise)
      setStep(2);
    }
  }, [editingSettings]);

  function restoreFieldsFromConfig(
    configs: CapiFieldConfig[],
    setFields: React.Dispatch<React.SetStateAction<SelectedCapiField[]>>,
    setStages: React.Dispatch<React.SetStateAction<SelectedCapiStage[]>>,
    effectiveCrmType: CrmType
  ) {
    if (!configs || configs.length === 0) return;

    // Check if configs contain pipeline stages
    const hasStages = configs.some(c => c.pipeline_id != null);
    if (hasStages) {
      setConfigMode('stages');
      setStages(configs.map(c => ({
        stageKey: c.pipeline_id != null
          ? `${effectiveCrmType}:${c.entity_type || 'lead'}:${c.pipeline_id}:${c.status_id}`
          : null,
      })));
    } else {
      setConfigMode('fields');
      setFields(configs.map(c => ({
        fieldId: c.field_id,
        enumId: c.enum_id || null,
      })));
    }
  }

  // Determine which steps to show
  const isWhatsApp = channel === 'whatsapp';
  const isCrmSource = source === 'crm';
  const needsSourceStep = isWhatsApp && hasCrm; // Only WhatsApp has source choice
  const totalSteps = needsSourceStep ? 4 : 3;

  // Auto-set source for non-whatsapp channels (always CRM)
  useEffect(() => {
    if (channel && channel !== 'whatsapp') {
      setSource('crm');
    }
  }, [channel]);

  // Load CRM fields when needed
  useEffect(() => {
    if (!isCrmSource || step < (needsSourceStep ? 4 : 3)) return;

    const loadFields = async () => {
      setIsLoadingCrmFields(true);
      try {
        if (crmType === 'amocrm') {
          const response = await getAmocrmFields(userAccountId);
          setCrmFields(response.fields || []);
        } else {
          const [leadResp, dealResp] = await Promise.all([
            getBitrix24LeadCustomFields(userAccountId).catch(() => ({ fields: [] as Bitrix24CustomField[] })),
            getBitrix24DealCustomFields(userAccountId).catch(() => ({ fields: [] as Bitrix24CustomField[] })),
          ]);
          const leadFields = ((leadResp as any).fields || []).map((f: any) => ({ ...f, _entityType: 'lead' as const }));
          const dealFields = ((dealResp as any).fields || []).map((f: any) => ({ ...f, _entityType: 'deal' as const }));
          setCrmFields([...leadFields, ...dealFields]);
        }
      } catch (err) {
        console.error('Failed to load CRM fields:', err);
        setCrmFields([]);
      } finally {
        setIsLoadingCrmFields(false);
      }
    };

    loadFields();
  }, [isCrmSource, crmType, userAccountId, step, needsSourceStep]);

  // Load CRM stages when needed
  useEffect(() => {
    if (!isCrmSource || step < (needsSourceStep ? 4 : 3)) return;

    const loadStages = async () => {
      setIsLoadingCrmStages(true);
      try {
        if (crmType === 'amocrm') {
          const pipelines = await getAmocrmPipelines(userAccountId, accountId || undefined) as AmocrmPipeline[];
          const opts: CrmStageOption[] = [];
          for (const p of pipelines || []) {
            for (const s of p.stages || []) {
              opts.push({
                key: `amocrm:lead:${p.pipeline_id}:${s.status_id}`,
                label: `${p.pipeline_name} → ${s.status_name}`,
                entityType: 'lead',
                pipelineId: p.pipeline_id,
                statusId: s.status_id,
              });
            }
          }
          setCrmStages(opts);
        } else {
          const pipelines = await getBitrix24Pipelines(userAccountId, accountId || undefined) as Bitrix24Pipelines;
          const opts: CrmStageOption[] = [];
          for (const lp of pipelines.leads || []) {
            for (const s of lp.stages || []) {
              opts.push({
                key: `bitrix24:lead:${lp.categoryId}:${s.statusId}`,
                label: `Лиды / ${lp.categoryName} → ${s.statusName}`,
                entityType: 'lead',
                pipelineId: lp.categoryId,
                statusId: s.statusId,
              });
            }
          }
          for (const dp of pipelines.deals || []) {
            for (const s of dp.stages || []) {
              opts.push({
                key: `bitrix24:deal:${dp.categoryId}:${s.statusId}`,
                label: `Сделки / ${dp.categoryName} → ${s.statusName}`,
                entityType: 'deal',
                pipelineId: dp.categoryId,
                statusId: s.statusId,
              });
            }
          }
          setCrmStages(opts);
        }
      } catch (err) {
        console.error('Failed to load CRM stages:', err);
        setCrmStages([]);
      } finally {
        setIsLoadingCrmStages(false);
      }
    };

    loadStages();
  }, [isCrmSource, crmType, userAccountId, accountId, step, needsSourceStep]);

  // CRM field helpers
  const getFieldById = (fieldId: string | number | null) => {
    if (!fieldId) return undefined;
    return crmFields.find(f => {
      if (crmType === 'amocrm') return (f as AmocrmCustomField).field_id === fieldId;
      return (f as Bitrix24CustomField).id === fieldId;
    });
  };

  const getFieldId = (field: AmocrmCustomField | Bitrix24CustomField): string | number => {
    if (crmType === 'amocrm') return (field as AmocrmCustomField).field_id;
    return (field as Bitrix24CustomField).id;
  };

  const getFieldName = (field: AmocrmCustomField | Bitrix24CustomField): string => {
    if (crmType === 'amocrm') return (field as AmocrmCustomField).field_name;
    return (field as Bitrix24CustomField).label || (field as Bitrix24CustomField).fieldName;
  };

  const getFieldType = (field: AmocrmCustomField | Bitrix24CustomField): string => {
    if (crmType === 'amocrm') return (field as AmocrmCustomField).field_type;
    return (field as Bitrix24CustomField).userTypeId;
  };

  const getFieldEnums = (field: AmocrmCustomField | Bitrix24CustomField) => {
    if (crmType === 'amocrm') return (field as AmocrmCustomField).enums || [];
    return (field as Bitrix24CustomField).list || [];
  };

  const isSelectType = (field: AmocrmCustomField | Bitrix24CustomField | null): boolean => {
    if (!field) return false;
    const ft = getFieldType(field);
    return ['select', 'multiselect', 'radiobutton', 'enumeration', 'checkbox', 'boolean'].includes(ft);
  };

  const needsEnumSelection = (field: AmocrmCustomField | Bitrix24CustomField | null): boolean => {
    if (!field) return false;
    const enums = getFieldEnums(field);
    return isSelectType(field) && enums.length > 0;
  };

  // Convert selected fields/stages to CapiFieldConfig[]
  const convertFieldsToConfig = (fields: SelectedCapiField[]): CapiFieldConfig[] => {
    return fields
      .filter(sf => sf.fieldId !== null)
      .map(sf => {
        const field = getFieldById(sf.fieldId);
        if (!field) return null;
        const enums = getFieldEnums(field);
        let enumValue: string | null = null;
        if (sf.enumId) {
          const selectedEnum = enums.find((e: any) =>
            crmType === 'amocrm' ? e.id === sf.enumId : e.id === sf.enumId
          );
          enumValue = selectedEnum ? (selectedEnum as any).value : null;
        }
        return {
          field_id: getFieldId(field),
          field_name: getFieldName(field),
          field_type: getFieldType(field),
          enum_id: sf.enumId,
          enum_value: enumValue,
          ...(crmType === 'bitrix24' && { entity_type: (field as any)._entityType || 'lead' }),
        };
      })
      .filter(Boolean) as CapiFieldConfig[];
  };

  const convertStagesToConfig = (stages: SelectedCapiStage[]): CapiFieldConfig[] => {
    return stages
      .filter(s => s.stageKey !== null)
      .map(s => {
        const stage = crmStages.find(st => st.key === s.stageKey);
        if (!stage) return null;
        return {
          field_id: `stage:${stage.pipelineId}:${stage.statusId}`,
          field_name: stage.label,
          field_type: 'pipeline_stage',
          entity_type: stage.entityType,
          pipeline_id: stage.pipelineId,
          status_id: stage.statusId,
        };
      })
      .filter(Boolean) as CapiFieldConfig[];
  };

  const handleSubmit = async () => {
    if (!channel || !pixelId.trim()) {
      toast.error('Заполните обязательные поля');
      return;
    }

    setIsSubmitting(true);
    try {
      // Auto-generate AI prompt in background if source is AI and descriptions provided
      let generatedPrompt = aiGeneratedPrompt;
      if (!isCrmSource && (aiL2Description.trim() || aiL3Description.trim())) {
        try {
          generatedPrompt = await capiSettingsApi.generatePrompt(aiL2Description, aiL3Description);
        } catch (err) {
          console.warn('Failed to generate AI prompt, saving without it:', err);
        }
      }

      const interestConfig = isCrmSource
        ? (configMode === 'stages' ? convertStagesToConfig(interestStages) : convertFieldsToConfig(interestFields))
        : [];
      const qualifiedConfig = isCrmSource
        ? (configMode === 'stages' ? convertStagesToConfig(qualifiedStages) : convertFieldsToConfig(qualifiedFields))
        : [];
      const scheduledConfig = isCrmSource
        ? (configMode === 'stages' ? convertStagesToConfig(scheduledStages) : convertFieldsToConfig(scheduledFields))
        : [];

      if (isEditing && editingSettings) {
        await capiSettingsApi.update(editingSettings.id, {
          pixel_id: pixelId.trim(),
          capi_access_token: accessToken.trim() || null,
          capi_source: source,
          capi_crm_type: isCrmSource ? crmType : null,
          capi_interest_fields: interestConfig,
          capi_qualified_fields: qualifiedConfig,
          capi_scheduled_fields: scheduledConfig,
          ai_l2_description: !isCrmSource ? aiL2Description || null : null,
          ai_l3_description: !isCrmSource ? aiL3Description || null : null,
          ai_generated_prompt: !isCrmSource ? generatedPrompt || null : null,
        });
        toast.success('Настройки CAPI обновлены');
      } else {
        await capiSettingsApi.create({
          userAccountId,
          accountId: accountId || null,
          channel,
          pixel_id: pixelId.trim(),
          capi_access_token: accessToken.trim() || null,
          capi_source: source,
          capi_crm_type: isCrmSource ? crmType : null,
          capi_interest_fields: interestConfig,
          capi_qualified_fields: qualifiedConfig,
          capi_scheduled_fields: scheduledConfig,
          ai_l2_description: !isCrmSource ? aiL2Description || null : null,
          ai_l3_description: !isCrmSource ? aiL3Description || null : null,
          ai_generated_prompt: !isCrmSource ? generatedPrompt || null : null,
        });
        toast.success('CAPI настройки созданы');
      }
      onComplete();
    } catch (err: any) {
      toast.error(err.message || 'Ошибка сохранения');
    } finally {
      setIsSubmitting(false);
    }
  };

  const canGoNext = (): boolean => {
    if (step === 1) return !!channel;
    if (step === 2 && needsSourceStep) return true;
    // Pixel step
    const pixelStep = needsSourceStep ? 3 : 2;
    if (step === pixelStep) return !!pixelId.trim();
    return true;
  };

  const getStepTitle = (): string => {
    if (step === 1) return 'Выберите канал';
    if (needsSourceStep && step === 2) return 'Источник данных';
    const pixelStep = needsSourceStep ? 3 : 2;
    if (step === pixelStep) return 'Pixel и Access Token';
    return isCrmSource ? 'Настройка CRM маппингов' : 'Настройка AI анализа';
  };

  const getEffectiveStep = (): 'channel' | 'source' | 'pixel' | 'config' => {
    if (step === 1) return 'channel';
    if (needsSourceStep && step === 2) return 'source';
    const pixelStep = needsSourceStep ? 3 : 2;
    if (step === pixelStep) return 'pixel';
    return 'config';
  };

  const effectiveStep = getEffectiveStep();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Редактирование' : 'Новый канал'} CAPI</DialogTitle>
          <DialogDescription>
            Шаг {step} из {totalSteps}: {getStepTitle()}
          </DialogDescription>
        </DialogHeader>

        <div className="py-2 space-y-4">
          {/* Step 1: Channel selection */}
          {effectiveStep === 'channel' && (
            <div className="space-y-3">
              {CHANNEL_OPTIONS.filter(opt => availableChannels.includes(opt.value)).map((opt) => {
                const needsCrm = opt.value !== 'whatsapp';
                const disabled = needsCrm && !hasCrm;

                return (
                  <div
                    key={opt.value}
                    className={`border rounded-lg p-4 cursor-pointer transition-all ${
                      channel === opt.value
                        ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                        : disabled
                          ? 'opacity-50 cursor-not-allowed'
                          : 'border-muted hover:border-indigo-300'
                    }`}
                    onClick={() => !disabled && setChannel(opt.value)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="text-indigo-600">{opt.icon}</div>
                      <div>
                        <div className="font-medium text-sm">{opt.label}</div>
                        <div className="text-xs text-muted-foreground">{opt.description}</div>
                        {disabled && (
                          <div className="text-xs text-orange-600 mt-1 flex items-center gap-1">
                            <Info className="h-3 w-3" />
                            Сначала подключите CRM (AmoCRM или Bitrix24)
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {availableChannels.length === 0 && (
                <div className="text-center py-4 text-muted-foreground text-sm">
                  Все каналы уже настроены
                </div>
              )}
            </div>
          )}

          {/* Step 2: Source (WhatsApp only) */}
          {effectiveStep === 'source' && (
            <RadioGroup value={source} onValueChange={(v) => setSource(v as CapiSource)}>
              <div className="space-y-3">
                <div className={`border rounded-lg p-4 cursor-pointer transition-all ${source === 'whatsapp' ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20' : 'border-muted'}`}>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <RadioGroupItem value="whatsapp" className="mt-0.5" />
                    <div>
                      <div className="font-medium text-sm">AI анализ переписок</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        AI анализирует каждый диалог в WhatsApp и определяет уровень квалификации лида
                      </div>
                    </div>
                  </label>
                </div>

                <div className={`border rounded-lg p-4 cursor-pointer transition-all ${source === 'crm' ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20' : hasCrm ? 'border-muted' : 'opacity-50'}`}>
                  <label className={`flex items-start gap-3 ${hasCrm ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
                    <RadioGroupItem value="crm" disabled={!hasCrm} className="mt-0.5" />
                    <div>
                      <div className="font-medium text-sm">CRM</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Конверсии отправляются на основе изменений полей или этапов воронки в CRM
                      </div>
                      {!hasCrm && (
                        <div className="text-xs text-orange-600 mt-1 flex items-center gap-1">
                          <Info className="h-3 w-3" />
                          Подключите CRM для использования этого режима
                        </div>
                      )}
                    </div>
                  </label>
                </div>
              </div>
            </RadioGroup>
          )}

          {/* Pixel + Token step */}
          {effectiveStep === 'pixel' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pixel_id">Pixel / Dataset ID *</Label>
                <Input
                  id="pixel_id"
                  value={pixelId}
                  onChange={(e) => setPixelId(e.target.value)}
                  placeholder="Например: 123456789012345"
                />
                <p className="text-xs text-muted-foreground">
                  ID пикселя или датасета из Meta Events Manager
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="access_token">Access Token (необязательно)</Label>
                <Input
                  id="access_token"
                  type="password"
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  placeholder="Pixel-specific access token"
                />
                <p className="text-xs text-muted-foreground">
                  Если не указан, будет использован токен из подключения Facebook
                </p>
              </div>
            </div>
          )}

          {/* Configuration step */}
          {effectiveStep === 'config' && !isCrmSource && (
            /* AI source config (WhatsApp) */
            <div className="space-y-4">
              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-xs text-blue-700 dark:text-blue-300 flex items-start gap-2">
                <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>
                  <strong>L1 (Contact)</strong> определяется автоматически: 3+ сообщений в диалоге.
                  Опишите ниже критерии для L2 и L3 уровней.
                </span>
              </div>

              <div className="space-y-2">
                <Label>L2 (Schedule): кого считать квалифицированным?</Label>
                <Textarea
                  value={aiL2Description}
                  onChange={(e) => setAiL2Description(e.target.value)}
                  placeholder="Например: клиент обсудил конкретную услугу, задал вопросы о ценах, выразил намерение записаться..."
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label>L3 (StartTrial): как понять что клиент записался?</Label>
                <Textarea
                  value={aiL3Description}
                  onChange={(e) => setAiL3Description(e.target.value)}
                  placeholder="Например: клиент подтвердил дату и время визита, оставил контактные данные для записи..."
                  rows={3}
                />
              </div>

              <p className="text-xs text-muted-foreground">
                AI промпт будет сгенерирован автоматически при сохранении
              </p>
            </div>
          )}

          {effectiveStep === 'config' && isCrmSource && (
            /* CRM source config */
            <div className="space-y-4">
              {/* CRM type selection (if both connected) */}
              {amocrmConnected && bitrix24Connected && (
                <div className="space-y-2">
                  <Label>CRM система</Label>
                  <RadioGroup value={crmType} onValueChange={(v) => setCrmType(v as CrmType)} className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <RadioGroupItem value="amocrm" />
                      <span className="text-sm">AmoCRM</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <RadioGroupItem value="bitrix24" />
                      <span className="text-sm">Bitrix24</span>
                    </label>
                  </RadioGroup>
                </div>
              )}

              {/* Config mode toggle */}
              <div className="space-y-2">
                <Label>Режим маппинга</Label>
                <RadioGroup value={configMode} onValueChange={(v) => setConfigMode(v as ConfigMode)} className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <RadioGroupItem value="fields" />
                    <span className="text-sm">По полям CRM</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <RadioGroupItem value="stages" />
                    <span className="text-sm">По этапам воронки</span>
                  </label>
                </RadioGroup>
              </div>

              {(isLoadingCrmFields || isLoadingCrmStages) ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  <span className="text-sm">Загрузка полей CRM...</span>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* L1 Interest */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">L1 — Contact (интерес)</Label>
                    <p className="text-xs text-muted-foreground">Когда контакт попал в CRM</p>
                    {configMode === 'fields' ? (
                      <CrmFieldSelector
                        fields={crmFields}
                        selectedFields={interestFields}
                        setSelectedFields={setInterestFields}
                        crmType={crmType as CrmFieldCrmType}
                        isSubmitting={isSubmitting}
                        getFieldById={getFieldById}
                        getFieldId={getFieldId}
                        getFieldName={getFieldName}
                        getFieldType={getFieldType}
                        getFieldEnums={getFieldEnums}
                        needsEnumSelection={needsEnumSelection}
                      />
                    ) : (
                      <CrmStageSelector
                        stages={crmStages}
                        selectedStages={interestStages}
                        setSelectedStages={setInterestStages}
                        isSubmitting={isSubmitting}
                      />
                    )}
                  </div>

                  {/* L2 Qualified */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">L2 — Schedule (квалификация)</Label>
                    <p className="text-xs text-muted-foreground">Когда клиент квалифицирован</p>
                    {configMode === 'fields' ? (
                      <CrmFieldSelector
                        fields={crmFields}
                        selectedFields={qualifiedFields}
                        setSelectedFields={setQualifiedFields}
                        crmType={crmType as CrmFieldCrmType}
                        isSubmitting={isSubmitting}
                        getFieldById={getFieldById}
                        getFieldId={getFieldId}
                        getFieldName={getFieldName}
                        getFieldType={getFieldType}
                        getFieldEnums={getFieldEnums}
                        needsEnumSelection={needsEnumSelection}
                      />
                    ) : (
                      <CrmStageSelector
                        stages={crmStages}
                        selectedStages={qualifiedStages}
                        setSelectedStages={setQualifiedStages}
                        isSubmitting={isSubmitting}
                      />
                    )}
                  </div>

                  {/* L3 Scheduled */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">L3 — StartTrial (запись/покупка)</Label>
                    <p className="text-xs text-muted-foreground">Когда клиент записался или совершил покупку</p>
                    {configMode === 'fields' ? (
                      <CrmFieldSelector
                        fields={crmFields}
                        selectedFields={scheduledFields}
                        setSelectedFields={setScheduledFields}
                        crmType={crmType as CrmFieldCrmType}
                        isSubmitting={isSubmitting}
                        getFieldById={getFieldById}
                        getFieldId={getFieldId}
                        getFieldName={getFieldName}
                        getFieldType={getFieldType}
                        getFieldEnums={getFieldEnums}
                        needsEnumSelection={needsEnumSelection}
                      />
                    ) : (
                      <CrmStageSelector
                        stages={crmStages}
                        selectedStages={scheduledStages}
                        setSelectedStages={setScheduledStages}
                        isSubmitting={isSubmitting}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="flex justify-between pt-2">
          <Button
            variant="outline"
            onClick={() => {
              if (step === 1 || (isEditing && step === 2)) {
                onOpenChange(false);
              } else {
                setStep(step - 1);
              }
            }}
            disabled={isSubmitting}
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            {step === 1 || (isEditing && step === 2) ? 'Отмена' : 'Назад'}
          </Button>

          {step < totalSteps ? (
            <Button
              onClick={() => setStep(step + 1)}
              disabled={!canGoNext()}
            >
              Далее
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting || !canGoNext()}
            >
              {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isEditing ? 'Сохранить' : 'Создать'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CapiWizard;
