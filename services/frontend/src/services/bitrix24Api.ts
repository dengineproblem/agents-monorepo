/**
 * Bitrix24 API Client
 *
 * Provides methods for interacting with Bitrix24 CRM integration endpoints
 */

import { API_BASE_URL } from '../config/api';

// ============================================================================
// Types
// ============================================================================

export interface Bitrix24Status {
  connected: boolean;
  domain?: string;
  memberId?: string;
  entityType?: 'lead' | 'deal' | 'both';
  tokenExpiresAt?: string;
  connectedAt?: string;
}

export interface Bitrix24Stage {
  id: string;
  statusId: string;
  statusName: string;
  statusColor?: string;
  statusSort: number;
  statusSemantics?: string;
  isQualifiedStage: boolean;
  isSuccessStage: boolean;
  isFailStage: boolean;
}

export interface Bitrix24Pipeline {
  categoryId: number;
  categoryName: string;
  stages: Bitrix24Stage[];
}

export interface Bitrix24Pipelines {
  leads: Bitrix24Pipeline[];
  deals: Bitrix24Pipeline[];
}

export interface CustomFieldEnum {
  id: string;
  value: string;
  default: boolean;
}

export interface CustomField {
  id: string;
  fieldName: string;
  userTypeId: string;
  label: string;
  multiple: boolean;
  list: CustomFieldEnum[];
}

export interface QualificationFieldConfig {
  field_id: string;
  field_name: string;
  field_type: string;
  entity_type: 'lead' | 'deal' | 'contact';
  enum_id?: string;
  enum_value?: string;
}

export interface FunnelStage {
  categoryId: number;
  categoryName: string;
  statusId: string;
  statusName: string;
  statusColor?: string;
  isQualifiedStage: boolean;
  isSuccessStage: boolean;
  isFailStage: boolean;
  count: number;
}

export interface FunnelStats {
  entityType: 'lead' | 'deal';
  total: number;
  qualified: number;
  qualificationRate: string;
  stages: FunnelStage[];
}

export interface SyncResult {
  success: boolean;
  updated: number;
  errors: number;
}

// ============================================================================
// Connection Status API
// ============================================================================

/**
 * Get Bitrix24 connection status for user
 *
 * @param userAccountId - User account UUID
 * @returns Connection status
 */
export async function getBitrix24Status(
  userAccountId: string
): Promise<Bitrix24Status> {
  const response = await fetch(
    `${API_BASE_URL}/bitrix24/status?userAccountId=${userAccountId}`
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to fetch Bitrix24 status');
  }

  return response.json();
}

/**
 * Disconnect Bitrix24 from user account
 *
 * @param userAccountId - User account UUID
 * @returns Success status
 */
export async function disconnectBitrix24(
  userAccountId: string
): Promise<{ success: boolean }> {
  const response = await fetch(
    `${API_BASE_URL}/bitrix24/disconnect?userAccountId=${userAccountId}`,
    { method: 'DELETE' }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to disconnect Bitrix24');
  }

  return response.json();
}

/**
 * Set entity type preference (lead, deal, or both)
 *
 * @param userAccountId - User account UUID
 * @param entityType - Entity type preference
 * @returns Success status
 */
export async function setBitrix24EntityType(
  userAccountId: string,
  entityType: 'lead' | 'deal' | 'both'
): Promise<{ success: boolean }> {
  const response = await fetch(`${API_BASE_URL}/bitrix24/entity-type`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userAccountId, entityType }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to set entity type');
  }

  return response.json();
}

/**
 * Get Bitrix24 connect page URL
 *
 * @param userAccountId - User account UUID
 * @param accountId - Optional ad_account UUID for multi-account mode
 * @returns Connect page URL
 */
export function getBitrix24ConnectUrl(userAccountId: string, accountId?: string): string {
  let url = `${API_BASE_URL}/bitrix24/connect?userAccountId=${userAccountId}`;
  if (accountId) {
    url += `&accountId=${accountId}`;
  }
  return url;
}

// ============================================================================
// Pipelines API
// ============================================================================

/**
 * Sync pipelines and stages from Bitrix24
 *
 * @param userAccountId - User account UUID
 * @param accountId - Optional ad_account UUID for multi-account mode
 * @returns Sync result with count
 */
