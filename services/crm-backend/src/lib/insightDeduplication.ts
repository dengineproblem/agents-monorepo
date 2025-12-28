/**
 * Insight Deduplication using semantic embeddings
 * Finds similar insights using pgvector cosine similarity
 */

import { supabase } from './supabase.js';
import { getEmbeddings } from './embeddings.js';
import { createLogger } from './logger.js';

const log = createLogger({ module: 'insightDeduplication' });

// Similarity threshold: 0.85 = 85% similar by meaning
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
 * Find similar insight using pgvector cosine similarity
 */
export async function findSimilarInsight(
  userAccountId: string,
  category: InsightCategory,
  embedding: number[]
): Promise<InsightMatch | null> {
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
      log.error({ error: error.message, category }, 'Failed to find similar insight');
      return null;
    }

    if (!data || data.length === 0) {
      return null;
    }

    return {
      id: data[0].id,
      content: data[0].content,
      similarity: data[0].similarity,
      occurrence_count: data[0].occurrence_count
    };
  } catch (err: any) {
    log.error({ error: err.message, category }, 'Error in findSimilarInsight');
    return null;
  }
}

/**
 * Save new insight to database
 */
export async function saveInsight(params: SaveInsightParams): Promise<string | null> {
  const { userAccountId, category, content, embedding, firstReportId, metadata } = params;

  try {
    // Convert embedding array to pgvector format string
    const embeddingStr = `[${embedding.join(',')}]`;

    const { data, error } = await supabase
      .from('conversation_insights')
      .insert({
        user_account_id: userAccountId,
        category,
        content,
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
      log.error({ error: error.message, category, content: content.substring(0, 50) }, 'Failed to save insight');
      return null;
    }

    log.debug({ insightId: data.id, category }, 'New insight saved');
    return data.id;
  } catch (err: any) {
    log.error({ error: err.message, category }, 'Error in saveInsight');
    return null;
  }
}

/**
 * Update insight occurrence count and last_seen_at
 */
export async function updateInsightOccurrence(insightId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('conversation_insights')
      .update({
        last_seen_at: new Date().toISOString(),
        occurrence_count: supabase.rpc('increment_occurrence', { row_id: insightId }),
        updated_at: new Date().toISOString()
      })
      .eq('id', insightId);

    if (error) {
      // Fallback: manual increment
      const { data: current } = await supabase
        .from('conversation_insights')
        .select('occurrence_count')
        .eq('id', insightId)
        .single();

      if (current) {
        await supabase
          .from('conversation_insights')
          .update({
            last_seen_at: new Date().toISOString(),
            occurrence_count: (current.occurrence_count || 1) + 1,
            updated_at: new Date().toISOString()
          })
          .eq('id', insightId);
      }
    }
  } catch (err: any) {
    log.error({ error: err.message, insightId }, 'Error updating insight occurrence');
  }
}

/**
 * Deduplicate insights: find similar ones and mark new vs repeat
 */
export async function deduplicateInsights(
  userAccountId: string,
  reportId: string,
  items: string[],
  category: InsightCategory,
  metadataList?: Record<string, any>[]
): Promise<LabeledInsight[]> {
  if (items.length === 0) return [];

  log.debug({ category, count: items.length }, 'Starting insight deduplication');

  try {
    // 1. Get embeddings for all items in batch
    const embeddings = await getEmbeddings(items);

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
        result.push({ text, isNew: true, metadata });
        continue;
      }

      // 3. Find similar insight in DB
      const similar = await findSimilarInsight(userAccountId, category, embedding);

      if (similar) {
        // Found similar - update occurrence and mark as repeat
        await updateInsightOccurrence(similar.id);
        result.push({ text, isNew: false, metadata });
        repeatCount++;
        log.debug({
          category,
          similarity: similar.similarity.toFixed(3),
          existingContent: similar.content.substring(0, 30)
        }, 'Found similar insight');
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
      repeat: repeatCount
    }, 'Insight deduplication completed');

    return result;
  } catch (err: any) {
    log.error({ error: err.message, category }, 'Failed to deduplicate insights');
    // Return all as new if deduplication fails
    return items.map(text => ({ text, isNew: true }));
  }
}

/**
 * Deduplicate all insight categories in parallel
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
  log.info({ reportId }, 'Starting full insight deduplication');

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

  const totalRepeat = (insights.length + rejection_reasons.length + objections.length + recommendations.length) - totalNew;

  log.info({
    reportId,
    totalNew,
    totalRepeat,
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
