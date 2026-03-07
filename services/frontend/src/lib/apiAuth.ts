/**
 * Centralized auth headers for all API calls.
 *
 * Returns both Authorization (JWT) and x-user-id headers.
 * x-user-id kept for backward compatibility during migration.
 */
export function getAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {};

  const token = localStorage.getItem('auth_token');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const raw = localStorage.getItem('user');
    if (raw) {
      const user = JSON.parse(raw);
      if (user.id) {
        headers['x-user-id'] = user.id;
      }
    }
  } catch { /* ignore */ }

  if (extra) {
    Object.assign(headers, extra);
  }

  return headers;
}

export function getUserId(): string | null {
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return null;
    return JSON.parse(raw).id || null;
  } catch {
    return null;
  }
}
