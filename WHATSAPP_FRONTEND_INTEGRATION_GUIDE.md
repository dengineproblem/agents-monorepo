# WhatsApp Frontend Integration - Инструкция для разработчика

## Обзор задачи

Добавить в раздел **Profile** карточку для управления WhatsApp подключениями. Пользователь должен видеть список своих WhatsApp номеров (добавленных через Directions) и иметь возможность подключить их через QR-код Evolution API.

## Архитектура и логика работы

### Источник данных

**WhatsApp номера добавляются ТОЛЬКО через Directions:**
- При создании/редактировании Direction пользователь вводит WhatsApp номер
- Номер сохраняется в таблицу `whatsapp_phone_numbers` через backend API
- В Profile отображаются ТОЛЬКО номера, которые уже привязаны к Directions

**Таблицы БД:**
```sql
whatsapp_phone_numbers:
  - id (UUID)
  - phone_number (TEXT) - формат: +77058151655
  - label (TEXT) - метка для номера
  - is_default (BOOLEAN)
  - is_active (BOOLEAN)
  - user_account_id (UUID)
  - instance_name (TEXT) - имя инстанса в Evolution API
  - connection_status (TEXT) - connecting/connected/disconnected
  - created_at (TIMESTAMP)

account_directions:
  - id (UUID)
  - name (TEXT)
  - objective (TEXT)
  - whatsapp_phone_number_id (UUID) - ссылка на whatsapp_phone_numbers.id
  - ...
```

### Workflow пользователя

1. **В Directions:** Пользователь создает направление и указывает WhatsApp номер → номер сохраняется в `whatsapp_phone_numbers`
2. **В Profile:** Пользователь видит список своих номеров и их статус подключения
3. **Подключение:** Клик на кнопку "Connect" → модальное окно с QR-кодом от Evolution API
4. **Сканирование:** Пользователь сканирует QR через WhatsApp на телефоне
5. **Готово:** Статус меняется на "Connected", номер готов к приему сообщений

## Существующие компоненты и API

### Backend API (уже готов)

**Endpoints для WhatsApp номеров:**
```typescript
GET  /api/whatsapp-numbers?userAccountId=:id
// Возвращает: Array<{
//   id: string,
//   phone_number: string,
//   label: string,
//   is_default: boolean,
//   is_active: boolean,
//   instance_name: string | null,
//   connection_status: 'connecting' | 'connected' | 'disconnected'
// }>

GET  /api/whatsapp-numbers/default?userAccountId=:id
// Возвращает дефолтный номер
```

**Endpoints для WhatsApp инстансов (Evolution API):**
```typescript
POST /api/whatsapp/instances/create
// Body: { userAccountId: string, phoneNumberId: string }
// Возвращает: {
//   instance: { instance_name: string, status: string },
//   qrcode: { base64: string, code: string, count: number }
// }

GET  /api/whatsapp/instances/:name/status
// Возвращает: { instance: { status: 'connecting' | 'connected' | 'disconnected' } }

DELETE /api/whatsapp/instances/:name
// Отключает инстанс
```

### Существующие компоненты Frontend

**Уже существует (НО НЕ ИСПОЛЬЗУЕТСЯ):**
- `services/frontend/src/components/profile/WhatsAppNumbersCard.tsx` - компонент для отображения номеров
- Компонент имеет функционал добавления/редактирования/удаления
- **НО** по новой логике добавление должно быть ТОЛЬКО через Directions

**Нужно использовать для примера:**
- `services/frontend/src/components/profile/DirectionsCard.tsx` - как работает с API и модалками
- `services/frontend/src/components/profile/ConnectionsGrid.tsx` - паттерн отображения статуса подключений
- `services/frontend/src/pages/Profile.tsx` - где размещать карточку

## Задачи для реализации

### Задача 1: Создать WhatsApp API Service

**Файл:** `services/frontend/src/services/whatsappApi.ts`

Следовать паттерну из `directionsApi.ts`:

