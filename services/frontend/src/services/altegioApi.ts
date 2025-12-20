/**
 * Altegio API Client for Frontend
 *
 * Provides functions for interacting with Altegio integration endpoints
 *
 * @module services/altegioApi
 */

import { apiClient } from './apiClient';

// ============================================================================
// Types
// ============================================================================

export interface AltegioStatus {
  connected: boolean;
  valid?: boolean;
  companyId?: number;
  companyName?: string;
  connectedAt?: string;
  error?: string;
}

export interface AltegioRecord {
  id: string;
  altegio_record_id: number;
  altegio_client_id?: number;
  client_phone?: string;
  client_name?: string;
  staff_id?: number;
  staff_name?: string;
  service_names?: string[];
  total_cost?: number;
  record_datetime: string;
  attendance: number;
  confirmed: boolean;
  lead_id?: number;
}

export interface AltegioTransaction {
  id: string;
  altegio_transaction_id: number;
  altegio_record_id?: number;
  altegio_client_id?: number;
  client_phone?: string;
  client_name?: string;
  amount: number;
  transaction_type: number;
  created_at: string;
  lead_id?: number;
}

export interface AltegioSyncLog {
  id: string;
  sync_type: string;
  sync_status: string;
  webhook_data?: any;
  error_message?: string;
  created_at: string;
}

export interface SyncRecordsResult {
  success: boolean;
  total: number;
  processed: number;
  qualified: number;
  skipped: number;
  errors: number;
}

export interface SyncTransactionsResult {
  success: boolean;
  total: number;
  processed: number;
  salesCreated: number;
  salesUpdated: number;
  errors: number;
}

export interface AltegioStats {
  qualifiedLeads: number;
  totalRecords: number;
  totalTransactions: number;
  totalRevenue: number;
}

export interface AltegioCompany {
  id: number;
  title: string;
  publicTitle?: string;
  city?: string;
  address?: string;
  phone?: string;
  email?: string;
  timezone?: string;
}

// ============================================================================
// Connection Functions
// ============================================================================

/**
 * Get Altegio connection status
 */
export async function getAltegioStatus(userAccountId: string): Promise<AltegioStatus> {
  const response = await apiClient.get(`/altegio/status`, {
    params: { userAccountId },
  });
  return response.data;
}

/**
 * Connect Altegio with credentials
 */
export async function connectAltegio(
  userAccountId: string,
  companyId: number,
  userToken: string
): Promise<{ success: boolean; companyId: number; companyName?: string }> {
  const response = await apiClient.post('/altegio/connect', {
    userAccountId,
    companyId,
    userToken,
  });
  return response.data;
}

/**
 * Disconnect Altegio
 */
export async function disconnectAltegio(userAccountId: string): Promise<{ success: boolean }> {
  const response = await apiClient.delete('/altegio/disconnect', {
    params: { userAccountId },
  });
  return response.data;
}

/**
 * Get connected Altegio company info
 */
export async function getAltegioCompany(userAccountId: string): Promise<AltegioCompany> {
  const response = await apiClient.get('/altegio/company', {
    params: { userAccountId },
  });
  return response.data;
}

// ============================================================================
// Sync Functions
// ============================================================================

/**
 * Sync records (appointments) from Altegio
 */
export async function syncAltegioRecords(
  userAccountId: string,
  startDate?: string,
  endDate?: string
): Promise<SyncRecordsResult> {
  const response = await apiClient.post('/altegio/sync-records', {
    userAccountId,
    startDate,
    endDate,
  });
  return response.data;
}

/**
 * Sync transactions from Altegio
 */
export async function syncAltegioTransactions(
  userAccountId: string,
  startDate?: string,
  endDate?: string
): Promise<SyncTransactionsResult> {
  const response = await apiClient.post('/altegio/sync-transactions', {
    userAccountId,
    startDate,
    endDate,
  });
  return response.data;
}

/**
 * Sync both records and transactions
 */
export async function syncAltegioAll(
  userAccountId: string,
  startDate?: string,
  endDate?: string
): Promise<{
  success: boolean;
  records: SyncRecordsResult;
  transactions: SyncTransactionsResult;
}> {
  const response = await apiClient.post('/altegio/sync-all', {
    userAccountId,
    startDate,
    endDate,
  });
  return response.data;
}

// ============================================================================
// Data Retrieval Functions
// ============================================================================

/**
 * Get synced Altegio records
 */
export async function getAltegioRecords(
  userAccountId: string,
  limit?: number,
  offset?: number
): Promise<{ records: AltegioRecord[]; total: number }> {
  const response = await apiClient.get('/altegio/records', {
    params: { userAccountId, limit, offset },
  });
  return response.data;
}

/**
 * Get synced Altegio transactions
 */
export async function getAltegioTransactions(
  userAccountId: string,
  limit?: number,
  offset?: number
): Promise<{ transactions: AltegioTransaction[]; total: number }> {
  const response = await apiClient.get('/altegio/transactions', {
    params: { userAccountId, limit, offset },
  });
  return response.data;
}

/**
 * Get Altegio sync log
 */
export async function getAltegioSyncLog(
  userAccountId: string,
  limit?: number,
  syncType?: string
): Promise<{ logs: AltegioSyncLog[] }> {
  const response = await apiClient.get('/altegio/sync-log', {
    params: { userAccountId, limit, syncType },
  });
  return response.data;
}

/**
 * Get leads qualified via Altegio
 */
export async function getAltegioQualifiedLeads(
  userAccountId: string,
  dateFrom?: string,
  dateTo?: string
): Promise<{ leads: any[]; count: number }> {
  const response = await apiClient.get('/altegio/qualified-leads', {
    params: { userAccountId, dateFrom, dateTo },
  });
  return response.data;
}

/**
 * Get Altegio integration statistics
 */
export async function getAltegioStats(
  userAccountId: string,
  dateFrom?: string,
  dateTo?: string
): Promise<AltegioStats> {
  const response = await apiClient.get('/altegio/stats', {
    params: { userAccountId, dateFrom, dateTo },
  });
  return response.data;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get URL for Altegio connect page
 */
export function getAltegioConnectUrl(userAccountId: string): string {
  const baseUrl = import.meta.env.VITE_API_URL || '';
  return `${baseUrl}/altegio/connect?userAccountId=${userAccountId}`;
}

/**
 * Open Altegio connect page in new window
 */
export function openAltegioConnect(userAccountId: string): Window | null {
  const url = getAltegioConnectUrl(userAccountId);
  return window.open(url, 'altegio-connect', 'width=500,height=700');
}

/**
 * Format attendance status
 */
export function formatAttendanceStatus(attendance: number): string {
  switch (attendance) {
    case 2:
      return 'Подтверждён, пришёл';
    case 1:
      return 'Пришёл';
    case 0:
      return 'Ожидается';
    case -1:
      return 'Не подтверждён';
    case -2:
      return 'Отменён';
    default:
      return 'Неизвестно';
  }
}

/**
 * Get attendance status color
 */
export function getAttendanceColor(attendance: number): string {
  switch (attendance) {
    case 2:
    case 1:
      return 'green';
    case 0:
      return 'blue';
    case -1:
      return 'orange';
    case -2:
      return 'red';
    default:
      return 'gray';
  }
}
