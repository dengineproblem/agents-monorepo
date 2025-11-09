import { FastifyInstance } from 'fastify';
import { FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import { parseDocument } from '../lib/documentParser.js';
import { generateBotPrompt, saveBotConfiguration, getBotConfiguration } from '../lib/promptGenerator.js';
import { supabase } from '../lib/supabase.js';

export default async function documentsRoutes(app: FastifyInstance) {
  // Регистрация multipart для загрузки файлов
  app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB max
      files: 5 // До 5 файлов за раз
    }
  });

  /**
   * POST /chatbot/documents/upload
   * Загрузка документов и автоматическая генерация промпта
   */
  app.post('/chatbot/documents/upload', async (request, reply) => {
    try {
      const parts = request.parts();
      const uploadedDocs: any[] = [];
      let userAccountId: string | null = null;
      let userInstructions: string | null = null;

      for await (const part of parts) {
        if (part.type === 'file') {
          const buffer = await part.toBuffer();
          const filename = part.filename;
          
          app.log.info({ filename, size: buffer.length }, 'Processing uploaded file');

          // Парсинг документа
          const parsedDoc = await parseDocument(buffer, filename);
          
          // TODO: Загрузить в Supabase Storage (опционально)
          // Пока сохраняем только метаданные
          
          uploadedDocs.push({
            name: filename,
            type: parsedDoc.type,
            size: buffer.length,
            content: parsedDoc.content,
            structured: parsedDoc.structured
          });
        } else if (part.fieldname === 'user_account_id') {
          userAccountId = (part as any).value;
        } else if (part.fieldname === 'user_instructions') {
          userInstructions = (part as any).value;
        }
      }

      if (!userAccountId) {
        return reply.status(400).send({ error: 'user_account_id is required' });
      }

      if (uploadedDocs.length === 0) {
        return reply.status(400).send({ error: 'No files uploaded' });
      }

      // Генерация промпта из документов
      const aiInstructions = await generateBotPrompt({
        userAccountId,
        documents: uploadedDocs,
        userInstructions: userInstructions || undefined
      });

      // Сохранить конфигурацию
      const result = await saveBotConfiguration({
        userAccountId,
        aiInstructions,
        userInstructions: userInstructions || undefined,
        documents: uploadedDocs.map(doc => ({
          name: doc.name,
          url: '', // TODO: URL из Supabase Storage
          type: doc.type,
          size: doc.size
        }))
      });

      if (!result.success) {
        throw new Error(result.error);
      }

      app.log.info({ 
        userAccountId, 
        documentsCount: uploadedDocs.length,
        configId: result.configId 
      }, 'Documents uploaded and prompt generated');

      return reply.send({
        success: true,
        configId: result.configId,
        aiInstructions,
        documentsProcessed: uploadedDocs.length,
        documents: uploadedDocs.map(doc => ({
          name: doc.name,
          type: doc.type,
          size: doc.size
        }))
      });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Error uploading documents');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /chatbot/configuration/:userAccountId
   * Получить конфигурацию бота
   */
  app.get('/chatbot/configuration/:userAccountId', async (request, reply) => {
    try {
      const { userAccountId } = request.params as { userAccountId: string };

      const config = await getBotConfiguration(userAccountId);

      if (!config) {
        return reply.status(404).send({ error: 'Configuration not found' });
      }

      return reply.send(config);
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Error fetching configuration');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * PUT /chatbot/configuration/:configId
   * Обновить конфигурацию бота (ручное редактирование промпта)
   */
  app.put('/chatbot/configuration/:configId', async (request, reply) => {
    try {
      const { configId } = request.params as { configId: string };
      const updates = request.body as {
        ai_instructions?: string;
        user_instructions?: string;
        triggers?: any[];
        active?: boolean;
        working_hours?: any;
      };

      const { error } = await supabase
        .from('chatbot_configurations')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', configId);

      if (error) throw error;

      app.log.info({ configId }, 'Bot configuration updated');

      return reply.send({ success: true });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Error updating configuration');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /chatbot/regenerate-prompt
   * Регенерировать промпт на основе существующих документов
   */
  app.post('/chatbot/regenerate-prompt', async (request, reply) => {
    try {
      const { userAccountId, userInstructions } = request.body as {
        userAccountId: string;
        userInstructions?: string;
      };

      if (!userAccountId) {
        return reply.status(400).send({ error: 'userAccountId is required' });
      }

      // Получить существующую конфигурацию
      const config = await getBotConfiguration(userAccountId);

      if (!config) {
        return reply.status(404).send({ error: 'Configuration not found' });
      }

      // Регенерировать промпт
      const aiInstructions = await generateBotPrompt({
        userAccountId,
        documents: config.documents || [],
        userInstructions: userInstructions || config.user_instructions
      });

      // Сохранить обновлённый промпт
      const { error } = await supabase
        .from('chatbot_configurations')
        .update({
          ai_instructions: aiInstructions,
          user_instructions: userInstructions || config.user_instructions,
          updated_at: new Date().toISOString()
        })
        .eq('id', config.id);

      if (error) throw error;

      app.log.info({ userAccountId, configId: config.id }, 'Prompt regenerated');

      return reply.send({
        success: true,
        aiInstructions
      });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Error regenerating prompt');
      return reply.status(500).send({ error: error.message });
    }
  });
}

