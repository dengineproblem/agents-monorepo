import path from 'path';
import dotenv from 'dotenv';

// Загрузить переменные окружения из .env
dotenv.config();

export const ASSISTANT_NAME = process.env.ASSISTANT_NAME || 'Claude';
export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
export const BRAIN_SERVICE_URL = process.env.BRAIN_SERVICE_URL || 'http://agent-brain:7080';
export const BRAIN_SERVICE_SECRET = process.env.BRAIN_SERVICE_SECRET || '';

// Список Telegram ID администраторов (через запятую в env)
export const ADMIN_TELEGRAM_IDS: Set<number> = new Set(
  (process.env.ADMIN_TELEGRAM_IDS || '')
    .split(',')
    .map(id => parseInt(id.trim(), 10))
    .filter(id => !isNaN(id))
);

// Admin-only tools — только админы могут вызывать
export const ADMIN_ONLY_TOOLS = new Set(['createUser']);

export const POLL_INTERVAL = 2000;
export const SCHEDULER_POLL_INTERVAL = 60000;

// Rate limiting
export const RATE_LIMIT_MSG_PER_MINUTE = parseInt(process.env.RATE_LIMIT_MSG_PER_MINUTE || '5', 10);
export const RATE_LIMIT_MSG_PER_HOUR = parseInt(process.env.RATE_LIMIT_MSG_PER_HOUR || '30', 10);

// Voice file size limit (bytes) — default 20MB
export const MAX_VOICE_FILE_SIZE = 20 * 1024 * 1024;

// Max user message length (chars) — messages longer than this are truncated
export const MAX_MESSAGE_LENGTH = 4000;

// Absolute paths needed for container mounts
const PROJECT_ROOT = process.cwd();
const HOME_DIR = process.env.HOME || '/home/user';

// Mount security: allowlist stored OUTSIDE project root, never mounted into containers
export const MOUNT_ALLOWLIST_PATH = path.join(
  HOME_DIR,
  '.config',
  'telegram-claude-bot',
  'mount-allowlist.json',
);
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
export const MAIN_GROUP_FOLDER = 'main';

export const CONTAINER_IMAGE =
  process.env.CONTAINER_IMAGE || 'telegram-claude-bot:latest';
export const CONTAINER_TIMEOUT = parseInt(
  process.env.CONTAINER_TIMEOUT || '300000',
  10,
);
export const CONTAINER_MAX_OUTPUT_SIZE = parseInt(
  process.env.CONTAINER_MAX_OUTPUT_SIZE || '10485760',
  10,
); // 10MB default
export const IPC_POLL_INTERVAL = 1000;

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Trigger pattern: /bot или @Claude
export const TRIGGER_PATTERN = new RegExp(
  `^(/bot|@${escapeRegex(ASSISTANT_NAME)})\\b`,
  'i',
);

// Timezone for scheduled tasks (cron expressions, etc.)
// Uses system timezone by default
export const TIMEZONE =
  process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
