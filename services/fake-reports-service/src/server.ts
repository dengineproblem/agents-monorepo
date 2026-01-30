import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config, validateConfig } from './config.js';
import { initializeOpenAI } from './lib/llmService.js';
import telegramWebhook from './routes/telegramWebhook.js';

// Валидация конфигурации при старте
try {
  validateConfig();
} catch (error: any) {
  console.error('❌ Configuration error:', error.message);
  process.exit(1);
}

// Инициализация OpenAI
try {
  initializeOpenAI();
} catch (error: any) {
  console.error('❌ OpenAI initialization error:', error.message);
  process.exit(1);
}

// Создание Fastify приложения
const app = Fastify({
  logger: {
    level: config.logging.level,
    transport: config.server.nodeEnv === 'development' ? {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname'
      }
    } : undefined
  }
});

// Регистрация плагинов
await app.register(cors, {
  origin: true
});

// Регистрация routes
await app.register(telegramWebhook);

// Health check endpoint
app.get('/health', async (request, reply) => {
  return {
    status: 'ok',
    service: 'fake-reports-service',
    timestamp: new Date().toISOString(),
    openai: config.openai.apiKey ? 'configured' : 'not configured'
  };
});

// Error handler
app.setErrorHandler((error, request, reply) => {
  request.log.error({ error }, 'Request error');

  return reply.status(500).send({
    error: 'Internal Server Error',
    message: config.server.nodeEnv === 'development' ? error.message : 'An error occurred'
  });
});

// Graceful shutdown
const shutdown = async (signal: string) => {
  app.log.info(`Received ${signal}, starting graceful shutdown...`);

  try {
    await app.close();
    app.log.info('Server closed successfully');
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, 'Error during shutdown');
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Запуск сервера
try {
  await app.listen({
    port: config.server.port,
    host: config.server.host
  });

  app.log.info(`🚀 Fake Reports Service started on ${config.server.host}:${config.server.port}`);
  app.log.info(`📊 Environment: ${config.server.nodeEnv}`);
  app.log.info(`📝 Logging level: ${config.logging.level}`);
} catch (err) {
  app.log.error({ err }, 'Failed to start server');
  process.exit(1);
}
