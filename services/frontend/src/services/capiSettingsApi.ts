/**
 * CAPI Settings API Client
 *
 * CRUD операции для настроек Meta CAPI (per-channel per-account)
 */

import { API_BASE_URL } from '@/config/api';

export type CapiChannel = 'whatsapp' | 'lead_forms' | 'site';
export type CapiSource = 'whatsapp' | 'crm';
export type CrmType = 'amocrm' | 'bitrix24';

export interface CapiFieldConfig {
  field_id: string | number;
  field_name: string;
  field_type: string;
  enum_id?: string | number | null;
  enum_value?: string | null;
  entity_type?: string;
  pipeline_id?: string | number | null;
  status_id?: string | number | null;
}

export interface CapiSettingsRecord {
  id: string;
  user_account_id: string;
  account_id: string | null;
  channel: CapiChannel;
  pixel_id: string;
  capi_access_token: string | null;
  capi_source: CapiSource;
  capi_crm_type: CrmType | null;
  capi_interest_fields: CapiFieldConfig[];
  capi_qualified_fields: CapiFieldConfig[];
  capi_scheduled_fields: CapiFieldConfig[];
  ai_l2_description: string | null;
  ai_l3_description: string | null;
  ai_generated_prompt: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateCapiSettingsInput {
  userAccountId: string;
  accountId?: string | null;
  channel: CapiChannel;
  pixel_id: string;
  capi_access_token?: string | null;
  capi_source: CapiSource;
  capi_crm_type?: CrmType | null;
  capi_interest_fields?: CapiFieldConfig[];
  capi_qualified_fields?: CapiFieldConfig[];
  capi_scheduled_fields?: CapiFieldConfig[];
  ai_l2_description?: string | null;
  ai_l3_description?: string | null;
  ai_generated_prompt?: string | null;
}

export interface UpdateCapiSettingsInput {
  pixel_id?: string;
  capi_access_token?: string | null;
  capi_source?: CapiSource;
  capi_crm_type?: CrmType | null;
  capi_interest_fields?: CapiFieldConfig[];
  capi_qualified_fields?: CapiFieldConfig[];
  capi_scheduled_fields?: CapiFieldConfig[];
  ai_l2_description?: string | null;
  ai_l3_description?: string | null;
  ai_generated_prompt?: string | null;
}

class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(message: string, status: number, body: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function apiRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new ApiError(errorBody.error || `HTTP ${response.status}`, response.status, errorBody);
  }

  return response.json();
}

export const capiSettingsApi = {
  async list(userAccountId: string, accountId?: string | null): Promise<CapiSettingsRecord[]> {
    const params = new URLSearchParams({ userAccountId });
    if (accountId) params.set('accountId', accountId);

    const result = await apiRequest<{ data: CapiSettingsRecord[] }>(
      `${API_BASE_URL}/capi-settings?${params}`
    );
    return result.data;
  },

  async get(id: string): Promise<CapiSettingsRecord> {
    const result = await apiRequest<{ data: CapiSettingsRecord }>(
      `${API_BASE_URL}/capi-settings/${id}`
    );
    return result.data;
  },

  async create(data: CreateCapiSettingsInput): Promise<CapiSettingsRecord> {
    try {
      const result = await apiRequest<{ data: CapiSettingsRecord }>(
        `${API_BASE_URL}/capi-settings`,
        { method: 'POST', body: JSON.stringify(data) }
      );
      return result.data;
    } catch (err) {
      // If channel already exists (409), auto-update instead
      if (err instanceof ApiError && err.status === 409 && err.body.existingId) {
        const { userAccountId, accountId, channel, ...updateFields } = data;
        const result = await apiRequest<{ data: CapiSettingsRecord }>(
          `${API_BASE_URL}/capi-settings/${err.body.existingId}`,
          { method: 'PATCH', body: JSON.stringify(updateFields) }
        );
        return result.data;
      }
      throw err;
    }
  },

  async update(id: string, data: UpdateCapiSettingsInput): Promise<CapiSettingsRecord> {
    const result = await apiRequest<{ data: CapiSettingsRecord }>(
      `${API_BASE_URL}/capi-settings/${id}`,
      { method: 'PATCH', body: JSON.stringify(data) }
    );
    return result.data;
  },

  async delete(id: string): Promise<boolean> {
    await apiRequest<{ success: boolean }>(
      `${API_BASE_URL}/capi-settings/${id}`,
      { method: 'DELETE' }
    );
    return true;
  },

  async generatePrompt(l2Description: string, l3Description: string): Promise<string> {
    const result = await apiRequest<{ data: { prompt: string } }>(
      `${API_BASE_URL}/capi-settings/generate-prompt`,
      {
        method: 'POST',
        body: JSON.stringify({
          ai_l2_description: l2Description,
          ai_l3_description: l3Description,
        }),
      }
    );
    return result.data.prompt;
  },
};

export const CHANNEL_LABELS: Record<CapiChannel, string> = {
  whatsapp: 'WhatsApp',
  lead_forms: 'Lead Forms',
  site: 'Сайт',
};
