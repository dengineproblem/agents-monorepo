import { supabase } from './supabase.js';
import { parseDocument, formatPriceListForPrompt, extractSummary, ParsedDocument } from './documentParser.js';

export interface PromptGenerationParams {
  userAccountId: string;
  businessInfo?: string;
  documents?: ParsedDocument[];
  userInstructions?: string;
}

/**
 * Генерация AI промпта для чат-бота
 * На основе: анализа диалогов + загруженных документов + ручных инструкций
 */
export async function generateBotPrompt(
  params: PromptGenerationParams
): Promise<string> {
  const { userAccountId, businessInfo, documents, userInstructions } = params;
  
  let prompt = '';
  
  // 1. Базовая роль
  prompt += `Ты — AI-ассистент по продажам для бизнеса.\n\n`;
  
  // 2. Информация о бизнесе (из анализа диалогов)
  if (businessInfo) {
    prompt += `О компании: ${businessInfo}\n\n`;
  } else {
    // Попытаться получить из dialog_analysis
    const analyzedInfo = await extractBusinessInfoFromDialogs(userAccountId);
    if (analyzedInfo) {
      prompt += `О компании: ${analyzedInfo}\n\n`;
    }
  }
  
  // 3. Информация из документов
  if (documents && documents.length > 0) {
    prompt += `=== ИНФОРМАЦИЯ ИЗ ДОКУМЕНТОВ ===\n\n`;
    
    for (const doc of documents) {
      if (doc.type === 'price_list' && doc.structured) {
        prompt += `ПРАЙС-ЛИСТ (${doc.metadata?.filename}):\n`;
        prompt += formatPriceListForPrompt(doc.structured);
        prompt += `\n\n`;
      } else {
        prompt += `ДОКУМЕНТ: ${doc.metadata?.filename}\n`;
        prompt += extractSummary(doc.content, 1000);
        prompt += `\n\n`;
      }
    }
  }
  
  // 4. Базовые инструкции
  prompt += `=== ТВОИ ЗАДАЧИ ===\n`;
  prompt += `1. Квалифицировать лида:\n`;
  prompt += `   - Это владелец бизнеса?\n`;
  prompt += `   - Какой тип бизнеса?\n`;
  prompt += `   - Есть ли опыт запуска рекламы?\n`;
  prompt += `   - Какой бюджет на рекламу?\n\n`;
  
  prompt += `2. Отвечать на вопросы о продукте/услуге:\n`;
  prompt += `   - Используй информацию из документов\n`;
  prompt += `   - Если есть прайс-лист, можешь называть цены\n`;
  prompt += `   - Будь конкретным и полезным\n\n`;
  
  prompt += `3. Записывать на консультацию:\n`;
  prompt += `   - Предложи удобное время\n`;
  prompt += `   - Уточни контактные данные\n`;
  prompt += `   - Подтверди запись\n\n`;
  
  prompt += `4. Двигать по воронке продаж:\n`;
  prompt += `   - new_lead → qualified (после квалификации)\n`;
  prompt += `   - qualified → consultation_booked (после записи)\n`;
  prompt += `   - consultation_booked → consultation_completed (после встречи)\n\n`;
  
  prompt += `=== ПРАВИЛА ОБЩЕНИЯ ===\n`;
  prompt += `- Пиши коротко (1-3 предложения)\n`;
  prompt += `- Используй имя клиента, если известно\n`;
  prompt += `- Будь дружелюбным, но профессиональным\n`;
  prompt += `- Не навязывайся, но будь активным\n`;
  prompt += `- Если клиент просит менеджера → установи needs_human: true\n\n`;
  
  // 5. Ручные инструкции пользователя (высший приоритет)
  if (userInstructions) {
    prompt += `=== ДОПОЛНИТЕЛЬНЫЕ ИНСТРУКЦИИ ОТ ВЛАДЕЛЬЦА ===\n`;
    prompt += userInstructions + `\n\n`;
  }
  
  // 6. Формат ответа
  prompt += `=== ФОРМАТ ОТВЕТА ===\n`;
  prompt += `Всегда отвечай в JSON формате:\n`;
  prompt += `{\n`;
  prompt += `  "response": "текст ответа клиенту",\n`;
  prompt += `  "move_to_stage": "qualified" | "consultation_booked" | null,\n`;
  prompt += `  "needs_human": true | false,\n`;
  prompt += `  "save_info": { "business_type": "...", "budget": "..." } | null\n`;
  prompt += `}\n`;
  
  return prompt;
}

/**
 * Извлечь информацию о бизнесе из анализов диалогов
 */
async function extractBusinessInfoFromDialogs(
  userAccountId: string
): Promise<string | null> {
  const { data } = await supabase
    .from('dialog_analysis')
    .select('business_type, business_intent')
    .eq('user_account_id', userAccountId)
    .not('business_type', 'is', null)
    .limit(10);

  if (!data || data.length === 0) return null;
  
  // Собрать уникальные типы бизнеса
  const businessTypes = new Set(
    data
      .map(d => d.business_type)
      .filter(Boolean)
  );
  
  const businessIntents = data
    .map(d => d.business_intent)
    .filter(Boolean)
    .slice(0, 3);
  
  let info = '';
  
  if (businessTypes.size > 0) {
    info += `Типичные клиенты: ${Array.from(businessTypes).join(', ')}. `;
  }
  
  if (businessIntents.length > 0) {
    info += `Частые запросы: ${businessIntents.join(', ')}.`;
  }
  
  return info || null;
}

/**
 * Сохранить сгенерированный промпт в конфигурацию бота
 */
export async function saveBotConfiguration(params: {
  userAccountId: string;
  aiInstructions: string;
  userInstructions?: string;
  documents?: Array<{ name: string; url: string; type: string; size: number }>;
  triggers?: Array<{ keyword: string; response: string; moveToStage?: string }>;
}): Promise<{ success: boolean; configId?: string; error?: string }> {
  try {
    // Проверить существование конфигурации
    const { data: existing } = await supabase
      .from('chatbot_configurations')
      .select('id')
      .eq('user_account_id', params.userAccountId)
      .maybeSingle();

    if (existing) {
      // Обновить существующую
      const { data, error } = await supabase
        .from('chatbot_configurations')
        .update({
          ai_instructions: params.aiInstructions,
          user_instructions: params.userInstructions,
          documents: params.documents || [],
          triggers: params.triggers || [],
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) throw error;
      
      return { success: true, configId: data.id };
    } else {
      // Создать новую
      const { data, error } = await supabase
        .from('chatbot_configurations')
        .insert({
          user_account_id: params.userAccountId,
          ai_instructions: params.aiInstructions,
          user_instructions: params.userInstructions,
          documents: params.documents || [],
          triggers: params.triggers || [],
          active: true
        })
        .select()
        .single();

      if (error) throw error;
      
      return { success: true, configId: data.id };
    }
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Получить конфигурацию бота
 */
export async function getBotConfiguration(
  userAccountId: string
): Promise<any | null> {
  const { data, error } = await supabase
    .from('chatbot_configurations')
    .select('*')
    .eq('user_account_id', userAccountId)
    .eq('active', true)
    .maybeSingle();

  if (error) {
    console.error('Error fetching bot configuration:', error);
    return null;
  }

  return data;
}

