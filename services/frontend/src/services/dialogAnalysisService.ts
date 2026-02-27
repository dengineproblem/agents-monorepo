import { DialogAnalysis, DialogStats, DialogFilters } from '@/types/dialogAnalysis';
import { API_BASE_URL } from '@/config/api';
import { shouldFilterByAccountId } from '@/utils/multiAccountHelper';

export const dialogAnalysisService = {
  /**
   * Get analysis results with filters
   * @param accountId - UUID рекламного аккаунта для мультиаккаунтности (опционально)
   */
  async getAnalysis(userAccountId: string, filters?: DialogFilters, accountId?: string): Promise<{ results: DialogAnalysis[]; count: number }> {
    const params = new URLSearchParams();
    if (shouldFilterByAccountId(accountId)) {
      params.set('accountId', accountId!);
    }
    if (filters?.interestLevel) {
      params.set('interestLevel', filters.interestLevel);
    }
    if (filters?.funnelStage) {
      params.set('funnelStage', filters.funnelStage);
    }
    if (filters?.minScore !== undefined) {
      params.set('minScore', String(filters.minScore));
    }
    if (filters?.qualificationComplete !== undefined) {
      params.set('qualificationComplete', String(filters.qualificationComplete));
    }

    const res = await fetch(`${API_BASE_URL}/dialogs/analysis?${params}`, {
      headers: { 'x-user-id': userAccountId },
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      console.error('API error:', errBody);
      throw new Error(errBody.error || 'Failed to fetch dialog analysis');
    }

    const body = await res.json();
    return {
      results: (body.results || []) as DialogAnalysis[],
      count: body.count || body.results?.length || 0,
    };
  },

  /**
   * Get statistics
   * @param accountId - UUID рекламного аккаунта для мультиаккаунтности (опционально)
   */
  async getStats(userAccountId: string, accountId?: string): Promise<DialogStats> {
    const params = new URLSearchParams();
    if (shouldFilterByAccountId(accountId)) {
      params.set('accountId', accountId!);
    }

    const res = await fetch(`${API_BASE_URL}/dialogs/stats?${params}`, {
      headers: { 'x-user-id': userAccountId },
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      console.error('API error:', errBody);
      throw new Error(errBody.error || 'Failed to fetch dialog stats');
    }

    const body = await res.json();
    return body.stats as DialogStats;
  },

  /**
   * Export to CSV
   * @param accountId - UUID рекламного аккаунта для мультиаккаунтности (опционально)
   */
  async exportToCsv(userAccountId: string, filters?: DialogFilters, accountId?: string): Promise<Blob> {
    const params = new URLSearchParams();
    if (shouldFilterByAccountId(accountId)) {
      params.set('accountId', accountId!);
    }
    if (filters?.interestLevel) {
      params.set('interestLevel', filters.interestLevel);
    }

    const res = await fetch(`${API_BASE_URL}/dialogs/export-csv?${params}`, {
      headers: { 'x-user-id': userAccountId },
    });

    if (!res.ok) {
      if (res.status === 404) {
        throw new Error('No results to export');
      }
      const errBody = await res.json().catch(() => ({}));
      console.error('API error:', errBody);
      throw new Error(errBody.error || 'Failed to export CSV');
    }

    const csvText = await res.text();
    return new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
  },

  /**
   * Delete analysis result
   */
  async deleteAnalysis(id: string, userAccountId: string): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/dialogs/analysis/${id}`, {
      method: 'DELETE',
      headers: { 'x-user-id': userAccountId },
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      console.error('API error:', errBody);
      throw new Error(errBody.error || 'Failed to delete analysis');
    }
  },

  /**
   * Create a new lead manually
   * @param accountId - UUID рекламного аккаунта для мультиаккаунтности (опционально)
   */
  async createLead(data: {
    phone: string;
    contactName?: string;
    businessType?: string;
    isMedical?: boolean;
    funnelStage: string;
    userAccountId: string;
    instanceName: string;
    notes?: string;
    accountId?: string;
  }): Promise<DialogAnalysis> {
    const res = await fetch(`${API_BASE_URL}/dialogs/leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': data.userAccountId,
      },
      body: JSON.stringify({
        phone: data.phone,
        contactName: data.contactName,
        businessType: data.businessType,
        isMedical: data.isMedical,
        funnelStage: data.funnelStage,
        instanceName: data.instanceName,
        notes: data.notes,
        accountId: data.accountId,
      }),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      console.error('API error:', errBody);
      throw new Error(errBody.error || 'Failed to create lead');
    }

    const body = await res.json();
    return body.lead as DialogAnalysis;
  },

  /**
   * Update a lead
   */
  async updateLead(
    id: string,
    userAccountId: string,
    updates: Partial<{
      contactName: string;
      businessType: string;
      isMedical: boolean;
      isOwner: boolean;
      hasSalesDept: boolean;
      usesAdsNow: boolean;
      adBudget: string;
      sentInstagram: boolean;
      instagramUrl: string;
      hasBooking: boolean;
      funnelStage: string;
      interestLevel: string;
      objection: string;
      nextMessage: string;
      notes: string;
      score: number;
    }>
  ): Promise<DialogAnalysis> {
    const res = await fetch(`${API_BASE_URL}/dialogs/leads/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': userAccountId,
      },
      body: JSON.stringify(updates),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      console.error('API error:', errBody);
      throw new Error(errBody.error || 'Failed to update lead');
    }

    const body = await res.json();
    if (!body.lead) {
      throw new Error('Lead not found');
    }

    return body.lead as DialogAnalysis;
  },

  /**
   * Get WhatsApp instances for user
   * @param accountId - UUID рекламного аккаунта для мультиаккаунтности (опционально)
   */
  async getInstances(userAccountId: string, accountId?: string): Promise<Array<{ id: string; instance_name: string }>> {
    const params = new URLSearchParams();
    if (shouldFilterByAccountId(accountId)) {
      params.set('accountId', accountId!);
    }

    const res = await fetch(`${API_BASE_URL}/dialogs/instances?${params}`, {
      headers: { 'x-user-id': userAccountId },
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      console.error('API error:', errBody);
      throw new Error(errBody.error || 'Failed to fetch instances');
    }

    const body = await res.json();
    return body.instances || [];
  },
};
