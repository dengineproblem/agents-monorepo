/**
 * WhatsAppAgent Tools - WhatsApp Dialogs
 * 3 tools: all READ
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
  }
];

// WhatsApp agent has no write tools
export const WHATSAPP_WRITE_TOOLS = [];
