import { GoogleGenerativeAI } from '@google/generative-ai';
import { generateCarouselCardPrompt } from './carouselPromptGenerator';
import { upscaleImageTo4K } from './gemini-image';
import { CarouselVisualStyle } from '../types';

let genAI: GoogleGenerativeAI | null = null;

function getGeminiClient(): GoogleGenerativeAI {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY must be set in environment variables');
    }
    genAI = new GoogleGenerativeAI(apiKey);
  }
  return genAI;
}

/**
 * Генерирует одну карточку карусели
 * @param cardText - Текст для карточки
 * @param cardIndex - Индекс карточки (0-based)
 * @param totalCards - Общее количество карточек
 * @param userPrompt1 - PROMPT1 пользователя
 * @param visualStyle - Визуальный стиль карусели
 * @param customPrompt - Дополнительный промпт от пользователя (опционально)
 * @param styleReferenceImage - Референс для консистентности стиля (предыдущая карточка)
 * @param contentReferenceImages - Референсы контента от пользователя (товар, персонаж и т.п.) — до 2 штук
 * @param currentCardImage - Текущее изображение карточки (для перегенерации — редактируем эту картинку)
 * @param stylePrompt - Промпт для freestyle стиля (пользователь сам задаёт визуальный стиль)
 * @returns Base64 изображение
 */
async function generateCarouselCard(
  cardText: string,
  cardIndex: number,
  totalCards: number,
  userPrompt1: string,
  visualStyle: CarouselVisualStyle,
  customPrompt?: string,
  styleReferenceImage?: string,
  contentReferenceImages?: string[],
  currentCardImage?: string,
  stylePrompt?: string
): Promise<string> {
  try {
    console.log(`[Gemini Carousel] Generating card ${cardIndex + 1}/${totalCards}...`);
    console.log('[Gemini Carousel] Has style reference:', !!styleReferenceImage);
    console.log('[Gemini Carousel] Content references count:', contentReferenceImages?.length || 0);
    console.log('[Gemini Carousel] Has current card (edit mode):', !!currentCardImage);

    // Генерируем промпт через LLM-агент
    const prompt = await generateCarouselCardPrompt(
      userPrompt1,
      cardText,
      cardIndex,
      totalCards,
      visualStyle,
      customPrompt,
      stylePrompt  // Для freestyle стиля
    );

    console.log('[Gemini Carousel] Generated prompt length:', prompt.length);
    console.log('[Gemini Carousel] ===== FULL PROMPT FOR GEMINI =====');
    console.log(prompt);
    console.log('[Gemini Carousel] ===== END PROMPT =====');

    const client = getGeminiClient();
    const model = client.getGenerativeModel({
      model: 'gemini-3-pro-image-preview'
    });

    // Формируем массив частей контента
    const contentParts: any[] = [];

    // Добавляем основной промпт
    contentParts.push({ text: prompt });

    // РЕЖИМ РЕДАКТИРОВАНИЯ: если передана текущая карточка — это изображение для редактирования
    // Оно идёт ПЕРВЫМ, чтобы Gemini понял что именно его нужно модифицировать
    if (currentCardImage) {
      console.log('[Gemini Carousel] Adding CURRENT CARD for editing...');
      contentParts.push({
        text: '\n\n[ИЗОБРАЖЕНИЕ ДЛЯ РЕДАКТИРОВАНИЯ - ГЛАВНОЕ!]\nЭто текущая карточка, которую нужно УЛУЧШИТЬ и ПЕРЕГЕНЕРИРОВАТЬ. Создай НОВУЮ версию этого изображения, сохраняя общую концепцию и композицию, но с улучшениями. Если есть дополнительные инструкции от пользователя — примени их к ЭТОМУ изображению.'
      });
      contentParts.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data: currentCardImage
        }
      });
    }

    // Добавляем референсы контента (товар/персонаж от пользователя) — до 2 штук
    // Это то, что пользователь хочет ВИДЕТЬ на карточке
    if (contentReferenceImages && contentReferenceImages.length > 0) {
      console.log(`[Gemini Carousel] Adding ${contentReferenceImages.length} CONTENT reference(s)...`);

      for (let i = 0; i < contentReferenceImages.length; i++) {
        const refImage = contentReferenceImages[i];
        const refNumber = contentReferenceImages.length > 1 ? ` #${i + 1}` : '';

        contentParts.push({
          text: `\n\n[РЕФЕРЕНС КОНТЕНТА${refNumber} - ВАЖНО!]\nЭто изображение показывает товар/объект/персонажа, который ОБЯЗАТЕЛЬНО должен быть размещён на карточке. Используй ИМЕННО этот объект как главный элемент изображения. Сохрани его внешний вид, форму и детали.`
        });
        contentParts.push({
          inlineData: {
            mimeType: 'image/jpeg',
            data: refImage
          }
        });
      }
    }

    // Добавляем референс стиля (другая карточка карусели) — для консистентности дизайна
    // НЕ путать с currentCardImage — это ДРУГАЯ карточка для заимствования стиля
    if (styleReferenceImage) {
      console.log('[Gemini Carousel] Adding STYLE reference (another card for consistency)...');
      contentParts.push({
        text: '\n\n[РЕФЕРЕНС СТИЛЯ - ДРУГАЯ КАРТОЧКА]\nЭто ДРУГАЯ карточка из этой же карусели. Используй её только для консистентности СТИЛЯ: той же палитры, типографики, композиции, расположения текста. НЕ копируй её содержимое — она нужна только для единого визуального стиля карусели.'
      });
      contentParts.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data: styleReferenceImage
        }
      });
    }

    // Конфигурация для генерации в формате 1:1 для Instagram карусели
    const generationConfig = {
      responseModalities: ['IMAGE'],
      imageConfig: {
        aspectRatio: '1:1',
        imageSize: '2K'
      },
      temperature: 1.0,
      topK: 40,
      topP: 0.95
    };

    console.log('[Gemini Carousel] Calling Gemini API...');
    console.log('[Gemini Carousel] ===== ALL TEXT PARTS SENT TO GEMINI =====');
    contentParts.forEach((part, idx) => {
      if (part.text) {
        console.log(`[Part ${idx}] TEXT:`, part.text);
      } else if (part.inlineData) {
        console.log(`[Part ${idx}] IMAGE: ${part.inlineData.mimeType}, data length: ${part.inlineData.data?.length || 0}`);
      }
    });
    console.log('[Gemini Carousel] ===== END ALL PARTS =====');

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: contentParts }],
      generationConfig
    });

    const response = result.response;

    if (!response.candidates || response.candidates.length === 0) {
      throw new Error('No image generated by Gemini');
    }

    const candidate = response.candidates[0];

    if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
      throw new Error('No image parts in response');
    }

    const imagePart = candidate.content.parts.find((part: any) => part.inlineData);

    if (!imagePart || !imagePart.inlineData || !imagePart.inlineData.data) {
      throw new Error('No image data in response');
    }

    const base64Image = imagePart.inlineData.data;

    console.log(`[Gemini Carousel] Card ${cardIndex + 1}/${totalCards} generated successfully`);
    console.log('[Gemini Carousel] Image size:', base64Image.length, 'bytes (base64)');

    return base64Image;

  } catch (error: any) {
    console.error(`[Gemini Carousel] Error generating card ${cardIndex + 1}:`, error);
    throw new Error(`Carousel card generation failed: ${error.message}`);
  }
}

