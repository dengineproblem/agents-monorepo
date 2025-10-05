// Тест логики автоопределения стран/городов

function convertToFacebookTargeting(cities) {
  const targeting = {
    age_min: 18,
    age_max: 65,
  };

  if (cities && cities.length > 0) {
    const countries = [];
    const cityIds = [];
    
    for (const item of cities) {
      if (item.length === 2 && /^[A-Z]{2}$/.test(item)) {
        // 2 заглавные буквы = код страны
        countries.push(item);
      } else {
        // Все остальное = ID города
        cityIds.push(item);
      }
    }
    
    targeting.geo_locations = {};
    
    if (countries.length > 0) {
      targeting.geo_locations.countries = countries;
    }
    
    if (cityIds.length > 0) {
      targeting.geo_locations.cities = cityIds.map(cityId => ({
        key: cityId
      }));
    }
    
    if (countries.length === 0 && cityIds.length === 0) {
      targeting.geo_locations.countries = ['RU'];
    }
  } else {
    targeting.geo_locations = {
      countries: ['RU']
    };
  }

  return targeting;
}

// ТЕСТЫ
console.log('═══════════════════════════════════════');
console.log('ТЕСТ 1: Несколько стран');
console.log('═══════════════════════════════════════');
const test1 = convertToFacebookTargeting(['RU', 'KZ', 'BY']);
console.log('Input:  ["RU", "KZ", "BY"]');
console.log('Output:', JSON.stringify(test1.geo_locations, null, 2));
console.log('✅ Должно быть: {"countries": ["RU", "KZ", "BY"]}');
console.log('');

console.log('═══════════════════════════════════════');
console.log('ТЕСТ 2: Несколько городов');
console.log('═══════════════════════════════════════');
const test2 = convertToFacebookTargeting(['2420877', '2452344', '524901']);
console.log('Input:  ["2420877", "2452344", "524901"]');
console.log('Output:', JSON.stringify(test2.geo_locations, null, 2));
console.log('✅ Должно быть: {"cities": [{"key":"2420877"}, {"key":"2452344"}, {"key":"524901"}]}');
console.log('');

console.log('═══════════════════════════════════════');
console.log('ТЕСТ 3: Смешанное (страны + города)');
console.log('═══════════════════════════════════════');
const test3 = convertToFacebookTargeting(['RU', 'KZ', '2420877']);
console.log('Input:  ["RU", "KZ", "2420877"]');
console.log('Output:', JSON.stringify(test3.geo_locations, null, 2));
console.log('✅ Должно быть: {"countries": ["RU", "KZ"], "cities": [{"key":"2420877"}]}');
console.log('');

console.log('═══════════════════════════════════════');
console.log('ТЕСТ 4: Одна страна');
console.log('═══════════════════════════════════════');
const test4 = convertToFacebookTargeting(['RU']);
console.log('Input:  ["RU"]');
console.log('Output:', JSON.stringify(test4.geo_locations, null, 2));
console.log('✅ Должно быть: {"countries": ["RU"]}');
console.log('');

console.log('═══════════════════════════════════════');
console.log('ТЕСТ 5: Пустой массив (default)');
console.log('═══════════════════════════════════════');
const test5 = convertToFacebookTargeting([]);
console.log('Input:  []');
console.log('Output:', JSON.stringify(test5.geo_locations, null, 2));
console.log('✅ Должно быть: {"countries": ["RU"]}');
console.log('');

console.log('═══════════════════════════════════════');
console.log('ТЕСТ 6: Некорректные данные (lowercase)');
console.log('═══════════════════════════════════════');
const test6 = convertToFacebookTargeting(['ru', 'kz']);
console.log('Input:  ["ru", "kz"] (lowercase)');
console.log('Output:', JSON.stringify(test6.geo_locations, null, 2));
console.log('⚠️  Должно быть: {"cities": [{"key":"ru"}, {"key":"kz"}]} (не распознано как страны)');
console.log('');

console.log('✅ ВСЕ ТЕСТЫ ЗАВЕРШЕНЫ');