```typescript
import { API_BASE_URL } from '@/config/api';

export interface WhatsAppNumber {
  id: string;
  phone_number: string;
  label: string;
  is_default: boolean;
  is_active: boolean;
  instance_name: string | null;
  connection_status: 'connecting' | 'connected' | 'disconnected' | null;
}

export interface WhatsAppInstanceResponse {
  instance: {
    instance_name: string;
    status: string;
  };
  qrcode: {
    base64?: string;
    code?: string;
    count: number;
  };
}

export const whatsappApi = {
  /**
   * Получить список WhatsApp номеров пользователя
   */
  async getNumbers(userAccountId: string): Promise<WhatsAppNumber[]> {
    const response = await fetch(
      `${API_BASE_URL}/api/whatsapp-numbers?userAccountId=${userAccountId}`
    );
    if (!response.ok) {
      throw new Error('Failed to fetch WhatsApp numbers');
    }
    return response.json();
  },

  /**
   * Создать WhatsApp инстанс и получить QR-код
   */
  async createInstance(
    userAccountId: string,
    phoneNumberId: string
  ): Promise<WhatsAppInstanceResponse> {
    const response = await fetch(`${API_BASE_URL}/api/whatsapp/instances/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userAccountId, phoneNumberId }),
    });
    if (!response.ok) {
      throw new Error('Failed to create WhatsApp instance');
    }
    return response.json();
  },

  /**
   * Получить статус подключения инстанса
   */
  async getInstanceStatus(instanceName: string): Promise<{ status: string }> {
    const response = await fetch(
      `${API_BASE_URL}/api/whatsapp/instances/${instanceName}/status`
    );
    if (!response.ok) {
      throw new Error('Failed to get instance status');
    }
    const data = await response.json();
    return { status: data.instance.status };
  },

  /**
   * Отключить WhatsApp инстанс
   */
  async disconnectInstance(instanceName: string): Promise<void> {
    const response = await fetch(
      `${API_BASE_URL}/api/whatsapp/instances/${instanceName}`,
      { method: 'DELETE' }
    );
    if (!response.ok) {
      throw new Error('Failed to disconnect instance');
    }
  },
};
```

---

### Задача 2: Создать custom hook для управления состоянием

**Файл:** `services/frontend/src/hooks/useWhatsAppNumbers.ts`

Следовать паттерну из `useDirections.ts`:

```typescript
import { useState, useEffect, useCallback } from 'react';
import { whatsappApi, WhatsAppNumber } from '@/services/whatsappApi';

export const useWhatsAppNumbers = (userAccountId: string | null) => {
  const [numbers, setNumbers] = useState<WhatsAppNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadNumbers = useCallback(async () => {
    if (!userAccountId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const data = await whatsappApi.getNumbers(userAccountId);
      setNumbers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load numbers');
      console.error('Error loading WhatsApp numbers:', err);
    } finally {
      setLoading(false);
    }
  }, [userAccountId]);

  useEffect(() => {
    loadNumbers();
  }, [loadNumbers]);

  return {
    numbers,
    loading,
    error,
    refresh: loadNumbers,
  };
};
```

---

### Задача 3: Создать компонент модального окна с QR-кодом

**Файл:** `services/frontend/src/components/profile/WhatsAppQRDialog.tsx`

Этот компонент показывает QR-код для подключения WhatsApp:

```typescript
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
  onConnected: () => void;
}

