/**
 * Onboarding API Routes
 *
 * Handles user onboarding stages, kanban board data, and FB approval
 *
 * @module routes/onboarding
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { logErrorToAdmin } from '../lib/errorLogger.js';
import { sendTelegramNotification } from '../lib/telegramNotifier.js';
import {
  syncCampaigns,
  syncAdsets,
  syncAds,
  syncWeeklyInsights,
} from '../services/adInsightsSync.js';
import { normalizeAllResults } from '../services/resultNormalizer.js';
import { processAdAccount as detectAnomalies } from '../services/anomalyDetector.js';
import { analyzeTopCreatives } from './creativeAnalysis.js';

const logger = createLogger({ module: 'onboardingRoutes' });

// =====================================================
// Types & Constants
// =====================================================

const ONBOARDING_STAGES = [
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
] as const;

type OnboardingStage = typeof ONBOARDING_STAGES[number];

const STAGE_LABELS: Record<OnboardingStage, string> = {
  registered: 'Регистрация',
  fb_pending: 'Заявка на FB',
  fb_connected: 'FB подключен',
  direction_created: 'Направление',
  creative_created: 'Креатив',
  ads_launched: 'Реклама',
  first_report: 'Первый отчёт',
  roi_configured: 'ROI настроен',
  active: 'Активный',
  inactive: 'Неактивен'
};

const AVAILABLE_TAGS = [
  'tiktok_connected',
  'generated_image',
  'generated_carousel',
  'generated_text',
  'added_competitors',
  'added_audience'
] as const;

const TAG_LABELS: Record<string, string> = {
  tiktok_connected: 'TikTok',
  generated_image: 'Картинка',
  generated_carousel: 'Карусель',
  generated_text: 'Текст',
  added_competitors: 'Конкуренты',
  added_audience: 'Аудитория'
};

// =====================================================
// Schemas
// =====================================================

const UpdateStageSchema = z.object({
  stage: z.enum(ONBOARDING_STAGES),
  reason: z.string().optional()
});

const UpdateTagsSchema = z.object({
  tags: z.array(z.string())
});

const ApproveFbSchema = z.object({
  sendNotification: z.boolean().default(true)
});

// =====================================================
// Helper Functions
// =====================================================

/**
 * Записывает изменение этапа в историю
 */
async function logStageChange(
  userId: string,
  stageFrom: string | null,
  stageTo: string,
  changedBy?: string,
  reason?: string
): Promise<void> {
  try {
    await supabase.from('onboarding_history').insert({
      user_account_id: userId,
      stage_from: stageFrom,
      stage_to: stageTo,
      changed_by: changedBy || null,
      change_reason: reason || null
    });
  } catch (err) {
    logger.error({ error: String(err), userId }, 'Failed to log stage change');
  }
}

/**
 * Создаёт уведомление для пользователя
 */
async function createNotification(
  userId: string,
  type: string,
  title: string,
  message: string,
  metadata: Record<string, unknown> = {}
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('user_notifications')
      .insert({
        user_account_id: userId,
        type,
        title,
        message,
        metadata
      })
      .select('id')
      .single();

    if (error) throw error;
    return data?.id || null;
  } catch (err) {
    logger.error({ error: String(err), userId, type }, 'Failed to create notification');
    return null;
  }
}

/**
 * Отправляет уведомление пользователю в Telegram
 */
async function sendUserTelegramNotification(
  userId: string,
  message: string,
  notificationId?: string
): Promise<boolean> {
  try {
    // Получаем telegram_id пользователя
    const { data: user, error } = await supabase
      .from('user_accounts')
      .select('telegram_id')
      .eq('id', userId)
      .single();

    if (error || !user?.telegram_id) {
      logger.warn({ userId }, 'User has no telegram_id, skipping notification');
      return false;
    }

    const sent = await sendTelegramNotification(user.telegram_id, message);

    // Обновляем статус отправки
    if (notificationId && sent) {
      await supabase
        .from('user_notifications')
        .update({ telegram_sent: true })
        .eq('id', notificationId);
    }

    return sent;
  } catch (err) {
    logger.error({ error: String(err), userId }, 'Failed to send user telegram notification');
    return false;
  }
}

