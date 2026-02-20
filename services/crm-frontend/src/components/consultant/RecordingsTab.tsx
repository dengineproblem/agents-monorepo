import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { consultantApi, CallRecording, Lead } from '@/services/consultantApi';
import { CallRecorder } from './CallRecorder';
import {
  Play,
  Trash2,
  FileText,
  Brain,
  Clock,
  User,
  ChevronDown,
  ChevronUp,
  Loader2,
  Save,
} from 'lucide-react';

export function RecordingsTab() {
  const { consultantId } = useParams<{ consultantId: string }>();
  const { toast } = useToast();
  const [recordings, setRecordings] = useState<CallRecording[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [selectedRecording, setSelectedRecording] = useState<CallRecording | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [editNotes, setEditNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  const loadRecordings = useCallback(async () => {
    try {
      const data = await consultantApi.getCallRecordings({
        consultantId,
        limit: 50,
      });
      setRecordings(data.recordings);
      setTotal(data.total);
    } catch (error: any) {
      console.error('Failed to load recordings:', error);
    } finally {
      setLoading(false);
    }
  }, [consultantId]);

  const loadLeads = useCallback(async () => {
    try {
      const data = await consultantApi.getLeads({ consultantId, limit: 100 });
      setLeads(data.leads);
    } catch (error: any) {
      console.error('Failed to load leads:', error);
    }
  }, [consultantId]);

  useEffect(() => {
    loadRecordings();
    loadLeads();
  }, [loadRecordings, loadLeads]);

  // Polling для обновления статусов processing записей
  useEffect(() => {
    const hasProcessing = recordings.some(
      r => r.transcription_status === 'processing' || r.analysis_status === 'processing'
         || r.transcription_status === 'pending' || r.analysis_status === 'pending'
    );

    if (!hasProcessing) return;

    const interval = setInterval(loadRecordings, 15000);
    return () => clearInterval(interval);
  }, [recordings, loadRecordings]);

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить запись? Это действие нельзя отменить.')) return;

    try {
      await consultantApi.deleteCallRecording(id);
      setRecordings(prev => prev.filter(r => r.id !== id));
      toast({ title: 'Запись удалена' });
      if (selectedRecording?.id === id) {
        setDetailsOpen(false);
        setSelectedRecording(null);
      }
    } catch (error: any) {
      toast({ title: 'Ошибка', description: error.message, variant: 'destructive' });
    }
  };

  const handleOpenDetails = async (recording: CallRecording) => {
    try {
      const full = await consultantApi.getCallRecording(recording.id);
      setSelectedRecording(full);
      setEditNotes(full.notes || '');
      setDetailsOpen(true);
    } catch (error: any) {
      toast({ title: 'Ошибка', description: error.message, variant: 'destructive' });
    }
  };

  const handleSaveNotes = async () => {
    if (!selectedRecording) return;
    setSavingNotes(true);
    try {
      const updated = await consultantApi.updateCallRecording(selectedRecording.id, {
        notes: editNotes,
      });
      setSelectedRecording(updated);
      setRecordings(prev => prev.map(r => r.id === updated.id ? { ...r, notes: updated.notes } : r));
      toast({ title: 'Заметки сохранены' });
    } catch (error: any) {
      toast({ title: 'Ошибка', description: error.message, variant: 'destructive' });
    } finally {
      setSavingNotes(false);
    }
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '—';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="default" className="bg-green-100 text-green-800">Готово</Badge>;
      case 'processing':
        return <Badge variant="secondary"><Loader2 className="h-3 w-3 mr-1 animate-spin" />В процессе</Badge>;
      case 'pending':
        return <Badge variant="outline">Ожидает</Badge>;
      case 'failed':
        return <Badge variant="destructive">Ошибка</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Компонент записи */}
      <CallRecorder
        leads={leads}
        consultantId={consultantId}
        onRecordingComplete={loadRecordings}
      />

      {/* Список записей */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Записи звонков</span>
            {total > 0 && <span className="text-sm font-normal text-muted-foreground">{total} записей</span>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : recordings.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>Нет записей</p>
              <p className="text-sm">Нажмите «Записать звонок» для начала</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recordings.map(recording => (
                <div
                  key={recording.id}
                  className="flex items-center justify-between p-4 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors"
                  onClick={() => handleOpenDetails(recording)}
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="flex-shrink-0">
                      <Play className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium truncate">
                        {recording.title || formatDate(recording.created_at)}
                      </p>
                      <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1">
                        {recording.lead && (
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {recording.lead.contact_name || recording.lead.contact_phone}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDuration(recording.duration_seconds)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="flex flex-col items-end gap-1">
                      <div className="flex items-center gap-1">
                        <FileText className="h-3 w-3 text-muted-foreground" />
                        {statusBadge(recording.transcription_status)}
                      </div>
                      <div className="flex items-center gap-1">
                        <Brain className="h-3 w-3 text-muted-foreground" />
                        {statusBadge(recording.analysis_status)}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => { e.stopPropagation(); handleDelete(recording.id); }}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground hover:text-red-500" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Диалог деталей записи */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {selectedRecording && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {selectedRecording.title || formatDate(selectedRecording.created_at)}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-6">
                {/* Метаданные */}
                <div className="flex flex-wrap gap-3 text-sm">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    {formatDuration(selectedRecording.duration_seconds)}
                  </span>
                  {selectedRecording.lead && (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <User className="h-4 w-4" />
                      {selectedRecording.lead.contact_name || selectedRecording.lead.contact_phone}
                    </span>
                  )}
                  <Badge variant="outline">
                    {selectedRecording.recording_mode === 'tab' ? 'Вкладка + Микрофон' : 'Только микрофон'}
                  </Badge>
                </div>

                {/* Аудио-плеер */}
                {selectedRecording.file_url && !selectedRecording.file_deleted_at && (
                  <div>
                    <audio
                      controls
                      className="w-full"
                      src={selectedRecording.file_url}
                    />
                  </div>
                )}
                {selectedRecording.file_deleted_at && (
                  <p className="text-sm text-muted-foreground italic">
                    Аудиофайл удалён (хранится 90 дней)
                  </p>
                )}

                {/* Транскрипция */}
                <TranscriptionSection recording={selectedRecording} />

                {/* AI-анализ */}
                <AnalysisSection recording={selectedRecording} />

                {/* Заметки */}
                <div className="space-y-2">
                  <h4 className="font-medium">Заметки</h4>
                  <Textarea
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    placeholder="Добавьте заметки к записи..."
                    rows={3}
                  />
                  <Button
                    size="sm"
                    onClick={handleSaveNotes}
                    disabled={savingNotes || editNotes === (selectedRecording.notes || '')}
                  >
                    {savingNotes ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                    Сохранить
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TranscriptionSection({ recording }: { recording: CallRecording }) {
  const [expanded, setExpanded] = useState(false);

  if (recording.transcription_status === 'pending' || recording.transcription_status === 'processing') {
    return (
      <div className="space-y-2">
        <h4 className="font-medium flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Транскрипция
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </h4>
        <p className="text-sm text-muted-foreground">Транскрипция в процессе...</p>
      </div>
    );
  }

  if (recording.transcription_status === 'failed') {
    return (
      <div className="space-y-2">
        <h4 className="font-medium flex items-center gap-2 text-red-600">
          <FileText className="h-4 w-4" />
          Транскрипция — Ошибка
        </h4>
      </div>
    );
  }

  if (!recording.transcription) return null;

  const text = recording.transcription;
  const isLong = text.length > 500;
  const displayText = isLong && !expanded ? text.substring(0, 500) + '...' : text;

  return (
    <div className="space-y-2">
      <h4 className="font-medium flex items-center gap-2">
        <FileText className="h-4 w-4" />
        Транскрипция
      </h4>
      <div className="rounded-md bg-muted p-3 text-sm whitespace-pre-wrap max-h-[300px] overflow-y-auto">
        {displayText}
      </div>
      {isLong && (
        <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>
          {expanded ? <ChevronUp className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
          {expanded ? 'Свернуть' : 'Показать полностью'}
        </Button>
      )}
    </div>
  );
}

function AnalysisSection({ recording }: { recording: CallRecording }) {
  if (recording.analysis_status === 'pending' || recording.analysis_status === 'processing') {
    return (
      <div className="space-y-2">
        <h4 className="font-medium flex items-center gap-2">
          <Brain className="h-4 w-4" />
          Анализ
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </h4>
        <p className="text-sm text-muted-foreground">Анализ в процессе...</p>
      </div>
    );
  }

  if (recording.analysis_status === 'failed') {
    return (
      <div className="space-y-2">
        <h4 className="font-medium flex items-center gap-2 text-red-600">
          <Brain className="h-4 w-4" />
          Анализ — Ошибка
        </h4>
      </div>
    );
  }

  const analysis = recording.analysis;
  if (!analysis) return null;

  const summary = analysis.consultation_summary;
  const review = analysis.consultant_review;

  return (
    <div className="space-y-6">
      {/* ===== БЛОК 1: Summary консультации ===== */}
      {summary && (
        <div className="space-y-4">
          <h4 className="font-medium flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Summary консультации
          </h4>

          {/* Краткое описание */}
          <div className="rounded-md bg-blue-50 p-3">
            <p className="text-sm text-blue-800">{summary.brief}</p>
          </div>

          {/* Готовность клиента */}
          <div className="flex flex-wrap gap-2">
            {readinessBadge(summary.client_readiness)}
            {summary.budget_discussed && (
              <Badge className="bg-purple-100 text-purple-800">Бюджет обсуждался</Badge>
            )}
            {summary.decision_maker && (
              <Badge variant="outline">ЛПР: {summary.decision_maker}</Badge>
            )}
          </div>

          {/* Ситуация клиента */}
          {summary.client_situation && (
            <div>
              <p className="text-sm font-medium mb-1">Ситуация клиента</p>
              <p className="text-sm text-muted-foreground">{summary.client_situation}</p>
            </div>
          )}

          {/* Потребности */}
          <BulletList title="Потребности клиента" items={summary.client_needs} />

          {/* Возражения */}
          <BulletList title="Возражения" items={summary.objections} className="text-red-700" />

          {/* Договорённости */}
          <BulletList title="Договорённости" items={summary.agreements} />

          {/* Следующие шаги */}
          {summary.next_steps?.length > 0 && (
            <div className="rounded-md bg-green-50 p-3">
              <p className="text-sm font-medium text-green-900 mb-1">Следующие шаги</p>
              <ul className="text-sm text-green-800 space-y-1">
                {summary.next_steps.map((step, i) => (
                  <li key={i} className="flex gap-2">
                    <span>-</span>
                    {step}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Бюджет */}
          {summary.budget_details && (
            <div>
              <p className="text-sm font-medium mb-1">Бюджет</p>
              <p className="text-sm text-muted-foreground">{summary.budget_details}</p>
            </div>
          )}
        </div>
      )}

      {/* Разделитель */}
      {summary && review && <hr className="border-muted" />}

      {/* ===== БЛОК 2: Анализ консультанта ===== */}
      {review && (
        <div className="space-y-4">
          <h4 className="font-medium flex items-center gap-2">
            <Brain className="h-4 w-4" />
            Анализ консультанта
          </h4>

          {/* Общая оценка */}
          <div className="flex items-center gap-4">
            <div className="text-center">
              <p className={`text-3xl font-bold ${scoreColor(review.overall_score)}`}>
                {review.overall_score}/10
              </p>
              <p className="text-xs text-muted-foreground">Общая оценка</p>
            </div>
          </div>

          {/* Детальные оценки */}
          <div className="grid grid-cols-5 gap-2">
            <ScoreCard label="Раппорт" value={review.scores.rapport} />
            <ScoreCard label="Выявление" value={review.scores.discovery} />
            <ScoreCard label="Презентация" value={review.scores.presentation} />
            <ScoreCard
              label="Возражения"
              value={review.scores.objection_handling}
            />
            <ScoreCard label="Закрытие" value={review.scores.closing} />
          </div>

          {/* Сильные стороны */}
          <BulletList title="Сильные стороны" items={review.strengths} className="text-green-700" />

          {/* Что улучшить */}
          <BulletList title="Что улучшить" items={review.improvements} className="text-orange-700" />

          {/* Ключевые моменты */}
          <BulletList title="Ключевые моменты" items={review.critical_moments} />

          {/* Упущенные возможности */}
          <BulletList title="Упущенные возможности" items={review.missed_opportunities} className="text-red-700" />

          {/* Рекомендация */}
          {review.recommendation && (
            <div className="rounded-md bg-orange-50 p-3">
              <p className="text-sm font-medium text-orange-900 mb-1">Рекомендация</p>
              <p className="text-sm text-orange-800">{review.recommendation}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ==================== Вспомогательные компоненты ====================

function BulletList({ title, items, className }: { title: string; items?: string[]; className?: string }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className="text-sm font-medium mb-1">{title}</p>
      <ul className={`text-sm space-y-1 ${className || ''}`}>
        {items.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-muted-foreground flex-shrink-0">-</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ScoreCard({ label, value }: { label: string; value: number | null }) {
  if (value === null) {
    return (
      <div className="rounded-md border p-2 text-center">
        <p className="text-lg font-bold text-muted-foreground">—</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    );
  }
  return (
    <div className="rounded-md border p-2 text-center">
      <p className={`text-lg font-bold ${scoreColor(value)}`}>{value}/10</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function scoreColor(value: number): string {
  if (value >= 8) return 'text-green-600';
  if (value >= 5) return 'text-yellow-600';
  return 'text-red-600';
}

function readinessBadge(readiness?: string) {
  switch (readiness) {
    case 'hot': return <Badge className="bg-red-100 text-red-800">Горячий</Badge>;
    case 'warm': return <Badge className="bg-yellow-100 text-yellow-800">Тёплый</Badge>;
    case 'cold': return <Badge className="bg-blue-100 text-blue-800">Холодный</Badge>;
    default: return null;
  }
}
