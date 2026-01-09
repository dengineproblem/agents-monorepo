import { useState, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import {
  sendMessageStream,
  executePlan,
  type Plan,
  type StreamEvent,
} from '@/services/assistantApi';
import {
  createInitialStreamingState,
  updateStreamingState,
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
  content: string | null; // Текстовый ответ от AI
  error: string | null;
  conversationId: string | null;
  isExecuting: boolean;
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
   * Запустить процесс оптимизации
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

    // Формируем сообщение - явно указываем вызвать triggerBrainOptimizationRun с dry_run: true
    const message = scope.directionId
      ? `Вызови инструмент triggerBrainOptimizationRun с параметрами: direction_id="${scope.directionId}", dry_run=true. Покажи предложения по оптимизации для направления "${scope.directionName || 'направление'}".`
      : `Вызови инструмент triggerBrainOptimizationRun с параметрами: dry_run=true. Покажи предложения по оптимизации для всего аккаунта "${scope.accountName}".`;

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
    });
    streamingStateRef.current = initialState;

    try {
      console.log('[Optimization] Starting stream with:', {
        message,
        mode: 'plan',
        userAccountId,
        adAccountId: scope.accountId,
      });

      const stream = sendMessageStream(
        {
          message,
          mode: 'plan', // Режим плана - требует одобрения
          userAccountId,
          adAccountId: scope.accountId,
        },
        abortController.signal
      );

      let finalPlan: Plan | null = null;
      let finalContent: string | null = null;
      let conversationId: string | null = null;
      let errorMessage: string | null = null;

      for await (const event of stream) {
        console.log('[Optimization] SSE event:', event.type, event);

        if (abortController.signal.aborted) {
          console.log('[Optimization] Aborted');
          break;
        }

        // Обновляем streaming state
        const newStreamingState = streamingStateRef.current
          ? updateStreamingState(streamingStateRef.current, event)
          : createInitialStreamingState();

        streamingStateRef.current = newStreamingState;

        setState(prev => ({
          ...prev,
          streamingState: newStreamingState,
        }));

        // Обрабатываем специфичные события
        switch (event.type) {
          case 'init':
            conversationId = event.conversationId;
            console.log('[Optimization] Got conversationId:', conversationId);
            setState(prev => ({ ...prev, conversationId }));
            break;

          case 'done':
            console.log('[Optimization] Done event, plan:', event.plan, 'content:', event.content);
            if (event.plan) {
              finalPlan = event.plan;
            }
            // Сохраняем текстовый ответ
            if (event.content) {
              finalContent = event.content;
            }
            break;

          case 'error':
            console.log('[Optimization] Error event:', event.message);
            errorMessage = event.message || 'Ошибка при анализе';
            break;
        }
      }

      console.log('[Optimization] Stream finished, finalPlan:', finalPlan, 'content:', finalContent, 'error:', errorMessage);

      // Завершаем с результатами
      setState(prev => ({
        ...prev,
        isLoading: false,
        plan: finalPlan,
        content: finalContent,
        error: errorMessage,
      }));

    } catch (error) {
      console.log('[Optimization] Catch block, error:', error);
      if ((error as Error).name === 'AbortError') {
        console.log('[Optimization] AbortError, returning');
        return;
      }

      console.error('[Optimization] Error:', error);
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: (error as Error).message || 'Не удалось запустить оптимизацию',
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
    });
  }, []);

  /**
   * Одобрить и выполнить план
   */
  const approveAll = useCallback(async () => {
    const userAccountId = getUserAccountId();
    if (!userAccountId || !state.conversationId || !state.scope) {
      toast.error('Недостаточно данных для выполнения');
      return;
    }

    setState(prev => ({ ...prev, isExecuting: true }));

    try {
      const result = await executePlan({
        conversationId: state.conversationId,
        userAccountId,
        adAccountId: state.scope.accountId,
        executeAll: true,
      });

      if (result.success) {
        toast.success('План успешно выполнен');
        closeModal();
      } else {
        toast.error(result.message || 'Ошибка при выполнении плана');
      }
    } catch (error) {
      console.error('Execute plan error:', error);
      toast.error('Не удалось выполнить план');
    } finally {
      setState(prev => ({ ...prev, isExecuting: false }));
    }
  }, [getUserAccountId, state.conversationId, state.scope, closeModal]);

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
    approveAll,
    reject,
    close: closeModal,
  };
}

export default useOptimization;
