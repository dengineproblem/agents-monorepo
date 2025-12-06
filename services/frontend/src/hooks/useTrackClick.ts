/**
 * useTrackClick Hook
 *
 * Предоставляет функцию для отслеживания кликов на элементах
 * Используется для явного трекинга важных действий пользователя
 *
 * @module hooks/useTrackClick
 */

import { useCallback } from 'react';
import { analytics } from '@/lib/analytics';

interface TrackClickOptions {
  /** Название компонента (например, 'CampaignCard', 'Sidebar') */
  component: string;
}

type TrackClickFn = (label: string, metadata?: Record<string, unknown>) => void;

/**
 * Hook для отслеживания кликов
 *
 * @example
 * ```tsx
 * function CampaignCard({ campaign }) {
 *   const trackClick = useTrackClick({ component: 'CampaignCard' });
 *
 *   return (
 *     <button onClick={() => {
 *       trackClick('view_details', { campaignId: campaign.id });
 *       navigate(`/campaign/${campaign.id}`);
 *     }}>
 *       View Details
 *     </button>
 *   );
 * }
 * ```
 */
export function useTrackClick(options: TrackClickOptions): TrackClickFn {
  const { component } = options;

  const trackClick = useCallback(
    (label: string, metadata?: Record<string, unknown>) => {
      analytics.trackClick(component, label, metadata);
    },
    [component]
  );

  return trackClick;
}

/**
 * Простая функция для одноразового трекинга без hook
 * Полезно для обработчиков вне компонентов
 */
export function trackClick(
  component: string,
  label: string,
  metadata?: Record<string, unknown>
): void {
  analytics.trackClick(component, label, metadata);
}
