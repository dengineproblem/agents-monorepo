import { randomUUID } from 'crypto';
import { FastifyInstance } from 'fastify';
import { supabase } from './supabase.js';

const CHATBOT_SERVICE_URL = process.env.CHATBOT_SERVICE_URL || 'http://chatbot-service:8083';

export interface CapiFieldConfig {
  field_id?: string | number | null;
  field_name?: string | null;
  field_type?: string | null;
  enum_id?: string | number | null;
  enum_value?: string | null;
  entity_type?: string | null;
  pipeline_id?: string | number | null;
  status_id?: string | number | null;
}

export interface DirectionCapiSettings {
  directionId: string;
  capiEnabled: boolean;
  capiSource: 'whatsapp' | 'crm' | null;
  capiCrmType: 'amocrm' | 'bitrix24' | null;
  interestFields: CapiFieldConfig[];
  qualifiedFields: CapiFieldConfig[];
  scheduledFields: CapiFieldConfig[];
}

export interface CapiLevelMatches {
  interest: boolean;
  qualified: boolean;
  scheduled: boolean;
}

type CapiMatchType = 'stage' | 'field' | 'none';

export interface CapiLevelMatchDiagnostics {
  matched: boolean;
  matchType: CapiMatchType;
  reason:
    | 'matched_stage'
    | 'matched_field'
    | 'no_configs'
    | 'no_stage_match'
    | 'no_custom_field_configs'
    | 'no_custom_fields_payload'
    | 'no_field_match';
  matchedConfig: Record<string, unknown> | null;
}

export interface CapiEvaluationDiagnostics {
  interest: CapiLevelMatchDiagnostics;
  qualified: CapiLevelMatchDiagnostics;
  scheduled: CapiLevelMatchDiagnostics;
}

export interface CapiLevelEvaluation {
  levels: CapiLevelMatches;
  diagnostics: CapiEvaluationDiagnostics;
}

export interface CapiLevelConfigSummary {
  total: number;
  stage: number;
  field: number;
}

export interface DirectionCapiSettingsSummary {
  directionId: string;
  capiEnabled: boolean;
  capiSource: 'whatsapp' | 'crm' | null;
  capiCrmType: 'amocrm' | 'bitrix24' | null;
  interest: CapiLevelConfigSummary;
  qualified: CapiLevelConfigSummary;
  scheduled: CapiLevelConfigSummary;
}

function normalizeFieldConfigs(value: unknown): CapiFieldConfig[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((field): field is Record<string, unknown> => !!field && typeof field === 'object')
    .map((field) => {
      const normalized: CapiFieldConfig = {
        field_id: (field.field_id as string | number | null) ?? null,
        field_name: (field.field_name as string | null) ?? null,
        field_type: (field.field_type as string | null) ?? null,
        enum_id: (field.enum_id as string | number | null) ?? null,
        enum_value: (field.enum_value as string | null) ?? null,
        entity_type: (field.entity_type as string | null) ?? null,
        pipeline_id: (field.pipeline_id as string | number | null) ?? null,
        status_id: (field.status_id as string | number | null) ?? null,
      };
      return normalized;
    })
    .filter((config) => {
      if (isStageConfig(config)) {
        return !!normalizeEnumId(config.status_id);
      }
      const fieldId = normalizeEnumId(config.field_id);
      return !!fieldId;
    });
}

function normalizeEnumId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeFieldType(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function toConfigDiagnostics(config: CapiFieldConfig): Record<string, unknown> {
  return {
    field_id: config.field_id ?? null,
    field_name: config.field_name ?? null,
    field_type: normalizeFieldType(config.field_type) || null,
    enum_id: config.enum_id ?? null,
    enum_value: config.enum_value ?? null,
    entity_type: config.entity_type ?? null,
    pipeline_id: config.pipeline_id ?? null,
    status_id: config.status_id ?? null,
  };
}

function isTruthyValue(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value !== 'string') return false;

  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'y' || normalized === 'yes' || normalized === 'true';
}

function stringEquals(left: unknown, right: unknown): boolean {
  if (left === null || left === undefined || right === null || right === undefined) {
    return false;
  }

  return String(left).trim().toLowerCase() === String(right).trim().toLowerCase();
}

function isStageConfig(config: CapiFieldConfig): boolean {
  const fieldType = String(config.field_type || '').trim().toLowerCase();
  return fieldType === 'pipeline_stage' || fieldType === 'stage';
}

