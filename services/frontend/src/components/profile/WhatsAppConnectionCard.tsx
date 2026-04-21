import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Smartphone, MessageSquare, Loader2, Plus, X, PhoneOff, Cloud, QrCode, CheckCircle2, Tag } from 'lucide-react';
import { useWhatsAppNumbers } from '@/hooks/useWhatsAppNumbers';
import { whatsappApi } from '@/services/whatsappApi';
import { WhatsAppQRDialog } from './WhatsAppQRDialog';
import { WhatsAppLabelsDialog } from './WhatsAppLabelsDialog';
import { isUserAdmin } from '@/components/AdminRoute';
import { API_BASE_URL } from '@/config/api';

interface WhatsAppConnectionCardProps {
  userAccountId: string | null;
  accountId?: string;  // UUID из ad_accounts.id для мультиаккаунтности
}

export const WhatsAppConnectionCard: React.FC<WhatsAppConnectionCardProps> = ({
  userAccountId,
  accountId,
}) => {
  const { numbers, loading, error, refresh } = useWhatsAppNumbers(userAccountId, accountId);

  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [labelsDialogOpen, setLabelsDialogOpen] = useState(false);
  const [wwebjsLabelConfigured, setWwebjsLabelConfigured] = useState(false);
  const isAdmin = isUserAdmin();

  const checkLabelConfig = useCallback(async () => {
    if (!userAccountId) return;
    try {
      const res = await fetch(`${API_BASE_URL}/user/profile`, {
        headers: { 'x-user-id': userAccountId },
      });
      if (res.ok) {
        const data = await res.json();
        setWwebjsLabelConfigured(!!data?.wwebjs_label_id_lead || !!data?.wwebjs_label_id);
      }
    } catch { /* ignore */ }
  }, [userAccountId]);

  useEffect(() => {
    checkLabelConfig();
  }, [checkLabelConfig]);

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

  const handleResetConnection = async (numberId: string) => {
    if (!userAccountId) return;

    try {
      await whatsappApi.resetConnection(numberId, userAccountId);
      refresh(); // Обновить список после сброса
    } catch (error) {
      console.error('Failed to reset WhatsApp connection:', error);
      alert('Не удалось сбросить подключение. Попробуйте позже.');
    }
  };

  const handleDeleteWaba = async (numberId: string) => {
    if (!confirm('Вы уверены, что хотите удалить этот WABA номер? Все связанные данные будут удалены.')) {
      return;
    }

    if (!userAccountId) return;

    try {
      await whatsappApi.deleteWabaNumber(numberId, userAccountId);
      refresh(); // Обновить список после удаления
    } catch (error) {
      console.error('Failed to delete WABA number:', error);
      alert('Не удалось удалить WABA номер. Попробуйте позже.');
    }
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
            <div className="space-y-2">
              {numbers.map((number) => {
                const isWaba = number.connection_type === 'waba';
                const isConnected = isWaba || number.connection_status === 'connected';
                const isConnecting = !isWaba && number.connection_status === 'connecting';

                return (
                  <div
                    key={number.id}
                    className="flex items-center justify-between p-3 border border-muted rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex-shrink-0 w-5 flex justify-center">
                        {isConnected ? (
                          isWaba ? (
                            <Cloud className="h-5 w-5 text-blue-500" />
                          ) : (
                            <Smartphone className="h-5 w-5 text-green-500" />
                          )
                        ) : (
                          <PhoneOff className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">{number.phone_number}</p>
                          {isWaba && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                              WABA
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {isWaba ? 'Meta Cloud API' : number.label || 'Evolution API'}
                        </p>
                      </div>
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (isWaba) {
                          handleDeleteWaba(number.id);
                        } else if (isConnected) {
                          handleDisconnect(number.instance_name!);
                        } else if (isConnecting) {
                          handleResetConnection(number.id);
                        } else {
                          handleConnect(number.id, number.phone_number);
                        }
                      }}
                    >
                      {isConnected || isWaba ? (
                        <>
                          <X className="h-4 w-4 mr-1" />
                          Отключить
                        </>
                      ) : isConnecting ? (
                        <>
                          <X className="h-4 w-4 mr-1" />
                          Отменить
                        </>
                      ) : (
                        <>
                          <Plus className="h-4 w-4 mr-1" />
                          Подключить
                        </>
                      )}
                    </Button>
                  </div>
                );
              })}

              {/* Авто-ярлыки — только для техадминов */}
              {isAdmin && (
                <div className="flex items-center justify-between p-3 border border-muted rounded-lg hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="flex-shrink-0 w-5 flex justify-center">
                      {wwebjsLabelConfigured ? (
                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                      ) : (
                        <Tag className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-medium">Авто-ярлыки</p>
                      <p className="text-xs text-muted-foreground">
                        {wwebjsLabelConfigured
                          ? 'Ярлыки проставляются каждую ночь в 03:00'
                          : 'Простановка ярлыков квалифицированным лидам'}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setLabelsDialogOpen(true)}
                  >
                    <Tag className="h-4 w-4 mr-1" />
                    {wwebjsLabelConfigured ? 'Изменить' : 'Настроить'}
                  </Button>
                </div>
              )}
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
          accountId={accountId}
          onConnected={handleConnected}
        />
      )}

      {/* Диалог настройки ярлыков */}
      {userAccountId && (
        <WhatsAppLabelsDialog
          open={labelsDialogOpen}
          onOpenChange={setLabelsDialogOpen}
          userAccountId={userAccountId}
          isConfigured={wwebjsLabelConfigured}
          onConfigured={() => {
            setWwebjsLabelConfigured(true);
          }}
          onReset={() => {
            setWwebjsLabelConfigured(false);
          }}
        />
      )}
    </>
  );
};