export async function syncBitrix24Pipelines(
  userAccountId: string,
  accountId?: string
): Promise<{ success: boolean; count: number; entityType: string }> {
  const response = await fetch(`${API_BASE_URL}/bitrix24/sync-pipelines`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userAccountId, accountId }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to sync pipelines');
  }

  return response.json();
}

/**
 * Get all pipelines and stages for user
 *
 * @param userAccountId - User account UUID
 * @param accountId - Optional ad account UUID for multi-account mode
 * @returns Pipelines grouped by entity type
 */
export async function getBitrix24Pipelines(
  userAccountId: string,
  accountId?: string
): Promise<Bitrix24Pipelines> {
  let url = `${API_BASE_URL}/bitrix24/pipelines?userAccountId=${userAccountId}`;
  if (accountId) {
    url += `&accountId=${accountId}`;
  }

  const response = await fetch(url);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to fetch pipelines');
  }

  return response.json();
}

/**
 * Update stage qualification settings
 *
 * @param userAccountId - User account UUID
 * @param stageId - Stage UUID
 * @param settings - Stage settings
 * @returns Success status
 */
export async function updateBitrix24Stage(
  userAccountId: string,
  stageId: string,
  settings: {
    isQualifiedStage?: boolean;
    isSuccessStage?: boolean;
    isFailStage?: boolean;
  }
): Promise<{ success: boolean }> {
  const response = await fetch(
    `${API_BASE_URL}/bitrix24/pipeline-stages/${stageId}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userAccountId, ...settings }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to update stage');
  }

  return response.json();
}

// ============================================================================
// Custom Fields API
// ============================================================================

/**
 * Get custom fields for leads
 *
 * @param userAccountId - User account UUID
 * @returns Custom fields for leads
 */
export async function getBitrix24LeadCustomFields(
  userAccountId: string
): Promise<{ fields: CustomField[]; entityType: string }> {
  const response = await fetch(
    `${API_BASE_URL}/bitrix24/lead-custom-fields?userAccountId=${userAccountId}`
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to fetch lead custom fields');
  }

  return response.json();
}

/**
 * Get custom fields for deals
 *
 * @param userAccountId - User account UUID
 * @returns Custom fields for deals
 */
export async function getBitrix24DealCustomFields(
  userAccountId: string
): Promise<{ fields: CustomField[]; entityType: string }> {
  const response = await fetch(
    `${API_BASE_URL}/bitrix24/deal-custom-fields?userAccountId=${userAccountId}`
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to fetch deal custom fields');
  }

  return response.json();
}

/**
 * Get custom fields for contacts
 *
 * @param userAccountId - User account UUID
 * @returns Custom fields for contacts
 */
export async function getBitrix24ContactCustomFields(
  userAccountId: string
): Promise<{ fields: CustomField[]; entityType: string }> {
  const response = await fetch(
    `${API_BASE_URL}/bitrix24/contact-custom-fields?userAccountId=${userAccountId}`
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to fetch contact custom fields');
  }

  return response.json();
}

// ============================================================================
// Qualification Fields API
// ============================================================================

/**
 * Get current qualification field settings
 *
 * @param userAccountId - User account UUID
 * @returns Qualification field configs (up to 3)
 */
export async function getBitrix24QualificationFields(
  userAccountId: string
): Promise<{ fields: QualificationFieldConfig[] }> {
  const response = await fetch(
    `${API_BASE_URL}/bitrix24/qualification-fields?userAccountId=${userAccountId}`
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to fetch qualification fields');
  }

  return response.json();
}

/**
 * Save qualification field settings
 * Lead/deal is qualified if ANY of the fields matches
 *
 * @param userAccountId - User account UUID
 * @param fields - Array of field configs (max 3)
 * @returns Success status
 */
export async function setBitrix24QualificationFields(
  userAccountId: string,
  fields: QualificationFieldConfig[]
): Promise<{ success: boolean }> {
  const response = await fetch(`${API_BASE_URL}/bitrix24/qualification-fields`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userAccountId, fields }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to save qualification fields');
  }

  return response.json();
}

// ============================================================================
// Sync API
// ============================================================================

/**
 * Sync leads/deals from Bitrix24 to update status
 *
 * @param userAccountId - User account UUID
 * @param entityType - Optional entity type override
 * @param accountId - Optional ad_account UUID for multi-account mode
 * @returns Sync result
 */
export async function syncBitrix24Leads(
  userAccountId: string,
  entityType?: 'lead' | 'deal' | 'both',
  accountId?: string
): Promise<SyncResult> {
  const response = await fetch(`${API_BASE_URL}/bitrix24/sync-leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userAccountId, entityType, accountId }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to sync leads');
  }

  return response.json();
}

