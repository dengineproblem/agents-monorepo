/**
 * Dry-run Handlers - Preview operations for dangerous WRITE tools
 *
 * Returns current state, proposed changes, warnings before real execution.
 * Allows user to see exactly what will happen before confirming.
 */

import { fbGraph } from './fbGraph.js';
import { supabase } from '../../lib/supabaseClient.js';
import { logger } from '../../lib/logger.js';

/**
 * Format dry-run response with consistent structure
 */
function formatDryRunResponse({ message, currentState, proposedState, changes, warnings = [], affectedEntities = {} }) {
  return {
    success: true,
    dry_run: true,
    preview: {
      current_state: currentState,
      proposed_state: proposedState,
      changes,
      warnings,
      affected_entities: affectedEntities,
      requires_confirmation: warnings.length > 0 || changes.some(c => c.impact === 'high')
    },
    message
  };
}

/**
 * Dry-run handlers for AdsAgent
 */
export const adsDryRunHandlers = {
  /**
   * Preview pauseCampaign
   */
  async pauseCampaign({ campaign_id }, { accessToken }) {
    try {
      const campaign = await fbGraph('GET', campaign_id, accessToken, {
        fields: 'id,name,status,effective_status,daily_budget,lifetime_budget,objective'
      });

      const warnings = [];
      if (campaign.status === 'ACTIVE') {
        warnings.push('Кампания сейчас ACTIVE — пауза немедленно остановит все показы');
      }
      if (campaign.status === 'PAUSED') {
        warnings.push('Кампания уже на паузе');
      }

      const dailyBudget = campaign.daily_budget ? parseInt(campaign.daily_budget) / 100 : null;

      return formatDryRunResponse({
        message: `Preview: кампания "${campaign.name}" будет поставлена на паузу (текущий статус: ${campaign.status})`,
        currentState: {
          id: campaign.id,
          name: campaign.name,
          status: campaign.status,
          effective_status: campaign.effective_status,
          daily_budget_usd: dailyBudget,
          objective: campaign.objective
        },
        proposedState: {
          status: 'PAUSED',
          effective_status: 'PAUSED'
        },
        changes: [
          {
            field: 'status',
            from: campaign.status,
            to: 'PAUSED',
            impact: campaign.status === 'ACTIVE' ? 'high' : 'low'
          }
        ],
        warnings
      });
    } catch (error) {
      logger.error({ error: error.message, campaign_id }, 'Dry-run pauseCampaign failed');
      return { success: false, error: `Не удалось получить данные кампании: ${error.message}` };
    }
  },

  /**
   * Preview pauseAdSet
   */
  async pauseAdSet({ adset_id }, { accessToken }) {
    try {
      const adset = await fbGraph('GET', adset_id, accessToken, {
        fields: 'id,name,status,effective_status,daily_budget,campaign{id,name}'
      });

      const warnings = [];
      if (adset.status === 'ACTIVE') {
        warnings.push('Адсет сейчас ACTIVE — пауза немедленно остановит показы');
      }
      if (adset.status === 'PAUSED') {
        warnings.push('Адсет уже на паузе');
      }

      const dailyBudget = adset.daily_budget ? parseInt(adset.daily_budget) / 100 : null;

      return formatDryRunResponse({
        message: `Preview: адсет "${adset.name}" будет поставлен на паузу`,
        currentState: {
          id: adset.id,
          name: adset.name,
          status: adset.status,
          effective_status: adset.effective_status,
          daily_budget_usd: dailyBudget,
          campaign: adset.campaign?.name
        },
        proposedState: {
          status: 'PAUSED'
        },
        changes: [
          {
            field: 'status',
            from: adset.status,
            to: 'PAUSED',
            impact: adset.status === 'ACTIVE' ? 'high' : 'low'
          }
        ],
        warnings
      });
    } catch (error) {
      logger.error({ error: error.message, adset_id }, 'Dry-run pauseAdSet failed');
      return { success: false, error: `Не удалось получить данные адсета: ${error.message}` };
    }
  },

  /**
   * Preview updateBudget
   */
  async updateBudget({ adset_id, new_budget_cents }, { accessToken }) {
    try {
      const adset = await fbGraph('GET', adset_id, accessToken, {
        fields: 'id,name,daily_budget,status,campaign{id,name},optimization_goal'
      });

      const currentBudgetCents = adset.daily_budget ? parseInt(adset.daily_budget) : 0;
      const currentBudgetUsd = currentBudgetCents / 100;
      const newBudgetUsd = new_budget_cents / 100;

      const changePercent = currentBudgetCents > 0
        ? Math.round(((new_budget_cents - currentBudgetCents) / currentBudgetCents) * 100)
        : 100;

      const warnings = [];

      // Warning for large changes
      if (Math.abs(changePercent) > 50) {
        warnings.push(`Изменение бюджета ${changePercent > 0 ? 'увеличение' : 'уменьшение'} на ${Math.abs(changePercent)}%`);
      }

      // Warning for doubling
      if (new_budget_cents > currentBudgetCents * 2) {
        warnings.push('Бюджет увеличивается более чем в 2 раза');
      }

      // Warning for very large budget
      if (newBudgetUsd > 500) {
        warnings.push(`Новый бюджет $${newBudgetUsd} — это значительная сумма`);
      }

      // Warning for cutting to minimum
      if (new_budget_cents === 500 && currentBudgetCents > 500) {
        warnings.push('Бюджет будет снижен до минимума ($5)');
      }

      return formatDryRunResponse({
        message: `Preview: бюджет адсета "${adset.name}" изменится с $${currentBudgetUsd.toFixed(2)} на $${newBudgetUsd.toFixed(2)} (${changePercent > 0 ? '+' : ''}${changePercent}%)`,
        currentState: {
          id: adset.id,
          name: adset.name,
          daily_budget_cents: currentBudgetCents,
          daily_budget_usd: currentBudgetUsd,
          status: adset.status,
          campaign: adset.campaign?.name
        },
        proposedState: {
          daily_budget_cents: new_budget_cents,
          daily_budget_usd: newBudgetUsd
        },
        changes: [
          {
            field: 'daily_budget',
            from: `$${currentBudgetUsd.toFixed(2)}`,
            to: `$${newBudgetUsd.toFixed(2)}`,
            change_percent: changePercent,
            impact: Math.abs(changePercent) > 50 ? 'high' : 'medium'
          }
        ],
        warnings
      });
    } catch (error) {
      logger.error({ error: error.message, adset_id }, 'Dry-run updateBudget failed');
      return { success: false, error: `Не удалось получить данные адсета: ${error.message}` };
    }
  },

  /**
   * Preview pauseDirection
   */
  async pauseDirection({ direction_id }, { adAccountId }) {
    try {
      // Get direction from DB
      const { data: direction, error } = await supabase
        .from('account_directions')
        .select('id, name, status, budget_per_day, fb_adset_id, fb_campaign_id')
        .eq('id', direction_id)
        .single();

      if (error || !direction) {
        return { success: false, error: 'Направление не найдено' };
      }

      // Count active creatives
      const { count: creativesCount } = await supabase
        .from('user_creatives')
        .select('*', { count: 'exact', head: true })
        .eq('direction_id', direction_id)
        .in('status', ['ready', 'active']);

      // Count active ads
      const { count: adsCount } = await supabase
        .from('ads')
        .select('*', { count: 'exact', head: true })
        .eq('direction_id', direction_id)
        .eq('status', 'ACTIVE');

      const warnings = [];
      if (direction.status === 'active') {
        warnings.push('Направление сейчас активно — пауза остановит все связанные объявления');
      }
      if (adsCount > 0) {
        warnings.push(`${adsCount} активных объявлений будут остановлены`);
      }
      if (direction.fb_adset_id) {
        warnings.push('Связанный Facebook адсет также будет приостановлен');
      }

      return formatDryRunResponse({
        message: `Preview: направление "${direction.name}" будет поставлено на паузу`,
        currentState: {
          id: direction.id,
          name: direction.name,
          status: direction.status,
          budget_per_day: direction.budget_per_day,
          active_creatives: creativesCount || 0,
          active_ads: adsCount || 0
        },
        proposedState: {
          status: 'paused'
        },
        changes: [
          {
            field: 'status',
            from: direction.status,
            to: 'paused',
            impact: 'high'
          }
        ],
        warnings,
        affectedEntities: {
          fb_adset_id: direction.fb_adset_id,
          fb_campaign_id: direction.fb_campaign_id,
          creatives_count: creativesCount || 0,
          ads_count: adsCount || 0
        }
      });
    } catch (error) {
      logger.error({ error: error.message, direction_id }, 'Dry-run pauseDirection failed');
      return { success: false, error: `Не удалось получить данные направления: ${error.message}` };
    }
  },

  /**
   * Preview updateDirectionBudget
   */
  async updateDirectionBudget({ direction_id, new_budget }, { adAccountId }) {
    try {
      const { data: direction, error } = await supabase
        .from('account_directions')
        .select('id, name, status, budget_per_day, fb_adset_id')
        .eq('id', direction_id)
        .single();

      if (error || !direction) {
        return { success: false, error: 'Направление не найдено' };
      }

      const currentBudget = direction.budget_per_day || 0;
      const changePercent = currentBudget > 0
        ? Math.round(((new_budget - currentBudget) / currentBudget) * 100)
        : 100;

      const warnings = [];
      if (Math.abs(changePercent) > 50) {
        warnings.push(`Изменение бюджета на ${Math.abs(changePercent)}%`);
      }
      if (new_budget > currentBudget * 2) {
        warnings.push('Бюджет увеличивается более чем в 2 раза');
      }
      if (direction.fb_adset_id) {
        warnings.push('Бюджет Facebook адсета также будет обновлён');
      }

      return formatDryRunResponse({
        message: `Preview: бюджет направления "${direction.name}" изменится с $${currentBudget} на $${new_budget}`,
        currentState: {
          id: direction.id,
          name: direction.name,
          budget_per_day: currentBudget,
          status: direction.status
        },
        proposedState: {
          budget_per_day: new_budget
        },
        changes: [
          {
            field: 'budget_per_day',
            from: `$${currentBudget}`,
            to: `$${new_budget}`,
            change_percent: changePercent,
            impact: Math.abs(changePercent) > 50 ? 'high' : 'medium'
          }
        ],
        warnings
      });
    } catch (error) {
      logger.error({ error: error.message, direction_id }, 'Dry-run updateDirectionBudget failed');
      return { success: false, error: `Не удалось получить данные направления: ${error.message}` };
    }
  }
};

