import { AdAccountInfo, ResolvedUser } from './types.js';
import { logger } from './logger.js';

export interface UserSession {
  userAccountId: string;
  selectedAccountId: string | null;
  businessName: string | null;
  stack: string[];
  originalStack: string[]; // стек из resolve-user (восстанавливается при сбросе аккаунта)
  multiAccountEnabled: boolean;
  adAccounts: AdAccountInfo[];
  lastActivity: number;
  isFirstMessage: boolean;
  anthropicApiKey: string | null;
  originalAnthropicApiKey: string | null; // ключ из resolve-user (восстанавливается при сбросе аккаунта)
  lastDomain: string | null; // sticky domain — последний роутинг для follow-up сообщений
  pendingReferenceImages: string[] | null; // URL'ы из media_group, автоинжект в generateCreatives
  pendingApproval: { tool: string; args: Record<string, any>; timestamp: number } | null; // Ожидает подтверждения пользователя
}

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 минут
const sessions = new Map<number, UserSession>();

// Очистка просроченных сессий каждые 5 минут
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [id, session] of sessions) {
    if (now - session.lastActivity > SESSION_TTL_MS) {
      sessions.delete(id);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    logger.debug({ cleaned, remaining: sessions.size }, 'Session cleanup');
  }
}, 300_000);

export function getSession(telegramId: number): UserSession | undefined {
  return sessions.get(telegramId);
}

export function createSession(
  telegramId: number,
  resolved: ResolvedUser,
): UserSession {
  // Key policy:
  // - multi-account: use ONLY user-provided Anthropic key (no fallbacks)
  // - legacy: use ONLY system key (ignore user key)
  const sessionAnthropicKey = resolved.multiAccountEnabled
    ? (resolved.anthropicApiKey || null)
    : null;
  const session: UserSession = {
    userAccountId: resolved.userAccountId,
    selectedAccountId: null,
    businessName: resolved.businessName,
    stack: [...resolved.stack],
    originalStack: [...resolved.stack],
    multiAccountEnabled: resolved.multiAccountEnabled,
    adAccounts: resolved.adAccounts,
    lastActivity: Date.now(),
    isFirstMessage: true,
    anthropicApiKey: sessionAnthropicKey,
    originalAnthropicApiKey: sessionAnthropicKey,
    lastDomain: null,
    pendingReferenceImages: null,
    pendingApproval: null,
  };
  sessions.set(telegramId, session);
  logger.info({
    telegramId,
    stack: resolved.stack,
    multiAccount: resolved.multiAccountEnabled,
    accountCount: resolved.adAccounts.length,
  }, 'Session created');
  return session;
}

export function updateActivity(telegramId: number): void {
  const session = sessions.get(telegramId);
  if (session) session.lastActivity = Date.now();
}

export function setSelectedAccount(
  telegramId: number,
  accountId: string,
  accountStack: string[],
  anthropicApiKey?: string | null,
): void {
  const session = sessions.get(telegramId);
  if (session) {
    session.selectedAccountId = accountId;
    session.stack = [...accountStack];
    // Don't wipe the current key if account doesn't have its own key.
    // This is important for multi-account users where the key is stored at user level.
    if (typeof anthropicApiKey === 'string' && anthropicApiKey.trim().length > 0) {
      session.anthropicApiKey = anthropicApiKey;
    }
    session.lastActivity = Date.now();
    logger.info({ telegramId, accountId, accountStack }, 'Account selected');
  }
}

export function clearSelectedAccount(telegramId: number): void {
  const session = sessions.get(telegramId);
  if (session) {
    const prevAccountId = session.selectedAccountId;
    session.selectedAccountId = null;
    session.stack = [...session.originalStack];
    session.anthropicApiKey = session.originalAnthropicApiKey;
    logger.info({ telegramId, prevAccountId }, 'Account selection cleared, stack restored');
  }
}
