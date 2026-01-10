/**
 * AI Assistant API service
 * Handles communication with agent-brain chat endpoint
 */

import { BRAIN_API_BASE_URL } from '@/config/api';
import { shouldFilterByAccountId } from '@/utils/multiAccountHelper';

// Types
export type ChatMode = 'auto' | 'plan' | 'ask';

export interface Conversation {
  id: string;
  title: string;
  mode: ChatMode;
  updated_at: string;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  plan_json?: Plan | null;
  actions_json?: ExecutedAction[] | null;
  tool_calls_json?: ToolCall[] | null;
  ui_json?: UIComponentData[] | null;
  created_at: string;
}

// Re-export UI types for convenience
import type { UIComponentData } from '@/types/assistantUI';
export type { UIComponentData };

export interface Plan {
  description: string;
  steps: PlanStep[];
  requires_approval: boolean;
  estimated_impact?: string;
}

export interface PlanStep {
  action: string;
  params: Record<string, unknown>;
  description: string;
}

export interface ExecutedAction {
  tool: string;
  args: Record<string, unknown>;
  result: 'success' | 'failed';
  message?: string;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ChatResponse {
  conversationId: string;
  response: string;
  plan?: Plan;
  data?: Record<string, unknown>;
  needsClarification?: boolean;
  clarificationQuestion?: string;
  executedActions?: ExecutedAction[];
  mode: ChatMode;
}

export interface SendMessageParams {
  message: string;
  conversationId?: string;
  mode?: ChatMode;
  userAccountId: string;
  adAccountId?: string;
  debugLayers?: boolean;
}

export interface ExecutePlanParams {
  conversationId: string;
  userAccountId: string;
  adAccountId?: string;
  actionIndex?: number;
  executeAll?: boolean;
}

// ============================================================
// STREAMING TYPES
// ============================================================

export type StreamEventType =
  | 'init'
  | 'thinking'
  | 'classification'
  | 'text'
  | 'tool_start'
  | 'tool_result'
  | 'approval_required'
  | 'clarifying'
  | 'done'
  | 'error'
  | 'layer';

export interface StreamEventInit {
  type: 'init';
  conversationId: string;
  mode: ChatMode;
}

export interface StreamEventThinking {
  type: 'thinking';
  message: string;
}

export interface StreamEventClassification {
  type: 'classification';
  domain: string;
  agents: string[];
}

export interface StreamEventText {
  type: 'text';
  content: string;
  accumulated: string;
}

export interface StreamEventToolStart {
  type: 'tool_start';
  name: string;
  args: Record<string, unknown>;
}

export interface StreamEventToolResult {
  type: 'tool_result';
  name: string;
  success: boolean;
  duration?: number;
  error?: string;
}

export interface StreamEventApprovalRequired {
  type: 'approval_required';
  name: string;
  args: Record<string, unknown>;
  toolCallId: string;
  message: string;
}

export interface StreamEventClarifying {
  type: 'clarifying';
  question: string;
  questionType: 'period' | 'entity' | 'amount' | 'metric' | 'confirmation';
  options?: string[];
  required?: boolean;
}

export interface StreamEventDone {
  type: 'done';
  agent: string;
  content: string;
  executedActions: ExecutedAction[];
  toolCalls: ToolCall[];
  domain: string;
  classification: {
    domain: string;
    agents: string[];
  };
  duration: number;
  plan?: Plan | null; // Plan from mini-AgentBrain for user approval
  uiComponents?: UIComponentData[];
}

export interface StreamEventError {
  type: 'error';
  message: string;
}

export type LayerStatus = 'start' | 'end' | 'error' | 'info';

export interface StreamEventLayer {
  type: 'layer';
  layer: number;
  name: string;
  status: LayerStatus;
  data?: Record<string, unknown>;
  timestamp: number;
  duration_ms?: number;
  error?: string;
  message?: string;
}

export type StreamEvent =
  | StreamEventInit
  | StreamEventThinking
  | StreamEventClassification
  | StreamEventText
  | StreamEventToolStart
  | StreamEventToolResult
  | StreamEventApprovalRequired
  | StreamEventClarifying
  | StreamEventDone
  | StreamEventError
  | StreamEventLayer;

// Tool labels for display
export const TOOL_LABELS: Record<string, string> = {
  // Meta Tools (оркестрация)
  getAvailableDomains: 'Определяю доступные модули',
  getDomainTools: 'Загружаю инструменты',
  executeTools: 'Выполняю запросы',
  executeTool: 'Выполняю запрос',

  // Ads - кампании и адсеты
  getCampaigns: 'Получаю кампании',
  getCampaignDetails: 'Загружаю детали кампании',
  getAdSets: 'Получаю адсеты',
  getSpendReport: 'Формирую отчёт по расходам',
  getAdAccountStatus: 'Проверяю статус аккаунта',
  pauseCampaign: 'Останавливаю кампанию',
  resumeCampaign: 'Запускаю кампанию',
  pauseAdSet: 'Останавливаю адсет',
  resumeAdSet: 'Запускаю адсет',
  pauseAd: 'Останавливаю объявление',
  resumeAd: 'Запускаю объявление',
  updateBudget: 'Обновляю бюджет',

  // Ads - направления
  getDirections: 'Получаю направления',
  getDirectionDetails: 'Загружаю детали направления',
  getDirectionMetrics: 'Получаю метрики направления',
  getDirectionCreatives: 'Получаю креативы направления',
  getDirectionInsights: 'Анализирую направление',
  getLeadsEngagementRate: 'Считаю вовлечённость лидов',
  updateDirectionBudget: 'Обновляю бюджет направления',
  updateDirectionTargetCPL: 'Обновляю целевой CPL',
  pauseDirection: 'Останавливаю направление',
  resumeDirection: 'Запускаю направление',

  // Ads - ROI
  getROIReport: 'Формирую отчёт по ROI',
  getROIComparison: 'Сравниваю ROI',

  // Креативы
  getCreatives: 'Получаю креативы',
  getCreativeDetails: 'Загружаю детали креатива',
  getCreativeMetrics: 'Получаю метрики креатива',
  getCreativeAnalysis: 'Анализирую креатив',
  getTopCreatives: 'Ищу лучшие креативы',
  getWorstCreatives: 'Ищу худшие креативы',
  compareCreatives: 'Сравниваю креативы',
  launchCreative: 'Запускаю креатив',
  pauseCreative: 'Останавливаю креатив',
  startCreativeTest: 'Запускаю A/B тест',
  stopCreativeTest: 'Останавливаю тест',

  // CRM - лиды
  getLeads: 'Получаю лидов',
  getLeadDetails: 'Загружаю детали лида',
  getFunnelStats: 'Формирую статистику воронки',
  getSalesQuality: 'Анализирую качество продаж',
  getRevenueStats: 'Формирую статистику выручки',
  updateLeadStage: 'Обновляю этап лида',

  // CRM - amoCRM
  getAmoCRMStatus: 'Проверяю подключение amoCRM',
  getAmoCRMPipelines: 'Получаю воронки amoCRM',
  syncAmoCRMLeads: 'Синхронизирую лидов из amoCRM',

  // WhatsApp
  getDialogs: 'Получаю диалоги',
  getDialogMessages: 'Загружаю сообщения',
  analyzeDialog: 'Анализирую диалог',
  searchDialogSummaries: 'Ищу в диалогах',
};

// Layer labels for debug display
export const LAYER_LABELS: Record<number, string> = {
  1: 'HTTP Entry',
  2: 'Orchestrator',
  3: 'Meta Orchestrator',
  4: 'Meta Tools',
  5: 'Domain Router',
  6: 'MCP Bridge',
  7: 'MCP Executor',
  8: 'Domain Handlers',
  9: 'Domain Agents',
  10: 'Response Assembly',
  11: 'Persistence',
};

// API Functions

/**
 * Send a message to the AI assistant
 */
export async function sendMessage(params: SendMessageParams): Promise<ChatResponse> {
  const response = await fetch(`${BRAIN_API_BASE_URL}/api/brain/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to send message');
  }

  return response.json();
}

/**
 * Send a message with SSE streaming
 * Returns an async generator that yields StreamEvent objects
 */
export async function* sendMessageStream(
  params: SendMessageParams,
  signal?: AbortSignal
): AsyncGenerator<StreamEvent, void, unknown> {
  const response = await fetch(`${BRAIN_API_BASE_URL}/api/brain/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
    signal,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to start stream');
  }

  if (!response.body) {
    throw new Error('No response body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE messages
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            yield data as StreamEvent;
          } catch {
            // Skip malformed JSON
            console.warn('Failed to parse SSE data:', line);
          }
        }
      }
    }

    // Process any remaining data
    if (buffer.startsWith('data: ')) {
      try {
        const data = JSON.parse(buffer.slice(6));
        yield data as StreamEvent;
      } catch {
        // Skip malformed JSON
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Helper to get tool label for display
 */
export function getToolLabel(toolName: string): string {
  return TOOL_LABELS[toolName] || toolName;
}

/**
 * Helper to get layer label for display
 */
export function getLayerLabel(layer: number): string {
  return LAYER_LABELS[layer] || `Layer ${layer}`;
}

/**
 * Get list of conversations for user
 */
export async function getConversations(
  userAccountId: string,
  adAccountId?: string,
  limit: number = 20
): Promise<Conversation[]> {
  const params = new URLSearchParams({
    userAccountId,
    limit: String(limit),
  });

  // Передаём adAccountId ТОЛЬКО в multi-account режиме (см. MULTI_ACCOUNT_GUIDE.md)
  if (shouldFilterByAccountId(adAccountId)) {
    params.set('adAccountId', adAccountId!);
  }

  const response = await fetch(
    `${BRAIN_API_BASE_URL}/api/brain/conversations?${params.toString()}`
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to get conversations');
  }

  const data = await response.json();
  return data.conversations;
}

/**
 * Get messages for a conversation
 */
export async function getConversationMessages(
  conversationId: string,
  userAccountId: string
): Promise<ChatMessage[]> {
  const params = new URLSearchParams({ userAccountId });

  const response = await fetch(
    `${BRAIN_API_BASE_URL}/api/brain/conversations/${conversationId}/messages?${params.toString()}`
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to get messages');
  }

  const data = await response.json();
  return data.messages;
}

/**
 * Delete a conversation
 */
export async function deleteConversation(
  conversationId: string,
  userAccountId: string
): Promise<void> {
  const params = new URLSearchParams({ userAccountId });

  const response = await fetch(
    `${BRAIN_API_BASE_URL}/api/brain/conversations/${conversationId}?${params.toString()}`,
    {
      method: 'DELETE',
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete conversation');
  }
}

/**
 * Execute a plan action or entire plan
 */
export async function executePlan(params: ExecutePlanParams): Promise<{
  success: boolean;
  results?: Array<{ step: PlanStep; result: { success: boolean; message?: string } }>;
  message?: string;
}> {
  const response = await fetch(
    `${BRAIN_API_BASE_URL}/api/brain/conversations/${params.conversationId}/execute`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userAccountId: params.userAccountId,
        adAccountId: params.adAccountId,
        actionIndex: params.actionIndex,
        executeAll: params.executeAll,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to execute plan');
  }

  return response.json();
}

// ============================================================
// BRAIN MINI TYPES
// ============================================================

export interface BrainMiniParams {
  userAccountId: string;
  adAccountId?: string;
  directionId?: string;
  campaignId?: string;  // Facebook campaign ID для фильтрации
  dryRun?: boolean;
}

export interface BrainMiniProposal {
  action: 'updateBudget' | 'pauseAdSet' | 'createAdSet' | 'review';
  priority: 'critical' | 'high' | 'medium' | 'low';
  entity_type: string;
  entity_id: string;
  entity_name: string;
  campaign_id?: string;
  campaign_type?: 'internal' | 'external';
  direction_id?: string | null;
  direction_name?: string | null;
  target_cpl_source?: 'direction' | 'account_default' | 'none';
  health_score: number;
  hs_class: 'very_good' | 'good' | 'neutral' | 'slightly_bad' | 'bad';
  reason: string;
  confidence: number;
  suggested_action_params?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
}

export interface BrainMiniAdsetAnalysis {
  adset_id: string;
  adset_name: string;
  campaign_id: string;
  campaign_type: 'internal' | 'external';
  direction_id?: string | null;
  direction_name?: string | null;
  target_cpl_source: 'direction' | 'account_default' | 'none';
  health_score: number;
  hs_class: string;
  hs_breakdown: Array<{ factor: string; value: number | null; reason: string }>;
  metrics: {
    today: {
      spend: number;
      conversions: number;
      cost_per_conversion: number | null;
      ctr: number | null;
      impressions: number;
    };
    yesterday: {
      spend: number;
      conversions: number;
      cost_per_conversion: number | null;
    };
    target_cost_per_conversion: number | null;
    metric_name: 'CPL' | 'CPC';
  };
}

export interface BrainMiniSummary {
  total_adsets_analyzed: number;
  by_hs_class: Record<string, number>;
  today_total_spend: string;
  today_total_leads?: number;
  proposals_by_action?: Record<string, number>;
}

export type BrainMiniEventType = 'progress' | 'done' | 'error';

export interface BrainMiniEventProgress {
  type: 'progress';
  phase: 'resolving' | 'auth' | 'fetching' | 'data_loaded' | 'analysis_done';
  message: string;
}

export interface BrainMiniEventDone {
  type: 'done';
  success: boolean;
  mode: string;
  message: string;
  proposals: BrainMiniProposal[];
  plan: Plan | null;
  summary: BrainMiniSummary | null;
  adset_analysis: BrainMiniAdsetAnalysis[];
  context?: Record<string, unknown>;
}

export interface BrainMiniEventError {
  type: 'error';
  message: string;
}

export type BrainMiniEvent =
  | BrainMiniEventProgress
  | BrainMiniEventDone
  | BrainMiniEventError;

/**
 * Run Brain Mini directly (bypasses Meta Orchestrator)
 * Returns an async generator that yields BrainMiniEvent objects
 */
export async function* runBrainMiniStream(
  params: BrainMiniParams,
  signal?: AbortSignal
): AsyncGenerator<BrainMiniEvent, void, unknown> {
  const response = await fetch(`${BRAIN_API_BASE_URL}/api/brain/mini/run/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
    signal,
  });

  if (!response.ok) {
    let errorMessage = 'Failed to start Brain Mini';
    try {
      const error = await response.json();
      errorMessage = error.error || errorMessage;
    } catch {
      // ignore parse error
    }
    throw new Error(errorMessage);
  }

  if (!response.body) {
    throw new Error('No response body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE messages
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            yield data as BrainMiniEvent;
          } catch {
            // Skip malformed JSON
            console.warn('Failed to parse Brain Mini SSE data:', line);
          }
        }
      }
    }

    // Process any remaining data
    if (buffer.startsWith('data: ')) {
      try {
        const data = JSON.parse(buffer.slice(6));
        yield data as BrainMiniEvent;
      } catch {
        // Skip malformed JSON
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export default {
  sendMessage,
  sendMessageStream,
  getToolLabel,
  getLayerLabel,
  getConversations,
  getConversationMessages,
  deleteConversation,
  executePlan,
  runBrainMiniStream,
};
