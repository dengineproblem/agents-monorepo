import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { consultantApi, Lead } from '@/services/consultantApi';
import { useToast } from '@/hooks/use-toast';
import { Mic, Square, Loader2, CheckCircle, AlertCircle, Monitor, X } from 'lucide-react';

type RecordingState = 'idle' | 'selecting' | 'waiting_for_tab' | 'recording' | 'uploading' | 'done' | 'error';
type RecordingMode = 'tab' | 'mic_only';

interface CallRecorderProps {
  leads: Lead[];
  consultantId?: string;
  defaultLeadId?: string;
  defaultLeadName?: string;
  onClose?: () => void;
  onRecordingComplete?: () => void;
}

export function CallRecorder({ leads, consultantId, defaultLeadId, defaultLeadName, onClose, onRecordingComplete }: CallRecorderProps) {
  const { toast } = useToast();
  const [state, setState] = useState<RecordingState>(defaultLeadId ? 'waiting_for_tab' : 'idle');
  const [selectedLeadId, setSelectedLeadId] = useState<string>(defaultLeadId || '');
  const [recordingMode, setRecordingMode] = useState<RecordingMode>(defaultLeadId ? 'tab' : 'mic_only');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamsRef = useRef<MediaStream[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Cleanup при размонтировании
  useEffect(() => {
    return () => {
      stopAllStreams();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // beforeunload предупреждение во время записи
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (state === 'recording') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [state]);

  const stopAllStreams = useCallback(() => {
    streamsRef.current.forEach(stream => {
      stream.getTracks().forEach(track => track.stop());
    });
    streamsRef.current = [];
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
  }, []);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const handleStartClick = () => {
    setSelectedLeadId('');
    setRecordingMode('mic_only');
    setDialogOpen(true);
    setState('selecting');
  };

  // Вызывается из диалога — закрывает диалог и запускает запись
  const handleDialogConfirm = () => {
    setDialogOpen(false);

    if (recordingMode === 'tab') {
      // Для tab режима: показываем кнопку ВНЕ диалога,
      // потому что getDisplayMedia не работает из Radix Dialog (блокирует user gesture)
      setState('waiting_for_tab');
    } else {
      // Для mic_only: запускаем сразу
      startMicRecording();
    }
  };

  // Вызывается по клику на кнопку ВНЕ диалога — user gesture сохраняется
  const handleTabCaptureClick = async () => {
    try {
      let displayStream: MediaStream;
      try {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          audio: true,
          video: true,
        });
      } catch {
        toast({
          title: 'Запись отменена',
          description: 'Вы не выбрали вкладку для записи',
          variant: 'destructive',
        });
        onClose ? onClose() : setState('idle');
        return;
      }

      // Останавливаем видеотрек — нужен только аудио
      displayStream.getVideoTracks().forEach(track => track.stop());

      if (displayStream.getAudioTracks().length === 0) {
        displayStream.getTracks().forEach(t => t.stop());
        toast({
          title: 'Нет аудио',
          description: 'Выбранная вкладка не содержит аудио. Попробуйте вкладку с Zoom/Meet.',
          variant: 'destructive',
        });
        setState('idle');
        return;
      }

      // Микрофон
      let micStream: MediaStream;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
      } catch {
        displayStream.getTracks().forEach(t => t.stop());
        toast({
          title: 'Нет доступа к микрофону',
          description: 'Разрешите доступ к микрофону в настройках браузера',
          variant: 'destructive',
        });
        setState('idle');
        return;
      }

      streamsRef.current = [displayStream, micStream];

      // Микшируем оба потока через Web Audio API
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const destination = audioContext.createMediaStreamDestination();

      const tabSource = audioContext.createMediaStreamSource(displayStream);
      tabSource.connect(destination);

      const micSource = audioContext.createMediaStreamSource(micStream);
      micSource.connect(destination);

      // Если tab stream заканчивается — останавливаем запись
      displayStream.getAudioTracks()[0].addEventListener('ended', () => {
        if (mediaRecorderRef.current?.state === 'recording') {
          stopRecording();
        }
      });

      beginRecording(destination.stream);
    } catch (err: any) {
      toast({
        title: 'Ошибка записи',
        description: err.message || 'Не удалось начать запись',
        variant: 'destructive',
      });
      stopAllStreams();
      setState('idle');
    }
  };

  const startMicRecording = async () => {
    try {
      let micStream: MediaStream;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
      } catch {
        toast({
          title: 'Нет доступа к микрофону',
          description: 'Разрешите доступ к микрофону в настройках браузера',
          variant: 'destructive',
        });
        setState('idle');
        return;
      }

      streamsRef.current = [micStream];
      beginRecording(micStream);
    } catch (err: any) {
      toast({
        title: 'Ошибка записи',
        description: err.message || 'Не удалось начать запись',
        variant: 'destructive',
      });
      stopAllStreams();
      setState('idle');
    }
  };

  const beginRecording = (stream: MediaStream) => {
    const mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm;codecs=opus',
      audioBitsPerSecond: 64000,
    });

    chunksRef.current = [];
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    mediaRecorder.onstop = () => {
      handleRecordingStopped();
    };

    mediaRecorderRef.current = mediaRecorder;
    mediaRecorder.start(10000);

    startTimeRef.current = Date.now();
    setElapsed(0);
    timerRef.current = setInterval(() => {
      const secs = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setElapsed(secs);

      if (secs >= 7200) {
        toast({ title: 'Максимальная длительность', description: 'Запись остановлена (2 часа)' });
        stopRecording();
      }
    }, 1000);

    setState('recording');
  };

  const stopRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }

    stopAllStreams();
  }, [stopAllStreams]);

  const handleRecordingStopped = async () => {
    setState('uploading');

    const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
    const durationSeconds = Math.floor((Date.now() - startTimeRef.current) / 1000);

    try {
      const formData = new FormData();
      formData.append('audio', blob, `recording_${Date.now()}.webm`);
      formData.append('duration_seconds', String(durationSeconds));
      formData.append('recording_mode', recordingMode);
      if (selectedLeadId) formData.append('lead_id', selectedLeadId);
      if (consultantId) formData.append('consultant_id', consultantId);

      await consultantApi.uploadCallRecording(formData);

      setState('done');
      toast({ title: 'Запись сохранена', description: 'Транскрипция и анализ запущены автоматически' });
      onRecordingComplete?.();

      setTimeout(() => setState('idle'), 3000);
    } catch (err: any) {
      setErrorMessage(err.message || 'Ошибка загрузки');
      setState('error');
      toast({
        title: 'Ошибка загрузки',
        description: err.message,
        variant: 'destructive',
      });
    }
  };

  return (
    <>
      <Card>
        <CardContent className="pt-6">
          {state === 'idle' && (
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium">Запись звонка</h3>
                <p className="text-sm text-muted-foreground">
                  {selectedLeadId
                    ? `Лид: ${defaultLeadName || leads.find(l => l.id === selectedLeadId)?.contact_name || 'Выбран'}`
                    : 'Запишите созвон с клиентом для транскрипции и анализа'}
                </p>
              </div>
              <div className="flex gap-2">
                {onClose && (
                  <Button onClick={onClose} variant="ghost" size="icon">
                    <X className="h-4 w-4" />
                  </Button>
                )}
                <Button onClick={handleStartClick} variant="destructive" size="lg">
                  <Mic className="h-5 w-5 mr-2" />
                  Записать звонок
                </Button>
              </div>
            </div>
          )}

          {state === 'waiting_for_tab' && (
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium">Выберите вкладку с Zoom / Meet</h3>
                <p className="text-sm text-muted-foreground">
                  {selectedLeadId
                    ? `Лид: ${defaultLeadName || leads.find(l => l.id === selectedLeadId)?.contact_name || 'Выбран'} — `
                    : ''}
                  Нажмите кнопку — Chrome покажет список вкладок для захвата аудио
                </p>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => { onClose ? onClose() : setState('idle'); }} variant="ghost" size="icon">
                  <X className="h-4 w-4" />
                </Button>
                <Button onClick={handleTabCaptureClick} variant="destructive" size="lg">
                  <Monitor className="h-5 w-5 mr-2" />
                  Выбрать вкладку
                </Button>
              </div>
            </div>
          )}

          {state === 'recording' && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <div className="h-4 w-4 rounded-full bg-red-500 animate-pulse" />
                </div>
                <div>
                  <p className="font-medium text-red-600">Идёт запись</p>
                  <p className="text-2xl font-mono font-bold">{formatTime(elapsed)}</p>
                </div>
                {recordingMode === 'tab' && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                    <Monitor className="h-3 w-3" />
                    Вкладка + Микрофон
                  </div>
                )}
                {recordingMode === 'mic_only' && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                    <Mic className="h-3 w-3" />
                    Только микрофон
                  </div>
                )}
              </div>
              <Button onClick={stopRecording} variant="outline" size="lg">
                <Square className="h-5 w-5 mr-2" />
                Остановить
              </Button>
            </div>
          )}

          {state === 'uploading' && (
            <div className="flex items-center gap-4">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <div>
                <p className="font-medium">Сохранение записи...</p>
                <p className="text-sm text-muted-foreground">Подождите, файл загружается</p>
              </div>
            </div>
          )}

          {state === 'done' && (
            <div className="flex items-center gap-4">
              <CheckCircle className="h-6 w-6 text-green-500" />
              <div>
                <p className="font-medium text-green-600">Запись сохранена</p>
                <p className="text-sm text-muted-foreground">
                  Транскрипция и анализ запущены автоматически
                </p>
              </div>
            </div>
          )}

          {state === 'error' && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <AlertCircle className="h-6 w-6 text-red-500" />
                <div>
                  <p className="font-medium text-red-600">Ошибка</p>
                  <p className="text-sm text-muted-foreground">{errorMessage}</p>
                </div>
              </div>
              <Button onClick={() => setState('idle')} variant="outline">
                Попробовать снова
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Диалог выбора лида и режима */}
      <Dialog open={dialogOpen} onOpenChange={(open) => {
        if (!open) {
          setDialogOpen(false);
          setState('idle');
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Запись звонка</DialogTitle>
            <DialogDescription>
              Выберите клиента и режим записи
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Клиент (необязательно)</Label>
              <Select value={selectedLeadId} onValueChange={setSelectedLeadId}>
                <SelectTrigger>
                  <SelectValue placeholder="Не выбран" />
                </SelectTrigger>
                <SelectContent>
                  {leads.map(lead => (
                    <SelectItem key={lead.id} value={lead.id}>
                      {lead.contact_name || lead.contact_phone || 'Без имени'}
                      {lead.contact_name && lead.contact_phone ? ` (${lead.contact_phone})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3">
              <Label>Режим записи</Label>
              <div className="grid gap-2">
                <button
                  type="button"
                  onClick={() => setRecordingMode('mic_only')}
                  className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                    recordingMode === 'mic_only'
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-muted/50'
                  }`}
                >
                  <Mic className="h-5 w-5 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-sm">Микрофон</p>
                    <p className="text-xs text-muted-foreground">
                      Записывает ваш голос. Подходит для большинства случаев.
                    </p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setRecordingMode('tab')}
                  className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                    recordingMode === 'tab'
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-muted/50'
                  }`}
                >
                  <Monitor className="h-5 w-5 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-sm">Микрофон + звук вкладки</p>
                    <p className="text-xs text-muted-foreground">
                      Записывает ваш голос и звук собеседника из Zoom/Meet в браузере.
                    </p>
                  </div>
                </button>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); setState('idle'); }}>
              Отмена
            </Button>
            <Button onClick={handleDialogConfirm} variant="destructive">
              <Mic className="h-4 w-4 mr-2" />
              Начать запись
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
