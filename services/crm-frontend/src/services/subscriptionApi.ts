import {
  SubscriptionProduct,
  SubscriptionSale,
  SubscriptionSweepStats,
  SubscriptionUserSearchItem,
  PhoneUserLink
} from '@/types/subscription';

const API_BASE_URL = import.meta.env.VITE_CRM_BACKEND_URL || '/api/crm';

function getUserId(): string {
  const raw = localStorage.getItem('user');
  if (!raw) {
    throw new Error('User not authenticated');
  }
  const user = JSON.parse(raw);
  return user.id;
}

async function fetchWithAuth<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': getUserId(),
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || payload.message || 'Subscription API request failed');
  }

  return response.json();
}

export const subscriptionApi = {
  getProducts(includeInactive = false): Promise<SubscriptionProduct[]> {
    const query = includeInactive ? '?include_inactive=true' : '';
    return fetchWithAuth(`/subscription/products${query}`);
  },

  getSales(params?: {
    consultant_id?: string;
    status?: string;
    search?: string;
    sale_kind?: string;
    include_user?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ sales: SubscriptionSale[]; limit: number; offset: number }> {
    const query = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          query.append(key, String(value));
        }
      });
    }

    return fetchWithAuth(`/subscription/sales${query.toString() ? `?${query}` : ''}`);
  },

  createSale(payload: {
    consultant_id?: string;
    client_name?: string;
    client_phone: string;
    product_id?: string;
    custom_product_name?: string;
    amount?: number;
    months?: number;
    sale_date?: string;
    comment?: string;
  }): Promise<SubscriptionSale> {
    return fetchWithAuth('/subscription/sales', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  linkSaleToUser(saleId: string, payload: {
    user_account_id: string;
    persist_link?: boolean;
    notes?: string;
  }): Promise<SubscriptionSale> {
    return fetchWithAuth(`/subscription/sales/${saleId}/link-user`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  applySale(saleId: string): Promise<{ success: boolean; sale: SubscriptionSale }> {
    return fetchWithAuth(`/subscription/sales/${saleId}/apply`, {
      method: 'POST'
    });
  },

  cancelSale(saleId: string): Promise<{ success: boolean; sale: SubscriptionSale; warning?: string }> {
    return fetchWithAuth(`/subscription/sales/${saleId}/cancel`, {
      method: 'POST'
    });
  },

  setUserSubscription(userAccountId: string, payload: {
    months: number;
    amount: number;
    comment?: string;
    source_sale_id?: string;
    start_date?: string;
  }): Promise<{ success: boolean }> {
    return fetchWithAuth(`/admin/subscriptions/users/${userAccountId}/set`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  searchUsers(queryString: string, limit = 20): Promise<SubscriptionUserSearchItem[]> {
    const query = new URLSearchParams({ q: queryString, limit: String(limit) });
    return fetchWithAuth(`/admin/subscriptions/user-search?${query}`);
  },

  getPhoneLinks(phone: string): Promise<{ normalized_phone: string; links: PhoneUserLink[] }> {
    const query = new URLSearchParams({ phone });
    return fetchWithAuth(`/admin/subscriptions/phone-links?${query}`);
  },

  upsertPhoneLink(payload: {
    phone: string;
    user_account_id: string;
    active?: boolean;
    notes?: string;
  }): Promise<PhoneUserLink> {
    return fetchWithAuth('/admin/subscriptions/phone-links', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  runJobs(): Promise<{ success: boolean; stats: SubscriptionSweepStats }> {
    return fetchWithAuth('/admin/subscriptions/run-jobs', {
      method: 'POST'
    });
  }
};
