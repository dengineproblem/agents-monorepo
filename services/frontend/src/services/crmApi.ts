/**
 * Unified CRM API Client
 *
 * Provides CRM-agnostic methods that automatically work with the connected CRM
 * (AmoCRM or Bitrix24). The backend detects which CRM is connected and routes
 * requests appropriately.
 */

import { API_BASE_URL } from '../config/api';
import { shouldFilterByAccountId } from '@/utils/multiAccountHelper';

// ============================================================================
// Types
// ============================================================================

export type CRMType = 'amocrm' | 'bitrix24' | 'none';

export interface CRMStatus {
  crmType: CRMType;
  connected: boolean;
  domain?: string;
  entityType?: string;
}

export interface FunnelStage {
  stage_name: string;
  pipeline_name: string;
  count: number;
  percentage: number;
  color: string;
  sort_order: number;
}

export interface FunnelStats {
  crmType: CRMType;
  total_leads: number;
  stages: FunnelStage[];
  message?: string;
}

export interface SyncResult {
  success: boolean;
  crmType: CRMType;
  total?: number;
  updated?: number;
  errors?: number;
  message?: string;
  error?: string;
}

// ============================================================================
// Helper: Get CRM Display Name
// ============================================================================

export function getCRMDisplayName(crmType: CRMType): string {
  switch (crmType) {
    case 'amocrm':
      return 'AmoCRM';
    case 'bitrix24':
      return 'Bitrix24';
    default:
      return 'CRM';
  }
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Get CRM connection status for a user
 *
 * @param userAccountId - User account UUID
 * @param accountId - Optional ad_account UUID for multi-account mode
 * @returns CRM status including type and connection info
 */
export async function getCRMStatus(
  userAccountId: string,
  accountId?: string
): Promise<CRMStatus> {
  const queryParams = new URLSearchParams({ userAccountId });

  if (shouldFilterByAccountId(accountId)) {
    queryParams.append('accountId', accountId!);
  }

  const response = await fetch(
    `${API_BASE_URL}/crm/status?${queryParams.toString()}`
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to fetch CRM status');
  }

  return response.json();
}

/**
 * Get funnel statistics for a specific creative or all creatives
 * Automatically uses the connected CRM (AmoCRM or Bitrix24)
 *
 * @param params - Query parameters
 * @param params.creativeId - Optional. If not provided, returns stats for all creatives
 * @returns Funnel statistics with CRM type
 */
export async function getCreativeFunnelStats(params: {
  userAccountId: string;
  creativeId?: string;
  directionId?: string;
  dateFrom?: string;
  dateTo?: string;
  accountId?: string;
}): Promise<FunnelStats> {
  const queryParams = new URLSearchParams({
    userAccountId: params.userAccountId,
  });

  if (params.creativeId) {
    queryParams.append('creativeId', params.creativeId);
  }

  if (shouldFilterByAccountId(params.accountId)) {
    queryParams.append('accountId', params.accountId!);
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
    `${API_BASE_URL}/crm/creative-funnel-stats?${queryParams.toString()}`
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to fetch funnel stats');
  }

  return response.json();
}

/**
 * Trigger sync of leads for a specific creative
 * Automatically uses the connected CRM (AmoCRM or Bitrix24)
 *
 * @param userAccountId - User account UUID
 * @param creativeId - Creative UUID
 * @param accountId - Optional ad_account UUID for multi-account mode
 * @returns Sync result
 */
export async function syncCreativeLeads(
  userAccountId: string,
  creativeId: string,
  accountId?: string
): Promise<SyncResult> {
  const queryParams = new URLSearchParams({
    userAccountId,
    creativeId,
  });

  if (shouldFilterByAccountId(accountId)) {
    queryParams.append('accountId', accountId!);
  }

  const response = await fetch(
    `${API_BASE_URL}/crm/sync-creative-leads?${queryParams.toString()}`,
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
