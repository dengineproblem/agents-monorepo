import {
  Sale,
  SalesStats,
  ChartDataPoint,
  GetSalesParams,
  GetStatsParams,
  GetChartParams,
  CreateSaleRequest,
  UpdateSaleRequest,
  SetSalesPlanRequest,
  GetSalesResponse,
  SetSalesPlanResponse
} from '@/types/sales';

const API_BASE_URL = import.meta.env.VITE_CRM_BACKEND_URL || '/api/crm';

const getHeaders = () => {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  return {
    'Content-Type': 'application/json',
    'x-user-id': user.id || ''
  };
};

export const salesApi = {
  /**
   * Получить список продаж консультанта
   */
  async getSales(params?: GetSalesParams & { consultantId?: string }): Promise<GetSalesResponse> {
    const queryParams = new URLSearchParams();
    if (params?.consultantId) queryParams.append('consultantId', params.consultantId);
    if (params?.date_from) queryParams.append('date_from', params.date_from);
    if (params?.date_to) queryParams.append('date_to', params.date_to);
    if (params?.search) queryParams.append('search', params.search);
    if (params?.product_name) queryParams.append('product_name', params.product_name);
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.offset) queryParams.append('offset', params.offset.toString());

    const url = `${API_BASE_URL}/consultant/sales${queryParams.toString() ? `?${queryParams}` : ''}`;
    const response = await fetch(url, {
      headers: getHeaders()
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to fetch sales' }));
      throw new Error(error.error || 'Failed to fetch sales');
    }

    return response.json();
  },

  /**
   * Создать новую продажу
   */
  async createSale(data: CreateSaleRequest): Promise<Sale> {
    const response = await fetch(`${API_BASE_URL}/consultant/sales`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to create sale' }));
      throw new Error(error.error || 'Failed to create sale');
    }

    return response.json();
  },

  /**
   * Обновить продажу
   */
  async updateSale(saleId: string, data: UpdateSaleRequest): Promise<Sale> {
    const response = await fetch(`${API_BASE_URL}/consultant/sales/${saleId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to update sale' }));
      throw new Error(error.error || 'Failed to update sale');
    }

    return response.json();
  },

  /**
   * Удалить продажу
   */
  async deleteSale(saleId: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/consultant/sales/${saleId}`, {
      method: 'DELETE',
      headers: getHeaders()
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to delete sale' }));
      throw new Error(error.error || 'Failed to delete sale');
    }
  },

  /**
   * Получить статистику продаж
   */
  async getStats(params?: GetStatsParams & { consultantId?: string }): Promise<SalesStats> {
    const queryParams = new URLSearchParams();
    if (params?.consultantId) queryParams.append('consultantId', params.consultantId);
    if (params?.month) queryParams.append('month', params.month.toString());
    if (params?.year) queryParams.append('year', params.year.toString());

    const url = `${API_BASE_URL}/consultant/sales/stats${queryParams.toString() ? `?${queryParams}` : ''}`;
    const response = await fetch(url, {
      headers: getHeaders()
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to fetch stats' }));
      throw new Error(error.error || 'Failed to fetch stats');
    }

    return response.json();
  },

  /**
   * Получить данные для графика продаж
   */
  async getChartData(params: GetChartParams & { consultantId?: string }): Promise<ChartDataPoint[]> {
    const queryParams = new URLSearchParams({
      period: params.period
    });
    if (params.consultantId) queryParams.append('consultantId', params.consultantId);
    if (params.date_from) queryParams.append('date_from', params.date_from);
    if (params.date_to) queryParams.append('date_to', params.date_to);

    const response = await fetch(`${API_BASE_URL}/consultant/sales/chart?${queryParams}`, {
      headers: getHeaders()
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to fetch chart data' }));
      throw new Error(error.error || 'Failed to fetch chart data');
    }

    return response.json();
  },

  // ==================== ADMIN METHODS ====================

  /**
   * Установить план продаж для консультанта (только для админов)
   */
  async setSalesPlan(consultantId: string, data: SetSalesPlanRequest): Promise<SetSalesPlanResponse> {
    const response = await fetch(`${API_BASE_URL}/admin/consultants/${consultantId}/sales-plan`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to set sales plan' }));
      throw new Error(error.error || 'Failed to set sales plan');
    }

    return response.json();
  },

  /**
   * Получить все продажи всех консультантов (только для админов)
   */
  async getAllSales(params?: {
    consultant_id?: string;
    date_from?: string;
    date_to?: string;
    limit?: number;
    offset?: number;
  }): Promise<Sale[]> {
    const queryParams = new URLSearchParams();
    if (params?.consultant_id) queryParams.append('consultant_id', params.consultant_id);
    if (params?.date_from) queryParams.append('date_from', params.date_from);
    if (params?.date_to) queryParams.append('date_to', params.date_to);
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.offset) queryParams.append('offset', params.offset.toString());

    const url = `${API_BASE_URL}/admin/sales/all${queryParams.toString() ? `?${queryParams}` : ''}`;
    const response = await fetch(url, {
      headers: getHeaders()
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to fetch all sales' }));
      throw new Error(error.error || 'Failed to fetch all sales');
    }

    return response.json();
  }
};
