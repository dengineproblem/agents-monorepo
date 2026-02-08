/**
 * System Agent Handlers
 * Системные операции: ошибки пользователя, база знаний
 */

import { supabase } from '../../../lib/supabaseClient.js';
import { getChapterList, getSection } from './knowledgeBase.js';
import { logger } from '../../../lib/logger.js';

export const systemHandlers = {
  async getKnowledgeBase({ chapter_id, section_id }) {
    // Без параметров — список всех глав
    if (!chapter_id) {
      const chapters = getChapterList();
      logger.debug({ mode: 'list_chapters', count: chapters.length }, 'getKnowledgeBase');
      return {
        success: true,
        chapters,
        hint: 'Укажи chapter_id для получения оглавления главы, или chapter_id + section_id для содержимого раздела.',
      };
    }

    // С chapter_id но без section_id — оглавление главы
    if (!section_id) {
      const chapters = getChapterList();
      const chapter = chapters.find(c => c.id === chapter_id);
      if (!chapter) {
        logger.warn({ chapter_id }, 'getKnowledgeBase: chapter not found');
        return { success: false, error: `Глава "${chapter_id}" не найдена` };
      }
      logger.debug({ chapter_id, sectionCount: chapter.sections.length }, 'getKnowledgeBase: chapter TOC');
      return {
        success: true,
        chapter: {
          id: chapter.id,
          title: chapter.title,
          description: chapter.description,
          sections: chapter.sections,
        },
        hint: 'Укажи section_id для получения содержимого раздела.',
      };
    }

    // С обоими — содержимое раздела
    const content = getSection(chapter_id, section_id);
    if (!content) {
      logger.warn({ chapter_id, section_id }, 'getKnowledgeBase: section not found');
      return { success: false, error: `Раздел "${section_id}" в главе "${chapter_id}" не найден` };
    }
    logger.debug({ chapter_id, section_id, contentLength: content.length }, 'getKnowledgeBase: section content');
    return { success: true, content };
  },

  async getUserErrors({ severity, error_type, resolved, limit }, { userAccountId }) {
    let query = supabase
      .from('error_logs')
      .select('id, error_type, error_code, raw_error, action, endpoint, llm_explanation, llm_solution, severity, is_resolved, created_at')
      .eq('user_account_id', userAccountId)
      .order('created_at', { ascending: false })
      .limit(limit || 10);

    if (severity) query = query.eq('severity', severity);
    if (error_type) query = query.eq('error_type', error_type);
    if (resolved !== undefined) query = query.eq('is_resolved', resolved);

    const { data, error } = await query;

    if (error) {
      return { success: false, error: `Ошибка при получении логов: ${error.message}` };
    }

    return {
      success: true,
      errors: (data || []).map(e => ({
        id: e.id,
        type: e.error_type,
        severity: e.severity,
        action: e.action,
        error: e.raw_error,
        explanation: e.llm_explanation,
        solution: e.llm_solution,
        resolved: e.is_resolved,
        date: e.created_at
      })),
      total: data?.length || 0,
      hint: data?.length === 0 ? 'У вас нет ошибок за последнее время' : null
    };
  },
};
