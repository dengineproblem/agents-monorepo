import { DialogAnalysis, DialogStats, DialogFilters } from '@/types/dialogAnalysis';

const API_BASE_URL = import.meta.env.VITE_AGENT_SERVICE_URL || 'http://localhost:8082';

export const dialogAnalysisService = {
  /**
   * Get analysis results with filters
   */
  async getAnalysis(userAccountId: string, filters?: DialogFilters): Promise<{ results: DialogAnalysis[]; count: number }> {
    const params = new URLSearchParams({ userAccountId });
    
    if (filters?.interestLevel) params.append('interestLevel', filters.interestLevel);
    if (filters?.funnelStage) params.append('funnelStage', filters.funnelStage);
    if (filters?.minScore !== undefined) params.append('minScore', filters.minScore.toString());
    if (filters?.qualificationComplete !== undefined) params.append('qualificationComplete', filters.qualificationComplete.toString());
    
    const response = await fetch(`${API_BASE_URL}/api/dialogs/analysis?${params}`);
    
    if (!response.ok) {
      throw new Error('Failed to fetch dialog analysis');
    }
    
    const data = await response.json();
    return {
      results: data.results || [],
      count: data.count || 0,
    };
  },

  /**
   * Get statistics
   */
  async getStats(userAccountId: string): Promise<DialogStats> {
    const response = await fetch(`${API_BASE_URL}/api/dialogs/stats?userAccountId=${userAccountId}`);
    
    if (!response.ok) {
      throw new Error('Failed to fetch dialog stats');
    }
    
    const data = await response.json();
    return data.stats;
  },

  /**
   * Start analysis for an instance
   */
  async startAnalysis(params: {
    instanceName: string;
    userAccountId: string;
    minIncoming?: number;
    maxDialogs?: number;
  }): Promise<{ success: boolean; stats: any }> {
    const response = await fetch(`${API_BASE_URL}/api/dialogs/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });
    
    if (!response.ok) {
      throw new Error('Failed to start analysis');
    }
    
    return response.json();
  },

  /**
   * Export to CSV
   */
  async exportToCsv(userAccountId: string, filters?: DialogFilters): Promise<Blob> {
    const params = new URLSearchParams({ userAccountId });
    
    if (filters?.interestLevel) params.append('interestLevel', filters.interestLevel);
    
    const response = await fetch(`${API_BASE_URL}/api/dialogs/export-csv?${params}`);
    
    if (!response.ok) {
      throw new Error('Failed to export CSV');
    }
    
    return response.blob();
  },

  /**
   * Delete analysis result
   */
  async deleteAnalysis(id: string, userAccountId: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/dialogs/analysis/${id}?userAccountId=${userAccountId}`, {
      method: 'DELETE',
    });
    
    if (!response.ok) {
      throw new Error('Failed to delete analysis');
    }
  },
};

