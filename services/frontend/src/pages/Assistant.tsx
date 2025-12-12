import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import Header from '../components/Header';
import { useAppContext } from '../context/AppContext';
import {
  ChatSidebar,
  ChatMessages,
  ChatInput,
  PlanApprovalModal,
} from '../components/assistant';
import {
  sendMessage,
  getConversations,
  getConversationMessages,
  deleteConversation,
  executePlan,
  type Conversation,
  type ChatMessage,
  type ChatMode,
  type Plan,
} from '../services/assistantApi';

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

  // Handle sending a message
  const handleSend = async (message: string) => {
    if (!userAccountId) {
      toast.error('Пользователь не авторизован');
      return;
    }

    try {
      setIsSending(true);

      // Optimistically add user message
      const tempUserMessage: ChatMessage = {
        id: `temp-${Date.now()}`,
        conversation_id: activeConversationId || '',
        role: 'user',
        content: message,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, tempUserMessage]);

      const response = await sendMessage({
        message,
        conversationId: activeConversationId || undefined,
        mode,
        userAccountId,
        adAccountId: currentAdAccountId || undefined,
      });

      // Update active conversation
      if (!activeConversationId) {
        setActiveConversationId(response.conversationId);
        loadConversations(); // Refresh list
      }

      // Replace temp message with actual response
      const assistantMessage: ChatMessage = {
        id: `response-${Date.now()}`,
        conversation_id: response.conversationId,
        role: 'assistant',
        content: response.response,
        plan_json: response.plan,
        actions_json: response.executedActions,
        created_at: new Date().toISOString(),
      };

      setMessages((prev) => [
        ...prev.filter((m) => m.id !== tempUserMessage.id),
        { ...tempUserMessage, conversation_id: response.conversationId },
        assistantMessage,
      ]);

      // Show plan approval modal if needed
      if (response.plan?.requires_approval) {
        setPendingPlan(response.plan);
        setPlanModalOpen(true);
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      toast.error('Не удалось отправить сообщение');
      // Remove temp message on error
      setMessages((prev) => prev.filter((m) => !m.id.startsWith('temp-')));
    } finally {
      setIsSending(false);
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
    <div className="h-screen flex flex-col bg-background">
      <Header />

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-64 flex-shrink-0">
          <ChatSidebar
            conversations={conversations}
            activeConversationId={activeConversationId || undefined}
            onSelectConversation={handleSelectConversation}
            onNewConversation={handleNewConversation}
            onDeleteConversation={handleDeleteConversation}
            isLoading={conversationsLoading}
          />
        </div>

        {/* Main chat area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Messages */}
          <ChatMessages
            messages={messages}
            isLoading={isSending || messagesLoading}
            onApprove={(plan) => {
              setPendingPlan(plan);
              setPlanModalOpen(true);
            }}
          />

          {/* Input */}
          <ChatInput
            onSend={handleSend}
            mode={mode}
            onModeChange={setMode}
            isLoading={isSending}
            disabled={!userAccountId}
          />
        </div>
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