// ============================================================================
// Funnel Stats API
// ============================================================================

/**
 * Get funnel statistics for creative/direction
 *
 * @param params - Query parameters
 * @returns Funnel statistics
 */
export async function getBitrix24FunnelStats(params: {
  userAccountId: string;
  creativeId?: string;
  directionId?: string;
  entityType?: 'lead' | 'deal';
}): Promise<FunnelStats> {
  const queryParams = new URLSearchParams({
    userAccountId: params.userAccountId,
  });

  if (params.creativeId) {
    queryParams.append('creativeId', params.creativeId);
  }

  if (params.directionId) {
    queryParams.append('directionId', params.directionId);
  }

  if (params.entityType) {
    queryParams.append('entityType', params.entityType);
  }

  const response = await fetch(
    `${API_BASE_URL}/bitrix24/creative-funnel-stats?${queryParams.toString()}`
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to fetch funnel stats');
  }

  return response.json();
}

// ============================================================================
// Key Stages API
// ============================================================================

export interface KeyStageConfig {
  categoryId: number;
  statusId: string;
}

export interface KeyStageInfo {
  index: number;
  category_id: number;
  status_id: string;
  category_name: string;
  status_name: string;
  entity_type?: string;
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

export interface KeyStageStatsResponse {
  total_leads: number;
  key_stages: KeyStageInfo[];
}

/**
 * Save key stages for a direction (Bitrix24)
 *
 * @param directionId - Direction UUID
 * @param userAccountId - User account UUID
 * @param entityType - Entity type ('lead' or 'deal')
 * @param keyStages - Array of key stage configs (0-3 items)
 * @returns Save result
 */
export async function saveBitrix24DirectionKeyStages(
  directionId: string,
  userAccountId: string,
  entityType: 'lead' | 'deal',
  keyStages: KeyStageConfig[]
): Promise<{ success: boolean; direction: any; stages: any[]; message: string }> {
  const response = await fetch(
    `${API_BASE_URL}/bitrix24/directions/${directionId}/key-stages`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userAccountId,
        entityType,
        keyStages,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to save key stages');
  }

  return response.json();
}

/**
 * Get key stage statistics for a direction (Bitrix24)
 *
 * @param directionId - Direction UUID
 * @param dateFrom - Optional start date (ISO string)
 * @param dateTo - Optional end date (ISO string)
 * @returns Key stage statistics
 */
export async function getBitrix24DirectionKeyStageStats(
  directionId: string,
  dateFrom?: string,
  dateTo?: string
): Promise<KeyStageStatsResponse> {
  const queryParams = new URLSearchParams();

  if (dateFrom) {
    queryParams.append('dateFrom', dateFrom);
  }
  if (dateTo) {
    queryParams.append('dateTo', dateTo);
  }

  const queryString = queryParams.toString();
  const url = `${API_BASE_URL}/bitrix24/directions/${directionId}/key-stage-stats${queryString ? `?${queryString}` : ''}`;

  const response = await fetch(url);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to fetch key stage stats');
  }

  return response.json();
}

/**
 * Trigger recalculation of Bitrix24 key stage statistics
 *
 * @param userAccountId - User account UUID
 * @param directionId - Optional direction UUID (if not provided, recalculates all)
 * @param accountId - Optional ad account ID for multi-account mode
 * @returns Recalculation result
 */
export async function recalculateBitrix24KeyStageStats(
  userAccountId: string,
  directionId?: string,
  accountId?: string
): Promise<{ success: boolean; synced: number; errors: number }> {
  const queryParams = new URLSearchParams({ userAccountId });

  if (directionId) {
    queryParams.append('directionId', directionId);
  }
  if (accountId) {
    queryParams.append('accountId', accountId);
  }

  const response = await fetch(
    `${API_BASE_URL}/bitrix24/recalculate-key-stage-stats?${queryParams.toString()}`,
    { method: 'POST' }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to recalculate key stage stats');
  }

  return response.json();
}

