/**
 * Memory Management Tools
 * Tools for managing mid-term memory through chat
 */

import { memoryStore } from '../stores/memoryStore.js';
import { logger } from '../../lib/logger.js';

/**
 * Tool definitions for memory management
 */
export const MEMORY_TOOLS = [
  {
    name: 'rememberNote',
    description: 'Запомнить важную информацию о бизнесе. Используй когда пользователь явно просит запомнить что-то.',
    parameters: {
      type: 'object',
      properties: {
        note: {
          type: 'string',
          description: 'Текст заметки для запоминания'
        },
        domain: {
          type: 'string',
          enum: ['ads', 'creative', 'whatsapp', 'crm'],
          description: 'Категория заметки: ads (реклама), creative (креативы), whatsapp (диалоги), crm (лиды)'
        },
        importance: {
          type: 'number',
          description: 'Важность от 0 до 1 (по умолчанию 0.7)',
          minimum: 0,
          maximum: 1
        }
      },
      required: ['note', 'domain']
    }
  },
  {
    name: 'forgetNote',
    description: 'Забыть ранее запомненную информацию. Используй когда пользователь просит забыть что-то конкретное.',
    parameters: {
      type: 'object',
      properties: {
        searchText: {
          type: 'string',
          description: 'Текст для поиска заметки (частичное совпадение)'
        }
      },
      required: ['searchText']
    }
  },
  {
    name: 'listNotes',
    description: 'Показать все запомненные заметки. Используй когда пользователь спрашивает что ты помнишь.',
    parameters: {
      type: 'object',
      properties: {
        domain: {
          type: 'string',
          enum: ['ads', 'creative', 'whatsapp', 'crm', 'all'],
          description: 'Категория заметок или "all" для всех'
        }
      },
      required: []
    }
  },
  {
    name: 'saveCampaignMapping',
    description: 'Сохранить маппинг кампании для ручного режима. Вызывай после получения информации от пользователя о направлениях и целевом CPL. Используется когда у пользователя нет созданных направлений (directions) в системе. Если маппинг для этого campaign_id уже существует — он будет обновлён.',
    parameters: {
      type: 'object',
      properties: {
        campaign_id: {
          type: 'string',
          description: 'Facebook Campaign ID (например: 120212345678901234)',
          minLength: 1
        },
        campaign_name: {
          type: 'string',
          description: 'Название кампании (для читаемости)'
        },
        direction_name: {
          type: 'string',
          description: 'Название направления/услуги (Имплантация, Ремонт квартир и т.д.)',
          minLength: 1
        },
        goal: {
          type: 'string',
          enum: ['whatsapp', 'site', 'lead_form', 'other'],
          description: 'Цель кампании: whatsapp (лиды в WhatsApp), site (лиды с сайта), lead_form (формы Facebook), other'
        },
        target_cpl_cents: {
          type: 'number',
          description: 'Целевой CPL в центах (5000 = $50, 1500 = $15). Диапазон: 10-100000 центов ($0.10 - $1000)',
          minimum: 10,
          maximum: 100000
        }
      },
      required: ['campaign_id', 'direction_name', 'target_cpl_cents']
    }
  }
];

/**
 * Handlers for memory tools
 */
