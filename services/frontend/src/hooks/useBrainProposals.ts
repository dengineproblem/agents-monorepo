import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { API_BASE_URL } from '@/config/api';

/**
 * Proposal от Brain агента
 */
export interface BrainProposal {
  action: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  entity_type: string;
  entity_id: string;
  entity_name: string;
  direction_id?: string;
  direction_name?: string;
  campaign_id?: string;
  campaign_type?: 'internal' | 'external';
  health_score?: number;
  hs_class?: string;
  reason: string;
  confidence?: number;
  suggested_action_params?: Record<string, any>;
  metrics?: Record<string, any>;
}

/**
 * Pending набор proposals из БД
 */
export interface PendingProposal {
  id: string;
  ad_account_id: string;
  user_account_id: string;
  proposals: BrainProposal[];
  context: {
    summary?: string;
    adset_analysis?: any;
  };
  proposals_count: number;
  status: 'pending' | 'partial' | 'approved' | 'rejected' | 'expired';
  notification_id?: string;
  created_at: string;
  expires_at: string;
  processed_at?: string;
  executed_indices: number[];
  // Дополнительно от API
  ad_account_name?: string;
}

/**
 * Состояние модалки proposals
 */
export interface BrainProposalsModalState {
  isOpen: boolean;
  proposal: PendingProposal | null;
  isLoading: boolean;
  isExecuting: boolean;
  error: string | null;
}

/**
 * Хук для управления Brain proposals
 */
