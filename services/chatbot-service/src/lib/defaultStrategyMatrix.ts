/**
 * Default Strategy Matrix
 * 
 * Defines the default mapping of funnel stages and interest levels
 * to strategy types for campaign message generation.
 */

import { StrategyMapping, StrategyType, MessageType } from './strategyTypes.js';

/**
 * Default strategy matrix: funnel_stage -> interest_level -> strategy types (in priority order)
 * 
 * Strategy types:
 * - check_in: Мягкое касание, узнать актуальность темы
 * - value: Полезный контент, советы, инсайты
 * - case: Кейс с результатами, социальное доказательство
 * - offer: Акция, спецпредложение (использовать с активным контекстом)
 * - direct_selling: Прямое предложение следующего шага (созвон, запись)
 */
export const defaultStrategyMatrix: StrategyMapping = {
  // Новый лид - только начал диалог
  new_lead: {
    hot: ['direct_selling', 'case', 'check_in'],
    warm: ['case', 'direct_selling', 'value', 'check_in'],
    cold: ['value', 'case', 'check_in']
  },
  
  // Первый контакт - есть диалог, но без решения
  first_contact: {
    hot: ['direct_selling', 'case', 'offer', 'check_in'],
    warm: ['case', 'direct_selling', 'value', 'check_in'],
    cold: ['value', 'check_in', 'case']
  },
  
  // Думает / сравнивает варианты
  thinking: {
    hot: ['case', 'value', 'direct_selling'],
    warm: ['value', 'case', 'check_in'],
    cold: ['value', 'check_in']
  },
  
  // Возражение по цене
  price_objection: {
    hot: ['case', 'value', 'offer'],
    warm: ['case', 'value', 'offer'],
    cold: ['value', 'check_in']
  },
  
  // Не пришёл на встречу / пропустил звонок
  no_show: {
    hot: ['check_in', 'direct_selling', 'case'],
    warm: ['check_in', 'direct_selling', 'case'],
    cold: ['check_in', 'value']
  },
  
  // Неактивный - давно не было контакта
  inactive: {
    hot: ['value', 'case', 'offer'],
    warm: ['value', 'case', 'offer'],
    cold: ['value', 'check_in', 'offer']
  },
  
  // Не квалифицирован - не подходит под критерии
  not_qualified: {
    hot: ['value', 'check_in'],
    warm: ['value', 'check_in'],
    cold: ['value', 'check_in']
  },
  
  // Квалифицирован - подходит под критерии
  qualified: {
    hot: ['direct_selling', 'case', 'offer'],
    warm: ['case', 'direct_selling', 'value'],
    cold: ['value', 'case', 'check_in']
  },
  
  // Консультация забронирована (обычно не должны попадать в рассылку, но на всякий случай)
  consultation_booked: {
    hot: ['check_in'],
    warm: ['check_in'],
    cold: ['check_in']
  },
  
  // Консультация завершена
  consultation_completed: {
    hot: ['direct_selling', 'case', 'offer'],
    warm: ['case', 'direct_selling', 'value'],
    cold: ['value', 'check_in']
  },
  
  // Fallback для неизвестных этапов
  default: {
    hot: ['case', 'direct_selling', 'value'],
    warm: ['value', 'case', 'check_in'],
    cold: ['value', 'check_in']
  }
};

/**
 * Mapping strategy_type -> template_type
 * Для обратной совместимости с существующей системой шаблонов
 */
export const strategyToTemplateType: Record<StrategyType, MessageType> = {
  check_in: 'reminder',
  value: 'useful',
  case: 'selling',
  offer: 'selling',
  direct_selling: 'selling'
};

/**
 * Human-readable labels for strategy types (Russian)
 */
export const strategyTypeLabels: Record<StrategyType, string> = {
  check_in: 'Проверка актуальности',
  value: 'Полезный контент',
  case: 'Кейс / Результат',
  offer: 'Акция / Предложение',
  direct_selling: 'Прямая продажа'
};

/**
 * Human-readable labels for context types (Russian)
 */
export const contextTypeLabels: Record<string, string> = {
  promo: 'Промо-акция',
  case: 'Кейс',
  content: 'Полезный контент',
  news: 'Новость'
};

