/**
 * Altegio (YCLIENTS) CRM API Adapter
 *
 * Provides integration with Altegio REST API
 * https://developer.alteg.io/api
 *
 * Key differences from AmoCRM/Bitrix24:
 * - Qualification = client booked an appointment (not custom field)
 * - Sales = financial transactions (actual payments)
 * - Authorization: Partner Token + User Token (not OAuth refresh flow)
 * - Rate limit: 5 req/sec or 200 req/min
 *
 * @module adapters/altegio
 */

import fetch from 'node-fetch';

// ============================================================================
// Configuration
// ============================================================================

const ALTEGIO_API_URL = 'https://api.alteg.io/api/v1';
const YCLIENTS_API_URL = 'https://api.yclients.com/api/v1';

// Rate limits
const RATE_LIMIT_PER_SECOND = 5;
const RATE_LIMIT_PER_MINUTE = 200;

// Use Altegio API by default, fall back to YCLIENTS if needed
const API_BASE_URL = ALTEGIO_API_URL;

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Altegio API response wrapper
 */
export interface AltegioResponse<T> {
  success: boolean;
  data: T;
  meta?: {
    page?: number;
    total_count?: number;
  };
}

/**
 * Altegio Client (customer)
 */
export interface AltegioClient {
  id: number;
  name: string;
  phone: string;
  email?: string;
  sex_id?: number;  // 0=unknown, 1=male, 2=female
  importance_id?: number;
  discount?: number;
  card?: string;
  birth_date?: string;
  comment?: string;
  visits_count?: number;
  first_visit_date?: string;
  last_visit_date?: string;
  sold_amount?: number;
  balance?: number;
}

/**
 * Altegio Service
 */
export interface AltegioService {
  id: number;
  title: string;
  cost: number;
  manual_cost?: number;
  cost_per_unit?: number;
  discount?: number;
  first_cost?: number;
  amount?: number;
}

/**
 * Altegio Staff member
 */
export interface AltegioStaff {
  id: number;
  name: string;
  specialization?: string;
  position?: {
    id: number;
    title: string;
  };
  avatar?: string;
  rating?: number;
  votes_count?: number;
}

/**
 * Altegio Record (appointment)
 */
export interface AltegioRecord {
  id: number;
  company_id: number;
  staff_id: number;
  services: AltegioService[];
  staff?: AltegioStaff;
  client?: AltegioClient;
  date: number;         // Unix timestamp
  datetime: number;     // Unix timestamp
  create_date: string;  // ISO format
  comment?: string;
  online?: boolean;
  visit_id?: number;
  seance_length: number;  // Duration in seconds
  // Attendance: 2=confirmed came, 1=came, 0=expected, -1=not confirmed, -2=cancelled
  attendance: number;
  confirmed?: boolean;
  length?: number;
  sms_before?: number;
  sms_now?: number;
  sms_now_text?: string;
  email_now?: number;
  deleted?: boolean;
}

/**
 * Altegio Financial Transaction
 */
export interface AltegioTransaction {
  id: number;
  document_id?: number;
  record_id?: number;
  visit_id?: number;
  client_id?: number;
  supplier_id?: number;
  master_id?: number;
  expense_id?: number;
  account_id?: number;
  type_id?: number;  // 1=income, 2=expense
  amount: number;
  comment?: string;
  date?: string;
  create_date?: string;
}

/**
 * Altegio Company info
 */
export interface AltegioCompany {
  id: number;
  title: string;
  public_title?: string;
  short_descr?: string;
  logo?: string;
  city?: string;
  address?: string;
  coordinate_lat?: number;
  coordinate_lon?: number;
  phone?: string;
  phones?: string[];
  email?: string;
  timezone?: string;
  timezone_name?: string;
  schedule?: {
    [key: string]: {  // day of week
      from: string;
      to: string;
      is_work_day: boolean;
    };
  };
}

/**
 * Webhook payload from Altegio
 */
export interface AltegioWebhookPayload {
  company_id: number;
  resource: 'record' | 'client' | 'finances_operation' | 'goods_transaction';
  status: 'create' | 'update' | 'delete';
  resource_id: number;
  data?: any;
}

// ============================================================================
// API Client Class
// ============================================================================

export class AltegioClient {
  private partnerToken: string;
  private userToken: string;
  private baseUrl: string;

  constructor(partnerToken: string, userToken: string, baseUrl: string = API_BASE_URL) {
    this.partnerToken = partnerToken;
    this.userToken = userToken;
    this.baseUrl = baseUrl;
  }

