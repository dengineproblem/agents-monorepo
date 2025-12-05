import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import {
  extractPageIdFromUrl,
  extractInstagramHandle,
  isInstagramUrl,
  fetchCompetitorCreatives,
  searchPageByName,
  searchPageByInstagram,
  transformAdToCreativeData,
  refreshCreativeMediaUrl,
  type CompetitorCreativeData,
} from '../lib/searchApi.js';
import { calculateCreativeScore } from '../lib/competitorScoring.js';
import { processVideoTranscription } from '../lib/transcription.js';
import { createWriteStream, promises as fs } from 'fs';
import { pipeline } from 'stream/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const TOP_CREATIVES_LIMIT = 10;
const MAX_CREATIVES_PER_COMPETITOR = 50;

const log = createLogger({ module: 'competitorsRoutes' });

// ========================================
// VALIDATION SCHEMAS
// ========================================

const AddCompetitorSchema = z.object({
  userAccountId: z.string().uuid(),
  accountId: z.string().uuid().optional(), // UUID рекламного аккаунта для мультиаккаунтности
  // Принимаем Facebook URL, Instagram URL, @handle или просто username
  socialUrl: z.string().min(1).refine(
    url => {
      const normalized = url.trim().toLowerCase();
      // Facebook URLs
      if (normalized.includes('facebook.com') || normalized.includes('fb.com')) {
        return true;
      }
      // Instagram URLs
      if (normalized.includes('instagram.com')) {
        return true;
      }
      // @username формат
      if (normalized.startsWith('@')) {
        return true;
      }
      // Просто username (буквы, цифры, точки, подчёркивания — как в Instagram)
      if (/^[a-z0-9._]+$/i.test(normalized) && normalized.length >= 2) {
        return true;
      }
      return false;
    },
    'Введите ссылку на Facebook, Instagram или username'
  ),
  name: z.string().min(1).max(200),
  countryCode: z.string().min(2).max(3).default('KZ'), // 2 символа для стран (KZ, RU) или 3 для ALL
});

const GetCompetitorsQuerySchema = z.object({
  userAccountId: z.string().uuid(),
  accountId: z.string().uuid().optional(), // UUID рекламного аккаунта для мультиаккаунтности
});

const GetCreativesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  mediaType: z.enum(['video', 'image', 'carousel', 'all']).default('all'),
  top10Only: z.coerce.boolean().default(false), // Показывать все креативы по умолчанию
  includeAll: z.coerce.boolean().default(true), // Показать все креативы (до 100)
});

const DeleteCompetitorSchema = z.object({
  userAccountId: z.string().uuid(),
});

type AddCompetitorInput = z.infer<typeof AddCompetitorSchema>;

// ========================================
// HELPER FUNCTIONS
// ========================================

interface ScoredCreative extends CompetitorCreativeData {
  score: number;
  duration_days: number;
}

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
 * Сохранить креативы в БД с расчетом score и ТОП-10 флагом
 */
async function saveCreativesWithScoring(
  competitorId: string,
  creatives: CompetitorCreativeData[]
): Promise<{ found: number; new: number; newInTop10: number }> {
  // Рассчитываем score
  const scoredCreatives = scoreCreatives(creatives);

  // Получаем текущий ТОП-10
  const currentTop10Ids = await getCurrentTop10(competitorId);

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
            // Поля скоринга
            score: creative.score,
            duration_days: creative.duration_days,
            is_top10: true,
            entered_top10_at: isNewInTop ? now : undefined,
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

  log.info({
    competitorId,
    found: creatives.length,
    upserted: upsertedCount,
    newInTop10: newInTop10Count,
    top10Scores: top10.map(c => c.score),
  }, 'Скоринг креативов завершен');

  return { found: creatives.length, new: upsertedCount, newInTop10: newInTop10Count };
}

/**
 * Создать запись анализа для новых креативов
 */
async function createAnalysisRecords(competitorId: string): Promise<void> {
  // Находим креативы без записей в competitor_creative_analysis
  const { data: creativesWithoutAnalysis } = await supabase
    .from('competitor_creatives')
    .select('id')
    .eq('competitor_id', competitorId)
    .not('id', 'in', supabase
      .from('competitor_creative_analysis')
      .select('creative_id')
    );

  if (!creativesWithoutAnalysis || creativesWithoutAnalysis.length === 0) {
    return;
  }

  // Создаем записи анализа для новых креативов
  const analysisRecords = creativesWithoutAnalysis.map(c => ({
    creative_id: c.id,
    processing_status: 'pending',
  }));

  await supabase.from('competitor_creative_analysis').insert(analysisRecords);

  log.info({ count: analysisRecords.length, competitorId }, 'Созданы записи анализа для новых креативов');
}