function matchesAmoStageConfig(amocrmLead: any, config: CapiFieldConfig): boolean {
  const configStatusId = normalizeEnumId(config.status_id);
  const configPipelineId = normalizeEnumId(config.pipeline_id);
  const leadStatusId = normalizeEnumId(amocrmLead?.status_id);

  if (!configStatusId || !leadStatusId || leadStatusId !== configStatusId) {
    return false;
  }

  if (!configPipelineId) {
    return true;
  }

  const leadPipelineId = normalizeEnumId(amocrmLead?.pipeline_id);
  return !!leadPipelineId && leadPipelineId === configPipelineId;
}

function matchesAmoFieldConfig(allCustomFields: any[], config: CapiFieldConfig): boolean {
  if (!config.field_id) return false;

  const configFieldId = String(config.field_id);
  const fieldType = normalizeFieldType(config.field_type);
  const field = allCustomFields.find((item) => String(item?.field_id) === configFieldId);

  if (!field || !Array.isArray(field.values) || field.values.length === 0) {
    return false;
  }

  const enumId = normalizeEnumId(config.enum_id);

  for (const value of field.values) {
    if ((fieldType === 'select' || fieldType === 'multiselect') && enumId) {
      if (normalizeEnumId(value?.enum_id) === enumId) {
        return true;
      }
      continue;
    }

    if (fieldType === 'checkbox' || fieldType === 'boolean') {
      if (isTruthyValue(value?.value)) {
        return true;
      }
      continue;
    }

    if (config.enum_value && stringEquals(value?.value, config.enum_value)) {
      return true;
    }
  }

  return false;
}

function collectAmoCustomFields(amocrmLead: any): any[] {
  const allCustomFields: any[] = [];

  if (Array.isArray(amocrmLead?.custom_fields_values)) {
    allCustomFields.push(...amocrmLead.custom_fields_values);
  }

  const contacts = amocrmLead?._embedded?.contacts || [];
  for (const contact of contacts) {
    if (Array.isArray(contact?.custom_fields_values)) {
      allCustomFields.push(...contact.custom_fields_values);
    }
  }

  return allCustomFields;
}

function matchesBitrixFieldConfig(entity: any, config: CapiFieldConfig): boolean {
  const candidateKeys = new Set<string>();
  if (config.field_name) candidateKeys.add(String(config.field_name));
  if (config.field_id) candidateKeys.add(String(config.field_id));
  const fieldType = normalizeFieldType(config.field_type);

  const values: unknown[] = [];
  for (const key of candidateKeys) {
    if (!key) continue;
    if (!(key in entity)) continue;
    const raw = entity[key];
    if (Array.isArray(raw)) {
      values.push(...raw);
    } else {
      values.push(raw);
    }
  }

  if (values.length === 0) {
    return false;
  }

  const enumId = normalizeEnumId(config.enum_id);
  const isEnum = fieldType === 'enumeration' || fieldType === 'select' || fieldType === 'multiselect';

  if (isEnum && enumId) {
    return values.some((value) => normalizeEnumId(value) === enumId);
  }

  if (fieldType === 'boolean' || fieldType === 'checkbox') {
    return values.some((value) => isTruthyValue(value));
  }

  if (config.enum_value) {
    return values.some((value) => stringEquals(value, config.enum_value));
  }

  return false;
}

function matchesBitrixStageConfig(entity: any, config: CapiFieldConfig): boolean {
  const configStatusId = normalizeEnumId(config.status_id);
  const configPipelineId = normalizeEnumId(config.pipeline_id);
  const entityType = String(config.entity_type || '').trim().toLowerCase();

  if (!configStatusId) {
    return false;
  }

  const leadStatusId = normalizeEnumId(entity?.STATUS_ID);
  const dealStatusId = normalizeEnumId(entity?.STAGE_ID);
  const leadPipelineId = '0';
  const dealPipelineId = normalizeEnumId(entity?.CATEGORY_ID) || '0';

  if (entityType === 'lead') {
    if (!leadStatusId || leadStatusId !== configStatusId) {
      return false;
    }
    return !configPipelineId || configPipelineId === leadPipelineId;
  }

  if (entityType === 'deal') {
    if (!dealStatusId || dealStatusId !== configStatusId) {
      return false;
    }
    return !configPipelineId || configPipelineId === dealPipelineId;
  }

  // Backward-compatible fallback when entity_type is missing:
  // detect by payload shape and match whichever stage attributes are available.
  if (dealStatusId && dealStatusId === configStatusId) {
    return !configPipelineId || configPipelineId === dealPipelineId;
  }

  if (leadStatusId && leadStatusId === configStatusId) {
    return !configPipelineId || configPipelineId === leadPipelineId;
  }

  return false;
}

