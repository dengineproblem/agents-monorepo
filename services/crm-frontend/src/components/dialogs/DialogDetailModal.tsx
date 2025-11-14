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
import { Upload, Loader2, Sparkles, Send } from 'lucide-react';

const USER_ACCOUNT_ID = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b';

interface DialogDetailModalProps {
  dialog: DialogAnalysis | null;
  open: boolean;
  onClose: () => void;
}

// Parse reasoning into structured format
function parseReasoning(reasoning: string): { positive: string[]; negative: string[] } {
  const lines = reasoning.split('\n').filter(line => line.trim());
  const positive: string[] = [];
  const negative: string[] = [];

  lines.forEach(line => {
    const trimmed = line.trim();
    // Look for lines with +/- followed by numbers
    if (trimmed.match(/[+\+][\s]*\d+/)) {
      positive.push(trimmed);
    } else if (trimmed.match(/[-\-][\s]*\d+/)) {
      negative.push(trimmed);
    } else if (trimmed.includes('+')) {
      positive.push(trimmed);
    } else if (trimmed.includes('-') && trimmed.match(/\d/)) {
      negative.push(trimmed);
    } else if (trimmed) {
      // Default: any line with content
      positive.push(trimmed);
    }
  });

  return { positive, negative };
}

export function DialogDetailModal({ dialog, open, onClose }: DialogDetailModalProps) {
  if (!dialog) return null;

  const queryClient = useQueryClient();
  const [notes, setNotes] = useState(dialog.manual_notes || '');
  const [isUploadingAudio, setIsUploadingAudio] = useState(false);
  const [messageText, setMessageText] = useState('');

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

  // Generate message mutation
  const generateMessageMutation = useMutation({
    mutationFn: () => dialogAnalysisService.generateMessage(dialog.id, USER_ACCOUNT_ID),
    onSuccess: (data) => {
      setMessageText(data.message);
      toast({ 
        title: '✨ Сообщение сгенерировано',
        description: `Тип: ${data.messageType}` 
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Ошибка генерации сообщения',
        description: error.message,
        variant: 'destructive'
      });
    },
  });

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: (message: string) => 
      dialogAnalysisService.sendMessage(dialog.id, USER_ACCOUNT_ID, message),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      setMessageText('');
      toast({ 
        title: '✓ Сообщение отправлено',
        description: 'Сообщение успешно отправлено в WhatsApp'
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Ошибка отправки сообщения',
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

  const handleSendMessage = () => {
    if (!messageText.trim()) return;
    sendMessageMutation.mutate(messageText);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader className="border-b pb-4">
          <DialogTitle className="flex items-center gap-3">
            <span className="text-xl font-bold">{dialog.contact_name || 'Без имени'}</span>
            <Badge variant="secondary" className="text-sm">{dialog.contact_phone}</Badge>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="h-[70vh] pr-4">
          <div className="space-y-6">
            {/* Key Metrics - Combined */}
            <div className="bg-accent/30 rounded-lg p-4 border space-y-3">
              <div>
                <div className="text-sm text-muted-foreground mb-1">Уровень интереса</div>
                <div className="flex items-center gap-3">
                  <div className="text-3xl font-bold">{dialog.score ?? '—'}</div>
                  <div className="text-2xl">
                    {dialog.interest_level === 'hot' && '🔥'}
                    {dialog.interest_level === 'warm' && '☀️'}
                    {dialog.interest_level === 'cold' && '❄️'}
                    {!dialog.interest_level && '—'}
                  </div>
                </div>
              </div>
              
              {/* Autopilot Toggle */}
              <div className="flex items-center justify-between pt-2 border-t">
                <span className="text-sm font-medium">Автопилот</span>
                <Switch
                  checked={dialog.autopilot_enabled ?? true}
                  onCheckedChange={(enabled) => toggleAutopilotMutation.mutate(enabled)}
                  disabled={toggleAutopilotMutation.isPending}
                />
              </div>
            </div>

            {/* Business Info */}
            <div>
              <h3 className="font-semibold mb-3">Информация о бизнесе</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-300">Тип бизнеса:</span>
                  <span className="font-medium">{dialog.business_type || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-300">Владелец:</span>
                  <span>{dialog.is_owner ? '✓ Да' : '✗ Нет'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-300">Запускает рекламу:</span>
                  <span>{dialog.uses_ads_now ? '✓ Да' : '✗ Нет'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-300">Отдел продаж:</span>
                  <span>{dialog.has_sales_dept ? '✓ Есть' : '✗ Нет'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-300">Бюджет на рекламу:</span>
                  <span className="font-medium">{dialog.ad_budget || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-300">Квалифицирован:</span>
                  <span>{dialog.qualification_complete ? '✓ Да' : '✗ Нет'}</span>
                </div>
              </div>
            </div>

            {/* Reasoning */}
            {dialog.reasoning && (() => {
              const { positive, negative } = parseReasoning(dialog.reasoning);
              return (
                <div>
                  <h3 className="font-semibold mb-3">Обоснование оценки</h3>
                  <div className="space-y-3">
                {positive.length > 0 && (
                  <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                    <div className="font-medium mb-2 flex items-center gap-2">
                      <span className="text-lg">✓</span>
                      Позитивные факторы
                    </div>
                    <ul className="space-y-1.5">
                      {positive.map((item, index) => (
                        <li key={index} className="text-sm flex items-start gap-2">
                          <span className="mt-0.5">•</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {negative.length > 0 && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
                    <div className="font-medium mb-2 flex items-center gap-2">
                      <span className="text-lg">✗</span>
                      Негативные факторы
                    </div>
                    <ul className="space-y-1.5">
                      {negative.map((item, index) => (
                        <li key={index} className="text-sm flex items-start gap-2">
                          <span className="mt-0.5">•</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {positive.length === 0 && negative.length === 0 && (
                  <div className="bg-muted rounded-lg p-4 text-sm">
                    {dialog.reasoning}
                  </div>
                )}
                  </div>
                </div>
              );
            })()}

            {/* Audio, Notes & Autopilot */}
            <div>
              <h3 className="font-semibold mb-3">Дополнительные данные</h3>
              <div className="space-y-4">
                {/* Upload Audio */}
                <div>
                  <Label htmlFor="audio-upload" className="text-sm text-gray-600 dark:text-gray-300 mb-2 block">
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
                      <Loader2 className="h-4 w-4 animate-spin text-gray-500 dark:text-gray-400" />
                    )}
                  </div>
                  {dialog.audio_transcripts && dialog.audio_transcripts.length > 0 && (
                    <p className="text-xs text-green-600 mt-2 flex items-center gap-1">
                      <Upload className="h-3 w-3" />
                      Загружено {dialog.audio_transcripts.length} аудиозаписей
                    </p>
                  )}
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Аудио будет транскрибировано и использовано для уточнения анализа
                  </p>
                </div>

                {/* Manual Notes */}
                <div>
                  <Label htmlFor="notes" className="text-sm text-gray-600 dark:text-gray-300 mb-2 block">
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
              </div>
            </div>

            {/* Send Message Section */}
            <div>
              <h3 className="font-semibold mb-3">Отправить сообщение</h3>
              <div className="space-y-3">
                <div className="flex gap-2">
                  <Textarea
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    placeholder="Введите сообщение для отправки..."
                    rows={3}
                    className="flex-1"
                    disabled={sendMessageMutation.isPending}
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => generateMessageMutation.mutate()}
                    variant="outline"
                    size="sm"
                    disabled={generateMessageMutation.isPending}
                    className="flex items-center gap-2"
                  >
                    {generateMessageMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Генерация...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" />
                        Сгенерировать ИИ
                      </>
                    )}
                  </Button>
                  <Button
                    onClick={handleSendMessage}
                    size="sm"
                    disabled={!messageText.trim() || sendMessageMutation.isPending}
                    className="flex items-center gap-2"
                  >
                    {sendMessageMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Отправка...
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4" />
                        Отправить
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>

            {/* Metadata */}
            <div>
              <h3 className="font-semibold mb-3">Метаданные</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Первое сообщение:</span>
                  <span className="font-medium">
                    {dialog.first_message
                      ? format(new Date(dialog.first_message), 'dd MMM yyyy, HH:mm', { locale: ru })
                      : '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Последнее сообщение:</span>
                  <span className="font-medium">
                    {dialog.last_message
                      ? format(new Date(dialog.last_message), 'dd MMM yyyy, HH:mm', { locale: ru })
                      : '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Проанализировано:</span>
                  <span className="font-medium">
                    {format(new Date(dialog.analyzed_at), 'dd MMM yyyy, HH:mm', { locale: ru })}
                  </span>
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
                      className={`text-sm p-3 rounded-lg border ${
                        msg.from_me
                          ? 'bg-green-500/10 border-green-500/20 ml-8'
                          : 'bg-muted border-border mr-8'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-xs">
                          {msg.from_me ? 'Вы' : dialog.contact_name || 'Клиент'}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(msg.timestamp), 'dd MMM yyyy, HH:mm', { locale: ru })}
                        </span>
                      </div>
                      <div className="whitespace-pre-wrap">{msg.text}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}


