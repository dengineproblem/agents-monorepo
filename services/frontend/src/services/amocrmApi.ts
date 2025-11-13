/**
 * AmoCRM API Client
 *
 * Provides methods for interacting with AmoCRM integration endpoints
 *
 * NOTE: AmoCRM endpoints use direct URLs without /api prefix
 * because they are proxied directly by nginx to agent-service
 */

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

  // AmoCRM endpoints use direct URL without /api prefix
  const response = await fetch(
    `/amocrm/creative-funnel-stats?${queryParams.toString()}`
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
  // AmoCRM endpoints use direct URL without /api prefix
  const response = await fetch(
    `/amocrm/sync-leads?userAccountId=${userAccountId}`,
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