/**
 * Запускает фоновую синхронизацию insights для пользователя
 * Работает с обоими режимами: legacy и multi-account
 */
async function triggerBackgroundSync(userId: string): Promise<void> {
  try {
    // Получаем данные пользователя
    const { data: user, error: userError } = await supabase
      .from('user_accounts')
      .select('id, ad_account_id, access_token, multi_account_enabled')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      logger.warn({ userId }, 'Cannot trigger sync: user not found');
      return;
    }

    // Определяем режим и запускаем синхронизацию
    if (user.multi_account_enabled) {
      // Multi-account режим: синхронизируем все ad_accounts
      const { data: adAccounts } = await supabase
        .from('ad_accounts')
        .select('id, ad_account_id, access_token')
        .eq('user_account_id', userId)
        .eq('is_active', true);

      if (!adAccounts?.length) {
        logger.warn({ userId }, 'No active ad accounts for multi-account user');
        return;
      }

      for (const account of adAccounts) {
        if (!account.access_token || !account.ad_account_id) continue;

        const fbAccountId = account.ad_account_id.replace('act_', '');
        logger.info({ userId, adAccountId: account.id }, 'Starting background sync for ad account');

        // Синхронизация каталогов
        await syncCampaigns(account.id, account.access_token, fbAccountId);
        await syncAdsets(account.id, account.access_token, fbAccountId);
        await syncAds(account.id, account.access_token, fbAccountId);

        // Weekly insights за 12 недель
        await syncWeeklyInsights(account.id, account.access_token, fbAccountId, 3);

        // Нормализация и аномалии
        await normalizeAllResults(account.id);
        await detectAnomalies(account.id);

        logger.info({ userId, adAccountId: account.id }, 'Background sync completed for ad account');
      }
    } else {
      // Legacy режим: credentials в user_accounts
      if (!user.access_token || !user.ad_account_id) {
        logger.warn({ userId }, 'Legacy user has no FB credentials');
        return;
      }

      // Для legacy нужна запись в ad_accounts
      let adAccountUuid: string;
      const fbAccountId = user.ad_account_id.replace('act_', '');

      // Проверяем/создаём ad_account
      const { data: existing } = await supabase
        .from('ad_accounts')
        .select('id')
        .eq('user_account_id', userId)
        .eq('ad_account_id', user.ad_account_id)
        .single();

      if (existing) {
        adAccountUuid = existing.id;
      } else {
        const { data: created, error: createError } = await supabase
          .from('ad_accounts')
          .insert({
            user_account_id: userId,
            ad_account_id: user.ad_account_id,
            access_token: user.access_token,
            name: `Legacy ${user.ad_account_id}`,
            is_active: true,
            connection_status: 'active',
          })
          .select('id')
          .single();

        if (createError || !created) {
          logger.error({ userId, error: createError?.message }, 'Failed to create ad_account for legacy user');
          return;
        }
        adAccountUuid = created.id;
      }

      logger.info({ userId, adAccountId: adAccountUuid }, 'Starting background sync for legacy user');

      // Синхронизация
      await syncCampaigns(adAccountUuid, user.access_token, fbAccountId);
      await syncAdsets(adAccountUuid, user.access_token, fbAccountId);
      await syncAds(adAccountUuid, user.access_token, fbAccountId);
      await syncWeeklyInsights(adAccountUuid, user.access_token, fbAccountId, 3);
      await normalizeAllResults(adAccountUuid);
      await detectAnomalies(adAccountUuid);

      logger.info({ userId, adAccountId: adAccountUuid }, 'Background sync completed for legacy user');
    }
  } catch (err) {
    logger.error({ error: String(err), userId }, 'Background sync failed');
    // Логируем ошибку в admin_error_logs
    logErrorToAdmin({
      user_account_id: userId,
      error_type: 'api',
      raw_error: err instanceof Error ? err.message : String(err),
      stack_trace: err instanceof Error ? err.stack : undefined,
      action: 'background_sync_on_approval',
      severity: 'warning',
    }).catch(() => {});
  }
}

// =====================================================
// Routes
// =====================================================

