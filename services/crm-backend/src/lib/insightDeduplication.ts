/**
 * Insight Deduplication using semantic embeddings
 *
 * Находит похожие инсайты с помощью pgvector cosine similarity.
 * Использует OpenAI text-embedding-3-small для создания векторов.
 * Порог схожести 0.85 (85%) — настраивается через SIMILARITY_THRESHOLD.
 *
 * @module insightDeduplication
 * @see migrations/131_conversation_insights.sql
 */

import { supabase } from './supabase.js';
import { getEmbeddings } from './embeddings.js';
import { createLogger } from './logger.js';

const log = createLogger({ module: 'insightDeduplication' });

/** Порог схожести: 0.85 = 85% похоже по смыслу */
const SIMILARITY_THRESHOLD = 0.85;

export type InsightCategory = 'insight' | 'rejection_reason' | 'objection' | 'recommendation';

export interface InsightMatch {
  id: string;
  content: string;
  similarity: number;
  occurrence_count: number;
}

export interface LabeledInsight {
  text: string;
  isNew: boolean;
  metadata?: Record<string, any>;
}

interface SaveInsightParams {
  userAccountId: string;
  category: InsightCategory;
  content: string;
  embedding: number[];
  firstReportId: string;
  metadata?: Record<string, any>;
}

/**
 * Ищет похожий инсайт с помощью pgvector cosine similarity
 *
 * @param userAccountId - ID аккаунта пользователя
 * @param category - Категория инсайта (insight, rejection_reason, objection, recommendation)
 * @param embedding - Вектор embedding из OpenAI (1536 dims)
 * @returns Найденный похожий инсайт или null
 *
 * @description Использует SQL функцию find_similar_insight из миграции 131.
 * Порог схожести: 0.85 (85% cosine similarity).
 */
export async function findSimilarInsight(
  userAccountId: string,
  category: InsightCategory,
  embedding: number[]
): Promise<InsightMatch | null> {
  const startTime = Date.now();

  try {
    // Convert embedding array to pgvector format string
    const embeddingStr = `[${embedding.join(',')}]`;

    const { data, error } = await supabase.rpc('find_similar_insight', {
      p_user_account_id: userAccountId,
      p_category: category,
      p_embedding: embeddingStr,
      p_threshold: SIMILARITY_THRESHOLD
    });

    if (error) {
      log.error({
        error: error.message,
        category,
        durationMs: Date.now() - startTime
      }, 'Failed to find similar insight');
      return null;
    }

    if (!data || data.length === 0) {
      log.debug({
        category,
        durationMs: Date.now() - startTime
      }, 'No similar insight found');
      return null;
    }

    const match = {
      id: data[0].id,
      content: data[0].content,
      similarity: data[0].similarity,
      occurrence_count: data[0].occurrence_count
    };

    log.debug({
      category,
      similarity: match.similarity.toFixed(3),
      durationMs: Date.now() - startTime
    }, 'Similar insight found');

    return match;
  } catch (err: any) {
    log.error({
      error: err.message,
      category,
      durationMs: Date.now() - startTime
    }, 'Error in findSimilarInsight');
    return null;
  }
}

/**
 * Сохраняет новый инсайт в базу данных
 *
 * @param params - Параметры инсайта
 * @param params.userAccountId - ID аккаунта пользователя
 * @param params.category - Категория (insight, rejection_reason, objection, recommendation)
 * @param params.content - Текст инсайта
 * @param params.embedding - Вектор embedding (1536 dims)
 * @param params.firstReportId - ID первого отчёта где появился инсайт
 * @param params.metadata - Дополнительные данные (suggested_response для objections)
 * @returns ID созданного инсайта или null при ошибке
 */
export async function saveInsight(params: SaveInsightParams): Promise<string | null> {
  const { userAccountId, category, content, embedding, firstReportId, metadata } = params;
  const startTime = Date.now();

  // Валидация
  if (!content || content.trim().length === 0) {
    log.warn({ category }, 'Attempted to save empty insight, skipping');
    return null;
  }

  try {
    // Convert embedding array to pgvector format string
    const embeddingStr = `[${embedding.join(',')}]`;

    const { data, error } = await supabase
      .from('conversation_insights')
      .insert({
        user_account_id: userAccountId,
        category,
        content: content.trim(),
        embedding: embeddingStr,
        first_report_id: firstReportId,
        metadata: metadata || {},
        first_seen_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        occurrence_count: 1
      })
      .select('id')
      .single();

    if (error) {
      log.error({
        error: error.message,
        category,
        contentPreview: content.substring(0, 50),
        durationMs: Date.now() - startTime
      }, 'Failed to save insight');
      return null;
    }

    log.info({
      insightId: data.id,
      category,
      contentLength: content.length,
      durationMs: Date.now() - startTime
    }, 'New insight saved');

    return data.id;
  } catch (err: any) {
    log.error({
      error: err.message,
      category,
      durationMs: Date.now() - startTime
    }, 'Error in saveInsight');
    return null;
  }
}

