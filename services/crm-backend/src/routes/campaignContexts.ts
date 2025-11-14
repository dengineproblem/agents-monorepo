/**
 * Campaign Contexts API Routes
 * 
 * Manage campaign contexts (promos, cases, content, news) for message generation
 */

import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger({ module: 'campaignContexts' });

export async function campaignContextsRoutes(app: FastifyInstance) {
  /**
   * Get all contexts for a user
   */
  app.get('/contexts', async (request, reply) => {
    try {
      const { user_account_id } = request.query as any;
      
      if (!user_account_id) {
        return reply.status(400).send({ error: 'user_account_id is required' });
      }
      
      const { data, error } = await supabase
        .from('campaign_contexts')
        .select('*')
        .eq('user_account_id', user_account_id)
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false });
      
      if (error) {
        log.error({ error: error.message, user_account_id }, 'Failed to fetch contexts');
        return reply.status(500).send({ error: 'Failed to fetch contexts' });
      }
      
      reply.send(data || []);
    } catch (error: any) {
      log.error({ error: error.message }, 'Error in GET /contexts');
      reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * Get active contexts for a user (within date range)
   */
  app.get('/contexts/active', async (request, reply) => {
    try {
      const { user_account_id, funnel_stage, interest_level } = request.query as any;
      
      if (!user_account_id) {
        return reply.status(400).send({ error: 'user_account_id is required' });
      }
      
      const now = new Date().toISOString();
      
      const { data, error } = await supabase
        .from('campaign_contexts')
        .select('*')
        .eq('user_account_id', user_account_id)
        .eq('is_active', true)
        .lte('start_date', now)
        .or(`end_date.is.null,end_date.gte.${now}`)
        .order('priority', { ascending: false });
      
      if (error) {
        log.error({ error: error.message }, 'Failed to fetch active contexts');
        return reply.status(500).send({ error: 'Failed to fetch active contexts' });
      }
      
      let filtered = data || [];
      
      // Filter by funnel_stage if provided
      if (funnel_stage) {
        filtered = filtered.filter(ctx => 
          !ctx.target_funnel_stages ||
          ctx.target_funnel_stages.length === 0 ||
          ctx.target_funnel_stages.includes(funnel_stage)
        );
      }
      
      // Filter by interest_level if provided
      if (interest_level) {
        filtered = filtered.filter(ctx =>
          !ctx.target_interest_levels ||
          ctx.target_interest_levels.length === 0 ||
          ctx.target_interest_levels.includes(interest_level)
        );
      }
      
      reply.send(filtered);
    } catch (error: any) {
      log.error({ error: error.message }, 'Error in GET /contexts/active');
      reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * Create a new context
   */
  app.post('/contexts', async (request, reply) => {
    try {
      const body = request.body as any;
      
      // Validate required fields
      if (!body.user_account_id || !body.type || !body.title || !body.content) {
        return reply.status(400).send({ 
          error: 'Missing required fields: user_account_id, type, title, content' 
        });
      }
      
      // Validate type
      const validTypes = ['promo', 'case', 'content', 'news'];
      if (!validTypes.includes(body.type)) {
        return reply.status(400).send({ 
          error: `Invalid type. Must be one of: ${validTypes.join(', ')}` 
        });
      }
      
      // Validate interest levels if provided
      if (body.target_interest_levels) {
        const validLevels = ['hot', 'warm', 'cold'];
        const invalid = body.target_interest_levels.find((l: string) => !validLevels.includes(l));
        if (invalid) {
          return reply.status(400).send({ 
            error: `Invalid interest level: ${invalid}. Must be one of: ${validLevels.join(', ')}` 
          });
        }
      }
      
      const { data, error } = await supabase
        .from('campaign_contexts')
        .insert({
          user_account_id: body.user_account_id,
          type: body.type,
          title: body.title,
          content: body.content,
          goal: body.goal || null,
          start_date: body.start_date || new Date().toISOString(),
          end_date: body.end_date || null,
          target_funnel_stages: body.target_funnel_stages || [],
          target_interest_levels: body.target_interest_levels || [],
          priority: body.priority || 1,
          is_active: body.is_active !== undefined ? body.is_active : true,
        })
        .select()
        .single();
      
      if (error) {
        log.error({ error: error.message }, 'Failed to create context');
        return reply.status(500).send({ error: 'Failed to create context' });
      }
      
      log.info({ contextId: data.id, type: data.type }, 'Context created');
      reply.send(data);
    } catch (error: any) {
      log.error({ error: error.message }, 'Error in POST /contexts');
      reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * Update a context
   */
  app.put('/contexts/:id', async (request, reply) => {
    try {
      const { id } = request.params as any;
      const body = request.body as any;
      
      if (!id) {
        return reply.status(400).send({ error: 'Context ID is required' });
      }
      
      // Build update object
      const updateData: any = {
        updated_at: new Date().toISOString()
      };
      
      if (body.title !== undefined) updateData.title = body.title;
      if (body.content !== undefined) updateData.content = body.content;
      if (body.goal !== undefined) updateData.goal = body.goal;
      if (body.type !== undefined) updateData.type = body.type;
      if (body.start_date !== undefined) updateData.start_date = body.start_date;
      if (body.end_date !== undefined) updateData.end_date = body.end_date;
      if (body.target_funnel_stages !== undefined) updateData.target_funnel_stages = body.target_funnel_stages;
      if (body.target_interest_levels !== undefined) updateData.target_interest_levels = body.target_interest_levels;
      if (body.priority !== undefined) updateData.priority = body.priority;
      if (body.is_active !== undefined) updateData.is_active = body.is_active;
      
      const { data, error } = await supabase
        .from('campaign_contexts')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();
      
      if (error) {
        log.error({ error: error.message, contextId: id }, 'Failed to update context');
        return reply.status(500).send({ error: 'Failed to update context' });
      }
      
      if (!data) {
        return reply.status(404).send({ error: 'Context not found' });
      }
      
      log.info({ contextId: id }, 'Context updated');
      reply.send(data);
    } catch (error: any) {
      log.error({ error: error.message }, 'Error in PUT /contexts/:id');
      reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * Delete a context
   */
  app.delete('/contexts/:id', async (request, reply) => {
    try {
      const { id } = request.params as any;
      const { user_account_id } = request.query as any;
      
      if (!id) {
        return reply.status(400).send({ error: 'Context ID is required' });
      }
      
      if (!user_account_id) {
        return reply.status(400).send({ error: 'user_account_id is required' });
      }
      
      const { error } = await supabase
        .from('campaign_contexts')
        .delete()
        .eq('id', id)
        .eq('user_account_id', user_account_id);
      
      if (error) {
        log.error({ error: error.message, contextId: id }, 'Failed to delete context');
        return reply.status(500).send({ error: 'Failed to delete context' });
      }
      
      log.info({ contextId: id }, 'Context deleted');
      reply.send({ success: true });
    } catch (error: any) {
      log.error({ error: error.message }, 'Error in DELETE /contexts/:id');
      reply.status(500).send({ error: 'Internal server error' });
    }
  });
  
  /**
   * Get context by ID
   */
  app.get('/contexts/:id', async (request, reply) => {
    try {
      const { id } = request.params as any;
      
      const { data, error } = await supabase
        .from('campaign_contexts')
        .select('*')
        .eq('id', id)
        .single();
      
      if (error || !data) {
        return reply.status(404).send({ error: 'Context not found' });
      }
      
      reply.send(data);
    } catch (error: any) {
      log.error({ error: error.message }, 'Error in GET /contexts/:id');
      reply.status(500).send({ error: 'Internal server error' });
    }
  });
}