export const memoryHandlers = {
  /**
   * Remember a note
   */
  async rememberNote({ note, domain, importance = 0.7 }, context) {
    try {
      // Use adAccountDbId (UUID) for database queries
      await memoryStore.addNote(
        context.userAccountId,
        context.adAccountDbId || null,
        domain,
        {
          text: note,
          source: { type: 'user_command', ref: 'rememberNote' },
          importance
        }
      );

      logger.info({
        userAccountId: context.userAccountId,
        domain,
        note: note.slice(0, 50)
      }, 'Note remembered via command');

      return {
        success: true,
        message: `Запомнил: "${note}" (категория: ${domain})`
      };
    } catch (error) {
      logger.error({ error: error.message }, 'Failed to remember note');
      return {
        success: false,
        error: `Не удалось запомнить: ${error.message}`
      };
    }
  },

  /**
   * Forget notes matching text
   */
  async forgetNote({ searchText }, context) {
    try {
      // Use adAccountDbId (UUID) for database queries
      const removedCount = await memoryStore.removeNoteByText(
        context.userAccountId,
        context.adAccountDbId || null,
        searchText
      );

      logger.info({
        userAccountId: context.userAccountId,
        searchText,
        removedCount
      }, 'Notes forgotten via command');

      if (removedCount === 0) {
        return {
          success: true,
          message: `Не нашёл заметок с текстом "${searchText}"`
        };
      }

      return {
        success: true,
        message: `Забыл ${removedCount} заметок по запросу "${searchText}"`
      };
    } catch (error) {
      logger.error({ error: error.message }, 'Failed to forget note');
      return {
        success: false,
        error: `Не удалось забыть: ${error.message}`
      };
    }
  },

  /**
   * List all notes
   */
  async listNotes({ domain = 'all' }, context) {
    try {
      // Use adAccountDbId (UUID) for database queries
      const allNotes = await memoryStore.getAllNotes(
        context.userAccountId,
        context.adAccountDbId || null
      );

      const domains = domain === 'all'
        ? ['ads', 'creative', 'whatsapp', 'crm']
        : [domain];

      const result = {};
      let totalCount = 0;

      for (const d of domains) {
        const notes = allNotes[d]?.notes || [];
        result[d] = notes.map(n => ({
          text: n.text,
          importance: n.importance,
          created: n.created_at
        }));
        totalCount += notes.length;
      }

      logger.info({
        userAccountId: context.userAccountId,
        domain,
        totalCount
      }, 'Notes listed via command');

      return {
        success: true,
        total: totalCount,
        notes: result
      };
    } catch (error) {
      logger.error({ error: error.message }, 'Failed to list notes');
      return {
        success: false,
        error: `Не удалось получить заметки: ${error.message}`
      };
    }
  },

  /**
   * Save campaign mapping for manual mode (users without directions)
   * Stores campaign → direction → target CPL mapping in agent_notes.ads
   * If mapping for this campaign_id already exists, it will be updated (old removed, new added)
   */
  async saveCampaignMapping({ campaign_id, campaign_name, direction_name, goal, target_cpl_cents }, context) {
    try {
      // Validate target_cpl_cents
      if (typeof target_cpl_cents !== 'number' || target_cpl_cents <= 0) {
        return {
          success: false,
          error: 'Target CPL должен быть положительным числом (в центах, например 5000 = $50)'
        };
      }

      // Reasonable bounds check: $0.10 - $1000
      if (target_cpl_cents < 10 || target_cpl_cents > 100000) {
        return {
          success: false,
          error: 'Target CPL должен быть от $0.10 до $1000 (10-100000 центов)'
        };
      }

      // Remove existing mapping for this campaign_id if any (upsert behavior)
      const existingMappingSearch = `CAMPAIGN_MAPPING:{"campaign_id":"${campaign_id}"`;
      await memoryStore.removeNoteByText(
        context.userAccountId,
        context.adAccountDbId || null,
        existingMappingSearch
      );

      const mapping = {
        campaign_id,
        campaign_name: campaign_name || null,
        direction_name,
        goal: goal || 'other',
        target_cpl_cents
      };

      const noteText = `CAMPAIGN_MAPPING:${JSON.stringify(mapping)}`;

      // Use adAccountDbId (UUID) for database queries
      await memoryStore.addNote(
        context.userAccountId,
        context.adAccountDbId || null,
        'ads',
        {
          text: noteText,
          source: { type: 'user_input', ref: 'manual_mode_mapping' },
          importance: 0.9
        }
      );

      const cplDisplay = `$${(target_cpl_cents / 100).toFixed(2)}`;
      const displayName = campaign_name || campaign_id;

      logger.info({
        userAccountId: context.userAccountId,
        campaign_id,
        direction_name,
        target_cpl_cents
      }, 'Campaign mapping saved for manual mode');

      return {
        success: true,
        message: `Запомнил: ${displayName} = ${direction_name}, Target CPL ${cplDisplay}`
      };
    } catch (error) {
      logger.error({ error: error.message }, 'Failed to save campaign mapping');
      return {
        success: false,
        error: `Не удалось сохранить маппинг: ${error.message}`
      };
    }
  }
};

/**
 * Check if message is a memory command
 * @param {string} message - User message
 * @returns {Object|null} Parsed command or null
 */
export function parseMemoryCommand(message) {
  const lowerMessage = message.toLowerCase().trim();

  // "Запомни: ..."
  if (lowerMessage.startsWith('запомни:') || lowerMessage.startsWith('запомни ')) {
    const note = message.replace(/^запомни[:\s]+/i, '').trim();
    if (note) {
      return { type: 'remember', note };
    }
  }

  // "Забудь: ..."
  if (lowerMessage.startsWith('забудь:') || lowerMessage.startsWith('забудь ')) {
    const searchText = message.replace(/^забудь[:\s]+/i, '').trim();
    if (searchText) {
      return { type: 'forget', searchText };
    }
  }

  // "Что ты помнишь?" / "Покажи заметки"
  if (
    lowerMessage.includes('что ты помнишь') ||
    lowerMessage.includes('что помнишь') ||
    lowerMessage.includes('покажи заметки') ||
    lowerMessage.includes('список заметок') ||
    lowerMessage.includes('все заметки')
  ) {
    return { type: 'list' };
  }

  return null;
}

/**
 * Determine domain from note content
 * @param {string} note - Note text
 * @returns {string} Domain
 */
export function inferDomain(note) {
  const lowerNote = note.toLowerCase();

  if (lowerNote.includes('cpl') || lowerNote.includes('бюджет') ||
      lowerNote.includes('кампани') || lowerNote.includes('реклам') ||
      lowerNote.includes('таргет')) {
    return 'ads';
  }

  if (lowerNote.includes('креатив') || lowerNote.includes('видео') ||
      lowerNote.includes('баннер') || lowerNote.includes('хук') ||
      lowerNote.includes('угол')) {
    return 'creative';
  }

  if (lowerNote.includes('диалог') || lowerNote.includes('whatsapp') ||
      lowerNote.includes('переписк') || lowerNote.includes('сообщени') ||
      lowerNote.includes('возражени')) {
    return 'whatsapp';
  }

  if (lowerNote.includes('лид') || lowerNote.includes('воронк') ||
      lowerNote.includes('сделк') || lowerNote.includes('клиент') ||
      lowerNote.includes('этап')) {
    return 'crm';
  }

  // Default to ads for general business notes
  return 'ads';
}
