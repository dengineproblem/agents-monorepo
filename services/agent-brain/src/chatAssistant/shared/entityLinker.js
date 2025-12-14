/**
 * Entity Linker - MVP
 * Связывание сущностей через короткие ссылки (c1, l2, d3, cr4)
 *
 * Типы ссылок:
 * - c{N}  → campaign
 * - d{N}  → direction
 * - l{N}  → lead
 * - cr{N} → creative
 */

/**
 * Добавляет _ref к элементам списка для последующего резолва
 * @param {Array} items - Массив сущностей
 * @param {string} type - Тип: 'c' | 'd' | 'l' | 'cr'
 * @returns {Array} Массив с добавленными _ref
 */
export function attachRefs(items, type) {
  if (!Array.isArray(items)) return items;

  return items.map((item, i) => ({
    ...item,
    _ref: `${type}${i + 1}`
  }));
}

/**
 * Строит entity map для сохранения в focus_entities
 * @param {Array} items - Массив сущностей
 * @param {string} type - Тип сущности
 * @returns {Array} Entity map для last_list
 */
export function buildEntityMap(items, type) {
  if (!Array.isArray(items)) return [];

  return items.map((item, i) => ({
    ref: `${type}${i + 1}`,
    type,
    id: item.id,
    name: item.name || item.title || item.campaign_name || `#${item.id?.slice(-6) || i + 1}`
  }));
}

/**
 * Резолвит пользовательскую ссылку в сущность
 * @param {string} input - Пользовательский ввод ("2", "второй", "c2", "campaign 2")
 * @param {Object} focusEntities - Объект focus_entities из conversation
 * @returns {Object|null} Найденная сущность или null
 */
export function resolveRef(input, focusEntities) {
  const { last_list = [] } = focusEntities || {};

  if (last_list.length === 0) return null;

  const normalized = String(input).toLowerCase().trim();

  // 1. Попытка по прямому ref (c1, l2, cr3)
  const byRef = last_list.find(e => e.ref === normalized);
  if (byRef) return byRef;

  // 2. Попытка по номеру в списке ("1", "2", "3")
  const numMatch = normalized.match(/^(\d+)$/);
  if (numMatch) {
    const idx = parseInt(numMatch[1]) - 1;
    if (idx >= 0 && idx < last_list.length) {
      return last_list[idx];
    }
  }

  // 3. Попытка по типу + номер ("campaign 2", "кампания 2")
  const typeNumMatch = normalized.match(/^(campaign|кампания|c|direction|направление|d|lead|лид|l|creative|креатив|cr)\s*(\d+)$/);
  if (typeNumMatch) {
    const typeMap = {
      campaign: 'c', кампания: 'c', c: 'c',
      direction: 'd', направление: 'd', d: 'd',
      lead: 'l', лид: 'l', l: 'l',
      creative: 'cr', креатив: 'cr', cr: 'cr'
    };
    const type = typeMap[typeNumMatch[1]];
    const num = typeNumMatch[2];
    const ref = `${type}${num}`;
    return last_list.find(e => e.ref === ref) || null;
  }

  // 4. Попытка по русским числительным
  const ordinalMap = {
    'первый': 1, 'первая': 1, 'первое': 1, 'первую': 1,
    'второй': 2, 'вторая': 2, 'второе': 2, 'вторую': 2,
    'третий': 3, 'третья': 3, 'третье': 3, 'третью': 3,
    'четвёртый': 4, 'четвертый': 4, 'четвёртая': 4, 'четвертая': 4,
    'пятый': 5, 'пятая': 5, 'пятое': 5, 'пятую': 5
  };

  for (const [word, num] of Object.entries(ordinalMap)) {
    if (normalized.includes(word)) {
      const idx = num - 1;
      if (idx >= 0 && idx < last_list.length) {
        return last_list[idx];
      }
    }
  }

  // 5. Попытка по части имени (fuzzy)
  if (normalized.length >= 3) {
    const byName = last_list.find(e =>
      e.name && e.name.toLowerCase().includes(normalized)
    );
    if (byName) return byName;
  }

  return null;
}

/**
 * Проверяет, является ли действие WRITE-операцией, требующей подтверждения
 * @param {string} action - Название действия
 * @returns {boolean}
 */
export function isWriteAction(action) {
  const writeActions = [
    'update', 'delete', 'create', 'launch', 'stop', 'pause',
    'set', 'change', 'modify', 'remove', 'add'
  ];

  const actionLower = action.toLowerCase();
  return writeActions.some(w => actionLower.includes(w));
}

/**
 * Генерирует сообщение подтверждения для WRITE операции
 * @param {Object} entity - Резолвленная сущность
 * @param {string} action - Действие
 * @param {Object} params - Параметры действия
 * @returns {Object} Confirmation object
 */
export function createConfirmation(entity, action, params) {
  const typeNames = {
    c: 'кампанию',
    d: 'направление',
    l: 'лида',
    cr: 'креатив'
  };

  const typeName = typeNames[entity.type] || 'сущность';

  return {
    needsConfirmation: true,
    confirmationMessage: `Вы собираетесь изменить ${typeName}: **${entity.name}** (ID: ${entity.id})`,
    pendingAction: {
      action,
      entityId: entity.id,
      entityType: entity.type,
      entityName: entity.name,
      params
    }
  };
}

/**
 * Форматирует список с ref для отображения пользователю
 * @param {Array} items - Элементы с _ref
 * @param {Function} formatFn - Функция форматирования строки
 * @returns {string} Отформатированный список
 */
export function formatListWithRefs(items, formatFn) {
  if (!Array.isArray(items) || items.length === 0) {
    return 'Список пуст';
  }

  return items.map((item, idx) => {
    const ref = item._ref || `#${idx + 1}`;
    const formatted = formatFn ? formatFn(item) : item.name || item.title || 'Без названия';
    return `[${ref}] ${formatted}`;
  }).join('\n');
}

export default {
  attachRefs,
  buildEntityMap,
  resolveRef,
  isWriteAction,
  createConfirmation,
  formatListWithRefs
};