export function useBrainProposals(accountId?: string) {
  const [pendingProposals, setPendingProposals] = useState<PendingProposal[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  const [modalState, setModalState] = useState<BrainProposalsModalState>({
    isOpen: false,
    proposal: null,
    isLoading: false,
    isExecuting: false,
    error: null,
  });

  /**
   * Получить userAccountId из localStorage
   */
  const getUserAccountId = useCallback((): string | null => {
    const userData = localStorage.getItem('user');
    if (!userData) return null;
    try {
      const user = JSON.parse(userData);
      return user.id || null;
    } catch {
      return null;
    }
  }, []);

  /**
   * Загрузить pending proposals
   */
  const fetchPending = useCallback(async () => {
    const userAccountId = getUserAccountId();
    if (!userAccountId) return;

    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (accountId) {
        params.set('accountId', accountId);
      }

      const url = `${API_BASE_URL}/brain-proposals/pending${params.toString() ? `?${params}` : ''}`;
      console.log('[useBrainProposals] Fetching pending:', url);

      const response = await fetch(url, {
        headers: { 'x-user-id': userAccountId }
      });

      if (!response.ok) {
        console.error('[useBrainProposals] Fetch pending failed:', response.status);
        setPendingProposals([]);
        setPendingCount(0);
        return;
      }

      const data = await response.json();
      console.log('[useBrainProposals] Pending loaded:', data.count);

      setPendingProposals(data.proposals || []);
      setPendingCount(data.count || 0);
    } catch (error) {
      console.error('[useBrainProposals] Fetch error:', error);
      setPendingProposals([]);
      setPendingCount(0);
    } finally {
      setIsLoading(false);
    }
  }, [accountId, getUserAccountId]);

  /**
   * Получить количество pending proposals
   */
  const fetchPendingCount = useCallback(async () => {
    const userAccountId = getUserAccountId();
    if (!userAccountId) return;

    try {
      const response = await fetch(`${API_BASE_URL}/brain-proposals/count`, {
        headers: { 'x-user-id': userAccountId }
      });

      if (!response.ok) {
        console.error('[useBrainProposals] Count fetch failed:', response.status);
        return;
      }

      const data = await response.json();
      setPendingCount(data.count || 0);
    } catch (error) {
      console.error('[useBrainProposals] Count fetch error:', error);
    }
  }, [getUserAccountId]);

  /**
   * Загрузить конкретный proposal
   */
  const fetchProposal = useCallback(async (proposalId: string): Promise<PendingProposal | null> => {
    const userAccountId = getUserAccountId();
    if (!userAccountId) return null;

    console.log('[useBrainProposals] Fetching proposal:', proposalId);
    try {
      const response = await fetch(`${API_BASE_URL}/brain-proposals/${proposalId}`, {
        headers: { 'x-user-id': userAccountId }
      });

      if (!response.ok) {
        console.error('[useBrainProposals] Fetch proposal failed:', response.status);
        return null;
      }

      // API возвращает объект напрямую (не в обёртке)
      const data = await response.json();
      console.log('[useBrainProposals] Proposal loaded:', data?.id);
      return data || null;
    } catch (error) {
      console.error('[useBrainProposals] Fetch proposal error:', error);
      return null;
    }
  }, [getUserAccountId]);

  /**
   * Открыть модалку с proposal
   */
  const openModal = useCallback(async (proposalOrId: PendingProposal | string) => {
    setModalState(prev => ({ ...prev, isOpen: true, isLoading: true, error: null }));

    try {
      let proposal: PendingProposal | null;

      if (typeof proposalOrId === 'string') {
        proposal = await fetchProposal(proposalOrId);
      } else {
        proposal = proposalOrId;
      }

      if (!proposal) {
        setModalState(prev => ({
          ...prev,
          isLoading: false,
          error: 'Предложения не найдены или устарели',
        }));
        return;
      }

      setModalState({
        isOpen: true,
        proposal,
        isLoading: false,
        isExecuting: false,
        error: null,
      });
    } catch (error) {
      setModalState(prev => ({
        ...prev,
        isLoading: false,
        error: 'Ошибка загрузки предложений',
      }));
    }
  }, [fetchProposal]);

  /**
   * Закрыть модалку
   */
  const closeModal = useCallback(() => {
    setModalState({
      isOpen: false,
      proposal: null,
      isLoading: false,
      isExecuting: false,
      error: null,
    });
  }, []);

  /**
   * Одобрить выбранные proposals
   */
  const approve = useCallback(async (proposalId: string, stepIndices: number[]) => {
    const userAccountId = getUserAccountId();
    if (!userAccountId) {
      toast.error('Пользователь не авторизован');
      return false;
    }

    if (stepIndices.length === 0) {
      toast.error('Выберите хотя бы одно действие');
      return false;
    }

    setModalState(prev => ({ ...prev, isExecuting: true }));

    try {
      console.log('[useBrainProposals] Approving:', proposalId, 'steps:', stepIndices);

      const response = await fetch(`${API_BASE_URL}/brain-proposals/${proposalId}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userAccountId
        },
        body: JSON.stringify({ stepIndices })
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('[useBrainProposals] Approve failed:', data);
        toast.error(data.error || 'Ошибка при выполнении');
        return false;
      }

      if (data.success) {
        const count = data.executedCount || stepIndices.length;
        toast.success(`Выполнено ${count} ${count === 1 ? 'действие' : count < 5 ? 'действия' : 'действий'}`);

        // Обновляем список
        await fetchPending();
        closeModal();
        return true;
      } else {
        toast.error(data.error || 'Ошибка при выполнении');
        return false;
      }
    } catch (error) {
      console.error('[useBrainProposals] Approve error:', error);
      toast.error('Не удалось выполнить действия');
      return false;
    } finally {
      setModalState(prev => ({ ...prev, isExecuting: false }));
    }
  }, [fetchPending, closeModal, getUserAccountId]);

  /**
   * Отклонить proposals
   */
  const reject = useCallback(async (proposalId: string) => {
    const userAccountId = getUserAccountId();
    if (!userAccountId) {
      toast.error('Пользователь не авторизован');
      return false;
    }

    try {
      console.log('[useBrainProposals] Rejecting:', proposalId);

      const response = await fetch(`${API_BASE_URL}/brain-proposals/${proposalId}/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userAccountId
        }
      });

      if (!response.ok) {
        const data = await response.json();
        toast.error(data.error || 'Ошибка при отклонении');
        return false;
      }

      toast.info('Предложения отклонены');

      // Обновляем список
      await fetchPending();
      closeModal();
      return true;
    } catch (error) {
      console.error('[useBrainProposals] Reject error:', error);
      toast.error('Не удалось отклонить предложения');
      return false;
    }
  }, [fetchPending, closeModal, getUserAccountId]);

  /**
   * Отложить (просто закрыть модалку)
   */
  const postpone = useCallback(() => {
    toast.info('Вы можете вернуться к предложениям позже');
    closeModal();
  }, [closeModal]);

  // Загружаем данные при монтировании и изменении accountId
  useEffect(() => {
    fetchPending();
  }, [fetchPending]);

  return {
    // Данные
    pendingProposals,
    pendingCount,
    isLoading,
    hasPending: pendingCount > 0,

    // Модалка
    modalState,
    openModal,
    closeModal,

    // Действия
    approve,
    reject,
    postpone,

    // Обновление
    refresh: fetchPending,
    refreshCount: fetchPendingCount,
  };
}

export default useBrainProposals;
