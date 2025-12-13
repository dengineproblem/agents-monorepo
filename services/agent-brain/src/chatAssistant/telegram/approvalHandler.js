/**
 * TelegramApprovalHandler - Handles inline keyboard for plan approval
 * Sends approval buttons and processes callbacks
 */

import { unifiedStore } from '../stores/unifiedStore.js';
import { planExecutor } from '../planExecutor.js';
import { logger } from '../../lib/logger.js';
import { supabase } from '../../lib/supabaseClient.js';

/**
 * Format plan for Telegram message
 */
function formatPlanMessage(plan) {
  let text = '📋 *Требуется подтверждение*\n\n';

  if (plan.summary) {
    text += `${plan.summary}\n\n`;
  }

  const steps = plan.steps || [];
  text += '*Действия:*\n';

  steps.forEach((step, i) => {
    const dangerous = step.dangerous ? '⚠️ ' : '';
    text += `${i + 1}. ${dangerous}${step.description || step.action}\n`;
  });

  if (plan.estimated_impact) {
    text += `\n💡 _${plan.estimated_impact}_`;
  }

  return text;
}

/**
 * Format execution result for Telegram message
 */
function formatExecutionResult(result) {
  if (result.success) {
    let text = '✅ *План выполнен успешно*\n\n';

    result.results.forEach((r, i) => {
      const icon = r.success ? '✓' : '✗';
      text += `${icon} ${r.description || r.action}\n`;
      if (r.message && r.success) {
        text += `   _${r.message}_\n`;
      }
    });

    return text;
  } else {
    let text = '⚠️ *План выполнен частично*\n\n';
    text += `${result.summary}\n\n`;

    result.results.forEach((r, i) => {
      const icon = r.success ? '✓' : '✗';
      text += `${icon} ${r.description || r.action}\n`;
      if (r.error) {
        text += `   ❌ _${r.error}_\n`;
      }
    });

    return text;
  }
}

/**
 * Get tool context from conversation
 */
async function getToolContext(conversation) {
  const { data: userAccount } = await supabase
    .from('user_accounts')
    .select('id')
    .eq('id', conversation.user_account_id)
    .single();

  // Get ad account
  let adAccountId = conversation.ad_account_id;

  if (!adAccountId) {
    const { data: defaultAd } = await supabase
      .from('ad_accounts')
      .select('id')
      .eq('user_account_id', conversation.user_account_id)
      .eq('is_default', true)
      .single();

    adAccountId = defaultAd?.id;
  }

  return {
    userAccountId: conversation.user_account_id,
    adAccountId
  };
}

/**
 * Send approval message with inline keyboard
 * @param {Object} ctx - Grammy/Telegraf context
 * @param {Object} plan - Plan object with steps
 * @param {string} planId - Plan UUID
 * @returns {Promise<Object>} Sent message
 */
export async function sendApprovalButtons(ctx, plan, planId) {
  const keyboard = {
    inline_keyboard: [
      [
        { text: '✅ Выполнить', callback_data: `approve:${planId}` },
        { text: '❌ Отменить', callback_data: `reject:${planId}` }
      ]
    ]
  };

  const text = formatPlanMessage(plan);

  try {
    const msg = await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });

    // Save message ID for later update
    await unifiedStore.updateTelegramMessageId(planId, msg.message_id, String(ctx.chat.id));

    logger.info({
      planId,
      messageId: msg.message_id,
      chatId: ctx.chat.id
    }, 'Sent approval buttons');

    return msg;
  } catch (error) {
    logger.error({ error: error.message, planId }, 'Error sending approval buttons');

    // Fallback: send without keyboard
    try {
      await ctx.reply(text + '\n\n_Ответьте "да" или "нет"_', {
        parse_mode: 'Markdown'
      });
    } catch (e) {
      logger.error({ error: e.message }, 'Fallback message also failed');
    }

    throw error;
  }
}

/**
 * Handle callback query from inline keyboard
 * @param {Object} ctx - Grammy/Telegraf context
 * @param {Object} callbackQuery - Callback query object
 * @returns {Promise<void>}
 */
