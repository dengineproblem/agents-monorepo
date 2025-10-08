import fastify from 'fastify';
import cors from "@fastify/cors";
import dotenv from 'dotenv';
import { actionsRoutes } from './routes/actions.js';
import { videoRoutes } from './routes/video.js';
import { creativeTestRoutes } from './routes/creativeTest.js';
import { startCreativeTestCron } from './cron/creativeTestChecker.js';

// Load env from Docker path or local path
dotenv.config({ path: '/root/.env.agent' });
dotenv.config({ path: '../../.env.agent' });

const app = fastify({ logger: true });
const PORT = Number(process.env.PORT || 8082);

app.get('/health', async () => ({ ok: true }));
app.register(cors, {
  origin: true,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
});
app.register(actionsRoutes);
app.register(videoRoutes);
app.register(creativeTestRoutes);

// Запускаем cron для проверки тестов креативов (каждые 5 минут)
startCreativeTestCron(app);

app.listen({ host: '0.0.0.0', port: PORT }).catch((e) => {
  app.log.error(e);
  process.exit(1);
});