export default async function onboardingRoutes(app: FastifyInstance) {
  /**
   * GET /onboarding/kanban
   *
   * Возвращает всех пользователей сгруппированных по этапам для канбан-доски
   */
  app.get('/onboarding/kanban', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { data: users, error } = await supabase
        .from('user_accounts')
        .select(`
          id,
          username,
          onboarding_stage,
          onboarding_tags,
          is_active,
          telegram_id,
          created_at,
          updated_at,
          multi_account_enabled
        `)
        .eq('is_tech_admin', false)
        .order('created_at', { ascending: false });

      if (error) {
        logger.error({ error: error.message }, 'Failed to fetch kanban users');
        return reply.code(500).send({ error: error.message });
      }

      // Получаем последнюю сессию для каждого пользователя
      const userIds = users?.map(u => u.id) || [];
      const { data: sessions } = await supabase
        .from('user_sessions')
        .select('user_account_id, started_at')
        .in('user_account_id', userIds)
        .order('started_at', { ascending: false });

      // Создаём map user_id -> last_session_at
      const lastSessionMap: Record<string, string> = {};
      sessions?.forEach(s => {
        if (!lastSessionMap[s.user_account_id]) {
          lastSessionMap[s.user_account_id] = s.started_at;
        }
      });

      // Получаем ad_accounts для всех пользователей
      const { data: adAccounts } = await supabase
        .from('ad_accounts')
        .select('user_account_id, id, name, is_active, connection_status')
        .in('user_account_id', userIds);

      // Создаём map user_id -> ad_account info
      const adAccountMap: Record<string, {
        count: number;
        activeCount: number;
      }> = {};

      adAccounts?.forEach(acc => {
        if (!adAccountMap[acc.user_account_id]) {
          adAccountMap[acc.user_account_id] = { count: 0, activeCount: 0 };
        }
        adAccountMap[acc.user_account_id].count++;
        if (acc.is_active) adAccountMap[acc.user_account_id].activeCount++;
      });

      // Добавляем last_session_at и ad_account info к каждому пользователю
      const usersWithSession = users?.map(u => ({
        ...u,
        last_session_at: lastSessionMap[u.id] || null,
        ad_account_count: adAccountMap[u.id]?.count || 0,
        active_ad_account_count: adAccountMap[u.id]?.activeCount || 0
      }));

      // Группируем по этапам
      const kanban: Record<OnboardingStage, typeof usersWithSession> = {
        registered: [],
        fb_pending: [],
        fb_connected: [],
        direction_created: [],
        creative_created: [],
        ads_launched: [],
        first_report: [],
        roi_configured: [],
        active: [],
        inactive: []
      };

      usersWithSession?.forEach(user => {
        const stage = (user.onboarding_stage as OnboardingStage) || 'registered';
        if (kanban[stage]) {
          kanban[stage].push(user);
        }
      });

      // Считаем количество в каждом этапе
      const counts: Record<OnboardingStage, number> = {} as any;
      ONBOARDING_STAGES.forEach(stage => {
        counts[stage] = kanban[stage]?.length || 0;
      });

      return reply.send({
        kanban,
        counts,
        stages: ONBOARDING_STAGES.map(s => ({
          id: s,
          label: STAGE_LABELS[s]
        }))
      });
    } catch (err: any) {
      logger.error({ error: String(err) }, 'Exception in /onboarding/kanban');

      logErrorToAdmin({
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'onboarding_kanban',
        endpoint: '/onboarding/kanban',
        severity: 'warning'
      }).catch(() => {});

      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /onboarding/user/:id
   *
   * Детальная информация о пользователе для карточки
   */
  app.get('/onboarding/user/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    try {
      // Получаем пользователя
      const { data: user, error: userError } = await supabase
        .from('user_accounts')
        .select(`
          id,
          username,
          onboarding_stage,
          onboarding_tags,
          is_active,
          telegram_id,
          fb_connection_status,
          access_token,
          page_id,
          ad_account_id,
          created_at,
          updated_at
        `)
        .eq('id', id)
        .single();

      if (userError || !user) {
        return reply.code(404).send({ error: 'User not found' });
      }

      // Получаем историю изменений этапов
      const { data: history } = await supabase
        .from('onboarding_history')
        .select(`
          id,
          stage_from,
          stage_to,
          change_reason,
          created_at,
          changed_by_user:user_accounts!onboarding_history_changed_by_fkey(username)
        `)
        .eq('user_account_id', id)
        .order('created_at', { ascending: false })
        .limit(20);

      // Получаем последние события из аналитики
      const { data: recentEvents } = await supabase
        .from('user_events')
        .select('event_category, event_action, event_label, page_path, created_at')
        .eq('user_account_id', id)
        .order('created_at', { ascending: false })
        .limit(10);

      // Получаем ad_accounts пользователя
      const { data: adAccounts } = await supabase
        .from('ad_accounts')
        .select('id, name, is_active, connection_status, ad_account_id, created_at')
        .eq('user_account_id', id)
        .order('created_at', { ascending: false });

      return reply.send({
        user,
        history: history || [],
        recentEvents: recentEvents || [],
        stageLabels: STAGE_LABELS,
        tagLabels: TAG_LABELS,
        adAccounts: adAccounts || []
      });
    } catch (err: any) {
      logger.error({ error: String(err), userId: id }, 'Exception in /onboarding/user/:id');

      logErrorToAdmin({
        user_account_id: id,
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'onboarding_get_user',
        endpoint: '/onboarding/user/:id',
        severity: 'warning'
      }).catch(() => {});

      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * PATCH /onboarding/stage/:userId
   *
   * Изменить этап онбординга пользователя
   */
  app.patch('/onboarding/stage/:userId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.params as { userId: string };
    const parsed = UpdateStageSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.errors });
    }

    const { stage, reason } = parsed.data;
    const changedBy = (request.headers['x-user-id'] as string) || undefined;

    try {
      // Получаем текущий этап
      const { data: current } = await supabase
        .from('user_accounts')
        .select('onboarding_stage')
        .eq('id', userId)
        .single();

      const stageFrom = current?.onboarding_stage || null;

      // Обновляем этап
      const { error } = await supabase
        .from('user_accounts')
        .update({
          onboarding_stage: stage,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);

      if (error) {
        logger.error({ error: error.message, userId }, 'Failed to update stage');
        return reply.code(500).send({ error: error.message });
      }

      // Логируем изменение
      await logStageChange(userId, stageFrom, stage, changedBy, reason);

      logger.info({ userId, stageFrom, stageTo: stage }, 'Onboarding stage updated');

      return reply.send({ success: true, stage });
    } catch (err: any) {
      logger.error({ error: String(err), userId }, 'Exception in PATCH /onboarding/stage/:userId');

      logErrorToAdmin({
        user_account_id: userId,
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'onboarding_update_stage',
        endpoint: '/onboarding/stage/:userId',
        severity: 'warning'
      }).catch(() => {});

      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /onboarding/approve-fb/:userId
   *
   * Подтвердить подключение Facebook и отправить уведомление
   */
  app.post('/onboarding/approve-fb/:userId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.params as { userId: string };
    const parsed = ApproveFbSchema.safeParse(request.body || {});
    const { sendNotification } = parsed.success ? parsed.data : { sendNotification: true };
    const changedBy = (request.headers['x-user-id'] as string) || undefined;

    try {
      // Получаем пользователя
      const { data: user, error: userError } = await supabase
        .from('user_accounts')
        .select('username, onboarding_stage, telegram_id')
        .eq('id', userId)
        .single();

      if (userError || !user) {
        return reply.code(404).send({ error: 'User not found' });
      }

      const stageFrom = user.onboarding_stage;

      // Обновляем статус и этап
      const { error } = await supabase
        .from('user_accounts')
        .update({
          fb_connection_status: 'approved',
          onboarding_stage: 'fb_connected',
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);

      if (error) {
        logger.error({ error: error.message, userId }, 'Failed to approve FB connection');
        return reply.code(500).send({ error: error.message });
      }

      // Логируем изменение этапа
      await logStageChange(userId, stageFrom, 'fb_connected', changedBy, 'FB подключение подтверждено');

      // Создаём и отправляем уведомление
      if (sendNotification) {
        const notificationId = await createNotification(
          userId,
          'fb_approved',
          'Facebook подключен!',
          'Ваш Facebook аккаунт успешно подключен. Теперь вы можете создавать рекламные кампании.',
          { approvedAt: new Date().toISOString() }
        );

        // Отправляем в Telegram
        if (user.telegram_id) {
          const telegramMessage = `✅ <b>Facebook подключен!</b>

Ваш Facebook аккаунт успешно подключен.
Теперь вы можете создавать рекламные кампании.

🔗 <a href="https://app.performanteaiagency.com/creatives">Создать креатив</a>`;

          await sendUserTelegramNotification(userId, telegramMessage, notificationId || undefined);
        }
      }

      logger.info({ userId, username: user.username }, 'FB connection approved');

      // Запускаем фоновую синхронизацию (не ждём завершения)
      triggerBackgroundSync(userId).catch(err => {
        logger.error({ error: String(err), userId }, 'Background sync trigger failed');
      });

      // Анализируем топ креативы и импортируем лучшие (в фоне)
      analyzeTopCreatives(userId).catch(err => {
        logger.error({ error: String(err), userId }, 'Top creatives analysis failed');
      });

      return reply.send({
        success: true,
        stage: 'fb_connected',
        notificationSent: sendNotification
      });
    } catch (err: any) {
      logger.error({ error: String(err), userId }, 'Exception in POST /onboarding/approve-fb/:userId');

      logErrorToAdmin({
        user_account_id: userId,
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'onboarding_approve_fb',
        endpoint: '/onboarding/approve-fb/:userId',
        severity: 'warning'
      }).catch(() => {});

      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /onboarding/tags
   *
   * Список доступных тегов
   */
  app.get('/onboarding/tags', async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      tags: AVAILABLE_TAGS.map(t => ({
        id: t,
        label: TAG_LABELS[t]
      }))
    });
  });

  /**
   * PATCH /onboarding/tags/:userId
   *
   * Обновить теги пользователя
   */
  app.patch('/onboarding/tags/:userId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.params as { userId: string };
    const parsed = UpdateTagsSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.errors });
    }

    const { tags } = parsed.data;

    try {
      const { error } = await supabase
        .from('user_accounts')
        .update({
          onboarding_tags: tags,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);

      if (error) {
        logger.error({ error: error.message, userId }, 'Failed to update tags');
        return reply.code(500).send({ error: error.message });
      }

      logger.info({ userId, tags }, 'Onboarding tags updated');

      return reply.send({ success: true, tags });
    } catch (err: any) {
      logger.error({ error: String(err), userId }, 'Exception in PATCH /onboarding/tags/:userId');

      logErrorToAdmin({
        user_account_id: userId,
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'onboarding_update_tags',
        endpoint: '/onboarding/tags/:userId',
        severity: 'warning'
      }).catch(() => {});

      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /onboarding/stats
   *
   * Статистика по онбордингу
   */
  app.get('/onboarding/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Считаем пользователей по этапам
      const { data: users } = await supabase
        .from('user_accounts')
        .select('onboarding_stage')
        .eq('is_tech_admin', false);

      const stageCounts: Record<string, number> = {};
      users?.forEach(u => {
        const stage = u.onboarding_stage || 'registered';
        stageCounts[stage] = (stageCounts[stage] || 0) + 1;
      });

      // Считаем pending FB
      const pendingFb = stageCounts['fb_pending'] || 0;

      // Считаем активных за последние 7 дней
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);

      const { count: activeLastWeek } = await supabase
        .from('user_sessions')
        .select('user_account_id', { count: 'exact', head: true })
        .gte('updated_at', weekAgo.toISOString());

      return reply.send({
        total: users?.length || 0,
        byStage: stageCounts,
        pendingFbApproval: pendingFb,
        activeLastWeek: activeLastWeek || 0
      });
    } catch (err: any) {
      logger.error({ error: String(err) }, 'Exception in /onboarding/stats');

      logErrorToAdmin({
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'onboarding_stats',
        endpoint: '/onboarding/stats',
        severity: 'warning'
      }).catch(() => {});

      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