/**
 * Фоновая обработка pending креативов (OCR/транскрипция)
 * Запускается асинхронно, не блокирует основной поток
 */
async function processPendingAnalysis(competitorId?: string): Promise<void> {
  try {
    // Получаем pending креативы
    let query = supabase
      .from('competitor_creative_analysis')
      .select('creative_id, competitor_creatives!inner(id, media_type, media_urls, thumbnail_url)')
      .eq('processing_status', 'pending')
      .limit(10); // Обрабатываем по 10 за раз

    if (competitorId) {
      query = query.eq('competitor_creatives.competitor_id', competitorId);
    }

    const { data: pendingAnalysis, error } = await query;

    if (error || !pendingAnalysis || pendingAnalysis.length === 0) {
      return;
    }

    log.info({ count: pendingAnalysis.length, competitorId }, '[Batch Analysis] Начинаем обработку pending креативов');

    for (const analysis of pendingAnalysis) {
      const creative = analysis.competitor_creatives as any;
      if (!creative) continue;

      const creativeId = creative.id;

      try {
        // Отмечаем как processing
        await supabase
          .from('competitor_creative_analysis')
          .update({ processing_status: 'processing' })
          .eq('creative_id', creativeId);

        let extractedText = '';
        const mediaUrl = creative.thumbnail_url || creative.media_urls?.[0];

        if (!mediaUrl) {
          await supabase
            .from('competitor_creative_analysis')
            .update({ processing_status: 'failed' })
            .eq('creative_id', creativeId);
          continue;
        }

        if (creative.media_type === 'image' || creative.media_type === 'carousel') {
          // OCR через creative-generation-service
          const ocrResponse = await fetch('http://creative-generation-service:8085/ocr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_url: mediaUrl, image_type: 'url' }),
          });

          if (ocrResponse.ok) {
            const ocrResult = await ocrResponse.json() as { success: boolean; text?: string };
            extractedText = ocrResult.text || '';
          }

        } else if (creative.media_type === 'video') {
          // Транскрибация видео
          const videoUrl = creative.media_urls?.[0];
          if (videoUrl) {
            let videoPath: string | null = null;
            try {
              videoPath = path.join('/var/tmp', `competitor_video_${randomUUID()}.mp4`);

              const videoResponse = await fetch(videoUrl);
              if (videoResponse.ok && videoResponse.body) {
                const writeStream = createWriteStream(videoPath);
                const reader = videoResponse.body.getReader();
                const nodeStream = new (await import('stream')).Readable({
                  async read() {
                    const { done, value } = await reader.read();
                    if (done) {
                      this.push(null);
                    } else {
                      this.push(Buffer.from(value));
                    }
                  }
                });

                await pipeline(nodeStream, writeStream);
                const transcription = await processVideoTranscription(videoPath, 'ru');
                extractedText = transcription.text;
              }
            } finally {
              if (videoPath) {
                try {
                  await fs.unlink(videoPath);
                } catch {}
              }
            }
          }
        }

        // Сохраняем результат
        await supabase
          .from('competitor_creative_analysis')
          .update({
            ocr_text: creative.media_type !== 'video' ? extractedText : null,
            transcript: creative.media_type === 'video' ? extractedText : null,
            processing_status: 'completed',
          })
          .eq('creative_id', creativeId);

        log.info({ creativeId, textLength: extractedText.length }, '[Batch Analysis] Креатив обработан');

        // Пауза между обработками чтобы не перегружать сервисы
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (err) {
        log.warn({ err, creativeId }, '[Batch Analysis] Ошибка обработки креатива');
        await supabase
          .from('competitor_creative_analysis')
          .update({ processing_status: 'failed' })
          .eq('creative_id', creativeId);
      }
    }

    log.info({ count: pendingAnalysis.length, competitorId }, '[Batch Analysis] Обработка завершена');

  } catch (err) {
    log.error({ err }, '[Batch Analysis] Ошибка batch-обработки');
  }
}

// ========================================
// ROUTES
// ========================================

