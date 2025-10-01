import fastify from 'fastify';
import dotenv from 'dotenv';
import { actionsRoutes } from './routes/actions.js';

dotenv.config({ path: '/root/.env.agent' });

const app = fastify({ logger: true });
const PORT = Number(process.env.PORT || 8080);

app.get('/health', async () => ({ ok: true }));
app.register(actionsRoutes);

app.listen({ host: '0.0.0.0', port: PORT }).catch((e) => {
  app.log.error(e);
  process.exit(1);
});
