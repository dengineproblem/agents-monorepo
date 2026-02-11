import pino from 'pino';
import { config } from '../config.js';

export const logger = pino({
  level: config.logLevel,
  transport: process.env.NODE_ENV === 'development' ? {
    target: 'pino-pretty',
    options: { colorize: true },
  } : undefined,
});

export function createLogger(context: Record<string, string>) {
  return logger.child(context);
}
