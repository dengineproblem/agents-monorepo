// Типы для сервисов
export interface Service {
  id: string;
  name: string;
  description?: string;
  price?: number;
  created_at: string;
  updated_at: string;
}

export interface CreateSaleData {
  amount: number;
  client_phone: string;
  campaign_name?: string;
  service_id?: string;
  consultation_id?: string;
}