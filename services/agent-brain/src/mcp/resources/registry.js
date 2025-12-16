/**
 * MCP Resources Registry
 *
 * Реестр ресурсов MCP. Ресурсы - это статические данные,
 * которые модель может запросить (метрики, snapshot, заметки).
 *
 * TODO Phase 3: Полная реализация
 */

/**
 * Resource definitions
 * URI format: project://{category}/{name}
 */
const resourceDefinitions = [
  {
    uri: 'project://metrics/today',
    name: 'Today Metrics',
    description: 'Агрегированные метрики за последние 7 дней',
    mimeType: 'application/json'
  },
  {
    uri: 'project://snapshot/business',
    name: 'Business Snapshot',
    description: 'Полный снимок состояния бизнеса',
    mimeType: 'application/json'
  },
  {
    uri: 'project://notes/{domain}',
    name: 'Agent Notes',
    description: 'Заметки агента по домену (ads, creative, crm, whatsapp)',
    mimeType: 'application/json'
  },
  {
    uri: 'project://brain/actions',
    name: 'Brain Actions',
    description: 'История действий автопилота за 3 дня',
    mimeType: 'application/json'
  }
];

/**
 * Get all registered resources
 * @returns {Array}
 */
export function getResourceRegistry() {
  return resourceDefinitions.map(r => ({
    uri: r.uri,
    name: r.name,
    description: r.description,
    mimeType: r.mimeType
  }));
}

/**
 * Read resource content
 * @param {string} uri - Resource URI
 * @param {Object} context - Session context
 * @returns {Promise<Array>} Resource contents
 */
export async function readResource(uri, context) {
  // Parse URI
  const match = uri.match(/^project:\/\/(.+)$/);
  if (!match) {
    throw new Error(`Invalid resource URI: ${uri}`);
  }

  const path = match[1];

  // TODO Phase 3: Implement actual resource handlers
  // For now, return placeholder

  if (path === 'metrics/today') {
    return [{
      uri,
      mimeType: 'application/json',
      text: JSON.stringify({
        message: 'Metrics resource not yet implemented',
        phase: 3
      })
    }];
  }

  if (path === 'snapshot/business') {
    return [{
      uri,
      mimeType: 'application/json',
      text: JSON.stringify({
        message: 'Business snapshot resource not yet implemented',
        phase: 3
      })
    }];
  }

  if (path.startsWith('notes/')) {
    const domain = path.replace('notes/', '');
    return [{
      uri,
      mimeType: 'application/json',
      text: JSON.stringify({
        message: `Notes for domain "${domain}" not yet implemented`,
        phase: 3
      })
    }];
  }

  if (path === 'brain/actions') {
    return [{
      uri,
      mimeType: 'application/json',
      text: JSON.stringify({
        message: 'Brain actions resource not yet implemented',
        phase: 3
      })
    }];
  }

  throw new Error(`Unknown resource: ${uri}`);
}

export default { getResourceRegistry, readResource };
