/**
 * JWT utility — sign & verify using Node.js built-in crypto (HS256).
 * No external dependencies.
 */
import { createHmac } from 'node:crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-dev-secret-change-in-prod';
const TOKEN_EXPIRY_SECONDS = 30 * 24 * 60 * 60; // 30 days

function base64url(data: string): string {
  return Buffer.from(data).toString('base64url');
}

function base64urlDecode(str: string): string {
  return Buffer.from(str, 'base64url').toString();
}

export function signJwt(payload: { userId: string }): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = base64url(JSON.stringify({
    ...payload,
    iat: now,
    exp: now + TOKEN_EXPIRY_SECONDS,
  }));

  const signature = createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');

  return `${header}.${body}.${signature}`;
}

export function verifyJwt(token: string): { userId: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, body, signature] = parts;

    const expectedSig = createHmac('sha256', JWT_SECRET)
      .update(`${header}.${body}`)
      .digest('base64url');

    if (signature !== expectedSig) return null;

    const payload = JSON.parse(base64urlDecode(body));

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return null;

    return { userId: payload.userId };
  } catch {
    return null;
  }
}
