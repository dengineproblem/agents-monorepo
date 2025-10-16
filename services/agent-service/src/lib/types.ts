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
  short: string;
  hint?: string;
  severity: 'warning' | 'error';
};