export const WhatsAppQRDialog: React.FC<WhatsAppQRDialogProps> = ({
  open,
  onOpenChange,
  userAccountId,
  phoneNumberId,
  phoneNumber,
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

      const result = await whatsappApi.createInstance(userAccountId, phoneNumberId);

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
```

---

### Задача 4: Создать карточку WhatsApp Numbers для Profile

**Файл:** `services/frontend/src/components/profile/WhatsAppConnectionCard.tsx`

Новый компонент (НЕ использовать существующий `WhatsAppNumbersCard.tsx`):

```typescript
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { CheckCircle2, Circle, MessageSquare, Plus } from 'lucide-react';
import { useWhatsAppNumbers } from '@/hooks/useWhatsAppNumbers';
import { WhatsAppQRDialog } from './WhatsAppQRDialog';
import { useTranslation } from 'react-i18next';

interface WhatsAppConnectionCardProps {
  userAccountId: string | null;
}

export const WhatsAppConnectionCard: React.FC<WhatsAppConnectionCardProps> = ({
  userAccountId,
}) => {
  const { t } = useTranslation();
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

  const handleConnected = () => {
    refresh(); // Обновить список после успешного подключения
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <MessageSquare className="h-5 w-5" />
            <span>WhatsApp Business</span>
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
          <CardTitle className="flex items-center space-x-2">
            <MessageSquare className="h-5 w-5" />
            <span>WhatsApp Business</span>
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
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <MessageSquare className="h-5 w-5" />
              <span>WhatsApp Business</span>
            </div>
            <Badge variant="secondary">{numbers.length}</Badge>
          </CardTitle>
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
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center space-x-3">
                    {number.connection_status === 'connected' ? (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    ) : (
                      <Circle className="h-5 w-5 text-muted-foreground" />
                    )}
                    <div>
                      <p className="font-medium">{number.phone_number}</p>
                      {number.label && (
                        <p className="text-sm text-muted-foreground">{number.label}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    {number.connection_status === 'connected' ? (
                      <Badge variant="default" className="bg-green-500">
                        Подключен
                      </Badge>
                    ) : number.connection_status === 'connecting' ? (
                      <Badge variant="secondary">Подключение...</Badge>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => handleConnect(number.id, number.phone_number)}
                      >
                        Подключить
                      </Button>
                    )}
                  </div>
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
```

---

### Задача 5: Добавить карточку в Profile.tsx

**Файл:** `services/frontend/src/pages/Profile.tsx`

Добавить импорт и использование нового компонента:

```typescript
// В начале файла, добавить импорт:
import { WhatsAppConnectionCard } from '@/components/profile/WhatsAppConnectionCard';

// В JSX, после DirectionsCard (около строки 900-920):
{FEATURES.SHOW_DIRECTIONS && <DirectionsCard userAccountId={user?.id || null} />}

{/* WhatsApp Connection Card */}
<WhatsAppConnectionCard userAccountId={user?.id || null} />

{/* Connections Grid */}
<ConnectionsGrid items={[...]} />
```

**Порядок карточек в Profile:**
1. TariffInfoCard
2. Telegram ID Card
3. Audience ID Card (если не App Review)
4. DirectionsCard (если включено)
5. **WhatsAppConnectionCard** ← НОВАЯ
6. ConnectionsGrid (Facebook, Instagram, TikTok)

---

## Тестирование

### Сценарий 1: Нет номеров
1. Открыть Profile
2. Увидеть карточку WhatsApp с текстом "У вас пока нет WhatsApp номеров"
3. Должна быть подсказка добавить номер через Directions

### Сценарий 2: Есть неподключенные номера
1. Создать Direction с WhatsApp номером
2. Открыть Profile
3. Увидеть карточку с номером и кнопкой "Подключить"
4. Нажать "Подключить" → открывается модалка с QR-кодом
5. QR-код отображается корректно (base64 изображение)
6. Текст инструкции понятен

### Сценарий 3: Подключение WhatsApp
1. Открыть модалку с QR-кодом
2. Отсканировать через WhatsApp на телефоне
3. Статус должен измениться на "Подключен"
4. Модалка закрывается автоматически
5. В карточке номер показывает badge "Подключен"

### Сценарий 4: Несколько номеров
1. Создать 2-3 Directions с разными WhatsApp номерами
2. Открыть Profile
3. Все номера отображаются в списке
4. Можно подключить каждый отдельно

---

## API Endpoints для справки

### Evolution API (внутренний, через backend)

```
POST /api/whatsapp/instances/create
GET  /api/whatsapp/instances
GET  /api/whatsapp/instances/:name/status
DELETE /api/whatsapp/instances/:name
```

### WhatsApp Numbers API

```
GET  /api/whatsapp-numbers?userAccountId=:id
GET  /api/whatsapp-numbers/default?userAccountId=:id
```

### Directions API

```
POST /api/directions
PUT  /api/directions/:id
DELETE /api/directions/:id
GET  /api/directions?userAccountId=:id
```

---

## Важные замечания

1. **Добавление номеров ТОЛЬКО через Directions** - не создавать UI для добавления в Profile
2. **QR-код протухает** - у Evolution API QR обновляется каждые 60 секунд, нужен polling
3. **Статус подключения** - проверять статус каждые 3 секунды после показа QR
4. **Обработка ошибок** - если QR не сгенерировался (`count: 0`), показать кнопку "Попробовать снова"
5. **Мобильная адаптация** - QR-код должен корректно отображаться на мобильных
6. **Интернационализация** - использовать `useTranslation()` для всех текстов
7. **Feature flags** - проверить нужен ли feature flag для WhatsApp (по аналогии с FEATURES.SHOW_DIRECTIONS)

---

## Файлы для создания/изменения

### Создать новые:
- ✅ `services/frontend/src/services/whatsappApi.ts`
- ✅ `services/frontend/src/hooks/useWhatsAppNumbers.ts`
- ✅ `services/frontend/src/components/profile/WhatsAppQRDialog.tsx`
- ✅ `services/frontend/src/components/profile/WhatsAppConnectionCard.tsx`

### Изменить существующие:
- ✅ `services/frontend/src/pages/Profile.tsx` (добавить WhatsAppConnectionCard)

### НЕ трогать:
- ❌ `services/frontend/src/components/profile/WhatsAppNumbersCard.tsx` (старый компонент, не использовать)

---

## Dependencies

Возможно понадобится установить:
```bash
npm install qrcode.react
# или
npm install react-qr-code
```

Для отображения QR-кода как изображения. Проверить что уже установлено в `package.json`.

---

## Дополнительная информация

- **Evolution API документация**: См. EVOLUTION_API_SETUP.md
- **Backend реализация**: См. services/agent-service/src/routes/whatsappInstances.ts
- **Database schema**: См. migrations/014_create_whatsapp_instances_table.sql

---

**Дата создания**: 29 октября 2025
**Автор**: AI Agent (Claude)
**Версия**: 1.0
