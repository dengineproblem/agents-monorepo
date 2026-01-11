import React, { createContext, useContext, ReactNode } from 'react';
import { useBrainProposals, type PendingProposal, type BrainProposalsModalState } from '@/hooks/useBrainProposals';
import { BrainProposalsModal } from '@/components/brain/BrainProposalsModal';

interface BrainProposalsContextValue {
  // Данные
  pendingProposals: PendingProposal[];
  pendingCount: number;
  isLoading: boolean;
  hasPending: boolean;

  // Модалка
  modalState: BrainProposalsModalState;
  openModal: (proposalOrId: PendingProposal | string) => Promise<void>;
  closeModal: () => void;

  // Действия
  approve: (proposalId: string, stepIndices: number[]) => Promise<boolean>;
  reject: (proposalId: string) => Promise<boolean>;
  postpone: () => void;

  // Обновление
  refresh: () => Promise<void>;
  refreshCount: () => Promise<void>;
}

const BrainProposalsContext = createContext<BrainProposalsContextValue | null>(null);

interface BrainProposalsProviderProps {
  children: ReactNode;
}

/**
 * Provider для глобального доступа к Brain proposals
 */
export function BrainProposalsProvider({ children }: BrainProposalsProviderProps) {
  const brainProposals = useBrainProposals();

  return (
    <BrainProposalsContext.Provider value={brainProposals}>
      {children}
      <BrainProposalsModal
        modalState={brainProposals.modalState}
        onClose={brainProposals.closeModal}
        onApprove={brainProposals.approve}
        onReject={brainProposals.reject}
        onPostpone={brainProposals.postpone}
      />
    </BrainProposalsContext.Provider>
  );
}

/**
 * Hook для использования Brain proposals контекста
 */
export function useBrainProposalsContext(): BrainProposalsContextValue {
  const context = useContext(BrainProposalsContext);
  if (!context) {
    throw new Error('useBrainProposalsContext must be used within BrainProposalsProvider');
  }
  return context;
}

/**
 * Hook для опционального использования (не бросает ошибку)
 */
export function useBrainProposalsContextOptional(): BrainProposalsContextValue | null {
  return useContext(BrainProposalsContext);
}

export default BrainProposalsContext;
