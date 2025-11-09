import { DialogAnalysis, DialogFilters, FunnelStage } from '@/types/dialogAnalysis';

const API_BASE_URL = import.meta.env.VITE_CRM_BACKEND_URL || '/api';

export const dialogAnalysisService = {
  // Analyze dialogs
  async analyzeDialogs(data: {
    instanceName: string;
    userAccountId: string;
    minIncoming?: number;
    maxDialogs?: number;
    maxContacts?: number;
  }) {
    const response = await fetch(`${API_BASE_URL}/dialogs/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Failed to analyze dialogs');
    return response.json();
  },
  
  // Get analysis results
  async getAnalysis(userAccountId: string, filters?: DialogFilters): Promise<DialogAnalysis[]> {
    const params = new URLSearchParams({ userAccountId });
    if (filters?.interestLevel) params.append('interestLevel', filters.interestLevel);
    if (filters?.minScore !== undefined) params.append('minScore', filters.minScore.toString());
    if (filters?.funnelStage) params.append('funnelStage', filters.funnelStage);
    if (filters?.qualificationComplete !== undefined) params.append('qualificationComplete', filters.qualificationComplete.toString());
    if (filters?.search) params.append('search', filters.search);
    
    const response = await fetch(`${API_BASE_URL}/dialogs/analysis?${params}`);
    if (!response.ok) throw new Error('Failed to fetch analysis');
    const data = await response.json();
    return data.results || data;
  },
  
  // Get stats
  async getStats(userAccountId: string, instanceName?: string) {
    const params = new URLSearchParams({ userAccountId });
    if (instanceName) params.append('instanceName', instanceName);
    
    const response = await fetch(`${API_BASE_URL}/dialogs/stats?${params}`);
    if (!response.ok) throw new Error('Failed to fetch stats');
    return response.json();
  },
  
  // Export CSV
  async exportCsv(userAccountId: string, filters?: DialogFilters) {
    const params = new URLSearchParams({ userAccountId });
    if (filters?.interestLevel) params.append('interestLevel', filters.interestLevel);
    if (filters?.minScore !== undefined) params.append('minScore', filters.minScore.toString());
    if (filters?.funnelStage) params.append('funnelStage', filters.funnelStage);
    
    const response = await fetch(`${API_BASE_URL}/dialogs/export-csv?${params}`);
    if (!response.ok) throw new Error('Failed to export CSV');
    return response.text();
  },
  
  // Get WhatsApp instances
  async getInstances(userAccountId: string) {
    const response = await fetch(`${API_BASE_URL}/instances?userAccountId=${userAccountId}`);
    if (!response.ok) throw new Error('Failed to fetch instances');
    return response.json();
  },
  
  // Add lead
  async addLead(userAccountId: string, data: any) {
    const response = await fetch(`${API_BASE_URL}/dialogs/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userAccountId,
        phone: data.phone,
        contactName: data.contactName,
        businessType: data.businessType,
        isMedical: data.isMedical,
        funnelStage: data.funnelStage,
        instanceName: data.instanceName,
        notes: data.notes,
      })
    });
    if (!response.ok) throw new Error('Failed to add lead');
    return response.json();
  },
  
  // Update lead stage
  async updateLeadStage(leadId: string, funnelStage: FunnelStage) {
    const response = await fetch(`${API_BASE_URL}/dialogs/leads/${leadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ funnelStage })
    });
    if (!response.ok) throw new Error('Failed to update lead stage');
    return response.json();
  },
  
  // Delete lead
  async deleteLead(leadId: string) {
    const response = await fetch(`${API_BASE_URL}/dialogs/analysis/${leadId}`, {
      method: 'DELETE'
    });
    if (!response.ok) throw new Error('Failed to delete lead');
    return response.json();
  }
};