  /**
   * Make authenticated API request
   */
  private async request<T>(
    method: string,
    endpoint: string,
    body?: any,
    requireUserToken: boolean = true
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    // Build authorization header
    // Some methods require only Partner token, some require both
    let authHeader = `Bearer ${this.partnerToken}`;
    if (requireUserToken && this.userToken) {
      authHeader += `, User ${this.userToken}`;
    }

    const headers: Record<string, string> = {
      Accept: 'application/vnd.api.v2+json',
      Authorization: authHeader,
      'Content-Type': 'application/json',
    };

    const options: any = {
      method,
      headers,
    };

    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Altegio API error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const data = await response.json() as AltegioResponse<T>;

    if (!data.success) {
      throw new Error(`Altegio API returned success=false`);
    }

    return data.data;
  }

  // ==========================================================================
  // Company Methods
  // ==========================================================================

  /**
   * Get company information
   */
  async getCompany(companyId: number): Promise<AltegioCompany> {
    return this.request<AltegioCompany>('GET', `/company/${companyId}`, null, false);
  }

  // ==========================================================================
  // Client Methods
  // ==========================================================================

  /**
   * Get list of clients for a company
   */
  async getClients(
    companyId: number,
    params?: {
      page?: number;
      count?: number;
      fullname?: string;
      phone?: string;
    }
  ): Promise<AltegioClient[]> {
    let endpoint = `/clients/${companyId}`;
    const queryParams: string[] = [];

    if (params?.page) queryParams.push(`page=${params.page}`);
    if (params?.count) queryParams.push(`count=${params.count}`);
    if (params?.fullname) queryParams.push(`fullname=${encodeURIComponent(params.fullname)}`);
    if (params?.phone) queryParams.push(`phone=${encodeURIComponent(params.phone)}`);

    if (queryParams.length > 0) {
      endpoint += `?${queryParams.join('&')}`;
    }

    return this.request<AltegioClient[]>('GET', endpoint);
  }

  /**
   * Get single client by ID
   */
  async getClient(companyId: number, clientId: number): Promise<AltegioClient> {
    return this.request<AltegioClient>('GET', `/client/${companyId}/${clientId}`);
  }

  /**
   * Search client by phone number
   */
  async findClientByPhone(companyId: number, phone: string): Promise<AltegioClient | null> {
    try {
      const clients = await this.getClients(companyId, { phone, count: 1 });
      return clients.length > 0 ? clients[0] : null;
    } catch (error) {
      console.error('Error finding client by phone:', error);
      return null;
    }
  }

  // ==========================================================================
  // Record (Appointment) Methods
  // ==========================================================================

  /**
   * Get list of records (appointments)
   */
  async getRecords(
    companyId: number,
    params?: {
      page?: number;
      count?: number;
      staff_id?: number;
      client_id?: number;
      start_date?: string;  // YYYY-MM-DD
      end_date?: string;    // YYYY-MM-DD
      c_start_date?: string; // created after
      c_end_date?: string;   // created before
    }
  ): Promise<AltegioRecord[]> {
    let endpoint = `/records/${companyId}`;
    const queryParams: string[] = [];

    if (params?.page) queryParams.push(`page=${params.page}`);
    if (params?.count) queryParams.push(`count=${params.count}`);
    if (params?.staff_id) queryParams.push(`staff_id=${params.staff_id}`);
    if (params?.client_id) queryParams.push(`client_id=${params.client_id}`);
    if (params?.start_date) queryParams.push(`start_date=${params.start_date}`);
    if (params?.end_date) queryParams.push(`end_date=${params.end_date}`);
    if (params?.c_start_date) queryParams.push(`c_start_date=${params.c_start_date}`);
    if (params?.c_end_date) queryParams.push(`c_end_date=${params.c_end_date}`);

    if (queryParams.length > 0) {
      endpoint += `?${queryParams.join('&')}`;
    }

    return this.request<AltegioRecord[]>('GET', endpoint);
  }

  /**
   * Get single record by ID
   */
  async getRecord(companyId: number, recordId: number): Promise<AltegioRecord> {
    return this.request<AltegioRecord>('GET', `/record/${companyId}/${recordId}`);
  }

  /**
   * Get all records for a specific client
   */
  async getClientRecords(companyId: number, clientId: number): Promise<AltegioRecord[]> {
    return this.getRecords(companyId, { client_id: clientId, count: 200 });
  }

  // ==========================================================================
  // Financial Transaction Methods
  // ==========================================================================

