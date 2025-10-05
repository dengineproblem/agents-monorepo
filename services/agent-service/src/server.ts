import fastify from 'fastify';
import dotenv from 'dotenv';
import { actionsRoutes } from './routes/actions.js';
import { videoRoutes } from './routes/video.js';

// Load env from Docker path or local path
dotenv.config({ path: '/root/.env.agent' });
dotenv.config({ path: '../../.env.agent' });

const app = fastify({ logger: true });
const PORT = Number(process.env.PORT || 8080);

app.get('/health', async () => ({ ok: true }));
app.register(actionsRoutes);
app.register(videoRoutes);

app.listen({ host: '0.0.0.0', port: PORT }).catch((e) => {
  app.log.error(e);
  process.exit(1);
});
