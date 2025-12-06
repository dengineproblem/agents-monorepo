import { supabase } from './supabase.js';
import { createLogger } from './logger.js';

const logger = createLogger({ module: 'eventLogger' });

// Типы событий
export type EventCategory = 'page_view' | 'click' | 'form' | 'api_call' | 'error' | 'business';

export interface UserEvent {
  userAccountId: string;
  accountId?: string;
  sessionId: string;
  eventCategory: EventCategory;
  eventAction: string;
  eventLabel?: string;
  eventValue?: number;
  pagePath?: string;
  component?: string;
  apiEndpoint?: string;
  apiMethod?: string;
  apiStatusCode?: number;
  apiDurationMs?: number;
  errorMessage?: string;
  errorStack?: string;
  metadata?: Record<string, unknown>;
  userAgent?: string;
  deviceType?: string;
  clientTimestamp: string;
}

/**
 * Централизованный логгер событий пользователей
 * Записывает события в таблицу user_events в Supabase
 */
export const eventLogger = {
  /**
   * Записать batch событий от frontend
   */
  async logBatch(events: UserEvent[]): Promise<void> {
    if (events.length === 0) return;

    const rows = events.map(e => ({
      user_account_id: e.userAccountId,
      account_id: e.accountId || null,
      session_id: e.sessionId,
      event_category: e.eventCategory,
      event_action: e.eventAction,
      event_label: e.eventLabel || null,
      event_value: e.eventValue || null,
      page_path: e.pagePath || null,
      component: e.component || null,
      api_endpoint: e.apiEndpoint || null,
      api_method: e.apiMethod || null,
      api_status_code: e.apiStatusCode || null,
      api_duration_ms: e.apiDurationMs || null,
      error_message: e.errorMessage || null,
      error_stack: e.errorStack || null,
      metadata: e.metadata || {},
      user_agent: e.userAgent || null,
      device_type: e.deviceType || null,
      client_timestamp: e.clientTimestamp
    }));

    try {
      const { error } = await supabase.from('user_events').insert(rows);

      if (error) {
        logger.error({
          error: error.message,
          code: error.code,
          count: events.length
        }, 'Failed to insert user events');
      } else {
        logger.debug({ count: events.length }, 'User events inserted');
      }
    } catch (err) {
      logger.error({
        error: String(err),
        count: events.length
      }, 'Exception while inserting user events');
    }
  },

  /**
   * Записать одно бизнес-событие (вызывается из backend)
   * Примеры: campaign_created, creative_launched, lead_received
   */
  async logBusinessEvent(
    userAccountId: string,
    eventAction: string,
    metadata: Record<string, unknown> = {},
    accountId?: string
  ): Promise<void> {
    await this.logBatch([{
      userAccountId,
      accountId,
      sessionId: 'backend',
      eventCategory: 'business',
      eventAction,
      metadata,
      clientTimestamp: new Date().toISOString()
    }]);

    // Также логируем в Pino для Loki (для real-time мониторинга)
    logger.info({
      userAccountId,
      accountId,
      eventAction,
      ...metadata
    }, `business_event:${eventAction}`);
  },

  /**
   * Записать API ошибку (вызывается из backend)
   */
  async logApiError(
    userAccountId: string,
    endpoint: string,
    method: string,
    statusCode: number,
    errorMessage: string,
    accountId?: string
  ): Promise<void> {
    await this.logBatch([{
      userAccountId,
      accountId,
      sessionId: 'backend',
      eventCategory: 'api_call',
      eventAction: 'error',
      apiEndpoint: endpoint,
      apiMethod: method,
      apiStatusCode: statusCode,
      errorMessage,
      clientTimestamp: new Date().toISOString()
    }]);
  }
};
