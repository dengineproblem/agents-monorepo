/**
 * Cron job для еженедельного сбора ТОП-10 креативов конкурентов
 * Запускается каждое воскресенье в 03:00 UTC
 *
 * Логика:
 * 1. Получить до 200 активных креативов из SearchAPI
 * 2. Рассчитать score для каждого (0-100)
 * 3. Взять ТОП-10 по score
 * 4. Сравнить с текущим ТОП-10 в БД
 * 5. OCR только для новых в ТОП-10
 * 6. Лимит 50 креативов на конкурента (удаляем старые)
 */

import cron from 'node-cron';
import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { fetchCompetitorCreatives, type CompetitorCreativeData } from '../lib/searchApi.js';
import { calculateCreativeScore } from '../lib/competitorScoring.js';

const TOP_CREATIVES_LIMIT = 10;
const MAX_CREATIVES_PER_COMPETITOR = 50;

// ========================================
// TYPES
// ========================================

interface ScoredCreative extends CompetitorCreativeData {
  score: number;
  duration_days: number;
}

// ========================================
// HELPER FUNCTIONS
// ========================================

/**
 * Добавить score к креативам
 */
function scoreCreatives(creatives: CompetitorCreativeData[]): ScoredCreative[] {
  return creatives.map(creative => {
    const scoreResult = calculateCreativeScore({
      is_active: creative.is_active,
      first_shown_date: creative.first_shown_date,
      media_type: creative.media_type,
      ad_variations: creative.ad_variations,
      platforms: creative.platforms,
    });

    return {
      ...creative,
      score: scoreResult.score,
      duration_days: scoreResult.duration_days,
    };
  });
}

/**
 * Получить текущий ТОП-10 из БД
 */
async function getCurrentTop10(competitorId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from('competitor_creatives')
    .select('fb_ad_archive_id')
    .eq('competitor_id', competitorId)
    .eq('is_top10', true);

  return new Set((data || []).map(c => c.fb_ad_archive_id));
}

/**
 * Сохранить креативы с скорингом и ТОП-10 флагом
 */
async function saveCreativesWithScoring(
  competitorId: string,
  scoredCreatives: ScoredCreative[],
  currentTop10Ids: Set<string>,
  log: any
): Promise<{ found: number; newInTop10: number; upserted: number }> {
  // Сортируем по score и берём ТОП-10
  const sortedCreatives = [...scoredCreatives].sort((a, b) => b.score - a.score);
  const top10 = sortedCreatives.slice(0, TOP_CREATIVES_LIMIT);
  const top10Ids = new Set(top10.map(c => c.fb_ad_archive_id));

  let upsertedCount = 0;
  let newInTop10Count = 0;
  const now = new Date().toISOString();

  // 1. Сначала сбрасываем is_top10 для всех креативов этого конкурента
  await supabase
    .from('competitor_creatives')
    .update({ is_top10: false })
    .eq('competitor_id', competitorId);

  // 2. Upsert ТОП-10 креативов
  for (const creative of top10) {
    const isNewInTop = !currentTop10Ids.has(creative.fb_ad_archive_id);
    if (isNewInTop) {
      newInTop10Count++;
    }

    try {
      const { error } = await supabase
        .from('competitor_creatives')
        .upsert(
          {
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
            ad_variations: creative.ad_variations,
            raw_data: creative.raw_data,
            // Новые поля
            score: creative.score,
            duration_days: creative.duration_days,
            is_top10: true,
            entered_top10_at: isNewInTop ? now : undefined, // Только для новых в топе
            last_seen_at: now,
          },
          {
            onConflict: 'fb_ad_archive_id',
            ignoreDuplicates: false,
          }
        );

      if (!error) {
        upsertedCount++;
      }
    } catch (err) {
      log.warn({ err, adArchiveId: creative.fb_ad_archive_id }, 'Ошибка при сохранении креатива');
    }
  }

  // 3. Также сохраняем остальные креативы (не топ-10), но только до лимита 50
  const remainingCreatives = sortedCreatives.slice(TOP_CREATIVES_LIMIT);

  // Получаем текущее количество креативов
  const { count: currentCount } = await supabase
    .from('competitor_creatives')
    .select('*', { count: 'exact', head: true })
    .eq('competitor_id', competitorId);

  const availableSlots = MAX_CREATIVES_PER_COMPETITOR - (currentCount || 0);

  if (availableSlots > 0 && remainingCreatives.length > 0) {
    const creativesToAdd = remainingCreatives.slice(0, availableSlots);

    for (const creative of creativesToAdd) {
      try {
        await supabase
          .from('competitor_creatives')
          .upsert(
            {
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
              ad_variations: creative.ad_variations,
              raw_data: creative.raw_data,
              score: creative.score,
              duration_days: creative.duration_days,
              is_top10: false,
              last_seen_at: now,
            },
            {
              onConflict: 'fb_ad_archive_id',
              ignoreDuplicates: false,
            }
          );
        upsertedCount++;
      } catch (err) {
        // Игнорируем ошибки для не-топ креативов
      }
    }
  }

  return { found: scoredCreatives.length, newInTop10: newInTop10Count, upserted: upsertedCount };
}

