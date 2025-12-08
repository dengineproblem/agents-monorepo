/**
 * Onboarding Tags Helper
 *
 * Упрощённая версия для добавления тегов онбординга при генерации креативов.
 * Используется в creative-generation-service для отслеживания:
 * - generated_image
 * - generated_carousel
 * - generated_text
 *
 * @module lib/onboardingTags
 */

import { getSupabaseClient } from '../db/supabase.js';

type OnboardingTag = 'generated_image' | 'generated_carousel' | 'generated_text';

/**
 * Добавляет тег онбординга пользователю (если его ещё нет)
 */
export async function addOnboardingTag(userId: string, tag: OnboardingTag): Promise<void> {
  try {
    const supabase = getSupabaseClient();

    // Получаем текущие теги пользователя
    const { data: user, error: fetchError } = await supabase
      .from('user_accounts')
      .select('onboarding_tags, is_tech_admin')
      .eq('id', userId)
      .single();

    if (fetchError || !user) {
      console.warn(`[onboardingTags] User not found: ${userId}`);
      return;
    }

    // Не обновляем теги для техадминов
    if (user.is_tech_admin) {
      return;
    }

    const currentTags: string[] = user.onboarding_tags || [];

    // Проверяем, есть ли уже такой тег
    if (currentTags.includes(tag)) {
      return;
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
      console.error(`[onboardingTags] Failed to add tag ${tag} for user ${userId}:`, updateError.message);
      return;
    }

    console.log(`[onboardingTags] Added tag '${tag}' for user ${userId}`);
  } catch (err) {
    console.error(`[onboardingTags] Exception adding tag ${tag} for user ${userId}:`, err);
  }
}
