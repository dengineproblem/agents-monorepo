/**
 * Вызов tools на agent-brain через POST /brain/tools/:toolName.
 * agent-brain сам ветвится по user_accounts.multi_account_enabled,
 * так что для legacy достаточно передать userAccountId (без accountId).
 */

import { createLogger } from '../logger.js';

const log = createLogger({ module: 'telegramMenuTools' });

const AGENT_BRAIN_URL = process.env.AGENT_BRAIN_URL || 'http://agent-brain:7080';
const BRAIN_SERVICE_SECRET = process.env.BRAIN_SERVICE_SECRET || '';
const TOOL_TIMEOUT_MS = 180_000;

export interface ToolResult {
  success?: boolean;
  error?: string;
  message?: string;
  result?: any;
  data?: any;
  [key: string]: any;
}

export async function executeTool(
  toolName: string,
  args: Record<string, any>,
): Promise<ToolResult> {
  const url = `${AGENT_BRAIN_URL}/brain/tools/${toolName}`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (BRAIN_SERVICE_SECRET) {
    headers['X-Service-Auth'] = BRAIN_SERVICE_SECRET;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(args),
      signal: controller.signal,
    });

    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = { success: false, error: `non-JSON response (status ${res.status})`, raw: text.slice(0, 500) };
    }

    const elapsed = Date.now() - startedAt;
    log.info({
      toolName,
      status: res.status,
      success: json?.success !== false,
      elapsedMs: elapsed,
    }, 'Tool call finished');

    if (!res.ok) {
      return {
        success: false,
        error: json?.error || json?.message || `HTTP ${res.status}`,
      };
    }

    return json;
  } catch (err: any) {
    const elapsed = Date.now() - startedAt;
    const aborted = err?.name === 'AbortError';
    log.error({ toolName, error: String(err), aborted, elapsedMs: elapsed }, 'Tool call failed');
    return {
      success: false,
      error: aborted ? 'Превышено время ожидания' : (err?.message || String(err)),
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Извлекает inner data из обёртки /brain/tools и проверяет inner success.
 * Поддерживает два варианта ответа:
 *   { success: true, result: {...} }
 *   { success: true, data: {...} }
 *   { success: true, ...fields } (fallback — сам объект)
 */
export function extractToolResult(
  result: ToolResult | null | undefined,
): { ok: true; data: any } | { ok: false; error: string } {
  if (!result || result.success === false) {
    return { ok: false, error: result?.error || result?.message || 'неизвестная ошибка' };
  }
  const inner = result.result ?? result.data ?? result;
  if (inner && inner.success === false) {
    return { ok: false, error: inner.error || inner.message || 'неизвестная ошибка' };
  }
  return { ok: true, data: inner };
}