/**
 * Очистить старые креативы если их больше лимита (50)
 */
async function cleanupOldCreatives(competitorId: string, log: any): Promise<number> {
  // Получаем все креативы, отсортированные по created_at
  const { data: allCreatives } = await supabase
    .from('competitor_creatives')
    .select('id, is_top10, created_at')
    .eq('competitor_id', competitorId)
    .order('created_at', { ascending: true });

  if (!allCreatives || allCreatives.length <= MAX_CREATIVES_PER_COMPETITOR) {
    return 0;
  }

  // Удаляем самые старые (НЕ из топ-10)
  const excessCount = allCreatives.length - MAX_CREATIVES_PER_COMPETITOR;
  const creativesToDelete = allCreatives
    .filter(c => !c.is_top10)
    .slice(0, excessCount);

  if (creativesToDelete.length === 0) {
    return 0;
  }

  const idsToDelete = creativesToDelete.map(c => c.id);

  // Удаляем записи анализа
  await supabase
    .from('competitor_creative_analysis')
    .delete()
    .in('creative_id', idsToDelete);

  // Удаляем креативы
  const { error } = await supabase
    .from('competitor_creatives')
    .delete()
    .in('id', idsToDelete);

  if (error) {
    log.warn({ error, competitorId }, 'Ошибка при очистке старых креативов');
    return 0;
  }

  log.info({ competitorId, deletedCount: idsToDelete.length }, 'Удалены старые креативы (лимит 50)');
  return idsToDelete.length;
}

/**
 * Создать записи анализа ТОЛЬКО для новых в ТОП-10
 */
async function createAnalysisForNewTop10(competitorId: string, log: any): Promise<number> {
  try {
    // Получаем ТОП-10 креативы без записей анализа
    const { data: top10Creatives } = await supabase
      .from('competitor_creatives')
      .select('id')
      .eq('competitor_id', competitorId)
      .eq('is_top10', true);

    if (!top10Creatives || top10Creatives.length === 0) return 0;

    const top10Ids = top10Creatives.map(c => c.id);

    // Проверяем какие уже есть
    const { data: existingAnalysis } = await supabase
      .from('competitor_creative_analysis')
      .select('creative_id')
      .in('creative_id', top10Ids);

    const existingIds = new Set((existingAnalysis || []).map(a => a.creative_id));
    const newCreativeIds = top10Ids.filter(id => !existingIds.has(id));

    if (newCreativeIds.length === 0) return 0;

    // Создаем записи для новых
    const analysisRecords = newCreativeIds.map(id => ({
      creative_id: id,
      processing_status: 'pending',
    }));

    await supabase.from('competitor_creative_analysis').insert(analysisRecords);

    log.info({ count: analysisRecords.length, competitorId }, 'Созданы записи анализа для новых ТОП-10 креативов');
    return analysisRecords.length;
  } catch (err) {
    log.warn({ err, competitorId }, 'Ошибка при создании записей анализа');
    return 0;
  }
}

/**
 * Обработать одного конкурента с логикой ТОП-10
 */
