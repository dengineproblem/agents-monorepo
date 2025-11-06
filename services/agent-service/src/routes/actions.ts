import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ActionsEnvelope, ActionInput } from '../actions/schema.js';
import { fb, graph } from '../adapters/facebook.js';
import { supabase } from '../lib/supabase.js';
import { executeByManifest, getActionSpec } from '../actions/engine.js';
import { workflowDuplicateAndPauseOriginal, workflowDuplicateKeepOriginalActive, workflowDuplicateAdsetWithAudience } from '../workflows/campaignDuplicate.js';
import { workflowCreateCampaignWithCreative } from '../workflows/createCampaignWithCreative.js';
import { workflowStartCreativeTest } from '../workflows/creativeTest.js';
import { workflowCreateAdSetInDirection } from '../workflows/createAdSetInDirection.js';
import { getAvailableAdSet, activateAdSet, incrementAdsCount, deactivateAdSetWithAds } from '../lib/directionAdSets.js';

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
  app.post('/api/agent/actions', async (req, reply) => {
    try {
      const _auth = AuthHeader.safeParse(req.headers['authorization'] as any);

      const parsed = ActionsEnvelope.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'validation_error', issues: parsed.error.flatten() });
      }
      const { idempotencyKey, account, actions, source } = parsed.data;

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

      const tokenInfo = await resolveAccessToken(account);
      if (!tokenInfo.ok) {
        return reply.code(400).send({ error: 'missing_token', message: tokenInfo.message });
      }
      const accessToken = tokenInfo.accessToken!;
      const resolvedAdAccountId = account.adAccountId || tokenInfo.adAccountId || null;

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
          // Force manual handler for PauseAd (accepts ad_id/adId)
          if (act.type === 'PauseAd') {
            result = await handleAction(act as any, accessToken, { 
              pageId: tokenInfo.pageId,
              userAccountId: account.userAccountId,
              adAccountId: resolvedAdAccountId ?? undefined,
              whatsappPhoneNumber: tokenInfo.whatsappPhoneNumber
            });
          } else if (spec) {
            result = await executeByManifest(act.type, act.params as any, accessToken);
          } else {
            result = await handleAction(act as any, accessToken, { 
              pageId: tokenInfo.pageId,
              userAccountId: account.userAccountId,
              adAccountId: resolvedAdAccountId ?? undefined,
              instagramId: tokenInfo.instagramId,
              whatsappPhoneNumber: tokenInfo.whatsappPhoneNumber
            });
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
      return reply.code(500).send({ error: 'internal', message: e?.message || String(e) });
    }
  });
}

type ResolveOk = { ok: true; accessToken: string; adAccountId?: string; pageId?: string; instagramId?: string; whatsappPhoneNumber?: string };
type ResolveErr = { ok: false; message: string };

