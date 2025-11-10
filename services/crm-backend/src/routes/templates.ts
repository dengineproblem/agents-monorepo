import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';

// Validation schemas
const CreateTemplateSchema = z.object({
  userAccountId: z.string().uuid(),
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(5000),
  templateType: z.enum(['selling', 'useful', 'reminder']),
  isActive: z.boolean().optional().default(true),
});

const UpdateTemplateSchema = z.object({
  userAccountId: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(5000).optional(),
  templateType: z.enum(['selling', 'useful', 'reminder']).optional(),
  isActive: z.boolean().optional(),
});

const GetTemplatesSchema = z.object({
  userAccountId: z.string().uuid(),
  templateType: z.enum(['selling', 'useful', 'reminder']).optional(),
  isActive: z.boolean().optional(),
});

export async function templatesRoutes(app: FastifyInstance) {
  
  /**
   * GET /templates
   * Get all templates for a user
   */
  app.get('/templates', async (request, reply) => {
    try {
      const query = GetTemplatesSchema.parse(request.query);
      const { userAccountId, templateType, isActive } = query;

      let dbQuery = supabase
        .from('campaign_templates')
        .select('*')
        .eq('user_account_id', userAccountId)
        .order('created_at', { ascending: false });

      if (templateType) {
        dbQuery = dbQuery.eq('template_type', templateType);
      }

      if (isActive !== undefined) {
        dbQuery = dbQuery.eq('is_active', isActive);
      }

      const { data, error } = await dbQuery;

      if (error) {
        throw error;
      }

      return reply.send({
        success: true,
        templates: data || [],
        count: data?.length || 0,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ 
          error: 'Validation error', 
          details: error.errors 
        });
      }
      
      app.log.error({ error: error.message }, 'Failed to fetch templates');
      return reply.status(500).send({ 
        error: 'Failed to fetch templates', 
        message: error.message 
      });
    }
  });

  /**
   * POST /templates
   * Create a new template
   */
  app.post('/templates', async (request, reply) => {
    try {
      const body = CreateTemplateSchema.parse(request.body);
      const { userAccountId, title, content, templateType, isActive } = body;

      app.log.info({ userAccountId, title, templateType }, 'Creating template');

      const { data, error } = await supabase
        .from('campaign_templates')
        .insert({
          user_account_id: userAccountId,
          title,
          content,
          template_type: templateType,
          is_active: isActive,
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      app.log.info({ templateId: data.id }, 'Template created');

      return reply.status(201).send({
        success: true,
        template: data,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ 
          error: 'Validation error', 
          details: error.errors 
        });
      }
      
      app.log.error({ error: error.message }, 'Failed to create template');
      return reply.status(500).send({ 
        error: 'Failed to create template', 
        message: error.message 
      });
    }
  });

  /**
   * PUT /templates/:id
   * Update a template
   */
  app.put('/templates/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = UpdateTemplateSchema.parse(request.body);
      const { userAccountId, ...updateData } = body;

      app.log.info({ templateId: id, userAccountId }, 'Updating template');

      // Verify template belongs to user
      const { data: template, error: fetchError } = await supabase
        .from('campaign_templates')
        .select('id, user_account_id')
        .eq('id', id)
        .single();

      if (fetchError || !template) {
        return reply.status(404).send({ error: 'Template not found' });
      }

      if (template.user_account_id !== userAccountId) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      // Build update object
      const updateObject: any = {
        updated_at: new Date().toISOString(),
      };

      if (updateData.title !== undefined) updateObject.title = updateData.title;
      if (updateData.content !== undefined) updateObject.content = updateData.content;
      if (updateData.templateType !== undefined) updateObject.template_type = updateData.templateType;
      if (updateData.isActive !== undefined) updateObject.is_active = updateData.isActive;

      // Update template
      const { data, error } = await supabase
        .from('campaign_templates')
        .update(updateObject)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        throw error;
      }

      app.log.info({ templateId: id }, 'Template updated');

      return reply.send({
        success: true,
        template: data,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ 
          error: 'Validation error', 
          details: error.errors 
        });
      }
      
      app.log.error({ error: error.message }, 'Failed to update template');
      return reply.status(500).send({ 
        error: 'Failed to update template', 
        message: error.message 
      });
    }
  });

  /**
   * DELETE /templates/:id
   * Delete a template
   */
  app.delete('/templates/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const { userAccountId } = request.query as { userAccountId: string };

      if (!userAccountId) {
        return reply.status(400).send({ error: 'userAccountId query parameter is required' });
      }

      app.log.info({ templateId: id, userAccountId }, 'Deleting template');

      // Verify template belongs to user
      const { data: template, error: fetchError } = await supabase
        .from('campaign_templates')
        .select('id, user_account_id')
        .eq('id', id)
        .single();

      if (fetchError || !template) {
        return reply.status(404).send({ error: 'Template not found' });
      }

      if (template.user_account_id !== userAccountId) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      // Delete template
      const { error } = await supabase
        .from('campaign_templates')
        .delete()
        .eq('id', id);

      if (error) {
        throw error;
      }

      app.log.info({ templateId: id }, 'Template deleted');

      return reply.send({ success: true });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to delete template');
      return reply.status(500).send({ 
        error: 'Failed to delete template', 
        message: error.message 
      });
    }
  });

  /**
   * PATCH /templates/:id/increment-usage
   * Increment usage counter for a template (called when template is used in message generation)
   */
  app.patch('/templates/:id/increment-usage', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };

      const { data, error } = await supabase
        .rpc('increment_template_usage', { template_id: id });

      if (error) {
        throw error;
      }

      return reply.send({ success: true });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to increment template usage');
      return reply.status(500).send({ 
        error: 'Failed to increment usage', 
        message: error.message 
      });
    }
  });
}

