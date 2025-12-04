import OpenAI from 'openai';

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY must be set in environment variables');
  }
  return new OpenAI({ apiKey });
}

/**
 * Генерирует тексты для карточек карусели на основе идеи пользователя
 * Использует prompt1 пользователя для персонализации
 * @param carouselIdea - Общая идея карусели от пользователя
 * @param cardsCount - Количество карточек (2-10)
 * @param userPrompt1 - Промпт пользователя (информация о бизнесе)
 * @returns Массив текстов для каждой карточки
 */
export async function generateCarouselTexts(
  carouselIdea: string,
  cardsCount: number,
  userPrompt1: string
): Promise<string[]> {
  try {
    console.log(`[Carousel Text] Generating ${cardsCount} carousel card texts...`);
    console.log('[Carousel Text] User idea length:', carouselIdea?.length || 0);
    console.log('[Carousel Text] PROMPT1 length:', userPrompt1.length);

    const openai = getOpenAIClient();

    const systemPrompt = `Ты - expert копирайтер, специализирующийся на сторителлинге для рекламных каруселей.

Твоя задача: создать связный storytelling из РОВНО ${cardsCount} карточек для рекламной карусели.

КРИТИЧЕСКИ ВАЖНО:
- Создай РОВНО ${cardsCount} текстов
- Каждый текст - это часть единого повествования
- Тексты должны быть связаны между собой логически
- Первая карточка - мощный хук/заголовок (короткий, привлекающий внимание)
- Последняя карточка - призыв к действию
- Промежуточные карточки - развитие истории/аргументы/преимущества
- Каждый текст должен быть самодостаточным, но частью общей истории

ДВА РЕЖИМА РАБОТЫ:

РЕЖИМ 1: ПОЛЬЗОВАТЕЛЬ ДАЛ ГОТОВУЮ СТРУКТУРУ С ТЕКСТАМИ ДЛЯ КАЖДОГО СЛАЙДА
Если в идее карусели пользователь явно указал тексты для каждого слайда (например: "1 слайд: текст..., 2 слайд: текст..." или "первая карточка: текст..., вторая: текст..."), то:

- МАКСИМАЛЬНО СЛЕДУЙ ЕГО ТЕКСТАМ - это технические требования, которые нужно выполнить
- НЕ переписывай смысл и ключевые фразы
- НЕ меняй структуру и порядок аргументов
- МОЖЕШЬ только:
  * Убрать слова-паразиты (ну, вот, как бы, э-э, м-м)
  * Убрать повторы и запинки от голосового ввода
  * Исправить опечатки и грамматические ошибки
  * Немного улучшить формулировки БЕЗ изменения смысла
  * Привести к единому стилю (заглавные буквы, пунктуация)
  * Разбить длинные предложения на смысловые группы с \n\n
- ВАЖНО: Сохраняй оригинальные ключевые слова, термины, названия
- Количество карточек должно ТОЧНО соответствовать количеству, указанному пользователем

РЕЖИМ 2: ПОЛЬЗОВАТЕЛЬ ДАЛ ОБЩУЮ ИДЕЮ БЕЗ КОНКРЕТНОЙ СТРУКТУРЫ
Если пользователь описал только общую концепцию/тему карусели, БЕЗ конкретных текстов для каждого слайда, то:

- Ты создаёшь полноценный storytelling с нуля
- Следуй классической структуре (см. ниже)
- Будь креативным и убедительным

СТРУКТУРА STORYTELLING (для режима 2):
${cardsCount === 2 ? '1. Хук/проблема\n2. Решение + CTA' : ''}
${cardsCount === 3 ? '1. Хук (заголовок)\n2. Развитие/аргументы\n3. CTA' : ''}
${cardsCount === 4 ? '1. Хук (проблема)\n2. Решение\n3. Выгоды\n4. CTA' : ''}
${cardsCount === 5 ? '1. Хук\n2. Проблема\n3. Решение\n4. Выгоды\n5. CTA' : ''}
${cardsCount >= 6 ? '1. Хук\n2-' + (cardsCount - 2) + '. Развитие истории/аргументы/примеры\n' + (cardsCount - 1) + '. Социальное доказательство\n' + cardsCount + '. CTA' : ''}

ДЛИНА ТЕКСТОВ:
- Первая карточка (хук): 10-20 слов
- Промежуточные карточки: 15-30 слов каждая
- Последняя карточка (CTA): 15-25 слов

ВАЖНО - РАЗДЕЛЕНИЕ ДЛИННЫХ ТЕКСТОВ:
- Если текст карточки получается длинным (более 100 символов), обязательно группируй предложения по смыслу
- Разделяй смысловые группы ДВОЙНЫМ переносом строки (\n\n)
- Это делает текст более читаемым и структурированным
- Каждая смысловая группа - это 1-2 короткие фразы (не более 50 символов)
- Пример плохого текста: "Наш сервис помогает автоматизировать задачи и экономит время. Вы получите больше свободы для важных дел. Попробуйте прямо сейчас!"
- Пример ХОРОШЕГО текста: "Наш сервис помогает автоматизировать задачи и экономит время.\n\nВы получите больше свободы для важных дел.\n\nПопробуйте прямо сейчас!"

ФОРМАТ ВЫВОДА:
Выдай ${cardsCount} строк, разделенных символом ||| (три вертикальные черты).
Каждая строка - это текст для одной карточки.
БЕЗ нумерации, БЕЗ пояснений, БЕЗ кавычек.

Пример вывода для 3 карточек:
Забудьте о рутине! Мы освободим ваше время.|||Наш AI-помощник автоматизирует задачи, которые отнимают 4 часа в день.|||Получите 7 дней бесплатно. Попробуйте прямо сейчас!

Контекст бизнеса:
${userPrompt1}`;

    // Если идея пустая - модель сама придумает на основе prompt1
    const ideaText = carouselIdea?.trim()
      ? `Идея карусели: ${carouselIdea}`
      : 'Идея карусели: придумай креативный storytelling сам, основываясь на контексте бизнеса выше';

    const userMessage = `${ideaText}

Создай ${cardsCount} связанных текстов для карточек карусели в формате, разделенном |||`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.9,
      max_tokens: 1000
    });

    const generatedText = response.choices[0]?.message?.content?.trim();

    if (!generatedText) {
      throw new Error('No text generated by OpenAI');
    }

    console.log('[Carousel Text] Raw response:', generatedText);

    // Разделяем по |||
    const texts = generatedText
      .split('|||')
      .map((text: string) => text.trim())
      .filter((text: string) => text.length > 0);

    if (texts.length !== cardsCount) {
      console.warn(`[Carousel Text] Expected ${cardsCount} texts, got ${texts.length}. Adjusting...`);

      // Если получили больше, обрезаем
      if (texts.length > cardsCount) {
        return texts.slice(0, cardsCount);
      }

      // Если получили меньше, генерируем недостающие (fallback)
      while (texts.length < cardsCount) {
        texts.push(`Карточка ${texts.length + 1}`);
      }
    }

    console.log('[Carousel Text] Generated texts:', texts);
    return texts;

  } catch (error: any) {
    console.error('[Carousel Text] Error generating texts:', error);
    throw new Error(`Carousel text generation failed: ${error.message}`);
  }
}

