import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ActionsEnvelope, ActionInput } from '../actions/schema.js';
import { fb, graph } from '../adapters/facebook.js';
import { tt } from '../adapters/tiktok.js';
import { supabase } from '../lib/supabase.js';
import { executeByManifest, getActionSpec } from '../actions/engine.js';
import { workflowDuplicateAndPauseOriginal, workflowDuplicateKeepOriginalActive, workflowDuplicateAdsetWithAudience } from '../workflows/campaignDuplicate.js';
import { workflowCreateCampaignWithCreative } from '../workflows/createCampaignWithCreative.js';
import { workflowStartCreativeTest } from '../workflows/creativeTest.js';
import { workflowCreateAdSetInDirection } from '../workflows/createAdSetInDirection.js';
import { workflowCreateAdGroupWithCreatives } from '../workflows/tiktok/createAdGroupInDirection.js';
import { getAvailableAdSet, activateAdSet, incrementAdsCount, deactivateAdSetWithAds } from '../lib/directionAdSets.js';
import { pauseAdSetsForCampaign } from '../lib/campaignBuilder.js';
import { logErrorToAdmin } from '../lib/errorLogger.js';
import { generateAdsetName } from '../lib/adsetNaming.js';
import { getTikTokCredentials } from '../lib/tiktokSettings.js';
import { buildAdCreative } from '../lib/buildAdCreative.js';

/**
 * Helper: конвертирует объекты в параметры для Facebook API
 * Facebook ожидает вложенные объекты как JSON-строки
 */
function toParams(obj: any): any {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    
    // Для объектов и массивов - JSON.stringify
    if (typeof v === 'object' && v !== null) {
      out[k] = JSON.stringify(v);
    } else {
      out[k] = String(v);
    }
  }
  return out;
}

const AuthHeader = z.string().startsWith('Bearer ').optional();

export async function actionsRoutes(app: FastifyInstance) {
  app.post('/agent/actions', async (req, reply) => {
    try {
      const _auth = AuthHeader.safeParse(req.headers['authorization'] as any);

      const parsed = ActionsEnvelope.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'validation_error', issues: parsed.error.flatten() });
      }
      const { idempotencyKey, account, actions, source } = parsed.data;
      const isTikTokOnly = actions.every((a) => String(a.type || '').startsWith('TikTok.'));
      const isFacebookOnly = actions.every((a) => !String(a.type || '').startsWith('TikTok.'));

      if (!isTikTokOnly && !isFacebookOnly) {
        return reply.code(400).send({ error: 'mixed_platform_actions', message: 'Do not mix TikTok and Facebook actions in the same batch' });
      }

      // Если actions пустой - возвращаем успешный response без выполнения
      // Это происходит когда Brain Agent определяет что действия не нужны (хорошие показатели или reportOnlyMode)
      if (actions.length === 0) {
        return reply.code(202).send({ 
          executionId: 'no-actions-needed', 
          executed: false, 
          message: 'No actions to execute (all campaigns performing well or report-only mode)',
          actionsCount: 0 
        });
      }

      // DRY RUN mode: validate actions (against manifest or minimal manual checks), no Supabase/FB side effects
      if (String(process.env.AGENT_DRY_RUN || 'false').toLowerCase() === 'true') {
        const validations = actions.map((a) => validateActionShape(a));
        const ok = validations.every(v => v.valid);
        return reply.code(202).send({ executionId: 'dry-run', executed: ok, dryRun: true, actionsCount: actions.length, validations });
      }

      let tokenInfo: ResolveOk | null = null;
      let tiktokInfo: ResolveTikTokOk | null = null;

      if (isTikTokOnly) {
        const creds = await resolveTikTokCredentials(account);
        if (!creds.ok) {
          return reply.code(400).send({ error: 'missing_tiktok_credentials', message: creds.message });
        }
        tiktokInfo = creds;
      } else {
        const fbTokenInfo = await resolveAccessToken(account);
        if (!fbTokenInfo.ok) {
          return reply.code(400).send({ error: 'missing_token', message: fbTokenInfo.message });
        }
        tokenInfo = fbTokenInfo;
      }

      const accessToken = tokenInfo?.accessToken;
      const resolvedAdAccountId = account.adAccountId || tokenInfo?.adAccountId || tiktokInfo?.advertiserId || null;

      if (idempotencyKey) {
        const { data: dup } = await supabase
          .from('agent_executions').select('id, status')
          .eq('idempotency_key', idempotencyKey).maybeSingle();
        if (dup) return reply.code(202).send({ executionId: dup.id, duplicate: true });
      }

      const { data: exec, error: exErr } = await supabase
        .from('agent_executions')
        .insert({
          status: 'running',
          idempotency_key: idempotencyKey || null,
          ad_account_id: resolvedAdAccountId,
          source: source || 'n8n',
          request_json: {
            account: { userAccountId: account.userAccountId || null, adAccountId: resolvedAdAccountId },
            actions: actions.map(a => ({ type: a.type, params: a.params }))
          },
          executed: false,
        })
        .select('id')
        .single();
      if (exErr) throw exErr;
      const executionId = exec!.id as string;

      await supabase.from('agent_actions').insert(
        actions.map((a, i) => ({
          execution_id: executionId,
          action_idx: i,
          type: a.type,
          params_json: a.params,
          status: 'queued',
        }))
      );

      let idx = 0;
      for (const act of actions) {
        await supabase.from('agent_actions')
          .update({ status: 'running', started_at: new Date().toISOString() })
          .eq('execution_id', executionId).eq('action_idx', idx);

        await supabase.from('agent_logs').insert({
          execution_id: executionId, step_idx: idx, step: act.type, input_json: { type: act.type },
        });

        try {
          const spec = getActionSpec(act.type);
          let result: any;

          if (isTikTokOnly && tiktokInfo) {
            result = await handleTikTokAction(act as any, {
              accessToken: tiktokInfo.accessToken,
              advertiserId: tiktokInfo.advertiserId,
              identityId: tiktokInfo.identityId,
              userAccountId: account.userAccountId || undefined,
              accountId: tiktokInfo.accountId
            });
          } else {
            // Force manual handler for PauseAd (accepts ad_id/adId)
            if (act.type === 'PauseAd') {
              result = await handleAction(act as any, accessToken!, {
                pageId: tokenInfo?.pageId,
                userAccountId: account.userAccountId || undefined,
                adAccountId: resolvedAdAccountId ?? undefined,
                accountId: tokenInfo?.accountId, // UUID из ad_accounts
                whatsappPhoneNumber: tokenInfo?.whatsappPhoneNumber,
                skipWhatsAppNumberInApi: tokenInfo?.skipWhatsAppNumberInApi
              });
            } else if (spec) {
              result = await executeByManifest(act.type, act.params as any, accessToken!);
            } else {
              result = await handleAction(act as any, accessToken!, {
                pageId: tokenInfo?.pageId,
                userAccountId: account.userAccountId || undefined,
                adAccountId: resolvedAdAccountId ?? undefined,
                accountId: tokenInfo?.accountId, // UUID из ad_accounts
                instagramId: tokenInfo?.instagramId,
                whatsappPhoneNumber: tokenInfo?.whatsappPhoneNumber,
                skipWhatsAppNumberInApi: tokenInfo?.skipWhatsAppNumberInApi
              });
            }
          }

          await supabase.from('agent_actions')
            .update({ status: 'success', finished_at: new Date().toISOString(), result_json: result })
            .eq('execution_id', executionId).eq('action_idx', idx);

          await supabase.from('agent_logs').insert({
            execution_id: executionId, step_idx: idx, step: act.type + ':done', output_json: result ?? { ok: true },
          });
        } catch (e: any) {
          const errPayload = { message: String(e?.message || e), step: e?.step, details: { fb: e?.fb, payload: e?.payload } };
          await supabase.from('agent_actions')
            .update({ status: 'failed', finished_at: new Date().toISOString(), error_json: errPayload })
            .eq('execution_id', executionId).eq('action_idx', idx);

          await supabase.from('agent_executions')
            .update({ status: 'failed', error_json: errPayload, finished_at: new Date().toISOString() })
            .eq('id', executionId);

          return reply.code(500).send({ executionId, error: 'action_failed', message: errPayload.message, step: errPayload.step, details: errPayload.details });
        }

        idx++;
      }

      await supabase.from('agent_executions')
        .update({ status: 'success', executed: true, finished_at: new Date().toISOString() })
        .eq('id', executionId);

      return reply.code(202).send({ executionId, executed: true });
    } catch (e: any) {
      req.log.error(e);

      const account = (req.body as any)?.account;
      logErrorToAdmin({
        user_account_id: account?.userAccountId,
        error_type: 'api',
        raw_error: e.message || String(e),
        stack_trace: e.stack,
        action: 'execute_agent_actions',
        endpoint: '/agent/actions',
        severity: 'critical'
      }).catch(() => {});

      return reply.code(500).send({ error: 'internal', message: e?.message || String(e) });
    }
  });
}

