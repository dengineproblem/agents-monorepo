import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { generateDailyCampaignQueue, previewCampaignQueue } from '../lib/campaignScoringAgent.js';
import { generateBatchMessages } from '../lib/messageGenerator.js';
import { sendWhatsAppMessageWithRetry, checkInstanceStatus } from '../lib/evolutionApi.js';

// Validation schemas
const GenerateQueueSchema = z.object({
  userAccountId: z.string().uuid(),
});

const TodayQueueSchema = z.object({
  userAccountId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
  status: z.enum(['pending', 'sent', 'failed', 'copied']).optional(),
});

const SendAutoSchema = z.object({
  messageId: z.string().uuid(),
});

const MarkCopiedSchema = z.object({
  messageId: z.string().uuid(),
});

export async function campaignRoutes(app: FastifyInstance) {
  
  /**
   * POST /campaign/generate-queue
   * Generate daily campaign queue with AI-personalized messages
   */
  app.post('/campaign/generate-queue', async (request, reply) => {
    try {
      const body = GenerateQueueSchema.parse(request.body);
      const { userAccountId } = body;

      app.log.info({ userAccountId }, 'Starting campaign queue generation');

      // 1. Generate queue using scoring agent
      const queue = await generateDailyCampaignQueue(userAccountId);

      if (queue.length === 0) {
        return reply.send({
          success: true,
          message: 'No eligible leads for campaign',
          queueSize: 0,
        });
      }

      app.log.info({ userAccountId, queueSize: queue.length }, 'Queue generated, generating messages');

      // 2. Generate AI messages for each lead
      const messages = await generateBatchMessages(queue, userAccountId);

      // 3. Save messages to campaign_messages table
      const campaignMessages = Array.from(messages.entries()).map(([leadId, msg]) => ({
        user_account_id: userAccountId,
        lead_id: leadId,
        message_text: msg.message,
        message_type: msg.type,
        status: 'pending',
        scheduled_at: new Date().toISOString(),
      }));

      const { error: insertError } = await supabase
        .from('campaign_messages')
        .insert(campaignMessages);

      if (insertError) {
        throw insertError;
      }

      app.log.info({ 
        userAccountId, 
        queueSize: queue.length,
        messagesGenerated: messages.size 
      }, 'Campaign queue generated successfully');

      return reply.send({
        success: true,
        queueSize: queue.length,
        messagesGenerated: messages.size,
        topLeads: queue.slice(0, 5).map(l => ({
          id: l.id,
          contactName: l.contact_name,
          contactPhone: l.contact_phone,
          reactivationScore: l.reactivationScore,
          interestLevel: l.interest_level,
        })),
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ 
          error: 'Validation error', 
          details: error.errors 
        });
      }
      
      app.log.error({ error: error.message }, 'Failed to generate campaign queue');
      return reply.status(500).send({ 
        error: 'Failed to generate queue', 
        message: error.message 
      });
    }
  });

  /**
   * GET /campaign/today-queue
   * Get today's campaign queue (paginated)
   */
  app.get('/campaign/today-queue', async (request, reply) => {
    try {
      const query = TodayQueueSchema.parse(request.query);
      const { userAccountId, limit, offset, status } = query;

      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      let dbQuery = supabase
        .from('campaign_messages')
        .select(`
          *,
          lead:dialog_analysis(
            id,
            contact_name,
            contact_phone,
            interest_level,
            score,
            reactivation_score,
            funnel_stage,
            business_type,
            is_medical
          )
        `)
        .eq('user_account_id', userAccountId)
        .gte('created_at', startOfDay.toISOString())
        .order('created_at', { ascending: true })
        .range(offset, offset + limit - 1);

      if (status) {
        dbQuery = dbQuery.eq('status', status);
      }

      const { data, error } = await dbQuery;

      if (error) {
        throw error;
      }

      // Get total count for pagination
      let countQuery = supabase
        .from('campaign_messages')
        .select('id', { count: 'exact', head: true })
        .eq('user_account_id', userAccountId)
        .gte('created_at', startOfDay.toISOString());

      if (status) {
        countQuery = countQuery.eq('status', status);
      }

      const { count } = await countQuery;

      return reply.send({
        success: true,
        messages: data || [],
        total: count || 0,
        limit,
        offset,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ 
          error: 'Validation error', 
          details: error.errors 
        });
      }
      
      app.log.error({ error: error.message }, 'Failed to fetch today queue');
      return reply.status(500).send({ 
        error: 'Failed to fetch queue', 
        message: error.message 
      });
    }
  });

  /**
   * POST /campaign/send-auto
   * Automatically send a campaign message via Evolution API
   */
  app.post('/campaign/send-auto', async (request, reply) => {
    try {
      const body = SendAutoSchema.parse(request.body);
      const { messageId } = body;

      app.log.info({ messageId }, 'Sending campaign message');

      // 1. Get message and lead data
      const { data: campaignMessage, error: fetchError } = await supabase
        .from('campaign_messages')
        .select(`
          *,
          lead:dialog_analysis(
            id,
            instance_name,
            contact_phone,
            contact_name,
            campaign_messages_count
          )
        `)
        .eq('id', messageId)
        .single();

      if (fetchError || !campaignMessage) {
        return reply.status(404).send({ error: 'Message not found' });
      }

      if (campaignMessage.status === 'sent') {
        return reply.status(400).send({ error: 'Message already sent' });
      }

      const lead = campaignMessage.lead;

      // 2. Check instance status
      const instanceReady = await checkInstanceStatus(lead.instance_name);
      if (!instanceReady) {
        return reply.status(503).send({ 
          error: 'Instance not ready',
          message: 'WhatsApp instance is not connected'
        });
      }

      // 3. Send message via Evolution API
      const sendResult = await sendWhatsAppMessageWithRetry({
        instanceName: lead.instance_name,
        phone: lead.contact_phone,
        message: campaignMessage.message_text,
      });

      if (!sendResult.success) {
        // Update status to failed
        await supabase
          .from('campaign_messages')
          .update({
            status: 'failed',
            error_message: sendResult.error,
          })
          .eq('id', messageId);

        return reply.status(500).send({
          error: 'Failed to send message',
          message: sendResult.error,
        });
      }

      // 4. Update campaign message status
      await supabase
        .from('campaign_messages')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
        })
        .eq('id', messageId);

      // 5. Update lead statistics
      await supabase
        .from('dialog_analysis')
        .update({
          last_campaign_message_at: new Date().toISOString(),
          campaign_messages_count: (lead.campaign_messages_count || 0) + 1,
        })
        .eq('id', lead.id);

      app.log.info({ messageId, leadId: lead.id }, 'Message sent successfully');

      return reply.send({
        success: true,
        messageId,
        sentAt: new Date().toISOString(),
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ 
          error: 'Validation error', 
          details: error.errors 
        });
      }
      
      app.log.error({ error: error.message }, 'Failed to send message');
      return reply.status(500).send({ 
        error: 'Failed to send message', 
        message: error.message 
      });
    }
  });

  /**
   * POST /campaign/mark-copied
   * Mark message as copied (for manual sending)
   */
  app.post('/campaign/mark-copied', async (request, reply) => {
    try {
      const body = MarkCopiedSchema.parse(request.body);
      const { messageId } = body;

      app.log.info({ messageId }, 'Marking message as copied');

      // Get lead ID to update statistics
      const { data: campaignMessage, error: fetchError } = await supabase
        .from('campaign_messages')
        .select('lead_id, lead:dialog_analysis(campaign_messages_count)')
        .eq('id', messageId)
        .single();

      if (fetchError || !campaignMessage) {
        return reply.status(404).send({ error: 'Message not found' });
      }

      // Update message status
      await supabase
        .from('campaign_messages')
        .update({
          status: 'copied',
          sent_at: new Date().toISOString(),
        })
        .eq('id', messageId);

      // Update lead statistics
      await supabase
        .from('dialog_analysis')
        .update({
          last_campaign_message_at: new Date().toISOString(),
          campaign_messages_count: (campaignMessage.lead.campaign_messages_count || 0) + 1,
        })
        .eq('id', campaignMessage.lead_id);

      app.log.info({ messageId }, 'Message marked as copied');

      return reply.send({ success: true });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ 
          error: 'Validation error', 
          details: error.errors 
        });
      }
      
      app.log.error({ error: error.message }, 'Failed to mark message as copied');
      return reply.status(500).send({ 
        error: 'Failed to mark as copied', 
        message: error.message 
      });
    }
  });

  /**
   * GET /campaign/preview-queue
   * Preview top N leads without generating full queue (for UI preview)
   */
  app.get('/campaign/preview-queue', async (request, reply) => {
    try {
      const { userAccountId, limit = 50 } = request.query as {
        userAccountId: string;
        limit?: number;
      };

      if (!userAccountId) {
        return reply.status(400).send({ error: 'userAccountId is required' });
      }

      const topLeads = await previewCampaignQueue(userAccountId, limit);

      return reply.send({
        success: true,
        leads: topLeads.map(l => ({
          id: l.id,
          contactName: l.contact_name,
          contactPhone: l.contact_phone,
          reactivationScore: l.reactivationScore,
          interestLevel: l.interest_level,
          score: l.score,
          funnelStage: l.funnel_stage,
          lastCampaignMessageAt: l.last_campaign_message_at,
          campaignMessagesCount: l.campaign_messages_count,
        })),
        total: topLeads.length,
      });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to preview queue');
      return reply.status(500).send({ 
        error: 'Failed to preview queue', 
        message: error.message 
      });
    }
  });

  /**
   * GET /campaign/stats
   * Get campaign statistics
   */
  app.get('/campaign/stats', async (request, reply) => {
    try {
      const { userAccountId } = request.query as { userAccountId: string };

      if (!userAccountId) {
        return reply.status(400).send({ error: 'userAccountId is required' });
      }

      // Get message stats
      const { data: messages, error: messagesError } = await supabase
        .from('campaign_messages')
        .select('status')
        .eq('user_account_id', userAccountId);

      if (messagesError) {
        throw messagesError;
      }

      const stats = {
        total: messages?.length || 0,
        pending: messages?.filter(m => m.status === 'pending').length || 0,
        sent: messages?.filter(m => m.status === 'sent').length || 0,
        failed: messages?.filter(m => m.status === 'failed').length || 0,
        copied: messages?.filter(m => m.status === 'copied').length || 0,
      };

      // Get today's stats
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayISO = today.toISOString();

      const { data: todayMessages, error: todayError } = await supabase
        .from('campaign_messages')
        .select('status')
        .eq('user_account_id', userAccountId)
        .gte('created_at', todayISO);

      if (todayError) {
        throw todayError;
      }

      const todayStats = {
        total: todayMessages?.length || 0,
        sent: todayMessages?.filter(m => m.status === 'sent').length || 0,
      };

      return reply.send({ 
        allTime: stats,
        today: todayStats,
      });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to get campaign stats');
      return reply.status(500).send({ 
        error: 'Failed to get stats', 
        message: error.message 
      });
    }
  });
}

