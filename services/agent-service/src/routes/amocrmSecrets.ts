/**
 * AmoCRM Secrets Handler
 *
 * Receives client_id and client_secret when integration is auto-created via button
 *
 * @module routes/amocrmSecrets
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { saveTempCredentials, extractUserAccountIdFromState } from '../lib/amocrmTempCredentials.js';

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

      if (!state) {
        return reply.code(400).send({
          error: 'missing_state',
          message: 'State parameter is required for auto-created integrations'
        });
      }

      app.log.info({
        client_id: client_id.substring(0, 10) + '...',
        state,
        name,
        scopes
      }, 'Received AmoCRM auto-generated credentials');

      // Extract user_account_id from state if encoded
      const userAccountId = extractUserAccountIdFromState(state);

      // Save credentials temporarily (expires in 10 minutes)
      // They will be retrieved during OAuth callback
      await saveTempCredentials({
        state,
        client_id,
        client_secret,
        user_account_id: userAccountId || undefined,
        integration_name: name,
        scopes
      });

      app.log.info({
        state,
        userAccountId: userAccountId || 'not_encoded',
        integrationName: name
      }, 'AmoCRM credentials saved temporarily');

      return reply.send({
        success: true,
        message: 'Credentials received and saved temporarily'
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
