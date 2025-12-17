/**
 * AmoCRM API Client
 * 
 * Provides methods for interacting with AmoCRM integration endpoints
 */

import { API_BASE_URL } from '../config/api';

export interface FunnelStage {
  stage_name: string;
  pipeline_name: string;
  color: string;
  sort_order: number;
  count: number;
  percentage: number;
}

export interface FunnelStats {
  total_leads: number;
  stages: FunnelStage[];
}

export interface SyncResult {
  success: boolean;
  total: number;
  updated: number;
  errors: number;
  errorDetails?: Array<{ leadId: number; error: string }>;
}

export interface KeyStage {
  index: number; // 1, 2, or 3
  pipeline_id: number;
  status_id: number;
  pipeline_name: string;
  status_name: string;
  qualified_leads: number;
  qualification_rate: number;
  creative_stats: Array<{
    creative_id: string;
    creative_name: string;
    total: number;
    qualified: number;
    rate: number;
  }>;
}

export interface KeyStageStats {
  total_leads: number;
  key_stages: KeyStage[]; // Up to 3 key stages
}

export interface Pipeline {
  pipeline_id: number;
  pipeline_name: string;
  stages: Array<{
    status_id: number;
    status_name: string;
    status_color: string;
    sort_order: number;
  }>;
}

/**
 * Get funnel stage distribution for a specific creative
 *
 * @param params - Query parameters
 * @returns Funnel statistics
 */
export async function getCreativeFunnelStats(params: {
  userAccountId: string;
  creativeId: string;
  directionId?: string;
  dateFrom?: string;
  dateTo?: string;
  accountId?: string;
}): Promise<FunnelStats> {
  const queryParams = new URLSearchParams({
    userAccountId: params.userAccountId,
    creativeId: params.creativeId,
  });

  if (params.accountId) {
    queryParams.append('accountId', params.accountId);
  }

  if (params.directionId) {
    queryParams.append('directionId', params.directionId);
  }

  if (params.dateFrom) {
    queryParams.append('dateFrom', params.dateFrom);
  }

  if (params.dateTo) {
    queryParams.append('dateTo', params.dateTo);
  }

  const response = await fetch(
    `${API_BASE_URL}/amocrm/creative-funnel-stats?${queryParams.toString()}`
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to fetch funnel stats');
  }

  return response.json();
}

/**
 * Trigger manual leads synchronization from AmoCRM
 *
 * @param userAccountId - User account UUID
 * @param accountId - Optional ad_account UUID for multi-account mode
 * @returns Sync result
 */
