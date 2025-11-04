/**
 * AmoCRM Secrets Handler
 *
 * Receives client_id and client_secret when integration is auto-created via button
 *
 * @module routes/amocrmSecrets
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';

const SecretsSchema = z.object({
  client_id: z.string(),
  client_secret: z.string(),
  state: z.string().optional(),
  name: z.string().optional(),
  scopes: z.string().optional()
});

export default async function amocrmSecretsRoutes(app: FastifyInstance) {
  /**
   * POST /amocrm/secrets
   * External URL: /api/amocrm/secrets (nginx adds /api/ prefix)
   *
   * Receives client_id and client_secret from AmoCRM when integration is auto-created
   * This happens BEFORE the OAuth redirect, so we need to store them temporarily
   */
  app.post('/amocrm/secrets', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const parsed = SecretsSchema.safeParse(request.body);

      if (!parsed.success) {
        app.log.error({ error: parsed.error }, 'Invalid secrets payload');
        return reply.code(400).send({
          error: 'validation_error',
          issues: parsed.error.flatten()
        });
      }

      const { client_id, client_secret, state, name, scopes } = parsed.data;

      app.log.info({
        client_id: client_id.substring(0, 10) + '...',
        state,
        name,
        scopes
      }, 'Received AmoCRM auto-generated credentials');

      // Write credentials to .env.agent file
      const envPath = path.resolve(process.cwd(), '../../.env.agent');
      const envContent = fs.readFileSync(envPath, 'utf-8');

      // Replace placeholder values
      const updatedContent = envContent
        .replace(/AMOCRM_CLIENT_ID=.*/, `AMOCRM_CLIENT_ID=${client_id}`)
        .replace(/AMOCRM_CLIENT_SECRET=.*/, `AMOCRM_CLIENT_SECRET=${client_secret}`);

      fs.writeFileSync(envPath, updatedContent, 'utf-8');

      app.log.info('AmoCRM credentials saved to .env.agent');

      // Also log to console for manual backup
      console.log('\n=================================================');
      console.log('AmoCRM Integration Created!');
      console.log('=================================================');
      console.log(`Client ID: ${client_id}`);
      console.log(`Client Secret: ${client_secret}`);
      console.log(`State: ${state || 'N/A'}`);
      console.log(`Name: ${name || 'N/A'}`);
      console.log('=================================================\n');

      return reply.send({
        success: true,
        message: 'Credentials received and saved'
      });

    } catch (error: any) {
      app.log.error({ error }, 'Error processing AmoCRM secrets');
      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });
}
