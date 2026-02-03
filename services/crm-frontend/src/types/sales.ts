// ==================== SALES TYPES ====================

export interface Sale {
  id: string;
  consultant_id: string;
  client_phone: string;
  amount: number;
  product_name?: string; // Название продукта/услуги
  comment?: string; // Комментарий к продаже
  purchase_date: string; // YYYY-MM-DD
  created_at: string;
}

export interface SalesPlan {
  id: string;
  consultant_id: string;
  period_year: number;
  period_month: number;
  plan_amount: number;
  currency: string;
  created_at: string;
  updated_at: string;
}

export interface SalesStats {
  total_sales: number; // Всего продаж за всё время
  total_amount: number; // Сумма продаж за выбранный период
  plan_amount: number; // План на выбранный период
  progress_percent: number; // Процент выполнения плана
  sales_count: number; // Количество продаж за выбранный период
}

export interface ChartDataPoint {
  date: string; // YYYY-MM-DD
  amount: number; // Сумма продаж в этот день
  count: number; // Количество продаж в этот день
}

// ==================== REQUEST TYPES ====================

export interface CreateSaleRequest {
  lead_id?: string; // UUID лида (опционально, если создается из лида)
  client_name?: string; // Имя клиента (если нет lead_id)
  client_phone?: string; // Телефон клиента (если нет lead_id)
  amount: number;
  product_name: string; // Название продукта/услуги
  sale_date?: string; // Дата продажи (YYYY-MM-DD), по умолчанию текущая дата
  comment?: string; // Комментарий к продаже
}

export interface UpdateSaleRequest {
  amount?: number;
  product_name?: string; // Название продукта/услуги
  sale_date?: string; // Дата продажи (YYYY-MM-DD)
  comment?: string; // Комментарий к продаже
}

export interface SetSalesPlanRequest {
  month: number; // 1-12
  year: number;
  plan_amount: number;
}

export interface GetSalesParams {
  date_from?: string;
  date_to?: string;
  search?: string;
  product_name?: string;
  limit?: number;
  offset?: number;
}

export interface GetStatsParams {
  month?: number;
  year?: number;
}

export interface GetChartParams {
  period: 'week' | 'month';
  date_from?: string;
  date_to?: string;
}

// ==================== RESPONSE TYPES ====================

export interface GetSalesResponse {
  sales: Sale[];
  total: number;
}

export interface SetSalesPlanResponse {
  success: boolean;
  plan: SalesPlan;
  message: string;
}
