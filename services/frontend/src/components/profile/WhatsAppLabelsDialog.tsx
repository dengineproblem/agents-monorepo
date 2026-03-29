import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, QrCode, CheckCircle2, Tag, Trash2, RefreshCw } from 'lucide-react';
// @ts-ignore - direct browser entry to bypass Rollup resolve issues in Docker Alpine
import QRCode from 'qrcode/lib/browser';

interface WhatsAppLabelsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userAccountId: string;
  isConfigured?: boolean;
  onConfigured?: () => void;
  onReset?: () => void;
}

const LABELS_SERVICE_URL = import.meta.env.VITE_WHATSAPP_LABELS_SERVICE_URL || `${window.location.origin}/wwebjs`;

type Step = 'loading' | 'qr' | 'select_label' | 'done';

interface WaLabel {
  id: string;
  name: string;
  hexColor: string;
}

export const WhatsAppLabelsDialog: React.FC<WhatsAppLabelsDialogProps> = ({
  open,
  onOpenChange,
  userAccountId,
  isConfigured = false,
  onConfigured,
  onReset,
}) => {
  const [step, setStep] = useState<Step>('loading');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('initializing');
  const [labels, setLabels] = useState<WaLabel[]>([]);
  const [selectedLabelId, setSelectedLabelId] = useState<string>('');
  const [selectedPaidLabelId, setSelectedPaidLabelId] = useState<string>('');
  const [saving, setSaving] = useState(false);

  // Сброс paid label если совпадает с lead label
  const handleLeadLabelChange = (value: string) => {
    setSelectedLabelId(value);
    if (selectedPaidLabelId === value) {
      setSelectedPaidLabelId('');
    }
  };
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLabels = useCallback(async () => {
    try {
      const res = await fetch(`${LABELS_SERVICE_URL}/sessions/${userAccountId}/labels`);
      const data = await res.json();

      if (Array.isArray(data)) {
        setLabels(data);
        setStep('select_label');
      } else {
        setError('Не удалось получить список ярлыков');
      }
    } catch (err: any) {
      setError('Не удалось получить ярлыки: ' + (err.message || ''));
    }
  }, [userAccountId]);

  const startSession = useCallback(async () => {
    try {
      setError(null);
      setStep('loading');
      const res = await fetch(`${LABELS_SERVICE_URL}/qr/${userAccountId}`, { method: 'POST' });
      const data = await res.json();

      if (data.status === 'connected') {
        fetchLabels();
        return;
      }

      setStep('qr');

      if (data.qrCode) {
        const dataUrl = await QRCode.toDataURL(data.qrCode, { width: 300, margin: 2 });
        setQrDataUrl(dataUrl);
        setStatus('waiting_scan');
      } else {
        setStatus('initializing');
      }

      // Poll for status
      pollRef.current = setInterval(async () => {
        try {
          const pollRes = await fetch(`${LABELS_SERVICE_URL}/qr/${userAccountId}`);
          const pollData = await pollRes.json();

          if (pollData.status === 'connected') {
            if (pollRef.current) clearInterval(pollRef.current);
            fetchLabels();
          } else if (pollData.qrCode && pollData.qrCode !== data.qrCode) {
            const newDataUrl = await QRCode.toDataURL(pollData.qrCode, { width: 300, margin: 2 });
            setQrDataUrl(newDataUrl);
          }
        } catch {
          // ignore poll errors
        }
      }, 3000);
    } catch (err: any) {
      setError(err.message || 'Не удалось инициализировать сессию');
      setStep('qr');
    }
  }, [userAccountId, fetchLabels]);

  const saveLabel = async () => {
    if (!selectedLabelId) return;

    setSaving(true);
    try {
      const apiBase = import.meta.env.VITE_API_BASE_URL || '/api';
      const res = await fetch(`${apiBase}/user-accounts/${userAccountId}/wwebjs-label`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadLabelId: selectedLabelId,
          paidLabelId: selectedPaidLabelId || null,
        }),
      });

      if (!res.ok) throw new Error('Не удалось сохранить настройку');

      setStep('done');
      onConfigured?.();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const resetSession = async () => {
    if (!confirm('Сбросить подключение wwebjs? Потребуется повторное сканирование QR-кода.')) return;

    setResetting(true);
    try {
      await fetch(`${LABELS_SERVICE_URL}/sessions/${userAccountId}`, { method: 'DELETE' });

      // Очищаем ярлыки
      const apiBase = import.meta.env.VITE_API_BASE_URL || '/api';
      await fetch(`${apiBase}/user-accounts/${userAccountId}/wwebjs-label`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadLabelId: null, paidLabelId: null }),
      });

      onReset?.();
      onOpenChange(false);
    } catch (err: any) {
      setError('Не удалось сбросить: ' + (err.message || ''));
    } finally {
      setResetting(false);
    }
  };

  useEffect(() => {
    if (open) {
      setQrDataUrl(null);
      setStatus('initializing');
      setLabels([]);
      setSelectedLabelId('');
      setSelectedPaidLabelId('');
      setError(null);

      if (isConfigured) {
        // Уже настроено — сразу пробуем загрузить ярлыки (поднимет сессию)
        startSession();
      } else {
        // Первый раз — показываем QR
        startSession();
      }
    }

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [open, startSession, isConfigured]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5" />
            {isConfigured ? 'Настройки ярлыков WhatsApp' : 'Подключение ярлыков WhatsApp'}
          </DialogTitle>
          <DialogDescription>
            {step === 'loading' && 'Подключение к WhatsApp...'}
            {step === 'qr' && 'Отсканируйте QR-код в WhatsApp Business для автоматической простановки ярлыков'}
            {step === 'select_label' && 'Настройте ярлыки для квалифицированных лидов и оплативших клиентов'}
            {step === 'done' && 'Ярлыки настроены!'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          {error && (
            <p className="text-sm text-red-600 text-center">{error}</p>
          )}

          {step === 'loading' && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Подключение к WhatsApp...</p>
            </div>
          )}

          {step === 'qr' && (
            <>
              {qrDataUrl ? (
                <div className="space-y-3 text-center">
                  <img src={qrDataUrl} alt="QR Code" className="mx-auto rounded-lg" />
                  <p className="text-sm text-muted-foreground">
                    WhatsApp → Связанные устройства → Привязать устройство
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Генерация QR-кода...</p>
                </div>
              )}
            </>
          )}

          {step === 'select_label' && (
            <div className="w-full space-y-4">
              <p className="text-sm">
                {isConfigured
                  ? 'Настройте ярлыки для автоматической простановки:'
                  : 'WhatsApp подключён. Настройте ярлыки для автоматической простановки:'}
              </p>

              <div className="space-y-1">
                <label className="text-sm font-medium">Ярлык для квалифицированных лидов</label>
                <Select value={selectedLabelId} onValueChange={handleLeadLabelChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите ярлык" />
                  </SelectTrigger>
                  <SelectContent>
                    {labels.map((label) => (
                      <SelectItem key={label.id} value={label.id}>
                        <span className="flex items-center gap-2">
                          <span
                            className="w-3 h-3 rounded-full inline-block"
                            style={{ backgroundColor: label.hexColor || '#ccc' }}
                          />
                          {label.name || `Ярлык ${label.id}`}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Ярлык для оплативших клиентов <span className="text-muted-foreground font-normal">(необязательно)</span></label>
                <Select value={selectedPaidLabelId} onValueChange={setSelectedPaidLabelId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Не выбран" />
                  </SelectTrigger>
                  <SelectContent>
                    {labels
                      .filter((l) => l.id !== selectedLabelId)
                      .map((label) => (
                        <SelectItem key={label.id} value={label.id}>
                          <span className="flex items-center gap-2">
                            <span
                              className="w-3 h-3 rounded-full inline-block"
                              style={{ backgroundColor: label.hexColor || '#ccc' }}
                            />
                            {label.name || `Ярлык ${label.id}`}
                          </span>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={saveLabel}
                disabled={!selectedLabelId || saving}
                className="w-full"
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Сохранение...
                  </>
                ) : (
                  'Сохранить'
                )}
              </Button>

              {isConfigured && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={resetSession}
                  disabled={resetting}
                  className="w-full"
                >
                  {resetting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Сброс...
                    </>
                  ) : (
                    <>
                      <Trash2 className="h-4 w-4 mr-2" />
                      Сбросить подключение
                    </>
                  )}
                </Button>
              )}
            </div>
          )}

          {step === 'done' && (
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <p className="text-sm text-center">
                Ярлыки настроены! Квалифицированные лиды будут автоматически помечаться
                каждую ночь в 03:00.
              </p>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Закрыть
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
