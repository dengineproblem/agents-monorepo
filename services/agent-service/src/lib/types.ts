export type FacebookErrorMeta = {
  status?: number;
  method?: string;
  path?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
  params?: Record<string, unknown>;
};

export type FacebookErrorResolution = {
  msgCode: string; // Короткий код для поиска в Loki (fb_token_expired, fb_rate_limit, etc)
  short: string;
  hint?: string;
  severity: 'warning' | 'error';
};
