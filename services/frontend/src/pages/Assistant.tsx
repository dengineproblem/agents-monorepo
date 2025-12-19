import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { Bug } from 'lucide-react';
import Header from '../components/Header';
import { useAppContext } from '../context/AppContext';
import { isUserAdmin } from '../components/AdminRoute';
import { Button } from '@/components/ui/button';
import {
  ChatMessages,
  ChatInput,
  PlanApprovalModal,
} from '../components/assistant';
import {
  sendMessageStream,
  getConversations,
  getConversationMessages,
  deleteConversation,
  executePlan,
  type Conversation,
  type ChatMessage,
  type ChatMode,
  type Plan,
  type StreamEvent,
} from '../services/assistantApi';
import {
  StreamingMessage,
  createInitialStreamingState,
  updateStreamingState,
  type StreamingState,
} from '../components/assistant/StreamingMessage';
import type { LayerLog } from '../components/assistant/DebugLogsModal';

const Assistant: React.FC = () => {
  const { currentAdAccountId } = useAppContext();

  // User account ID from localStorage
  const [userAccountId, setUserAccountId] = useState<string | null>(null);

  // Conversations
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);

  // Current conversation
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);

  // Chat state
  const [mode, setMode] = useState<ChatMode>('auto');
  const [isSending, setIsSending] = useState(false);

  // Plan approval
  const [pendingPlan, setPendingPlan] = useState<Plan | null>(null);
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [isExecutingPlan, setIsExecutingPlan] = useState(false);

  // Streaming state
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingState, setStreamingState] = useState<StreamingState | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Debug logs
  const isAdmin = isUserAdmin();
  const [showDebugLogs, setShowDebugLogs] = useState(() => {
    return localStorage.getItem('assistant_debug_logs') === 'true';
  });
  const [debugLogsMap, setDebugLogsMap] = useState<Map<string, LayerLog[]>>(new Map());

  // Persist debug logs preference
  useEffect(() => {
    localStorage.setItem('assistant_debug_logs', String(showDebugLogs));
  }, [showDebugLogs]);

  // Load user account ID
  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (userData) {
      try {
        const user = JSON.parse(userData);
        setUserAccountId(user.id);
      } catch (e) {
        console.error('Failed to parse user data:', e);
      }
    }
  }, []);

  // Load conversations
  const loadConversations = useCallback(async () => {
    if (!userAccountId) return;

    try {
      setConversationsLoading(true);
      const data = await getConversations(userAccountId, currentAdAccountId || undefined);
      setConversations(data);
    } catch (error) {
      console.error('Failed to load conversations:', error);
      toast.error('Не удалось загрузить чаты');
    } finally {
      setConversationsLoading(false);
    }
  }, [userAccountId, currentAdAccountId]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Reset active conversation when ad account changes
  useEffect(() => {
    setActiveConversationId(null);
    setMessages([]);
    setPendingPlan(null);
    setPlanModalOpen(false);
  }, [currentAdAccountId]);

  // Load messages for active conversation
  const loadMessages = useCallback(async () => {
    if (!userAccountId || !activeConversationId) {
      setMessages([]);
      return;
    }

    try {
      setMessagesLoading(true);
      const data = await getConversationMessages(activeConversationId, userAccountId);
      setMessages(data);
    } catch (error) {
      console.error('Failed to load messages:', error);
      toast.error('Не удалось загрузить сообщения');
    } finally {
      setMessagesLoading(false);
    }
  }, [userAccountId, activeConversationId]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  // Handle sending a message with streaming
  const handleSend = async (message: string) => {
    if (!userAccountId) {
      toast.error('Пользователь не авторизован');
      return;
    }

    // Cancel any existing stream
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      setIsSending(true);
      setIsStreaming(true);
      setStreamingState(createInitialStreamingState());

      // Optimistically add user message
      const tempUserMessage: ChatMessage = {
        id: `temp-${Date.now()}`,
        conversation_id: activeConversationId || '',
        role: 'user',
        content: message,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, tempUserMessage]);

      let currentConversationId = activeConversationId;
      let finalContent = '';
      let finalExecutedActions: ChatMessage['actions_json'] = [];
      let finalUiJson: ChatMessage['ui_json'] = undefined;

      // Stream the response
      const stream = sendMessageStream(
        {
          message,
          conversationId: activeConversationId || undefined,
          mode,
          userAccountId,
          adAccountId: currentAdAccountId || undefined,
          debugLayers: isAdmin && showDebugLogs,
        },
        abortController.signal
      );

      for await (const event of stream) {
        if (abortController.signal.aborted) break;

        // Update streaming state
        setStreamingState((prev) =>
          prev ? updateStreamingState(prev, event) : createInitialStreamingState()
        );

        // Handle specific events
        switch (event.type) {
          case 'init':
            if (!currentConversationId) {
              currentConversationId = event.conversationId;
              setActiveConversationId(event.conversationId);
              // Update temp message with real conversation ID
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === tempUserMessage.id
                    ? { ...m, conversation_id: event.conversationId }
                    : m
                )
              );
              loadConversations(); // Refresh sidebar
            }
            break;

          case 'done':
            finalContent = event.content;
            finalExecutedActions = event.executedActions || [];
            finalUiJson = event.uiJson || event.uiComponents;
            break;

          case 'error':
            toast.error(event.message || 'Ошибка при обработке');
            break;
        }
      }

      // Add final assistant message
      if (finalContent && currentConversationId) {
        const messageId = `response-${Date.now()}`;
        const assistantMessage: ChatMessage = {
          id: messageId,
          conversation_id: currentConversationId,
          role: 'assistant',
          content: finalContent,
          actions_json: finalExecutedActions,
          ui_json: finalUiJson,
          created_at: new Date().toISOString(),
        };

        setMessages((prev) => [...prev, assistantMessage]);

        // Save layer logs for this message (from streaming state)
        setStreamingState((currentState) => {
          if (currentState?.layerLogs && currentState.layerLogs.length > 0) {
            setDebugLogsMap((prevMap) => {
              const newMap = new Map(prevMap);
              newMap.set(messageId, currentState.layerLogs);
              return newMap;
            });
          }
          return currentState;
        });
      }

    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        // Stream was cancelled, ignore
        return;
      }
      console.error('Failed to send message:', error);
      toast.error('Не удалось отправить сообщение');
      // Remove temp message on error
      setMessages((prev) => prev.filter((m) => !m.id.startsWith('temp-')));
    } finally {
      setIsSending(false);
      setIsStreaming(false);
      setStreamingState(null);
      abortControllerRef.current = null;
    }
  };

  // Handle selecting a conversation
  const handleSelectConversation = (id: string) => {
    setActiveConversationId(id);
    setPendingPlan(null);
    setPlanModalOpen(false);
  };

  // Handle creating a new conversation
  const handleNewConversation = () => {
    setActiveConversationId(null);
    setMessages([]);
    setPendingPlan(null);
    setPlanModalOpen(false);
  };

  // Handle deleting a conversation
  const handleDeleteConversation = async (id: string) => {
    if (!userAccountId) return;

    try {
      await deleteConversation(id, userAccountId);
      setConversations((prev) => prev.filter((c) => c.id !== id));

      if (activeConversationId === id) {
        setActiveConversationId(null);
        setMessages([]);
      }

      toast.success('Чат удалён');
    } catch (error) {
      console.error('Failed to delete conversation:', error);
      toast.error('Не удалось удалить чат');
    }
  };

  // Handle plan approval
  const handlePlanApprove = async (approvalMode: 'yes' | 'yes_auto' | 'yes_manual') => {
    if (!userAccountId || !activeConversationId || !pendingPlan) return;

    try {
      setIsExecutingPlan(true);

      const result = await executePlan({
        conversationId: activeConversationId,
        userAccountId,
        adAccountId: currentAdAccountId || undefined,
        executeAll: approvalMode === 'yes' || approvalMode === 'yes_auto',
      });

      if (result.success) {
        toast.success('План выполнен');
      } else {
        toast.error('Некоторые действия не выполнены');
      }

      // Reload messages to show execution results
      loadMessages();
      setPlanModalOpen(false);
      setPendingPlan(null);
    } catch (error) {
      console.error('Failed to execute plan:', error);
      toast.error('Не удалось выполнить план');
    } finally {
      setIsExecutingPlan(false);
    }
  };

  // Handle plan rejection
  const handlePlanReject = () => {
    setPlanModalOpen(false);
    setPendingPlan(null);
    toast.info('План отклонён');
  };

  return (
    <div className="min-h-screen bg-background">
      <Header onOpenDatePicker={() => {}} />

      <div className="h-[calc(100vh-76px)] flex flex-col overflow-hidden pt-[76px]">
        {/* Messages with conversation dropdown */}
        <ChatMessages
          messages={messages}
          isLoading={isSending || messagesLoading}
          isStreaming={isStreaming}
          streamingState={streamingState}
          onApprove={(plan) => {
            setPendingPlan(plan);
            setPlanModalOpen(true);
          }}
          onUIAction={(action) => {
            // Convert action to user message and send
            const actionMessages: Record<string, string> = {
              'show_blocking_reason': 'Покажи подробности о причине блокировки',
              'check_billing': 'Проверь платёжный метод',
              'show_last_campaigns': 'Покажи последние кампании',
              'connect_fb': 'Как подключить Facebook?',
              'show_integrations': 'Что подключено?',
              'show_capabilities': 'Что ты умеешь?',
              'diagnose_no_activity': 'Почему нет активности?',
              'show_campaigns': 'Покажи кампании',
              'run_diagnosis': 'Проведи диагностику',
              'spend_report': 'Покажи расходы за неделю',
              'roi_report': 'Покажи отчёт по ROI',
              'leads_list': 'Покажи лиды за сегодня',
              'cpl_analysis': 'Проведи анализ CPL',
              'dialogs_list': 'Покажи последние диалоги',
            };
            const message = actionMessages[action] || `Выполни: ${action}`;
            handleSend(message);
          }}
          conversations={conversations}
          activeConversationId={activeConversationId || undefined}
          onSelectConversation={handleSelectConversation}
          onNewConversation={handleNewConversation}
          debugLogsMap={debugLogsMap}
          showDebugButton={isAdmin && showDebugLogs}
        />

        {/* Debug logs toggle (admin only) */}
        {isAdmin && (
          <div className="absolute top-20 right-4 z-10">
            <Button
              variant={showDebugLogs ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowDebugLogs(!showDebugLogs)}
              className="gap-2"
              title="Toggle debug logs"
            >
              <Bug className="h-4 w-4" />
              {showDebugLogs ? 'Debug ON' : 'Debug OFF'}
            </Button>
          </div>
        )}

        {/* Input */}
        <ChatInput
          onSend={handleSend}
          mode={mode}
          onModeChange={setMode}
          isLoading={isSending}
          disabled={!userAccountId}
        />
      </div>

      {/* Plan approval modal */}
      {pendingPlan && (
        <PlanApprovalModal
          plan={pendingPlan}
          open={planModalOpen}
          onClose={() => setPlanModalOpen(false)}
          onApprove={handlePlanApprove}
          onReject={handlePlanReject}
          isExecuting={isExecutingPlan}
        />
      )}
    </div>
  );
};

export default Assistant;
