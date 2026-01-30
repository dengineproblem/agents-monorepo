import { sendMessage } from './telegramApi.js';
import { generateFakeReport } from './reportGenerator.js';
import { formatReport } from '../utils/formatters.js';
import type { TelegramMessage } from '../types/telegram.js';
import type { GenerateReportRequest } from '../types/report.js';

/**
 * Обработка входящего сообщения от Telegram
 */
export async function handleTelegramMessage(message: TelegramMessage): Promise<void> {
  const chatId = message.chat.id;
  const text = message.text?.trim();

  if (!text) {
    return; // Игнорируем не-текстовые сообщения
  }

  console.log('[Handler] Received message from chat:', chatId);
  console.log('[Handler] Text:', text);

  // Парсим команду
  const request = parseCommand(text);

  if (!request) {
    console.log('[Handler] Invalid command format');
    await sendMessage(chatId,
      '❌ Неверный формат команды.\n\n' +
      'Используйте:\n' +
      '/generate <ниша> <плановый CPL>\n\n' +
      'Примеры:\n' +
      '/generate Стоматология 2.50\n' +
      '/generate "Юридические услуги" 3.00\n' +
      '/generate Фитнес 1.80'
    );
    return;
  }

  console.log('[Handler] Parsed request:', request);

  // Отправляем уведомление о начале генерации
  await sendMessage(chatId,
    `⏳ Генерирую отчет для ниши: ${request.niche}\n` +
    `📊 Плановый CPL: ${request.targetCpl.toFixed(2)} USD\n\n` +
    `Пожалуйста, подождите...`
  );

  try {
    console.log('[Handler] Starting report generation...');

    // Генерируем отчет
    const report = await generateFakeReport(request);

    // Форматируем отчет
    const reportText = formatReport(report);

    console.log('[Handler] Report generated, sending to chat...');

    // Отправляем отчет
    await sendMessage(chatId, reportText);

    console.log('[Handler] Report sent successfully');

  } catch (error: any) {
    console.error('[Handler] Error generating report:', error);

    await sendMessage(chatId,
      `❌ Ошибка при генерации отчета: ${error.message}\n\n` +
      `Попробуйте еще раз позже.`
    );
  }
}

/**
 * Парсинг команды пользователя
 */
function parseCommand(text: string): GenerateReportRequest | null {
  // Формат 1: /generate Стоматология 2.50
  const cmdMatch = text.match(/^\/generate\s+([^0-9]+?)\s+([\d.]+)\s*$/i);
  if (cmdMatch) {
    const niche = cmdMatch[1].trim();
    const targetCpl = parseFloat(cmdMatch[2]);

    if (niche && !isNaN(targetCpl) && targetCpl > 0) {
      return { niche, targetCpl };
    }
  }

  // Формат 2: /generate "Юридические услуги" 3.00
  const quotedMatch = text.match(/^\/generate\s+"([^"]+)"\s+([\d.]+)\s*$/i);
  if (quotedMatch) {
    const niche = quotedMatch[1].trim();
    const targetCpl = parseFloat(quotedMatch[2]);

    if (niche && !isNaN(targetCpl) && targetCpl > 0) {
      return { niche, targetCpl };
    }
  }

  // Формат 3: текстовый ввод без команды
  // ниша: Стоматология, плановый CPL: 2.50
  const textMatch = text.match(/ниша:\s*([^,]+),?\s*(?:плановый\s+)?CPL:\s*([\d.]+)/i);
  if (textMatch) {
    const niche = textMatch[1].trim();
    const targetCpl = parseFloat(textMatch[2]);

    if (niche && !isNaN(targetCpl) && targetCpl > 0) {
      return { niche, targetCpl };
    }
  }

  return null;
}
