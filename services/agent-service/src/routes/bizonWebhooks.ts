/**
 * Bizon365 Webhooks Handler
 * 
 * Receives webhooks from Bizon365 webinar platform and processes webinar attendance data
 * to link webinar participants with advertising leads for cross-analytics
 * 
 * @module routes/bizonWebhooks
 */

import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { fetchWebinarViewers, BizonViewer } from '../adapters/bizon.js';
import { normalizePhoneNumber } from '../lib/phoneNormalization.js';
import { logErrorToAdmin } from '../lib/errorLogger.js';

/**
 * Bizon webhook payload structure
 */
interface BizonWebhookPayload {
  event?: string;
  webinarId?: string;
  webinar_id?: string;
  title?: string;
  webinarTitle?: string;
  date?: string;
  webinarDate?: string;
  webinarTime?: string;
  [key: string]: any;
}

export default async function bizonWebhooks(app: FastifyInstance) {
  
  /**
   * Bizon365 webhook endpoint
   * Receives notifications when webinar reports are ready
   * 
   * URL format: /api/webhooks/bizon?user_id={uuid}
   * 
   * The user_id query parameter identifies which user account owns the webinar
   * This should be configured in Bizon365 webhook settings
   */
  app.post('/webhooks/bizon', async (request, reply) => {
    try {
      const payload = request.body as BizonWebhookPayload;
      const userAccountId = (request.query as any)['user_id'] as string | undefined;

      app.log.info({
        event: payload.event,
        webinarId: payload.webinarId || payload.webinar_id,
        userAccountId,
        hasPayload: !!payload
      }, 'Bizon webhook received');

      // Validate user_id parameter
      if (!userAccountId) {
        app.log.error('Missing user_id query parameter in Bizon webhook');
        return reply.status(400).send({ 
          success: false, 
          error: 'Missing user_id query parameter' 
        });
      }

      // Extract webinar information
      const webinarId = payload.webinarId || payload.webinar_id;
      const webinarTitle = payload.title || payload.webinarTitle || 'Unknown Webinar';
      const webinarDate = payload.date || payload.webinarDate || payload.webinarTime;

      if (!webinarId) {
        app.log.error({ payload }, 'Missing webinarId in Bizon webhook payload');
        return reply.status(400).send({ 
          success: false, 
          error: 'Missing webinarId in payload' 
        });
      }

      // Acknowledge webhook immediately (respond before processing)
      reply.send({ success: true, message: 'Webhook received, processing in background' });

      // Process webhook asynchronously
      processWebinarAttendance({
        webinarId,
        webinarTitle,
        webinarDate,
        userAccountId
      }, app).catch(error => {
        app.log.error({
          error: error.message,
          stack: error.stack,
          webinarId,
          userAccountId
        }, 'Error processing webinar attendance');

        logErrorToAdmin({
          user_account_id: userAccountId,
          error_type: 'webhook',
          raw_error: error.message || String(error),
          stack_trace: error.stack,
          action: 'process_webinar_attendance',
          request_data: { webinarId },
          severity: 'warning'
        }).catch(() => {});
      });

    } catch (error: any) {
      app.log.error({
        error: error.message,
        stack: error.stack
      }, 'Error handling Bizon webhook');

      logErrorToAdmin({
        error_type: 'webhook',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'bizon_webhook_handler',
        endpoint: '/webhooks/bizon',
        severity: 'critical'
      }).catch(() => {});

      return reply.status(500).send({
        success: false,
        error: 'Internal server error'
      });
    }
  });
}

/**
 * Process webinar attendance data
 * Fetches viewers from Bizon API and matches them with leads
 */
async function processWebinarAttendance(
  params: {
    webinarId: string;
    webinarTitle: string;
    webinarDate: string | undefined;
    userAccountId: string;
  },
  app: FastifyInstance
): Promise<void> {
  const { webinarId, webinarTitle, webinarDate, userAccountId } = params;

  app.log.info({
    webinarId,
    webinarTitle,
    userAccountId
  }, 'Processing webinar attendance');

  try {
    // 1. Get user's Bizon API token
    const { data: userAccount, error: userError } = await supabase
      .from('user_accounts')
      .select('bizon_api_token')
      .eq('id', userAccountId)
      .single();

    if (userError || !userAccount) {
      app.log.error({ 
        userAccountId, 
        error: userError 
      }, 'User account not found');
      return;
    }

    if (!userAccount.bizon_api_token) {
      app.log.warn({ 
        userAccountId 
      }, 'User has no Bizon API token configured');
      return;
    }

    // 2. Fetch viewers from Bizon API
    app.log.info({ webinarId }, 'Fetching viewers from Bizon API');
    
    const viewers = await fetchWebinarViewers(
      webinarId,
      userAccount.bizon_api_token
    );

    app.log.info({ 
      webinarId, 
      viewersCount: viewers.length 
    }, 'Fetched viewers from Bizon');

    // 3. Process each viewer
    let matchedCount = 0;
    let unmatchedCount = 0;
    let errorCount = 0;

    for (const viewer of viewers) {
      try {
        const result = await processViewer({
          viewer,
          webinarId,
          webinarTitle,
          webinarDate,
          userAccountId
        }, app);

        if (result.matched) {
          matchedCount++;
        } else {
          unmatchedCount++;
        }
      } catch (error: any) {
        errorCount++;
        app.log.error({
          error: error.message,
          viewer: viewer.phone,
          webinarId
        }, 'Error processing viewer');

        logErrorToAdmin({
          user_account_id: userAccountId,
          error_type: 'webhook',
          raw_error: error.message || String(error),
          stack_trace: error.stack,
          action: 'process_webinar_viewer',
          request_data: { webinarId, viewerPhone: viewer.phone },
          severity: 'info'
        }).catch(() => {});
      }
    }

    app.log.info({
      webinarId,
      totalViewers: viewers.length,
      matched: matchedCount,
      unmatched: unmatchedCount,
      errors: errorCount
    }, 'Completed processing webinar attendance');

  } catch (error: any) {
    app.log.error({
      error: error.message,
      stack: error.stack,
      webinarId
    }, 'Error in processWebinarAttendance');

    logErrorToAdmin({
      user_account_id: userAccountId,
      error_type: 'webhook',
      raw_error: error.message || String(error),
      stack_trace: error.stack,
      action: 'process_webinar_attendance_main',
      request_data: { webinarId },
      severity: 'warning'
    }).catch(() => {});

    throw error;
  }
}

