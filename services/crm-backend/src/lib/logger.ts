import pino, { LoggerOptions, Logger } from 'pino';

const defaultOptions: LoggerOptions = {
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  messageKey: 'message',
  formatters: {
    level(label) {
      return { level: label };
    },
    bindings(bindings) {
      const { pid, hostname, ...rest } = bindings;
      return rest;
    }
  },
  timestamp: pino.stdTimeFunctions.isoTime
};

const base = pino(defaultOptions).child({
  service: 'crm-backend',
  environment: process.env.NODE_ENV || 'development'
});

export type AppLogger = Logger;

export const logger: AppLogger = base;

export function createLogger(bindings: Record<string, unknown> = {}): AppLogger {
  return base.child(bindings);
}



