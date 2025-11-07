import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { z } from 'zod';

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://evolution-api:8080';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';

// Схемы валидации
const CreateInstanceSchema = z.object({
  userAccountId: z.string().uuid(),
  phoneNumberId: z.string().uuid().optional(),
});

export default async function whatsappInstances(app: FastifyInstance) {

  /**
   * POST /api/whatsapp/instances/create - Create new WhatsApp instance and get QR code
   */
  app.post('/whatsapp/instances/create', async (request, reply) => {
    try {
      const body = CreateInstanceSchema.parse(request.body);
      const { userAccountId } = body;

      // Генерировать уникальное имя instance
      const instanceName = `instance_${userAccountId.slice(0, 8)}_${Date.now()}`;

      app.log.info({ userAccountId, instanceName }, 'Creating WhatsApp instance');

      // Вызвать Evolution API для создания instance
      const evolutionResponse = await fetch(`${EVOLUTION_API_URL}/instance/create`, {
        method: 'POST',
        headers: {
          'apikey': EVOLUTION_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          instanceName,
          qrcode: true,
          integration: 'WHATSAPP-BAILEYS'
        })
      });

      if (!evolutionResponse.ok) {
        const errorText = await evolutionResponse.text();
        throw new Error(`Evolution API error: ${errorText}`);
      }

      const evolutionData = await evolutionResponse.json();

      // Сохранить в базу данных
      const { data: instance, error } = await supabase
        .from('whatsapp_instances')
        .insert({
          user_account_id: userAccountId,
          instance_name: instanceName,
          instance_id: evolutionData.instance?.instanceName || instanceName,
          status: 'connecting',
          qr_code: evolutionData.qrcode?.base64 || evolutionData.qrcode?.code
        })
        .select()
        .single();

      if (error) {
        app.log.error({ error }, 'Failed to save instance to database');
        return reply.status(500).send({ error: 'Failed to save instance' });
      }

      // Если передан phoneNumberId - обновить whatsapp_phone_numbers
      if (body.phoneNumberId) {
        const { error: updateError } = await supabase
          .from('whatsapp_phone_numbers')
          .update({
            instance_name: instanceName,
            connection_status: 'connecting'
          })
          .eq('id', body.phoneNumberId)
          .eq('user_account_id', userAccountId);

        if (updateError) {
          app.log.error({ updateError }, 'Failed to update phone number with instance');
        } else {
          app.log.info({ phoneNumberId: body.phoneNumberId, instanceName }, 'Updated phone number with instance');
        }
      }

      app.log.info({ instanceId: instance.id, instanceName }, 'WhatsApp instance created');

      return reply.send({
        success: true,
        instance,
        qrcode: evolutionData.qrcode
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: error.errors[0].message });
      }
      app.log.error({ error: error.message }, 'Failed to create WhatsApp instance');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /api/whatsapp/instances/:instanceName/status - Get instance status
   */
  app.get('/whatsapp/instances/:instanceName/status', async (request, reply) => {
    const { instanceName } = request.params as any;

    try {
      const { data: instance, error } = await supabase
        .from('whatsapp_instances')
        .select('*')
        .eq('instance_name', instanceName)
        .single();

      if (error) {
        return reply.status(404).send({ error: 'Instance not found' });
      }

      return reply.send({
        success: true,
        instance
      });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to get instance status');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /api/whatsapp/instances - List all instances for user
   */
  app.get('/whatsapp/instances', async (request, reply) => {
    const { userAccountId } = request.query as any;

    if (!userAccountId) {
      return reply.status(400).send({ error: 'userAccountId is required' });
    }

    try {
      const { data: instances, error } = await supabase
        .from('whatsapp_instances')
        .select('*')
        .eq('user_account_id', userAccountId)
        .order('created_at', { ascending: false });

      if (error) {
        return reply.status(500).send({ error: error.message });
      }

      return reply.send({
        success: true,
        instances: instances || []
      });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to list instances');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * DELETE /api/whatsapp/instances/:instanceName - Disconnect and delete instance
   */
  app.delete('/whatsapp/instances/:instanceName', async (request, reply) => {
    const { instanceName } = request.params as any;

    try {
      app.log.info({ instanceName }, 'Disconnecting WhatsApp instance');

      // Вызвать Evolution API для отключения
      try {
        await fetch(`${EVOLUTION_API_URL}/instance/logout/${instanceName}`, {
          method: 'DELETE',
          headers: { 'apikey': EVOLUTION_API_KEY }
        });
      } catch (evolutionError) {
        app.log.warn({ error: evolutionError }, 'Evolution API logout failed, continuing with DB cleanup');
      }

      // Обновить статус в базе
      const { error } = await supabase
        .from('whatsapp_instances')
        .update({
          status: 'disconnected',
          qr_code: null,
          updated_at: new Date().toISOString()
        })
        .eq('instance_name', instanceName);

      if (error) {
        app.log.error({ error }, 'Failed to update instance status');
        return reply.status(500).send({ error: 'Failed to disconnect instance' });
      }

      return reply.send({ success: true });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to disconnect instance');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /api/whatsapp/instances/:instanceName/refresh-qr - Refresh QR code for instance
   */
  app.post('/whatsapp/instances/:instanceName/refresh-qr', async (request, reply) => {
    const { instanceName } = request.params as any;

    try {
      // Call Evolution API to get new QR code
      const evolutionResponse = await fetch(`${EVOLUTION_API_URL}/instance/connect/${instanceName}`, {
        method: 'GET',
        headers: { 'apikey': EVOLUTION_API_KEY }
      });

      if (!evolutionResponse.ok) {
        const errorText = await evolutionResponse.text();
        throw new Error(`Evolution API error: ${errorText}`);
      }

      const evolutionData = await evolutionResponse.json();

      // Update QR code in database
      const { error } = await supabase
        .from('whatsapp_instances')
        .update({
          qr_code: evolutionData.qrcode?.base64 || evolutionData.qrcode?.code,
          status: 'connecting',
          updated_at: new Date().toISOString()
        })
        .eq('instance_name', instanceName);

      if (error) {
        app.log.error({ error }, 'Failed to update QR code');
        return reply.status(500).send({ error: 'Failed to refresh QR code' });
      }

      return reply.send({
        success: true,
        qrcode: evolutionData.qrcode
      });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to refresh QR code');
      return reply.status(500).send({ error: error.message });
    }
  });
}
