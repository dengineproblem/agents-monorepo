import OpenAI from 'openai';
import { buildImagePrompt } from './prompts';

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

if (!apiKey) {
  throw new Error('OPENAI_API_KEY must be set in environment variables');
}

const openai = new OpenAI({
  apiKey: apiKey,
});

/**
 * Генерация текста через OpenAI
 * @param systemPrompt - Системный промпт с инструкциями
 * @param userPrompt - Промпт пользователя
 * @param options - Дополнительные опции (temperature, seed для вариативности)
 * @returns Сгенерированный текст
 */
export async function generateText(
  systemPrompt: string, 
  userPrompt: string,
  options?: { temperature?: number; seed?: number }
): Promise<string> {
  try {
    console.log('[OpenAI] Generating text with model:', model);
    
    // GPT-5-mini не поддерживает кастомную temperature (только 1.0)
    const requestParams: any = {
      model: model,
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: userPrompt
        }
      ],
      max_completion_tokens: 16000,
    };
    
    // Для старых моделей добавляем temperature
    if (!model.includes('gpt-5')) {
      // Используем переданную temperature или 0.9 по умолчанию для большей вариативности
      requestParams.temperature = options?.temperature ?? 0.9;
    }
    
    // Добавляем seed для воспроизводимости или случайности
    if (options?.seed !== undefined) {
      requestParams.seed = options.seed;
    }
    
    const completion = await openai.chat.completions.create(requestParams);
    
    console.log('[OpenAI] ===== ПОЛНЫЙ ОТВЕТ ОТ OPENAI =====');
    console.log('[OpenAI] completion.id:', completion.id);
    console.log('[OpenAI] completion.model:', completion.model);
    console.log('[OpenAI] completion.choices.length:', completion.choices?.length);
    console.log('[OpenAI] completion.choices[0]:', JSON.stringify(completion.choices[0], null, 2));
    console.log('[OpenAI] completion.choices[0]?.message:', completion.choices[0]?.message);
    console.log('[OpenAI] completion.choices[0]?.message?.content:', completion.choices[0]?.message?.content);
    console.log('[OpenAI] completion.choices[0]?.message?.content type:', typeof completion.choices[0]?.message?.content);
    
    const text = completion.choices[0]?.message?.content || '';
    
    console.log('[OpenAI] ===== ИЗВЛЕЧЕННЫЙ ТЕКСТ =====');
    console.log('[OpenAI] Generated text length:', text.length);
    console.log('[OpenAI] Generated text (first 200 chars):', text.substring(0, 200));
    console.log('[OpenAI] Generated text (full):', text);
    console.log('[OpenAI] Is empty?:', text === '');
    console.log('[OpenAI] Is whitespace only?:', text.trim() === '');
    
    if (text.length === 0) {
      console.error('[OpenAI] ❌ WARNING: OpenAI returned empty content!');
      console.error('[OpenAI] Request params:', JSON.stringify(requestParams, null, 2));
    }
    
    return text;
  } catch (error: any) {
    console.error('[OpenAI] Error generating text:', error);
    throw new Error(`OpenAI text generation failed: ${error.message}`);
  }
}

/**
 * Генерация изображения с текстом через DALL-E 3
 * ВНИМАНИЕ: DALL-E 3 не может накладывать текст на изображения
 * Эта функция генерирует только фоновое изображение
 * Текст нужно будет накладывать отдельно с помощью canvas или других инструментов
 * 
 * @param offer - Заголовок креатива
 * @param bullets - Буллеты
 * @param profits - Выгода
 * @param cta - Call-to-action
 * @param userPrompt4 - Пользовательский промпт для стилизации изображения
 * @returns URL сгенерированного изображения (временный URL от OpenAI)
 */
export async function generateCreativeImage(
  offer: string,
  bullets: string,
  profits: string,
  cta: string,
  userPrompt4: string
): Promise<string> {
  try {
    // DALL-E 3 генерирует только фоновое изображение
    // Текст на изображение нужно накладывать отдельно
    const backgroundPrompt = `
Create a professional advertising background image for Instagram Stories (1080x1920 pixels, 9:16 ratio).

Style requirements based on user context:
${userPrompt4 || 'Modern professional design with vibrant colors'}

IMPORTANT: 
- Create ONLY the background/style without any text
- Leave space for text overlay (safe zones: top 100px, bottom 100px, sides 60px)
- Use colors and composition that will work well with text overlay
- Professional advertising quality
- Optimized for mobile viewing

The image will later have this text overlaid:
Headline: "${offer}"
Bullets: ${bullets}
Benefit: "${profits}"
CTA: "${cta}"

Generate a beautiful background that complements these texts but DO NOT include the text in the image.
`;
    
    console.log('[OpenAI] Generating background image with DALL-E 3...');
    console.log('[OpenAI] Note: Text overlay will need to be added separately');
    
    const response = await openai.images.generate({
      model: 'dall-e-3',
      prompt: backgroundPrompt,
      n: 1,
      size: '1024x1792', // Closest to 9:16 ratio available in DALL-E 3
      quality: 'hd',
      response_format: 'url',
    });
    
    if (!response.data || response.data.length === 0) {
      throw new Error('No image data in OpenAI response');
    }
    
    const imageUrl = response.data[0]?.url;
    
    if (!imageUrl) {
      throw new Error('No image URL in OpenAI response');
    }
    
    console.log('[OpenAI] Background image generated successfully');
    console.log('[OpenAI] Image URL:', imageUrl);
    console.log('[OpenAI] WARNING: This is only the background. Text needs to be overlaid separately.');
    
    return imageUrl;
  } catch (error: any) {
    console.error('[OpenAI] Error generating image:', error);
    throw new Error(`OpenAI image generation failed: ${error.message}`);
  }
}

/**
 * Инициализация и проверка доступности OpenAI API
 */
export async function initializeOpenAI(): Promise<void> {
  try {
    console.log('[OpenAI] Initializing API...');
    console.log('[OpenAI] Model configured:', model);
    console.log('[OpenAI] API initialized successfully');
    
    // Проверяем доступность API простым запросом
    await openai.models.list();
    console.log('[OpenAI] API connection verified');
  } catch (error: any) {
    console.error('[OpenAI] Failed to initialize API:', error);
    throw new Error(`OpenAI API initialization failed: ${error.message}`);
  }
}