/**
 * Обновляет счётчик повторений инсайта
 *
 * @param insightId - UUID существующего инсайта
 * @description Увеличивает occurrence_count на 1 и обновляет last_seen_at
 */
export async function updateInsightOccurrence(insightId: string): Promise<void> {
  const startTime = Date.now();

  try {
    // Получаем текущий счётчик и инкрементируем
    const { data: current, error: selectError } = await supabase
      .from('conversation_insights')
      .select('occurrence_count')
      .eq('id', insightId)
      .single();

    if (selectError) {
      log.error({ error: selectError.message, insightId }, 'Failed to get current occurrence count');
      return;
    }

    const newCount = (current?.occurrence_count || 1) + 1;

    const { error: updateError } = await supabase
      .from('conversation_insights')
      .update({
        last_seen_at: new Date().toISOString(),
        occurrence_count: newCount,
        updated_at: new Date().toISOString()
      })
      .eq('id', insightId);

    if (updateError) {
      log.error({ error: updateError.message, insightId }, 'Failed to update occurrence count');
      return;
    }

    log.debug({
      insightId,
      newCount,
      durationMs: Date.now() - startTime
    }, 'Insight occurrence updated');
  } catch (err: any) {
    log.error({
      error: err.message,
      insightId,
      durationMs: Date.now() - startTime
    }, 'Error updating insight occurrence');
  }
}

/**
 * Дедуплицирует список инсайтов одной категории
 *
 * @param userAccountId - ID аккаунта пользователя
 * @param reportId - ID текущего отчёта
 * @param items - Список текстов инсайтов
 * @param category - Категория (insight, rejection_reason, objection, recommendation)
 * @param metadataList - Опциональные метаданные для каждого инсайта
 * @returns Список инсайтов с пометкой isNew (true = новый, false = повторяющийся)
 *
 * @description
 * 1. Получает embeddings для всех текстов одним batch запросом к OpenAI
 * 2. Для каждого инсайта ищет похожий в БД (cosine similarity >= 0.85)
 * 3. Новые сохраняет в БД, повторяющиеся — обновляет occurrence_count
 *
 * @example
 * const labeled = await deduplicateInsights(userId, reportId, ['инсайт 1', 'инсайт 2'], 'insight');
 * // [{ text: 'инсайт 1', isNew: true }, { text: 'инсайт 2', isNew: false }]
 */
export async function deduplicateInsights(
  userAccountId: string,
  reportId: string,
  items: string[],
  category: InsightCategory,
  metadataList?: Record<string, any>[]
): Promise<LabeledInsight[]> {
  if (items.length === 0) return [];

  const startTime = Date.now();
  log.info({ category, count: items.length }, 'Starting insight deduplication');

  try {
    // 1. Get embeddings for all items in batch
    const embeddingStartTime = Date.now();
    const embeddings = await getEmbeddings(items);
    const embeddingDuration = Date.now() - embeddingStartTime;

    log.debug({
      category,
      embeddingDurationMs: embeddingDuration,
      count: embeddings.length
    }, 'Embeddings received');

    if (embeddings.length !== items.length) {
      log.warn({
        expected: items.length,
        got: embeddings.length,
        category
      }, 'Embedding count mismatch, some items may be skipped');
    }

    const result: LabeledInsight[] = [];
    let newCount = 0;
    let repeatCount = 0;

    // 2. Check each item for similarity
    for (let i = 0; i < items.length; i++) {
      const text = items[i];
      const embedding = embeddings[i];
      const metadata = metadataList?.[i];

      if (!embedding) {
        // No embedding for this item, treat as new
        log.warn({ category, index: i }, 'Missing embedding for item, treating as new');
        result.push({ text, isNew: true, metadata });
        newCount++;
        continue;
      }

      // 3. Find similar insight in DB
      const similar = await findSimilarInsight(userAccountId, category, embedding);

      if (similar) {
        // Found similar - update occurrence and mark as repeat
        await updateInsightOccurrence(similar.id);
        result.push({ text, isNew: false, metadata });
        repeatCount++;
      } else {
        // New insight - save to DB
        await saveInsight({
          userAccountId,
          category,
          content: text,
          embedding,
          firstReportId: reportId,
          metadata
        });
        result.push({ text, isNew: true, metadata });
        newCount++;
      }
    }

    log.info({
      category,
      total: items.length,
      new: newCount,
      repeat: repeatCount,
      durationMs: Date.now() - startTime
    }, 'Insight deduplication completed');

    return result;
  } catch (err: any) {
    log.error({
      error: err.message,
      category,
      durationMs: Date.now() - startTime
    }, 'Failed to deduplicate insights');
    // Return all as new if deduplication fails
    return items.map(text => ({ text, isNew: true }));
  }
}

