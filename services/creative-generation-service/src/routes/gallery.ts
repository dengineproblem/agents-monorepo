import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getSupabaseClient, logSupabaseError } from '../db/supabase';

// Типы для запросов
interface GalleryQuery {
  style?: string;
  visual_style?: string;
  creative_type?: 'image' | 'carousel';
  limit?: number;
  offset?: number;
}

interface HistoryQuery {
  user_id: string;
  creative_type?: 'image' | 'carousel';
  include_drafts?: boolean;
  limit?: number;
  offset?: number;
}

interface TextHistoryQuery {
  user_id: string;
  text_type?: string;
  limit?: number;
  offset?: number;
}

interface TextGalleryQuery {
  text_type?: string;
  limit?: number;
  offset?: number;
}

interface SaveDraftBody {
  user_id: string;
  account_id?: string;
  creative_type: 'image' | 'carousel';
  // Для изображений
  offer?: string;
  bullets?: string;
  profits?: string;
  cta?: string;
  image_url?: string;
  style_id?: string;
  // Для каруселей
  carousel_data?: any[];
  visual_style?: string;
  // Общие
  direction_id?: string;
}

interface UpdateDraftBody extends SaveDraftBody {
  draft_id: string;
}

// Названия стилей для UI
const IMAGE_STYLE_LABELS: Record<string, string> = {
  modern_performance: 'Современная графика',
  live_ugc: 'Живой UGC-контент',
  visual_hook: 'Визуальный зацеп',
  premium_minimal: 'Премиум минимализм',
  product_hero: 'Товар в главной роли',
  freestyle: 'Свободный стиль'
};

const CAROUSEL_STYLE_LABELS: Record<string, string> = {
  clean_minimal: 'Чистый минимализм',
  story_illustration: 'Иллюстрированная история',
  photo_ugc: 'Фото UGC',
  asset_focus: 'Фокус на продукте',
  freestyle: 'Свободный стиль'
};

const TEXT_TYPE_LABELS: Record<string, string> = {
  storytelling: 'Storytelling',
  direct_offer: 'Прямой оффер',
  expert_video: 'Видео экспертное',
  telegram_post: 'Пост в Telegram',
  threads_post: 'Пост в Threads',
  reference: 'Референс'
};