async function processCompetitor(
  competitor: { id: string; fb_page_id: string; country_code: string; name: string },
  log: any
): Promise<void> {
  const { id: competitorId, fb_page_id: pageId, country_code: country, name } = competitor;

  log.info({ competitorId, pageId, name }, 'Начинаем сбор ТОП-10 креативов');

  // Создаем запись crawl job
  const { data: job } = await supabase
    .from('competitor_crawl_jobs')
    .insert({
      competitor_id: competitorId,
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  const jobId = job?.id;

  try {
    // 1. Получаем текущий ТОП-10
    const currentTop10Ids = await getCurrentTop10(competitorId);

    // 2. Собираем креативы через SearchAPI (до 200)
    const creatives = await fetchCompetitorCreatives(pageId, country, { limit: 200 });

    // 3. Рассчитываем score
    const scoredCreatives = scoreCreatives(creatives);

    // 4. Сохраняем с ТОП-10 логикой
    const result = await saveCreativesWithScoring(competitorId, scoredCreatives, currentTop10Ids, log);

    // 5. Очищаем старые (если больше 50)
    const deleted = await cleanupOldCreatives(competitorId, log);

    // 6. Создаем записи анализа для новых в ТОП-10
    const analysisCreated = await createAnalysisForNewTop10(competitorId, log);

    // Обновляем job
    await supabase
      .from('competitor_crawl_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        creatives_found: result.found,
        creatives_new: result.newInTop10,
      })
      .eq('id', jobId);

    // Обновляем конкурента
    const { count: creativesCount } = await supabase
      .from('competitor_creatives')
      .select('*', { count: 'exact', head: true })
      .eq('competitor_id', competitorId);

    await supabase
      .from('competitors')
      .update({
        status: 'active',
        last_crawled_at: new Date().toISOString(),
        next_crawl_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // +7 дней
        creatives_count: creativesCount || 0,
        last_error: null,
      })
      .eq('id', competitorId);

    log.info({
      competitorId,
      name,
      found: result.found,
      newInTop10: result.newInTop10,
      upserted: result.upserted,
      deleted,
      analysisCreated,
    }, 'Сбор ТОП-10 креативов завершен');
  } catch (error: any) {
    log.error({ err: error, competitorId, name }, 'Ошибка сбора креативов');

    // Обновляем job с ошибкой
    await supabase
      .from('competitor_crawl_jobs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: error.message,
      })
      .eq('id', jobId);

    // Обновляем статус конкурента
    await supabase
      .from('competitors')
      .update({
        status: 'error',
        last_error: error.message,
      })
      .eq('id', competitorId);
  }
}

// ========================================
// MAIN CRON FUNCTION
// ========================================

export function startCompetitorCrawlerCron(app: FastifyInstance) {
  // Проверяем наличие API ключа
  if (!process.env.SEARCHAPI_KEY) {
    app.log.warn('SEARCHAPI_KEY не настроен, cron для сбора креативов конкурентов отключен');
    return;
  }

  app.log.info('📅 Competitor crawler cron started (ТОП-10 + лимит 50)');
  app.log.info('   - Weekly crawl: every Sunday at 03:00 UTC');
  app.log.info('   - Pending check: every 6 hours');

  // Каждое воскресенье в 03:00 UTC
  cron.schedule('0 3 * * 0', async () => {
    try {
      app.log.info('[CompetitorCron] Starting weekly ТОП-10 crawl...');

      // Получаем всех активных конкурентов, которым пора обновляться
      const { data: competitors, error } = await supabase
        .from('competitors')
        .select('id, fb_page_id, country_code, name')
        .in('status', ['active', 'pending'])
        .lte('next_crawl_at', new Date().toISOString());

      if (error) {
        app.log.error({ error }, '[CompetitorCron] Failed to fetch competitors');
        return;
      }

      if (!competitors || competitors.length === 0) {
        app.log.info('[CompetitorCron] No competitors to process');
        return;
      }

      app.log.info(`[CompetitorCron] Found ${competitors.length} competitor(s) to process`);

      // Обрабатываем последовательно с паузой между запросами
      for (const competitor of competitors) {
        await processCompetitor(competitor, app.log);

        // Пауза 2 секунды между конкурентами чтобы не перегружать API
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      app.log.info('[CompetitorCron] Weekly ТОП-10 crawl completed');
    } catch (error) {
      app.log.error({ error }, '[CompetitorCron] Cron job failed');
    }
  });

  // Также проверяем каждые 6 часов на случай если есть pending конкуренты
  cron.schedule('0 */6 * * *', async () => {
    try {
      const { data: pendingCompetitors, error } = await supabase
        .from('competitors')
        .select('id, fb_page_id, country_code, name')
        .eq('status', 'pending');

      if (error || !pendingCompetitors || pendingCompetitors.length === 0) {
        return;
      }

      app.log.info(`[CompetitorCron] Processing ${pendingCompetitors.length} pending competitor(s)`);

      for (const competitor of pendingCompetitors) {
        await processCompetitor(competitor, app.log);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (error) {
      app.log.error({ error }, '[CompetitorCron] Pending check failed');
    }
  });
}
