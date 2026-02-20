import { supabase } from './supabase.js';
import { transcribeAudio } from './whisperTranscription.js';
import { createLogger } from './logger.js';

const log = createLogger({ module: 'callRecordingPipeline' });

const WHISPER_MAX_SIZE = 25 * 1024 * 1024; // 25 MB

// ==================== ТИПЫ ====================

export interface ConsultationSummary {
  brief: string;
  client_situation: string;
  discussed_topics: string[];
  client_needs: string[];
  objections: string[];
  agreements: string[];
  next_steps: string[];
  client_readiness: 'hot' | 'warm' | 'cold';
  budget_discussed: boolean;
  budget_details?: string | null;
  decision_maker?: string | null;
}

export interface ConsultantReview {
  overall_score: number;
  scores: {
    rapport: number;
    discovery: number;
    presentation: number;
    objection_handling: number | null;
    closing: number;
  };
  strengths: string[];
  improvements: string[];
  critical_moments: string[];
  missed_opportunities: string[];
  recommendation: string;
}

export interface CallAnalysis {
  consultation_summary: ConsultationSummary;
  consultant_review: ConsultantReview;
}

/**
 * Пайплайн: транскрипция → webhook → OpenClaw анализирует отдельно
 */
export async function processCallRecording(recordingId: string): Promise<void> {
  try {
    log.info({ recordingId }, 'Starting call recording pipeline');

    const { data: recording, error: fetchError } = await supabase
      .from('consultant_call_recordings')
      .select('id, file_path, file_url, file_size_bytes')
      .eq('id', recordingId)
      .single();

    if (fetchError || !recording) {
      log.error({ recordingId, error: fetchError }, 'Recording not found');
      return;
    }

    // === ТРАНСКРИПЦИЯ ===
    await updateStatus(recordingId, 'transcription_status', 'processing');

    let transcription: string;
    try {
      transcription = await transcribeRecording(recording);
    } catch (err: any) {
      log.error({ recordingId, error: err.message }, 'Transcription failed');
      await updateStatus(recordingId, 'transcription_status', 'failed');
      return;
    }

    await supabase
      .from('consultant_call_recordings')
      .update({ transcription, transcription_status: 'completed' })
      .eq('id', recordingId);

    log.info({ recordingId, length: transcription.length }, 'Transcription completed');
    // Анализ делает OpenClaw по крону через GET /admin/call-recordings/pending-analysis
  } catch (err: any) {
    log.error({ recordingId, error: err.message }, 'Pipeline unexpected error');
  }
}

// ==================== ТРАНСКРИПЦИЯ ====================

async function transcribeRecording(recording: {
  file_path: string;
  file_url: string;
  file_size_bytes: number;
}): Promise<string> {
  const { data: fileData, error: downloadError } = await supabase.storage
    .from('call-recordings')
    .download(recording.file_path);

  if (downloadError || !fileData) {
    throw new Error(`Failed to download: ${downloadError?.message}`);
  }

  const buffer = Buffer.from(await fileData.arrayBuffer());

  if (buffer.length <= WHISPER_MAX_SIZE) {
    return transcribeAudio(buffer, 'recording.webm', { language: undefined });
  }

  log.warn({ size: buffer.length, maxSize: WHISPER_MAX_SIZE }, 'File exceeds Whisper limit');

  try {
    return await transcribeAudio(buffer, 'recording.webm', { language: undefined });
  } catch {
    log.info('Attempting chunk-based transcription');
    return await transcribeInChunks(buffer);
  }
}

async function transcribeInChunks(buffer: Buffer): Promise<string> {
  const chunkSize = 20 * 1024 * 1024;
  const chunks: Buffer[] = [];

  for (let offset = 0; offset < buffer.length; offset += chunkSize) {
    chunks.push(buffer.subarray(offset, Math.min(offset + chunkSize, buffer.length)));
  }

  log.info({ totalChunks: chunks.length }, 'Transcribing in chunks');

  const results: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    try {
      const text = await transcribeAudio(chunks[i], `recording_chunk_${i}.webm`, { language: undefined });
      results.push(text);
    } catch (err: any) {
      log.error({ chunk: i, error: err.message }, 'Chunk transcription failed');
      results.push(`[Часть ${i + 1}: ошибка транскрипции]`);
    }
  }

  return results.join('\n\n');
}

// ==================== UTILS ====================

async function updateStatus(
  recordingId: string,
  field: 'transcription_status' | 'analysis_status',
  status: string
): Promise<void> {
  await supabase
    .from('consultant_call_recordings')
    .update({ [field]: status })
    .eq('id', recordingId);
}
