import { useState, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import {
  runBrainMiniStream,
  executePlan,
  type Plan,
  type BrainMiniEvent,
  type BrainMiniProposal,
  type BrainMiniAdsetAnalysis,
  type BrainMiniSummary,
} from '@/services/assistantApi';
import {
  createInitialStreamingState,
  type StreamingState,
} from '@/components/assistant/StreamingMessage';

/**
 * Scope оптимизации - определяет что анализировать
 */
export interface OptimizationScope {
  accountId: string;       // UUID из ad_accounts.id
  accountName: string;     // Имя аккаунта для отображения
  directionId?: string;    // UUID direction (опционально, для CampaignRow)
  directionName?: string;  // Имя направления для отображения
  campaignId?: string;     // Facebook campaign ID (для фильтрации по конкретной кампании)
}

/**
 * Состояние процесса оптимизации
 */
export interface OptimizationState {
  isOpen: boolean;
  isLoading: boolean;
  scope: OptimizationScope | null;
  streamingState: StreamingState | null;
  plan: Plan | null;
  content: string | null; // Текстовый ответ от AI (message из done)
  error: string | null;
  conversationId: string | null;
  isExecuting: boolean;
  // Brain Mini direct API fields
  proposals: BrainMiniProposal[];
  adsetAnalysis: BrainMiniAdsetAnalysis[];
  summary: BrainMiniSummary | null;
  progressMessage: string | null;
}

/**
 * Хук для управления процессом оптимизации Brain Mini
 */
export function useOptimization() {
  const [state, setState] = useState<OptimizationState>({
    isOpen: false,
    isLoading: false,
    scope: null,
    streamingState: null,
    plan: null,
    content: null,
    error: null,
    conversationId: null,
    isExecuting: false,
    proposals: [],
    adsetAnalysis: [],
    summary: null,
    progressMessage: null,
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const streamingStateRef = useRef<StreamingState | null>(null);

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
   * Запустить процесс оптимизации через прямой API (без LLM)
   */
  const startOptimization = useCallback(async (scope: OptimizationScope) => {

    const userAccountId = getUserAccountId();

    if (!userAccountId) {
      toast.error('Пользователь не авторизован');
      return;
    }

    // Отменяем предыдущий запрос если есть
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // Флаг для различения таймаута и ручной отмены
    let isTimeout = false;

    // Таймаут 5 минут (300000 мс) - прямой API быстрее чем через LLM
    const timeoutId = setTimeout(() => {
      isTimeout = true;
      abortController.abort();
    }, 300000);

    // Инициализируем состояние
    const initialState = createInitialStreamingState();
    setState({
      isOpen: true,
      isLoading: true,
      scope,
      streamingState: initialState,
      plan: null,
      content: null,
      error: null,
      conversationId: null,
      isExecuting: false,
      proposals: [],
      adsetAnalysis: [],
      summary: null,
      progressMessage: 'Запускаю анализ...',
    });
    streamingStateRef.current = initialState;

    try {

      // Используем прямой API вместо LLM chat
      // Если accountId пустая строка - передаём undefined, backend сам определит аккаунт
      const stream = runBrainMiniStream(
        {
          userAccountId,
          adAccountId: scope.accountId || undefined,
          directionId: scope.directionId,
          campaignId: scope.campaignId,
          dryRun: true, // Всегда dry_run - показываем предложения для подтверждения
        },
        abortController.signal
      );

      let finalPlan: Plan | null = null;
      let finalContent: string | null = null;
      let finalProposals: BrainMiniProposal[] = [];
      let finalAdsetAnalysis: BrainMiniAdsetAnalysis[] = [];
      let finalSummary: BrainMiniSummary | null = null;
      let errorMessage: string | null = null;

      for await (const event of stream) {

        if (abortController.signal.aborted) {

          break;
        }

        // Обрабатываем события Brain Mini
        switch (event.type) {
          case 'progress':

            setState(prev => ({
              ...prev,
              progressMessage: event.message,
            }));
            break;

          case 'done':

            if (event.success) {
              finalProposals = event.proposals || [];
              finalAdsetAnalysis = event.adset_analysis || [];
              finalSummary = event.summary;
              finalContent = event.message;

              // Конвертируем proposals → plan.steps для отображения в UI
              // Backend уже содержит все нужные данные (direction_name, budget и т.д.)
              if (finalProposals.length > 0) {
                const summaryText = finalSummary
                  ? `${finalSummary.today_total_spend} расход, ${finalSummary.today_total_leads || 0} лидов. Анализ ${finalSummary.total_adsets_analyzed} адсетов.`
                  : null;

                finalPlan = {
                  description: summaryText,
                  steps: finalProposals.map(p => ({
                    action: p.action,
                    description: p.reason,
                    params: {
                      entity_id: p.entity_id,
                      entity_name: p.entity_name,
                      direction_name: p.direction_name,
                      direction_id: p.direction_id,
                      campaign_id: p.campaign_id,
                      campaign_type: p.campaign_type,
                      current_budget_cents: p.suggested_action_params?.current_budget_cents as number | undefined,
                      new_budget_cents: p.suggested_action_params?.new_budget_cents as number | undefined,
                      increase_percent: p.suggested_action_params?.increase_percent as number | undefined,
                      decrease_percent: p.suggested_action_params?.decrease_percent as number | undefined,
                      recommended_budget_cents: p.suggested_action_params?.recommended_budget_cents as number | undefined,
                      creative_ids: p.suggested_action_params?.creative_ids as string[] | undefined,
                      creative_titles: p.suggested_action_params?.creative_titles as string[] | undefined,
                    },
                    priority: p.priority,
                    dangerous: p.priority === 'critical',
                  })),
                  estimated_impact: event.message,
                };
              } else {
                // Если proposals пустые - используем план от API (если есть)
                finalPlan = event.plan;
              }
            } else {
              errorMessage = event.message || 'Ошибка при анализе';
            }
            break;

          case 'error':

            errorMessage = event.message || 'Ошибка при анализе';
            break;
        }
      }

      // Очищаем таймаут
      clearTimeout(timeoutId);

      // Завершаем с результатами
      setState(prev => ({
        ...prev,
        isLoading: false,
        plan: finalPlan,
        content: finalContent,
        proposals: finalProposals,
        adsetAnalysis: finalAdsetAnalysis,
        summary: finalSummary,
        error: errorMessage,
        progressMessage: null,
      }));

    } catch (error) {
      // Очищаем таймаут
      clearTimeout(timeoutId);

      if ((error as Error).name === 'AbortError') {
        if (isTimeout) {
          // Таймаут - показываем ошибку пользователю

          setState(prev => ({
            ...prev,
            isLoading: false,
            error: 'Превышено время ожидания (5 минут). Попробуйте ещё раз или выберите конкретное направление.',
            progressMessage: null,
          }));
          return;
        }
        // Ручная отмена - просто выходим

        return;
      }

      setState(prev => ({
        ...prev,
        isLoading: false,
        error: (error as Error).message || 'Не удалось запустить оптимизацию',
        progressMessage: null,
      }));
    }
  }, [getUserAccountId]);

  /**
   * Закрыть модальное окно
   */
  const closeModal = useCallback(() => {
    // Отменяем запрос если ещё идёт
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    streamingStateRef.current = null;

    setState({
      isOpen: false,
      isLoading: false,
      scope: null,
      streamingState: null,
      plan: null,
      content: null,
      error: null,
      conversationId: null,
      isExecuting: false,
      proposals: [],
      adsetAnalysis: [],
      summary: null,
      progressMessage: null,
    });
  }, []);

  /**
   * Одобрить и выполнить все предложения
   * Вызывает Brain Mini повторно с dry_run=false
   */
  const approveSelected = useCallback(async (stepIndices: number[]) => {
    const userAccountId = getUserAccountId();
    if (!userAccountId || !state.scope) {
      toast.error('Недостаточно данных для выполнения');
      return;
    }

    if (stepIndices.length === 0) {
      toast.error('Нет действий для выполнения');
      return;
    }

    setState(prev => ({ ...prev, isExecuting: true }));

    try {
      // Фильтруем только выбранные proposals по индексам
      const selectedProposals = stepIndices.map(i => state.proposals[i]).filter(Boolean);

      // Передаём только выбранные proposals для выполнения (без повторного анализа)
      const stream = runBrainMiniStream(
        {
          userAccountId,
          adAccountId: state.scope.accountId || undefined,
          directionId: state.scope.directionId,
          campaignId: state.scope.campaignId,
          dryRun: false, // Реальное выполнение
          proposals: selectedProposals, // Передаём ТОЛЬКО выбранные proposals
        },
        undefined // Без abort signal
      );

      let success = false;
      let message = '';

      for await (const event of stream) {

        if (event.type === 'done') {
          success = event.success;
          message = event.message || '';
        } else if (event.type === 'error') {
          message = event.message || 'Ошибка при выполнении';
        }
      }

      if (success) {
        toast.success('Оптимизация выполнена');
        closeModal();
      } else {
        toast.error(message || 'Ошибка при выполнении плана');
      }
    } catch (error) {

      toast.error('Не удалось выполнить оптимизацию');
    } finally {
      setState(prev => ({ ...prev, isExecuting: false }));
    }
  }, [getUserAccountId, state.scope, state.proposals, closeModal]);

  /**
   * Отклонить план
   */
  const reject = useCallback(() => {
    toast.info('План отклонён');
    closeModal();
  }, [closeModal]);

  return {
    state,
    startOptimization,
    approveSelected,
    reject,
    close: closeModal,
  };
}

export default useOptimization;