export async function galleryRoutes(fastify: FastifyInstance) {
  const supabase = getSupabaseClient();

  // ==================== ГАЛЕРЕЯ КРЕАТИВОВ (ВСЕ ПОЛЬЗОВАТЕЛИ) ====================

  /**
   * GET /gallery/creatives
   * Получить галерею креативов всех пользователей, сгруппированных по стилям
   */
  fastify.get('/gallery/creatives', async (request: FastifyRequest<{ Querystring: GalleryQuery }>, reply: FastifyReply) => {
    try {
      const { style, visual_style, creative_type, limit = 50, offset = 0 } = request.query;

      let query = supabase
        .from('generated_creatives')
        .select('id, user_id, image_url, image_url_4k, style_id, visual_style, creative_type, carousel_data, offer, bullets, profits, created_at')
        .eq('is_draft', false)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      // Фильтр по типу креатива
      if (creative_type) {
        query = query.eq('creative_type', creative_type);
      }

      // Фильтр по стилю изображения
      if (style) {
        query = query.eq('style_id', style);
      }

      // Фильтр по стилю карусели
      if (visual_style) {
        query = query.eq('visual_style', visual_style);
      }

      const { data, error } = await query;

      if (error) {
        logSupabaseError('gallery/creatives', error);
        return reply.status(500).send({ success: false, error: 'Failed to fetch gallery' });
      }

      // Группируем по стилям
      const groupedByStyle: Record<string, any[]> = {};

      for (const creative of data || []) {
        const styleKey = creative.creative_type === 'carousel'
          ? creative.visual_style || 'unknown'
          : creative.style_id || 'unknown';

        if (!groupedByStyle[styleKey]) {
          groupedByStyle[styleKey] = [];
        }
        groupedByStyle[styleKey].push(creative);
      }

      // Формируем ответ с метаданными стилей
      const styles = Object.entries(groupedByStyle).map(([styleId, creatives]) => ({
        style_id: styleId,
        style_label: IMAGE_STYLE_LABELS[styleId] || CAROUSEL_STYLE_LABELS[styleId] || styleId,
        count: creatives.length,
        creatives
      }));

      return reply.send({
        success: true,
        total: data?.length || 0,
        styles,
        style_labels: {
          image: IMAGE_STYLE_LABELS,
          carousel: CAROUSEL_STYLE_LABELS
        }
      });
    } catch (error: any) {
      fastify.log.error('Error fetching gallery:', error);
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  // ==================== ИСТОРИЯ КРЕАТИВОВ (СВОИ) ====================

  /**
   * GET /history/creatives
   * Получить историю своих креативов
   */
  fastify.get('/history/creatives', async (request: FastifyRequest<{ Querystring: HistoryQuery }>, reply: FastifyReply) => {
    try {
      const { user_id, creative_type, include_drafts = true, limit = 50, offset = 0 } = request.query;

      if (!user_id) {
        return reply.status(400).send({ success: false, error: 'user_id is required' });
      }

      let query = supabase
        .from('generated_creatives')
        .select('*')
        .eq('user_id', user_id)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      // Фильтр по типу
      if (creative_type) {
        query = query.eq('creative_type', creative_type);
      }

      // Фильтр черновиков
      if (!include_drafts) {
        query = query.eq('is_draft', false);
      }

      const { data, error } = await query;

      if (error) {
        logSupabaseError('history/creatives', error);
        return reply.status(500).send({ success: false, error: 'Failed to fetch history' });
      }

      // Разделяем на черновики и опубликованные
      const drafts = (data || []).filter(c => c.is_draft);
      const published = (data || []).filter(c => !c.is_draft);

      return reply.send({
        success: true,
        total: data?.length || 0,
        drafts_count: drafts.length,
        published_count: published.length,
        creatives: data,
        drafts,
        published
      });
    } catch (error: any) {
      fastify.log.error('Error fetching history:', error);
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  // ==================== ЧЕРНОВИКИ ====================

  /**
   * POST /drafts/save
   * Сохранить черновик
   */
  fastify.post('/drafts/save', async (request: FastifyRequest<{ Body: SaveDraftBody }>, reply: FastifyReply) => {
    try {
      const {
        user_id,
        account_id,
        creative_type,
        offer,
        bullets,
        profits,
        cta,
        image_url,
        style_id,
        carousel_data,
        visual_style,
        direction_id
      } = request.body;

      if (!user_id || !creative_type) {
        return reply.status(400).send({ success: false, error: 'user_id and creative_type are required' });
      }

      const draftData: any = {
        user_id,
        account_id: account_id || null,
        creative_type,
        is_draft: true,
        status: 'generated',
        direction_id: direction_id || null
      };

      if (creative_type === 'image') {
        draftData.offer = offer || '';
        draftData.bullets = bullets || '';
        draftData.profits = profits || '';
        draftData.cta = cta || '';
        draftData.image_url = image_url || '';
        draftData.style_id = style_id || null;
      } else if (creative_type === 'carousel') {
        draftData.carousel_data = carousel_data || [];
        draftData.visual_style = visual_style || null;
        draftData.offer = '';
        draftData.bullets = '';
        draftData.profits = '';
        draftData.cta = '';
        draftData.image_url = '';
      }

      const { data, error } = await supabase
        .from('generated_creatives')
        .insert(draftData)
        .select()
        .single();

      if (error) {
        logSupabaseError('drafts/save', error);
        return reply.status(500).send({ success: false, error: 'Failed to save draft' });
      }

      return reply.send({
        success: true,
        draft_id: data.id,
        draft: data
      });
    } catch (error: any) {
      fastify.log.error('Error saving draft:', error);
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  /**
   * PUT /drafts/update
   * Обновить черновик
   */
  fastify.put('/drafts/update', async (request: FastifyRequest<{ Body: UpdateDraftBody }>, reply: FastifyReply) => {
    try {
      const {
        draft_id,
        user_id,
        offer,
        bullets,
        profits,
        cta,
        image_url,
        style_id,
        carousel_data,
        visual_style,
        direction_id
      } = request.body;

      if (!draft_id || !user_id) {
        return reply.status(400).send({ success: false, error: 'draft_id and user_id are required' });
      }

      const updateData: any = {
        updated_at: new Date().toISOString()
      };

      if (offer !== undefined) updateData.offer = offer;
      if (bullets !== undefined) updateData.bullets = bullets;
      if (profits !== undefined) updateData.profits = profits;
      if (cta !== undefined) updateData.cta = cta;
      if (image_url !== undefined) updateData.image_url = image_url;
      if (style_id !== undefined) updateData.style_id = style_id;
      if (carousel_data !== undefined) updateData.carousel_data = carousel_data;
      if (visual_style !== undefined) updateData.visual_style = visual_style;
      if (direction_id !== undefined) updateData.direction_id = direction_id;

      const { data, error } = await supabase
        .from('generated_creatives')
        .update(updateData)
        .eq('id', draft_id)
        .eq('user_id', user_id)
        .eq('is_draft', true)
        .select()
        .single();

      if (error) {
        logSupabaseError('drafts/update', error);
        return reply.status(500).send({ success: false, error: 'Failed to update draft' });
      }

      return reply.send({
        success: true,
        draft: data
      });
    } catch (error: any) {
      fastify.log.error('Error updating draft:', error);
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  /**
   * DELETE /drafts/:id
   * Удалить черновик
   */
  fastify.delete('/drafts/:id', async (request: FastifyRequest<{ Params: { id: string }, Querystring: { user_id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const { user_id } = request.query;

      if (!user_id) {
        return reply.status(400).send({ success: false, error: 'user_id is required' });
      }

      const { error } = await supabase
        .from('generated_creatives')
        .delete()
        .eq('id', id)
        .eq('user_id', user_id)
        .eq('is_draft', true);

      if (error) {
        logSupabaseError('drafts/delete', error);
        return reply.status(500).send({ success: false, error: 'Failed to delete draft' });
      }

      return reply.send({ success: true });
    } catch (error: any) {
      fastify.log.error('Error deleting draft:', error);
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  // ==================== ИСТОРИЯ ТЕКСТОВ ====================

  /**
   * GET /history/texts
   * Получить историю своих текстовых генераций
   */
  fastify.get('/history/texts', async (request: FastifyRequest<{ Querystring: TextHistoryQuery }>, reply: FastifyReply) => {
    try {
      const { user_id, text_type, limit = 50, offset = 0 } = request.query;

      if (!user_id) {
        return reply.status(400).send({ success: false, error: 'user_id is required' });
      }

      let query = supabase
        .from('text_generation_history')
        .select('*')
        .eq('user_id', user_id)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (text_type) {
        query = query.eq('text_type', text_type);
      }

      const { data, error } = await query;

      if (error) {
        logSupabaseError('history/texts', error);
        return reply.status(500).send({ success: false, error: 'Failed to fetch text history' });
      }

      return reply.send({
        success: true,
        total: data?.length || 0,
        texts: data,
        type_labels: TEXT_TYPE_LABELS
      });
    } catch (error: any) {
      fastify.log.error('Error fetching text history:', error);
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  // ==================== ГАЛЕРЕЯ ТЕКСТОВ ====================

  /**
   * GET /gallery/texts
   * Получить галерею текстов всех пользователей, сгруппированных по типам
   */
  fastify.get('/gallery/texts', async (request: FastifyRequest<{ Querystring: TextGalleryQuery }>, reply: FastifyReply) => {
    try {
      const { text_type, limit = 100, offset = 0 } = request.query;

      let query = supabase
        .from('text_generation_history')
        .select('id, user_id, text_type, user_prompt, generated_text, created_at')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (text_type) {
        query = query.eq('text_type', text_type);
      }

      const { data, error } = await query;

      if (error) {
        logSupabaseError('gallery/texts', error);
        return reply.status(500).send({ success: false, error: 'Failed to fetch text gallery' });
      }

      // Группируем по типам
      const groupedByType: Record<string, any[]> = {};

      for (const text of data || []) {
        const typeKey = text.text_type || 'unknown';
        if (!groupedByType[typeKey]) {
          groupedByType[typeKey] = [];
        }
        groupedByType[typeKey].push(text);
      }

      // Формируем ответ
      const types = Object.entries(groupedByType).map(([typeId, texts]) => ({
        type_id: typeId,
        type_label: TEXT_TYPE_LABELS[typeId] || typeId,
        count: texts.length,
        texts
      }));

      return reply.send({
        success: true,
        total: data?.length || 0,
        types,
        type_labels: TEXT_TYPE_LABELS
      });
    } catch (error: any) {
      fastify.log.error('Error fetching text gallery:', error);
      return reply.status(500).send({ success: false, error: error.message });
    }
  });
}

export default galleryRoutes;
