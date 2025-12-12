/**
 * Facebook Graph API utility
 * Shared across all agents that need Facebook API access
 */

const FB_API_VERSION = process.env.FB_API_VERSION || 'v20.0';

/**
 * Execute a Facebook Graph API call
 * @param {string} method - HTTP method (GET, POST, DELETE)
 * @param {string} path - API path (e.g., 'act_123/campaigns')
 * @param {string} accessToken - Facebook access token
 * @param {object} params - Query/body parameters
 * @returns {Promise<object>} API response
 */
export async function fbGraph(method, path, accessToken, params = {}) {
  const usp = new URLSearchParams();
  usp.set('access_token', accessToken);

  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) {
      const value = typeof v === 'object' ? JSON.stringify(v) : String(v);
      usp.set(k, value);
    }
  }

  const url = method === 'GET'
    ? `https://graph.facebook.com/${FB_API_VERSION}/${path}?${usp.toString()}`
    : `https://graph.facebook.com/${FB_API_VERSION}/${path}`;

  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: method === 'GET' ? undefined : usp.toString(),
  });

  const json = await res.json();

  if (!res.ok) {
    throw new Error(json?.error?.message || `Facebook API error: ${res.status}`);
  }

  return json;
}
