// Campaign API Service для взаимодействия с backend

const CRM_API_BASE = '/api/crm';
const CHATBOT_API_BASE = '/api/chatbot';

// Helper function for fetch with error handling
async function fetchJson(url: string, options?: RequestInit) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || error.message || 'Request failed');
  }

  return response.json();
}

// ===== Campaign Settings =====

export interface CampaignSettings {
  id: string;
  user_account_id: string;
  autopilot_enabled: boolean;
  daily_message_limit: number;
  hot_interval_days: number;
  warm_interval_days: number;
  cold_interval_days: number;
  work_hours_start: number;
  work_hours_end: number;
  work_days: number[];
  created_at: string;
  updated_at: string;
}

export async function getCampaignSettings(userId: string): Promise<CampaignSettings> {
  const data = await fetchJson(`${CRM_API_BASE}/campaign-settings/${userId}`);
  return data.settings;
}

export async function updateCampaignSettings(
  userId: string,
  updates: Partial<CampaignSettings>
): Promise<CampaignSettings> {
  const data = await fetchJson(`${CRM_API_BASE}/campaign-settings/${userId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return data.settings;
}

export async function getAutopilotStatus(userId: string): Promise<boolean> {
  const data = await fetchJson(`${CRM_API_BASE}/campaign-settings/${userId}/autopilot-status`);
  return data.autopilotEnabled;
}

// ===== Templates =====

export interface Template {
  id: string;
  user_account_id: string;
  title: string;
  content: string;
  template_type: 'selling' | 'useful' | 'reminder';
  is_active: boolean;
  usage_count: number;
  created_at: string;
  updated_at: string;
}

export async function getTemplates(
  userId: string,
  filters?: { templateType?: string; isActive?: boolean }
): Promise<Template[]> {
  const params = new URLSearchParams({ userAccountId: userId });
  if (filters?.templateType) params.append('templateType', filters.templateType);
  if (filters?.isActive !== undefined) params.append('isActive', String(filters.isActive));

  const data = await fetchJson(`${CRM_API_BASE}/templates?${params}`);
  return data.templates;
}

export async function createTemplate(
  template: Omit<Template, 'id' | 'usage_count' | 'created_at' | 'updated_at'>
): Promise<Template> {
  const data = await fetchJson(`${CRM_API_BASE}/templates`, {
    method: 'POST',
    body: JSON.stringify({
      userAccountId: template.user_account_id,
      title: template.title,
      content: template.content,
      templateType: template.template_type,
      isActive: template.is_active,
    }),
  });
  return data.template;
}

export async function updateTemplate(
  templateId: string,
  userId: string,
  updates: Partial<Template>
): Promise<Template> {
  const data = await fetchJson(`${CRM_API_BASE}/templates/${templateId}`, {
    method: 'PUT',
    body: JSON.stringify({
      userAccountId: userId,
      title: updates.title,
      content: updates.content,
      templateType: updates.template_type,
      isActive: updates.is_active,
    }),
  });
  return data.template;
}

export async function deleteTemplate(templateId: string, userId: string): Promise<void> {
  await fetchJson(`${CRM_API_BASE}/templates/${templateId}?userAccountId=${userId}`, {
    method: 'DELETE',
  });
}

// ===== Campaign Queue & Messages =====

export interface CampaignMessage {
  id: string;
  user_account_id: string;
  lead_id: string;
  message_text: string;
  message_type: 'selling' | 'useful' | 'reminder';
  status: 'pending' | 'sent' | 'failed' | 'copied';
  scheduled_at: string;
  sent_at: string | null;
  error_message: string | null;
  created_at: string;
  lead?: {
    id: string;
    contact_name: string | null;
    contact_phone: string;
    interest_level: 'hot' | 'warm' | 'cold';
    score: number | null;
    reactivation_score: number | null;
    funnel_stage: string;
    business_type: string | null;
    is_medical: boolean | null;
  };
}

export async function generateCampaignQueue(
  userId: string, 
  signal?: AbortSignal
): Promise<{
  queueSize: number;
  messagesGenerated: number;
  topLeads: any[];
}> {
  const data = await fetchJson(`${CHATBOT_API_BASE}/campaign/generate-queue`, {
    method: 'POST',
    body: JSON.stringify({ userAccountId: userId }),
    signal, // Pass AbortSignal for cancellation support
  });
  return data;
}

export async function clearCampaignQueue(userId: string): Promise<{ deletedCount: number }> {
  const data = await fetchJson(
    `${CHATBOT_API_BASE}/campaign/clear-queue`,
    {
      method: 'POST',
      body: JSON.stringify({ userAccountId: userId }),
    }
  );
  return data;
}

// ===== Manual Send =====

export interface QueueStatus {
  hasQueue: boolean;
  count?: number;
  createdAt?: string;
  hasSentMessages?: boolean;
  recommendedAction?: 'replace' | 'merge' | 'ask';
}

export interface ManualSendResponse {
  success: boolean;
  mode: 'immediate' | 'scheduled';
  scheduledFor?: string;
  nextWorkingTime?: string;
  estimatedDuration?: string;
  messagesPerHour?: number;
  queueSize: number;
}

export interface GenerateQueueResponse {
  success: boolean;
  queueSize?: number;
  messagesGenerated?: number;
  needsDecision?: boolean;
  existingQueue?: {
    count: number;
    createdAt: string;
    hasSentMessages: boolean;
  };
  recommendedAction?: 'replace' | 'merge';
  message?: string;
  merged?: boolean;
}

export async function getQueueStatus(userId: string): Promise<QueueStatus> {
  const data = await fetchJson(
    `${CHATBOT_API_BASE}/campaign/queue-status?userAccountId=${userId}`
  );
  return data;
}

export async function startManualSend(userId: string): Promise<ManualSendResponse> {
  const data = await fetchJson(
    `${CHATBOT_API_BASE}/campaign/start-manual-send`,
    {
      method: 'POST',
      body: JSON.stringify({ userAccountId: userId }),
    }
  );
  return data;
}

export async function generateQueueWithAction(
  userId: string,
  action?: 'replace' | 'merge'
): Promise<GenerateQueueResponse> {
  const data = await fetchJson(
    `${CHATBOT_API_BASE}/campaign/generate-queue`,
    {
      method: 'POST',
      body: JSON.stringify({ userAccountId: userId, action }),
    }
  );
  return data;
}

export async function getTodayQueue(
  userId: string,
  limit: number = 20,
  offset: number = 0,
  status?: 'pending' | 'sent' | 'failed' | 'copied'
): Promise<{ messages: CampaignMessage[]; total: number }> {
  const params = new URLSearchParams({
    userAccountId: userId,
    limit: String(limit),
    offset: String(offset),
  });
  if (status) params.append('status', status);

  const data = await fetchJson(`${CHATBOT_API_BASE}/campaign/today-queue?${params}`);
  return data;
}

export async function sendMessageAuto(messageId: string): Promise<void> {
  await fetchJson(`${CHATBOT_API_BASE}/campaign/send-auto`, {
    method: 'POST',
    body: JSON.stringify({ messageId }),
  });
}

export async function markMessageAsCopied(messageId: string): Promise<void> {
  await fetchJson(`${CHATBOT_API_BASE}/campaign/mark-copied`, {
    method: 'POST',
    body: JSON.stringify({ messageId }),
  });
}

export async function previewCampaignQueue(userId: string, limit: number = 50): Promise<any[]> {
  const data = await fetchJson(
    `${CHATBOT_API_BASE}/campaign/preview-queue?userAccountId=${userId}&limit=${limit}`
  );
  return data.leads;
}

// ===== Lead Audio & Notes =====

export async function uploadLeadAudio(leadId: string, audioFile: File): Promise<{
  transcript: string;
  transcriptLength: number;
}> {
  const formData = new FormData();
  formData.append('file', audioFile);

  const response = await fetch(`${CRM_API_BASE}/dialogs/leads/${leadId}/audio`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || 'Audio upload failed');
  }

  return response.json();
}

export async function updateLeadNotes(leadId: string, userId: string, notes: string): Promise<void> {
  await fetchJson(`${CRM_API_BASE}/dialogs/leads/${leadId}/notes`, {
    method: 'PATCH',
    body: JSON.stringify({ notes, userAccountId: userId }),
  });
}

export async function toggleLeadAutopilot(leadId: string, userId: string, enabled: boolean): Promise<void> {
  await fetchJson(`${CRM_API_BASE}/dialogs/leads/${leadId}/autopilot`, {
    method: 'PATCH',
    body: JSON.stringify({ autopilotEnabled: enabled, userAccountId: userId }),
  });
}

// ===== Campaign Stats =====

export interface CampaignStats {
  allTime: {
    total: number;
    pending: number;
    sent: number;
    failed: number;
    copied: number;
  };
  today: {
    total: number;
    sent: number;
  };
}

export async function getCampaignStats(userId: string): Promise<CampaignStats> {
  const data = await fetchJson(
    `${CHATBOT_API_BASE}/campaign/stats?userAccountId=${userId}`
  );
  return data;
}

// ===== Analytics Interfaces =====

export interface AnalyticsOverview {
  totalSent: number;
  replyRate: number;
  conversionRate: number;
  avgTimeToReply: number;
  avgTimeToAction: number;
}

export interface StrategyAnalytics {
  strategy_type: string;
  sent: number;
  replies: number;
  replyRate: string;
  conversions: number;
  conversionRate: string;
}

export interface TemperatureAnalytics {
  interest_level: string;
  sent: number;
  replies: number;
  replyRate: string;
  conversions: number;
  conversionRate: string;
}

export interface TemperatureDynamics {
  snapshot_date: string;
  hot_count: number;
  warm_count: number;
  cold_count: number;
  total_leads: number;
}

export interface StageAnalytics {
  funnel_stage: string;
  sent: number;
  replies: number;
  conversions: number;
}

// ===== Analytics API Functions =====

export async function getAnalyticsOverview(userId: string): Promise<AnalyticsOverview> {
  const data = await fetchJson(
    `${CHATBOT_API_BASE}/campaign/analytics/overview?userAccountId=${userId}`
  );
  return data;
}

export async function getAnalyticsByStrategy(userId: string): Promise<StrategyAnalytics[]> {
  const data = await fetchJson(
    `${CHATBOT_API_BASE}/campaign/analytics/by-strategy?userAccountId=${userId}`
  );
  return data;
}

export async function getAnalyticsByTemperature(userId: string): Promise<TemperatureAnalytics[]> {
  const data = await fetchJson(
    `${CHATBOT_API_BASE}/campaign/analytics/by-temperature?userAccountId=${userId}`
  );
  return data;
}

export async function getTemperatureDynamics(
  userId: string, 
  days: number = 30
): Promise<TemperatureDynamics[]> {
  const data = await fetchJson(
    `${CHATBOT_API_BASE}/campaign/analytics/temperature-dynamics?userAccountId=${userId}&days=${days}`
  );
  return data;
}

export async function getAnalyticsByStage(userId: string): Promise<StageAnalytics[]> {
  const data = await fetchJson(
    `${CHATBOT_API_BASE}/campaign/analytics/by-stage?userAccountId=${userId}`
  );
  return data;
}

export const campaignApi = {
  // Settings
  getCampaignSettings,
  updateCampaignSettings,
  getAutopilotStatus,
  
  // Templates
  getTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  
  // Queue & Messages
  generateCampaignQueue,
  generateQueueWithAction,
  clearCampaignQueue,
  getTodayQueue,
  sendMessageAuto,
  markMessageAsCopied,
  previewCampaignQueue,
  
  // Manual Send
  getQueueStatus,
  startManualSend,
  
  // Lead extras
  uploadLeadAudio,
  updateLeadNotes,
  toggleLeadAutopilot,
  
  // Stats
  getCampaignStats,
  
  // Analytics
  getAnalyticsOverview,
  getAnalyticsByStrategy,
  getAnalyticsByTemperature,
  getTemperatureDynamics,
  getAnalyticsByStage,
};

