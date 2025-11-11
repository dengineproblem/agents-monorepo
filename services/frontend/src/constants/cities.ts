// Список городов Казахстана и других стран
// Instagram/Meta IDs сохраняем как были (для IG). Для TikTok используем отдельную карту ID.
export const CITIES = [
  { id: 'KZ', name: 'Весь Казахстан' },
  { id: '1289448', name: 'Актау' },
  { id: '1289458', name: 'Актобе' },
  { id: '1289662', name: 'Алматы' },
  { id: '1301648', name: 'Астана' },
  { id: '1290182', name: 'Атырау' },
  { id: '118296', name: 'Баку' },
  { id: 'TASHKENT', name: 'Ташкент' },
  { id: '1301740', name: 'Туркестан' },
  { id: '1293836', name: 'Караганда' },
  { id: '1295460', name: 'Костанай' },
  { id: '1298304', name: 'Павлодар' },
  { id: '1299700', name: 'Семей' },
  { id: '1298077', name: 'Уральск' },
  { id: '1298160', name: 'Усть-Каменогорск' },
  { id: '1300313', name: 'Шымкент' },
];

// Список стран
export const COUNTRIES = [
  { code: 'AZ', name: 'Азербайджан' },
  { code: 'BY', name: 'Беларусь' },
  { code: 'KZ', name: 'Казахстан' },
  { code: 'KG', name: 'Кыргызстан' },
  { code: 'UZ', name: 'Узбекистан' },
  { code: 'KR', name: 'Южная Корея' },
];

// Список городов и стран для поповера
export const CITIES_AND_COUNTRIES = [
  ...CITIES,
  { id: 'AZ', name: 'Азербайджан' },
  { id: 'BY', name: 'Беларусь' },
  { id: 'KG', name: 'Кыргызстан' },
  { id: 'UZ', name: 'Узбекистан' },
  { id: 'US', name: 'США' },
  { id: 'IT', name: 'Италия' },
  { id: 'CA', name: 'Канада' },
  { id: 'SA', name: 'Саудовская Аравия' },
  { id: 'ES', name: 'Испания' },
  { id: 'AE', name: 'ОАЭ' },
  { id: 'AU', name: 'Австралия' },
  { id: 'FR', name: 'Франция' },
  { id: 'DE', name: 'Германия' },
  { id: 'KR', name: 'Южная Корея' },
];

// ID стран для проверок
export const COUNTRY_IDS = ['AZ', 'BY', 'KZ', 'KG', 'UZ', 'US', 'IT', 'CA', 'SA', 'ES', 'AE', 'AU', 'FR', 'DE', 'KR'];

// Дефолтный UTM-тег
export const DEFAULT_UTM = 'utm_source=facebook&utm_campaign={{campaign.name}}&utm_medium={{adset.name}}&utm_content={{ad.name}}';

