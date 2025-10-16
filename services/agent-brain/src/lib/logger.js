import pino from 'pino';

const logger = pino({
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
}).child({
  service: 'agent-brain',
  environment: process.env.NODE_ENV || 'development'
});

export { logger };
