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
  type CompetitorCreativeData,
} from '../lib/searchApi.js';

const log = createLogger({ module: 'competitorsRoutes' });

// ========================================
// VALIDATION SCHEMAS
// ========================================

const AddCompetitorSchema = z.object({
  userAccountId: z.string().uuid(),
  // Принимаем Facebook URL, Instagram URL или @handle
  socialUrl: z.string().min(1).refine(
    url => {
      const normalized = url.trim().toLowerCase();
      return normalized.includes('facebook.com') ||
             normalized.includes('fb.com') ||
             normalized.includes('instagram.com') ||
             normalized.startsWith('@');
    },
    'Введите ссылку на Facebook, Instagram или @username'
  ),
  name: z.string().min(1).max(200),
  countryCode: z.string().length(2).default('KZ'),
});

const GetCompetitorsQuerySchema = z.object({
  userAccountId: z.string().uuid(),
});

const GetCreativesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  mediaType: z.enum(['video', 'image', 'carousel', 'all']).default('all'),
});

const DeleteCompetitorSchema = z.object({
  userAccountId: z.string().uuid(),
});

type AddCompetitorInput = z.infer<typeof AddCompetitorSchema>;

// ========================================
// HELPER FUNCTIONS
// ========================================

/**
 * Сохранить креативы в БД с дедупликацией
 */
async function saveCreatives(
  competitorId: string,
  creatives: CompetitorCreativeData[]
): Promise<{ found: number; new: number }> {
  let newCount = 0;

  for (const creative of creatives) {
    try {
      // Используем upsert с conflict on fb_ad_archive_id
      const { data, error } = await supabase
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
        )
        .select('id')
        .single();

      if (!error && data) {
        newCount++;
      }
    } catch (err) {
      log.warn({ err, adArchiveId: creative.fb_ad_archive_id }, 'Ошибка при сохранении креатива');
    }
  }

  return { found: creatives.length, new: newCount };
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

      const { data, error } = await supabase
        .from('user_competitors')
        .select(`
          id,
          display_name,
          is_favorite,
          is_active,
          created_at,
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
      const { data: existingLink } = await supabase
        .from('user_competitors')
        .select('id, is_active')
        .eq('user_account_id', input.userAccountId)
        .eq('competitor_id', competitorId)
        .single();

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
        const creatives = await fetchCompetitorCreatives(searchQuery, input.countryCode, { targetPageId: pageId, limit: 10 });
        const result = await saveCreatives(competitorId, creatives);

        // Обновляем статус и счетчик
        await supabase
          .from('competitors')
          .update({
            status: 'active',
            last_crawled_at: new Date().toISOString(),
            next_crawl_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // +7 дней
            creatives_count: result.found,
          })
          .eq('id', competitorId);

        // Создаем записи для анализа
        await createAnalysisRecords(competitorId);

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
          { targetPageId: competitor.fb_page_id, limit: 10 }
        );
        const result = await saveCreatives(competitorId, creatives);

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

        // Обновляем конкурента
        await supabase
          .from('competitors')
          .update({
            status: 'active',
            last_crawled_at: new Date().toISOString(),
            next_crawl_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            creatives_count: result.found,
            last_error: null,
          })
          .eq('id', competitorId);

        // Создаем записи для анализа новых креативов
        await createAnalysisRecords(competitorId);

        log.info({ competitorId, result }, 'Обновление креативов завершено');

        return reply.send({
          success: true,
          result: {
            creatives_found: result.found,
            creatives_new: result.new,
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
        .order('created_at', { ascending: false })
        .range(offset, offset + query.limit - 1);

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
   */
  app.get('/competitors/all-creatives', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userAccountId, page = '1', limit = '20', mediaType = 'all' } = request.query as Record<string, string>;

      if (!userAccountId) {
        return reply.status(400).send({ success: false, error: 'userAccountId обязателен' });
      }

      const pageNum = parseInt(page);
      const limitNum = Math.min(parseInt(limit), 50);
      const offset = (pageNum - 1) * limitNum;

      // Получаем ID конкурентов пользователя
      const { data: userCompetitors } = await supabase
        .from('user_competitors')
        .select('competitor_id')
        .eq('user_account_id', userAccountId)
        .eq('is_active', true);

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
        .order('created_at', { ascending: false })
        .range(offset, offset + limitNum - 1);

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
}