/**
 * Dry-run handlers for CreativeAgent
 */
export const creativeDryRunHandlers = {
  /**
   * Preview launchCreative
   */
  async launchCreative({ creative_id, direction_id }, { userAccountId, adAccountId }) {
    try {
      // Get creative
      const { data: creative, error: creativeError } = await supabase
        .from('user_creatives')
        .select('id, title, media_type, status, thumbnail_url, video_url')
        .eq('id', creative_id)
        .single();

      if (creativeError || !creative) {
        return { success: false, error: 'Креатив не найден' };
      }

      // Get direction
      const { data: direction, error: dirError } = await supabase
        .from('account_directions')
        .select('id, name, status, objective, fb_campaign_id, budget_per_day')
        .eq('id', direction_id)
        .single();

      if (dirError || !direction) {
        return { success: false, error: 'Направление не найдено' };
      }

      const warnings = [];

      if (!direction.fb_campaign_id) {
        warnings.push('Направление не привязано к Facebook кампании — требуется сначала создать кампанию');
      }
      if (creative.status !== 'ready') {
        warnings.push(`Креатив имеет статус "${creative.status}" вместо "ready"`);
      }
      if (direction.status !== 'active') {
        warnings.push(`Направление неактивно (статус: ${direction.status})`);
      }

      return formatDryRunResponse({
        message: `Preview: креатив "${creative.title}" будет запущен в направление "${direction.name}"`,
        currentState: {
          creative: {
            id: creative.id,
            title: creative.title,
            media_type: creative.media_type,
            status: creative.status
          },
          direction: {
            id: direction.id,
            name: direction.name,
            status: direction.status,
            objective: direction.objective,
            budget_per_day: direction.budget_per_day
          }
        },
        proposedState: {
          new_ad: true,
          ad_status: 'ACTIVE'
        },
        changes: [
          {
            field: 'new_ad',
            from: null,
            to: 'Будет создано новое объявление',
            impact: 'high'
          }
        ],
        warnings,
        affectedEntities: {
          creative_id: creative.id,
          direction_id: direction.id,
          fb_campaign_id: direction.fb_campaign_id
        }
      });
    } catch (error) {
      logger.error({ error: error.message, creative_id, direction_id }, 'Dry-run launchCreative failed');
      return { success: false, error: `Ошибка при получении данных: ${error.message}` };
    }
  },

  /**
   * Preview pauseCreative
   */
  async pauseCreative({ creative_id }, { userAccountId, adAccountId }) {
    try {
      const { data: creative, error } = await supabase
        .from('user_creatives')
        .select('id, title, status')
        .eq('id', creative_id)
        .single();

      if (error || !creative) {
        return { success: false, error: 'Креатив не найден' };
      }

      // Count active ads with this creative
      const { count: adsCount } = await supabase
        .from('ads')
        .select('*', { count: 'exact', head: true })
        .eq('creative_id', creative_id)
        .eq('status', 'ACTIVE');

      const warnings = [];
      if (adsCount > 0) {
        warnings.push(`${adsCount} активных объявлений будут приостановлены`);
      }
      if (adsCount === 0) {
        warnings.push('Нет активных объявлений с этим креативом');
      }

      return formatDryRunResponse({
        message: `Preview: креатив "${creative.title}" будет поставлен на паузу`,
        currentState: {
          id: creative.id,
          title: creative.title,
          status: creative.status,
          active_ads: adsCount || 0
        },
        proposedState: {
          ads_status: 'PAUSED'
        },
        changes: [
          {
            field: 'ads_status',
            from: 'ACTIVE',
            to: 'PAUSED',
            count: adsCount || 0,
            impact: adsCount > 0 ? 'high' : 'low'
          }
        ],
        warnings,
        affectedEntities: {
          ads_count: adsCount || 0
        }
      });
    } catch (error) {
      logger.error({ error: error.message, creative_id }, 'Dry-run pauseCreative failed');
      return { success: false, error: `Ошибка при получении данных: ${error.message}` };
    }
  },

  /**
   * Preview startCreativeTest
   */
  async startCreativeTest({ creative_id, objective }, { userAccountId, adAccountId }) {
    try {
      const { data: creative, error } = await supabase
        .from('user_creatives')
        .select('id, title, status, media_type')
        .eq('id', creative_id)
        .single();

      if (error || !creative) {
        return { success: false, error: 'Креатив не найден' };
      }

      // Check for existing active test
      const { data: existingTest } = await supabase
        .from('creative_tests')
        .select('id, status')
        .eq('creative_id', creative_id)
        .eq('status', 'running')
        .single();

      const warnings = [];
      if (existingTest) {
        warnings.push('Уже есть активный тест для этого креатива');
      }
      if (creative.status !== 'ready') {
        warnings.push(`Креатив имеет статус "${creative.status}" вместо "ready"`);
      }

      warnings.push('Тест потратит примерно $20 на 1000 показов');

      return formatDryRunResponse({
        message: `Preview: будет запущен A/B тест креатива "${creative.title}"`,
        currentState: {
          id: creative.id,
          title: creative.title,
          status: creative.status,
          has_active_test: !!existingTest
        },
        proposedState: {
          test_status: 'running',
          objective: objective || 'whatsapp',
          estimated_budget: 20,
          estimated_impressions: 1000
        },
        changes: [
          {
            field: 'test',
            from: null,
            to: 'Новый A/B тест',
            impact: 'high'
          }
        ],
        warnings
      });
    } catch (error) {
      logger.error({ error: error.message, creative_id }, 'Dry-run startCreativeTest failed');
      return { success: false, error: `Ошибка при получении данных: ${error.message}` };
    }
  }
};

export default {
  ads: adsDryRunHandlers,
  creative: creativeDryRunHandlers
};