type ResolveOk = { ok: true; accessToken: string; adAccountId?: string; accountId?: string; pageId?: string; instagramId?: string; whatsappPhoneNumber?: string; skipWhatsAppNumberInApi?: boolean };
type ResolveErr = { ok: false; message: string };
type ResolveTikTokOk = { ok: true; accessToken: string; advertiserId: string; identityId?: string; accountId?: string };
type ResolveTikTokErr = { ok: false; message: string };

async function resolveAccessToken(account: { userAccountId?: string | null; accessToken?: string | null; adAccountId?: string | null; whatsappPhoneNumber?: string | null; accountId?: string | null; pageId?: string | null }): Promise<ResolveOk | ResolveErr> {
  if (account.accessToken && account.accessToken.length >= 10) {
    return { ok: true, accessToken: account.accessToken, adAccountId: account.adAccountId || undefined, accountId: account.accountId || undefined, whatsappPhoneNumber: account.whatsappPhoneNumber || undefined, pageId: account.pageId || undefined };
  }
  if (!account.userAccountId) {
    return { ok: false, message: 'Provide accessToken or userAccountId' };
  }

  // Если передан accountId (UUID из ad_accounts) — загружаем credentials из ad_accounts
  // Это нужно для мультиаккаунтного режима
  if (account.accountId) {
    const { data: adAccount, error: adError } = await supabase
      .from('ad_accounts')
      .select('access_token, ad_account_id, page_id, whatsapp_phone_number')
      .eq('id', account.accountId)
      .eq('user_account_id', account.userAccountId)
      .maybeSingle();

    if (adError) return { ok: false, message: `Supabase error (ad_accounts): ${String(adError.message || adError)}` };
    if (!adAccount || !adAccount.access_token) return { ok: false, message: 'Access token not found in ad_accounts for provided accountId' };

    return {
      ok: true,
      accessToken: adAccount.access_token as string,
      adAccountId: (adAccount as any).ad_account_id || account.adAccountId,
      accountId: account.accountId, // UUID из ad_accounts
      pageId: (adAccount as any).page_id || undefined,
      whatsappPhoneNumber: account.whatsappPhoneNumber || (adAccount as any).whatsapp_phone_number || undefined
    };
  }

  // Fallback: загружаем из user_accounts (для обычных пользователей)
  const { data, error } = await supabase
    .from('user_accounts')
    .select('access_token, ad_account_id, page_id, instagram_id, whatsapp_phone_number')
    .eq('id', account.userAccountId)
    .maybeSingle();

  if (error) return { ok: false, message: `Supabase error: ${String(error.message || error)}` };
  if (!data || !data.access_token) return { ok: false, message: 'Access token not found for provided userAccountId' };
  return {
    ok: true,
    accessToken: data.access_token as string,
    adAccountId: (data as any).ad_account_id || account.adAccountId,
    pageId: (data as any).page_id || undefined,
    instagramId: (data as any).instagram_id || undefined,
    whatsappPhoneNumber: account.whatsappPhoneNumber || (data as any).whatsapp_phone_number || undefined
  };
}

async function resolveTikTokCredentials(account: { userAccountId?: string | null; accountId?: string | null }): Promise<ResolveTikTokOk | ResolveTikTokErr> {
  if (!account.userAccountId) {
    return { ok: false, message: 'Provide userAccountId for TikTok actions' };
  }

  const creds = await getTikTokCredentials(account.userAccountId, account.accountId || undefined);
  if (!creds) {
    return { ok: false, message: 'TikTok credentials not found for provided account' };
  }

  return {
    ok: true,
    accessToken: creds.accessToken,
    advertiserId: creds.advertiserId,
    identityId: creds.identityId,
    accountId: account.accountId || undefined
  };
}

