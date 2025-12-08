/**
 * Onboarding Helper
 *
 * Вспомогательные функции для автоматического обновления этапов онбординга
 *
 * @module lib/onboardingHelper
 */

import { supabase } from './supabase.js';
import { createLogger } from './logger.js';

const logger = createLogger({ module: 'onboardingHelper' });

// =====================================================
// Types
// =====================================================

type OnboardingStage =
  | 'registered'
  | 'fb_pending'
  | 'fb_connected'
  | 'direction_created'
  | 'creative_created'
  | 'ads_launched'
  | 'first_report'
  | 'roi_configured'
  | 'active'
  | 'inactive';

type OnboardingTag =
  | 'tiktok_connected'
  | 'generated_image'
  | 'generated_carousel'
  | 'generated_text'
  | 'added_competitors'
  | 'added_audience'
  | 'used_creative_test'
  | 'used_llm_analysis';

// Порядок этапов (для проверки прогресса)
const STAGE_ORDER: OnboardingStage[] = [
  'registered',
  'fb_pending',
  'fb_connected',
  'direction_created',
  'creative_created',
  'ads_launched',
  'first_report',
  'roi_configured',
  'active',
  'inactive'
];

// =====================================================
// Helper Functions
// =====================================================

/**
 * Проверяет, является ли новый этап прогрессом относительно текущего
 * (не позволяет откатываться назад, кроме inactive)
 */
function isProgressStage(currentStage: string | null, newStage: OnboardingStage): boolean {
  if (!currentStage) return true;
  if (newStage === 'inactive' || newStage === 'active') return true;

  const currentIndex = STAGE_ORDER.indexOf(currentStage as OnboardingStage);
  const newIndex = STAGE_ORDER.indexOf(newStage);

  // Позволяем переход только вперёд
  return newIndex > currentIndex;
}

/**
 * Записывает изменение этапа в историю
 */
async function logStageChange(
  userId: string,
  stageFrom: string | null,
  stageTo: string,
  reason?: string
): Promise<void> {
  try {
    await supabase.from('onboarding_history').insert({
      user_account_id: userId,
      stage_from: stageFrom,
      stage_to: stageTo,
      changed_by: null, // Автоматическое изменение
      change_reason: reason || 'Автоматическое обновление'
    });
  } catch (err) {
    logger.error({ error: String(err), userId }, 'Failed to log stage change');
  }
}

// =====================================================
// Public API
// =====================================================

/**
 * Обновляет этап онбординга пользователя
 * Не позволяет откатываться назад (кроме inactive/active)
 */
export async function updateOnboardingStage(
  userId: string,
  newStage: OnboardingStage,
  reason?: string
): Promise<boolean> {
  try {
    // Получаем текущий этап
    const { data: user, error: fetchError } = await supabase
      .from('user_accounts')
      .select('onboarding_stage, is_tech_admin')
      .eq('id', userId)
      .single();

    if (fetchError || !user) {
      logger.error({ error: fetchError?.message, userId }, 'User not found for stage update');
      return false;
    }

    // Не обновляем этап для техадминов
    if (user.is_tech_admin) {
      return false;
    }

    const currentStage = user.onboarding_stage;

    // Проверяем, является ли это прогрессом
    if (!isProgressStage(currentStage, newStage)) {
      logger.debug({
        userId,
        currentStage,
        newStage
      }, 'Skipping stage update - not a progress');
      return false;
    }

    // Обновляем этап
    const { error: updateError } = await supabase
      .from('user_accounts')
      .update({
        onboarding_stage: newStage,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (updateError) {
      logger.error({ error: updateError.message, userId, newStage }, 'Failed to update stage');
      return false;
    }

    // Логируем изменение
    await logStageChange(userId, currentStage, newStage, reason);

    logger.info({ userId, stageFrom: currentStage, stageTo: newStage }, 'Onboarding stage updated');
    return true;
  } catch (err) {
    logger.error({ error: String(err), userId, newStage }, 'Exception in updateOnboardingStage');
    return false;
  }
}

/**
 * Добавляет тег пользователю (если его ещё нет)
 */
export async function addOnboardingTag(
  userId: string,
  tag: OnboardingTag
): Promise<boolean> {
  try {
    // Получаем текущие теги
    const { data: user, error: fetchError } = await supabase
      .from('user_accounts')
      .select('onboarding_tags, is_tech_admin')
      .eq('id', userId)
      .single();

    if (fetchError || !user) {
      logger.error({ error: fetchError?.message, userId }, 'User not found for tag update');
      return false;
    }

    // Не обновляем теги для техадминов
    if (user.is_tech_admin) {
      return false;
    }

    const currentTags: string[] = user.onboarding_tags || [];

    // Проверяем, есть ли уже такой тег
    if (currentTags.includes(tag)) {
      return false;
    }

    // Добавляем тег
    const newTags = [...currentTags, tag];

    const { error: updateError } = await supabase
      .from('user_accounts')
      .update({
        onboarding_tags: newTags,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (updateError) {
      logger.error({ error: updateError.message, userId, tag }, 'Failed to add tag');
      return false;
    }

    logger.info({ userId, tag }, 'Onboarding tag added');
    return true;
  } catch (err) {
    logger.error({ error: String(err), userId, tag }, 'Exception in addOnboardingTag');
    return false;
  }
}

/**
 * Обновляет этап при создании направления
 */
export async function onDirectionCreated(userId: string): Promise<void> {
  await updateOnboardingStage(userId, 'direction_created', 'Создано направление');
}

/**
 * Обновляет этап при создании/загрузке креатива
 */
export async function onCreativeCreated(userId: string): Promise<void> {
  await updateOnboardingStage(userId, 'creative_created', 'Создан креатив');
}

/**
 * Обновляет этап при запуске рекламы
 */
export async function onAdsLaunched(userId: string): Promise<void> {
  await updateOnboardingStage(userId, 'ads_launched', 'Запущена реклама');
}

/**
 * Обновляет этап при получении первого отчёта
 */
export async function onFirstReport(userId: string): Promise<void> {
  await updateOnboardingStage(userId, 'first_report', 'Получен первый отчёт');
}

/**
 * Обновляет этап при настройке ROI
 */
export async function onROIConfigured(userId: string): Promise<void> {
  await updateOnboardingStage(userId, 'roi_configured', 'Настроена ROI аналитика');
}

/**
 * Добавляет теги при генерации креативов
 */
export async function onCreativeGenerated(
  userId: string,
  type: 'image' | 'carousel' | 'text'
): Promise<void> {
  const tagMap: Record<string, OnboardingTag> = {
    image: 'generated_image',
    carousel: 'generated_carousel',
    text: 'generated_text'
  };

  const tag = tagMap[type];
  if (tag) {
    await addOnboardingTag(userId, tag);
  }
}

/**
 * Добавляет тег при подключении TikTok
 */
export async function onTikTokConnected(userId: string): Promise<void> {
  await addOnboardingTag(userId, 'tiktok_connected');
}

/**
 * Добавляет тег при добавлении конкурентов
 */
export async function onCompetitorsAdded(userId: string): Promise<void> {
  await addOnboardingTag(userId, 'added_competitors');
}

/**
 * Добавляет тег при запуске быстрого теста креатива
 */
export async function onCreativeTestLaunched(userId: string): Promise<void> {
  await addOnboardingTag(userId, 'used_creative_test');
}

/**
 * Добавляет тег при использовании LLM анализа креатива
 */
export async function onLLMAnalysisUsed(userId: string): Promise<void> {
  await addOnboardingTag(userId, 'used_llm_analysis');
}
