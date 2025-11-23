import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import { textsRoutes } from './routes/texts';
import { imageRoutes } from './routes/image';
import carouselRoutes from './routes/carousel';
import { initializeOpenAI } from './services/openai'; // OpenAI для текстов
import { initializeGeminiImageAPI } from './services/gemini-image'; // Gemini для изображений

// Загружаем переменные окружения
dotenv.config();

const PORT = parseInt(process.env.PORT || '8085', 10);
const HOST = process.env.HOST || '0.0.0.0';

// Создаем Fastify instance
const app = Fastify({
  bodyLimit: 50 * 1024 * 1024, // 50MB лимит для base64-изображений
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV === 'development' ? {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname'
      }
    } : undefined
  }
});

// Регистрируем CORS
app.register(cors, {
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
});

// Регистрируем routes
app.register(textsRoutes);
app.register(imageRoutes);
app.register(carouselRoutes);

// Root endpoint
app.get('/', async (request, reply) => {
  return {
    service: 'creative-generation-service',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      texts: [
        'POST /generate-offer',
        'POST /generate-bullets',
        'POST /generate-profits',
        'POST /generate-cta'
      ],
      image: [
        'POST /generate-creative',
        'POST /upscale-to-4k'
      ],
      carousel: [
        'POST /generate-carousel-texts',
        'POST /regenerate-carousel-card-text',
        'POST /generate-carousel',
        'POST /regenerate-carousel-card',
        'POST /upscale-carousel-to-4k'
      ],
      health: [
        'GET /health'
      ]
    }
  };
});

// Запуск сервера
const start = async () => {
  try {
    // Проверяем наличие необходимых переменных окружения
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required for text generation');
    }
    
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is required for image generation');
    }
    
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!process.env.SUPABASE_URL || !supabaseKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY) are required');
    }

    // Инициализируем OpenAI API для текстов
    app.log.info('Initializing OpenAI API for text generation...');
    await initializeOpenAI();
    
    // Инициализируем Gemini API для изображений
    app.log.info('Initializing Gemini API for image generation...');
    await initializeGeminiImageAPI();
    
    // Запускаем сервер
    await app.listen({ port: PORT, host: HOST });
    
    app.log.info(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🎨 Creative Generation Service                         ║
║                                                           ║
║   ✓ OpenAI GPT-4o-mini - Text Generation Ready          ║
║   ✓ Gemini 3 Pro Image - Image Generation Ready         ║
║   ✓ Supabase Storage - Connected                         ║
║                                                           ║
║   🚀 Server running on http://${HOST}:${PORT}       ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
    `);
    
  } catch (error: any) {
    app.log.error(`Failed to start server: ${error?.message || error}`);
    process.exit(1);
  }
};

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  app.log.info(`Received ${signal}, closing server gracefully...`);
  
  try {
    await app.close();
    app.log.info('Server closed successfully');
    process.exit(0);
  } catch (error: any) {
    app.log.error(`Error during graceful shutdown: ${error?.message || error}`);
    process.exit(1);
  }
};

// Обработчики сигналов
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Обработка необработанных ошибок
process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  app.log.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
});

process.on('uncaughtException', (error: Error) => {
  app.log.error(`Uncaught Exception: ${error.message}`);
  process.exit(1);
});

// Запускаем сервер
start();

