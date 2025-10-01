import crypto from 'node:crypto';

const FB_API_VERSION = process.env.FB_API_VERSION || 'v20.0';
const FB_APP_SECRET = process.env.FB_APP_SECRET || '';
const FB_VALIDATE_ONLY = String(process.env.FB_VALIDATE_ONLY || 'false').toLowerCase() === 'true';

function appsecret_proof(token: string) {
  return crypto.createHmac('sha256', FB_APP_SECRET).update(token).digest('hex');
}

export async function graph(method: 'GET'|'POST'|'DELETE', path: string, token: string, params: Record<string, any> = {}) {
  const usp = new URLSearchParams();
  usp.set('access_token', token);
  if (FB_APP_SECRET) usp.set('appsecret_proof', appsecret_proof(token));
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) usp.set(k, String(v));
  if (FB_VALIDATE_ONLY && (method === 'POST' || method === 'DELETE')) {
    // Validate-only mode: ask FB to validate without applying changes
    // Many endpoints accept execution_options=["validate_only"]
    usp.set('execution_options', '["validate_only"]');
  }

  const url = method === 'GET'
    ? `https://graph.facebook.com/${FB_API_VERSION}/${path}?${usp.toString()}`
    : `https://graph.facebook.com/${FB_API_VERSION}/${path}`;

  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: method === 'GET' ? undefined : usp.toString(),
  });

  const text = await res.text();
  let json: any; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    const g = json?.error || {};
    const err: any = new Error(g?.message || text || `HTTP ${res.status}`);
    err.fb = {
      status: res.status,
      method, path,
      params: params,
      type: g?.type, code: g?.code, error_subcode: g?.error_subcode, fbtrace_id: g?.fbtrace_id
    };
    throw err;
  }
  return json;
}

export const fb = {
  pauseCampaign: (id: string, t: string) => graph('POST', `${id}`, t, { status: 'PAUSED' }),
  resumeCampaign:(id: string, t: string) => graph('POST', `${id}`, t, { status: 'ACTIVE' }),
  pauseAdset:    (id: string, t: string) => graph('POST', `${id}`, t, { status: 'PAUSED' }),
  resumeAdset:   (id: string, t: string) => graph('POST', `${id}`, t, { status: 'ACTIVE' }),
  pauseAd:       (id: string, t: string) => graph('POST', `${id}`, t, { status: 'PAUSED' }),
  resumeAd:      (id: string, t: string) => graph('POST', `${id}`, t, { status: 'ACTIVE' }),
  setAdsetBudgetUsd: (adsetId: string, usd: number, t: string) => {
    const cents = Math.max(0, Math.round(usd * 100));
    return graph('POST', `${adsetId}`, t, { daily_budget: cents });
  },
};