function evaluateAmoLevelWithDiagnostics(amocrmLead: any, fields: CapiFieldConfig[]): CapiLevelMatchDiagnostics {
  if (fields.length === 0) {
    return { matched: false, matchType: 'none', reason: 'no_configs', matchedConfig: null };
  }

  const stageConfigs = fields.filter((config) => isStageConfig(config));
  for (const config of stageConfigs) {
    if (matchesAmoStageConfig(amocrmLead, config)) {
      return {
        matched: true,
        matchType: 'stage',
        reason: 'matched_stage',
        matchedConfig: toConfigDiagnostics(config),
      };
    }
  }

  const customFieldConfigs = fields.filter((config) => !isStageConfig(config));
  if (customFieldConfigs.length === 0) {
    return {
      matched: false,
      matchType: 'none',
      reason: stageConfigs.length > 0 ? 'no_stage_match' : 'no_custom_field_configs',
      matchedConfig: null,
    };
  }

  const allCustomFields = collectAmoCustomFields(amocrmLead);
  if (allCustomFields.length === 0) {
    return {
      matched: false,
      matchType: 'none',
      reason: 'no_custom_fields_payload',
      matchedConfig: null,
    };
  }

  for (const config of customFieldConfigs) {
    if (matchesAmoFieldConfig(allCustomFields, config)) {
      return {
        matched: true,
        matchType: 'field',
        reason: 'matched_field',
        matchedConfig: toConfigDiagnostics(config),
      };
    }
  }

  return {
    matched: false,
    matchType: 'none',
    reason: 'no_field_match',
    matchedConfig: null,
  };
}

function evaluateBitrixLevelWithDiagnostics(entity: any, fields: CapiFieldConfig[]): CapiLevelMatchDiagnostics {
  if (fields.length === 0) {
    return { matched: false, matchType: 'none', reason: 'no_configs', matchedConfig: null };
  }

  const stageConfigs = fields.filter((config) => isStageConfig(config));
  for (const config of stageConfigs) {
    if (matchesBitrixStageConfig(entity, config)) {
      return {
        matched: true,
        matchType: 'stage',
        reason: 'matched_stage',
        matchedConfig: toConfigDiagnostics(config),
      };
    }
  }

  const customFieldConfigs = fields.filter((config) => !isStageConfig(config));
  if (customFieldConfigs.length === 0) {
    return {
      matched: false,
      matchType: 'none',
      reason: stageConfigs.length > 0 ? 'no_stage_match' : 'no_custom_field_configs',
      matchedConfig: null,
    };
  }

  for (const config of customFieldConfigs) {
    if (matchesBitrixFieldConfig(entity, config)) {
      return {
        matched: true,
        matchType: 'field',
        reason: 'matched_field',
        matchedConfig: toConfigDiagnostics(config),
      };
    }
  }

  return {
    matched: false,
    matchType: 'none',
    reason: 'no_field_match',
    matchedConfig: null,
  };
}

export async function getDirectionCapiSettings(directionId: string | null | undefined): Promise<DirectionCapiSettings | null> {
  if (!directionId) return null;

  const { data: direction, error } = await supabase
    .from('account_directions')
    .select(`
      id,
      capi_enabled,
      capi_source,
      capi_crm_type,
      capi_interest_fields,
      capi_qualified_fields,
      capi_scheduled_fields
    `)
    .eq('id', directionId)
    .maybeSingle();

  if (error || !direction) {
    return null;
  }

  return {
    directionId: direction.id,
    capiEnabled: !!direction.capi_enabled,
    capiSource: direction.capi_source === 'crm' || direction.capi_source === 'whatsapp'
      ? direction.capi_source
      : null,
    capiCrmType: direction.capi_crm_type === 'amocrm' || direction.capi_crm_type === 'bitrix24'
      ? direction.capi_crm_type
      : null,
    interestFields: normalizeFieldConfigs(direction.capi_interest_fields),
    qualifiedFields: normalizeFieldConfigs(direction.capi_qualified_fields),
    scheduledFields: normalizeFieldConfigs(direction.capi_scheduled_fields),
  };
}

export function evaluateAmoCapiLevels(
  amocrmLead: any,
  settings: DirectionCapiSettings
): CapiLevelMatches {
  return evaluateAmoCapiLevelsWithDiagnostics(amocrmLead, settings).levels;
}

