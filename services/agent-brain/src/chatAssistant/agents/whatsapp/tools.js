/**
 * WhatsAppAgent Tools - WhatsApp Dialogs
 * 4 tools: all READ
 */

export const WHATSAPP_TOOLS = [
  {
    name: 'getDialogs',
    description: `Получить список WhatsApp диалогов с лидами. Возвращает: имя лида, телефон, уровень интереса (hot/warm/cold), score (0-100), этап воронки, количество сообщений, дату последнего сообщения и краткое резюме диалога. Используй для: "покажи диалоги", "какие есть лиды в WhatsApp", "активные переписки"`,
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['active', 'inactive', 'all'],
          description: 'active = сообщения за последние 24ч, inactive = старше 24ч, all = все'
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
    description: `Получить историю сообщений конкретного WhatsApp диалога. Возвращает: текст сообщения, кто отправил (клиент/бот), тип (text/image/audio), время. Используй для: "покажи переписку с +7...", "что писал клиент", "история диалога"`,
    parameters: {
      type: 'object',
      properties: {
        contact_phone: {
          type: 'string',
          description: 'Номер телефона контакта (например: 79001234567)'
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
    description: `Получить AI-анализ диалога с клиентом. Возвращает: уровень интереса, score, этап воронки, ключевые интересы клиента, выявленные возражения, сигналы готовности к покупке, рекомендуемое следующее действие. Используй для: "проанализируй диалог", "что хочет клиент", "какие возражения у лида"`,
    parameters: {
      type: 'object',
      properties: {
        contact_phone: {
          type: 'string',
          description: 'Номер телефона контакта (например: 79001234567)'
        }
      },
      required: ['contact_phone']
    }
  },
  {
    name: 'searchDialogSummaries',
    description: `Полнотекстовый поиск по резюме всех диалогов. Поддерживает русский язык и фильтрацию по тегам. Возвращает: телефон, имя, резюме диалога, теги, score, этап воронки. Используй для: "найди кто жаловался на цену", "клиенты интересовавшиеся имплантацией", "диалоги с возражениями", "кто спрашивал про рассрочку"`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Поисковый запрос на русском (ищет по резюме диалогов)'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Фильтр по тегам (например: ["имплантация", "возражение:цена", "hot"])'
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
