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
  created_at: string;
}

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
  getConversations,
  getConversationMessages,
  deleteConversation,
  executePlan,
};
