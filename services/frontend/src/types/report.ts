
export interface CampaignReport {
  id: string;
  telegram_id: string;
  report_data: any;
  created_at: string;
  updated_at: string;
}

export interface ReportData {
  campaign_name?: string;
  date_range?: {
    from: string;
    to: string;
  };
  metrics?: {
    spend?: number;
    impressions?: number;
    clicks?: number;
    leads?: number;
    cpl?: number;
  };
  [key: string]: any;
}
