import dotenv from 'dotenv';
import pino from 'pino';
import { startReactivationCron } from './cron/reactivationCron.js';
import { startReactivationWorker } from './workers/reactivationWorker.js';

// Load env
dotenv.config({ path: '/root/.env.chatbot' });
dotenv.config({ path: '../../.env.chatbot' });
dotenv.config({ path: '.env' });

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'development' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname'
    }
  } : undefined
});

const app = {
  log: logger
};

console.log('🚀 Starting Chatbot Worker...');

// Запускаем cron
startReactivationCron();

// Запускаем worker
startReactivationWorker(app as any);

console.log('✅ Chatbot Worker started');

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  process.exit(0);
});

