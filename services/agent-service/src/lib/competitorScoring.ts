/**
 * Функции скоринга креативов конкурентов
 *
 * Формула: SCORE = 25*active + 25*duration + 25*variations + 25*format
 * Каждый фактор даёт 0-25 баллов, итого 0-100 (до 102.5 с IG бонусом)
 */

export interface CreativeScoreInput {
  is_active: boolean;
  first_shown_date?: string | Date | null;
  media_type: 'video' | 'image' | 'carousel';
  ad_variations?: number;
  platforms?: string[] | string;
}

export interface CreativeScoreResult {
  score: number;
  duration_days: number;
  factors: {
    active: number;
    duration: number;
    variations: number;
    format: number;
  };
}

/**
 * Рассчитать количество дней с даты первого показа
 */
export function calculateDurationDays(firstShownDate: string | Date | null | undefined): number {
  if (!firstShownDate) return 0;

  const startDate = new Date(firstShownDate);
  const now = new Date();
  const diffMs = now.getTime() - startDate.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  return Math.max(0, diffDays);
}

/**
 * Проверить, содержит ли platforms Instagram
 */
function hasInstagram(platforms: string[] | string | undefined): boolean {
  if (!platforms) return false;

  if (Array.isArray(platforms)) {
    return platforms.some(p =>
      p.toLowerCase().includes('instagram') || p.toLowerCase() === 'ig'
    );
  }

  if (typeof platforms === 'string') {
    try {
      const parsed = JSON.parse(platforms);
      if (Array.isArray(parsed)) {
        return parsed.some((p: string) =>
          p.toLowerCase().includes('instagram') || p.toLowerCase() === 'ig'
        );
      }
    } catch {
      return platforms.toLowerCase().includes('instagram');
    }
  }

  return false;
}

/**
 * Рассчитать score креатива (0-100 баллов)
 *
 * Факторы:
 * - active_factor: 1.0 если активен, 0.8 если снят (-20%, не провал)
 * - duration_factor: min(duration_days / 180, 1.0) - cap 180 дней
 * - variations_factor: min(variations / 10, 1.0) - cap 10 вариаций
 * - format_factor: video=1.0, carousel=0.85, image=0.5, +0.1 если Instagram
 */
export function calculateCreativeScore(input: CreativeScoreInput): CreativeScoreResult {
  const durationDays = calculateDurationDays(input.first_shown_date);

  // 1. Active factor (0-1)
  const activeFactor = input.is_active ? 1.0 : 0.8;

  // 2. Duration factor (0-1, cap 180 дней)
  const durationFactor = Math.min(durationDays / 180, 1.0);

  // 3. Variations factor (0-1, cap 10 вариаций)
  const variations = input.ad_variations || 1;
  const variationsFactor = Math.min(variations / 10, 1.0);

  // 4. Format factor (0-1.1)
  let formatFactor = 0.5; // базовый для image
  if (input.media_type === 'video') {
    formatFactor = 1.0;
  } else if (input.media_type === 'carousel') {
    formatFactor = 0.85;
  }

  // Instagram бонус +0.1
  if (hasInstagram(input.platforms)) {
    formatFactor += 0.1;
  }

  // Итоговый score (каждый фактор × 25)
  const score = Math.round(
    25 * activeFactor +
    25 * durationFactor +
    25 * variationsFactor +
    25 * formatFactor
  );

  return {
    score: Math.min(score, 100), // cap на 100
    duration_days: durationDays,
    factors: {
      active: Math.round(25 * activeFactor),
      duration: Math.round(25 * durationFactor),
      variations: Math.round(25 * variationsFactor),
      format: Math.round(25 * formatFactor),
    }
  };
}

/**
 * Получить цвет/категорию для score
 */
export function getScoreCategory(score: number): {
  label: string;
  emoji: string;
  color: 'green' | 'yellow' | 'orange' | 'red' | 'gray';
} {
  if (score >= 95) {
    return { label: 'ELITE', emoji: '💎', color: 'green' };
  } else if (score >= 85) {
    return { label: 'TOP', emoji: '🔥', color: 'green' };
  } else if (score >= 70) {
    return { label: 'GOOD', emoji: '✅', color: 'yellow' };
  } else if (score >= 50) {
    return { label: 'OK', emoji: '🟡', color: 'orange' };
  } else {
    return { label: 'WEAK', emoji: '❌', color: 'red' };
  }
}

/**
 * Проверить, является ли креатив "новым" в ТОП-10 (< 7 дней)
 */
export function isNewInTop10(enteredTop10At: string | Date | null | undefined): boolean {
  if (!enteredTop10At) return false;

  const entered = new Date(enteredTop10At);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  return entered > weekAgo;
}
