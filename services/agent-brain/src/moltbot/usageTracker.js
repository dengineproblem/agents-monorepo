/**
 * Автоматический трекинг usage из Moltbot embedded runs
 *
 * Читает логи Moltbot через Docker API, извлекает usage данные и отправляет в trackUsage()
 */

import http from 'http';
import { trackUsage } from '../lib/usageLimits.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ module: 'moltbotUsageTracker' });

// Хранилище уже обработанных runId
const processedRuns = new Set();

/**
 * Получает логи контейнера через Docker HTTP API
 */
async function getContainerLogs(containerName, tail = 1000) {
  return new Promise((resolve, reject) => {
    const options = {
      socketPath: '/var/run/docker.sock',
      path: `/containers/${containerName}/logs?stdout=true&stderr=true&tail=${tail}`,
      method: 'GET'
    };

    const req = http.request(options, (res) => {
      const chunks = [];

      res.on('data', (chunk) => {
        chunks.push(chunk);
      });

      res.on('end', () => {
        // Docker API возвращает логи с 8-байтным header для каждой строки
        // Формат: [stream_type(1)][padding(3)][size(4)][payload]
        // Упрощенный парсинг - просто удаляем все headers
        const buffer = Buffer.concat(chunks);
        const lines = [];
        let offset = 0;

        while (offset < buffer.length) {
          if (offset + 8 > buffer.length) break;

          const size = buffer.readUInt32BE(offset + 4);

          if (offset + 8 + size > buffer.length) {
            log.warn({ offset, size, bufferLength: buffer.length }, 'Incomplete frame, breaking');
            break;
          }

          const payload = buffer.slice(offset + 8, offset + 8 + size).toString('utf8');
          lines.push(payload);

          offset += 8 + size;
        }
        resolve(lines.join('\n'));
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Timeout reading container logs'));
    });

    req.end();
  });
}

/**
 * Парсит логи Moltbot и извлекает usage данные из завершённых runs
 */
async function parseMoltbotLogs() {
  try {
    log.info('Starting log parsing cycle');

    // Читаем последние 1000 строк логов Moltbot
    const stdout = await getContainerLogs('moltbot', 1000);
    const lines = stdout.split('\n');

    log.debug({ totalLines: lines.length }, 'Got log lines');

    const runs = new Map(); // runId → runData
    let lastTelegramId = null; // Запоминаем последний встреченный telegramId

    for (const line of lines) {
      if (!line.trim()) continue;

      // Логи Moltbot - это текстовые строки, не JSON
      // Формат: TIMESTAMP [subsystem] message

      // Ищем telegram Chat ID из inbound сообщений (может быть ДО embedded run start)
      if (line.includes('telegram inbound') && line.includes('chatId=')) {
        const match = line.match(/chatId=(\d+)/);
        if (match) {
          lastTelegramId = match[1];
        }
      }

      // Ищем embedded run start с telegram channel
      if (line.includes('embedded run start') && line.includes('messageChannel=telegram')) {
        const match = line.match(/runId=([a-f0-9-]+).*provider=([^\s]+)\s+model=([^\s]+)/);
        if (match) {
          const [, runId, provider, model] = match;
          runs.set(runId, {
            runId,
            provider,
            model: `${provider}/${model}`.replace('//', '/'), // Нормализуем
            telegramId: lastTelegramId, // Используем последний встреченный telegramId
            usage: null,
            completed: false
          });
          lastTelegramId = null; // Сбрасываем после использования
        }
      }

      // Ищем embedded run done (завершение)
      if (line.includes('embedded run done')) {
        const match = line.match(/runId=([a-f0-9-]+)/);
        if (match) {
          const runId = match[1];
          const runData = runs.get(runId);
          if (runData) {
            runData.completed = true;
          }
        }
      }
    }

    // Теперь ищем usage данные для завершённых runs
    // Usage данные приходят ПОСЛЕ embedded run done в response от OpenAI
    const completedRuns = Array.from(runs.values()).filter(r => r.completed && r.telegramId);

    log.info({
      totalRuns: runs.size,
      completedRuns: completedRuns.length,
      processedCount: processedRuns.size
    }, 'Parsed runs');

    // Для каждого завершённого run пытаемся найти usage в логах
    for (const run of completedRuns) {
      if (processedRuns.has(run.runId)) {
        continue; // Уже обработали этот run
      }

      // Ищем usage данные в логах около времени завершения run
      // OpenAI API возвращает usage в ответе
      // Пытаемся найти строки с usage рядом с runId
      let usageFound = false;

      for (const line of lines) {
        // Ищем упоминания usage в логах (текстовый формат)
        if (line.includes(run.runId) || line.includes('usage')) {
          // Проверяем есть ли usage данные в этой строке
          if (line.includes('prompt_tokens') && line.includes('completion_tokens')) {
            // Пытаемся извлечь usage
            const promptMatch = line.match(/prompt_tokens["\s:=]+(\d+)/);
            const completionMatch = line.match(/completion_tokens["\s:=]+(\d+)/);

            if (promptMatch && completionMatch) {
              run.usage = {
                prompt_tokens: parseInt(promptMatch[1]),
                completion_tokens: parseInt(completionMatch[1])
              };
              usageFound = true;
              break;
            }
          }
        }
      }

      // Если usage не найден - используем примерную оценку
      // Для GPT-5.2 средний запрос ~10000 prompt tokens, ~500 completion tokens
      if (!usageFound) {
        log.warn({ runId: run.runId }, 'Usage data not found in logs, using approximation');
        run.usage = {
          prompt_tokens: 10000, // Примерная оценка
          completion_tokens: 500
        };
      }

      // Отправляем usage в trackUsage
      if (run.usage && run.telegramId) {
        try {
          await trackUsage(run.telegramId, run.model, run.usage);
          processedRuns.add(run.runId);

          log.info({
            runId: run.runId,
            telegramId: run.telegramId,
            model: run.model,
            prompt_tokens: run.usage.prompt_tokens,
            completion_tokens: run.usage.completion_tokens
          }, 'Auto-tracked usage from Moltbot run');
        } catch (error) {
          log.error({
            error: error.message,
            runId: run.runId,
            telegramId: run.telegramId
          }, 'Failed to track usage from Moltbot run');
        }
      }
    }

    // Очищаем processedRuns если он слишком большой (храним только последние 1000)
    if (processedRuns.size > 1000) {
      const toDelete = Array.from(processedRuns).slice(0, processedRuns.size - 1000);
      toDelete.forEach(id => processedRuns.delete(id));
    }

  } catch (error) {
    log.error({ error: error.message }, 'Error parsing Moltbot logs');
  }
}

/**
 * Запускает периодический трекинг usage
 */
export function startMoltbotUsageTracking(intervalMs = 15000) {
  log.info({ intervalMs }, 'Starting Moltbot usage tracking');

  // Первый запуск сразу
  parseMoltbotLogs().catch(err => {
    log.error({ error: err.message, stack: err.stack }, 'Error in initial parseMoltbotLogs');
  });

  // Затем каждые intervalMs миллисекунд
  setInterval(() => {
    parseMoltbotLogs().catch(err => {
      log.error({ error: err.message, stack: err.stack }, 'Error in periodic parseMoltbotLogs');
    });
  }, intervalMs);

  log.info('Moltbot usage tracking started successfully');
}
