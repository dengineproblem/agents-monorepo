/**
 * Форматтеры результатов tools → Telegram Markdown.
 * Порт из services/telegram-claude-bot/src/menu.ts
 */

import { extractToolResult, type ToolResult } from './tools.js';

function escapeMd(text: string): string {
  return String(text ?? '').replace(/([*_`\[\]])/g, '\\$1');
}

export function formatSpendReport(result: ToolResult, periodLabel: string): string {
  const ex = extractToolResult(result);
  if (!ex.ok) return `❌ Не удалось получить статистику: ${ex.error}`;
  const data = ex.data;

  const lines: string[] = [`📊 *Статистика за ${periodLabel}*\n`];

  const t = data.totals || data.total;
  if (t) {
    if (t.spend != null) lines.push(`💰 Расход: *$${Number(t.spend).toFixed(2)}*`);
    if (t.leads != null) lines.push(`📩 Лиды: *${t.leads}*`);
    if (t.cpl != null) lines.push(`📊 CPL: *$${Number(t.cpl).toFixed(2)}*`);
    if (t.impressions != null) lines.push(`👁 Показы: *${Number(t.impressions).toLocaleString()}*`);
    if (t.clicks != null) lines.push(`🖱 Клики: *${t.clicks}*`);
    lines.push('');
  }

  const rows = data.data || data.campaigns || data.rows || [];
  if (Array.isArray(rows) && rows.length > 1) {
    lines.push('*Подробно:*');
    for (const c of rows.slice(0, 10)) {
      const label = escapeMd(c.campaign_name || c.name || c.date || 'N/A');
      const spend = c.spend != null ? `$${Number(c.spend).toFixed(2)}` : '-';
      const leads = c.leads != null ? `${c.leads} лидов` : '';
      const cplVal = c.leads > 0 && c.spend > 0 ? `CPL $${(c.spend / c.leads).toFixed(2)}` : '';
      const parts = [spend, leads, cplVal].filter(Boolean).join(' | ');
      lines.push(`• ${label}: ${parts}`);
    }
    if (rows.length > 10) {
      lines.push(`... и ещё ${rows.length - 10}`);
    }
  }

  if (!t && rows.length === 0) {
    lines.push('Нет данных за этот период.');
  }

  return lines.join('\n');
}

export function formatDirections(result: ToolResult): string {
  const ex = extractToolResult(result);
  if (!ex.ok) return `❌ Ошибка: ${ex.error}`;

  const d = ex.data;
  const dirs = d.directions || (Array.isArray(d) ? d : []);
  if (!Array.isArray(dirs) || dirs.length === 0) return '📋 Направлений пока нет.';

  const lines = ['📋 *Направления:*\n'];
  for (const dir of dirs) {
    const status = dir.status === 'active' ? '🟢' : '🔴';
    const name = escapeMd(dir.name || 'N/A');
    const parts: string[] = [];
    if (dir.budget_per_day) parts.push(`$${dir.budget_per_day}/день`);
    if (dir.target_cpl) parts.push(`CPL $${dir.target_cpl}`);
    lines.push(`${status} *${name}*${parts.length ? ` (${parts.join(', ')})` : ''}`);
  }

  return lines.join('\n');
}

export function formatCreativesForManualLaunch(result: ToolResult, directionName: string): string {
  const ex = extractToolResult(result);
  if (!ex.ok) return `❌ Ошибка: ${ex.error}`;

  const d = ex.data;
  const creatives = d.creatives || (Array.isArray(d) ? d : []);
  if (!Array.isArray(creatives) || creatives.length === 0) {
    return `В направлении "${escapeMd(directionName)}" нет креативов.`;
  }

  const lines = [
    `🎨 *Креативы направления "${escapeMd(directionName)}":*\n`,
    'Для запуска напишите номера креативов и бюджет.',
    'Пример: `1, 3, 5 бюджет $10`\n',
  ];

  creatives.forEach((c: any, i: number) => {
    const name = escapeMd(c.name || c.title || c.filename || 'Без имени');
    const icon = c.media_type === 'video' ? '🎬' : '🖼';
    const status = c.status === 'ready' || c.status === 'active' ? '🟢' : '⏸';
    lines.push(`${i + 1}. ${status} ${icon} ${name}`);
    lines.push(`   ID: \`${c.id}\``);
  });

  return lines.join('\n');
}

export function formatOptimizationResult(result: ToolResult): string {
  const ex = extractToolResult(result);
  if (!ex.ok) return `❌ Ошибка оптимизации: ${ex.error}`;

  const data = ex.data;
  const lines = ['⚡ *Результаты оптимизации:*\n'];

  if (data.proposals && Array.isArray(data.proposals)) {
    if (data.proposals.length === 0) {
      lines.push('Рекомендаций нет — всё работает хорошо.');
    } else {
      for (const p of data.proposals) {
        const icon = p.action === 'pauseAdSet' || p.action === 'pauseAd' ? '⏸'
          : p.action === 'updateBudget' ? '💰'
          : p.action === 'createAdSet' ? '🚀'
          : p.action === 'review' ? '🔍'
          : '🔧';
        const name = p.direction_name || p.entity_name || '';
        const prefix = name ? `*${escapeMd(name)}*: ` : '';
        lines.push(`${icon} ${prefix}${escapeMd(p.reason || p.description || JSON.stringify(p))}`);
      }
    }
  } else if (data.message) {
    lines.push(escapeMd(data.message));
  } else {
    lines.push('Оптимизация завершена.');
  }

  return lines.join('\n');
}

export function formatTopCreatives(result: ToolResult): string {
  const ex = extractToolResult(result);
  if (!ex.ok) return `❌ Ошибка: ${ex.error}`;

  const d = ex.data;
  const creatives = d.top_creatives || d.creatives || (Array.isArray(d) ? d : []);
  if (!Array.isArray(creatives) || creatives.length === 0) {
    return '🎨 Нет данных по креативам за этот период.';
  }

  const lines = ['🎨 *Топ креативы (7 дней):*\n'];
  for (const c of creatives.slice(0, 10)) {
    const name = escapeMd(c.title || c.name || c.filename || 'N/A');
    const m = c.metrics || c;
    const parts: string[] = [];
    if (m.spend != null) parts.push(`$${Number(m.spend).toFixed(2)}`);
    if (m.leads != null) parts.push(`${m.leads} лидов`);
    if (m.cpl != null) parts.push(`CPL $${Number(m.cpl).toFixed(2)}`);
    lines.push(`• *${name}*: ${parts.join(' | ') || '-'}`);
  }

  return lines.join('\n');
}

export function formatAiLaunchResult(result: ToolResult): string {
  const ex = extractToolResult(result);
  if (!ex.ok) return `❌ AI запуск не удался: ${ex.error}`;

  const data = ex.data;
  const lines = ['🤖 *AI запуск выполнен!*\n'];

  if (data.results && Array.isArray(data.results)) {
    for (const r of data.results) {
      const icon = r.status === 'success' ? '✅' : r.status === 'skipped' ? '⏭' : '❌';
      const dirName = escapeMd(r.direction || r.direction_name || 'N/A');
      lines.push(`${icon} ${dirName}: ${r.status}${r.adset_name ? ` (${escapeMd(r.adset_name)})` : ''}`);
    }
  } else if (data.message) {
    lines.push(escapeMd(data.message));
  } else {
    lines.push('Запуск завершён.');
  }

  return lines.join('\n');
}

export { escapeMd };
