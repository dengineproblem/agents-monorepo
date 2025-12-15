/**
 * AI Assistant API service
 * Handles communication with agent-brain chat endpoint
 */

import { BRAIN_API_BASE_URL } from '@/config/api';

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
  | 'done'
  | 'error';

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
  result: unknown;
}

export interface StreamEventApprovalRequired {
  type: 'approval_required';
  name: string;
  args: Record<string, unknown>;
  toolCallId: string;
  message: string;
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
  uiComponents?: UIComponentData[];
}

export interface StreamEventError {
  type: 'error';
  message: string;
}

export type StreamEvent =
  | StreamEventInit
  | StreamEventThinking
  | StreamEventClassification
  | StreamEventText
  | StreamEventToolStart
  | StreamEventToolResult
  | StreamEventApprovalRequired
  | StreamEventDone
  | StreamEventError;

// Tool labels for display
export const TOOL_LABELS: Record<string, string> = {
  getCampaigns: 'Получаю кампании',
  getCampaignDetails: 'Загружаю детали кампании',
  getAdSets: 'Получаю адсеты',
  getSpendReport: 'Формирую отчёт по расходам',
  getDirections: 'Получаю направления',
  getDirectionDetails: 'Загружаю детали направления',
  getDirectionMetrics: 'Получаю метрики направления',
  getROIReport: 'Формирую отчёт по ROI',
  getROIComparison: 'Сравниваю ROI',
  pauseCampaign: 'Останавливаю кампанию',
  resumeCampaign: 'Запускаю кампанию',
  pauseAdSet: 'Останавливаю адсет',
  resumeAdSet: 'Запускаю адсет',
  updateBudget: 'Обновляю бюджет',
  updateDirectionBudget: 'Обновляю бюджет направления',
  pauseDirection: 'Останавливаю направление',
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
  getLeads: 'Получаю лидов',
  getLeadDetails: 'Загружаю детали лида',
  getFunnelStats: 'Формирую статистику воронки',
  getRevenueStats: 'Формирую статистику выручки',
  updateLeadStage: 'Обновляю этап лида',
  getDialogs: 'Получаю диалоги',
  getDialogMessages: 'Загружаю сообщения',
  searchDialogSummaries: 'Ищу в диалогах',
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

  if (adAccountId) {
    params.set('adAccountId', adAccountId);
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

export default {
  sendMessage,
  sendMessageStream,
  getToolLabel,
  getConversations,
  getConversationMessages,
  deleteConversation,
  executePlan,
};
