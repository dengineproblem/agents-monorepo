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
      await memoryStore.addNote(
        context.userAccountId,
        context.adAccountId,
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
      const removedCount = await memoryStore.removeNoteByText(
        context.userAccountId,
        context.adAccountId,
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
      const allNotes = await memoryStore.getAllNotes(
        context.userAccountId,
        context.adAccountId
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
