export type SubscriptionSaleKind = 'subscription' | 'custom';
export type SubscriptionSaleStatus = 'pending_link' | 'linked' | 'applied' | 'cancelled';

export interface SubscriptionProduct {
  id: string;
  sku: string;
  name: string;
  months: number;
  price: number;
  currency: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionSale {
  id: string;
  consultant_id: string | null;
  client_name: string | null;
  client_phone: string;
  normalized_phone: string;
  product_id: string | null;
  custom_product_name: string | null;
  amount: number;
  months: number | null;
  currency: string;
  sale_kind: SubscriptionSaleKind;
  status: SubscriptionSaleStatus;
  user_account_id: string | null;
  linked_by: string | null;
  linked_at: string | null;
  applied_by: string | null;
  applied_at: string | null;
  sale_date: string;
  comment: string | null;
  source: string;
  created_at: string;
  updated_at: string;
  user_accounts?: SubscriptionSaleUser | null;
}

export interface SubscriptionSaleUser {
  id: string;
  username: string;
  telegram_id: string | null;
  telegram_id_2: string | null;
  telegram_id_3: string | null;
  telegram_id_4: string | null;
  tarif: string | null;
  tarif_expires: string | null;
  is_active: boolean | null;
}

export interface SubscriptionUserSearchItem {
  id: string;
  username: string;
  telegram_id: string | null;
  telegram_id_2: string | null;
  telegram_id_3: string | null;
  telegram_id_4: string | null;
  tarif: string | null;
  tarif_expires: string | null;
  is_active: boolean | null;
  created_at: string | null;
}

export interface PhoneUserLink {
  id: string;
  normalized_phone: string;
  user_account_id: string;
  linked_by: string | null;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionSweepStats {
  scannedUsers: number;
  remindersSent: number;
  remindersSkipped: number;
  deactivatedUsers: number;
  errors: number;
}