export default async function competitorsRoutes(app: FastifyInstance) {
  /**
   * GET /competitors - Список конкурентов пользователя
   */
  app.get('/competitors', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = GetCompetitorsQuerySchema.parse(request.query);

      let dbQuery = supabase
        .from('user_competitors')
        .select(`
          id,
          display_name,
          is_favorite,
          is_active,
          created_at,
          account_id,
          competitor:competitors (
            id,
            fb_page_id,
            fb_page_url,
            name,
            avatar_url,
            country_code,
            status,
            last_crawled_at,
            creatives_count
          )
        `)
        .eq('user_account_id', query.userAccountId)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      // Фильтр по account_id для мультиаккаунтности
      if (query.accountId) {
        dbQuery = dbQuery.eq('account_id', query.accountId);
      }

      const { data, error } = await dbQuery;

      if (error) {
        log.error({ err: error, userAccountId: query.userAccountId }, 'Ошибка получения конкурентов');
        return reply.status(500).send({ success: false, error: error.message });
      }

      // Преобразуем в плоский формат
      const competitors = (data || []).map(uc => ({
        user_competitor_id: uc.id,
        display_name: uc.display_name,
        is_favorite: uc.is_favorite,
        created_at: uc.created_at,
        ...uc.competitor,
      }));

      return reply.send({ success: true, competitors });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ success: false, error: error.errors[0].message });
      }
      log.error({ err: error }, 'Ошибка в GET /competitors');
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  /**
   * POST /competitors - Добавить конкурента
   */
  app.post('/competitors', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const input = AddCompetitorSchema.parse(request.body);

      log.info({ userAccountId: input.userAccountId, socialUrl: input.socialUrl }, 'Добавление конкурента');

      let pageId: string | null = null;
      let pageName: string | null = null;
      let avatarUrl: string | undefined;

      // 1. Определяем тип ссылки и извлекаем page_id
      if (isInstagramUrl(input.socialUrl)) {
        // Instagram URL или @handle
        const igHandle = extractInstagramHandle(input.socialUrl);

        if (igHandle) {
          log.info({ igHandle }, 'Поиск страницы по Instagram handle');
          const pages = await searchPageByInstagram(igHandle, input.countryCode);

          if (pages.length > 0) {
            pageId = pages[0].page_id;
            pageName = pages[0].page_name;
            avatarUrl = pages[0].avatar_url;
            log.info({ pageId, pageName }, 'Найдена страница по Instagram');
          }
        }
      } else {
        // Facebook URL
        pageId = extractPageIdFromUrl(input.socialUrl);
      }

      // Fallback: поиск по имени
      if (!pageId) {
        log.info({ name: input.name }, 'Не удалось извлечь page_id, пробуем поиск по имени');
        const pages = await searchPageByName(input.name, input.countryCode);
        if (pages.length > 0) {
          pageId = pages[0].page_id;
          pageName = pages[0].page_name;
          avatarUrl = pages[0].avatar_url;
        }
      }

      if (!pageId) {
        return reply.status(400).send({
          success: false,
          error: 'Не удалось найти страницу. Проверьте ссылку или попробуйте другой аккаунт.',
        });
      }

      // 2. Проверяем, существует ли уже такой конкурент глобально
      let competitorId: string;
      const { data: existingCompetitor } = await supabase
        .from('competitors')
        .select('id')
        .eq('fb_page_id', pageId)
        .single();

      if (existingCompetitor) {
        competitorId = existingCompetitor.id;
        log.info({ competitorId, pageId }, 'Конкурент уже существует в глобальной таблице');
      } else {
        // Создаем нового конкурента
        const { data: newCompetitor, error: createError } = await supabase
          .from('competitors')
          .insert({
            fb_page_id: pageId,
            fb_page_url: input.socialUrl,
            name: input.name,
            avatar_url: avatarUrl,
            country_code: input.countryCode,
            status: 'pending',
          })
          .select('id')
          .single();

        if (createError) {
          log.error({ err: createError, pageId }, 'Ошибка создания конкурента');
          return reply.status(500).send({ success: false, error: createError.message });
        }

        competitorId = newCompetitor.id;
        log.info({ competitorId, pageId }, 'Создан новый конкурент');
      }

      // 3. Проверяем, не связан ли уже этот конкурент с пользователем
      // В мультиаккаунтном режиме проверяем user_account_id + competitor_id + account_id
      // В legacy режиме (без account_id) проверяем только user_account_id + competitor_id
      let existingLinkQuery = supabase
        .from('user_competitors')
        .select('id, is_active')
        .eq('user_account_id', input.userAccountId)
        .eq('competitor_id', competitorId);

      if (input.accountId) {
        existingLinkQuery = existingLinkQuery.eq('account_id', input.accountId);
      } else {
        existingLinkQuery = existingLinkQuery.is('account_id', null);
      }

      const { data: existingLink } = await existingLinkQuery.single();

      if (existingLink) {
        if (existingLink.is_active) {
          return reply.status(409).send({
            success: false,
            error: 'Этот конкурент уже добавлен',
          });
        } else {
          // Реактивируем связь
          await supabase
            .from('user_competitors')
            .update({ is_active: true })
            .eq('id', existingLink.id);

          log.info({ userCompetitorId: existingLink.id }, 'Связь с конкурентом реактивирована');
        }
      } else {
        // Создаем связь пользователь-конкурент
        const { error: linkError } = await supabase
          .from('user_competitors')
          .insert({
            user_account_id: input.userAccountId,
            account_id: input.accountId || null,  // UUID для мультиаккаунтности, NULL для legacy
            competitor_id: competitorId,
            display_name: input.name,
          });

        if (linkError) {
          log.error({ err: linkError, userAccountId: input.userAccountId, competitorId }, 'Ошибка создания связи');
          return reply.status(500).send({ success: false, error: linkError.message });
        }
      }

      // 4. Запускаем первичный сбор креативов (async, не блокируем ответ)
      // Определяем поисковый запрос: Instagram handle имеет приоритет
      let searchQuery = pageName || input.name;
      if (isInstagramUrl(input.socialUrl)) {
        const igHandle = extractInstagramHandle(input.socialUrl);
        if (igHandle) {
          searchQuery = igHandle;
        }
      }
      try {
        const creatives = await fetchCompetitorCreatives(searchQuery, input.countryCode, { targetPageId: pageId, limit: 50 });
        const result = await saveCreativesWithScoring(competitorId, creatives);

        // Считаем реальное количество креативов в БД
        const { count: actualCount } = await supabase
          .from('competitor_creatives')
          .select('*', { count: 'exact', head: true })
          .eq('competitor_id', competitorId);

        // Обновляем статус и счетчик
        await supabase
          .from('competitors')
          .update({
            status: 'active',
            last_crawled_at: new Date().toISOString(),
            next_crawl_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // +7 дней
            creatives_count: actualCount || 0,
          })
          .eq('id', competitorId);

        // Создаем записи для анализа
        await createAnalysisRecords(competitorId);

        // Запускаем фоновую обработку (OCR/транскрипция)
        processPendingAnalysis(competitorId).catch(err =>
          log.warn({ err, competitorId }, 'Ошибка фоновой обработки анализа')
        );

        log.info({ competitorId, pageId, creativesFound: result.found }, 'Первичный сбор креативов завершен');
      } catch (crawlError: any) {
        log.warn({ err: crawlError, competitorId }, 'Ошибка первичного сбора, конкурент добавлен со статусом pending');
        // Не прерываем - конкурент добавлен, сбор будет повторен cron'ом
      }

      // 5. Получаем полные данные для ответа
      const { data: competitor } = await supabase
        .from('competitors')
        .select('*')
        .eq('id', competitorId)
        .single();

      return reply.status(201).send({
        success: true,
        competitor: {
          ...competitor,
          user_competitor_id: competitorId, // TODO: вернуть реальный id из user_competitors
        },
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ success: false, error: error.errors[0].message });
      }
      log.error({ err: error }, 'Ошибка в POST /competitors');
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  /**
   * DELETE /competitors/:userCompetitorId - Удалить связь с конкурентом
   */
  app.delete('/competitors/:userCompetitorId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userCompetitorId } = request.params as { userCompetitorId: string };
      const query = DeleteCompetitorSchema.parse(request.query);

      // Мягкое удаление - просто деактивируем связь
      const { error } = await supabase
        .from('user_competitors')
        .update({ is_active: false })
        .eq('id', userCompetitorId)
        .eq('user_account_id', query.userAccountId);

      if (error) {
        log.error({ err: error, userCompetitorId }, 'Ошибка удаления связи с конкурентом');
        return reply.status(500).send({ success: false, error: error.message });
      }

      log.info({ userCompetitorId, userAccountId: query.userAccountId }, 'Связь с конкурентом удалена');
      return reply.send({ success: true });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ success: false, error: error.errors[0].message });
      }
      log.error({ err: error }, 'Ошибка в DELETE /competitors/:id');
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  /**
   * POST /competitors/:competitorId/refresh - Ручное обновление креативов
   */
  app.post('/competitors/:competitorId/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { competitorId } = request.params as { competitorId: string };

      // Получаем данные конкурента
      const { data: competitor, error: fetchError } = await supabase
        .from('competitors')
        .select('fb_page_id, fb_page_url, name, country_code, last_crawled_at')
        .eq('id', competitorId)
        .single();

      if (fetchError || !competitor) {
        return reply.status(404).send({ success: false, error: 'Конкурент не найден' });
      }

      // Rate limit отключен для разработки
      // TODO: включить в production
      // if (competitor.last_crawled_at) {
      //   const lastCrawl = new Date(competitor.last_crawled_at);
      //   const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
      //   if (lastCrawl > hourAgo) {
      //     const nextAllowed = new Date(lastCrawl.getTime() + 60 * 60 * 1000);
      //     return reply.status(429).send({
      //       success: false,
      //       error: 'Слишком частые обновления. Попробуйте позже.',
      //       nextAllowedAt: nextAllowed.toISOString(),
      //     });
      //   }
      // }

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

      try {
        // Определяем поисковый запрос: Instagram handle или имя страницы
        let searchQuery = competitor.name;
        if (competitor.fb_page_url && isInstagramUrl(competitor.fb_page_url)) {
          const igHandle = extractInstagramHandle(competitor.fb_page_url);
          if (igHandle) {
            searchQuery = igHandle;
          }
        }

        // Собираем креативы (используем IG handle или имя для поиска, page_id для фильтрации)
        const creatives = await fetchCompetitorCreatives(
          searchQuery,
          competitor.country_code,
          { targetPageId: competitor.fb_page_id, limit: 50 }
        );
        const result = await saveCreativesWithScoring(competitorId, creatives);

        // Обновляем job
        await supabase
          .from('competitor_crawl_jobs')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            creatives_found: result.found,
            creatives_new: result.new,
          })
          .eq('id', job?.id);

        // Считаем реальное количество креативов в БД
        const { count: actualCount } = await supabase
          .from('competitor_creatives')
          .select('*', { count: 'exact', head: true })
          .eq('competitor_id', competitorId);

        // Обновляем конкурента
        await supabase
          .from('competitors')
          .update({
            status: 'active',
            last_crawled_at: new Date().toISOString(),
            next_crawl_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            creatives_count: actualCount || 0,
            last_error: null,
          })
          .eq('id', competitorId);

        // Создаем записи для анализа новых креативов
        await createAnalysisRecords(competitorId);

        // Запускаем фоновую обработку (OCR/транскрипция)
        processPendingAnalysis(competitorId).catch(err =>
          log.warn({ err, competitorId }, 'Ошибка фоновой обработки анализа')
        );

        log.info({ competitorId, result, actualCount }, 'Обновление креативов завершено');

        return reply.send({
          success: true,
          result: {
            creatives_found: actualCount || 0, // Реальное количество в БД
            creatives_new: result.newInTop10,  // Новые в TOP-10
          },
        });
      } catch (crawlError: any) {
        // Обновляем job с ошибкой
        await supabase
          .from('competitor_crawl_jobs')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_message: crawlError.message,
          })
          .eq('id', job?.id);

        // Обновляем статус конкурента
        await supabase
          .from('competitors')
          .update({
            status: 'error',
            last_error: crawlError.message,
          })
          .eq('id', competitorId);

        log.error({ err: crawlError, competitorId }, 'Ошибка обновления креативов');
        return reply.status(500).send({ success: false, error: crawlError.message });
      }
    } catch (error: any) {
      log.error({ err: error }, 'Ошибка в POST /competitors/:id/refresh');
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  /**
   * GET /competitors/:competitorId/creatives - Список креативов конкурента
   *
   * Query params:
   * - top10Only: false (default) - показать все креативы
   * - includeAll: true (default) - показать все креативы (до 50)
   * - mediaType: video | image | carousel | all
   */
  app.get('/competitors/:competitorId/creatives', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { competitorId } = request.params as { competitorId: string };
      const query = GetCreativesQuerySchema.parse(request.query);

      const offset = (query.page - 1) * query.limit;

      let dbQuery = supabase
        .from('competitor_creatives')
        .select(`
          *,
          analysis:competitor_creative_analysis (
            transcript,
            ocr_text,
            processing_status
          )
        `, { count: 'exact' })
        .eq('competitor_id', competitorId)
        .order('score', { ascending: false, nullsFirst: false }) // Сортировка по score
        .order('created_at', { ascending: false }) // Вторичная сортировка
        .range(offset, offset + query.limit - 1);

      // Фильтр ТОП-10 (если не запрошены все)
      if (query.top10Only && !query.includeAll) {
        dbQuery = dbQuery.eq('is_top10', true);
      }

      // Фильтр по типу медиа
      if (query.mediaType !== 'all') {
        dbQuery = dbQuery.eq('media_type', query.mediaType);
      }

      const { data, error, count } = await dbQuery;

      if (error) {
        log.error({ err: error, competitorId }, 'Ошибка получения креативов');
        return reply.status(500).send({ success: false, error: error.message });
      }

      return reply.send({
        success: true,
        creatives: data || [],
        pagination: {
          page: query.page,
          limit: query.limit,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / query.limit),
        },
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ success: false, error: error.errors[0].message });
      }
      log.error({ err: error }, 'Ошибка в GET /competitors/:id/creatives');
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  /**
   * GET /competitors/all-creatives - Все креативы всех конкурентов пользователя
   *
   * Query params:
   * - userAccountId: UUID пользователя (обязательный)
   * - top10Only: false (default) - показать все креативы
   * - includeAll: true (default) - показать все креативы (до 50 на конкурента)
   * - newOnly: true - только новые в ТОП-10 (за 7 дней)
   * - mediaType: video | image | carousel | all
   */
  app.get('/competitors/all-creatives', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const {
        userAccountId,
        accountId, // UUID рекламного аккаунта для мультиаккаунтности
        page = '1',
        limit = '20',
        mediaType = 'all',
        top10Only = 'false',
        includeAll = 'true',
        newOnly = 'false',
      } = request.query as Record<string, string>;

      if (!userAccountId) {
        return reply.status(400).send({ success: false, error: 'userAccountId обязателен' });
      }

      const pageNum = parseInt(page);
      const limitNum = Math.min(parseInt(limit), 100); // Увеличен лимит до 100
      const offset = (pageNum - 1) * limitNum;
      const isTop10Only = top10Only === 'true';
      const isIncludeAll = includeAll === 'true';
      const isNewOnly = newOnly === 'true';

      // Получаем ID конкурентов пользователя
      let competitorsQuery = supabase
        .from('user_competitors')
        .select('competitor_id')
        .eq('user_account_id', userAccountId)
        .eq('is_active', true);

      // Фильтр по account_id для мультиаккаунтности
      if (accountId) {
        competitorsQuery = competitorsQuery.eq('account_id', accountId);
      }

      const { data: userCompetitors } = await competitorsQuery;

      if (!userCompetitors || userCompetitors.length === 0) {
        return reply.send({
          success: true,
          creatives: [],
          pagination: { page: pageNum, limit: limitNum, total: 0, totalPages: 0 },
        });
      }

      const competitorIds = userCompetitors.map(uc => uc.competitor_id);

      let dbQuery = supabase
        .from('competitor_creatives')
        .select(`
          *,
          competitor:competitors (
            id,
            name,
            avatar_url
          ),
          analysis:competitor_creative_analysis (
            transcript,
            ocr_text,
            processing_status
          )
        `, { count: 'exact' })
        .in('competitor_id', competitorIds)
        .order('score', { ascending: false, nullsFirst: false }) // Сортировка по score
        .order('created_at', { ascending: false }) // Вторичная сортировка
        .range(offset, offset + limitNum - 1);

      // Фильтр ТОП-10 (если не запрошены все)
      if (isTop10Only && !isIncludeAll) {
        dbQuery = dbQuery.eq('is_top10', true);
      }

      // Фильтр только новые в ТОП-10 (за последние 7 дней)
      if (isNewOnly) {
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        dbQuery = dbQuery
          .eq('is_top10', true)
          .gte('entered_top10_at', weekAgo);
      }

      // Фильтр по типу медиа
      if (mediaType !== 'all') {
        dbQuery = dbQuery.eq('media_type', mediaType);
      }

      const { data, error, count } = await dbQuery;

      if (error) {
        log.error({ err: error, userAccountId }, 'Ошибка получения всех креативов');
        return reply.status(500).send({ success: false, error: error.message });
      }

      return reply.send({
        success: true,
        creatives: data || [],
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / limitNum),
        },
      });
    } catch (error: any) {
      log.error({ err: error }, 'Ошибка в GET /competitors/all-creatives');
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  /**
   * POST /competitors/extract-text - Извлечь текст из креатива конкурента
   *
   * Для image: OCR через Gemini
   * Для video: Транскрибация через существующий сервис
   *
   * Автоматически обновляет URL если он истёк (Facebook CDN URLs expire)
   *
   * Body:
   * - creativeId: UUID креатива
   */
  app.post('/competitors/extract-text', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { creativeId } = request.body as { creativeId: string };

      if (!creativeId) {
        return reply.status(400).send({ success: false, error: 'creativeId обязателен' });
      }

      log.info({ creativeId }, '[Extract Text] Начинаем извлечение текста');

      // Получаем креатив с данными конкурента для возможного refresh
      interface CreativeWithCompetitor {
        id: string;
        media_type: string;
        media_urls: string[] | null;
        thumbnail_url: string | null;
        fb_ad_archive_id: string;
        competitor_id: string;
        competitor: {
          name: string;
          country_code: string;
          fb_page_id: string;
        } | null;
      }

      let creative: CreativeWithCompetitor | null = null;
      let creativeError: Error | null = null;

      for (let attempt = 1; attempt <= 3; attempt++) {
        const { data, error } = await supabase
          .from('competitor_creatives')
          .select(`
            id, media_type, media_urls, thumbnail_url, fb_ad_archive_id, competitor_id,
            competitor:competitors (name, country_code, fb_page_id)
          `)
          .eq('id', creativeId)
          .single();

        if (!error && data) {
          // Supabase возвращает массив для связей, берём первый элемент
          const competitorData = Array.isArray(data.competitor) ? data.competitor[0] : data.competitor;
          creative = {
            ...data,
            competitor: competitorData || null,
          } as CreativeWithCompetitor;
          creativeError = null;
          break;
        }

        creativeError = error;
        if (attempt < 3) {
          log.warn({ creativeId, attempt, error: error?.message }, '[Extract Text] Ошибка запроса к Supabase, повторяем...');
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }

      if (creativeError || !creative) {
        log.error({ err: creativeError, creativeId }, '[Extract Text] Креатив не найден после 3 попыток');
        return reply.status(404).send({ success: false, error: 'Креатив не найден' });
      }

      let extractedText = '';
      let mediaUrl = creative.thumbnail_url || creative.media_urls?.[0];

      if (!mediaUrl) {
        return reply.status(400).send({ success: false, error: 'Нет медиа URL для анализа' });
      }

      if (creative.media_type === 'image' || creative.media_type === 'carousel') {
        // OCR через creative-generation-service
        log.info({ creativeId, mediaUrl }, '[Extract Text] Вызываем OCR для изображения');

        const ocrResponse = await fetch('http://creative-generation-service:8085/ocr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_url: mediaUrl, image_type: 'url' }),
        });

        if (!ocrResponse.ok) {
          const errorText = await ocrResponse.text();
          log.error({ creativeId, status: ocrResponse.status, errorText }, '[Extract Text] Ошибка OCR');
          return reply.status(500).send({ success: false, error: 'Ошибка OCR сервиса' });
        }

        const ocrResult = await ocrResponse.json() as { success: boolean; text?: string };
        extractedText = ocrResult.text || '';
        log.info({ creativeId, textLength: extractedText.length }, '[Extract Text] OCR завершен');

      } else if (creative.media_type === 'video') {
        // Транскрибация видео через Whisper
        let videoUrl = creative.media_urls?.[0];
        if (!videoUrl) {
          return reply.status(400).send({ success: false, error: 'Нет URL видео для транскрибации' });
        }

        log.info({ creativeId, videoUrl }, '[Extract Text] Скачиваем видео для транскрибации');

        // Флаг для retry с новым URL
        let urlRefreshed = false;

        // Функция скачивания видео с автоматическим refresh URL при истечении
        const downloadVideo = async (url: string, outputPath: string): Promise<void> => {
          // Пробуем yt-dlp
          try {
            await execAsync(
              `yt-dlp --no-warnings -q --no-playlist -o "${outputPath}" "${url}"`,
              { timeout: 120000 }
            );

            const stats = await fs.stat(outputPath);
            if (stats.size === 0) {
              throw new Error('yt-dlp скачал пустой файл');
            }

            log.info({ creativeId, fileSize: stats.size }, '[Extract Text] yt-dlp скачал видео успешно');
            return;
          } catch (ytdlpError) {
            log.warn({ creativeId, error: ytdlpError instanceof Error ? ytdlpError.message : String(ytdlpError) }, '[Extract Text] yt-dlp не сработал, пробуем curl');
          }

          // Fallback на curl
          await execAsync(
            `curl -sL -o "${outputPath}" --connect-timeout 30 --max-time 180 "${url}"`,
            { timeout: 200000 }
          );

          const stats = await fs.stat(outputPath);
          if (stats.size === 0) {
            throw new Error('curl скачал пустой файл');
          }

          // Проверяем что файл — это реальное видео, а не HTML-страница ошибки
          if (stats.size < 10000) {
            const content = await fs.readFile(outputPath, 'utf-8').catch(() => '');
            if (content.includes('<!DOCTYPE') || content.includes('<html') || content.includes('Error') || content.includes('Forbidden')) {
              log.warn({ creativeId, fileSize: stats.size }, '[Extract Text] curl скачал HTML вместо видео — URL истёк');
              throw new Error('URL_EXPIRED');
            }
          }

          log.info({ creativeId, fileSize: stats.size }, '[Extract Text] curl скачал видео успешно');
        };

        let videoPath: string | null = null;
        try {
          videoPath = path.join('/var/tmp', `competitor_video_${randomUUID()}.mp4`);

          try {
            await downloadVideo(videoUrl, videoPath);
          } catch (downloadError) {
            const errorMsg = downloadError instanceof Error ? downloadError.message : String(downloadError);

            // Если URL истёк, пробуем обновить через SearchAPI
            if (errorMsg === 'URL_EXPIRED' && creative.competitor && !urlRefreshed) {
              log.info({ creativeId, fbAdArchiveId: creative.fb_ad_archive_id }, '[Extract Text] URL истёк, пробуем обновить через SearchAPI');

              const freshUrls = await refreshCreativeMediaUrl(
                creative.fb_ad_archive_id,
                creative.competitor.name,
                creative.competitor.country_code,
                creative.competitor.fb_page_id
              );

              if (freshUrls && freshUrls.media_urls.length > 0) {
                // Обновляем URL в БД
                await supabase
                  .from('competitor_creatives')
                  .update({
                    media_urls: freshUrls.media_urls,
                    thumbnail_url: freshUrls.thumbnail_url,
                  })
                  .eq('id', creativeId);

                // Используем новый URL
                videoUrl = freshUrls.media_urls[0];
                urlRefreshed = true;

                log.info({ creativeId, newVideoUrl: videoUrl }, '[Extract Text] URL обновлён, повторяем скачивание');

                // Удаляем старый файл если есть
                try {
                  await fs.unlink(videoPath);
                } catch {}

                // Новый путь для нового скачивания
                videoPath = path.join('/var/tmp', `competitor_video_${randomUUID()}.mp4`);

                // Повторяем скачивание с новым URL
                await downloadVideo(videoUrl, videoPath);
              } else {
                log.error({ creativeId }, '[Extract Text] Не удалось получить свежий URL через SearchAPI');
                throw new Error('URL видео истёк и не удалось получить свежий. Попробуйте обновить конкурента.');
              }
            } else {
              throw new Error(errorMsg === 'URL_EXPIRED'
                ? 'URL видео истёк. Обновите данные конкурента.'
                : 'Не удалось скачать видео');
            }
          }

          // Получаем длительность видео для логирования
          let videoDuration = 'unknown';
          try {
            const { stdout } = await execAsync(
              `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`,
              { timeout: 10000 }
            );
            videoDuration = `${parseFloat(stdout.trim()).toFixed(1)}s`;
          } catch {
            // Игнорируем ошибку ffprobe
          }

          log.info({ creativeId, videoPath, duration: videoDuration, urlRefreshed }, '[Extract Text] Видео скачано, запускаем транскрибацию');

          // Транскрибируем через Whisper
          const transcription = await processVideoTranscription(videoPath, 'ru');
          extractedText = transcription.text;

          log.info({ creativeId, textLength: extractedText.length }, '[Extract Text] Транскрибация завершена');

        } finally {
          // Удаляем временный файл
          if (videoPath) {
            try {
              await fs.unlink(videoPath);
            } catch (err) {
              log.warn({ err, videoPath }, '[Extract Text] Не удалось удалить временный файл');
            }
          }
        }
      }

      // Сохраняем результат в competitor_creative_analysis
      const { error: upsertError } = await supabase
        .from('competitor_creative_analysis')
        .upsert({
          creative_id: creativeId,
          ocr_text: creative.media_type !== 'video' ? extractedText : null,
          transcript: creative.media_type === 'video' ? extractedText : null,
          processing_status: 'completed',
        }, {
          onConflict: 'creative_id',
        });

      if (upsertError) {
        log.error({ err: upsertError, creativeId }, '[Extract Text] Ошибка сохранения анализа');
        // Не фатально, возвращаем текст
      }

      log.info({ creativeId, textLength: extractedText.length }, '[Extract Text] Успешно завершено');

      return reply.send({
        success: true,
        text: extractedText,
        media_type: creative.media_type,
      });

    } catch (error: any) {
      log.error({ err: error }, 'Ошибка в POST /competitors/extract-text');
      return reply.status(500).send({ success: false, error: error.message });
    }
  });
}