async function handleAction(action: ActionInput, token: string, ctx?: { pageId?: string; userAccountId?: string; adAccountId?: string; accountId?: string; instagramId?: string; whatsappPhoneNumber?: string; skipWhatsAppNumberInApi?: boolean }) {
  switch ((action as any).type) {
    case 'GetCampaignStatus': {
      const p = (action as any).params as { campaign_id: string };
      return graph('GET', `${p.campaign_id}`, token, { fields: 'status,effective_status' });
    }
    case 'PauseCampaign':  return fb.pauseCampaign((action as any).params.campaignId, token);
    case 'ResumeCampaign': return fb.resumeCampaign((action as any).params.campaignId, token);
    
    case 'PauseAdset': {
      const adsetId = (action as any).params.adsetId;
      
      // Проверить режим работы пользователя
      if (ctx?.userAccountId) {
        const { data: userAccount } = await supabase
          .from('user_accounts')
          .select('default_adset_mode')
          .eq('id', ctx.userAccountId)
          .single();

        if (userAccount?.default_adset_mode === 'use_existing') {
          // В режиме use_existing нужно также остановить все ads
          return deactivateAdSetWithAds(adsetId, token);
        }
      }
      
      // Обычная логика - просто остановить ad set
      return fb.pauseAdset(adsetId, token);
    }
    
    case 'ResumeAdset':    return fb.resumeAdset((action as any).params.adsetId, token);
    case 'PauseAd':        return fb.pauseAd((action as any).params.adId || (action as any).params.ad_id, token);
    case 'ResumeAd':       return fb.resumeAd((action as any).params.adId, token);
    case 'SetAdsetBudget': return fb.setAdsetBudgetUsd((action as any).params.adsetId, (action as any).params.dailyBudgetUsd, token);

    case 'Workflow.DuplicateAndPauseOriginal': {
      const p = (action as any).params as { campaign_id: string; name?: string };
      return workflowDuplicateAndPauseOriginal({ ...p, page_id: ctx?.pageId }, token);
    }
    case 'Workflow.DuplicateKeepOriginalActive': {
      const p = (action as any).params as { campaign_id: string; name?: string };
      return workflowDuplicateKeepOriginalActive({ ...p, page_id: ctx?.pageId }, token);
    }
    case 'Audience.DuplicateAdSetWithAudience': {
      const p = (action as any).params as { source_adset_id: string; audience_id: string; daily_budget?: number; name_suffix?: string };
      if (!p.source_adset_id || !p.audience_id) throw new Error('Audience.DuplicateAdSetWithAudience: source_adset_id and audience_id required');
      // Передаем user_account_id для автоматического создания LAL из seed
      return workflowDuplicateAdsetWithAudience({ ...p, user_account_id: ctx?.userAccountId }, token);
    }
    case 'CreateCampaignWithCreative': {
      const p = (action as any).params as {
        user_creative_id?: string; // Backward compatibility: single creative
        user_creative_ids?: string[]; // New: multiple creatives
        objective: 'WhatsApp' | 'Conversions' | 'Instagram' | 'SiteLeads' | 'LeadForms' | 'AppInstalls';
        campaign_name: string;
        adset_name?: string;
        daily_budget_cents: number;
        targeting?: any;
        use_default_settings?: boolean;
        auto_activate?: boolean;
      };
      
      // Поддержка обоих форматов: user_creative_id (старый) и user_creative_ids (новый)
      let creative_ids: string[];
      if (p.user_creative_ids && Array.isArray(p.user_creative_ids)) {
        creative_ids = p.user_creative_ids;
      } else if (p.user_creative_id) {
        creative_ids = [p.user_creative_id]; // Backward compatibility
      } else {
        throw new Error('CreateCampaignWithCreative: user_creative_id or user_creative_ids required');
      }
      
      if (!p.objective || !p.campaign_name || !p.daily_budget_cents) {
        throw new Error('CreateCampaignWithCreative: objective, campaign_name, daily_budget_cents required');
      }
      if (!ctx?.userAccountId || !ctx?.adAccountId) {
        throw new Error('CreateCampaignWithCreative: userAccountId and adAccountId required in context');
      }

      // Получаем direction_id из первого креатива (для ВСЕХ objectives)
      let directionIdFromCreative: string | null = null;
      if (creative_ids.length > 0) {
        const { data: firstCreative } = await supabase
          .from('user_creatives')
          .select('direction_id')
          .eq('id', creative_ids[0])
          .single();
        directionIdFromCreative = firstCreative?.direction_id || null;
      }

      // Получаем WhatsApp номер из направления (если есть)
      let whatsapp_phone_number;
      if ((p.objective === 'WhatsApp' || p.objective === 'Conversions') && directionIdFromCreative) {
        const { data: direction } = await supabase
          .from('account_directions')
          .select('whatsapp_phone_number_id')
          .eq('id', directionIdFromCreative)
          .single();

        if (direction?.whatsapp_phone_number_id) {
          const { data: phoneNumber } = await supabase
            .from('whatsapp_phone_numbers')
            .select('phone_number')
            .eq('id', direction.whatsapp_phone_number_id)
            .eq('is_active', true)
            .single();

          if (phoneNumber?.phone_number) {
            whatsapp_phone_number = phoneNumber.phone_number;
          }
        }

        if (!whatsapp_phone_number) {
          const { data: defaultNumber } = await supabase
            .from('whatsapp_phone_numbers')
            .select('phone_number')
            .eq('user_account_id', ctx.userAccountId)
            .eq('is_default', true)
            .eq('is_active', true)
            .single();

          if (defaultNumber?.phone_number) {
            whatsapp_phone_number = defaultNumber.phone_number;
          }
        }

        if (!whatsapp_phone_number) {
          whatsapp_phone_number = ctx.whatsappPhoneNumber;
        }
      }

      console.log('[Brain Agent] CreateCampaignWithCreative:', {
        whatsapp_number: whatsapp_phone_number || null
      });

      return workflowCreateCampaignWithCreative(
        {
          user_creative_ids: creative_ids,
          objective: p.objective,
          campaign_name: p.campaign_name,
          adset_name: p.adset_name,
          daily_budget_cents: p.daily_budget_cents,
          targeting: p.targeting,
          use_default_settings: p.use_default_settings,
          auto_activate: p.auto_activate,
          page_id: ctx.pageId,
          instagram_id: ctx.instagramId,
        },
        {
          user_account_id: ctx.userAccountId,
          ad_account_id: ctx.adAccountId,
          whatsapp_phone_number,
          account_id: ctx.accountId, // UUID из ad_accounts для multi-account
          direction_id: directionIdFromCreative || undefined,
        },
        token
      );
    }

    case 'StartCreativeTest': {
      const p = (action as any).params as {
        user_creative_id: string;
      };
      
      if (!p.user_creative_id) {
        throw new Error('StartCreativeTest: user_creative_id required');
      }
      
      if (!ctx?.userAccountId || !ctx?.adAccountId) {
        throw new Error('StartCreativeTest: userAccountId and adAccountId required from context');
      }
      
      return workflowStartCreativeTest(
        {
          user_creative_id: p.user_creative_id,
          user_id: ctx.userAccountId
        },
        {
          ad_account_id: ctx.adAccountId,
          page_id: ctx.pageId,
          instagram_id: ctx.instagramId
        },
        token
      );
    }

    case 'Direction.CreateAdSetWithCreatives': {
      const p = (action as any).params as {
        direction_id: string;
        user_creative_ids: string[];
        daily_budget_cents?: number;
        adset_name?: string;
        auto_activate?: boolean;
        optimization_goal_override?: string;
      };
      
      if (!p.direction_id) {
        throw new Error('Direction.CreateAdSetWithCreatives: direction_id required');
      }
      
      if (!p.user_creative_ids || !Array.isArray(p.user_creative_ids) || p.user_creative_ids.length === 0) {
        throw new Error('Direction.CreateAdSetWithCreatives: user_creative_ids array required (at least 1 creative)');
      }
      
      if (!ctx?.userAccountId || !ctx?.adAccountId) {
        throw new Error('Direction.CreateAdSetWithCreatives: userAccountId and adAccountId required from context');
      }
      
      return workflowCreateAdSetInDirection(
        {
          direction_id: p.direction_id,
          user_creative_ids: p.user_creative_ids,
          daily_budget_cents: p.daily_budget_cents,
          optimization_goal_override: p.optimization_goal_override,
          source: 'Brain',
          auto_activate: true, // ВСЕГДА включаем
          start_mode: (action as any).params?.start_mode || 'now' // Agent Brain всегда запускает немедленно
        },
        {
          user_account_id: ctx.userAccountId,
          ad_account_id: ctx.adAccountId,
          account_id: ctx.accountId, // UUID из ad_accounts для multi-account
          page_id: ctx.pageId
        },
        token
      );
    }

    case 'Direction.CreateMultipleAdSets': {
      const p = (action as any).params as {
        direction_id: string;
        adsets: Array<{
          user_creative_ids: string[];
          adset_name?: string;
          daily_budget_cents?: number;
          optimization_goal_override?: string;
        }>;
        auto_activate?: boolean;
      };

      if (!p.direction_id) throw new Error('Direction.CreateMultipleAdSets: direction_id required');
      if (!p.adsets || !Array.isArray(p.adsets) || p.adsets.length === 0) {
        throw new Error('Direction.CreateMultipleAdSets: adsets array required');
      }

      // Обработать каждый adset - создать через API
      const results = [];

      if (!ctx?.userAccountId || !ctx?.adAccountId) {
        throw new Error('Direction.CreateMultipleAdSets: missing user context');
      }

      // ШАГ 0: Отключить активные адсеты в кампании перед созданием новых
      // Получаем direction чтобы узнать fb_campaign_id
      const { data: direction } = await supabase
        .from('account_directions')
        .select('fb_campaign_id, name, objective')
        .eq('id', p.direction_id)
        .single();

      if (direction?.fb_campaign_id) {
        console.log(`[Direction.CreateMultipleAdSets] Pausing active adsets in campaign ${direction.fb_campaign_id} before creating new ones`);
        try {
          const pausedCount = await pauseAdSetsForCampaign(direction.fb_campaign_id, token);
          console.log(`[Direction.CreateMultipleAdSets] Paused ${pausedCount} active adsets`);
        } catch (pauseError: any) {
          console.warn(`[Direction.CreateMultipleAdSets] Failed to pause adsets: ${pauseError.message}`);
          // Продолжаем создание - это не критическая ошибка
        }
      }

      for (const adsetConfig of p.adsets) {
        try {
          const result = await workflowCreateAdSetInDirection(
            {
              direction_id: p.direction_id,
              user_creative_ids: adsetConfig.user_creative_ids,
              daily_budget_cents: adsetConfig.daily_budget_cents || 1000,
              optimization_goal_override: adsetConfig.optimization_goal_override,
              source: 'Brain',
              auto_activate: true, // ВСЕГДА включаем
              start_mode: (action as any).params?.start_mode || 'now'
            },
            {
              user_account_id: ctx.userAccountId,
              ad_account_id: ctx.adAccountId,
              account_id: ctx.accountId, // UUID из ad_accounts для multi-account
              page_id: ctx.pageId
            },
            token
          );
          
          results.push({
            success: true,
            adset_id: result.adset_id,
            adset_name: generateAdsetName({ directionName: direction?.name || 'Unknown', source: 'Brain', objective: direction?.objective || '' }),
            ads_created: result.ads.length,
            creatives_count: adsetConfig.user_creative_ids.length
          });
        } catch (error: any) {
          results.push({
            success: false,
            error: error.message,
            adset_config: adsetConfig
          });
        }
      }
      
      // Check if all adsets failed
      const successCount = results.filter(r => r.success).length;
      const failedCount = results.filter(r => !r.success).length;

      if (successCount === 0 && failedCount > 0) {
        // All adsets failed - throw error with details
        const firstError = results.find(r => r.error)?.error || 'All ad sets failed to create';
        throw new Error(`All ${failedCount} ad sets failed: ${firstError}`);
      }

      return {
        success: successCount > 0,
        mode: 'api_create_multiple',
        total_adsets: results.length,
        total_ads: results.reduce((sum, r) => sum + (r.ads_created || 0), 0),
        success_count: successCount,
        failed_count: failedCount,
        adsets: results
      };
    }

    case 'Direction.UseExistingAdSetWithCreatives': {
      console.log('🚀 [ACTION] Direction.UseExistingAdSetWithCreatives called', {
        userAccountId: ctx?.userAccountId,
        action: action
      });
      
      const p = (action as any).params as {
        direction_id: string;
        user_creative_ids: string[];
        daily_budget_cents?: number;
        audience_id?: string;
        auto_activate?: boolean;
      };
      
      console.log('📋 [ACTION] Parameters:', {
        direction_id: p.direction_id,
        creatives_count: p.user_creative_ids?.length,
        user_creative_ids: p.user_creative_ids,
        daily_budget_cents: p.daily_budget_cents,
        audience_id: p.audience_id,
        auto_activate: p.auto_activate
      });
      
      if (!p.direction_id) throw new Error('Direction.UseExistingAdSetWithCreatives: direction_id required');
      if (!p.user_creative_ids || !Array.isArray(p.user_creative_ids) || p.user_creative_ids.length === 0) {
        throw new Error('Direction.UseExistingAdSetWithCreatives: user_creative_ids array required');
      }
      
      console.log('🔍 [ACTION] Checking user account mode...');
      // Проверить режим пользователя
      const { data: userAccount } = await supabase
        .from('user_accounts')
        .select('default_adset_mode, username')
        .eq('id', ctx?.userAccountId)
        .single();
      
      console.log('✅ [ACTION] User account mode:', {
        userAccountId: ctx?.userAccountId,
        username: userAccount?.username,
        default_adset_mode: userAccount?.default_adset_mode
      });
      
      if (userAccount?.default_adset_mode !== 'use_existing') {
        console.error('❌ [ACTION] Wrong mode - cannot use this action', {
          current_mode: userAccount?.default_adset_mode,
          required_mode: 'use_existing'
        });
        throw new Error('Direction.UseExistingAdSetWithCreatives can only be used in use_existing mode');
      }
      
      console.log('🔍 [ACTION] Searching for available PAUSED ad set...');
      // Получить доступный PAUSED ad set
      const availableAdSet = await getAvailableAdSet(p.direction_id);
      if (!availableAdSet) {
        console.error('❌ [ACTION] No available ad sets found', {
          direction_id: p.direction_id,
          userAccountId: ctx?.userAccountId
        });
        throw new Error(`No available pre-created ad sets for direction ${p.direction_id}`);
      }
      
      console.log('✅ [ACTION] Found available ad set:', {
        id: availableAdSet.id,
        fb_adset_id: availableAdSet.fb_adset_id,
        name: availableAdSet.adset_name,
        current_ads_count: availableAdSet.ads_count
      });
      
      // ИЗМЕНИТЬ НАСТРОЙКИ AD SET ПЕРЕД АКТИВАЦИЕЙ (если указаны)
      console.log('🔧 [ACTION] Preparing ad set updates...');
      const updateParams: any = {};
      
      // 1. Изменить бюджет (если указан)
      if (p.daily_budget_cents !== undefined) {
        updateParams.daily_budget = p.daily_budget_cents;
        console.log('💰 [ACTION] Will update budget:', {
          daily_budget_cents: p.daily_budget_cents
        });
      }
      
      // 2. Изменить аудиторию (если указана)
      if (p.audience_id) {
        if (p.audience_id === 'use_lal_from_settings') {
          console.log('🎯 [ACTION] Loading LAL audience from settings...');
          // Получить LAL аудиторию из настроек пользователя
          const { data: userAcct } = await supabase
            .from('user_accounts')
            .select('ig_seed_audience_id')
            .eq('id', ctx?.userAccountId)
            .single();
          
          if (userAcct?.ig_seed_audience_id) {
            updateParams.targeting = { 
              custom_audiences: [{ id: userAcct.ig_seed_audience_id }] 
            };
            console.log('✅ [ACTION] LAL audience loaded:', {
              audience_id: userAcct.ig_seed_audience_id
            });
          } else {
            console.warn('⚠️ [ACTION] LAL audience requested but not found in settings');
          }
        } else {
          // Использовать указанную аудиторию
          updateParams.targeting = { 
            custom_audiences: [{ id: p.audience_id }] 
          };
          console.log('✅ [ACTION] Custom audience will be set:', {
            audience_id: p.audience_id
          });
        }
      }
      
      // Применить изменения (если есть)
      if (Object.keys(updateParams).length > 0) {
        console.log('🔧 [ACTION] Applying updates to ad set in Facebook...', {
          updateParams
        });
        await graph('POST', `${availableAdSet.fb_adset_id}`, token, toParams(updateParams));
        console.log('✅ [ACTION] Ad set settings updated in Facebook');
      } else {
        console.log('ℹ️ [ACTION] No settings to update, using existing ad set configuration');
      }
      
      console.log('🔄 [ACTION] Activating ad set (PAUSED → ACTIVE)...');
      // Активировать ad set
      await activateAdSet(availableAdSet.id, availableAdSet.fb_adset_id, token);
      console.log('✅ [ACTION] Ad set activated successfully');
      
      console.log('📋 [ACTION] Loading direction and account info...');
      // Получить данные направления для ad_account_id
      const { data: direction } = await supabase
        .from('account_directions')
        .select('*')
        .eq('id', p.direction_id)
        .single();

      if (!direction) {
        console.error('❌ [ACTION] Direction not found', { direction_id: p.direction_id });
        throw new Error('Direction not found');
      }

      console.log('✅ [ACTION] Direction loaded:', {
        id: direction.id,
        name: direction.name,
        objective: direction.objective,
        conversion_channel: direction.conversion_channel
      });
      
      const { data: userAcct } = await supabase
        .from('user_accounts')
        .select('ad_account_id')
        .eq('id', ctx?.userAccountId)
        .single();
      
      const normalized_ad_account_id = userAcct?.ad_account_id.startsWith('act_') 
        ? userAcct.ad_account_id 
        : `act_${userAcct?.ad_account_id}`;
      
      console.log('✅ [ACTION] Ad account:', { ad_account_id: normalized_ad_account_id });
      
      // Создать ads для каждого креатива
      console.log(`🎨 [ACTION] Creating ${p.user_creative_ids.length} ad(s)...`);
      const created_ads = [];
      
      for (let i = 0; i < p.user_creative_ids.length; i++) {
        const creativeId = p.user_creative_ids[i];
        console.log(`🎨 [ACTION] Processing creative ${i + 1}/${p.user_creative_ids.length}:`, { creativeId });

        const { data: creative } = await supabase
          .from('user_creatives')
          .select('id, title')
          .eq('id', creativeId)
          .single();

        if (!creative) {
          console.warn(`⚠️ [ACTION] Creative not found, skipping:`, { creativeId });
          continue;
        }

        // Пересобираем AdCreative на лету с актуальными настройками направления
        let fb_creative_id: string;
        try {
          const built = await buildAdCreative({
            user_creative_id: creativeId,
            direction_id: direction.id,
            user_account_id: ctx!.userAccountId!,
            account_id: ctx?.accountId || null,
          });
          fb_creative_id = built.fb_creative_id;
        } catch (err: any) {
          console.warn(`⚠️ [ACTION] buildAdCreative failed, skipping:`, {
            creativeId,
            objective: direction.objective,
            error: err?.message,
          });
          continue;
        }

        const adBody = {
          name: `${creative.title} - ${new Date().toISOString().split('T')[0]}`,
          adset_id: availableAdSet.fb_adset_id,
          status: p.auto_activate !== false ? 'ACTIVE' : 'PAUSED',
          creative: { creative_id: fb_creative_id }
        };

        console.log(`🔧 [ACTION] Creating ad ${i + 1}/${p.user_creative_ids.length} in Facebook...`, {
          ad_name: adBody.name,
          adset_id: availableAdSet.fb_adset_id,
          fb_creative_id,
          status: adBody.status
        });

        const adResult = await graph('POST', `${normalized_ad_account_id}/ads`, token, toParams(adBody));

        console.log(`✅ [ACTION] Ad ${i + 1}/${p.user_creative_ids.length} created:`, {
          ad_id: adResult.id,
          creative_id: creativeId
        });

        created_ads.push({ ad_id: adResult.id, user_creative_id: creativeId });
      }
      
      console.log('✅ [ACTION] All ads created:', {
        total: created_ads.length,
        ads: created_ads
      });
      
      // Инкрементировать счетчик ads
      console.log('📊 [ACTION] Incrementing ads_count...');
      await incrementAdsCount(availableAdSet.fb_adset_id, created_ads.length);
      console.log('✅ [ACTION] ads_count incremented');
      
      const result = {
        success: true,
        adset_id: availableAdSet.fb_adset_id,
        ads_created: created_ads.length,
        ads: created_ads,
        mode: 'use_existing',
        settings_updated: Object.keys(updateParams).length > 0,
        updated_params: updateParams
      };
      
      console.log('🎉 [ACTION] Direction.UseExistingAdSetWithCreatives completed successfully:', result);
      
      return result;
    }

    case 'Direction.UseMultipleExistingAdSets': {
      const p = (action as any).params as {
        direction_id: string;
        adsets: Array<{
          user_creative_ids: string[];
          adset_name?: string;
          daily_budget_cents?: number;
        }>;
        auto_activate?: boolean;
      };
      
      if (!p.direction_id) throw new Error('Direction.UseMultipleExistingAdSets: direction_id required');
      if (!p.adsets || !Array.isArray(p.adsets) || p.adsets.length === 0) {
        throw new Error('Direction.UseMultipleExistingAdSets: adsets array required');
      }
      
      // Проверить режим пользователя
      const { data: userAccount } = await supabase
        .from('user_accounts')
        .select('default_adset_mode, ad_account_id')
        .eq('id', ctx?.userAccountId)
        .single();
      
      if (userAccount?.default_adset_mode !== 'use_existing') {
        throw new Error('Direction.UseMultipleExistingAdSets can only be used in use_existing mode');
      }
      
      const normalized_ad_account_id = userAccount?.ad_account_id.startsWith('act_') 
        ? userAccount.ad_account_id 
        : `act_${userAccount?.ad_account_id}`;
      
      // Получить данные направления
      const { data: direction } = await supabase
        .from('account_directions')
        .select('*')
        .eq('id', p.direction_id)
        .single();
      
      if (!direction) throw new Error('Direction not found');
      
      // Обработать каждый adset
      const results = [];
      
      for (const adsetConfig of p.adsets) {
        // Получить доступный PAUSED ad set
        const availableAdSet = await getAvailableAdSet(p.direction_id);
        if (!availableAdSet) {
          results.push({
            success: false,
            error: 'No more available pre-created ad sets',
            adset_config: adsetConfig
          });
          continue;
        }
        
        // ИЗМЕНИТЬ НАСТРОЙКИ AD SET (если указаны)
        const updateParams: any = {};
        
        if (adsetConfig.daily_budget_cents !== undefined) {
          updateParams.daily_budget = adsetConfig.daily_budget_cents;
        }
        
        // Применить изменения
        if (Object.keys(updateParams).length > 0) {
          await graph('POST', `${availableAdSet.fb_adset_id}`, token, toParams(updateParams));
        }
        
        // Активировать ad set
        await activateAdSet(availableAdSet.id, availableAdSet.fb_adset_id, token);
        
        // Создать ads для каждого креатива
        const created_ads = [];
        
        for (const creativeId of adsetConfig.user_creative_ids) {
          const { data: creative } = await supabase
            .from('user_creatives')
            .select('id, title')
            .eq('id', creativeId)
            .single();

          if (!creative) continue;

          let fb_creative_id: string;
          try {
            const built = await buildAdCreative({
              user_creative_id: creativeId,
              direction_id: direction.id,
              user_account_id: ctx!.userAccountId!,
              account_id: ctx?.accountId || null,
            });
            fb_creative_id = built.fb_creative_id;
          } catch (err: any) {
            console.warn('[ACTION] UseMultipleExistingAdSets: buildAdCreative failed, skipping', {
              creativeId,
              objective: direction.objective,
              error: err?.message,
            });
            continue;
          }

          const adBody = {
            name: `${creative.title} - ${new Date().toISOString().split('T')[0]}`,
            adset_id: availableAdSet.fb_adset_id,
            status: p.auto_activate !== false ? 'ACTIVE' : 'PAUSED',
            creative: { creative_id: fb_creative_id }
          };

          const adResult = await graph('POST', `${normalized_ad_account_id}/ads`, token, toParams(adBody));
          created_ads.push({ ad_id: adResult.id, user_creative_id: creativeId });
        }
        
        // Инкрементировать счетчик ads
        await incrementAdsCount(availableAdSet.fb_adset_id, created_ads.length);
        
        results.push({
          success: true,
          adset_id: availableAdSet.fb_adset_id,
          adset_name: adsetConfig.adset_name || availableAdSet.adset_name,
          ads_created: created_ads.length,
          ads: created_ads
        });
      }
      
      // Check if all adsets failed
      const successCount = results.filter(r => r.success).length;
      const failedCount = results.filter(r => !r.success).length;

      if (successCount === 0 && failedCount > 0) {
        // All adsets failed - throw error with details
        const firstError = results.find(r => r.error)?.error || 'All ad sets failed';
        throw new Error(`All ${failedCount} ad sets failed: ${firstError}`);
      }

      return {
        success: successCount > 0,
        mode: 'use_existing_multiple',
        total_adsets: results.length,
        total_ads: results.reduce((sum, r) => sum + (r.ads_created || 0), 0),
        success_count: successCount,
        failed_count: failedCount,
        adsets: results
      };
    }
  }
}

