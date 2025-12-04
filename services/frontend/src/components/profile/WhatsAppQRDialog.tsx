import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { whatsappApi } from '@/services/whatsappApi';

interface WhatsAppQRDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userAccountId: string;
  phoneNumberId: string;
  phoneNumber: string;
  accountId?: string;  // UUID из ad_accounts.id для мультиаккаунтности
  onConnected: () => void;
}

export const WhatsAppQRDialog: React.FC<WhatsAppQRDialogProps> = ({
  open,
  onOpenChange,
  userAccountId,
  phoneNumberId,
  phoneNumber,
  accountId,
  onConnected,
}) => {
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [instanceName, setInstanceName] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'qr' | 'connecting' | 'connected' | 'error'>(
    'loading'
  );
  const [error, setError] = useState<string | null>(null);

  // Создать инстанс при открытии диалога
  useEffect(() => {
    if (open) {
      createInstance();
    } else {
      // Сброс состояния при закрытии
      setQrCode(null);
      setInstanceName(null);
      setStatus('loading');
      setError(null);
    }
  }, [open]);

  const createInstance = async () => {
    try {
      setStatus('loading');
      setError(null);

      const result = await whatsappApi.createInstance(userAccountId, phoneNumberId, accountId);

      if (result.qrcode.count === 0) {
        setError('QR-код не сгенерирован. Попробуйте еще раз.');
        setStatus('error');
        return;
      }

      // QR-код может быть в base64 или code
      const qr = result.qrcode.base64 || result.qrcode.code;
      setQrCode(qr);
      setInstanceName(result.instance.instance_name);
      setStatus('qr');

      // Начать проверку статуса подключения
      startPolling(result.instance.instance_name);
    } catch (err) {
      console.error('Failed to create WhatsApp instance:', err);
      setError(err instanceof Error ? err.message : 'Не удалось создать инстанс');
      setStatus('error');
    }
  };

  const startPolling = (name: string) => {
    const interval = setInterval(async () => {
      try {
        const result = await whatsappApi.getInstanceStatus(name);

        if (result.status === 'connected') {
          setStatus('connected');
          clearInterval(interval);

          // Уведомить родительский компонент
          setTimeout(() => {
            onConnected();
            onOpenChange(false);
          }, 2000);
        }
      } catch (err) {
        console.error('Error polling status:', err);
      }
    }, 3000); // Проверяем каждые 3 секунды

    // Остановить через 5 минут (QR протухает)
    setTimeout(() => clearInterval(interval), 5 * 60 * 1000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Подключить WhatsApp</DialogTitle>
          <DialogDescription>
            Номер: {phoneNumber}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {status === 'loading' && (
            <div className="flex flex-col items-center justify-center py-8 space-y-4">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Генерация QR-кода...</p>
            </div>
          )}

          {status === 'qr' && qrCode && (
            <>
              <div className="flex flex-col items-center space-y-4">
                <p className="text-sm text-muted-foreground text-center">
                  Отсканируйте QR-код в приложении WhatsApp на вашем телефоне
                </p>

                {/* QR-код как изображение */}
                <div className="p-4 bg-white rounded-lg">
                  <img
                    src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`}
                    alt="WhatsApp QR Code"
                    className="w-64 h-64"
                  />
                </div>

                <div className="text-xs text-muted-foreground space-y-1 text-center">
                  <p>1. Откройте WhatsApp на телефоне</p>
                  <p>2. Перейдите в Настройки → Связанные устройства</p>
                  <p>3. Нажмите "Связать устройство"</p>
                  <p>4. Отсканируйте этот QR-код</p>
                </div>
              </div>

              <div className="flex items-center justify-center space-x-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Ожидание подключения...</span>
              </div>
            </>
          )}

          {status === 'connected' && (
            <div className="flex flex-col items-center justify-center py-8 space-y-4">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <p className="text-lg font-semibold text-green-600">
                WhatsApp успешно подключен!
              </p>
            </div>
          )}

          {status === 'error' && (
            <div className="flex flex-col items-center justify-center py-8 space-y-4">
              <AlertCircle className="h-12 w-12 text-red-500" />
              <p className="text-sm text-red-600 text-center">{error}</p>
              <Button onClick={createInstance} variant="outline">
                Попробовать снова
              </Button>
            </div>
          )}
        </div>

        <div className="flex justify-end space-x-2">
          <Button
            onClick={() => onOpenChange(false)}
            variant="outline"
            disabled={status === 'loading'}
          >
            {status === 'connected' ? 'Готово' : 'Отмена'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
