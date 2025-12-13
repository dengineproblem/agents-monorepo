/**
 * WhatsAppAgent Tools - WhatsApp Dialogs
 * 4 tools: all READ
 */

export const WHATSAPP_TOOLS = [
  {
    name: 'getDialogs',
    description: 'Получить список WhatsApp диалогов с лидами',
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['active', 'inactive', 'all'],
          description: 'Фильтр по активности диалога'
        },
        limit: {
          type: 'number',
          description: 'Максимальное количество диалогов (по умолчанию 20)'
        }
      }
    }
  },
  {
    name: 'getDialogMessages',
    description: 'Получить сообщения конкретного WhatsApp диалога',
    parameters: {
      type: 'object',
      properties: {
        contact_phone: {
          type: 'string',
          description: 'Номер телефона контакта'
        },
        limit: {
          type: 'number',
          description: 'Количество последних сообщений (по умолчанию 50)'
        }
      },
      required: ['contact_phone']
    }
  },
  {
    name: 'analyzeDialog',
    description: 'Запросить AI-анализ диалога: интересы клиента, возражения, готовность к покупке, рекомендации',
    parameters: {
      type: 'object',
      properties: {
        contact_phone: {
          type: 'string',
          description: 'Номер телефона контакта'
        }
      },
      required: ['contact_phone']
    }
  },
  {
    name: 'searchDialogSummaries',
    description: 'Поиск по истории диалогов. Используй для вопросов типа "найди где жаловались на цену", "кто интересовался имплантацией", "покажи диалоги с возражениями"',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Поисковый запрос (по резюме диалогов)'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Фильтр по тегам (например: ["имплантация", "возражение:цена"])'
        },
        limit: {
          type: 'number',
          description: 'Максимальное количество результатов (по умолчанию 10)'
        }
      }
    }
  }
];

// WhatsApp agent has no write tools
export const WHATSAPP_WRITE_TOOLS = [];
