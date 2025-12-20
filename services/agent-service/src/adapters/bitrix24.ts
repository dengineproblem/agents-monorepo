/**
 * Bitrix24 CRM API Adapter
 *
 * Provides integration with Bitrix24 REST API
 * https://apidocs.bitrix24.com/
 *
 * Key differences from AmoCRM:
 * - Leads and Deals are separate entities
 * - Rate limit: 2 requests per second (vs 7 in AmoCRM)
 * - Token lifetime: 1 hour (vs 24 hours in AmoCRM)
 * - Batch requests supported (up to 50 methods per call)
 * - Phone search via crm.duplicate.findbycomm
 *
 * @module adapters/bitrix24
 */

import fetch from 'node-fetch';

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Bitrix24 OAuth token response
 */
export interface Bitrix24TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  domain: string;
  member_id: string;
  user_id: number;
  status: string;
  server_endpoint?: string;
  client_endpoint?: string;
}

/**
 * Bitrix24 Lead structure
 */
export interface Bitrix24Lead {
  ID?: string;
  TITLE?: string;
  NAME?: string;
  SECOND_NAME?: string;
  LAST_NAME?: string;
  STATUS_ID?: string;
  STATUS_SEMANTIC_ID?: string;
  CURRENCY_ID?: string;
  OPPORTUNITY?: string;
  PHONE?: Array<{ VALUE: string; VALUE_TYPE: string }>;
  EMAIL?: Array<{ VALUE: string; VALUE_TYPE: string }>;
  WEB?: Array<{ VALUE: string; VALUE_TYPE: string }>;
  ASSIGNED_BY_ID?: string;
  CREATED_BY_ID?: string;
  DATE_CREATE?: string;
  DATE_MODIFY?: string;
  SOURCE_ID?: string;
  SOURCE_DESCRIPTION?: string;
  COMMENTS?: string;
  UTM_SOURCE?: string;
  UTM_MEDIUM?: string;
  UTM_CAMPAIGN?: string;
  UTM_CONTENT?: string;
  UTM_TERM?: string;
  CONTACT_ID?: string;
  COMPANY_ID?: string;
  [key: string]: any; // For user fields (UF_CRM_*)
}

/**
 * Bitrix24 Deal structure
 */
export interface Bitrix24Deal {
  ID?: string;
  TITLE?: string;
  STAGE_ID?: string;
  STAGE_SEMANTIC_ID?: string;
  CATEGORY_ID?: string;
  CURRENCY_ID?: string;
  OPPORTUNITY?: string;
  IS_MANUAL_OPPORTUNITY?: string;
  TAX_VALUE?: string;
  COMPANY_ID?: string;
  CONTACT_ID?: string;
  ASSIGNED_BY_ID?: string;
  CREATED_BY_ID?: string;
  DATE_CREATE?: string;
  DATE_MODIFY?: string;
  CLOSEDATE?: string;
  CLOSED?: string;
  SOURCE_ID?: string;
  SOURCE_DESCRIPTION?: string;
  COMMENTS?: string;
  UTM_SOURCE?: string;
  UTM_MEDIUM?: string;
  UTM_CAMPAIGN?: string;
  UTM_CONTENT?: string;
  UTM_TERM?: string;
  [key: string]: any; // For user fields (UF_CRM_*)
}

/**
 * Bitrix24 Contact structure
 */
export interface Bitrix24Contact {
  ID?: string;
  NAME?: string;
  SECOND_NAME?: string;
  LAST_NAME?: string;
  PHONE?: Array<{ VALUE: string; VALUE_TYPE: string }>;
  EMAIL?: Array<{ VALUE: string; VALUE_TYPE: string }>;
  WEB?: Array<{ VALUE: string; VALUE_TYPE: string }>;
  ASSIGNED_BY_ID?: string;
  CREATED_BY_ID?: string;
  DATE_CREATE?: string;
  DATE_MODIFY?: string;
  SOURCE_ID?: string;
  COMPANY_ID?: string;
  [key: string]: any;
}

/**
 * Bitrix24 Deal Category (Pipeline)
 */
export interface Bitrix24DealCategory {
  ID: string;
  CREATED_DATE: string;
  NAME: string;
  IS_LOCKED: string;
  SORT: string;
}