export async function triggerLeadsSync(
  userAccountId: string,
  accountId?: string
): Promise<SyncResult> {
  const queryParams = new URLSearchParams({ userAccountId });

  if (accountId) {
    queryParams.append('accountId', accountId);
  }

  const response = await fetch(
    `${API_BASE_URL}/amocrm/sync-leads?${queryParams.toString()}`,
    {
      method: 'POST',
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to sync leads');
  }

  return response.json();
}

/**
 * Быстрая синхронизация лидов конкретного креатива из AmoCRM (с параллелизацией)
 *
 * @param userAccountId - User account UUID
 * @param creativeId - Creative UUID
 * @param accountId - Optional ad_account UUID for multi-account mode
 * @returns Sync result
 */
export async function triggerCreativeLeadsSync(
  userAccountId: string,
  creativeId: string,
  accountId?: string
): Promise<SyncResult> {
  const queryParams = new URLSearchParams({
    userAccountId,
    creativeId,
  });

  if (accountId) {
    queryParams.append('accountId', accountId);
  }

  const response = await fetch(
    `${API_BASE_URL}/amocrm/sync-creative-leads?${queryParams.toString()}`,
    {
      method: 'POST',
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to sync creative leads');
  }

  return response.json();
}

/**
 * Get all pipelines with their stages
 *
 * @param userAccountId - User account UUID
 * @param accountId - Optional ad_account UUID for multi-account mode
 * @returns Array of pipelines with stages
 */
export async function getPipelines(
  userAccountId: string,
  accountId?: string
): Promise<Pipeline[]> {
  const queryParams = new URLSearchParams({ userAccountId });

  if (accountId) {
    queryParams.append('accountId', accountId);
  }

  const url = `${API_BASE_URL}/amocrm/pipelines?${queryParams.toString()}`;
  console.log('[amocrmApi] Fetching pipelines from:', url);

  const response = await fetch(url);
  console.log('[amocrmApi] Pipelines response status:', response.status, response.statusText);

  if (!response.ok) {
    let errorMessage = 'Failed to fetch pipelines';
    try {
      const error = await response.json();
      errorMessage = error.message || errorMessage;
    } catch (parseErr) {
      console.error('[amocrmApi] Failed to parse error response:', parseErr);
      errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    }
    console.error('[amocrmApi] Failed to fetch pipelines:', {
      url,
      status: response.status,
      statusText: response.statusText,
      errorMessage
    });
    throw new Error(errorMessage);
  }

  const data = await response.json();
  console.log('[amocrmApi] Fetched pipelines:', data);
  return data;
}

/**
 * Set up to 3 key qualification stages for a direction
 *
 * @param directionId - Direction UUID
 * @param keyStages - Array of { pipelineId, statusId } (0-3 items)
 * @returns Updated direction
 */
export async function setDirectionKeyStages(
  directionId: string,
  keyStages: Array<{ pipelineId: number; statusId: number }>
): Promise<{ success: boolean; direction: any; stages: any[] }> {
  const response = await fetch(
    `${API_BASE_URL}/amocrm/directions/${directionId}/key-stages`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        keyStages,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to set key stages');
  }

  return response.json();
}

/**
 * Get key stage qualification statistics for a direction
 *
 * @param directionId - Direction UUID
 * @param dateFrom - Optional start date (ISO format)
 * @param dateTo - Optional end date (ISO format)
 * @returns Key stage statistics
 */
export async function getDirectionKeyStageStats(
  directionId: string,
  dateFrom?: string,
  dateTo?: string
): Promise<KeyStageStats> {
  const queryParams = new URLSearchParams();

  if (dateFrom) {
    queryParams.append('dateFrom', dateFrom);
  }

  if (dateTo) {
    queryParams.append('dateTo', dateTo);
  }

  const queryString = queryParams.toString();
  const url = `${API_BASE_URL}/amocrm/directions/${directionId}/key-stage-stats${
    queryString ? `?${queryString}` : ''
  }`;

  const response = await fetch(url);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to fetch key stage stats');
  }

  return response.json();
}

/**
 * Trigger recalculation of key stage statistics
 * (triggers amoCRM leads sync)
 *
 * @param userAccountId - User account UUID
 * @param directionId - Optional direction UUID to sync specific direction
 * @param accountId - Optional ad_account UUID for multi-account mode
 * @returns Sync result
 */
export async function recalculateKeyStageStats(
  userAccountId: string,
  directionId?: string,
  accountId?: string
): Promise<{ success: boolean; synced: number; not_found: number; errors: number }> {
  const queryParams = new URLSearchParams({
    userAccountId,
  });

  if (directionId) {
    queryParams.append('directionId', directionId);
  }

  if (accountId) {
    queryParams.append('accountId', accountId);
  }

  const response = await fetch(
    `${API_BASE_URL}/amocrm/recalculate-key-stage?${queryParams.toString()}`,
    {
      method: 'POST',
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to recalculate stats');
  }

  return response.json();
}

// ==================== Qualification Field API ====================

export interface CustomFieldEnum {
  id: number;
  value: string;
}

export interface CustomField {
  field_id: number;
  field_name: string;
  field_type: string;
  entity: string;
  enums: CustomFieldEnum[] | null;
}

export interface QualificationFieldSetting {
  fieldId: number | null;
  fieldName: string | null;
  fieldType: string | null;
  enumId: number | null;
  enumValue: string | null;
}

// New interface for multiple qualification fields
export interface QualificationFieldConfig {
  field_id: number;
  field_name: string;
  field_type: string;
  enum_id?: number | null;
  enum_value?: string | null;
}

export interface QualificationFieldsSettings {
  fields: QualificationFieldConfig[];
}

export interface QualifiedLeadsByCreative {
  qualifiedByCreative: Record<string, number>;
  configured: boolean;
}

/**
 * Get all checkbox custom fields from AmoCRM (for qualification field selection)
 *
 * @param userAccountId - User account UUID
 * @param accountId - Optional ad_account UUID for multi-account mode
 * @returns Array of checkbox custom fields
 */
export async function getLeadCustomFields(
  userAccountId: string,
  accountId?: string
): Promise<{ fields: CustomField[] }> {
  const queryParams = new URLSearchParams({ userAccountId });

  if (accountId) {
    queryParams.append('accountId', accountId);
  }

  const response = await fetch(
    `${API_BASE_URL}/amocrm/lead-custom-fields?${queryParams.toString()}`
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to fetch custom fields');
  }

  return response.json();
}

/**
 * Get current qualification field setting
 *
 * @param userAccountId - User account UUID
 * @param accountId - Optional ad_account UUID for multi-account mode
 * @returns Current qualification field setting
 */
export async function getQualificationField(
  userAccountId: string,
  accountId?: string
): Promise<QualificationFieldSetting> {
  const queryParams = new URLSearchParams({ userAccountId });

  if (accountId) {
    queryParams.append('accountId', accountId);
  }

  const response = await fetch(
    `${API_BASE_URL}/amocrm/qualification-field?${queryParams.toString()}`
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to fetch qualification field');
  }

  return response.json();
}

/**
 * Save qualification field setting (legacy - single field)
 *
 * @param userAccountId - User account UUID
 * @param fieldId - Field ID (or null to disable)
 * @param fieldName - Field name (or null)
 * @param fieldType - Field type (checkbox, select, multiselect)
 * @param enumId - For select/multiselect: enum ID that means qualified
 * @param enumValue - For select/multiselect: enum value name
 * @param accountId - Optional ad_account UUID for multi-account mode
 * @returns Success status
 */
export async function setQualificationField(
  userAccountId: string,
  fieldId: number | null,
  fieldName: string | null,
  fieldType?: string | null,
  enumId?: number | null,
  enumValue?: string | null,
  accountId?: string
): Promise<{ success: boolean }> {
  const queryParams = new URLSearchParams({ userAccountId });

  if (accountId) {
    queryParams.append('accountId', accountId);
  }

  const response = await fetch(
    `${API_BASE_URL}/amocrm/qualification-field?${queryParams.toString()}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fieldId, fieldName, fieldType, enumId, enumValue }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to save qualification field');
  }

  return response.json();
}

/**
 * Get qualification fields settings (up to 3 fields)
 *
 * @param userAccountId - User account UUID
 * @param accountId - Optional ad_account UUID for multi-account mode
 * @returns Array of qualification field configs
 */
export async function getQualificationFields(
  userAccountId: string,
  accountId?: string
): Promise<QualificationFieldsSettings> {
  const queryParams = new URLSearchParams({ userAccountId });

  if (accountId) {
    queryParams.append('accountId', accountId);
  }

  const response = await fetch(
    `${API_BASE_URL}/amocrm/qualification-fields?${queryParams.toString()}`
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to fetch qualification fields');
  }

  return response.json();
}

/**
 * Save qualification fields settings (up to 3 fields)
 * Lead is qualified if ANY of the fields matches
 *
 * @param userAccountId - User account UUID
 * @param fields - Array of field configs (max 3)
 * @param accountId - Optional ad_account UUID for multi-account mode
 * @returns Success status
 */
export async function setQualificationFields(
  userAccountId: string,
  fields: QualificationFieldConfig[],
  accountId?: string
): Promise<{ success: boolean }> {
  const queryParams = new URLSearchParams({ userAccountId });

  if (accountId) {
    queryParams.append('accountId', accountId);
  }

  const response = await fetch(
    `${API_BASE_URL}/amocrm/qualification-fields?${queryParams.toString()}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to save qualification fields');
  }

  return response.json();
}

/**
 * Get qualified leads count by creative ID
 * Used for calculating CPQL based on AmoCRM custom field qualification
 *
 * @param userAccountId - User account UUID
 * @param dateFrom - Optional start date (ISO format)
 * @param dateTo - Optional end date (ISO format)
 * @param accountId - Optional ad_account UUID for multi-account mode
 * @returns Qualified leads count by creative
 */
export async function getQualifiedLeadsByCreative(
  userAccountId: string,
  dateFrom?: string,
  dateTo?: string,
  accountId?: string
): Promise<QualifiedLeadsByCreative> {
  const queryParams = new URLSearchParams({
    userAccountId,
  });

  if (dateFrom) {
    queryParams.append('dateFrom', dateFrom);
  }

  if (dateTo) {
    queryParams.append('dateTo', dateTo);
  }

  if (accountId) {
    queryParams.append('accountId', accountId);
  }

  const response = await fetch(
    `${API_BASE_URL}/amocrm/qualified-leads-by-creative?${queryParams.toString()}`
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to fetch qualified leads by creative');
  }

  return response.json();
}

/**
 * Response type for total qualified leads
 */
export interface QualifiedLeadsTotal {
  totalQualifiedLeads: number | null;
  configured: boolean;
}

/**
 * Get total count of qualified leads for the period
 * Used for calculating overall CPQL based on AmoCRM custom field qualification
 *
 * @param userAccountId - User account UUID
 * @param dateFrom - Optional start date (ISO format YYYY-MM-DD)
 * @param dateTo - Optional end date (ISO format YYYY-MM-DD)
 * @param accountId - Optional ad_account UUID for multi-account mode
 * @returns Total qualified leads count and configuration status
 */
export async function getQualifiedLeadsTotal(
  userAccountId: string,
  dateFrom?: string,
  dateTo?: string,
  accountId?: string
): Promise<QualifiedLeadsTotal> {
  const queryParams = new URLSearchParams({
    userAccountId,
  });

  if (dateFrom) {
    queryParams.append('dateFrom', dateFrom);
  }

  if (dateTo) {
    queryParams.append('dateTo', dateTo);
  }

  if (accountId) {
    queryParams.append('accountId', accountId);
  }

  const response = await fetch(
    `${API_BASE_URL}/amocrm/qualified-leads-total?${queryParams.toString()}`
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to fetch qualified leads total');
  }

  return response.json();
}

