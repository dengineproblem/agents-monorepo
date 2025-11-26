# Инструкция по получению Google AI API ключа

## Шаг 1: Регистрация в Google AI Studio

1. Перейдите на [Google AI Studio](https://aistudio.google.com/)
2. Войдите через ваш Google аккаунт
3. Примите условия использования

## Шаг 2: Создание API ключа

1. В боковом меню нажмите "Get API key"
2. Нажмите "Create API key"
3. Выберите или создайте Google Cloud проект
4. Скопируйте созданный API ключ

## Шаг 3: Сохранение ключа

1. Откройте файл `services/creative-generation-service/.env`
2. Вставьте ключ в переменную `GEMINI_API_KEY`

```bash
GEMINI_API_KEY=ваш_ключ_здесь
```

## Важная информация

- **Модель для текстов**: `gemini-pro`
- **Модель для изображений**: `gemini-3-pro-image-preview`
- **Документация**: https://ai.google.dev/gemini-api/docs/models?hl=ru#gemini-3-pro-image-preview

## Лимиты бесплатного плана

- 60 запросов в минуту
- 1500 запросов в день
- Для production рекомендуется перейти на платный план

## Проверка работоспособности

После настройки запустите тестовый запрос:

```bash
cd services/creative-generation-service
npm run dev
```

Проверьте логи - должна появиться строка "Gemini API initialized successfully"


