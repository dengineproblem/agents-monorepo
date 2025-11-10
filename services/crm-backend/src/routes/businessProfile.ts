import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { generatePersonalizedPromptContext } from '../lib/promptGenerator.js';

const BusinessProfileSchema = z.object({
  userAccountId: z.string().uuid(),
  business_industry: z.string().min(1, 'Укажите сферу деятельности'),
  business_description: z.string().min(3, 'Минимум 3 символа'),
  target_audience: z.string().min(3, 'Минимум 3 символа'),
  main_challenges: z.string().min(3, 'Минимум 3 символа'),
  funnel_stages: z.array(z.string()).optional(),
  
  // New personalization fields
  funnel_stages_description: z.string().min(3, 'Минимум 3 символа').optional(),
  stage_transition_criteria: z.string().min(3, 'Минимум 3 символа').optional(),
  positive_signals: z.string().min(3, 'Минимум 3 символа').optional(),
  negative_signals: z.string().min(3, 'Минимум 3 символа').optional(),
});

export async function businessProfileRoutes(app: FastifyInstance) {
  /**
   * GET /business-profile/:userId - Get business profile
   */
  app.get('/business-profile/:userId', async (request, reply) => {
    try {
      const { userId } = request.params as { userId: string };
      
      const { data, error } = await supabase
        .from('business_profile')
        .select('*')
        .eq('user_account_id', userId)
        .maybeSingle();
      
      if (error) {
        return reply.status(500).send({ error: error.message });
      }
      
      return reply.send({ profile: data });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to get business profile');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /business-profile - Create/update business profile
   */
  app.post('/business-profile', async (request, reply) => {
    try {
      const body = BusinessProfileSchema.parse(request.body);
      
      app.log.info({ userAccountId: body.userAccountId }, 'Creating/updating business profile');

      // Create/update profile
      const { data, error } = await supabase
        .from('business_profile')
        .upsert({
          user_account_id: body.userAccountId,
          business_industry: body.business_industry,
          business_description: body.business_description,
          target_audience: body.target_audience,
          main_challenges: body.main_challenges,
          funnel_stages: body.funnel_stages,
          funnel_stages_description: body.funnel_stages_description,
          stage_transition_criteria: body.stage_transition_criteria,
          positive_signals: body.positive_signals,
          negative_signals: body.negative_signals,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'user_account_id'
        })
        .select()
        .single();
      
      if (error) {
        app.log.error({ error: error.message }, 'Failed to save business profile');
        return reply.status(500).send({ error: error.message });
      }

      // Generate personalized context
      try {
        app.log.info({ userAccountId: body.userAccountId }, 'Generating personalized context');
        
        const context = await generatePersonalizedPromptContext({
          business_industry: body.business_industry,
          business_description: body.business_description,
          target_audience: body.target_audience,
          main_challenges: body.main_challenges,
          funnel_stages_description: body.funnel_stages_description,
          stage_transition_criteria: body.stage_transition_criteria,
          positive_signals: body.positive_signals,
          negative_signals: body.negative_signals,
        });

        // Save context to profile
        await supabase
          .from('business_profile')
          .update({ 
            personalized_context: context,
            updated_at: new Date().toISOString()
          })
          .eq('user_account_id', body.userAccountId);

        app.log.info({ userAccountId: body.userAccountId }, 'Personalized context saved');
      } catch (contextError: any) {
        app.log.error({ error: contextError.message }, 'Failed to generate personalized context');
        // Continue anyway - profile is saved
      }
      
      return reply.send({ profile: data });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ 
          error: 'Validation error', 
          details: error.errors 
        });
      }
      
      app.log.error({ error: error.message }, 'Failed to create business profile');
      return reply.status(500).send({ error: error.message });
    }
  });
}

