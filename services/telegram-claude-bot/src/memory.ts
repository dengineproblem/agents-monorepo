import fs from 'fs';
import path from 'path';
import { STORE_DIR } from './config.js';
import { logger } from './logger.js';

const MEMORY_DIR = path.join(STORE_DIR, 'memory');

// Валидация userId — только UUID-подобные строки (защита от path traversal)
const SAFE_ID_PATTERN = /^[a-f0-9-]{36}$/i;

function isValidUserId(userId: string): boolean {
  return SAFE_ID_PATTERN.test(userId);
}

export function ensureMemoryDir(): void {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
  logger.info({ dir: MEMORY_DIR }, 'Memory directory ensured');
}

export function readUserMemory(userId: string): string {
  if (!isValidUserId(userId)) {
    logger.warn({ userId: userId.slice(0, 20) }, 'Invalid userId for memory read');
    return '';
  }
  const filePath = path.join(MEMORY_DIR, `${userId}.md`);
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      logger.debug({ userId, size: content.length }, 'User memory loaded');
      return content;
    }
  } catch (err: any) {
    logger.warn({ error: err.message, userId }, 'Failed to read user memory');
  }
  return '';
}

export function writeUserMemory(userId: string, content: string): void {
  if (!isValidUserId(userId)) {
    logger.warn({ userId: userId.slice(0, 20) }, 'Invalid userId for memory write');
    return;
  }
  try {
    const filePath = path.join(MEMORY_DIR, `${userId}.md`);
    fs.writeFileSync(filePath, content, 'utf-8');
    logger.debug({ userId, size: content.length }, 'User memory written');
  } catch (err: any) {
    logger.warn({ error: err.message, userId }, 'Failed to write user memory');
  }
}

export function updateUserMemory(
  userId: string,
  key: string,
  value: string,
): void {
  const current = readUserMemory(userId);
  const lines = current.split('\n').filter(Boolean);
  const prefix = `${key}: `;
  const idx = lines.findIndex((l) => l.startsWith(prefix));
  if (idx >= 0) {
    lines[idx] = `${prefix}${value}`;
  } else {
    lines.push(`${prefix}${value}`);
  }
  writeUserMemory(userId, lines.join('\n') + '\n');
  logger.info({ userId, key }, 'User memory updated');
}

export function getUserMemoryValue(
  userId: string,
  key: string,
): string | null {
  const content = readUserMemory(userId);
  const prefix = `${key}: `;
  const line = content.split('\n').find((l) => l.startsWith(prefix));
  const value = line ? line.slice(prefix.length).trim() : null;
  if (value) {
    logger.debug({ userId, key, hasValue: true }, 'User memory value read');
  }
  return value;
}
