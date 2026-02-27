import { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { supabase } from '../lib/supabase.js';
import { consultantAuthMiddleware, ConsultantAuthRequest } from '../middleware/consultantAuth.js';
import { processCallRecording } from '../lib/callRecordingPipeline.js';

/**
 * Роуты для записей звонков консультантов
 */
export async function consultantCallRecordingsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', consultantAuthMiddleware);

  // ==================== CONSULTANT ROUTES ====================

  /**
   * POST /consultant/call-recordings/upload
   * Загрузка аудиозаписи звонка (multipart)
   */
  app.post('/consultant/call-recordings/upload', async (request: ConsultantAuthRequest, reply) => {
    try {
      const isAdmin = request.userRole === 'admin';
      const consultant = request.consultant;

      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ error: 'No file uploaded' });
      }

      // Читаем файл
      const buffer = await data.toBuffer();
      const fileSize = buffer.length;

      // Лимит 100 MB
      if (fileSize > 100 * 1024 * 1024) {
        return reply.status(400).send({ error: 'File too large. Maximum 100 MB.' });
      }

      // Читаем metadata из полей multipart
      const fields = data.fields;
      const leadId = getFieldValue(fields, 'lead_id') || null;
      const title = getFieldValue(fields, 'title') || null;
      const durationSeconds = parseInt(getFieldValue(fields, 'duration_seconds') || '0') || null;
      const recordingMode = getFieldValue(fields, 'recording_mode') || 'tab';

      // Определяем consultant_id: для админа — из поля формы, для консультанта — из профиля
      const consultantIdFromField = getFieldValue(fields, 'consultant_id');
      const targetConsultantId = isAdmin
        ? (consultantIdFromField || consultant?.id)
        : consultant?.id;

      if (!targetConsultantId) {
        return reply.status(400).send({ error: 'consultant_id is required' });
      }

      // Загружаем в Supabase Storage
      const fileId = randomUUID();
      const filePath = `${targetConsultantId}/${fileId}.webm`;

      const { error: uploadError } = await supabase.storage
        .from('call-recordings')
        .upload(filePath, buffer, {
          contentType: 'audio/webm',
          cacheControl: '31536000',
          upsert: false,
        });

      if (uploadError) {
        app.log.error({ error: uploadError }, 'Failed to upload to Storage');
        return reply.status(500).send({ error: 'Failed to upload file' });
      }

      const { data: publicUrlData } = supabase.storage
        .from('call-recordings')
        .getPublicUrl(filePath);

      // Создаём запись в БД
      const { data: recording, error: insertError } = await supabase
        .from('consultant_call_recordings')
        .insert({
          consultant_id: targetConsultantId,
          lead_id: leadId,
          file_url: publicUrlData.publicUrl,
          file_path: filePath,
          file_size_bytes: fileSize,
          duration_seconds: durationSeconds,
          title,
          recording_mode: recordingMode,
          transcription_status: 'pending',
          analysis_status: 'pending',
        })
        .select()
        .single();

      if (insertError) {
        app.log.error({ error: insertError }, 'Failed to create recording');
        // Очищаем загруженный файл
        await supabase.storage.from('call-recordings').remove([filePath]);
        return reply.status(500).send({ error: insertError.message });
      }

      app.log.info({
        recordingId: recording.id,
        consultantId: targetConsultantId,
        leadId,
        fileSize,
        durationSeconds,
      }, 'Call recording uploaded');

      // Fire-and-forget: запускаем пайплайн транскрипции + анализа
      processCallRecording(recording.id).catch(err => {
        app.log.error({ recordingId: recording.id, error: err.message }, 'Pipeline error');
      });

      return reply.send(recording);
    } catch (error: any) {
      app.log.error({ error }, 'Error uploading call recording');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /consultant/call-recordings
   * Список записей консультанта
   */
  app.get('/consultant/call-recordings', async (request: ConsultantAuthRequest, reply) => {
    try {
      const consultant = request.consultant;
      const isAdmin = request.userRole === 'admin';
      const query = request.query as any;
      const limit = parseInt(query.limit || '20');
      const offset = parseInt(query.offset || '0');
      const leadId = query.lead_id as string | undefined;
      const consultantIdParam = query.consultantId as string | undefined;

      // Определяем чьи записи показывать
      const targetConsultantId = isAdmin && consultantIdParam
        ? consultantIdParam
        : consultant?.id;

      if (!targetConsultantId && !isAdmin) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      let dbQuery = supabase
        .from('consultant_call_recordings')
        .select(`
          id, consultant_id, lead_id, file_url, file_size_bytes,
          duration_seconds, transcription_status, analysis_status,
          title, notes, recording_mode, file_deleted_at, created_at,
          dialog_analysis!left(contact_name, contact_phone)
        `, { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (targetConsultantId) {
        dbQuery = dbQuery.eq('consultant_id', targetConsultantId);
      }

      if (leadId) {
        dbQuery = dbQuery.eq('lead_id', leadId);
      }

      const { data, error, count } = await dbQuery;

      if (error) {
        app.log.error({ error }, 'Failed to fetch recordings');
        return reply.status(500).send({ error: error.message });
      }

      // Маппим join для удобства фронта
      const recordings = (data || []).map((rec: any) => ({
        ...rec,
        lead: rec.dialog_analysis || null,
        dialog_analysis: undefined,
      }));

      return reply.send({ recordings, total: count || 0 });
    } catch (error: any) {
      app.log.error({ error }, 'Error fetching recordings');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /consultant/call-recordings/:id
   * Детали одной записи
   */
  app.get('/consultant/call-recordings/:id', async (request: ConsultantAuthRequest, reply) => {
    try {
      const { id } = request.params as { id: string };
      const consultant = request.consultant;
      const isAdmin = request.userRole === 'admin';

      let dbQuery = supabase
        .from('consultant_call_recordings')
        .select(`
          *,
          dialog_analysis!left(contact_name, contact_phone)
        `)
        .eq('id', id);

      // Консультант видит только свои записи
      if (!isAdmin && consultant) {
        dbQuery = dbQuery.eq('consultant_id', consultant.id);
      }

      const { data: recording, error } = await dbQuery.single();

      if (error || !recording) {
        return reply.status(404).send({ error: 'Recording not found' });
      }

      return reply.send({
        ...recording,
        lead: recording.dialog_analysis || null,
        dialog_analysis: undefined,
      });
    } catch (error: any) {
      app.log.error({ error }, 'Error fetching recording');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * PATCH /consultant/call-recordings/:id
   * Обновление title/notes
   */
  app.patch('/consultant/call-recordings/:id', async (request: ConsultantAuthRequest, reply) => {
    try {
      const { id } = request.params as { id: string };
      const consultant = request.consultant;
      const isAdmin = request.userRole === 'admin';
      const body = request.body as { title?: string; notes?: string };

      // Проверяем принадлежность
      const { data: existing, error: checkError } = await supabase
        .from('consultant_call_recordings')
        .select('id, consultant_id')
        .eq('id', id)
        .single();

      if (checkError || !existing) {
        return reply.status(404).send({ error: 'Recording not found' });
      }

      if (!isAdmin && consultant && existing.consultant_id !== consultant.id) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      const updateData: Record<string, any> = {};
      if (body.title !== undefined) updateData.title = body.title;
      if (body.notes !== undefined) updateData.notes = body.notes;

      if (Object.keys(updateData).length === 0) {
        return reply.status(400).send({ error: 'No fields to update' });
      }

      const { data: updated, error: updateError } = await supabase
        .from('consultant_call_recordings')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (updateError) {
        return reply.status(500).send({ error: updateError.message });
      }

      return reply.send(updated);
    } catch (error: any) {
      app.log.error({ error }, 'Error updating recording');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * DELETE /consultant/call-recordings/:id
   * Удаление записи + файла из Storage
   */
  app.delete('/consultant/call-recordings/:id', async (request: ConsultantAuthRequest, reply) => {
    try {
      const { id } = request.params as { id: string };
      const consultant = request.consultant;
      const isAdmin = request.userRole === 'admin';

      // Получаем запись
      const { data: recording, error: fetchError } = await supabase
        .from('consultant_call_recordings')
        .select('id, consultant_id, file_path')
        .eq('id', id)
        .single();

      if (fetchError || !recording) {
        return reply.status(404).send({ error: 'Recording not found' });
      }

      if (!isAdmin && consultant && recording.consultant_id !== consultant.id) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      // Удаляем файл из Storage
      if (recording.file_path) {
        const { error: storageError } = await supabase.storage
          .from('call-recordings')
          .remove([recording.file_path]);

        if (storageError) {
          app.log.warn({ error: storageError, filePath: recording.file_path }, 'Failed to delete storage file');
        }
      }

      // Удаляем запись из БД
      const { error: deleteError } = await supabase
        .from('consultant_call_recordings')
        .delete()
        .eq('id', id);

      if (deleteError) {
        return reply.status(500).send({ error: deleteError.message });
      }

      return reply.send({ success: true });
    } catch (error: any) {
      app.log.error({ error }, 'Error deleting recording');
      return reply.status(500).send({ error: error.message });
    }
  });

  // ==================== ADMIN ROUTES ====================

  /**
   * GET /admin/call-recordings/pending-analysis
   * Записи с готовой транскрипцией, ожидающие анализа (для OpenClaw)
   */
  app.get('/admin/call-recordings/pending-analysis', async (request: ConsultantAuthRequest, reply) => {
    try {
      if (request.userRole !== 'admin') {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      const { data, error } = await supabase
        .from('consultant_call_recordings')
        .select(`
          id, consultant_id, lead_id, duration_seconds,
          transcription, transcription_status, analysis_status,
          title, recording_mode, created_at,
          consultants!inner(id, name),
          dialog_analysis!left(contact_name, contact_phone)
        `)
        .eq('transcription_status', 'completed')
        .eq('analysis_status', 'pending')
        .order('created_at', { ascending: true })
        .limit(10);

      if (error) {
        app.log.error({ error }, 'Failed to fetch pending analysis recordings');
        return reply.status(500).send({ error: error.message });
      }

      const recordings = (data || []).map((rec: any) => ({
        ...rec,
        consultant: rec.consultants || null,
        lead: rec.dialog_analysis || null,
        consultants: undefined,
        dialog_analysis: undefined,
      }));

      return reply.send({ recordings });
    } catch (error: any) {
      app.log.error({ error }, 'Error fetching pending analysis');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * PATCH /admin/call-recordings/:id/analysis
   * Сохранение результатов анализа (вызывается OpenClaw)
   */
  app.patch('/admin/call-recordings/:id/analysis', async (request: ConsultantAuthRequest, reply) => {
    try {
      if (request.userRole !== 'admin') {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      const { id } = request.params as { id: string };
      const body = request.body as {
        consultation_summary?: any;
        consultant_review?: any;
      };

      if (!body.consultation_summary && !body.consultant_review) {
        return reply.status(400).send({ error: 'At least consultation_summary or consultant_review is required' });
      }

      // Проверяем что запись существует
      const { data: existing, error: checkError } = await supabase
        .from('consultant_call_recordings')
        .select('id, transcription_status')
        .eq('id', id)
        .single();

      if (checkError || !existing) {
        return reply.status(404).send({ error: 'Recording not found' });
      }

      if (existing.transcription_status !== 'completed') {
        return reply.status(400).send({ error: 'Transcription not completed yet' });
      }

      const analysis = {
        ...(body.consultation_summary && { consultation_summary: body.consultation_summary }),
        ...(body.consultant_review && { consultant_review: body.consultant_review }),
      };

      const { data: updated, error: updateError } = await supabase
        .from('consultant_call_recordings')
        .update({
          analysis,
          analysis_status: 'completed',
        })
        .eq('id', id)
        .select('id, analysis_status')
        .single();

      if (updateError) {
        app.log.error({ error: updateError }, 'Failed to save analysis');
        return reply.status(500).send({ error: updateError.message });
      }

      app.log.info({ recordingId: id }, 'Analysis saved by OpenClaw');
      return reply.send({ success: true, recording: updated });
    } catch (error: any) {
      app.log.error({ error }, 'Error saving analysis');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /admin/call-recordings/:id/retranscribe
   * Перезапуск транскрипции (Whisper + диалог GPT)
   */
  app.post('/admin/call-recordings/:id/retranscribe', async (request: ConsultantAuthRequest, reply) => {
    try {
      if (request.userRole !== 'admin') {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      const { id } = request.params as { id: string };

      const { data: existing, error: checkError } = await supabase
        .from('consultant_call_recordings')
        .select('id, file_path')
        .eq('id', id)
        .single();

      if (checkError || !existing) {
        return reply.status(404).send({ error: 'Recording not found' });
      }

      // Сбрасываем статусы
      await supabase
        .from('consultant_call_recordings')
        .update({ transcription_status: 'pending', analysis_status: 'pending', transcription: null, analysis: null })
        .eq('id', id);

      // Fire-and-forget
      processCallRecording(id).catch(err => {
        app.log.error({ recordingId: id, error: err.message }, 'Retranscribe pipeline error');
      });

      app.log.info({ recordingId: id }, 'Retranscription triggered');
      return reply.send({ success: true, recordingId: id, message: 'Retranscription started' });
    } catch (error: any) {
      app.log.error({ error }, 'Error triggering retranscription');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /admin/call-recordings
   * Список записей всех консультантов (только админ)
   */
  app.get('/admin/call-recordings', async (request: ConsultantAuthRequest, reply) => {
    try {
      if (request.userRole !== 'admin') {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      const query = request.query as any;
      const limit = parseInt(query.limit || '20');
      const offset = parseInt(query.offset || '0');
      const consultantId = query.consultant_id as string | undefined;

      let dbQuery = supabase
        .from('consultant_call_recordings')
        .select(`
          id, consultant_id, lead_id, file_url, file_size_bytes,
          duration_seconds, transcription_status, analysis_status,
          title, notes, recording_mode, file_deleted_at, created_at,
          consultants!inner(id, name),
          dialog_analysis!left(contact_name, contact_phone)
        `, { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (consultantId) {
        dbQuery = dbQuery.eq('consultant_id', consultantId);
      }

      const { data, error, count } = await dbQuery;

      if (error) {
        app.log.error({ error }, 'Failed to fetch admin recordings');
        return reply.status(500).send({ error: error.message });
      }

      const recordings = (data || []).map((rec: any) => ({
        ...rec,
        consultant: rec.consultants || null,
        lead: rec.dialog_analysis || null,
        consultants: undefined,
        dialog_analysis: undefined,
      }));

      return reply.send({ recordings, total: count || 0 });
    } catch (error: any) {
      app.log.error({ error }, 'Error fetching admin recordings');
      return reply.status(500).send({ error: error.message });
    }
  });
}

/**
 * Helper: достаём значение поля из multipart fields
 */
function getFieldValue(fields: Record<string, any>, name: string): string | undefined {
  const field = fields[name];
  if (!field) return undefined;
  if (typeof field === 'object' && 'value' in field) return field.value;
  if (typeof field === 'string') return field;
  return undefined;
}