// ============================================================================
// Auto-Create Leads API
// ============================================================================

export interface AutoCreateLeadsSetting {
  enabled: boolean;
  bitrix24Connected: boolean;
}

export interface DefaultStageSetting {
  entityType: 'lead' | 'deal' | 'both';
  leadStatus: string | null;
  dealCategory: number | null;
  dealStage: string | null;
}

/**
 * Get current auto-create leads setting
 *
 * @param userAccountId - User account UUID
 * @param accountId - Optional ad_account UUID for multi-account mode
 * @returns Current setting state
 */
export async function getBitrix24AutoCreateSetting(
  userAccountId: string,
  accountId?: string
): Promise<AutoCreateLeadsSetting> {
  const queryParams = new URLSearchParams({ userAccountId });

  if (accountId) {
    queryParams.append('accountId', accountId);
  }

  const response = await fetch(
    `${API_BASE_URL}/bitrix24/auto-create-leads?${queryParams.toString()}`
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to fetch auto-create setting');
  }

  return response.json();
}

/**
 * Set auto-create leads setting
 *
 * @param userAccountId - User account UUID
 * @param enabled - Whether to enable auto-creation
 * @param accountId - Optional ad_account UUID for multi-account mode
 * @returns Success status
 */
export async function setBitrix24AutoCreateSetting(
  userAccountId: string,
  enabled: boolean,
  accountId?: string
): Promise<{ success: boolean; enabled: boolean }> {
  const response = await fetch(`${API_BASE_URL}/bitrix24/auto-create-leads`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userAccountId, accountId, enabled }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to update auto-create setting');
  }

  return response.json();
}

/**
 * Get current default stage settings
 *
 * @param userAccountId - User account UUID
 * @param accountId - Optional ad_account UUID for multi-account mode
 * @returns Current default stage settings
 */
export async function getBitrix24DefaultStage(
  userAccountId: string,
  accountId?: string
): Promise<DefaultStageSetting> {
  const queryParams = new URLSearchParams({ userAccountId });

  if (accountId) {
    queryParams.append('accountId', accountId);
  }

  const response = await fetch(
    `${API_BASE_URL}/bitrix24/default-stage?${queryParams.toString()}`
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to fetch default stage setting');
  }

  return response.json();
}

/**
 * Set default stage settings
 *
 * @param userAccountId - User account UUID
 * @param settings - Default stage settings
 * @param accountId - Optional ad_account UUID for multi-account mode
 * @returns Success status
 */
export async function setBitrix24DefaultStage(
  userAccountId: string,
  settings: {
    leadStatus?: string | null;
    dealCategory?: number | null;
    dealStage?: string | null;
  },
  accountId?: string
): Promise<{ success: boolean }> {
  const response = await fetch(`${API_BASE_URL}/bitrix24/default-stage`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userAccountId, accountId, ...settings }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to update default stage setting');
  }

  return response.json();
}

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Open Bitrix24 connect page in new window
 *
 * @param userAccountId - User account UUID
 * @param accountId - Optional ad_account UUID for multi-account mode
 */
export function openBitrix24ConnectWindow(userAccountId: string, accountId?: string): void {
  const url = getBitrix24ConnectUrl(userAccountId, accountId);
  const width = 600;
  const height = 700;
  const left = (window.innerWidth - width) / 2;
  const top = (window.innerHeight - height) / 2;

  window.open(
    url,
    'Bitrix24Connect',
    `width=${width},height=${height},left=${left},top=${top},scrollbars=yes`
  );
}

/**
 * Listen for Bitrix24 connection success message
 *
 * @param callback - Callback when connected
 * @returns Cleanup function
 */
export function onBitrix24Connected(
  callback: (data: { domain: string; entityType: string }) => void
): () => void {
  const handler = (event: MessageEvent) => {
    if (event.data?.type === 'bitrix24_connected') {
      callback({
        domain: event.data.domain,
        entityType: event.data.entityType,
      });
    }
  };

  window.addEventListener('message', handler);

  return () => {
    window.removeEventListener('message', handler);
  };
}
