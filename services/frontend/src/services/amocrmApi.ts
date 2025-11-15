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
  pipeline_id: number;
  status_id: number;
  pipeline_name: string;
  status_name: string;
}

export interface KeyStageStats {
  total_leads: number;
  qualified_leads: number;
  qualification_rate: number;
  key_stage: KeyStage;
  creative_stats: Array<{
    creative_id: string;
    creative_name: string;
    total: number;
    qualified: number;
    rate: number;
  }>;
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
}): Promise<FunnelStats> {
  const queryParams = new URLSearchParams({
    userAccountId: params.userAccountId,
    creativeId: params.creativeId,
  });

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
 * @returns Sync result
 */
export async function triggerLeadsSync(userAccountId: string): Promise<SyncResult> {
  const response = await fetch(
    `${API_BASE_URL}/amocrm/sync-leads?userAccountId=${userAccountId}`,
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
 * Get all pipelines with their stages
 *
 * @param userAccountId - User account UUID
 * @returns Array of pipelines with stages
 */
export async function getPipelines(userAccountId: string): Promise<Pipeline[]> {
  const response = await fetch(
    `${API_BASE_URL}/amocrm/pipelines?userAccountId=${userAccountId}`
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to fetch pipelines');
  }

  return response.json();
}

/**
 * Set key qualification stage for a direction
 *
 * @param directionId - Direction UUID
 * @param pipelineId - AmoCRM pipeline ID
 * @param statusId - AmoCRM status ID
 * @returns Updated direction
 */
export async function setDirectionKeyStage(
  directionId: string,
  pipelineId: number,
  statusId: number
): Promise<{ success: boolean; direction: any; stage: any }> {
  const response = await fetch(
    `${API_BASE_URL}/amocrm/directions/${directionId}/key-stage`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pipelineId,
        statusId,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to set key stage');
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
 * @returns Sync result
 */
export async function recalculateKeyStageStats(
  userAccountId: string,
  directionId?: string
): Promise<{ success: boolean; synced: number; not_found: number; errors: number }> {
  const queryParams = new URLSearchParams({
    userAccountId,
  });

  if (directionId) {
    queryParams.append('directionId', directionId);
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