async function resolveAccessToken(account: { userAccountId?: string; accessToken?: string; adAccountId?: string; whatsappPhoneNumber?: string }): Promise<ResolveOk | ResolveErr> {
  if (account.accessToken && account.accessToken.length >= 10) {
    return { ok: true, accessToken: account.accessToken, adAccountId: account.adAccountId, whatsappPhoneNumber: account.whatsappPhoneNumber };
  }
  if (!account.userAccountId) {
    return { ok: false, message: 'Provide accessToken or userAccountId' };
  }
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

async function handleAction(action: ActionInput, token: string, ctx?: { pageId?: string; userAccountId?: string; adAccountId?: string; instagramId?: string; whatsappPhoneNumber?: string }) {
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
        objective: 'WhatsApp' | 'Instagram' | 'SiteLeads';
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
      
      // Получаем WhatsApp номер с приоритетом направления (для WhatsApp objective)
      let whatsapp_phone_number = ctx.whatsappPhoneNumber;
      
      if (p.objective === 'WhatsApp' && creative_ids.length > 0) {
        // Получаем первый креатив для определения direction_id
        const { data: firstCreative } = await supabase
          .from('user_creatives')
          .select('direction_id')
          .eq('id', creative_ids[0])
          .single();
        
        if (firstCreative?.direction_id) {
          // 1. Приоритет: номер из направления
          const { data: direction } = await supabase
            .from('account_directions')
            .select('whatsapp_phone_number_id')
            .eq('id', firstCreative.direction_id)
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
              console.log('[Brain Agent] Using WhatsApp number from direction:', {
                creativeId: creative_ids[0],
                directionId: firstCreative.direction_id,
                phone_number: whatsapp_phone_number,
                source: 'direction'
              });
            }
          }
          
          // 2. Fallback: дефолтный номер пользователя
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
              console.log('[Brain Agent] Using default WhatsApp number:', {
                creativeId: creative_ids[0],
                phone_number: whatsapp_phone_number,
                source: 'default'
              });
            }
          }
        }
        
        // 3. Fallback: ctx.whatsappPhoneNumber уже установлен выше (legacy из user_accounts)
        if (whatsapp_phone_number && whatsapp_phone_number === ctx.whatsappPhoneNumber) {
          console.log('[Brain Agent] Using legacy WhatsApp number:', {
            creativeId: creative_ids[0],
            phone_number: whatsapp_phone_number,
            source: 'user_accounts'
          });
        }
      }
      
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
          adset_name: p.adset_name,
          auto_activate: p.auto_activate,
          start_mode: (action as any).params?.start_mode || 'now' // Agent Brain всегда запускает немедленно
        },
        {
          user_account_id: ctx.userAccountId,
          ad_account_id: ctx.adAccountId
        },
        token
      );
    }

    case 'Direction.UseExistingAdSetWithCreatives': {
      const p = (action as any).params as {
        direction_id: string;
        user_creative_ids: string[];
        daily_budget_cents?: number;
        audience_id?: string;
        auto_activate?: boolean;
      };
      
      if (!p.direction_id) throw new Error('Direction.UseExistingAdSetWithCreatives: direction_id required');
      if (!p.user_creative_ids || !Array.isArray(p.user_creative_ids) || p.user_creative_ids.length === 0) {
        throw new Error('Direction.UseExistingAdSetWithCreatives: user_creative_ids array required');
      }
      
      // Проверить режим пользователя
      const { data: userAccount } = await supabase
        .from('user_accounts')
        .select('default_adset_mode')
        .eq('id', ctx?.userAccountId)
        .single();
      
      if (userAccount?.default_adset_mode !== 'use_existing') {
        throw new Error('Direction.UseExistingAdSetWithCreatives can only be used in use_existing mode');
      }
      
      // Получить доступный PAUSED ad set
      const availableAdSet = await getAvailableAdSet(p.direction_id);
      if (!availableAdSet) {
        throw new Error(`No available pre-created ad sets for direction ${p.direction_id}`);
      }
      
      // ИЗМЕНИТЬ НАСТРОЙКИ AD SET ПЕРЕД АКТИВАЦИЕЙ (если указаны)
      const updateParams: any = {};
      
      // 1. Изменить бюджет (если указан)
      if (p.daily_budget_cents !== undefined) {
        updateParams.daily_budget = p.daily_budget_cents;
      }
      
      // 2. Изменить аудиторию (если указана)
      if (p.audience_id) {
        if (p.audience_id === 'use_lal_from_settings') {
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
          }
        } else {
          // Использовать указанную аудиторию
          updateParams.targeting = { 
            custom_audiences: [{ id: p.audience_id }] 
          };
        }
      }
      
      // Применить изменения (если есть)
      if (Object.keys(updateParams).length > 0) {
        await graph('POST', `${availableAdSet.fb_adset_id}`, token, toParams(updateParams));
      }
      
      // Активировать ad set
      await activateAdSet(availableAdSet.id, availableAdSet.fb_adset_id, token);
      
      // Получить данные направления для ad_account_id
      const { data: direction } = await supabase
        .from('account_directions')
        .select('*')
        .eq('id', p.direction_id)
        .single();
      
      if (!direction) throw new Error('Direction not found');
      
      const { data: userAcct } = await supabase
        .from('user_accounts')
        .select('ad_account_id')
        .eq('id', ctx?.userAccountId)
        .single();
      
      const normalized_ad_account_id = userAcct?.ad_account_id.startsWith('act_') 
        ? userAcct.ad_account_id 
        : `act_${userAcct?.ad_account_id}`;
      
      // Создать ads для каждого креатива
      const created_ads = [];
      
      for (const creativeId of p.user_creative_ids) {
        const { data: creative } = await supabase
          .from('user_creatives')
          .select('*')
          .eq('id', creativeId)
          .single();
        
        if (!creative) continue;
        
        // Определить fb_creative_id по objective направления
        let fb_creative_id;
        if (direction.objective === 'whatsapp') fb_creative_id = creative.fb_creative_id_whatsapp;
        else if (direction.objective === 'instagram_traffic') fb_creative_id = creative.fb_creative_id_instagram_traffic;
        else if (direction.objective === 'site_leads') fb_creative_id = creative.fb_creative_id_site_leads;
        
        if (!fb_creative_id) continue;
        
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
      
      return {
        success: true,
        adset_id: availableAdSet.fb_adset_id,
        ads_created: created_ads.length,
        ads: created_ads,
        mode: 'use_existing',
        settings_updated: Object.keys(updateParams).length > 0,
        updated_params: updateParams
      };
    }
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
        if (!['WhatsApp', 'Instagram', 'SiteLeads'].includes(params.objective)) {
          issues.push('CreateCampaignWithCreative: objective must be WhatsApp, Instagram, or SiteLeads');
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
    }
  }
  return { type, valid: issues.length === 0, issues: issues.length ? issues : undefined };
}