  /**
   * Get financial transactions
   */
  async getTransactions(
    companyId: number,
    params?: {
      page?: number;
      count?: number;
      start_date?: string;
      end_date?: string;
      type_id?: number;  // 1=income, 2=expense
    }
  ): Promise<AltegioTransaction[]> {
    let endpoint = `/transactions/${companyId}`;
    const queryParams: string[] = [];

    if (params?.page) queryParams.push(`page=${params.page}`);
    if (params?.count) queryParams.push(`count=${params.count}`);
    if (params?.start_date) queryParams.push(`start_date=${params.start_date}`);
    if (params?.end_date) queryParams.push(`end_date=${params.end_date}`);
    if (params?.type_id) queryParams.push(`type_id=${params.type_id}`);

    if (queryParams.length > 0) {
      endpoint += `?${queryParams.join('&')}`;
    }

    return this.request<AltegioTransaction[]>('GET', endpoint);
  }

  /**
   * Get single transaction by ID
   */
  async getTransaction(companyId: number, transactionId: number): Promise<AltegioTransaction> {
    return this.request<AltegioTransaction>('GET', `/transaction/${companyId}/${transactionId}`);
  }

  /**
   * Get income transactions only (for ROI calculation)
   */
  async getIncomeTransactions(
    companyId: number,
    startDate?: string,
    endDate?: string
  ): Promise<AltegioTransaction[]> {
    return this.getTransactions(companyId, {
      type_id: 1,  // income only
      start_date: startDate,
      end_date: endDate,
      count: 200,
    });
  }

  // ==========================================================================
  // Staff Methods
  // ==========================================================================

  /**
   * Get list of staff members
   */
  async getStaff(companyId: number): Promise<AltegioStaff[]> {
    return this.request<AltegioStaff[]>('GET', `/book_staff/${companyId}`, null, false);
  }

  // ==========================================================================
  // Webhook Methods
  // ==========================================================================

  /**
   * Get registered webhooks for a company
   * Note: Webhooks are configured through Altegio Marketplace, not API
   */
  async getWebhooks(companyId: number): Promise<any[]> {
    try {
      return this.request<any[]>('GET', `/hooks/${companyId}`);
    } catch (error) {
      console.error('Error getting webhooks:', error);
      return [];
    }
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create Altegio API client instance
 */
export function createAltegioClient(
  partnerToken: string,
  userToken: string
): AltegioClient {
  return new AltegioClient(partnerToken, userToken);
}

/**
 * Normalize phone number for comparison
 * Removes all non-digits and standardizes format
 */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;

  // Remove WhatsApp suffixes
  let cleaned = phone.replace(/@s\.whatsapp\.net|@c\.us/g, '');

  // Remove all non-digits
  cleaned = cleaned.replace(/\D/g, '');

  // Remove leading 8 and replace with 7 for Russian numbers
  if (cleaned.startsWith('8') && cleaned.length === 11) {
    cleaned = '7' + cleaned.substring(1);
  }

  return cleaned || null;
}

/**
 * Check if two phone numbers match
 */
export function phonesMatch(phone1: string | null, phone2: string | null): boolean {
  const normalized1 = normalizePhone(phone1);
  const normalized2 = normalizePhone(phone2);

  if (!normalized1 || !normalized2) return false;

  // Check if one ends with the other (handles country code differences)
  return normalized1.endsWith(normalized2) || normalized2.endsWith(normalized1);
}

/**
 * Calculate total cost of services in a record
 */
export function calculateRecordTotal(record: AltegioRecord): number {
  if (!record.services || record.services.length === 0) return 0;

  return record.services.reduce((total, service) => {
    const cost = service.manual_cost ?? service.cost ?? 0;
    const discount = service.discount ?? 0;
    const amount = service.amount ?? 1;
    return total + (cost - discount) * amount;
  }, 0);
}

/**
 * Check if record is a valid appointment (not cancelled)
 */
export function isValidRecord(record: AltegioRecord): boolean {
  // attendance: 2=confirmed came, 1=came, 0=expected, -1=not confirmed, -2=cancelled
  return record.attendance >= 0 && !record.deleted;
}

/**
 * Check if record represents a completed visit (client came)
 */
export function isCompletedVisit(record: AltegioRecord): boolean {
  // attendance: 1=came, 2=confirmed came
  return record.attendance >= 1;
}

/**
 * Format record datetime from Unix timestamp
 */
export function formatRecordDatetime(timestamp: number): Date {
  return new Date(timestamp * 1000);
}

// ============================================================================
// Export default client factory
// ============================================================================

export default {
  createClient: createAltegioClient,
  normalizePhone,
  phonesMatch,
  calculateRecordTotal,
  isValidRecord,
  isCompletedVisit,
  formatRecordDatetime,
};
