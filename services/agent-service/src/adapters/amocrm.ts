/**
 * AmoCRM API Adapter
 *
 * Provides integration with AmoCRM API v4
 * https://www.amocrm.ru/developers/content/crm_platform/platform-abilities
 *
 * @module adapters/amocrm
 */

import fetch from 'node-fetch';

/**
 * AmoCRM OAuth token response
 */
export interface AmoCRMTokenResponse {
  token_type: string;
  expires_in: number;
  access_token: string;
  refresh_token: string;
}

/**
 * AmoCRM contact data structure
 */
export interface AmoCRMContact {
  id?: number;
  name?: string;
  first_name?: string;
  last_name?: string;
  responsible_user_id?: number;
  created_by?: number;
  updated_by?: number;
  created_at?: number;
  updated_at?: number;
  custom_fields_values?: AmoCRMCustomFieldValue[];
  _embedded?: {
    tags?: Array<{ id: number; name: string }>;
  };
}

/**
 * AmoCRM lead data structure
 */
export interface AmoCRMLead {
  id?: number;
  name: string;
  price?: number;
  responsible_user_id?: number;
  status_id?: number;
  pipeline_id?: number;
  created_by?: number;
  updated_by?: number;
  created_at?: number;
  updated_at?: number;
  closed_at?: number;
  custom_fields_values?: AmoCRMCustomFieldValue[];
  _embedded?: {
    tags?: Array<{ id: number; name: string }>;
    contacts?: AmoCRMContact[];
  };
}

/**
 * AmoCRM custom field value
 */
export interface AmoCRMCustomFieldValue {
  field_id?: number;
  field_name?: string;
  field_code?: string;
  field_type?: string;
  values: Array<{
    value: string | number | boolean;
    enum_id?: number;
    enum_code?: string;
  }>;
}

/**
 * AmoCRM API error response
 */
export interface AmoCRMError {
  status: number;
  title: string;
  detail?: string;
  validation_errors?: Array<{
    request_id: string;
    errors: Array<{
      code: string;
      path: string;
      detail: string;
    }>;
  }>;
}

/**
 * Options for making AmoCRM API requests
 */
export interface AmoCRMRequestOptions {
  subdomain: string;
  accessToken: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  endpoint: string;
  body?: any;
  query?: Record<string, string | number>;
}

/**
 * Rate limiter for AmoCRM API (7 requests per second)
 */
class RateLimiter {
  private queue: Array<() => void> = [];
  private requestCount = 0;
  private readonly maxRequests = 7;
  private readonly interval = 1000; // 1 second

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

    // Wait for next interval
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

/**
 * Make a request to AmoCRM API with automatic rate limiting
 *
 * @param options - Request options
 * @returns Response data
 */
export async function amocrmRequest<T = any>(
  options: AmoCRMRequestOptions
): Promise<T> {
  return rateLimiter.execute(async () => {
    const { subdomain, accessToken, method = 'GET', endpoint, body, query } = options;

    // Build URL
    let url = `https://${subdomain}.amocrm.ru/api/v4/${endpoint}`;
    if (query) {
      const params = new URLSearchParams();
      Object.entries(query).forEach(([key, value]) => {
        params.append(key, String(value));
      });
      url += `?${params.toString()}`;
    }

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: body ? JSON.stringify(body) : undefined
      });

      // Handle 204 No Content
      if (response.status === 204) {
        return {} as T;
      }

      const data = await response.json();

      if (!response.ok) {
        const error = data as AmoCRMError;
        throw new Error(
          `AmoCRM API error: ${error.status} ${error.title}` +
          (error.detail ? ` - ${error.detail}` : '')
        );
      }

      return data as T;
    } catch (error: any) {
      if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
        throw new Error(`AmoCRM API connection error: ${error.message}`);
      }
      throw error;
    }
  });
}

/**
 * Exchange authorization code for access token
 *
 * @param code - Authorization code from OAuth callback
 * @param subdomain - AmoCRM subdomain
 * @returns Token response
 */
export async function exchangeCodeForToken(
  code: string,
  subdomain: string,
  clientId?: string,
  clientSecret?: string
): Promise<AmoCRMTokenResponse> {
  // Use provided credentials or fall back to environment variables
  const actualClientId = clientId || process.env.AMOCRM_CLIENT_ID;
  const actualClientSecret = clientSecret || process.env.AMOCRM_CLIENT_SECRET;
  const redirectUri = process.env.AMOCRM_REDIRECT_URI;

  if (!actualClientId || !actualClientSecret || !redirectUri) {
    throw new Error('AmoCRM OAuth credentials not configured (neither provided nor in environment)');
  }

  const url = `https://${subdomain}.amocrm.ru/oauth2/access_token`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      client_id: actualClientId,
      client_secret: actualClientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`AmoCRM OAuth error: ${response.status} - ${error}`);
  }

  return response.json() as Promise<AmoCRMTokenResponse>;
}

