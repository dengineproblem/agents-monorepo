import { FastifyInstance } from 'fastify';
import { initSession, getSession } from '../lib/sessionManager.js';

export function registerQrRoutes(app: FastifyInstance): void {
  /**
   * Start a session and get QR code for scanning.
   * POST /qr/:userAccountId
   *
   * Returns QR code immediately if available, or starts session and waits.
   */
  app.post<{ Params: { userAccountId: string } }>('/qr/:userAccountId', async (request, reply) => {
    const { userAccountId } = request.params;

    // Start session in background (don't await — QR comes via event)
    const sessionPromise = initSession(userAccountId);

    // Wait a bit for QR to be generated
    await new Promise(r => setTimeout(r, 5000));

    const session = getSession(userAccountId);
    if (!session) {
      return reply.code(500).send({ error: 'Failed to initialize session' });
    }

    if (session.ready) {
      return { status: 'connected', qrCode: null };
    }

    if (session.qrCode) {
      return { status: 'waiting_scan', qrCode: session.qrCode };
    }

    return { status: 'initializing', qrCode: null };
  });

  /**
   * Get current QR/status for a session.
   * GET /qr/:userAccountId
   */
  app.get<{ Params: { userAccountId: string } }>('/qr/:userAccountId', async (request, reply) => {
    const { userAccountId } = request.params;
    const session = getSession(userAccountId);

    if (!session) {
      return { status: 'not_initialized', qrCode: null };
    }

    if (session.ready) {
      return { status: 'connected', qrCode: null };
    }

    return {
      status: session.qrCode ? 'waiting_scan' : 'initializing',
      qrCode: session.qrCode,
    };
  });
}
