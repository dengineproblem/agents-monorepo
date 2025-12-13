/**
 * Telegram Chat Handler
 * Handles Telegram messages with streaming, persistence, and inline approval
 */

import { orchestrator } from './orchestrator/index.js';
import { unifiedStore } from './stores/unifiedStore.js';
import { TelegramStreamer } from './telegramStreamer.js';
import { sendApprovalButtons, handleTextApproval } from './telegram/approvalHandler.js';
import { supabase } from '../lib/supabaseClient.js';
import { logger } from '../lib/logger.js';
import { logErrorToAdmin } from '../lib/errorLogger.js';

/**
 * Process a Telegram message with streaming
 * @param {Object} params
 * @param {Object} params.ctx - Telegram context (grammY/telegraf)
 * @param {string} params.message - User message text
 * @param {string} params.telegramChatId - Telegram chat ID
 * @returns {Promise<Object>} Final result
 */
export async function handleTelegramMessage({ ctx, message, telegramChatId }) {
  const startTime = Date.now();

  try {
    // 1. Find user account by telegram_id
    const userAccount = await getUserAccountByTelegramId(telegramChatId);
    if (!userAccount) {
      await ctx.reply('❌ Аккаунт не найден. Свяжитесь с поддержкой.');
      return { success: false, error: 'user_not_found' };
    }

    // 2. Get or create conversation (using unified store)
    const adAccountId = userAccount.default_ad_account_id || userAccount.ad_account_id;
    const conversation = await unifiedStore.getOrCreate({
      source: 'telegram',
      userAccountId: userAccount.id,
      adAccountId,
      telegramChatId: String(telegramChatId)
    });

    // 3. Check for text-based approval first
    const handled = await handleTextApproval(ctx, message, conversation.id);
    if (handled) {
      return { success: true, handled: 'text_approval' };
    }

    // 4. Check concurrency lock
    const lockAcquired = await unifiedStore.acquireLock(conversation.id);
    if (!lockAcquired) {
      await ctx.reply('⏳ Подождите, обрабатываю предыдущий запрос...');
      return { success: false, error: 'busy' };
    }

    try {
      // 5. Load conversation history
      const history = await unifiedStore.loadMessages(conversation.id);

      // Add rolling summary if exists
      const messagesForLLM = conversation.rolling_summary
        ? [{ role: 'system', content: `Предыдущий контекст диалога: ${conversation.rolling_summary}` }, ...history]
        : history;

      // 6. Save user message
      await unifiedStore.addMessage(conversation.id, {
        role: 'user',
        content: message
      });

      // 7. Get tool context
      const accessToken = await getAccessToken(userAccount.id, adAccountId);
      const toolContext = {
        accessToken,
        userAccountId: userAccount.id,
        adAccountId
      };

      // 8. Get business context
      const businessContext = await getBusinessContext(userAccount, adAccountId);

      // 9. Start streaming response
      const streamer = await new TelegramStreamer(ctx).start();

      // 10. Process with streaming
      let finalResult = null;
      const pendingApprovals = [];

      for await (const event of orchestrator.processStreamRequest({
        message,
        context: businessContext,
        mode: conversation.mode || 'auto',
        toolContext,
        conversationHistory: messagesForLLM
      })) {
        await streamer.handleEvent(event);

        if (event.type === 'approval_required') {
          pendingApprovals.push({
            action: event.name,
            params: event.args,
            description: event.message || `Выполнить ${event.name}`,
            agent: event.agent || 'unknown',
            dangerous: event.dangerous || false
          });
        }

        if (event.type === 'done') {
          finalResult = event;
        }
      }

      // 11. Save assistant response
      if (finalResult) {
        await unifiedStore.addMessage(conversation.id, {
          role: 'assistant',
          content: finalResult.content,
          agent: finalResult.agent,
          domain: finalResult.domain
        });

        // Update conversation metadata
        await unifiedStore.updateMetadata(conversation.id, {
          lastAgent: finalResult.agent,
          lastDomain: finalResult.domain
        });
      }

      // 12. Handle pending approvals with inline keyboard
      if (pendingApprovals.length > 0) {
        const plan = {
          steps: pendingApprovals,
          summary: `Требуется подтверждение для ${pendingApprovals.length} действий`
        };

        // Create pending plan
        const pendingPlan = await unifiedStore.createPendingPlan(
          conversation.id,
          plan,
          {
            source: 'telegram',
            telegramChatId: String(telegramChatId),
            agent: finalResult?.agent,
            domain: finalResult?.domain
          }
        );

        // Send inline keyboard
        await sendApprovalButtons(ctx, plan, pendingPlan.id);
      }

      const duration = Date.now() - startTime;
      logger.info({
        telegramChatId,
        conversationId: conversation.id,
        duration,
        agent: finalResult?.agent,
        pendingApprovals: pendingApprovals.length
      }, 'Telegram message processed');

      return {
        success: true,
        conversationId: conversation.id,
        content: finalResult?.content,
        agent: finalResult?.agent,
        pendingApprovals: pendingApprovals.length > 0 ? pendingApprovals : undefined
      };

    } finally {
      // Always release lock
      await unifiedStore.releaseLock(conversation.id);
    }

  } catch (error) {
    logger.error({ error: error.message, telegramChatId }, 'Telegram handler failed');

    logErrorToAdmin({
      error_type: 'api',
      raw_error: error.message || String(error),
      stack_trace: error.stack,
      action: 'telegram_chat_handler',
      severity: 'warning'
    }).catch(() => {});

    try {
      await ctx.reply(`❌ Произошла ошибка: ${error.message}`);
    } catch (e) {
      // Ignore reply errors
    }

    return { success: false, error: error.message };
  }
}

