/**
 * TelegramStreamer - Handles streaming updates to Telegram messages
 * Uses debounce to avoid rate limiting
 */

import { logger } from '../lib/logger.js';

const DEBOUNCE_MS = 500;  // Edit message not more than once per 500ms
const MAX_MESSAGE_LENGTH = 4096;  // Telegram limit

// Tool name to user-friendly label mapping
const TOOL_LABELS = {
  // Ads
  getCampaigns: 'Загружаю кампании',
  getCampaignDetails: 'Получаю детали кампании',
  getAdSets: 'Загружаю адсеты',
  getSpendReport: 'Формирую отчёт по расходам',
  getDirections: 'Загружаю направления',
  getDirectionDetails: 'Получаю детали направления',
  getDirectionMetrics: 'Анализирую метрики направления',
  pauseCampaign: 'Ставлю кампанию на паузу',
  resumeCampaign: 'Возобновляю кампанию',
  pauseAdSet: 'Ставлю адсет на паузу',
  resumeAdSet: 'Возобновляю адсет',
  updateBudget: 'Обновляю бюджет',
  updateDirectionBudget: 'Обновляю бюджет направления',
  updateDirectionTargetCPL: 'Обновляю целевой CPL',
  pauseDirection: 'Ставлю направление на паузу',

  // Creatives
  getCreatives: 'Загружаю креативы',
  getCreativeDetails: 'Получаю детали креатива',
  getCreativeMetrics: 'Анализирую метрики креатива',
  getCreativeAnalysis: 'Получаю анализ креатива',
  getTopCreatives: 'Ищу лучшие креативы',
  getWorstCreatives: 'Ищу худшие креативы',
  compareCreatives: 'Сравниваю креативы',
  triggerCreativeAnalysis: 'Запускаю анализ креатива',
  launchCreative: 'Запускаю креатив',
  pauseCreative: 'Ставлю креатив на паузу',

  // WhatsApp
  getDialogs: 'Загружаю диалоги',
  getDialogMessages: 'Загружаю сообщения',
  analyzeDialog: 'Анализирую диалог',

  // CRM
  getLeads: 'Загружаю лиды',
  getLeadDetails: 'Получаю детали лида',
  getFunnelStats: 'Анализирую воронку'
};

export class TelegramStreamer {
  /**
   * @param {Object} ctx - Telegram context (grammY or telegraf)
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.chatId = ctx.chat.id;
    this.messageId = null;
    this.currentText = '';
    this.toolStatus = '';
    this.lastUpdateTime = 0;
    this.pendingUpdate = null;
    this.isFinished = false;
  }

  /**
   * Start streaming - send initial placeholder message
   */
  async start() {
    try {
      // __skipMirror: placeholder is replaced by streaming edits; final content is mirrored
      // via the mirrorHook('assistant', finalResult.content) call in telegramHandler.js
      const msg = await this.ctx.reply('⏳ Обрабатываю запрос...', { __skipMirror: true });
      this.messageId = msg.message_id;
      return this;
    } catch (error) {
      logger.error({ error: error.message }, 'Failed to start telegram streamer');
      throw error;
    }
  }

  /**
   * Handle stream event from orchestrator
   */
  async handleEvent(event) {
    if (this.isFinished) return;

    switch (event.type) {
      case 'classification':
        // Optional: show which agent is handling
        // this.toolStatus = `\n\n_${this.getDomainLabel(event.domain)}_`;
        // this.scheduleUpdate();
        break;

      case 'text':
        this.currentText = event.accumulated;
        this.scheduleUpdate();
        break;

      case 'tool_start':
        this.toolStatus = `\n\n🔍 _${this.getToolLabel(event.name)}..._`;
        this.scheduleUpdate();
        break;

      case 'tool_result':
        // Clear tool status, text will continue
        this.toolStatus = '';
        break;

      case 'approval_required':
        this.toolStatus = `\n\n⚠️ *Требуется подтверждение:* ${event.name}`;
        await this.forceUpdate();
        break;

      case 'done':
        this.currentText = event.content || this.currentText;
        this.toolStatus = '';
        this.isFinished = true;
        await this.forceUpdate();
        break;

      case 'error':
        this.currentText = `❌ Произошла ошибка: ${event.error}`;
        this.toolStatus = '';
        this.isFinished = true;
        await this.forceUpdate();
        break;
    }
  }

  /**
   * Schedule a debounced update
   */
  scheduleUpdate() {
    const now = Date.now();

    // If enough time has passed, update immediately
    if (now - this.lastUpdateTime >= DEBOUNCE_MS) {
      this.doUpdate();
    } else if (!this.pendingUpdate) {
      // Schedule update for later
      const delay = DEBOUNCE_MS - (now - this.lastUpdateTime);
      this.pendingUpdate = setTimeout(() => {
        this.pendingUpdate = null;
        this.doUpdate();
      }, delay);
    }
    // If there's already a pending update, it will include our changes
  }

  /**
   * Force an immediate update (for important events)
   */
  async forceUpdate() {
    if (this.pendingUpdate) {
      clearTimeout(this.pendingUpdate);
      this.pendingUpdate = null;
    }
    await this.doUpdate();
  }

  /**
   * Perform the actual message update
   */
  async doUpdate() {
    if (!this.messageId) return;

    this.lastUpdateTime = Date.now();

    let text = this.currentText + this.toolStatus;

    // Handle empty text
    if (!text.trim()) {
      text = '⏳ Обрабатываю...';
    }

    // Truncate if too long
    if (text.length > MAX_MESSAGE_LENGTH) {
      text = text.substring(0, MAX_MESSAGE_LENGTH - 100) + '\n\n_...сообщение обрезано_';
    }

    try {
      await this.ctx.api.editMessageText(
        this.chatId,
        this.messageId,
        text,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      // Ignore "message not modified" errors - they're expected
      if (!error.message?.includes('message is not modified')) {
        // Also ignore "message to edit not found" - message might be deleted
        if (!error.message?.includes('message to edit not found')) {
          logger.warn({ error: error.message }, 'Failed to update telegram message');
        }
      }
    }
  }

  /**
   * Get user-friendly label for tool name
   */
  getToolLabel(toolName) {
    return TOOL_LABELS[toolName] || `Выполняю ${toolName}`;
  }

  /**
   * Get user-friendly label for domain
   */
  getDomainLabel(domain) {
    const labels = {
      ads: '📊 Реклама',
      creative: '🎨 Креативы',
      whatsapp: '💬 WhatsApp',
      crm: '👥 CRM',
      mixed: '🔄 Комплексный анализ'
    };
    return labels[domain] || domain;
  }

  /**
   * Cleanup - cancel any pending updates
   */
  cleanup() {
    if (this.pendingUpdate) {
      clearTimeout(this.pendingUpdate);
      this.pendingUpdate = null;
    }
  }
}

/**
 * Helper: Process stream with telegram updates
 * @param {Object} ctx - Telegram context
 * @param {AsyncGenerator} stream - Stream from orchestrator
 * @returns {Object} Final result
 */
export async function streamToTelegram(ctx, stream) {
  const streamer = await new TelegramStreamer(ctx).start();
  let finalResult = null;

  try {
    for await (const event of stream) {
      await streamer.handleEvent(event);

      if (event.type === 'done') {
        finalResult = event;
      }
    }
  } finally {
    streamer.cleanup();
  }

  return finalResult;
}
