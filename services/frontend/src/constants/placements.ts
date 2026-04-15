// Константы для выбора площадок и плейсментов Meta рекламы

export const PUBLISHER_PLATFORM_OPTIONS = [
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
] as const;

export const FACEBOOK_PLACEMENT_OPTIONS = [
  { value: 'feed', label: 'Лента (Feed)' },
  { value: 'story', label: 'Истории (Stories)' },
  { value: 'reels', label: 'Reels' },
  { value: 'marketplace', label: 'Маркетплейс' },
  { value: 'search', label: 'Поиск' },
  { value: 'instream_video', label: 'In-Stream видео' },
] as const;

export const INSTAGRAM_PLACEMENT_OPTIONS = [
  { value: 'stream', label: 'Лента (Feed)' },
  { value: 'story', label: 'Истории (Stories)' },
  { value: 'reels', label: 'Reels' },
  { value: 'explore', label: 'Explore' },
] as const;

export type PublisherPlatform = typeof PUBLISHER_PLATFORM_OPTIONS[number]['value'];
export type FacebookPlacement = typeof FACEBOOK_PLACEMENT_OPTIONS[number]['value'];
export type InstagramPlacement = typeof INSTAGRAM_PLACEMENT_OPTIONS[number]['value'];

/**
 * Возвращает читаемое описание выбранных площадок/плейсментов
 * для отображения в кнопке-триггере дропдауна.
 */
export function getPlacementSummary(
  publisherPlatforms: string[],
  facebookPlacements: string[],
  instagramPlacements: string[]
): string {
  const hasAny = publisherPlatforms.length > 0 || facebookPlacements.length > 0 || instagramPlacements.length > 0;
  if (!hasAny) return 'Все площадки (Advantage+)';

  const platforms = publisherPlatforms.length > 0
    ? publisherPlatforms
    : ['facebook', 'instagram'];

  const parts: string[] = [];

  if (platforms.includes('facebook')) {
    parts.push(
      facebookPlacements.length > 0
        ? `FB: ${FACEBOOK_PLACEMENT_OPTIONS.filter(o => facebookPlacements.includes(o.value)).map(o => o.label).join(', ')}`
        : 'Facebook (все)'
    );
  }

  if (platforms.includes('instagram')) {
    parts.push(
      instagramPlacements.length > 0
        ? `IG: ${INSTAGRAM_PLACEMENT_OPTIONS.filter(o => instagramPlacements.includes(o.value)).map(o => o.label).join(', ')}`
        : 'Instagram (все)'
    );
  }

  return parts.join(' · ') || 'Advantage+';
}