/**
 * Handle /clear command
 */
export async function handleClearCommand(ctx, telegramChatId) {
  try {
    const userAccount = await getUserAccountByTelegramId(telegramChatId);
    if (!userAccount) {
      return ctx.reply('❌ Аккаунт не найден.');
    }

    const conversation = await unifiedStore.getOrCreate({
      source: 'telegram',
      userAccountId: userAccount.id,
      telegramChatId: String(telegramChatId)
    });

    await unifiedStore.clearMessages(conversation.id);

    await ctx.reply('✅ История диалога очищена. Начинаем с чистого листа.');
    logger.info({ telegramChatId }, 'Conversation cleared');
  } catch (error) {
    logger.error({ error: error.message, telegramChatId }, 'Clear command failed');
    await ctx.reply(`❌ Ошибка: ${error.message}`);
  }
}

/**
 * Handle /mode command
 */
export async function handleModeCommand(ctx, telegramChatId, mode) {
  const validModes = ['auto', 'plan', 'ask'];

  if (!mode || !validModes.includes(mode)) {
    return ctx.reply(
      'Использование: /mode auto|plan|ask\n\n' +
      '• *auto* — выполняет действия автоматически\n' +
      '• *plan* — предлагает план, ждёт подтверждения\n' +
      '• *ask* — спрашивает перед каждым действием',
      { parse_mode: 'Markdown' }
    );
  }

  try {
    const userAccount = await getUserAccountByTelegramId(telegramChatId);
    if (!userAccount) {
      return ctx.reply('❌ Аккаунт не найден.');
    }

    const conversation = await unifiedStore.getOrCreate({
      source: 'telegram',
      userAccountId: userAccount.id,
      telegramChatId: String(telegramChatId)
    });

    await unifiedStore.setMode(conversation.id, mode);

    const modeLabels = {
      auto: '🚀 Автоматический',
      plan: '📋 Планирование',
      ask: '❓ С подтверждением'
    };

    await ctx.reply(`Режим изменён: ${modeLabels[mode]}`);
    logger.info({ telegramChatId, mode }, 'Mode changed');
  } catch (error) {
    logger.error({ error: error.message, telegramChatId }, 'Mode command failed');
    await ctx.reply(`❌ Ошибка: ${error.message}`);
  }
}

/**
 * Handle /status command
 */