/**
 * Refresh access token using refresh token
 *
 * @param refreshToken - Refresh token
 * @param subdomain - AmoCRM subdomain
 * @returns New token response
 */
export async function refreshAccessToken(
  refreshToken: string,
  subdomain: string,
  clientIdOverride?: string,
  clientSecretOverride?: string
): Promise<AmoCRMTokenResponse> {
  // Use provided credentials (for auto-created integrations) or fall back to env vars
  const clientId = clientIdOverride || process.env.AMOCRM_CLIENT_ID;
  const clientSecret = clientSecretOverride || process.env.AMOCRM_CLIENT_SECRET;
  const redirectUri = process.env.AMOCRM_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('AmoCRM OAuth credentials not configured (neither in DB nor environment)');
  }

  const url = `https://${subdomain}.amocrm.ru/oauth2/access_token`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      redirect_uri: redirectUri
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`AmoCRM token refresh error: ${response.status} - ${error}`);
  }

  return response.json() as Promise<AmoCRMTokenResponse>;
}

/**
 * Get contact by ID
 *
 * @param contactId - Contact ID
 * @param subdomain - AmoCRM subdomain
 * @param accessToken - Access token
 * @returns Contact
 */
export async function getContact(
  contactId: number,
  subdomain: string,
  accessToken: string
): Promise<AmoCRMContact> {
  return amocrmRequest({
    subdomain,
    accessToken,
    endpoint: `contacts/${contactId}`
  });
}

/**
 * Find contact by phone number
 *
 * @param phone - Phone number to search
 * @param subdomain - AmoCRM subdomain
 * @param accessToken - Access token
 * @returns Contact if found, null otherwise
 */
export async function findContactByPhone(
  phone: string,
  subdomain: string,
  accessToken: string
): Promise<AmoCRMContact | null> {
  try {
    const response = await amocrmRequest<{ _embedded: { contacts: AmoCRMContact[] } }>({
      subdomain,
      accessToken,
      endpoint: 'contacts',
      query: {
        query: phone
      }
    });

    const contacts = response._embedded?.contacts || [];
    return contacts.length > 0 ? contacts[0] : null;
  } catch (error) {
    console.error('Error finding contact by phone:', error);
    return null;
  }
}

/**
 * Create a new contact in AmoCRM
 *
 * @param contact - Contact data
 * @param subdomain - AmoCRM subdomain
 * @param accessToken - Access token
 * @returns Created contact
 */
export async function createContact(
  contact: AmoCRMContact,
  subdomain: string,
  accessToken: string
): Promise<AmoCRMContact> {
  const response = await amocrmRequest<{ _embedded: { contacts: AmoCRMContact[] } }>({
    subdomain,
    accessToken,
    method: 'POST',
    endpoint: 'contacts',
    body: [contact]
  });

  const contacts = response._embedded?.contacts || [];
  if (contacts.length === 0) {
    throw new Error('Failed to create contact in AmoCRM');
  }

  return contacts[0];
}

/**
 * Create a new lead in AmoCRM
 *
 * @param lead - Lead data
 * @param subdomain - AmoCRM subdomain
 * @param accessToken - Access token
 * @returns Created lead
 */
export async function createLead(
  lead: AmoCRMLead,
  subdomain: string,
  accessToken: string
): Promise<AmoCRMLead> {
  const response = await amocrmRequest<{ _embedded: { leads: AmoCRMLead[] } }>({
    subdomain,
    accessToken,
    method: 'POST',
    endpoint: 'leads',
    body: [lead]
  });

  const leads = response._embedded?.leads || [];
  if (leads.length === 0) {
    throw new Error('Failed to create lead in AmoCRM');
  }

  return leads[0];
}

/**
 * Get lead by ID
 *
 * @param leadId - Lead ID
 * @param subdomain - AmoCRM subdomain
 * @param accessToken - Access token
 * @returns Lead data
 */
export async function getLead(
  leadId: number,
  subdomain: string,
  accessToken: string
): Promise<AmoCRMLead> {
  return amocrmRequest<AmoCRMLead>({
    subdomain,
    accessToken,
    endpoint: `leads/${leadId}`,
    query: {
      with: 'contacts'
    }
  });
}

/**
 * Get all custom fields for leads
 *
 * @param subdomain - AmoCRM subdomain
 * @param accessToken - Access token
 * @returns Custom fields array
 */
export async function getLeadCustomFields(
  subdomain: string,
  accessToken: string
): Promise<any[]> {
  const response = await amocrmRequest<{ _embedded: { custom_fields: any[] } }>({
    subdomain,
    accessToken,
    endpoint: 'leads/custom_fields'
  });

  return response._embedded?.custom_fields || [];
}

/**
 * Get account info (for testing connection)
 *
 * @param subdomain - AmoCRM subdomain
 * @param accessToken - Access token
 * @returns Account info
 */
export async function getAccountInfo(
  subdomain: string,
  accessToken: string
): Promise<any> {
  return amocrmRequest({
    subdomain,
    accessToken,
    endpoint: 'account'
  });
}