/**
 * Bitrix24 Status (Stage)
 */
export interface Bitrix24Status {
  ID: string;
  ENTITY_ID: string;
  STATUS_ID: string;
  NAME: string;
  NAME_INIT?: string;
  SORT: string;
  SYSTEM?: string;
  COLOR?: string;
  SEMANTICS?: string;
  CATEGORY_ID?: string;
  EXTRA?: {
    SEMANTICS?: string;
    COLOR?: string;
  };
}

/**
 * Bitrix24 User Field
 */
export interface Bitrix24UserField {
  ID: string;
  ENTITY_ID: string;
  FIELD_NAME: string;
  USER_TYPE_ID: string;
  XML_ID?: string;
  SORT: string;
  MULTIPLE: string;
  MANDATORY: string;
  SHOW_FILTER: string;
  SHOW_IN_LIST: string;
  EDIT_IN_LIST: string;
  IS_SEARCHABLE: string;
  EDIT_FORM_LABEL?: Record<string, string>;
  LIST_COLUMN_LABEL?: Record<string, string>;
  LIST_FILTER_LABEL?: Record<string, string>;
  ERROR_MESSAGE?: Record<string, string>;
  HELP_MESSAGE?: Record<string, string>;
  LIST?: Array<{
    ID: string;
    SORT: string;
    VALUE: string;
    DEF: string;
    XML_ID?: string;
  }>;
  SETTINGS?: Record<string, any>;
}

/**
 * Bitrix24 API Error
 */
export interface Bitrix24Error {
  error: string;
  error_description: string;
}

/**
 * Options for making Bitrix24 API requests
 */
export interface Bitrix24RequestOptions {
  domain: string;
  accessToken: string;
  method: string;
  params?: Record<string, any>;
}

/**
 * Batch request command
 */
export interface BatchCommand {
  method: string;
  params?: Record<string, any>;
}

// ============================================================================
// Rate Limiter (2 requests per second for Bitrix24)
// ============================================================================

class RateLimiter {
  private queue: Array<() => void> = [];
  private requestCount = 0;
  private readonly maxRequests = 2;
  private readonly interval = 1000;

  constructor() {
    setInterval(() => {
      this.requestCount = 0;
      this.processQueue();
    }, this.interval);
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.requestCount < this.maxRequests) {
      this.requestCount++;
      return fn();
    }

    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          this.requestCount++;
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  private processQueue() {
    while (this.queue.length > 0 && this.requestCount < this.maxRequests) {
      const fn = this.queue.shift();
      if (fn) fn();
    }
  }
}

const rateLimiter = new RateLimiter();

// ============================================================================
// Core API Functions
// ============================================================================

/**
 * Make a request to Bitrix24 REST API
 *
 * @param options - Request options
 * @returns API response data
 */
export async function bitrix24Request<T = any>(
  options: Bitrix24RequestOptions
): Promise<T> {
  return rateLimiter.execute(async () => {
    const { domain, accessToken, method, params = {} } = options;

    // Bitrix24 REST API URL format
    const url = `https://${domain}/rest/${method}`;

    // Add auth token to params
    const requestParams = {
      ...params,
      auth: accessToken,
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestParams),
      });

      const data = await response.json();

      // Check for errors
      if (data.error) {
        const error = data as Bitrix24Error;
        throw new Error(
          `Bitrix24 API error: ${error.error} - ${error.error_description}`
        );
      }

      return data.result as T;
    } catch (error: any) {
      if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
        throw new Error(`Bitrix24 API connection error: ${error.message}`);
      }
      throw error;
    }
  });
}

/**
 * Make a batch request (up to 50 methods per call)
 *
 * @param domain - Bitrix24 domain
 * @param accessToken - Access token
 * @param commands - Object with named commands
 * @param halt - Stop on first error (0 or 1)
 * @returns Results keyed by command names
 */
export async function bitrix24Batch<T = Record<string, any>>(
  domain: string,
  accessToken: string,
  commands: Record<string, string>,
  halt: 0 | 1 = 0
): Promise<T> {
  const result = await bitrix24Request<{
    result: T;
    result_error: Record<string, any>;
    result_total: Record<string, number>;
    result_next: Record<string, number>;
  }>({
    domain,
    accessToken,
    method: 'batch',
    params: {
      halt,
      cmd: commands,
    },
  });

  return result as unknown as T;
}

