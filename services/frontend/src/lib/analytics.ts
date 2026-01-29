/**
 * Analytics Service
 *
 * Централизованный сервис для отслеживания действий пользователей
 * Собирает события в batch и отправляет на backend каждые 5 секунд
 *
 * @module lib/analytics
 */

import { API_BASE_URL } from '@/config/api';

// =====================================================
// Types
// =====================================================

type EventCategory = 'page_view' | 'click' | 'form' | 'api_call' | 'error';

interface AnalyticsEvent {
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
  clientTimestamp: string;
}

interface ClientInfo {
  userAgent: string;
  screenWidth: number;
  screenHeight: number;
  language: string;
}

// =====================================================
// Analytics Service
// =====================================================

class AnalyticsService {
  private queue: AnalyticsEvent[] = [];
  private sessionId: string;
  private flushInterval = 5000; // 5 секунд
  private maxQueueSize = 20;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private isEnabled = true;

  constructor() {
    this.sessionId = this.getOrCreateSessionId();
    this.startFlushTimer();
    this.setupBeforeUnload();
    this.setupErrorTracking();
  }

  // =====================================================
  // Session Management
  // =====================================================

  private getOrCreateSessionId(): string {
    let id = sessionStorage.getItem('analytics_session');
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem('analytics_session', id);
    }
    return id;
  }

  private getUserId(): string | null {
    try {
      const user = localStorage.getItem('user');
      return user ? JSON.parse(user).id : null;
    } catch {
      return null;
    }
  }

  private getAccountId(): string | null {
    return localStorage.getItem('currentAdAccountId');
  }

  private getClientInfo(): ClientInfo {
    return {
      userAgent: navigator.userAgent,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      language: navigator.language
    };
  }

  // =====================================================
  // Public API - Tracking Methods
  // =====================================================

  /**
   * Track page view
   */
  trackPageView(path: string, title?: string): void {
    this.addEvent({
      eventCategory: 'page_view',
      eventAction: 'view',
      eventLabel: title,
      pagePath: path,
      clientTimestamp: new Date().toISOString()
    });
  }

  /**
   * Track button/element click
   */
  trackClick(component: string, label: string, metadata?: Record<string, unknown>): void {
    this.addEvent({
      eventCategory: 'click',
      eventAction: 'click',
      eventLabel: label,
      component,
      pagePath: window.location.pathname,
      metadata,
      clientTimestamp: new Date().toISOString()
    });
  }

  /**
   * Track form start (user started filling form)
   */
  trackFormStart(formName: string): void {
    this.addEvent({
      eventCategory: 'form',
      eventAction: 'start',
      eventLabel: formName,
      pagePath: window.location.pathname,
      clientTimestamp: new Date().toISOString()
    });
  }

  /**
   * Track form submit (success or error)
   */
  trackFormSubmit(formName: string, success: boolean, metadata?: Record<string, unknown>): void {
    this.addEvent({
      eventCategory: 'form',
      eventAction: success ? 'submit_success' : 'submit_error',
      eventLabel: formName,
      pagePath: window.location.pathname,
      metadata,
      clientTimestamp: new Date().toISOString()
    });
  }

  /**
   * Track API call (called from fetch wrapper)
   */
  trackApiCall(endpoint: string, method: string, status: number, durationMs: number): void {
    // Skip tracking analytics endpoint to avoid infinite loop
    if (endpoint.includes('/analytics/')) return;

    this.addEvent({
      eventCategory: 'api_call',
      eventAction: status >= 400 ? 'error' : 'success',
      apiEndpoint: endpoint,
      apiMethod: method,
      apiStatusCode: status,
      apiDurationMs: durationMs,
      pagePath: window.location.pathname,
      clientTimestamp: new Date().toISOString()
    });
  }

  /**
   * Track JavaScript error
   */
  trackError(error: Error, context?: Record<string, unknown>): void {
    this.addEvent({
      eventCategory: 'error',
      eventAction: 'error',
      errorMessage: error.message,
      errorStack: error.stack?.slice(0, 1000),
      pagePath: window.location.pathname,
      metadata: context,
      clientTimestamp: new Date().toISOString()
    });
  }

  /**
   * Track custom event
   */
  trackEvent(category: EventCategory, action: string, label?: string, metadata?: Record<string, unknown>): void {
    this.addEvent({
      eventCategory: category,
      eventAction: action,
      eventLabel: label,
      pagePath: window.location.pathname,
      metadata,
      clientTimestamp: new Date().toISOString()
    });
  }

  // =====================================================
  // Control Methods
  // =====================================================

  /**
   * Enable/disable analytics
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    if (!enabled) {
      this.queue = [];
    }
  }

  /**
   * Force flush all pending events
   */
  async forceFlush(): Promise<void> {
    await this.flush();
  }

  // =====================================================
  // Private Methods
  // =====================================================

  private addEvent(event: AnalyticsEvent): void {
    if (!this.isEnabled) return;

    this.queue.push(event);

    // Flush if queue is full
    if (this.queue.length >= this.maxQueueSize) {
      this.flush();
    }
  }

  private async flush(): Promise<void> {
    const userId = this.getUserId();

    // Don't send if no user or no events
    if (!userId || this.queue.length === 0) return;

    const events = [...this.queue];
    this.queue = [];

    try {
      const response = await fetch(`${API_BASE_URL}/analytics/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userAccountId: userId,
          accountId: this.getAccountId(),
          sessionId: this.sessionId,
          events,
          clientInfo: this.getClientInfo()
        })
      });

      if (!response.ok) {
        // Put events back in queue on error
        this.queue = [...events, ...this.queue];

      }
    } catch (error) {
      // Put events back in queue on network error
      this.queue = [...events, ...this.queue];

    }
  }

  private startFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    this.flushTimer = setInterval(() => this.flush(), this.flushInterval);
  }

  private setupBeforeUnload(): void {
    window.addEventListener('beforeunload', () => {
      if (this.queue.length > 0) {
        const userId = this.getUserId();
        if (userId) {
          // Use sendBeacon for reliable delivery on page unload
          navigator.sendBeacon(
            `${API_BASE_URL}/analytics/events`,
            JSON.stringify({
              userAccountId: userId,
              accountId: this.getAccountId(),
              sessionId: this.sessionId,
              events: this.queue,
              clientInfo: this.getClientInfo()
            })
          );
        }
      }
    });

    // Also flush on visibility change (when tab becomes hidden)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.flush();
      }
    });
  }

  private setupErrorTracking(): void {
    // Track unhandled JavaScript errors
    window.addEventListener('error', (event) => {
      this.trackError(new Error(event.message), {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno
      });
    });

    // Track unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      const error = event.reason instanceof Error
        ? event.reason
        : new Error(String(event.reason));
      this.trackError(error, { type: 'unhandledrejection' });
    });
  }
}

// =====================================================
// Singleton Export
// =====================================================

export const analytics = new AnalyticsService();

// For debugging in console
if (import.meta.env.DEV) {
  (window as unknown as { analytics: AnalyticsService }).analytics = analytics;
}