export async function handleStatusCommand(ctx, telegramChatId) {
  try {
    const userAccount = await getUserAccountByTelegramId(telegramChatId);
    if (!userAccount) {
      return ctx.reply('❌ Аккаунт не найден.');
    }

    const conversation = await unifiedStore.getOrCreate({
      source: 'telegram',
      userAccountId: userAccount.id,
      telegramChatId: String(telegramChatId)
    });

    const messageCount = await unifiedStore.getMessageCount(conversation.id);
    const pendingPlan = await unifiedStore.getPendingPlan(conversation.id);

    const modeLabels = {
      auto: '🚀 Автоматический',
      plan: '📋 Планирование',
      ask: '❓ С подтверждением'
    };

    let status =
      `📊 *Статус диалога*\n\n` +
      `• Режим: ${modeLabels[conversation.mode] || conversation.mode}\n` +
      `• Сообщений: ${messageCount}\n` +
      `• Последний агент: ${conversation.last_agent || 'нет'}`;

    if (pendingPlan) {
      const steps = pendingPlan.plan_json?.steps || [];
      status += `\n\n⚠️ *Ожидает подтверждения:*\n`;
      for (const step of steps) {
        status += `• ${step.description || step.action}\n`;
      }
      status += `\nОтветьте "да" для выполнения или "нет" для отмены`;
    }

    await ctx.reply(status, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error({ error: error.message, telegramChatId }, 'Status command failed');
    await ctx.reply(`❌ Ошибка: ${error.message}`);
  }
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Find user account by telegram_id (checks all telegram_id fields)
 */
async function getUserAccountByTelegramId(telegramChatId) {
  const chatIdStr = String(telegramChatId);

  // Check all telegram_id columns
  const { data, error } = await supabase
    .from('user_accounts')
    .select('id, username, access_token, ad_account_id, telegram_id, multi_account_enabled')
    .or(`telegram_id.eq.${chatIdStr},telegram_id_2.eq.${chatIdStr},telegram_id_3.eq.${chatIdStr},telegram_id_4.eq.${chatIdStr}`)
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    logger.error({ error, telegramChatId }, 'Error finding user by telegram_id');
    return null;
  }

  if (!data) {
    return null;
  }

  // If multi-account enabled, get default ad_account
  if (data.multi_account_enabled) {
    const { data: adAccount } = await supabase
      .from('ad_accounts')
      .select('id, access_token')
      .eq('user_account_id', data.id)
      .eq('is_default', true)
      .single();

    if (adAccount) {
      data.default_ad_account_id = adAccount.id;
      if (adAccount.access_token) {
        data.access_token = adAccount.access_token;
      }
    }
  }

  return data;
}

/**
 * Get access token for user/ad account
 */
async function getAccessToken(userAccountId, adAccountId) {
  // First try ad_accounts
  if (adAccountId) {
    const { data: adAccount } = await supabase
      .from('ad_accounts')
      .select('access_token')
      .eq('id', adAccountId)
      .single();

    if (adAccount?.access_token) {
      return adAccount.access_token;
    }
  }

  // Fallback to user_accounts
  const { data: userAccount } = await supabase
    .from('user_accounts')
    .select('access_token')
    .eq('id', userAccountId)
    .single();

  return userAccount?.access_token || null;
}

/**
 * Get business context for the chat
 */
async function getBusinessContext(userAccount, adAccountId) {
  const context = {
    userAccountId: userAccount.id,
    adAccountId,
    username: userAccount.username
  };

  // Get today's basic metrics if available
  try {
    const today = new Date().toISOString().split('T')[0];

    const { data: todayMetrics } = await supabase
      .from('direction_metrics_daily')
      .select('spend, leads')
      .eq('ad_account_id', adAccountId)
      .eq('date', today);

    if (todayMetrics?.length > 0) {
      const totalSpend = todayMetrics.reduce((sum, m) => sum + parseFloat(m.spend || 0), 0);
      const totalLeads = todayMetrics.reduce((sum, m) => sum + parseInt(m.leads || 0), 0);

      context.todayMetrics = {
        spend: totalSpend,
        leads: totalLeads,
        cpl: totalLeads > 0 ? totalSpend / totalLeads : null
      };
    }
  } catch (e) {
    // Ignore metrics errors
  }

  return context;
}

export default {
  handleTelegramMessage,
  handleClearCommand,
  handleModeCommand,
  handleStatusCommand
};