async function handleTikTokAction(
  action: ActionInput,
  ctx: { accessToken: string; advertiserId: string; identityId?: string; userAccountId?: string; accountId?: string }
) {
  switch ((action as any).type) {
    case 'TikTok.GetCampaignStatus': {
      const p = (action as any).params as { campaign_id: string };
      return tt.getCampaigns(ctx.advertiserId, ctx.accessToken, { filtering: { campaign_ids: [p.campaign_id] } });
    }
    case 'TikTok.PauseCampaign': {
      const p = (action as any).params as { campaign_id: string };
      return tt.pauseCampaign(ctx.advertiserId, ctx.accessToken, p.campaign_id);
    }
    case 'TikTok.ResumeCampaign': {
      const p = (action as any).params as { campaign_id: string };
      return tt.resumeCampaign(ctx.advertiserId, ctx.accessToken, p.campaign_id);
    }
    case 'TikTok.PauseAdGroup': {
      const p = (action as any).params as { adgroup_id: string };
      return tt.pauseAdGroup(ctx.advertiserId, ctx.accessToken, p.adgroup_id);
    }
    case 'TikTok.ResumeAdGroup': {
      const p = (action as any).params as { adgroup_id: string };
      return tt.resumeAdGroup(ctx.advertiserId, ctx.accessToken, p.adgroup_id);
    }
    case 'TikTok.UpdateAdGroupBudget': {
      const p = (action as any).params as { adgroup_id: string; new_budget: number };
      return tt.updateAdGroupBudget(ctx.advertiserId, ctx.accessToken, p.adgroup_id, p.new_budget);
    }
    case 'TikTok.PauseAd': {
      const p = (action as any).params as { ad_id: string };
      return tt.pauseAd(ctx.advertiserId, ctx.accessToken, p.ad_id);
    }
    case 'TikTok.ResumeAd': {
      const p = (action as any).params as { ad_id: string };
      return tt.resumeAd(ctx.advertiserId, ctx.accessToken, p.ad_id);
    }
    case 'TikTok.Direction.CreateAdGroupWithCreatives': {
      const p = (action as any).params as {
        direction_id: string;
        user_creative_ids: string[];
        daily_budget: number;
        adgroup_name?: string;
        auto_activate?: boolean;
      };
      if (!ctx.userAccountId) {
        throw new Error('TikTok.Direction.CreateAdGroupWithCreatives: userAccountId is required');
      }
      return workflowCreateAdGroupWithCreatives(
        {
          direction_id: p.direction_id,
          user_creative_ids: p.user_creative_ids,
          daily_budget: p.daily_budget,
          adgroup_name: p.adgroup_name,
          auto_activate: p.auto_activate
        },
        {
          user_account_id: ctx.userAccountId,
          ad_account_id: ctx.accountId
        }
      );
    }
    default:
      throw new Error(`Unknown TikTok action: ${(action as any).type}`);
  }
}