export async function handleApprovalCallback(ctx, callbackQuery) {
  const data = callbackQuery.data;

  if (!data || (!data.startsWith('approve:') && !data.startsWith('reject:'))) {
    logger.warn({ data }, 'Unknown callback data');
    await ctx.answerCallbackQuery({ text: 'Неизвестное действие' });
    return;
  }

  const [action, planId] = data.split(':');

  logger.info({ action, planId, userId: callbackQuery.from?.id }, 'Processing approval callback');

  try {
    // Get plan
    const plan = await unifiedStore.getPendingPlanById(planId);

    if (!plan) {
      await ctx.answerCallbackQuery({ text: 'План не найден' });
      await ctx.editMessageText('❌ План не найден или истёк');
      return;
    }

    if (plan.status !== 'pending') {
      await ctx.answerCallbackQuery({ text: `План уже ${plan.status === 'approved' ? 'одобрен' : 'отклонён'}` });
      return;
    }

    if (action === 'approve') {
      // Acknowledge immediately
      await ctx.answerCallbackQuery({ text: '⏳ Выполняю план...' });

      // Update message to show progress
      await ctx.editMessageText('⏳ *Выполняю план...*', {
        parse_mode: 'Markdown'
      });

      // Approve plan
      await unifiedStore.approvePlan(planId);

      // Get tool context
      const conversation = await unifiedStore.getById(plan.conversation_id);
      const toolContext = await getToolContext(conversation);

      // Execute plan with progress updates
      const result = await planExecutor.executeFullPlan({
        planId,
        toolContext,
        onStepStart: async ({ step, index, total }) => {
          try {
            await ctx.editMessageText(
              `⏳ *Выполняю план...*\n\nШаг ${index + 1}/${total}: ${step.description || step.action}`,
              { parse_mode: 'Markdown' }
            );
          } catch (e) {
            // Ignore rate limit errors
          }
        }
      });

      // Show final result
      const resultText = formatExecutionResult(result);
      await ctx.editMessageText(resultText, {
        parse_mode: 'Markdown'
      });

      // Save result message to conversation
      await unifiedStore.addMessage(plan.conversation_id, {
        role: 'system',
        content: result.success
          ? `✅ План выполнен: ${result.summary}`
          : `⚠️ План выполнен частично: ${result.summary}`
      });

    } else if (action === 'reject') {
      // Reject plan
      await unifiedStore.rejectPlan(planId);

      await ctx.answerCallbackQuery({ text: 'План отменён' });
      await ctx.editMessageText('❌ *План отменён*', {
        parse_mode: 'Markdown'
      });

      // Save to conversation
      await unifiedStore.addMessage(plan.conversation_id, {
        role: 'system',
        content: '❌ План отменён пользователем'
      });
    }

  } catch (error) {
    logger.error({ error: error.message, planId, action }, 'Error handling approval callback');

    try {
      await ctx.answerCallbackQuery({ text: 'Ошибка выполнения' });
      await ctx.editMessageText(`❌ *Ошибка*\n\n${error.message}`, {
        parse_mode: 'Markdown'
      });
    } catch (e) {
      // Ignore
    }
  }
}

/**
 * Handle text-based approval (fallback for when buttons don't work)
 * @param {Object} ctx - Grammy/Telegraf context
 * @param {string} text - User's text message
 * @param {string} conversationId - Conversation UUID
 * @returns {Promise<boolean>} True if handled, false otherwise
 */
export async function handleTextApproval(ctx, text, conversationId) {
  const normalizedText = text.toLowerCase().trim();

  // Check for approval keywords
  const approveKeywords = ['да', 'yes', 'ок', 'ok', 'подтверждаю', 'выполнить', 'approve'];
  const rejectKeywords = ['нет', 'no', 'отмена', 'cancel', 'отменить', 'reject'];

  const isApprove = approveKeywords.some(k => normalizedText === k);
  const isReject = rejectKeywords.some(k => normalizedText === k);

  if (!isApprove && !isReject) {
    return false;
  }

  // Get pending plan for this conversation
  const plan = await unifiedStore.getPendingPlan(conversationId);

  if (!plan) {
    return false; // No pending plan
  }

  if (isApprove) {
    await ctx.reply('⏳ Выполняю план...');

    await unifiedStore.approvePlan(plan.id);

    const conversation = await unifiedStore.getById(conversationId);
    const toolContext = await getToolContext(conversation);

    const result = await planExecutor.executeFullPlan({
      planId: plan.id,
      toolContext
    });

    const resultText = formatExecutionResult(result);
    await ctx.reply(resultText, { parse_mode: 'Markdown' });

    return true;
  }

  if (isReject) {
    await unifiedStore.rejectPlan(plan.id);
    await ctx.reply('❌ План отменён');
    return true;
  }

  return false;
}

export default {
  sendApprovalButtons,
  handleApprovalCallback,
  handleTextApproval
};
