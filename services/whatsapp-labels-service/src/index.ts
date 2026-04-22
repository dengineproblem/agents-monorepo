import Fastify from 'fastify';
import { pino } from 'pino';
import { startCron } from './lib/cronJob.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerQrRoutes } from './routes/qr.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { registerSyncRoutes } from './routes/sync.js';
import { registerRecoveryRoutes } from './routes/recovery.js';
import { registerQualificationRoutes } from './routes/qualification.js';

const log = pino({ name: 'whatsapp-labels-service' });

const app = Fastify({ logger: false });

// Routes
registerHealthRoutes(app);
registerQrRoutes(app);
registerSessionRoutes(app);
registerSyncRoutes(app);
registerRecoveryRoutes(app);
registerQualificationRoutes(app);

// Start server
const port = parseInt(process.env.PORT || '8089');

app.listen({ port, host: '0.0.0.0' }, (err) => {
  if (err) {
    log.error({ err: err.message }, 'Failed to start server');
    process.exit(1);
  }
  log.info({ port }, 'WhatsApp Labels Service started');
});

// Start cron
startCron();
