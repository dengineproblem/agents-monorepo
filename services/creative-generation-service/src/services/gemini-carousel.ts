import { GoogleGenerativeAI } from '@google/generative-ai';
import { generateCarouselCardPrompt } from './carouselPromptGenerator';
import { upscaleImageTo4K } from './gemini-image';
import { CarouselVisualStyle, CardChangeOption } from '../types';

let defaultGenAI: GoogleGenerativeAI | null = null;

function getGeminiClient(customApiKey?: string | null): GoogleGenerativeAI {
  if (customApiKey) {
    console.log('[Gemini Carousel] Using per-account API key (...%s)', customApiKey.slice(-4));
    return new GoogleGenerativeAI(customApiKey);
  }
  if (!defaultGenAI) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY must be set in environment variables');
    }
    defaultGenAI = new GoogleGenerativeAI(apiKey);
  }
  return defaultGenAI;
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
 * @param changeOptions - Что именно менять при перегенерации (если не указано — меняем всё)
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
  stylePrompt?: string,
  changeOptions?: CardChangeOption[],
  openaiApiKey?: string | null,
  geminiApiKey?: string | null
): Promise<string> {
  try {
    console.log(`[Gemini Carousel] Generating card ${cardIndex + 1}/${totalCards}...`);
    console.log('[Gemini Carousel] Has style reference:', !!styleReferenceImage);
    console.log('[Gemini Carousel] Content references count:', contentReferenceImages?.length || 0);
    console.log('[Gemini Carousel] Has current card (edit mode):', !!currentCardImage);

    // Для freestyle — используем stylePrompt напрямую без GPT-4o
    // Для других стилей — генерируем промпт через LLM-агент
    let prompt: string;

    if (visualStyle === 'freestyle' && stylePrompt) {
      // Freestyle: передаём промпт пользователя напрямую с минимальной обёрткой
      const cardPosition =
        cardIndex === 0 ? 'первая (хук)' :
        cardIndex === totalCards - 1 ? 'последняя (CTA)' :
        'промежуточная';

      prompt = `${stylePrompt}

Это карточка ${cardIndex + 1} из ${totalCards} (${cardPosition}).

Текст на карточке: "${cardText}"

${customPrompt ? `Дополнительные требования: ${customPrompt}` : ''}

Формат: квадратное изображение 1:1, 1080×1080 для Instagram карусели.
Текст должен быть размещён на изображении в безопасной зоне (не в самом верху/низу).`;

      console.log('[Gemini Carousel] Freestyle mode: using stylePrompt directly (no GPT-4o)');
    } else {
      // Другие стили: генерируем базовый промпт через GPT-4o (без customPrompt)
      prompt = await generateCarouselCardPrompt(
        userPrompt1,
        cardText,
        cardIndex,
        totalCards,
        visualStyle,
        undefined,  // customPrompt передаём напрямую, не через GPT-4o
        stylePrompt,
        openaiApiKey
      );

      // Добавляем customPrompt напрямую к финальному промпту
      if (customPrompt) {
        prompt += `\n\nДополнительные требования пользователя: ${customPrompt}`;
      }
    }

    console.log('[Gemini Carousel] Prompt length:', prompt.length);
    console.log('[Gemini Carousel] ===== FULL PROMPT FOR GEMINI =====');
    console.log(prompt);
    console.log('[Gemini Carousel] ===== END PROMPT =====');

    const client = getGeminiClient(geminiApiKey);
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
      console.log('[Gemini Carousel] Change options:', changeOptions || 'all (default)');

      // Формируем инструкцию в зависимости от того, что нужно менять
      let editInstruction: string;

      if (changeOptions && changeOptions.length > 0) {
        // Пользователь выбрал конкретные элементы для изменения
        const changeLabels: Record<CardChangeOption, string> = {
          'background': 'ФОН (сцена, цвета, атмосфера)',
          'typography': 'ТИПОГРАФИКА (шрифт, размер, расположение текста)',
          'main_object': 'ОСНОВНОЙ ОБЪЕКТ (персонаж/предмет — поза, ракурс, действие)',
          'composition': 'КОМПОЗИЦИЯ (расположение элементов на изображении)'
        };

        const keepLabels: Record<CardChangeOption, string> = {
          'background': 'фон и атмосферу',
          'typography': 'типографику и расположение текста',
          'main_object': 'основной объект/персонаж',
          'composition': 'общую композицию'
        };

        const allOptions: CardChangeOption[] = ['background', 'typography', 'main_object', 'composition'];
        const toChange = changeOptions;
        const toKeep = allOptions.filter(opt => !changeOptions.includes(opt));

        const changeList = toChange.map(opt => `• ${changeLabels[opt]}`).join('\n');
        const keepList = toKeep.length > 0
          ? toKeep.map(opt => keepLabels[opt]).join(', ')
          : '';

        editInstruction = `[ИЗОБРАЖЕНИЕ ДЛЯ РЕДАКТИРОВАНИЯ]
Это текущая карточка. Тебе нужно создать НОВУЮ версию с КОНКРЕТНЫМИ изменениями.

⚡ ИЗМЕНИТЬ (пользователь явно попросил):
${changeList}

${toKeep.length > 0 ? `✓ СОХРАНИТЬ БЕЗ ИЗМЕНЕНИЙ:
${keepList}` : '✓ Можешь изменить ВСЁ — пользователь выбрал все элементы для изменения.'}

ВАЖНО: Инструкции пользователя (custom_prompt) имеют ВЫСШИЙ ПРИОРИТЕТ. Если пользователь просит изменить фон — МЕНЯЙ ФОН ПОЛНОСТЬЮ, даже если он был хорош.`;
      } else {
        // По умолчанию — улучшаем всё, но инструкции пользователя в приоритете
        editInstruction = `[ИЗОБРАЖЕНИЕ ДЛЯ РЕДАКТИРОВАНИЯ]
Это текущая карточка. Создай НОВУЮ улучшенную версию.

ВАЖНО: Если есть дополнительные инструкции от пользователя (custom_prompt) — они имеют ВЫСШИЙ ПРИОРИТЕТ!
• Если пользователь просит изменить фон — ПОЛНОСТЬЮ МЕНЯЙ ФОН
• Если пользователь просит изменить композицию — МЕНЯЙ КОМПОЗИЦИЮ
• Если пользователь просит изменить персонажа/объект — МЕНЯЙ ЕГО

Только если инструкций нет — сохраняй общую концепцию с небольшими улучшениями.`;
      }

      contentParts.push({ text: '\n\n' + editInstruction });
      contentParts.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data: currentCardImage
        }
      });
    }

    // Добавляем референсы от пользователя — просто с меткой "Референс"
    if (contentReferenceImages && contentReferenceImages.length > 0) {
      console.log(`[Gemini Carousel] Adding ${contentReferenceImages.length} reference(s)...`);

      for (let i = 0; i < contentReferenceImages.length; i++) {
        const refImage = contentReferenceImages[i];
        const refLabel = contentReferenceImages.length > 1 ? `Референс ${i + 1}:` : 'Референс:';
        contentParts.push({ text: `\n\n${refLabel}` });
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
 * @param referenceImages - Опциональные референсные изображения КОНТЕНТА для каждой карточки (массив до 2 референсов на карточку)
 * @param stylePrompt - Промпт для freestyle стиля (пользователь сам задаёт визуальный стиль)
 * @returns Массив base64 изображений
 */
export async function generateCarouselImages(
  carouselTexts: string[],
  userPrompt1: string,
  visualStyle: CarouselVisualStyle = 'clean_minimal',
  customPrompts?: (string | null)[],
  referenceImages?: (string[] | null)[],
  stylePrompt?: string,
  openaiApiKey?: string | null,
  geminiApiKey?: string | null
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

      // Референс КОНТЕНТА от пользователя (товар, персонаж и т.п.) — массив для этой карточки (до 2 референсов)
      const contentReferenceArray = referenceImages?.[i] || undefined;

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
        stylePrompt,  // Для freestyle стиля
        undefined,  // changeOptions — не используются при первичной генерации
        openaiApiKey,
        geminiApiKey
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
 * @param changeOptions - Что именно менять при перегенерации (если не указано — меняем всё)
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
  stylePrompt?: string,
  changeOptions?: CardChangeOption[],
  openaiApiKey?: string | null,
  geminiApiKey?: string | null
): Promise<string> {
  try {
    console.log(`[Gemini Carousel] Regenerating card ${cardIndex + 1}...`);
    console.log('[Gemini Carousel] Content references from user:', contentReferenceImages?.length || 0);

    const totalCards = existingImages.length;

    // ТЕКУЩАЯ КАРТОЧКА — это изображение которое редактируем
    const currentCardImage = existingImages[cardIndex];
    console.log('[Gemini Carousel] Has current card to edit:', !!currentCardImage);

    // При перегенерации НЕ используем стиль-референс от другой карточки
    // Текущая карточка уже задаёт стиль — её достаточно

    const image = await generateCarouselCard(
      cardText,
      cardIndex,
      totalCards,
      userPrompt1,
      visualStyle,
      customPrompt,
      undefined,  // styleReference — не нужен при перегенерации
      contentReferenceImages,
      currentCardImage,  // Передаём текущую карточку для редактирования
      stylePrompt,  // Для freestyle стиля
      changeOptions,  // Что именно менять при перегенерации
      openaiApiKey,
      geminiApiKey
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
  prompts: string[],
  geminiApiKey?: string | null
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
        '1:1', // Карусель в формате 1:1
        geminiApiKey
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