// ============================================================================
// OAuth Functions
// ============================================================================

/**
 * Build OAuth authorization URL
 *
 * @param domain - Bitrix24 domain
 * @param clientId - Application client ID
 * @param redirectUri - Redirect URI after authorization
 * @param state - Optional state parameter
 * @returns Authorization URL
 */
export function getAuthUrl(
  domain: string,
  clientId: string,
  redirectUri: string,
  state?: string
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
  });

  if (state) {
    params.append('state', state);
  }

  return `https://${domain}/oauth/authorize/?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 *
 * @param domain - Bitrix24 domain
 * @param code - Authorization code from callback
 * @param clientId - Application client ID
 * @param clientSecret - Application client secret
 * @param redirectUri - Redirect URI (must match the one used in auth)
 * @returns Token response
 */
export async function exchangeCodeForToken(
  domain: string,
  code: string,
  clientId?: string,
  clientSecret?: string,
  redirectUri?: string
): Promise<Bitrix24TokenResponse> {
  const actualClientId = clientId || process.env.BITRIX24_CLIENT_ID;
  const actualClientSecret = clientSecret || process.env.BITRIX24_CLIENT_SECRET;
  const actualRedirectUri = redirectUri || process.env.BITRIX24_REDIRECT_URI;

  if (!actualClientId || !actualClientSecret || !actualRedirectUri) {
    throw new Error('Bitrix24 OAuth credentials not configured');
  }

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: actualClientId,
    client_secret: actualClientSecret,
    redirect_uri: actualRedirectUri,
    code,
  });

  const url = `https://${domain}/oauth/token/?${params.toString()}`;

  const response = await fetch(url, { method: 'GET' });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Bitrix24 OAuth error: ${response.status} - ${error}`);
  }

  return response.json() as Promise<Bitrix24TokenResponse>;
}

/**
 * Refresh access token
 *
 * @param domain - Bitrix24 domain
 * @param refreshToken - Refresh token
 * @param clientId - Application client ID
 * @param clientSecret - Application client secret
 * @returns New token response
 */
export async function refreshAccessToken(
  domain: string,
  refreshToken: string,
  clientId?: string,
  clientSecret?: string
): Promise<Bitrix24TokenResponse> {
  const actualClientId = clientId || process.env.BITRIX24_CLIENT_ID;
  const actualClientSecret = clientSecret || process.env.BITRIX24_CLIENT_SECRET;

  if (!actualClientId || !actualClientSecret) {
    throw new Error('Bitrix24 OAuth credentials not configured');
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: actualClientId,
    client_secret: actualClientSecret,
    refresh_token: refreshToken,
  });

  const url = `https://${domain}/oauth/token/?${params.toString()}`;

  const response = await fetch(url, { method: 'GET' });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Bitrix24 token refresh error: ${response.status} - ${error}`);
  }

  return response.json() as Promise<Bitrix24TokenResponse>;
}

// ============================================================================
// Lead Functions
// ============================================================================

/**
 * Get list of leads
 *
 * @param domain - Bitrix24 domain
 * @param accessToken - Access token
 * @param filter - Optional filter
 * @param select - Fields to select
 * @param order - Sort order
 * @param start - Pagination offset
 * @returns Array of leads
 */
export async function getLeads(
  domain: string,
  accessToken: string,
  filter?: Record<string, any>,
  select?: string[],
  order?: Record<string, string>,
  start?: number
): Promise<Bitrix24Lead[]> {
  const params: Record<string, any> = {};

  if (filter) params.filter = filter;
  if (select) params.select = select;
  if (order) params.order = order;
  if (start !== undefined) params.start = start;

  return bitrix24Request<Bitrix24Lead[]>({
    domain,
    accessToken,
    method: 'crm.lead.list',
    params,
  });
}

/**
 * Get lead by ID
 *
 * @param domain - Bitrix24 domain
 * @param accessToken - Access token
 * @param leadId - Lead ID
 * @returns Lead data
 */
export async function getLead(
  domain: string,
  accessToken: string,
  leadId: number | string
): Promise<Bitrix24Lead> {
  return bitrix24Request<Bitrix24Lead>({
    domain,
    accessToken,
    method: 'crm.lead.get',
    params: { id: leadId },
  });
}

/**
 * Create a new lead
 *
 * @param domain - Bitrix24 domain
 * @param accessToken - Access token
 * @param fields - Lead fields
 * @returns Created lead ID
 */
export async function createLead(
  domain: string,
  accessToken: string,
  fields: Partial<Bitrix24Lead>
): Promise<number> {
  return bitrix24Request<number>({
    domain,
    accessToken,
    method: 'crm.lead.add',
    params: { fields },
  });
}

/**
 * Update a lead
 *
 * @param domain - Bitrix24 domain
 * @param accessToken - Access token
 * @param leadId - Lead ID
 * @param fields - Fields to update
 * @returns Success status
 */
export async function updateLead(
  domain: string,
  accessToken: string,
  leadId: number | string,
  fields: Partial<Bitrix24Lead>
): Promise<boolean> {
  return bitrix24Request<boolean>({
    domain,
    accessToken,
    method: 'crm.lead.update',
    params: { id: leadId, fields },
  });
}

/**
 * Get lead custom fields (user fields)
 *
 * @param domain - Bitrix24 domain
 * @param accessToken - Access token
 * @returns Array of user fields
 */
export async function getLeadUserFields(
  domain: string,
  accessToken: string
): Promise<Bitrix24UserField[]> {
  return bitrix24Request<Bitrix24UserField[]>({
    domain,
    accessToken,
    method: 'crm.lead.userfield.list',
  });
}

/**
 * Get lead statuses
 *
 * @param domain - Bitrix24 domain
 * @param accessToken - Access token
 * @returns Array of lead statuses
 */
export async function getLeadStatuses(
  domain: string,
  accessToken: string
): Promise<Bitrix24Status[]> {
  return bitrix24Request<Bitrix24Status[]>({
    domain,
    accessToken,
    method: 'crm.status.list',
    params: {
      filter: { ENTITY_ID: 'STATUS' },
      order: { SORT: 'ASC' },
    },
  });
}

// ============================================================================
// Deal Functions
// ============================================================================

/**
 * Get list of deals
 *
 * @param domain - Bitrix24 domain
 * @param accessToken - Access token
 * @param filter - Optional filter
 * @param select - Fields to select
 * @param order - Sort order
 * @param start - Pagination offset
 * @returns Array of deals
 */
export async function getDeals(
  domain: string,
  accessToken: string,
  filter?: Record<string, any>,
  select?: string[],
  order?: Record<string, string>,
  start?: number
): Promise<Bitrix24Deal[]> {
  const params: Record<string, any> = {};

  if (filter) params.filter = filter;
  if (select) params.select = select;
  if (order) params.order = order;
  if (start !== undefined) params.start = start;

  return bitrix24Request<Bitrix24Deal[]>({
    domain,
    accessToken,
    method: 'crm.deal.list',
    params,
  });
}

/**
 * Get deal by ID
 *
 * @param domain - Bitrix24 domain
 * @param accessToken - Access token
 * @param dealId - Deal ID
 * @returns Deal data
 */
export async function getDeal(
  domain: string,
  accessToken: string,
  dealId: number | string
): Promise<Bitrix24Deal> {
  return bitrix24Request<Bitrix24Deal>({
    domain,
    accessToken,
    method: 'crm.deal.get',
    params: { id: dealId },
  });
}

/**
 * Create a new deal
 *
 * @param domain - Bitrix24 domain
 * @param accessToken - Access token
 * @param fields - Deal fields
 * @returns Created deal ID
 */
export async function createDeal(
  domain: string,
  accessToken: string,
  fields: Partial<Bitrix24Deal>
): Promise<number> {
  return bitrix24Request<number>({
    domain,
    accessToken,
    method: 'crm.deal.add',
    params: { fields },
  });
}

/**
 * Update a deal
 *
 * @param domain - Bitrix24 domain
 * @param accessToken - Access token
 * @param dealId - Deal ID
 * @param fields - Fields to update
 * @returns Success status
 */
export async function updateDeal(
  domain: string,
  accessToken: string,
  dealId: number | string,
  fields: Partial<Bitrix24Deal>
): Promise<boolean> {
  return bitrix24Request<boolean>({
    domain,
    accessToken,
    method: 'crm.deal.update',
    params: { id: dealId, fields },
  });
}

/**
 * Get deal custom fields (user fields)
 *
 * @param domain - Bitrix24 domain
 * @param accessToken - Access token
 * @returns Array of user fields
 */
export async function getDealUserFields(
  domain: string,
  accessToken: string
): Promise<Bitrix24UserField[]> {
  return bitrix24Request<Bitrix24UserField[]>({
    domain,
    accessToken,
    method: 'crm.deal.userfield.list',
  });
}

/**
 * Get deal categories (pipelines)
 *
 * @param domain - Bitrix24 domain
 * @param accessToken - Access token
 * @returns Array of deal categories
 */
export async function getDealCategories(
  domain: string,
  accessToken: string
): Promise<Bitrix24DealCategory[]> {
  return bitrix24Request<Bitrix24DealCategory[]>({
    domain,
    accessToken,
    method: 'crm.dealcategory.list',
  });
}

/**
 * Get deal stages for a category
 *
 * @param domain - Bitrix24 domain
 * @param accessToken - Access token
 * @param categoryId - Category ID (0 for default pipeline)
 * @returns Array of stages
 */
export async function getDealStages(
  domain: string,
  accessToken: string,
  categoryId: number = 0
): Promise<Bitrix24Status[]> {
  // For default pipeline, ENTITY_ID is 'DEAL_STAGE'
  // For custom pipelines, ENTITY_ID is 'DEAL_STAGE_{categoryId}'
  const entityId = categoryId === 0 ? 'DEAL_STAGE' : `DEAL_STAGE_${categoryId}`;

  return bitrix24Request<Bitrix24Status[]>({
    domain,
    accessToken,
    method: 'crm.status.list',
    params: {
      filter: { ENTITY_ID: entityId },
      order: { SORT: 'ASC' },
    },
  });
}

/**
 * Get all deal stages across all categories
 *
 * @param domain - Bitrix24 domain
 * @param accessToken - Access token
 * @returns Array of all stages with category info
 */
export async function getAllDealStages(
  domain: string,
  accessToken: string
): Promise<Bitrix24Status[]> {
  // First get all categories
  const categories = await getDealCategories(domain, accessToken);

  // Get stages for default pipeline
  const defaultStages = await getDealStages(domain, accessToken, 0);

  // Get stages for each custom category
  const allStages = [...defaultStages];

  for (const category of categories) {
    const categoryId = parseInt(category.ID, 10);
    if (categoryId > 0) {
      const stages = await getDealStages(domain, accessToken, categoryId);
      allStages.push(...stages);
    }
  }

  return allStages;
}

// ============================================================================
// Contact Functions
// ============================================================================

/**
 * Get list of contacts
 *
 * @param domain - Bitrix24 domain
 * @param accessToken - Access token
 * @param filter - Optional filter
 * @param select - Fields to select
 * @returns Array of contacts
 */
export async function getContacts(
  domain: string,
  accessToken: string,
  filter?: Record<string, any>,
  select?: string[]
): Promise<Bitrix24Contact[]> {
  const params: Record<string, any> = {};

  if (filter) params.filter = filter;
  if (select) params.select = select;

  return bitrix24Request<Bitrix24Contact[]>({
    domain,
    accessToken,
    method: 'crm.contact.list',
    params,
  });
}

/**
 * Get contact by ID
 *
 * @param domain - Bitrix24 domain
 * @param accessToken - Access token
 * @param contactId - Contact ID
 * @returns Contact data
 */
export async function getContact(
  domain: string,
  accessToken: string,
  contactId: number | string
): Promise<Bitrix24Contact> {
  return bitrix24Request<Bitrix24Contact>({
    domain,
    accessToken,
    method: 'crm.contact.get',
    params: { id: contactId },
  });
}

/**
 * Create a new contact
 *
 * @param domain - Bitrix24 domain
 * @param accessToken - Access token
 * @param fields - Contact fields
 * @returns Created contact ID
 */
export async function createContact(
  domain: string,
  accessToken: string,
  fields: Partial<Bitrix24Contact>
): Promise<number> {
  return bitrix24Request<number>({
    domain,
    accessToken,
    method: 'crm.contact.add',
    params: { fields },
  });
}

/**
 * Find contacts/leads/deals by phone using duplicate finder
 * This is the recommended way to search by phone in Bitrix24
 *
 * @param domain - Bitrix24 domain
 * @param accessToken - Access token
 * @param phones - Array of phone numbers to search (max 20)
 * @param entityType - Entity type: 'CONTACT', 'LEAD', or 'COMPANY'
 * @returns Object with entity IDs keyed by entity type
 */
export async function findByPhone(
  domain: string,
  accessToken: string,
  phones: string[],
  entityType: 'CONTACT' | 'LEAD' | 'COMPANY' = 'CONTACT'
): Promise<{ CONTACT?: number[]; LEAD?: number[]; COMPANY?: number[] }> {
  // Normalize phone numbers
  const normalizedPhones = phones.map(normalizePhone);

  const result = await bitrix24Request<{
    CONTACT?: number[];
    LEAD?: number[];
    COMPANY?: number[];
  }>({
    domain,
    accessToken,
    method: 'crm.duplicate.findbycomm',
    params: {
      entity_type: entityType,
      type: 'PHONE',
      values: normalizedPhones,
    },
  });

  return result || {};
}

/**
 * Find contact by phone number
 *
 * @param domain - Bitrix24 domain
 * @param accessToken - Access token
 * @param phone - Phone number
 * @returns Contact if found, null otherwise
 */
export async function findContactByPhone(
  domain: string,
  accessToken: string,
  phone: string
): Promise<Bitrix24Contact | null> {
  try {
    const result = await findByPhone(domain, accessToken, [phone], 'CONTACT');

    if (result.CONTACT && result.CONTACT.length > 0) {
      // Get first found contact
      return getContact(domain, accessToken, result.CONTACT[0]);
    }

    return null;
  } catch (error) {
    console.error('Error finding contact by phone:', error);
    return null;
  }
}

/**
 * Get contact custom fields (user fields)
 *
 * @param domain - Bitrix24 domain
 * @param accessToken - Access token
 * @returns Array of user fields
 */
export async function getContactUserFields(
  domain: string,
  accessToken: string
): Promise<Bitrix24UserField[]> {
  return bitrix24Request<Bitrix24UserField[]>({
    domain,
    accessToken,
    method: 'crm.contact.userfield.list',
  });
}

// ============================================================================
// Webhook Functions
// ============================================================================

/**
 * Register event handler (webhook)
 *
 * @param domain - Bitrix24 domain
 * @param accessToken - Access token
 * @param event - Event name (e.g., 'ONCRMLEADUPDATE')
 * @param handler - Handler URL
 * @returns Registration result
 */
export async function registerEvent(
  domain: string,
  accessToken: string,
  event: string,
  handler: string
): Promise<boolean> {
  return bitrix24Request<boolean>({
    domain,
    accessToken,
    method: 'event.bind',
    params: {
      event,
      handler,
    },
  });
}

/**
 * Unregister event handler
 *
 * @param domain - Bitrix24 domain
 * @param accessToken - Access token
 * @param event - Event name
 * @param handler - Handler URL
 * @returns Success status
 */
export async function unregisterEvent(
  domain: string,
  accessToken: string,
  event: string,
  handler: string
): Promise<boolean> {
  return bitrix24Request<boolean>({
    domain,
    accessToken,
    method: 'event.unbind',
    params: {
      event,
      handler,
    },
  });
}

/**
 * Get list of registered event handlers
 *
 * @param domain - Bitrix24 domain
 * @param accessToken - Access token
 * @returns Array of registered handlers
 */
export async function getRegisteredEvents(
  domain: string,
  accessToken: string
): Promise<Array<{ event: string; handler: string; auth_type: string }>> {
  return bitrix24Request<Array<{ event: string; handler: string; auth_type: string }>>({
    domain,
    accessToken,
    method: 'event.get',
  });
}

/**
 * Register all CRM webhooks for lead/deal tracking
 *
 * @param domain - Bitrix24 domain
 * @param accessToken - Access token
 * @param webhookUrl - Base webhook URL (user_id will be appended as query param)
 * @param userId - User account ID for webhook routing
 * @param entityTypes - Which entities to track: 'lead', 'deal', or 'both'
 */
export async function registerCRMWebhooks(
  domain: string,
  accessToken: string,
  webhookUrl: string,
  userId: string,
  entityTypes: 'lead' | 'deal' | 'both' = 'both'
): Promise<void> {
  const handlerUrl = `${webhookUrl}?user_id=${userId}`;

  const events: string[] = [];

  if (entityTypes === 'lead' || entityTypes === 'both') {
    events.push('ONCRMLEADADD', 'ONCRMLEADUPDATE', 'ONCRMLEADDELETE');
  }

  if (entityTypes === 'deal' || entityTypes === 'both') {
    events.push('ONCRMDEALADD', 'ONCRMDEALUPDATE', 'ONCRMDEALDELETE');
  }

  // Also track contact changes
  events.push('ONCRMCONTACTADD', 'ONCRMCONTACTUPDATE');

  for (const event of events) {
    try {
      await registerEvent(domain, accessToken, event, handlerUrl);
    } catch (error) {
      console.error(`Failed to register event ${event}:`, error);
    }
  }
}

/**
 * Unregister all CRM webhooks
 *
 * @param domain - Bitrix24 domain
 * @param accessToken - Access token
 * @param webhookUrl - Base webhook URL
 * @param userId - User account ID
 */
export async function unregisterCRMWebhooks(
  domain: string,
  accessToken: string,
  webhookUrl: string,
  userId: string
): Promise<void> {
  const handlerUrl = `${webhookUrl}?user_id=${userId}`;

  const events = [
    'ONCRMLEADADD',
    'ONCRMLEADUPDATE',
    'ONCRMLEADDELETE',
    'ONCRMDEALADD',
    'ONCRMDEALUPDATE',
    'ONCRMDEALDELETE',
    'ONCRMCONTACTADD',
    'ONCRMCONTACTUPDATE',
  ];

  for (const event of events) {
    try {
      await unregisterEvent(domain, accessToken, event, handlerUrl);
    } catch (error) {
      // Ignore errors when unregistering (might not be registered)
    }
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Normalize phone number for comparison
 *
 * @param phone - Phone number string
 * @returns Normalized phone (digits only)
 */
export function normalizePhone(phone: string): string {
  // Remove all non-digit characters
  let normalized = phone.replace(/\D/g, '');

  // If starts with 8 and is Russian number, replace with 7
  if (normalized.length === 11 && normalized.startsWith('8')) {
    normalized = '7' + normalized.slice(1);
  }

  return normalized;
}

/**
 * Extract phone number from Bitrix24 entity
 *
 * @param entity - Lead, Deal, or Contact
 * @returns First phone number or null
 */
export function extractPhone(
  entity: Bitrix24Lead | Bitrix24Deal | Bitrix24Contact
): string | null {
  const phones = entity.PHONE;
  if (!phones || phones.length === 0) return null;

  return phones[0].VALUE || null;
}

/**
 * Get account info (for testing connection)
 *
 * @param domain - Bitrix24 domain
 * @param accessToken - Access token
 * @returns Account profile info
 */
export async function getAccountInfo(
  domain: string,
  accessToken: string
): Promise<any> {
  return bitrix24Request({
    domain,
    accessToken,
    method: 'profile',
  });
}

/**
 * Get current user info
 *
 * @param domain - Bitrix24 domain
 * @param accessToken - Access token
 * @returns Current user data
 */
export async function getCurrentUser(
  domain: string,
  accessToken: string
): Promise<any> {
  return bitrix24Request({
    domain,
    accessToken,
    method: 'user.current',
  });
}

/**
 * Get available scope/permissions
 *
 * @param domain - Bitrix24 domain
 * @param accessToken - Access token
 * @returns Array of available scopes
 */
export async function getScope(
  domain: string,
  accessToken: string
): Promise<string[]> {
  return bitrix24Request<string[]>({
    domain,
    accessToken,
    method: 'scope',
  });
}
