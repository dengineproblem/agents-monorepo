/**
 * In-memory menu flow store for @prfmntai_bot.
 * TTL 10 минут — не пишем в БД, т.к. flow короткоживущий и только для "Ручного запуска".
 */

import { createLogger } from '../logger.js';

const log = createLogger({ module: 'telegramMenuSession' });

const MENU_FLOW_TTL_MS = 10 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

export interface ManualLaunchCreative {
  id: string;
  name: string;
  index: number;
}

export interface ManualLaunchFlow {
  flow: 'manual_launch';
  step: 'select_direction' | 'await_input';
  data: {
    directions?: Array<{ id: string; name: string }>;
    selectedDirectionId?: string;
    selectedDirectionName?: string;
    creatives?: ManualLaunchCreative[];
  };
  startedAt: number;
}

export type MenuFlow = ManualLaunchFlow;

const flows = new Map<string, MenuFlow>();

setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [telegramId, flow] of flows) {
    if (now - flow.startedAt > MENU_FLOW_TTL_MS) {
      flows.delete(telegramId);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    log.debug({ cleaned, remaining: flows.size }, 'Menu flow cleanup');
  }
}, CLEANUP_INTERVAL_MS).unref?.();

export function getMenuFlow(telegramId: string): MenuFlow | null {
  const flow = flows.get(telegramId);
  if (!flow) return null;
  if (Date.now() - flow.startedAt > MENU_FLOW_TTL_MS) {
    flows.delete(telegramId);
    return null;
  }
  return flow;
}

export function setMenuFlow(telegramId: string, flow: MenuFlow): void {
  flows.set(telegramId, flow);
}

export function clearMenuFlow(telegramId: string): void {
  flows.delete(telegramId);
}
