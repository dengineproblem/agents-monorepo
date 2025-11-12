// Скопируйте этот код в консоль браузера (F12 → Console)
// для диагностики проблемы с загрузкой направлений

console.log('=== ДИАГНОСТИКА НАПРАВЛЕНИЙ ===');
console.log('');

// 1. Проверяем пользователя
const user = JSON.parse(localStorage.getItem('user') || '{}');
console.log('1️⃣ User ID из localStorage:', user?.id);
console.log('   Username:', user?.username);

if (!user?.id) {
  console.error('❌ User ID отсутствует! Войдите в систему.');
} else {
  console.log('✅ User ID найден');
  
  // 2. Проверяем API URL
  console.log('');
  console.log('2️⃣ Проверяем конфигурацию...');
  console.log('   Ожидаемый API URL: http://localhost:8082');
  
  // 3. Делаем тестовый запрос
  console.log('');
  console.log('3️⃣ Отправляем запрос к API...');
  console.log('   URL:', `http://localhost:8082/directions?userAccountId=${user.id}`);
  
  fetch(`http://localhost:8082/directions?userAccountId=${user.id}`)
    .then(response => {
      console.log('   HTTP Status:', response.status, response.statusText);
      return response.json();
    })
    .then(data => {
      console.log('');
      console.log('4️⃣ Результат от API:');
      console.log('   Success:', data.success);
      console.log('   Directions count:', data.directions?.length || 0);
      
      if (data.success && data.directions && data.directions.length > 0) {
        console.log('✅ Направления найдены:', data.directions);
      } else if (data.success) {
        console.log('⚠️ Направлений нет в базе для этого пользователя');
        console.log('   Создайте направление через интерфейс');
      } else {
        console.error('❌ Ошибка от API:', data.error);
      }
    })
    .catch(error => {
      console.error('');
      console.error('❌ Ошибка при запросе к API:', error);
      console.error('   Проверьте что backend запущен на порту 8082');
    });
}

console.log('');
console.log('=== КОНЕЦ ДИАГНОСТИКИ ===');