export function evaluateBitrixCapiLevels(
  bitrixEntity: any,
  settings: DirectionCapiSettings
): CapiLevelMatches {
  return evaluateBitrixCapiLevelsWithDiagnostics(bitrixEntity, settings).levels;
}

function summarizeLevelConfigs(fields: CapiFieldConfig[]): CapiLevelConfigSummary {
  const stage = fields.filter((config) => isStageConfig(config)).length;
  const field = fields.length - stage;
  return {
    total: fields.length,
    stage,
    field,
  };
}

export function summarizeDirectionCapiSettings(settings: DirectionCapiSettings): DirectionCapiSettingsSummary {
  return {
    directionId: settings.directionId,
    capiEnabled: settings.capiEnabled,
    capiSource: settings.capiSource,
    capiCrmType: settings.capiCrmType,
    interest: summarizeLevelConfigs(settings.interestFields),
    qualified: summarizeLevelConfigs(settings.qualifiedFields),
    scheduled: summarizeLevelConfigs(settings.scheduledFields),
  };
}

export function evaluateAmoCapiLevelsWithDiagnostics(
  amocrmLead: any,
  settings: DirectionCapiSettings
): CapiLevelEvaluation {
  const interest = evaluateAmoLevelWithDiagnostics(amocrmLead, settings.interestFields);
  const qualified = evaluateAmoLevelWithDiagnostics(amocrmLead, settings.qualifiedFields);
  const scheduled = evaluateAmoLevelWithDiagnostics(amocrmLead, settings.scheduledFields);

  return {
    levels: {
      interest: interest.matched,
      qualified: qualified.matched,
      scheduled: scheduled.matched,
    },
    diagnostics: {
      interest,
      qualified,
      scheduled,
    },
  };
}

export function evaluateBitrixCapiLevelsWithDiagnostics(
  bitrixEntity: any,
  settings: DirectionCapiSettings
): CapiLevelEvaluation {
  const interest = evaluateBitrixLevelWithDiagnostics(bitrixEntity, settings.interestFields);
  const qualified = evaluateBitrixLevelWithDiagnostics(bitrixEntity, settings.qualifiedFields);
  const scheduled = evaluateBitrixLevelWithDiagnostics(bitrixEntity, settings.scheduledFields);

  return {
    levels: {
      interest: interest.matched,
      qualified: qualified.matched,
      scheduled: scheduled.matched,
    },
    diagnostics: {
      interest,
      qualified,
      scheduled,
    },
  };
}

export function normalizeContactPhoneForCapi(rawPhone: string | null | undefined): string | null {
  if (!rawPhone) return null;

  const cleaned = rawPhone
    .replace('@s.whatsapp.net', '')
    .replace('@c.us', '')
    .replace('@lid', '')
    .replace(/\D/g, '');

  if (!cleaned) return null;

  if (cleaned.length === 11 && cleaned.startsWith('8')) {
    return `7${cleaned.slice(1)}`;
  }

  return cleaned;
}

export async function sendCrmCapiLevels(params: {
  userAccountId: string;
  directionId: string;
  contactPhone: string;
  crmType: 'amocrm' | 'bitrix24';
  levels: CapiLevelMatches;
}, app: FastifyInstance): Promise<void> {
  const { userAccountId, directionId, contactPhone, crmType, levels } = params;

  if (!levels.interest && !levels.qualified && !levels.scheduled) {
    app.log.debug({ userAccountId, directionId, contactPhone, crmType }, 'CRM CAPI: no matched levels, skipping send');
    return;
  }

  const correlationId = randomUUID();

  try {
    const response = await fetch(`${CHATBOT_SERVICE_URL}/capi/crm-event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId
      },
      body: JSON.stringify({
        userAccountId,
        directionId,
        contactPhone,
        crmType,
        levels
      })
    });

    const responseData = await response.json().catch(() => null) as Record<string, unknown> | null;

    if (response.ok && responseData?.success !== false) {
      app.log.info({
        correlationId,
        userAccountId,
        directionId,
        contactPhone,
        crmType,
        levels
      }, 'CRM CAPI levels sent');
      return;
    }

    app.log.warn({
      correlationId,
      userAccountId,
      directionId,
      contactPhone,
      crmType,
      levels,
      status: response.status,
      responseData
    }, 'CRM CAPI send not confirmed');
  } catch (error: any) {
    app.log.error({
      correlationId,
      userAccountId,
      directionId,
      contactPhone,
      crmType,
      levels,
      error: error.message
    }, 'CRM CAPI send failed');
  }
}
