/**
 * Direction Ad Sets Routes
 * 
 * API endpoints для управления pre-created ad sets:
 * - Привязка ad set к направлению
 * - Получение списка связанных ad sets
 * - Отвязка ad set
 * - Синхронизация данных с Facebook
 */

import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { graph } from '../adapters/facebook.js';

export default async function directionAdSetsRoutes(app: FastifyInstance) {
  
  /**
   * POST /api/directions/:directionId/link-adset
   * 
   * Привязать существующий ad set к направлению
   * 
   * Валидация:
   * - Ad set существует в Facebook
   * - Ad set принадлежит кампании направления
   * - Ad set в статусе PAUSED
   */
  app.post('/directions/:directionId/link-adset', async (request, reply) => {
    const { directionId } = request.params as { directionId: string };
    const { fb_adset_id, user_account_id } = request.body as {
      fb_adset_id: string;
      user_account_id: string;
    };

    try {
      // 1. Проверить что direction существует и принадлежит пользователю
      const { data: direction, error: dirError } = await supabase
        .from('account_directions')
        .select('*')
        .eq('id', directionId)
        .eq('user_account_id', user_account_id)
        .single();

      if (dirError || !direction) {
        return reply.status(404).send({ error: 'Direction not found' });
      }

      // 2. Получить access token
      const { data: userAccount, error: userError } = await supabase
        .from('user_accounts')
        .select('access_token')
        .eq('id', user_account_id)
        .single();

      if (userError || !userAccount) {
        return reply.status(404).send({ error: 'User account not found' });
      }

      // 3. Валидировать ad set через Facebook API
      const fbAdSet = await graph('GET', fb_adset_id, userAccount.access_token, {
        fields: 'id,name,daily_budget,status,campaign_id'
      });

      // 4. Проверить что ad set принадлежит правильной кампании
      if (fbAdSet.campaign_id !== direction.fb_campaign_id) {
        return reply.status(400).send({
          error: 'Ad set does not belong to direction campaign',
          expected_campaign: direction.fb_campaign_id,
          actual_campaign: fbAdSet.campaign_id
        });
      }

      // 5. Проверить что ad set в статусе PAUSED
      if (fbAdSet.status !== 'PAUSED') {
        return reply.status(400).send({
          error: 'Ad set must be in PAUSED status when linking',
          current_status: fbAdSet.status,
          message: 'Please pause the ad set in Facebook Ads Manager before linking'
        });
      }

      // 6. Вставить в БД
      const { data: linkedAdSet, error: insertError } = await supabase
        .from('direction_adsets')
        .insert({
          direction_id: directionId,
          fb_adset_id,
          adset_name: fbAdSet.name,
          daily_budget_cents: parseInt(fbAdSet.daily_budget),
          status: fbAdSet.status,
          ads_count: 0
        })
        .select()
        .single();

      if (insertError) {
        app.log.error({ error: insertError, directionId, fb_adset_id }, 'Error inserting linked ad set');
        return reply.status(500).send({ error: insertError.message });
      }

      app.log.info({ 
        directionId, 
        fb_adset_id, 
        adsetName: fbAdSet.name 
      }, 'Ad set linked successfully');

      return reply.send({ success: true, direction_adset: linkedAdSet });
    } catch (error: any) {
      app.log.error({ error, directionId, fb_adset_id }, 'Error linking ad set');
      return reply.status(500).send({ 
        error: error.message || 'Failed to link ad set',
        details: error.response?.data || null
      });
    }
  });

  /**
   * GET /api/directions/:directionId/adsets
   * 
   * Получить список связанных ad sets для направления
   */
  app.get('/directions/:directionId/adsets', async (request, reply) => {
    const { directionId } = request.params as { directionId: string };
    const { user_account_id } = request.query as { user_account_id: string };

    try {
      // Проверка доступа
      const { data: direction, error: dirError } = await supabase
        .from('account_directions')
        .select('id')
        .eq('id', directionId)
        .eq('user_account_id', user_account_id)
        .single();

      if (dirError || !direction) {
        return reply.status(404).send({ error: 'Direction not found' });
      }

      // Получить список ad sets
      const { data: adsets, error: adsetsError } = await supabase
        .from('direction_adsets')
        .select('*')
        .eq('direction_id', directionId)
        .order('status', { ascending: false }) // ACTIVE first
        .order('linked_at', { ascending: false });

      if (adsetsError) {
        app.log.error({ error: adsetsError, directionId }, 'Error fetching ad sets');
        return reply.status(500).send({ error: adsetsError.message });
      }

      return reply.send({ success: true, adsets: adsets || [] });
    } catch (error: any) {
      app.log.error({ error, directionId }, 'Error in get adsets endpoint');
      return reply.status(500).send({ error: error.message || 'Failed to fetch ad sets' });
    }
  });

  /**
   * DELETE /api/directions/:directionId/adsets/:adsetId
   * 
   * Отвязать ad set от направления (мягкое удаление)
   */
  app.delete('/directions/:directionId/adsets/:adsetId', async (request, reply) => {
    const { directionId, adsetId } = request.params as {
      directionId: string;
      adsetId: string;
    };
    const { user_account_id } = request.query as { user_account_id: string };

    try {
      // Проверка доступа
      const { data: direction, error: dirError } = await supabase
        .from('account_directions')
        .select('id')
        .eq('id', directionId)
        .eq('user_account_id', user_account_id)
        .single();

      if (dirError || !direction) {
        return reply.status(404).send({ error: 'Direction not found' });
      }

      // Мягкое удаление (is_active = false)
      const { error: deleteError } = await supabase
        .from('direction_adsets')
        .update({ is_active: false })
        .eq('id', adsetId)
        .eq('direction_id', directionId);

      if (deleteError) {
        app.log.error({ error: deleteError, directionId, adsetId }, 'Error unlinking ad set');
        return reply.status(500).send({ error: deleteError.message });
      }

      app.log.info({ directionId, adsetId }, 'Ad set unlinked successfully');

      return reply.send({ success: true });
    } catch (error: any) {
      app.log.error({ error, directionId, adsetId }, 'Error in delete adset endpoint');
      return reply.status(500).send({ error: error.message || 'Failed to unlink ad set' });
    }
  });

  /**
   * POST /api/directions/:directionId/sync-adsets
   * 
   * Синхронизировать данные ad sets с Facebook
   * (обновить название, бюджет, статус)
   */
  app.post('/directions/:directionId/sync-adsets', async (request, reply) => {
    const { directionId } = request.params as { directionId: string };
    const { user_account_id } = request.body as { user_account_id: string };

    try {
      // Получить access token
      const { data: userAccount, error: userError } = await supabase
        .from('user_accounts')
        .select('access_token')
        .eq('id', user_account_id)
        .single();

      if (userError || !userAccount) {
        return reply.status(404).send({ error: 'User account not found' });
      }

      // Получить все ad sets направления
      const { data: adsets, error: adsetsError } = await supabase
        .from('direction_adsets')
        .select('*')
        .eq('direction_id', directionId)
        .eq('is_active', true);

      if (adsetsError) {
        app.log.error({ error: adsetsError, directionId }, 'Error fetching ad sets for sync');
        return reply.status(500).send({ error: adsetsError.message });
      }

      const synced = [];
      const failed = [];

      for (const adset of adsets || []) {
        try {
          const fbData = await graph('GET', adset.fb_adset_id, userAccount.access_token, {
            fields: 'name,daily_budget,status'
          });

          const { error: updateError } = await supabase
            .from('direction_adsets')
            .update({
              adset_name: fbData.name,
              daily_budget_cents: parseInt(fbData.daily_budget),
              status: fbData.status
            })
            .eq('id', adset.id);

          if (updateError) {
            app.log.error({ error: updateError, adsetId: adset.fb_adset_id }, 'Error updating ad set in DB');
            failed.push(adset.fb_adset_id);
          } else {
            synced.push(adset.fb_adset_id);
          }
        } catch (error: any) {
          app.log.error({ error, adsetId: adset.fb_adset_id }, 'Failed to sync ad set');
          failed.push(adset.fb_adset_id);
        }
      }

      app.log.info({ 
        directionId, 
        syncedCount: synced.length, 
        failedCount: failed.length 
      }, 'Ad sets sync completed');

      return reply.send({ 
        success: true, 
        synced_count: synced.length,
        failed_count: failed.length,
        synced,
        failed
      });
    } catch (error: any) {
      app.log.error({ error, directionId }, 'Error in sync adsets endpoint');
      return reply.status(500).send({ error: error.message || 'Failed to sync ad sets' });
    }
  });
}




