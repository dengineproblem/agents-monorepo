import { ConversationReport, ConversationReportStats } from '@/types/conversationReport';

const CRM_API_URL = import.meta.env.VITE_CRM_API_URL || '/api/crm';

export const conversationReportService = {
  /**
   * Получить список отчётов для пользователя
   */
  async getReports(
    userAccountId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<{ reports: ConversationReport[]; total: number }> {
    const params = new URLSearchParams({
      userAccountId,
      limit: String(options?.limit || 30),
      offset: String(options?.offset || 0),
    });

    const response = await fetch(`${CRM_API_URL}/conversation-reports?${params}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to fetch reports');
    }

    return {
      reports: data.reports || [],
      total: data.total || 0,
    };
  },

  /**
   * Получить последний отчёт
   */
  async getLatestReport(userAccountId: string): Promise<ConversationReport | null> {
    const params = new URLSearchParams({ userAccountId });

    const response = await fetch(`${CRM_API_URL}/conversation-reports/latest?${params}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to fetch latest report');
    }

    return data.report || null;
  },

  /**
   * Получить конкретный отчёт по ID
   */
  async getReport(id: string, userAccountId: string): Promise<ConversationReport | null> {
    const params = new URLSearchParams({ userAccountId });

    const response = await fetch(`${CRM_API_URL}/conversation-reports/${id}?${params}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to fetch report');
    }

    return data.report || null;
  },

  /**
   * Сгенерировать новый отчёт
   */
  async generateReport(
    userAccountId: string,
    date?: string
  ): Promise<ConversationReport> {
    const response = await fetch(`${CRM_API_URL}/conversation-reports/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userAccountId, date }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to generate report');
    }

    return data.report;
  },

  /**
   * Получить агрегированную статистику за период
   */
  async getStats(
    userAccountId: string,
    days?: number
  ): Promise<ConversationReportStats> {
    const params = new URLSearchParams({
      userAccountId,
      days: String(days || 7),
    });

    const response = await fetch(`${CRM_API_URL}/conversation-reports/stats?${params}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to fetch stats');
    }

    return data.stats;
  },
};
