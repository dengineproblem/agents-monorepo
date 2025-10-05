import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ActionsEnvelope, ActionInput } from '../actions/schema.js';
import { fb, graph } from '../adapters/facebook.js';
import { supabase } from '../lib/supabase.js';
import { executeByManifest, getActionSpec } from '../actions/engine.js';
import { workflowDuplicateAndPauseOriginal, workflowDuplicateKeepOriginalActive, workflowDuplicateAdsetWithAudience } from '../workflows/campaignDuplicate.js';
import { workflowCreateCampaignWithCreative } from '../workflows/createCampaignWithCreative.js';

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
              adAccountId: resolvedAdAccountId ?? undefined
            });
          } else if (spec) {
            result = await executeByManifest(act.type, act.params as any, accessToken);
          } else {
            result = await handleAction(act as any, accessToken, { 
              pageId: tokenInfo.pageId,
              userAccountId: account.userAccountId,
              adAccountId: resolvedAdAccountId ?? undefined,
              instagramId: tokenInfo.instagramId
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

type ResolveOk = { ok: true; accessToken: string; adAccountId?: string; pageId?: string; instagramId?: string };
type ResolveErr = { ok: false; message: string };

async function resolveAccessToken(account: { userAccountId?: string; accessToken?: string; adAccountId?: string; }): Promise<ResolveOk | ResolveErr> {
  if (account.accessToken && account.accessToken.length >= 10) {
    return { ok: true, accessToken: account.accessToken, adAccountId: account.adAccountId };
  }
  if (!account.userAccountId) {
    return { ok: false, message: 'Provide accessToken or userAccountId' };
  }
  const { data, error } = await supabase
    .from('user_accounts')
    .select('access_token, ad_account_id, page_id, instagram_id')
    .eq('id', account.userAccountId)
    .maybeSingle();

  if (error) return { ok: false, message: `Supabase error: ${String(error.message || error)}` };
  if (!data || !data.access_token) return { ok: false, message: 'Access token not found for provided userAccountId' };
  return {
    ok: true,
    accessToken: data.access_token as string,
    adAccountId: (data as any).ad_account_id || account.adAccountId,
    pageId: (data as any).page_id || undefined,
    instagramId: (data as any).instagram_id || undefined
  };
}

async function handleAction(action: ActionInput, token: string, ctx?: { pageId?: string; userAccountId?: string; adAccountId?: string; instagramId?: string }) {
  switch ((action as any).type) {
    case 'GetCampaignStatus': {
      const p = (action as any).params as { campaign_id: string };
      return graph('GET', `${p.campaign_id}`, token, { fields: 'status,effective_status' });
    }
    case 'PauseCampaign':  return fb.pauseCampaign((action as any).params.campaignId, token);
    case 'ResumeCampaign': return fb.resumeCampaign((action as any).params.campaignId, token);
    case 'PauseAdset':     return fb.pauseAdset((action as any).params.adsetId, token);
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
      return workflowDuplicateAdsetWithAudience(p, token);
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
        },
        token
      );
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
    }
  }
  return { type, valid: issues.length === 0, issues: issues.length ? issues : undefined };
}