/**
 * Process single webinar viewer
 * Matches viewer with existing lead by phone number and creates attendance record
 */
async function processViewer(
  params: {
    viewer: BizonViewer;
    webinarId: string;
    webinarTitle: string;
    webinarDate: string | undefined;
    userAccountId: string;
  },
  app: FastifyInstance
): Promise<{ matched: boolean }> {
  const { viewer, webinarId, webinarTitle, webinarDate, userAccountId } = params;

  // Normalize phone number for matching
  const normalizedPhone = normalizePhoneNumber(viewer.phone);

  if (!normalizedPhone) {
    app.log.debug({
      viewer: viewer.username || viewer.email,
      webinarId
    }, 'Viewer has no phone number, skipping');
    return { matched: false };
  }

  // Find matching lead by phone number
  // We search for leads where chat_id contains the normalized phone
  const { data: leads, error: leadError } = await supabase
    .from('leads')
    .select('id, user_account_id, direction_id, creative_id, chat_id')
    .eq('user_account_id', userAccountId)
    .or(`chat_id.ilike.%${normalizedPhone}%,chat_id.eq.${normalizedPhone}`)
    .limit(1);

  if (leadError) {
    app.log.error({
      error: leadError,
      phone: normalizedPhone
    }, 'Error searching for lead');
    throw leadError;
  }

  const lead = leads && leads.length > 0 ? leads[0] : null;

  if (!lead) {
    app.log.debug({
      phone: normalizedPhone,
      username: viewer.username,
      webinarId
    }, 'No matching lead found for viewer');
  }

  // Extract attendance data
  const watchDuration = viewer.view || viewer.viewDuration || 0;
  const attended = watchDuration > 0;

  // Parse dates
  let joinedAt: Date | undefined;
  let leftAt: Date | undefined;
  let parsedWebinarDate: Date | undefined;

  if (viewer.joinTime) {
    try {
      joinedAt = new Date(viewer.joinTime);
    } catch (e) {
      app.log.warn({ joinTime: viewer.joinTime }, 'Invalid joinTime format');
    }
  }

  if (viewer.leaveTime) {
    try {
      leftAt = new Date(viewer.leaveTime);
    } catch (e) {
      app.log.warn({ leaveTime: viewer.leaveTime }, 'Invalid leaveTime format');
    }
  }

  if (webinarDate) {
    try {
      parsedWebinarDate = new Date(webinarDate);
    } catch (e) {
      app.log.warn({ webinarDate }, 'Invalid webinarDate format');
    }
  } else if (viewer.webinarTime) {
    try {
      parsedWebinarDate = new Date(viewer.webinarTime);
    } catch (e) {
      app.log.warn({ webinarTime: viewer.webinarTime }, 'Invalid webinarTime format');
    }
  }

  // Create webinar attendance record
  const { error: insertError } = await supabase
    .from('webinar_attendees')
    .insert({
      webinar_id: webinarId,
      webinar_title: webinarTitle,
      webinar_date: parsedWebinarDate?.toISOString(),
      
      lead_id: lead?.id || null,
      user_account_id: userAccountId,
      
      phone_number: normalizedPhone,
      username: viewer.username || null,
      email: viewer.email || null,
      
      joined_at: joinedAt?.toISOString(),
      left_at: leftAt?.toISOString(),
      watch_duration_sec: watchDuration,
      attended,
      
      utm_source: viewer.utm_source || null,
      utm_medium: viewer.utm_medium || null,
      utm_campaign: viewer.utm_campaign || null,
      utm_term: viewer.utm_term || null,
      utm_content: viewer.utm_content || null,
      url_marker: viewer.url_marker || null
    });

  if (insertError) {
    app.log.error({
      error: insertError,
      phone: normalizedPhone,
      webinarId
    }, 'Error inserting webinar attendance record');
    throw insertError;
  }

  app.log.info({
    phone: normalizedPhone,
    leadId: lead?.id,
    attended,
    watchDuration,
    webinarId
  }, lead ? 'Created webinar attendance record with lead match' : 'Created webinar attendance record without lead match');

  return { matched: !!lead };
}

