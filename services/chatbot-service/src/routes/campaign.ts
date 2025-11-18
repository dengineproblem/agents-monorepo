import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { generateDailyCampaignQueue, previewCampaignQueue } from '../lib/campaignScoringAgent.js';
import { generateBatchMessages } from '../lib/messageGenerator.js';
import { sendWhatsAppMessageWithRetry, checkInstanceStatus } from '../lib/evolutionApi.js';
import { 
  checkExistingQueue, 
  determineSchedule, 
  decideQueueAction,
  markForManualSend 
} from '../lib/manualSendScheduler.js';

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
   * Supports 'action' parameter: 'replace' | 'merge' | undefined (auto-decide)
   */
  app.post('/campaign/generate-queue', async (request, reply) => {
    try {
      const body = request.body as { 
        userAccountId: string; 
        action?: 'replace' | 'merge' 
      };
      const { userAccountId, action } = body;

      if (!userAccountId) {
        return reply.status(400).send({ error: 'userAccountId is required' });
      }

      app.log.info({ userAccountId, action }, 'Starting campaign queue generation');

      // Check for existing queue
      const existingQueue = await checkExistingQueue(userAccountId);
      
      if (existingQueue && !action) {
        // Queue exists and no action specified - return info for user decision
        const recommendedAction = decideQueueAction(existingQueue);
        
        if (recommendedAction === 'ask') {
          return reply.send({
            needsDecision: true,
            existingQueue: {
              count: existingQueue.count,
              createdAt: existingQueue.createdAt,
              hasSentMessages: existingQueue.hasSentMessages,
            },
            recommendedAction: 'replace',
          });
        }
        
        // Auto-decide: replace or merge
        app.log.info({ recommendedAction }, 'Auto-deciding queue action');
        
        if (recommendedAction === 'replace') {
          // Delete existing queue
          await supabase
            .from('campaign_messages')
            .delete()
            .eq('user_account_id', userAccountId)
            .in('status', ['pending', 'scheduled']);
        }
        // If 'merge', we'll filter duplicates below
      } else if (existingQueue && action === 'replace') {
        // User explicitly chose to replace
        app.log.info('Replacing existing queue');
        await supabase
          .from('campaign_messages')
          .delete()
          .eq('user_account_id', userAccountId)
          .in('status', ['pending', 'scheduled']);
      }

      // 1. Generate queue using scoring agent
      let queue = await generateDailyCampaignQueue(userAccountId);

      if (queue.length === 0) {
        return reply.send({
          success: true,
          message: 'No eligible leads for campaign',
          queueSize: 0,
        });
      }

      // 2. If merging, filter out leads already in queue
      if (existingQueue && (action === 'merge' || decideQueueAction(existingQueue) === 'merge')) {
        const existingLeadIds = new Set(existingQueue.leadIds);
        const originalCount = queue.length;
        queue = queue.filter(lead => !existingLeadIds.has(lead.id));
        
        app.log.info({ 
          originalCount, 
          filteredCount: queue.length, 
          duplicatesRemoved: originalCount - queue.length 
        }, 'Filtered duplicate leads for merge');

        if (queue.length === 0) {
          return reply.send({
            success: true,
            message: 'All leads already in queue',
            queueSize: existingQueue.count,
            merged: true,
          });
        }
      }

      app.log.info({ userAccountId, queueSize: queue.length }, 'Queue generated, generating messages');

      // 3. Generate AI messages for each lead
      const messages = await generateBatchMessages(queue, userAccountId);

      // 4. Save new messages to campaign_messages table
      const campaignMessages = Array.from(messages.entries()).map(([leadId, msg]) => ({
        user_account_id: userAccountId,
        lead_id: leadId,
        message_text: msg.message,
        message_type: msg.type,
        strategy_type: msg.strategyType,
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
   * POST /campaign/clear-queue
   * Clear pending messages from queue
   */
  app.post('/campaign/clear-queue', async (request, reply) => {
    try {
      const { userAccountId } = request.body as { userAccountId: string };

      if (!userAccountId) {
        return reply.status(400).send({ error: 'userAccountId is required' });
      }

      const { error, count } = await supabase
        .from('campaign_messages')
        .delete({ count: 'exact' })
        .eq('user_account_id', userAccountId)
        .eq('status', 'pending');

      if (error) {
        throw error;
      }

      app.log.info({ userAccountId, deletedCount: count }, 'Cleared pending queue');

      return reply.send({
        success: true,
        deletedCount: count || 0,
      });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to clear queue');
      return reply.status(500).send({
        error: 'Failed to clear queue',
        message: error.message,
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

      const leadData = campaignMessage.lead as any;

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
          campaign_messages_count: (leadData?.campaign_messages_count || 0) + 1,
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

  /**
   * GET /campaign/analytics/overview
   * Get overview analytics
   */
  app.get('/campaign/analytics/overview', async (request, reply) => {
    try {
      const { userAccountId } = request.query as { userAccountId: string };

      if (!userAccountId) {
        return reply.status(400).send({ error: 'userAccountId is required' });
      }

      // Get total sent messages
      const { data: sentMessages } = await supabase
        .from('campaign_messages')
        .select('id', { count: 'exact', head: true })
        .eq('user_account_id', userAccountId)
        .eq('status', 'sent');

      const totalSent = sentMessages || 0;

      // Call SQL functions for metrics
      const { data: replyRateData } = await supabase.rpc('calculate_reply_rate', {
        p_user_account_id: userAccountId,
      });

      const { data: conversionRateData } = await supabase.rpc('calculate_conversion_rate', {
        p_user_account_id: userAccountId,
      });

      const { data: avgTimeToReplyData } = await supabase.rpc('get_avg_time_to_reply', {
        p_user_account_id: userAccountId,
      });

      const { data: avgTimeToActionData } = await supabase.rpc('get_avg_time_to_action', {
        p_user_account_id: userAccountId,
      });

      return reply.send({
        totalSent,
        replyRate: replyRateData || 0,
        conversionRate: conversionRateData || 0,
        avgTimeToReply: avgTimeToReplyData || 0,
        avgTimeToAction: avgTimeToActionData || 0,
      });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to get analytics overview');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /campaign/analytics/by-strategy
   * Get effectiveness by strategy type
   */
  app.get('/campaign/analytics/by-strategy', async (request, reply) => {
    try {
      const { userAccountId } = request.query as { userAccountId: string };

      if (!userAccountId) {
        return reply.status(400).send({ error: 'userAccountId is required' });
      }

      // Aggregate by strategy_type
      const { data: strategies, error } = await supabase
        .from('campaign_messages')
        .select('strategy_type, lead_id, has_reply, led_to_target_action')
        .eq('user_account_id', userAccountId)
        .eq('status', 'sent')
        .not('strategy_type', 'is', null);

      if (error) throw error;

      // Group by strategy
      const grouped = (strategies || []).reduce((acc: any, msg: any) => {
        const strategy = msg.strategy_type || 'unknown';
        if (!acc[strategy]) {
          acc[strategy] = {
            strategy_type: strategy,
            sent: 0,
            uniqueLeads: new Set(),
            replies: 0,
            conversions: 0,
          };
        }
        acc[strategy].sent++;
        acc[strategy].uniqueLeads.add(msg.lead_id);
        if (msg.has_reply) acc[strategy].replies++;
        if (msg.led_to_target_action) acc[strategy].conversions++;
        return acc;
      }, {});

      // Calculate rates
      const result = Object.values(grouped).map((g: any) => ({
        strategy_type: g.strategy_type,
        sent: g.sent,
        replies: g.replies,
        replyRate: g.sent > 0 ? ((g.replies / g.sent) * 100).toFixed(2) : 0,
        conversions: g.conversions,
        conversionRate: g.sent > 0 ? ((g.conversions / g.sent) * 100).toFixed(2) : 0,
      }));

      return reply.send(result);
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to get strategy analytics');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /campaign/analytics/by-temperature
   * Get effectiveness by lead temperature
   */
  app.get('/campaign/analytics/by-temperature', async (request, reply) => {
    try {
      const { userAccountId } = request.query as { userAccountId: string };

      if (!userAccountId) {
        return reply.status(400).send({ error: 'userAccountId is required' });
      }

      // Aggregate by interest_level_at_send
      const { data: temperatures, error } = await supabase
        .from('campaign_messages')
        .select('interest_level_at_send, lead_id, has_reply, led_to_target_action')
        .eq('user_account_id', userAccountId)
        .eq('status', 'sent')
        .not('interest_level_at_send', 'is', null);

      if (error) throw error;

      // Group by temperature
      const grouped = (temperatures || []).reduce((acc: any, msg: any) => {
        const temp = msg.interest_level_at_send || 'unknown';
        if (!acc[temp]) {
          acc[temp] = {
            interest_level: temp,
            sent: 0,
            uniqueLeads: new Set(),
            replies: 0,
            conversions: 0,
          };
        }
        acc[temp].sent++;
        acc[temp].uniqueLeads.add(msg.lead_id);
        if (msg.has_reply) acc[temp].replies++;
        if (msg.led_to_target_action) acc[temp].conversions++;
        return acc;
      }, {});

      // Calculate rates
      const result = Object.values(grouped).map((g: any) => ({
        interest_level: g.interest_level,
        sent: g.sent,
        replies: g.replies,
        replyRate: g.sent > 0 ? ((g.replies / g.sent) * 100).toFixed(2) : 0,
        conversions: g.conversions,
        conversionRate: g.sent > 0 ? ((g.conversions / g.sent) * 100).toFixed(2) : 0,
      }));

      return reply.send(result);
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to get temperature analytics');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /campaign/analytics/temperature-dynamics
   * Get temperature dynamics over time
   */
  app.get('/campaign/analytics/temperature-dynamics', async (request, reply) => {
    try {
      const { userAccountId, days = '30' } = request.query as { 
        userAccountId: string; 
        days?: string;
      };

      if (!userAccountId) {
        return reply.status(400).send({ error: 'userAccountId is required' });
      }

      // Call SQL function
      const { data, error } = await supabase.rpc('get_temperature_dynamics', {
        p_user_account_id: userAccountId,
        p_days: parseInt(days),
      });

      if (error) throw error;

      return reply.send(data || []);
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to get temperature dynamics');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /campaign/analytics/by-stage
   * Get effectiveness by funnel stage
   */
  app.get('/campaign/analytics/by-stage', async (request, reply) => {
    try {
      const { userAccountId } = request.query as { userAccountId: string };

      if (!userAccountId) {
        return reply.status(400).send({ error: 'userAccountId is required' });
      }

      // Aggregate by funnel_stage_at_send
      const { data: stages, error } = await supabase
        .from('campaign_messages')
        .select('funnel_stage_at_send, lead_id, has_reply, led_to_target_action')
        .eq('user_account_id', userAccountId)
        .eq('status', 'sent')
        .not('funnel_stage_at_send', 'is', null);

      if (error) throw error;

      // Group by stage
      const grouped = (stages || []).reduce((acc: any, msg: any) => {
        const stage = msg.funnel_stage_at_send || 'unknown';
        if (!acc[stage]) {
          acc[stage] = {
            funnel_stage: stage,
            sent: 0,
            replies: 0,
            conversions: 0,
          };
        }
        acc[stage].sent++;
        if (msg.has_reply) acc[stage].replies++;
        if (msg.led_to_target_action) acc[stage].conversions++;
        return acc;
      }, {});

      const result = Object.values(grouped);

      return reply.send(result);
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to get stage analytics');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /campaign/generate-single-message
   * Generate AI message for a single lead (for CRM UI)
   */
  app.post('/campaign/generate-single-message', async (request, reply) => {
    try {
      const { userAccountId, leadId } = request.body as { 
        userAccountId: string; 
        leadId: string;
      };

      if (!userAccountId || !leadId) {
        return reply.status(400).send({ error: 'userAccountId and leadId are required' });
      }

      app.log.info({ userAccountId, leadId }, 'Generating single message');

      // Get lead data
      const { data: lead, error: leadError } = await supabase
        .from('dialog_analysis')
        .select('*')
        .eq('id', leadId)
        .eq('user_account_id', userAccountId)
        .single();

      if (leadError || !lead) {
        return reply.status(404).send({ error: 'Lead not found' });
      }

      // Generate message using the existing message generator
      const messagesMap = await generateBatchMessages([lead], userAccountId);
      const generatedMessage = messagesMap.get(leadId);

      if (!generatedMessage) {
        return reply.status(500).send({ error: 'Failed to generate message' });
      }

      app.log.info({ leadId, messageType: generatedMessage.type }, 'Message generated successfully');

      return reply.send({
        message: generatedMessage.message,
        messageType: generatedMessage.type,
      });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to generate single message');
      return reply.status(500).send({ 
        error: 'Message generation failed', 
        message: error.message 
      });
    }
  });

  /**
   * GET /campaign/queue-status
   * Check if there's an existing queue and its status
   */
  app.get('/campaign/queue-status', async (request, reply) => {
    try {
      const { userAccountId } = request.query as { userAccountId: string };

      if (!userAccountId) {
        return reply.status(400).send({ error: 'userAccountId is required' });
      }

      const existingQueue = await checkExistingQueue(userAccountId);

      if (!existingQueue) {
        return reply.send({
          hasQueue: false,
        });
      }

      const action = decideQueueAction(existingQueue);

      return reply.send({
        hasQueue: true,
        count: existingQueue.count,
        createdAt: existingQueue.createdAt,
        hasSentMessages: existingQueue.hasSentMessages,
        recommendedAction: action,
      });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to check queue status');
      return reply.status(500).send({ 
        error: 'Failed to check queue status', 
        message: error.message 
      });
    }
  });

  /**
   * POST /campaign/start-manual-send
   * Start manual sending of the queue with smart scheduling
   */
  app.post('/campaign/start-manual-send', async (request, reply) => {
    try {
      const body = GenerateQueueSchema.parse(request.body);
      const { userAccountId } = body;

      app.log.info({ userAccountId }, 'Starting manual send');

      // Check if there are pending messages
      const { data: messages, error } = await supabase
        .from('campaign_messages')
        .select('id')
        .eq('user_account_id', userAccountId)
        .in('status', ['pending', 'scheduled']);

      if (error) {
        throw error;
      }

      if (!messages || messages.length === 0) {
        return reply.status(400).send({ 
          error: 'No messages in queue',
          message: 'Please generate a queue first' 
        });
      }

      // Determine schedule
      const schedule = await determineSchedule(userAccountId, messages.length);

      // Mark messages for manual send
      const markedCount = await markForManualSend(userAccountId);

      app.log.info({ 
        userAccountId, 
        markedCount, 
        mode: schedule.mode 
      }, 'Manual send initiated');

      return reply.send({
        success: true,
        mode: schedule.mode,
        scheduledFor: schedule.scheduledFor,
        nextWorkingTime: schedule.nextWorkingTime,
        estimatedDuration: schedule.estimatedDuration,
        messagesPerHour: schedule.messagesPerHour,
        queueSize: markedCount,
      });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to start manual send');
      return reply.status(500).send({ 
        error: 'Failed to start manual send', 
        message: error.message 
      });
    }
  });
}

