/**
 * Cron job для еженедельного сбора креативов конкурентов
 * Запускается каждое воскресенье в 03:00 UTC
 */

import cron from 'node-cron';
import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { fetchCompetitorCreatives, type CompetitorCreativeData } from '../lib/searchApi.js';

// ========================================
// HELPER FUNCTIONS
// ========================================

/**
 * Сохранить креативы в БД с дедупликацией
 */
async function saveCreatives(
  competitorId: string,
  creatives: CompetitorCreativeData[],
  log: any
): Promise<{ found: number; new: number }> {
  let newCount = 0;

  for (const creative of creatives) {
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
            raw_data: creative.raw_data,
          },
          {
            onConflict: 'fb_ad_archive_id',
            ignoreDuplicates: false,
          }
        );

      if (!error) {
        newCount++;
      }
    } catch (err) {
      log.warn({ err, adArchiveId: creative.fb_ad_archive_id }, 'Ошибка при сохранении креатива');
    }
  }

  return { found: creatives.length, new: newCount };
}

/**
 * Создать записи анализа для новых креативов
 */
async function createAnalysisRecords(competitorId: string, log: any): Promise<void> {
  try {
    // Получаем креативы без записей анализа
    const { data: creatives } = await supabase
      .from('competitor_creatives')
      .select('id')
      .eq('competitor_id', competitorId);

    if (!creatives || creatives.length === 0) return;

    const creativeIds = creatives.map(c => c.id);

    // Проверяем какие уже есть
    const { data: existingAnalysis } = await supabase
      .from('competitor_creative_analysis')
      .select('creative_id')
      .in('creative_id', creativeIds);

    const existingIds = new Set((existingAnalysis || []).map(a => a.creative_id));
    const newCreativeIds = creativeIds.filter(id => !existingIds.has(id));

    if (newCreativeIds.length === 0) return;

    // Создаем записи для новых
    const analysisRecords = newCreativeIds.map(id => ({
      creative_id: id,
      processing_status: 'pending',
    }));

    await supabase.from('competitor_creative_analysis').insert(analysisRecords);

    log.info({ count: analysisRecords.length, competitorId }, 'Созданы записи анализа для новых креативов');
  } catch (err) {
    log.warn({ err, competitorId }, 'Ошибка при создании записей анализа');
  }
}

/**
 * Обработать одного конкурента
 */
async function processCompetitor(
  competitor: { id: string; fb_page_id: string; country_code: string; name: string },
  log: any
): Promise<void> {
  const { id: competitorId, fb_page_id: pageId, country_code: country, name } = competitor;

  log.info({ competitorId, pageId, name }, 'Начинаем сбор креативов');

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
    // Собираем креативы через SearchAPI
    const creatives = await fetchCompetitorCreatives(pageId, country);
    const result = await saveCreatives(competitorId, creatives, log);

    // Обновляем job
    await supabase
      .from('competitor_crawl_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        creatives_found: result.found,
        creatives_new: result.new,
      })
      .eq('id', jobId);

    // Обновляем конкурента
    await supabase
      .from('competitors')
      .update({
        status: 'active',
        last_crawled_at: new Date().toISOString(),
        next_crawl_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // +7 дней
        creatives_count: result.found,
        last_error: null,
      })
      .eq('id', competitorId);

    // Создаем записи для анализа
    await createAnalysisRecords(competitorId, log);

    log.info({ competitorId, name, result }, 'Сбор креативов завершен');
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

  app.log.info('📅 Competitor crawler cron started (runs every Sunday at 03:00 UTC)');

  // Каждое воскресенье в 03:00 UTC
  // Формат: минуты часы день_месяца месяц день_недели
  // 0 = воскресенье
  cron.schedule('0 3 * * 0', async () => {
    try {
      app.log.info('[CompetitorCron] Starting weekly competitor crawl...');

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

      app.log.info('[CompetitorCron] Weekly crawl completed');
    } catch (error) {
      app.log.error({ error }, '[CompetitorCron] Cron job failed');
    }
  });

  // Также проверяем каждые 6 часов на случай если есть pending конкуренты
  // (новые конкуренты которые не успели получить креативы при добавлении)
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
