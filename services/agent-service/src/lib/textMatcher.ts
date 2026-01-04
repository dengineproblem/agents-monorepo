import { supabase } from './supabaseClient.js';
import { createLogger } from './logger.js';
import { shouldFilterByAccountId } from './multiAccountHelper.js';

const log = createLogger({ module: 'textMatcher' });

interface MatchResult {
  matched: boolean;
  similarity: number;
  directionId: string | null;
  directionName: string | null;
}

/**
 * Нормализует текст для сравнения
 * - приводит к нижнему регистру
 * - удаляет пунктуацию
 * - нормализует пробелы
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[!?.,:;'"«»""()[\]{}]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Вычисляет Jaccard similarity между двумя текстами
 * Возвращает число от 0 до 1
 */
function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.split(' ').filter(w => w.length > 0));
  const wordsB = new Set(b.split(' ').filter(w => w.length > 0));

  if (wordsA.size === 0 || wordsB.size === 0) {
    return 0;
  }

  const intersection = [...wordsA].filter(x => wordsB.has(x)).length;
  const union = new Set([...wordsA, ...wordsB]).size;

  return intersection / union;
}

/**
 * Вычисляет схожесть двух текстов
 * Использует комбинацию методов для лучшего результата
 */
export function calculateSimilarity(text1: string, text2: string): number {
  const norm1 = normalize(text1);
  const norm2 = normalize(text2);

  // Если хотя бы один текст пустой — нет совпадения
  if (norm1.length === 0 || norm2.length === 0) {
    return 0;
  }

  // Точное совпадение после нормализации
  if (norm1 === norm2) {
    return 1.0;
  }

  // Вхождение одного текста в другой (с учётом длины)
  if (norm1.includes(norm2)) {
    // Чем больше совпадение относительно длины, тем выше score
    const ratio = norm2.length / norm1.length;
    return Math.max(0.85, ratio);
  }

  if (norm2.includes(norm1)) {
    const ratio = norm1.length / norm2.length;
    return Math.max(0.85, ratio);
  }

  // Jaccard similarity по словам
  return jaccardSimilarity(norm1, norm2);
}

/**
 * Ищет направление по совпадению сообщения с client_question
 * Возвращает направление с наибольшим совпадением >= порога
 *
 * @param messageText - Текст сообщения для сравнения
 * @param userAccountId - UUID пользователя
 * @param accountId - UUID рекламного аккаунта для мультиаккаунтности (NULL для legacy)
 * @param threshold - Минимальный порог совпадения (0-1)
 */
export async function matchMessageToDirection(
  messageText: string,
  userAccountId: string,
  accountId: string | null,
  threshold: number = 0.7
): Promise<MatchResult> {
  try {
    // Получаем все активные направления пользователя с настройками
    let query = supabase
      .from('account_directions')
      .select(`
        id,
        name,
        objective,
        default_ad_settings!inner(client_question)
      `)
      .eq('user_account_id', userAccountId)
      .eq('is_active', true)
      .eq('objective', 'whatsapp');

    // Фильтр по account_id ТОЛЬКО в multi-account режиме (см. MULTI_ACCOUNT_GUIDE.md)
    // В legacy режиме возвращаем все направления пользователя
    if (await shouldFilterByAccountId(supabase, userAccountId, accountId)) {
      query = query.eq('account_id', accountId);
    }

    const { data: directions, error } = await query;

    if (error) {
      log.error({ error, userAccountId }, 'Failed to fetch directions');
      return { matched: false, similarity: 0, directionId: null, directionName: null };
    }

    if (!directions || directions.length === 0) {
      log.debug({ userAccountId }, 'No whatsapp directions found');
      return { matched: false, similarity: 0, directionId: null, directionName: null };
    }

    let bestMatch: MatchResult = {
      matched: false,
      similarity: 0,
      directionId: null,
      directionName: null
    };

    // Сравниваем сообщение с client_question каждого направления
    for (const direction of directions) {
      const settings = direction.default_ad_settings as any;
      const clientQuestion = settings?.client_question;

      if (!clientQuestion) {
        continue;
      }

      const similarity = calculateSimilarity(messageText, clientQuestion);

      log.debug({
        directionId: direction.id,
        directionName: direction.name,
        clientQuestion,
        messageText: messageText.substring(0, 100),
        similarity
      }, 'Comparing message with direction');

      if (similarity > bestMatch.similarity) {
        bestMatch = {
          matched: similarity >= threshold,
          similarity,
          directionId: direction.id,
          directionName: direction.name
        };
      }
    }

    if (bestMatch.matched) {
      log.info({
        userAccountId,
        accountId,
        directionId: bestMatch.directionId,
        directionName: bestMatch.directionName,
        similarity: bestMatch.similarity
      }, 'Message matched to direction via client_question');
    }

    return bestMatch;
  } catch (error: any) {
    log.error({ error: error.message, userAccountId }, 'Error in matchMessageToDirection');
    return { matched: false, similarity: 0, directionId: null, directionName: null };
  }
}