/**
 * Генерирует все карточки карусели последовательно
 * Стратегия:
 * 1. Генерируем 1-ю карточку (только контент-референс от пользователя, если есть)
 * 2. Генерируем 2-ю карточку (контент-референс + карточка 0 как стиль-референс)
 * 3. Генерируем остальные карточки (контент-референс + карточка 1 как стиль-референс)
 *
 * @param carouselTexts - Массив текстов для карточек
 * @param userPrompt1 - PROMPT1 пользователя
 * @param visualStyle - Визуальный стиль карусели (по умолчанию 'clean_minimal')
 * @param customPrompts - Опциональные кастомные промпты для каждой карточки
 * @param referenceImages - Опциональные референсные изображения КОНТЕНТА для каждой карточки (base64)
 * @param stylePrompt - Промпт для freestyle стиля (пользователь сам задаёт визуальный стиль)
 * @returns Массив base64 изображений
 */
export async function generateCarouselImages(
  carouselTexts: string[],
  userPrompt1: string,
  visualStyle: CarouselVisualStyle = 'clean_minimal',
  customPrompts?: (string | null)[],
  referenceImages?: (string | null)[],
  stylePrompt?: string
): Promise<string[]> {
  try {
    console.log('[Gemini Carousel] Starting carousel generation...');
    console.log('[Gemini Carousel] Total cards:', carouselTexts.length);

    const generatedImages: string[] = [];
    const totalCards = carouselTexts.length;

    for (let i = 0; i < totalCards; i++) {
      const cardStartTime = Date.now();
      console.log(`[Gemini Carousel] Starting generation for card ${i + 1}/${totalCards}...`);

      const cardText = carouselTexts[i];
      const customPrompt = customPrompts?.[i] || undefined;

      // Референс КОНТЕНТА от пользователя (товар, персонаж и т.п.) — только для этой карточки
      // При первичной генерации передаём один референс как массив
      const contentRef = referenceImages?.[i];
      const contentReferenceArray = contentRef ? [contentRef] : undefined;

      // Референс СТИЛЯ (предыдущая сгенерированная карточка) — для консистентности дизайна
      let styleReference: string | undefined;
      if (i === 1 && generatedImages.length >= 1) {
        // Вторая карточка: используем первую как референс стиля
        styleReference = generatedImages[0];
      } else if (i >= 2 && generatedImages.length >= 2) {
        // Третья и последующие: используем вторую как референс стиля
        styleReference = generatedImages[1];
      }

      const image = await generateCarouselCard(
        cardText,
        i,
        totalCards,
        userPrompt1,
        visualStyle,
        customPrompt,
        styleReference,
        contentReferenceArray,
        undefined,  // currentCardImage — не используется при первичной генерации
        stylePrompt  // Для freestyle стиля
      );

      generatedImages.push(image);

      const cardEndTime = Date.now();
      const cardDuration = ((cardEndTime - cardStartTime) / 1000).toFixed(2);
      console.log(`[Gemini Carousel] Card ${i + 1}/${totalCards} generated in ${cardDuration}s`);

      // Небольшая пауза между генерациями, чтобы не перегрузить API
      if (i < totalCards - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log('[Gemini Carousel] All cards generated successfully');
    return generatedImages;

  } catch (error: any) {
    console.error('[Gemini Carousel] Error generating carousel:', error);
    throw new Error(`Carousel generation failed: ${error.message}`);
  }
}

/**
 * Перегенерирует одну карточку в существующей карусели
 * @param cardText - Текст для карточки
 * @param cardIndex - Индекс карточки (0-based)
 * @param existingImages - Существующие изображения карусели (base64)
 * @param userPrompt1 - PROMPT1 пользователя
 * @param visualStyle - Визуальный стиль карусели (по умолчанию 'clean_minimal')
 * @param customPrompt - Дополнительный промпт от пользователя
 * @param contentReferenceImages - Референсы контента от пользователя (до 2 штук)
 * @param stylePrompt - Промпт для freestyle стиля (пользователь сам задаёт визуальный стиль)
 * @returns Base64 изображение
 */
export async function regenerateCarouselCard(
  cardText: string,
  cardIndex: number,
  existingImages: string[],
  userPrompt1: string,
  visualStyle: CarouselVisualStyle = 'clean_minimal',
  customPrompt?: string,
  contentReferenceImages?: string[],
  stylePrompt?: string
): Promise<string> {
  try {
    console.log(`[Gemini Carousel] Regenerating card ${cardIndex + 1}...`);
    console.log('[Gemini Carousel] Content references from user:', contentReferenceImages?.length || 0);

    const totalCards = existingImages.length;

    // ТЕКУЩАЯ КАРТОЧКА — это изображение которое редактируем
    const currentCardImage = existingImages[cardIndex];
    console.log('[Gemini Carousel] Has current card to edit:', !!currentCardImage);

    // Референс СТИЛЯ — берём ДРУГУЮ карточку для консистентности
    // Важно: НЕ берём ту же карточку что редактируем!
    let styleReference: string | undefined;
    if (cardIndex === 0 && existingImages.length >= 2) {
      // Первая карточка: используем вторую как референс стиля
      styleReference = existingImages[1];
    } else if (cardIndex === 1 && existingImages.length >= 1) {
      // Вторая карточка: используем первую как референс стиля
      styleReference = existingImages[0];
    } else if (cardIndex >= 2 && existingImages.length >= 1) {
      // Третья и далее: используем первую карточку как референс стиля
      // (не вторую, т.к. вторая может быть той что редактируем)
      styleReference = existingImages[0];
    }

    const image = await generateCarouselCard(
      cardText,
      cardIndex,
      totalCards,
      userPrompt1,
      visualStyle,
      customPrompt,
      styleReference,
      contentReferenceImages,
      currentCardImage,  // Передаём текущую карточку для редактирования
      stylePrompt  // Для freestyle стиля
    );

    console.log(`[Gemini Carousel] Card ${cardIndex + 1} regenerated successfully`);
    return image;

  } catch (error: any) {
    console.error(`[Gemini Carousel] Error regenerating card ${cardIndex + 1}:`, error);
    throw new Error(`Card regeneration failed: ${error.message}`);
  }
}

/**
 * Upscale всех карточек карусели до 4K
 * @param images - Массив изображений в 2K (base64)
 * @param prompts - Массив промптов, использованных для генерации (для сохранения стиля)
 * @returns Массив upscaled изображений в 4K (base64)
 */
export async function upscaleCarouselTo4K(
  images: string[],
  prompts: string[]
): Promise<string[]> {
  try {
    console.log('[Gemini Carousel Upscale] Starting upscale to 4K...');
    console.log('[Gemini Carousel Upscale] Total images:', images.length);

    const upscaledImages: string[] = [];

    for (let i = 0; i < images.length; i++) {
      console.log(`[Gemini Carousel Upscale] Upscaling image ${i + 1}/${images.length}...`);

      const upscaledImage = await upscaleImageTo4K(
        images[i],
        prompts[i] || 'Premium минималистичный рекламный креатив',
        '1:1' // Карусель в формате 1:1
      );

      upscaledImages.push(upscaledImage);

      // Пауза между upscale
      if (i < images.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log('[Gemini Carousel Upscale] All images upscaled successfully');
    return upscaledImages;

  } catch (error: any) {
    console.error('[Gemini Carousel Upscale] Error upscaling carousel:', error);
    throw new Error(`Carousel upscale failed: ${error.message}`);
  }
}
