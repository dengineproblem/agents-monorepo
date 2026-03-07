/**
 * Extract userId middleware.
 *
 * Priority:
 *  1. Authorization: Bearer <JWT> — verified, tamper-proof
 *  2. x-user-id header — fallback for backward compatibility
 *
 * Overwrites x-user-id with the verified value from JWT so that
 * all downstream routes keep reading req.headers['x-user-id'] as before.
 */
import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyJwt } from '../lib/jwt.js';

export async function extractUserId(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const payload = verifyJwt(token);
    if (payload) {
      request.headers['x-user-id'] = payload.userId;
    }
  }
  // If no JWT — x-user-id passes through untouched (backward compat)
}