/**
 * Дедуплицирует все категории инсайтов параллельно
 *
 * @param userAccountId - ID аккаунта пользователя
 * @param reportId - ID текущего отчёта
 * @param llmAnalysis - Результат LLM анализа диалогов
 * @returns Объект со всеми категориями labeled инсайтов
 *
 * @description
 * Обрабатывает 4 категории параллельно:
 * - insights — ключевые инсайты
 * - rejection_reasons — причины отказа
 * - objections — возражения клиентов
 * - recommendations — рекомендации
 *
 * Каждый инсайт получает пометку isNew:
 * - true = новый (сохранён в БД)
 * - false = похожий уже есть (обновлён occurrence_count)
 */
export async function deduplicateAllInsights(
  userAccountId: string,
  reportId: string,
  llmAnalysis: {
    insights: string[];
    rejection_reasons: Array<{ reason: string; count: number }>;
    common_objections: Array<{ objection: string; count: number; suggested_response?: string }>;
    recommendations: string[];
  }
): Promise<{
  insights: LabeledInsight[];
  rejection_reasons: LabeledInsight[];
  objections: LabeledInsight[];
  recommendations: LabeledInsight[];
}> {
  const startTime = Date.now();

  const totalItems =
    llmAnalysis.insights.length +
    llmAnalysis.rejection_reasons.length +
    llmAnalysis.common_objections.length +
    llmAnalysis.recommendations.length;

  log.info({
    reportId,
    totalItems,
    insights: llmAnalysis.insights.length,
    rejections: llmAnalysis.rejection_reasons.length,
    objections: llmAnalysis.common_objections.length,
    recommendations: llmAnalysis.recommendations.length
  }, 'Starting full insight deduplication');

  const [insights, rejection_reasons, objections, recommendations] = await Promise.all([
    deduplicateInsights(userAccountId, reportId, llmAnalysis.insights, 'insight'),
    deduplicateInsights(
      userAccountId,
      reportId,
      llmAnalysis.rejection_reasons.map(r => r.reason),
      'rejection_reason'
    ),
    deduplicateInsights(
      userAccountId,
      reportId,
      llmAnalysis.common_objections.map(o => o.objection),
      'objection',
      llmAnalysis.common_objections.map(o => ({ suggested_response: o.suggested_response }))
    ),
    deduplicateInsights(userAccountId, reportId, llmAnalysis.recommendations, 'recommendation'),
  ]);

  const totalNew = insights.filter(i => i.isNew).length +
    rejection_reasons.filter(i => i.isNew).length +
    objections.filter(i => i.isNew).length +
    recommendations.filter(i => i.isNew).length;

  const totalRepeat = totalItems - totalNew;

  log.info({
    reportId,
    totalNew,
    totalRepeat,
    durationMs: Date.now() - startTime,
    breakdown: {
      insights: { new: insights.filter(i => i.isNew).length, total: insights.length },
      rejection_reasons: { new: rejection_reasons.filter(i => i.isNew).length, total: rejection_reasons.length },
      objections: { new: objections.filter(i => i.isNew).length, total: objections.length },
      recommendations: { new: recommendations.filter(i => i.isNew).length, total: recommendations.length },
    }
  }, 'Full insight deduplication completed');

  return { insights, rejection_reasons, objections, recommendations };
}

export { SIMILARITY_THRESHOLD };