/**
 * AmoCRM Pipeline structure
 */
export interface AmoCRMPipeline {
  id: number;
  name: string;
  sort: number;
  is_main: boolean;
  is_unsorted_on: boolean;
  is_archive: boolean;
  account_id: number;
  _embedded: {
    statuses: AmoCRMPipelineStatus[];
  };
}

/**
 * AmoCRM Pipeline Status (Stage)
 */
export interface AmoCRMPipelineStatus {
  id: number;
  name: string;
  sort: number;
  is_editable: boolean;
  pipeline_id: number;
  color: string;
  type: number;
  account_id: number;
}

/**
 * Get all pipelines (воронки) with their stages (этапы)
 *
 * @param subdomain - AmoCRM subdomain
 * @param accessToken - Access token
 * @returns Array of pipelines with embedded statuses
 */
export async function getPipelines(
  subdomain: string,
  accessToken: string
): Promise<AmoCRMPipeline[]> {
  const response = await amocrmRequest<{ _embedded: { pipelines: AmoCRMPipeline[] } }>({
    subdomain,
    accessToken,
    endpoint: 'leads/pipelines'
  });

  return response._embedded?.pipelines || [];
}

/**
 * Get leads by list of IDs (массовое получение)
 *
 * @param leadIds - Array of lead IDs
 * @param subdomain - AmoCRM subdomain
 * @param accessToken - Access token
 * @param limit - Limit per page (max 250)
 * @returns Array of leads
 */
export async function getLeadsByIds(
  leadIds: number[],
  subdomain: string,
  accessToken: string,
  limit: number = 250
): Promise<AmoCRMLead[]> {
  if (leadIds.length === 0) return [];

  // Split into chunks of 250 (API limit)
  const chunks: number[][] = [];
  for (let i = 0; i < leadIds.length; i += limit) {
    chunks.push(leadIds.slice(i, i + limit));
  }

  const allLeads: AmoCRMLead[] = [];

  for (const chunk of chunks) {
    const query: Record<string, string | number> = {
      limit
    };

    // Add filter[id][] for each ID
    chunk.forEach((id, index) => {
      query[`filter[id][${index}]`] = id;
    });

    const response = await amocrmRequest<{ _embedded: { leads: AmoCRMLead[] } }>({
      subdomain,
      accessToken,
      endpoint: 'leads',
      query
    });

    const leads = response._embedded?.leads || [];
    allLeads.push(...leads);
  }

  return allLeads;
}

/**
 * Get contact with phone number
 *
 * @param contactId - Contact ID
 * @param subdomain - AmoCRM subdomain
 * @param accessToken - Access token
 * @returns Contact with custom fields
 */
export async function getContact(
  contactId: number,
  subdomain: string,
  accessToken: string
): Promise<AmoCRMContact> {
  return amocrmRequest<AmoCRMContact>({
    subdomain,
    accessToken,
    endpoint: `contacts/${contactId}`
  });
}

/**
 * Extract phone number from contact's custom fields
 *
 * @param contact - AmoCRM contact
 * @returns Normalized phone number or null
 */
export function extractPhoneFromContact(contact: AmoCRMContact): string | null {
  const phoneField = contact.custom_fields_values?.find(
    field => field.field_code === 'PHONE'
  );

  if (!phoneField?.values?.[0]?.value) {
    return null;
  }

  return String(phoneField.values[0].value);
}

/**
 * Subscribe to webhooks
 *
 * @param destination - Webhook URL
 * @param settings - Array of webhook events
 * @param subdomain - AmoCRM subdomain
 * @param accessToken - Access token
 * @returns Created webhook
 */
export async function subscribeWebhook(
  destination: string,
  settings: string[],
  subdomain: string,
  accessToken: string
): Promise<any> {
  return amocrmRequest({
    subdomain,
    accessToken,
    method: 'POST',
    endpoint: 'webhooks',
    body: {
      destination,
      settings,
      sort: 10
    }
  });
}

/**
 * Get list of subscribed webhooks
 *
 * @param subdomain - AmoCRM subdomain
 * @param accessToken - Access token
 * @returns Array of webhooks
 */
export async function getWebhooks(
  subdomain: string,
  accessToken: string
): Promise<any[]> {
  const response = await amocrmRequest<{ _embedded: { webhooks: any[] } }>({
    subdomain,
    accessToken,
    endpoint: 'webhooks'
  });

  return response._embedded?.webhooks || [];
}

/**
 * Unsubscribe from webhook
 *
 * @param webhookId - Webhook ID
 * @param subdomain - AmoCRM subdomain
 * @param accessToken - Access token
 */
export async function unsubscribeWebhook(
  webhookId: string,
  subdomain: string,
  accessToken: string
): Promise<void> {
  await amocrmRequest({
    subdomain,
    accessToken,
    method: 'DELETE',
    endpoint: `webhooks/${webhookId}`
  });
}
