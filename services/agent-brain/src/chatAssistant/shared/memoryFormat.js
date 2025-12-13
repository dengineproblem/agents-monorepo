/**
 * Memory formatting utilities for agent prompts
 */

/**
 * Format business specs for prompt injection
 * @param {Object} specs - { tracking, crm, kpi }
 * @returns {string} Formatted specs section
 */
export function formatSpecsContext(specs) {
  if (!specs) return 'Бизнес-правила: не настроены';

  const sections = [];

  // Tracking spec
  if (specs.tracking && Object.keys(specs.tracking).length > 0) {
    const tracking = specs.tracking;
    const lines = [];
    if (tracking.utm_ad_id_field) {
      lines.push(`- ad_id берётся из: ${tracking.utm_ad_id_field}`);
    }
    if (tracking.phone_normalization) {
      const pn = tracking.phone_normalization;
      lines.push(`- Нормализация телефонов: ${pn.country || 'стандартная'}`);
    }
    if (lines.length > 0) {
      sections.push(`**Атрибуция:**\n${lines.join('\n')}`);
    }
  }

  // KPI spec
  if (specs.kpi && Object.keys(specs.kpi).length > 0) {
    const kpi = specs.kpi;
    const lines = [];
    if (kpi.target_cpl_max) {
      lines.push(`- Макс CPL: $${kpi.target_cpl_max}`);
    }
    if (kpi.budget_change_max_pct) {
      lines.push(`- Макс изменение бюджета: ${kpi.budget_change_max_pct}%`);
    }
    if (kpi.priority_services?.length > 0) {
      lines.push(`- Приоритетные услуги: ${kpi.priority_services.join(', ')}`);
    }
    if (lines.length > 0) {
      sections.push(`**KPI:**\n${lines.join('\n')}`);
    }
  }

  // CRM spec
  if (specs.crm && Object.keys(specs.crm).length > 0) {
    const crm = specs.crm;
    const lines = [];
    if (crm.hot_signals?.length > 0) {
      lines.push(`- Горячие сигналы: ${crm.hot_signals.slice(0, 3).join(', ')}`);
    }
    if (crm.cold_signals?.length > 0) {
      lines.push(`- Холодные сигналы: ${crm.cold_signals.slice(0, 3).join(', ')}`);
    }
    if (lines.length > 0) {
      sections.push(`**CRM:**\n${lines.join('\n')}`);
    }
  }

  return sections.length > 0
    ? sections.join('\n\n')
    : 'Бизнес-правила: не настроены';
}

/**
 * Format agent notes for prompt injection
 * @param {Object} notes - { ads: [...], creative: [...], ... }
 * @param {string} domain - Which domain notes to prioritize
 * @returns {string} Formatted notes section
 */
export function formatNotesContext(notes, domain = null) {
  if (!notes) return '';

  const allNotes = [];

  // If domain specified, get its notes first
  if (domain && notes[domain]?.length > 0) {
    allNotes.push(...notes[domain].map(n => ({
      ...n,
      isPrimary: true
    })));
  }

  // Add notes from other domains
  const otherDomains = Object.keys(notes).filter(d => d !== domain);
  for (const d of otherDomains) {
    if (notes[d]?.length > 0) {
      allNotes.push(...notes[d].map(n => ({
        ...n,
        isPrimary: false,
        domain: d
      })));
    }
  }

  if (allNotes.length === 0) return '';

  // Sort by importance and limit
  const sorted = allNotes
    .sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      return (b.importance || 0.5) - (a.importance || 0.5);
    })
    .slice(0, 15);

  const lines = sorted.map(n => {
    const prefix = n.domain ? `[${n.domain}] ` : '';
    return `- ${prefix}${n.text}`;
  });

  return `### Накопленные наблюдения\n${lines.join('\n')}`;
}

/**
 * Format notes for a specific domain only
 * @param {Array} notes - Notes array for domain
 * @returns {string} Formatted notes
 */
export function formatDomainNotes(notes) {
  if (!notes || notes.length === 0) return '';

  const lines = notes
    .slice(0, 10)
    .map(n => `- ${n.text}`);

  return lines.join('\n');
}