/**
 * Перегенерирует текст одной карточки карусели
 * Учитывает контекст других карточек для связности
 * @param cardIndex - Индекс карточки (0-based)
 * @param existingTexts - Массив всех текстов карусели
 * @param userPrompt1 - Промпт пользователя
 * @returns Новый текст для карточки
 */
export async function regenerateCarouselCardText(
  cardIndex: number,
  existingTexts: string[],
  userPrompt1: string
): Promise<string> {
  try {
    console.log(`[Carousel Text] Regenerating card #${cardIndex}...`);

    const openai = getOpenAIClient();

    const totalCards = existingTexts.length;
    const position = cardIndex === 0 ? 'первая (хук)' :
                    cardIndex === totalCards - 1 ? 'последняя (CTA)' :
                    'промежуточная';

    const systemPrompt = `Ты - expert копирайтер, специализирующийся на сторителлинге для рекламных каруселей.

Твоя задача: перегенерировать текст для ${position} карточки в карусели из ${totalCards} карточек.

КОНТЕКСТ ДРУГИХ КАРТОЧЕК:
${existingTexts.map((text, i) => `Карточка ${i + 1}${i === cardIndex ? ' (ПЕРЕГЕНЕРИРУЕТСЯ)' : ''}: ${text}`).join('\n')}

ВАЖНО:
- Новый текст должен органично вписываться в общий storytelling
- Сохраняй связность с другими карточками
- ${cardIndex === 0 ? 'Это ПЕРВАЯ карточка - мощный хук/заголовок (10-20 слов)' : ''}
- ${cardIndex === totalCards - 1 ? 'Это ПОСЛЕДНЯЯ карточка - призыв к действию (15-25 слов)' : ''}
- ${cardIndex !== 0 && cardIndex !== totalCards - 1 ? 'Это ПРОМЕЖУТОЧНАЯ карточка - развитие истории (15-30 слов)' : ''}
- БЕЗ нумерации, БЕЗ пояснений, БЕЗ кавычек
- Выдай ТОЛЬКО текст для этой карточки

Контекст бизнеса:
${userPrompt1}`;

    const userMessage = `Перегенерируй текст для карточки ${cardIndex + 1}, учитывая контекст всей карусели выше.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.9,
      max_tokens: 300
    });

    const generatedText = response.choices[0]?.message?.content?.trim();

    if (!generatedText) {
      throw new Error('No text generated by OpenAI');
    }

    // Очищаем от возможных артефактов
    const cleanedText = generatedText
      .replace(/^["']|["']$/g, '') // Убираем кавычки в начале/конце
      .replace(/^\d+\.\s*/, '') // Убираем нумерацию
      .trim();

    console.log('[Carousel Text] Regenerated text:', cleanedText);
    return cleanedText;

  } catch (error: any) {
    console.error('[Carousel Text] Error regenerating card text:', error);
    throw new Error(`Card text regeneration failed: ${error.message}`);
  }
}
