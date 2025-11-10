import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DialogAnalysis } from '@/types/dialogAnalysis';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { dialogAnalysisService } from '@/services/dialogAnalysisService';
import { toast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Upload, Loader2 } from 'lucide-react';

const USER_ACCOUNT_ID = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b';

interface DialogDetailModalProps {
  dialog: DialogAnalysis | null;
  open: boolean;
  onClose: () => void;
}

export function DialogDetailModal({ dialog, open, onClose }: DialogDetailModalProps) {
  if (!dialog) return null;

  const queryClient = useQueryClient();
  const [notes, setNotes] = useState(dialog.manual_notes || '');
  const [isUploadingAudio, setIsUploadingAudio] = useState(false);

  // Upload audio mutation
  const uploadAudioMutation = useMutation({
    mutationFn: (file: File) => dialogAnalysisService.uploadAudio(dialog.id, file, USER_ACCOUNT_ID),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      toast({ 
        title: 'Аудио загружено',
        description: 'Транскрипция выполнена и анализ обновлен'
      });
      setIsUploadingAudio(false);
    },
    onError: (error: Error) => {
      toast({
        title: 'Ошибка загрузки аудио',
        description: error.message,
        variant: 'destructive'
      });
      setIsUploadingAudio(false);
    },
  });

  // Update notes mutation
  const updateNotesMutation = useMutation({
    mutationFn: (newNotes: string) => 
      dialogAnalysisService.updateNotes(dialog.id, newNotes, USER_ACCOUNT_ID),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      toast({ title: 'Заметки сохранены и анализ обновлен' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Ошибка сохранения заметок',
        description: error.message,
        variant: 'destructive'
      });
    },
  });

  // Toggle autopilot mutation
  const toggleAutopilotMutation = useMutation({
    mutationFn: (enabled: boolean) => 
      dialogAnalysisService.toggleAutopilot(dialog.id, enabled, USER_ACCOUNT_ID),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      toast({ title: 'Настройка автопилота обновлена' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Ошибка обновления автопилота',
        description: error.message,
        variant: 'destructive'
      });
    },
  });

  const handleAudioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setIsUploadingAudio(true);
      uploadAudioMutation.mutate(file);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span>{dialog.contact_name || 'Без имени'}</span>
            <Badge variant="secondary">{dialog.contact_phone}</Badge>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="h-[70vh] pr-4">
          <div className="space-y-6">
            {/* Key Metrics */}
            <div>
              <h3 className="font-semibold mb-3">Основные метрики</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-gray-500">Score</div>
                  <div className="text-2xl font-bold">{dialog.score ?? '—'}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-500">Уровень интереса</div>
                  <div className="text-xl font-semibold">
                    {dialog.interest_level === 'hot' && '🔥 HOT'}
                    {dialog.interest_level === 'warm' && '🌤️ WARM'}
                    {dialog.interest_level === 'cold' && '❄️ COLD'}
                  </div>
                </div>
              </div>
            </div>

            {/* Business Info */}
            <div>
              <h3 className="font-semibold mb-3">Информация о бизнесе</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Тип бизнеса:</span>
                  <span className="font-medium">{dialog.business_type || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Владелец:</span>
                  <span>{dialog.is_owner ? '✓ Да' : '✗ Нет'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Запускает рекламу:</span>
                  <span>{dialog.uses_ads_now ? '✓ Да' : '✗ Нет'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Отдел продаж:</span>
                  <span>{dialog.has_sales_dept ? '✓ Есть' : '✗ Нет'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Бюджет на рекламу:</span>
                  <span className="font-medium">{dialog.ad_budget || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Квалифицирован:</span>
                  <span>{dialog.qualification_complete ? '✓ Да' : '✗ Нет'}</span>
                </div>
              </div>
            </div>

            {/* Reasoning */}
            {dialog.reasoning && (
              <div>
                <h3 className="font-semibold mb-3">Обоснование оценки</h3>
                <div className="bg-gray-50 rounded-lg p-4 text-sm">
                  {dialog.reasoning}
                </div>
              </div>
            )}

            {/* Audio, Notes & Autopilot */}
            <div>
              <h3 className="font-semibold mb-3">Дополнительные данные</h3>
              <div className="space-y-4">
                {/* Upload Audio */}
                <div>
                  <Label htmlFor="audio-upload" className="text-sm text-gray-600 mb-2 block">
                    Загрузить аудиозапись звонка
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="audio-upload"
                      type="file"
                      accept="audio/*"
                      onChange={handleAudioUpload}
                      disabled={isUploadingAudio}
                      className="flex-1"
                    />
                    {isUploadingAudio && (
                      <Loader2 className="h-4 w-4 animate-spin text-gray-500" />
                    )}
                  </div>
                  {dialog.audio_transcripts && dialog.audio_transcripts.length > 0 && (
                    <p className="text-xs text-green-600 mt-2 flex items-center gap-1">
                      <Upload className="h-3 w-3" />
                      Загружено {dialog.audio_transcripts.length} аудиозаписей
                    </p>
                  )}
                  <p className="text-xs text-gray-500 mt-1">
                    Аудио будет транскрибировано и использовано для уточнения анализа
                  </p>
                </div>

                {/* Manual Notes */}
                <div>
                  <Label htmlFor="notes" className="text-sm text-gray-600 mb-2 block">
                    Заметки менеджера
                  </Label>
                  <Textarea
                    id="notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Добавьте важные заметки о лиде..."
                    rows={3}
                    className="resize-none"
                  />
                  <Button
                    size="sm"
                    onClick={() => updateNotesMutation.mutate(notes)}
                    disabled={updateNotesMutation.isPending || notes === dialog.manual_notes}
                    className="mt-2"
                  >
                    {updateNotesMutation.isPending ? (
                      <>
                        <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                        Сохранение...
                      </>
                    ) : (
                      'Сохранить заметки'
                    )}
                  </Button>
                  {notes !== dialog.manual_notes && (
                    <p className="text-xs text-orange-600 mt-1">
                      Несохраненные изменения
                    </p>
                  )}
                </div>

                {/* Autopilot Toggle */}
                <div className="flex items-center justify-between p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <div>
                    <p className="font-medium text-sm">Автопилот для этого лида</p>
                    <p className="text-xs text-gray-600 mt-1">
                      Включать лида в автоматические рассылки
                    </p>
                  </div>
                  <Switch
                    checked={dialog.autopilot_enabled ?? true}
                    onCheckedChange={(enabled) => toggleAutopilotMutation.mutate(enabled)}
                    disabled={toggleAutopilotMutation.isPending}
                  />
                </div>
              </div>
            </div>

            {/* Message History */}
            {dialog.messages && dialog.messages.length > 0 && (
              <div>
                <h3 className="font-semibold mb-3">
                  История диалога ({dialog.messages.length} сообщений)
                </h3>
                <div className="space-y-2">
                  {dialog.messages.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`text-sm p-3 rounded-lg ${
                        msg.from_me
                          ? 'bg-green-50 border-green-200 border ml-8'
                          : 'bg-gray-50 border-gray-200 border mr-8'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-xs text-gray-600">
                          {msg.from_me ? 'Вы' : dialog.contact_name || 'Клиент'}
                        </span>
                        <span className="text-xs text-gray-500">
                          {format(new Date(msg.timestamp), 'dd MMM yyyy, HH:mm', { locale: ru })}
                        </span>
                      </div>
                      <div className="whitespace-pre-wrap">{msg.text}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Metadata */}
            <div>
              <h3 className="font-semibold mb-3">Метаданные</h3>
              <div className="space-y-2 text-sm text-gray-600">
                <div className="flex justify-between">
                  <span>Первое сообщение:</span>
                  <span>
                    {dialog.first_message
                      ? format(new Date(dialog.first_message), 'dd MMM yyyy, HH:mm', { locale: ru })
                      : '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Последнее сообщение:</span>
                  <span>
                    {dialog.last_message
                      ? format(new Date(dialog.last_message), 'dd MMM yyyy, HH:mm', { locale: ru })
                      : '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Проанализировано:</span>
                  <span>
                    {format(new Date(dialog.analyzed_at), 'dd MMM yyyy, HH:mm', { locale: ru })}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}


