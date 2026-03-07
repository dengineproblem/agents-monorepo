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
  { id: '1938', name: 'Бишкек' },
  { id: '1219326', name: 'Jalal-Abad' },
  { id: '1219379', name: 'Kara-Balta' },
  { id: '1219420', name: 'Karakol' },
  { id: '1219908', name: 'Osh' },
  { id: '1220195', name: 'Tokmok' },
  { id: 'TASHKENT', name: 'Ташкент' },
  { id: '1301740', name: 'Туркестан' },
  { id: '1293836', name: 'Караганда' },
  { id: '1294981', name: 'Кокшетау' },
  { id: '1295460', name: 'Костанай' },
  { id: '1298304', name: 'Павлодар' },
  { id: '1298439', name: 'Петропавловск' },
  { id: '1299700', name: 'Семей' },
  { id: '1298077', name: 'Уральск' },
  { id: '1298160', name: 'Усть-Каменогорск' },
  { id: '1300313', name: 'Шымкент' },
  // Кипр — регионы и города
  { id: 'CY', name: 'Весь Кипр' },
  { id: '792', name: 'Larnaca District' },
  { id: '794', name: 'Limassol District' },
  { id: '795', name: 'Paphos District' },
  { id: '514564', name: 'Limassol' },
  { id: '515017', name: 'Paphos' },
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

// Группы для поповера — упорядочены по регионам
export const GEO_GROUPS = [
  {
    label: 'Казахстан',
    items: [
      { id: 'KZ', name: 'Весь Казахстан' },
      { id: '1289662', name: 'Алматы' },
      { id: '1301648', name: 'Астана' },
      { id: '1300313', name: 'Шымкент' },
      { id: '1289448', name: 'Актау' },
      { id: '1289458', name: 'Актобе' },
      { id: '1290182', name: 'Атырау' },
      { id: '1293836', name: 'Караганда' },
      { id: '1294981', name: 'Кокшетау' },
      { id: '1295460', name: 'Костанай' },
      { id: '1298304', name: 'Павлодар' },
      { id: '1298439', name: 'Петропавловск' },
      { id: '1299700', name: 'Семей' },
      { id: '1301740', name: 'Туркестан' },
      { id: '1298077', name: 'Уральск' },
      { id: '1298160', name: 'Усть-Каменогорск' },
    ],
  },
  {
    label: 'Кыргызстан',
    items: [
      { id: 'KG', name: 'Весь Кыргызстан' },
      { id: '1938', name: 'Бишкек' },
      { id: '1219908', name: 'Osh' },
      { id: '1219326', name: 'Jalal-Abad' },
      { id: '1219379', name: 'Kara-Balta' },
      { id: '1219420', name: 'Karakol' },
      { id: '1220195', name: 'Tokmok' },
    ],
  },
  {
    label: 'Кипр',
    items: [
      { id: 'CY', name: 'Весь Кипр' },
      { id: '792', name: 'Larnaca District' },
      { id: '794', name: 'Limassol District' },
      { id: '795', name: 'Paphos District' },
      { id: '514564', name: 'Limassol' },
      { id: '515017', name: 'Paphos' },
    ],
  },
  {
    label: 'СНГ',
    items: [
      { id: 'AZ', name: 'Азербайджан' },
      { id: '118296', name: 'Баку' },
      { id: 'BY', name: 'Беларусь' },
      { id: 'UZ', name: 'Узбекистан' },
      { id: 'TASHKENT', name: 'Ташкент' },
      { id: 'UA', name: 'Украина' },
    ],
  },
  {
    label: 'Другие страны',
    items: [
      { id: 'US', name: 'США' },
      { id: 'CA', name: 'Канада' },
      { id: 'DE', name: 'Германия' },
      { id: 'FR', name: 'Франция' },
      { id: 'ES', name: 'Испания' },
      { id: 'IT', name: 'Италия' },
      { id: 'AU', name: 'Австралия' },
      { id: 'AE', name: 'ОАЭ' },
      { id: 'SA', name: 'Саудовская Аравия' },
      { id: 'KR', name: 'Южная Корея' },
      { id: 'DZ', name: 'Алжир' },
      { id: 'MA', name: 'Марокко' },
      { id: 'PG', name: 'Папуа-Новая Гвинея' },
    ],
  },
];

// Плоский список для обратной совместимости
export const CITIES_AND_COUNTRIES = GEO_GROUPS.flatMap(g => g.items);

// ID стран для проверок
export const COUNTRY_IDS = ['AZ', 'BY', 'KZ', 'KG', 'UZ', 'US', 'IT', 'CA', 'SA', 'ES', 'AE', 'AU', 'FR', 'DE', 'KR', 'CY', 'UA', 'DZ', 'MA', 'PG'];

// Кипрские регионы/города (без CY-страны) — для взаимоисключения с "Весь Кипр"
export const CYPRUS_GEO_IDS = ['792', '794', '795', '514564', '515017'];

// Facebook region IDs (districts) — НЕ города!
// Эти ID нужно отправлять как geo_locations.regions, а НЕ geo_locations.cities
export const REGION_IDS = ['792', '794', '795']; // Larnaca, Limassol, Paphos Districts

// Дефолтный UTM-тег
export const DEFAULT_UTM = 'utm_source=facebook&utm_campaign={{campaign.name}}&utm_medium={{ad.id}}';
