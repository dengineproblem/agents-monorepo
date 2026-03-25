import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import { pino } from 'pino';

const log = pino({ name: 'session-manager' });

type WAClient = InstanceType<typeof Client>;

interface SessionState {
  client: WAClient;
  ready: boolean;
  qrCode: string | null;
}

const sessions = new Map<string, SessionState>();

export function getSession(userAccountId: string): SessionState | undefined {
  return sessions.get(userAccountId);
}

export function getAllSessions(): Map<string, SessionState> {
  return sessions;
}

/**
 * Initialize a wwebjs session for a user account.
 * Uses LocalAuth to persist session data on disk — no QR needed after first scan.
 */
export async function initSession(userAccountId: string): Promise<SessionState> {
  const existing = sessions.get(userAccountId);
  if (existing?.ready) {
    log.info({ userAccountId }, 'Session already active');
    return existing;
  }

  log.info({ userAccountId }, 'Initializing wwebjs session');

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: userAccountId }),
    puppeteer: {
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--disable-gpu',
        '--single-process',
        '--no-zygote',
      ],
    },
  });

  const state: SessionState = {
    client,
    ready: false,
    qrCode: null,
  };

  sessions.set(userAccountId, state);

  return new Promise<SessionState>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (!state.ready) {
        log.warn({ userAccountId }, 'Session init timeout (120s) — may need QR scan');
        // Don't reject — session might be waiting for QR
        resolve(state);
      }
    }, 120_000);

    client.on('qr', (qr: string) => {
      log.info({ userAccountId }, 'QR code received');
      state.qrCode = qr;
    });

    client.on('ready', () => {
      log.info({ userAccountId }, 'Session ready');
      state.ready = true;
      state.qrCode = null;
      clearTimeout(timeout);
      resolve(state);
    });

    client.on('authenticated', () => {
      log.info({ userAccountId }, 'Session authenticated');
    });

    client.on('auth_failure', (msg: string) => {
      log.error({ userAccountId, msg }, 'Auth failure');
      sessions.delete(userAccountId);
      clearTimeout(timeout);
      reject(new Error(`Auth failure: ${msg}`));
    });

    client.on('change_state', (newState: string) => {
      log.info({ userAccountId, newState }, 'Session state changed');
      if (newState === 'UNPAIRED' || newState === 'CONFLICT') {
        log.warn({ userAccountId, newState }, 'Session lost connection — marking not ready');
        state.ready = false;
      }
    });

    client.on('disconnected', (reason: string) => {
      log.warn({ userAccountId, reason }, 'Session disconnected');
      state.ready = false;
      sessions.delete(userAccountId);
    });

    client.initialize().catch((err: Error) => {
      log.error({ userAccountId, err: err.message }, 'Failed to initialize client');
      sessions.delete(userAccountId);
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Check if session is truly connected (not just marked ready in memory).
 * Returns WAState: CONNECTED, OPENING, PAIRING, TIMEOUT, UNPAIRED, etc.
 */
export async function checkSessionAlive(userAccountId: string): Promise<{ alive: boolean; state: string }> {
  const session = sessions.get(userAccountId);
  if (!session || !session.ready) {
    return { alive: false, state: 'NO_SESSION' };
  }

  try {
    const waState = await session.client.getState();
    const alive = waState === 'CONNECTED';
    if (!alive) {
      log.warn({ userAccountId, waState }, 'Session not connected');
      session.ready = false;
    }
    return { alive, state: waState || 'UNKNOWN' };
  } catch (err: any) {
    log.error({ userAccountId, err: err.message }, 'Failed to get session state — likely dead');
    session.ready = false;
    return { alive: false, state: 'ERROR' };
  }
}

/**
 * Destroy a session — closes Chrome, frees RAM.
 * Session data stays on disk (LocalAuth) for next init.
 */
export async function destroySession(userAccountId: string): Promise<void> {
  const state = sessions.get(userAccountId);
  if (!state) return;

  log.info({ userAccountId }, 'Destroying session');
  try {
    await state.client.destroy();
  } catch (err: any) {
    log.warn({ userAccountId, err: err.message }, 'Error during session destroy');
  }
  sessions.delete(userAccountId);
}
