import { supabase } from './supabase.js';
import { searchPageByInstagram, fetchCompetitorCreatives } from './apifyAdLibrary.js';
import { createLogger } from './logger.js';

const log = createLogger({ module: 'competitorSync' });

/**
 * Синхронизирует конкурентов из брифа в раздел конкурентов.
 * Добавляет Instagram аккаунты как конкурентов с автоматическим сбором креативов.
 */
export async function syncCompetitorsFromBriefing(
  userId: string,
  instagramHandles: string[],
  reqLog: typeof log = log,
  accountId?: string | null
): Promise<void> {
  reqLog.info({ userId, handles: instagramHandles }, 'Начинаем синхронизацию конкурентов из брифа');

  for (const handle of instagramHandles) {
    try {
      // 1. Ищем страницу по Instagram handle
      const pages = await searchPageByInstagram(handle, 'KZ');

      if (pages.length === 0) {
        reqLog.warn({ handle }, 'Страница не найдена по Instagram handle');
        continue;
      }

      const page = pages[0];
      const pageId = page.page_id;
      const pageName = page.page_name || handle;

      // 2. Проверяем, существует ли конкурент глобально
      let competitorId: string;
      const { data: existingCompetitor } = await supabase
        .from('competitors')
        .select('id')
        .eq('fb_page_id', pageId)
        .single();

      if (existingCompetitor) {
        competitorId = existingCompetitor.id;
      } else {
        const { data: newCompetitor, error: createError } = await supabase
          .from('competitors')
          .insert({
            fb_page_id: pageId,
            fb_page_url: `https://instagram.com/${handle}`,
            name: pageName,
            avatar_url: page.avatar_url,
            country_code: 'KZ',
            status: 'pending',
          })
          .select('id')
          .single();

        if (createError) {
          reqLog.warn({ err: createError, handle }, 'Ошибка создания конкурента');
          continue;
        }
        competitorId = newCompetitor.id;
      }

      // 3. Проверяем связь пользователь-конкурент
      const { data: existingLink } = await supabase
        .from('user_competitors')
        .select('id, is_active')
        .eq('user_account_id', userId)
        .eq('competitor_id', competitorId)
        .single();

      if (existingLink) {
        if (!existingLink.is_active) {
          await supabase
            .from('user_competitors')
            .update({ is_active: true })
            .eq('id', existingLink.id);
        }
      } else {
        await supabase
          .from('user_competitors')
          .insert({
            user_account_id: userId,
            account_id: accountId || null,
            competitor_id: competitorId,
            display_name: pageName,
          });
      }

      // 4. Запускаем сбор креативов (async, не блокируем)
      fetchCompetitorCreatives(handle, 'KZ', { targetPageId: pageId, limit: 50 })
        .then(async (creatives) => {
          if (creatives.length > 0) {
            for (const creative of creatives.slice(0, 10)) {
              await supabase
                .from('competitor_creatives')
                .upsert({
                  competitor_id: competitorId,
                  fb_ad_archive_id: creative.fb_ad_archive_id,
                  media_type: creative.media_type,
                  media_urls: creative.media_urls,
                  thumbnail_url: creative.thumbnail_url,
                  body_text: creative.body_text,
                  headline: creative.headline,
                  cta_type: creative.cta_type,
                  platforms: creative.platforms,
                  first_shown_date: creative.first_shown_date,
                  is_active: creative.is_active,
                  is_top10: true,
                  last_seen_at: new Date().toISOString(),
                }, { onConflict: 'fb_ad_archive_id' });
            }

            await supabase
              .from('competitors')
              .update({
                status: 'active',
                last_crawled_at: new Date().toISOString(),
                creatives_count: creatives.length,
              })
              .eq('id', competitorId);
          }
          reqLog.info({ handle, competitorId, creativesCount: creatives.length }, 'Креативы конкурента собраны');
        })
        .catch(err => reqLog.warn({ err, handle }, 'Ошибка сбора креативов конкурента'));

      reqLog.info({ handle, competitorId }, 'Конкурент из брифа добавлен');

    } catch (err) {
      reqLog.warn({ err, handle }, 'Ошибка обработки конкурента из брифа');
    }
  }
}
