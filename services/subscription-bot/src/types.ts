export interface BotSubscription {
  id: string;
  telegram_id: number;
  user_account_id: string;
  channel_status: 'none' | 'invited' | 'active' | 'kicked';
  last_invite_link: string | null;
  last_invite_at: string | null;
  current_plan_slug: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserAccount {
  id: string;
  telegram_id: string | null;
  tarif: string | null;
  tarif_expires: string | null;
  tarif_renewal_cost: number | null;
  is_active: boolean;
  multi_account_enabled: boolean;
  created_at: string;
}

export interface ApplyPaymentResult {
  user_account_id: string;
  is_new_user: boolean;
}
