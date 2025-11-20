import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Smartphone, MessageSquare, Loader2, Plus, X, PhoneOff } from 'lucide-react';
import { useWhatsAppNumbers } from '@/hooks/useWhatsAppNumbers';
import { WhatsAppQRDialog } from './WhatsAppQRDialog';

interface WhatsAppConnectionCardProps {
  userAccountId: string | null;
}

export const WhatsAppConnectionCard: React.FC<WhatsAppConnectionCardProps> = ({
  userAccountId,
}) => {
  const { numbers, loading, error, refresh } = useWhatsAppNumbers(userAccountId);

  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [selectedNumber, setSelectedNumber] = useState<{
    id: string;
    phone_number: string;
  } | null>(null);

  const handleConnect = (numberId: string, phoneNumber: string) => {
    setSelectedNumber({ id: numberId, phone_number: phoneNumber });
    setQrDialogOpen(true);
  };

  const handleDisconnect = async (instanceName: string) => {
    if (!confirm('Вы уверены, что хотите отключить этот WhatsApp номер?')) {
      return;
    }

    try {
      await whatsappApi.disconnectInstance(instanceName);
      refresh(); // Обновить список после отключения
    } catch (error) {
      console.error('Failed to disconnect WhatsApp instance:', error);
      alert('Не удалось отключить WhatsApp. Попробуйте позже.');
    }
  };

  const handleConnected = () => {
    refresh(); // Обновить список после успешного подключения
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            WhatsApp Business
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            WhatsApp Business
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-600">{error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              WhatsApp Business
            </div>
            <Badge variant="secondary">{numbers.length}</Badge>
          </CardTitle>
          <CardDescription>
            Используется для получения данных о лидах и сопоставления их с креативами
          </CardDescription>
        </CardHeader>
        <CardContent>
          {numbers.length === 0 ? (
            <div className="text-center py-8 space-y-4">
              <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground" />
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  У вас пока нет WhatsApp номеров
                </p>
                <p className="text-xs text-muted-foreground">
                  Добавьте WhatsApp номер при создании направления в разделе{' '}
                  <strong>Directions</strong>
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {numbers.map((number) => (
                <div
                  key={number.id}
                  className="flex items-center justify-between p-4 border border-muted rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center space-x-3">
                    {number.connection_status === 'connected' ? (
                      <Smartphone className="h-5 w-5 text-green-500" />
                    ) : (
                      <PhoneOff className="h-5 w-5 text-muted-foreground" />
                    )}
                    <div>
                      <p className="font-medium">{number.phone_number}</p>
                      {number.label && (
                        <p className="text-sm text-muted-foreground">{number.label}</p>
                      )}
                    </div>
                  </div>

                  <Button
                    variant={number.connection_status === 'connected' ? 'outline' : 'default'}
                    size="sm"
                    onClick={() => {
                      if (number.connection_status === 'connected') {
                        handleDisconnect(number.instance_name!);
                      } else {
                        handleConnect(number.id, number.phone_number);
                      }
                    }}
                    disabled={number.connection_status === 'connecting'}
                    className="px-2 sm:px-4"
                  >
                    {number.connection_status === 'connected' ? (
                      <>
                        <X className="h-4 w-4 sm:mr-2" />
                        <span className="hidden sm:inline">Отключить</span>
                      </>
                    ) : number.connection_status === 'connecting' ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin sm:mr-2" />
                        <span className="hidden sm:inline">Подключение...</span>
                      </>
                    ) : (
                      <>
                        <Plus className="h-4 w-4 sm:mr-2" />
                        <span className="hidden sm:inline">Подключить</span>
                      </>
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Диалог с QR-кодом */}
      {selectedNumber && userAccountId && (
        <WhatsAppQRDialog
          open={qrDialogOpen}
          onOpenChange={setQrDialogOpen}
          userAccountId={userAccountId}
          phoneNumberId={selectedNumber.id}
          phoneNumber={selectedNumber.phone_number}
          onConnected={handleConnected}
        />
      )}
    </>
  );
};