function validateActionShape(action: ActionInput): { type: string; valid: boolean; issues?: string[] } {
  const type = (action as any).type;
  const params = (action as any).params || {};
  const issues: string[] = [];
  const spec = getActionSpec(type);
  if (spec) {
    // Basic manifest param validation
    for (const [key, ps] of Object.entries(spec.params || {})) {
      const val = (params as any)[key];
      if (ps.required && (val === undefined || val === null || val === '')) {
        issues.push(`Missing required param: ${key}`);
        continue;
      }
      if (val === undefined) continue;
      if ((ps as any).min_value !== undefined && typeof val === 'number' && val < (ps as any).min_value) {
        issues.push(`Param ${key} below min_value ${(ps as any).min_value}`);
      }
      if ((ps as any).max_length !== undefined && typeof val === 'string' && val.length > (ps as any).max_length) {
        issues.push(`Param ${key} exceeds max_length ${(ps as any).max_length}`);
      }
      if ((ps as any).values && !(ps as any).values.includes(val)) {
        issues.push(`Param ${key} not in allowed values`);
      }
    }
  } else {
    // Minimal checks for manual actions
    switch (type) {
      case 'TikTok.GetCampaignStatus': {
        if (!params.campaign_id) issues.push('TikTok.GetCampaignStatus: campaign_id required');
        break;
      }
      case 'TikTok.PauseCampaign':
      case 'TikTok.ResumeCampaign': {
        if (!params.campaign_id) issues.push(`${type}: campaign_id required`);
        break;
      }
      case 'TikTok.PauseAdGroup':
      case 'TikTok.ResumeAdGroup': {
        if (!params.adgroup_id) issues.push(`${type}: adgroup_id required`);
        break;
      }
      case 'TikTok.UpdateAdGroupBudget': {
        if (!params.adgroup_id) issues.push('TikTok.UpdateAdGroupBudget: adgroup_id required');
        if (typeof params.new_budget !== 'number') issues.push('TikTok.UpdateAdGroupBudget: new_budget number required');
        break;
      }
      case 'TikTok.PauseAd':
      case 'TikTok.ResumeAd': {
        if (!params.ad_id) issues.push(`${type}: ad_id required`);
        break;
      }
      case 'TikTok.Direction.CreateAdGroupWithCreatives': {
        if (!params.direction_id) issues.push('TikTok.Direction.CreateAdGroupWithCreatives: direction_id required');
        if (!params.user_creative_ids) {
          issues.push('TikTok.Direction.CreateAdGroupWithCreatives: user_creative_ids required');
        }
        if (params.user_creative_ids && !Array.isArray(params.user_creative_ids)) {
          issues.push('TikTok.Direction.CreateAdGroupWithCreatives: user_creative_ids must be an array');
        }
        if (params.user_creative_ids && Array.isArray(params.user_creative_ids) && params.user_creative_ids.length === 0) {
          issues.push('TikTok.Direction.CreateAdGroupWithCreatives: user_creative_ids must have at least 1 creative');
        }
        if (params.daily_budget && typeof params.daily_budget !== 'number') {
          issues.push('TikTok.Direction.CreateAdGroupWithCreatives: daily_budget must be a number');
        }
        break;
      }
      case 'PauseAd': if (!params.adId) issues.push('PauseAd: adId required'); break;
      case 'ResumeAd': if (!params.adId) issues.push('ResumeAd: adId required'); break;
      case 'PauseAdset': if (!params.adsetId) issues.push('PauseAdset: adsetId required'); break;
      case 'ResumeAdset': if (!params.adsetId) issues.push('ResumeAdset: adsetId required'); break;
      case 'SetAdsetBudget': {
        if (!params.adsetId) issues.push('SetAdsetBudget: adsetId required');
        if (typeof params.dailyBudgetUsd !== 'number') issues.push('SetAdsetBudget: dailyBudgetUsd number required');
        break;
      }
      case 'CreateCampaignWithCreative': {
        if (!params.user_creative_id && !params.user_creative_ids) {
          issues.push('CreateCampaignWithCreative: user_creative_id or user_creative_ids required');
        }
        if (params.user_creative_ids && !Array.isArray(params.user_creative_ids)) {
          issues.push('CreateCampaignWithCreative: user_creative_ids must be an array');
        }
        if (!params.objective) issues.push('CreateCampaignWithCreative: objective required');
        if (!params.campaign_name) issues.push('CreateCampaignWithCreative: campaign_name required');
        if (typeof params.daily_budget_cents !== 'number') issues.push('CreateCampaignWithCreative: daily_budget_cents number required');
        if (!['WhatsApp', 'Conversions', 'Instagram', 'SiteLeads', 'LeadForms', 'AppInstalls'].includes(params.objective)) {
          issues.push('CreateCampaignWithCreative: objective must be WhatsApp, Conversions, Instagram, SiteLeads, LeadForms, or AppInstalls');
        }
        break;
      }
      case 'StartCreativeTest': {
        if (!params.user_creative_id) {
          issues.push('StartCreativeTest: user_creative_id required');
        }
        break;
      }
      case 'Direction.CreateAdSetWithCreatives': {
        if (!params.direction_id) {
          issues.push('Direction.CreateAdSetWithCreatives: direction_id required');
        }
        if (!params.user_creative_ids) {
          issues.push('Direction.CreateAdSetWithCreatives: user_creative_ids required');
        }
        if (params.user_creative_ids && !Array.isArray(params.user_creative_ids)) {
          issues.push('Direction.CreateAdSetWithCreatives: user_creative_ids must be an array');
        }
        if (params.user_creative_ids && Array.isArray(params.user_creative_ids) && params.user_creative_ids.length === 0) {
          issues.push('Direction.CreateAdSetWithCreatives: user_creative_ids must have at least 1 creative');
        }
        if (params.daily_budget_cents && typeof params.daily_budget_cents !== 'number') {
          issues.push('Direction.CreateAdSetWithCreatives: daily_budget_cents must be a number');
        }
        break;
      }
      case 'Direction.CreateMultipleAdSets': {
        if (!params.direction_id) {
          issues.push('Direction.CreateMultipleAdSets: direction_id required');
        }
        if (!params.adsets) {
          issues.push('Direction.CreateMultipleAdSets: adsets array required');
        }
        if (params.adsets && !Array.isArray(params.adsets)) {
          issues.push('Direction.CreateMultipleAdSets: adsets must be an array');
        }
        if (params.adsets && Array.isArray(params.adsets) && params.adsets.length === 0) {
          issues.push('Direction.CreateMultipleAdSets: adsets must have at least 1 adset');
        }
        // Validate each adset config
        if (params.adsets && Array.isArray(params.adsets)) {
          params.adsets.forEach((adset: any, idx: number) => {
            if (!adset.user_creative_ids || !Array.isArray(adset.user_creative_ids) || adset.user_creative_ids.length === 0) {
              issues.push(`Direction.CreateMultipleAdSets: adsets[${idx}] must have user_creative_ids array`);
            }
          });
        }
        break;
      }
      case 'Direction.UseExistingAdSetWithCreatives': {
        if (!params.direction_id) {
          issues.push('Direction.UseExistingAdSetWithCreatives: direction_id required');
        }
        if (!params.user_creative_ids) {
          issues.push('Direction.UseExistingAdSetWithCreatives: user_creative_ids required');
        }
        if (params.user_creative_ids && !Array.isArray(params.user_creative_ids)) {
          issues.push('Direction.UseExistingAdSetWithCreatives: user_creative_ids must be an array');
        }
        if (params.user_creative_ids && Array.isArray(params.user_creative_ids) && params.user_creative_ids.length === 0) {
          issues.push('Direction.UseExistingAdSetWithCreatives: user_creative_ids must have at least 1 creative');
        }
        if (params.daily_budget_cents && typeof params.daily_budget_cents !== 'number') {
          issues.push('Direction.UseExistingAdSetWithCreatives: daily_budget_cents must be a number');
        }
        break;
      }
      case 'Direction.UseMultipleExistingAdSets': {
        if (!params.direction_id) {
          issues.push('Direction.UseMultipleExistingAdSets: direction_id required');
        }
        if (!params.adsets) {
          issues.push('Direction.UseMultipleExistingAdSets: adsets array required');
        }
        if (params.adsets && !Array.isArray(params.adsets)) {
          issues.push('Direction.UseMultipleExistingAdSets: adsets must be an array');
        }
        if (params.adsets && Array.isArray(params.adsets) && params.adsets.length === 0) {
          issues.push('Direction.UseMultipleExistingAdSets: adsets must have at least 1 adset');
        }
        // Validate each adset config
        if (params.adsets && Array.isArray(params.adsets)) {
          params.adsets.forEach((adset: any, idx: number) => {
            if (!adset.user_creative_ids || !Array.isArray(adset.user_creative_ids) || adset.user_creative_ids.length === 0) {
              issues.push(`Direction.UseMultipleExistingAdSets: adsets[${idx}] must have user_creative_ids array`);
            }
          });
        }
        break;
      }
    }
  }
  return { type, valid: issues.length === 0, issues: issues.length ? issues : undefined };
}
