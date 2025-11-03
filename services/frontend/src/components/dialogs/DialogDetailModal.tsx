import { DialogAnalysis } from '@/types/dialogAnalysis';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

interface DialogDetailModalProps {
  dialog: DialogAnalysis | null;
  open: boolean;
  onClose: () => void;
}

export function DialogDetailModal({ dialog, open, onClose }: DialogDetailModalProps) {
  if (!dialog) return null;

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

