import type { FakeReport } from '../types/report.js';

/**
 * Форматирование отчета по шаблону agent-brain
 * Шаблон из services/agent-brain/src/server.js:1889-1958
 */
export function formatReport(report: FakeReport): string {
  const lines: string[] = [];

  // Заголовок
  lines.push('📊 ОТЧЁТ КЛИЕНТА');
  lines.push(`👤 User: ${report.username}`);
  lines.push(`🆔 ID: ${report.userId}`);
  lines.push(`🏷️ Ad Account ID: ${report.adAccountId}`);
  lines.push('━━━━━━━━━━━━━━━━');
  lines.push('');

  // Дата и статус
  lines.push(`📅 Дата отчета: ${report.date}`);
  lines.push('');
  lines.push(`🏢 Статус рекламного кабинета: ${report.accountStatus}`);
  lines.push('');

  // Общая сводка
  lines.push('📈 Общая сводка:');
  lines.push(`- Общие затраты по всем кампаниям: ${report.totalSpend.toFixed(2)} USD`);
  lines.push(`- Общее количество полученных лидов: ${report.totalLeads}`);
  lines.push(`- Общий CPL (стоимость за лид): ${report.totalCpl.toFixed(2)} USD`);
  lines.push(`- Общее количество качественных лидов: ${report.totalQualityLeads}`);
  lines.push(`- Общий CPL качественного лида: ${report.totalQualityCpl.toFixed(2)} USD`);
  lines.push('');

  // Сводка по кампаниям
  lines.push('📊 Сводка по отдельным кампаниям:');
  report.campaigns.forEach((campaign, index) => {
    lines.push(`${index + 1}. Кампания "${campaign.name}" (ID: ${campaign.id})`);
    lines.push(`   - Статус: ${campaign.status}`);
    lines.push(`   - Затраты: ${campaign.spend.toFixed(2)} USD`);
    lines.push(`   - Лидов: ${campaign.leads}`);
    lines.push(`   - CPL: ${campaign.cpl.toFixed(2)} USD`);
    lines.push(`   - Качественных лидов: ${campaign.qualityLeads}`);
    lines.push(`   - CPL качественного лида: ${campaign.qualityCpl.toFixed(2)} USD`);
    lines.push('');
  });

  // Качество лидов
  lines.push('📊 Качество лидов:');
  report.campaigns.forEach(campaign => {
    lines.push(`- "${campaign.name}": ${campaign.qualityPercent}% качественных лидов`);
  });
  lines.push('');

  // Выполненные действия
  lines.push('✅ Выполненные действия:');
  lines.push(formatActions(report.actionsText, report.campaigns));
  lines.push('');

  // Аналитика в динамике
  lines.push('📊 Аналитика в динамике:');
  lines.push(report.analyticsText);
  lines.push('');

  // Рекомендации
  lines.push('Для дальнейшей оптимизации обращаем внимание на:');
  lines.push(report.recommendationsText);

  return lines.join('\n');
}

/**
 * Форматирование раздела "Выполненные действия"
 */
function formatActions(actionsText: string, campaigns: any[]): string {
  const lines = actionsText.split('\n').filter(l => l.trim());

  // Если уже правильно форматировано - возвращаем как есть
  if (lines.some(l => l.match(/^\d+\./))) {
    return actionsText;
  }

  // Иначе - разбиваем по кампаниям
  const result: string[] = [];
  campaigns.forEach((campaign, index) => {
    result.push(`${index + 1}. Кампания "${campaign.name}":`);

    // Берем соответствующую часть текста (примерно)
    const startIdx = Math.floor(lines.length / campaigns.length * index);
    const endIdx = Math.floor(lines.length / campaigns.length * (index + 1));
    lines.slice(startIdx, endIdx).forEach(line => {
      result.push(`   - ${line}`);
    });
  });

  return result.join('\n');
}
