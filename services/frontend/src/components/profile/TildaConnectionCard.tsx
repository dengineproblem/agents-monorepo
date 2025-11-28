import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Copy, CheckCircle2, ExternalLink, Globe, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

// Production webhook URL (always use production for external integrations)
const WEBHOOK_BASE_URL = 'https://app.performanteaiagency.com';

// Tilda icon SVG
const TildaIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-2-11h4v2h-4v-2zm0 4h4v2h-4v-2z"/>
  </svg>
);

interface TildaInstructionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userAccountId: string | null;
}

export const TildaInstructionsDialog: React.FC<TildaInstructionsDialogProps> = ({
  open,
  onOpenChange,
  userAccountId
}) => {
  // Generate webhook URL for this user (always production URL)
  const webhookUrl = userAccountId
    ? `${WEBHOOK_BASE_URL}/api/leads/${userAccountId}`
    : null;

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} скопирован`);
    } catch {
      toast.error('Не удалось скопировать');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Подключение сайта на Tilda</DialogTitle>
          <DialogDescription>
            Настройте отправку заявок с форм Tilda в Ai Labirint
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">

          {/* Webhook URL - главное */}
          <div className="p-4 bg-muted rounded-lg space-y-3">
            <div className="font-medium">Ваш Webhook URL для Tilda:</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 p-3 bg-background rounded-md text-sm font-mono break-all border">
                {webhookUrl || 'Загрузка...'}
              </code>
              <Button
                variant="default"
                size="sm"
                onClick={() => copyToClipboard(webhookUrl || '', 'Webhook URL')}
                disabled={!webhookUrl}
              >
                <Copy className="h-4 w-4 mr-2" />
                Копировать
              </Button>
            </div>
          </div>

          {/* Инструкция */}
          <div className="space-y-4">
            <h3 className="font-semibold">Как настроить:</h3>

            <ol className="space-y-3 text-sm list-decimal list-inside">
              <li>
                В Tilda откройте <strong>Настройки сайта</strong> → <strong>Формы</strong> → <strong>Webhook</strong>
              </li>
              <li>
                Вставьте скопированный выше URL в поле <strong>Webhook URL</strong>
              </li>
              <li>
                Включите галочку <strong>«Отправлять cookies»</strong> (для UTM-меток)
              </li>
              <li>
                На каждой странице с формой: откройте блок формы → вкладка <strong>Content</strong> → включите <strong>«Webhook»</strong>
              </li>
              <li>
                <strong>Опубликуйте</strong> все страницы с формами
              </li>
            </ol>
          </div>

          {/* UTM для привязки к креативам */}
          <div className="border rounded-lg p-4 space-y-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-medium">Привязка заявок к креативам</div>
                <p className="text-sm text-muted-foreground mt-1">
                  Чтобы заявки привязывались к рекламным объявлениям, добавьте в Facebook Ads параметр:
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 ml-7">
              <code className="flex-1 p-2 bg-muted rounded text-sm font-mono">
                utm_content={'{{ad.id}}'}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard('utm_content={{ad.id}}', 'UTM параметр')}
              >
                <Copy className="h-3 w-3" />
              </Button>
            </div>

            <p className="text-xs text-muted-foreground ml-7">
              Добавьте в Facebook Ads Manager: Объявление → Tracking → URL Parameters
            </p>
          </div>

          {/* Обязательные поля */}
          <div className="text-sm">
            <span className="font-medium">Обязательные поля формы: </span>
            <span className="text-muted-foreground">
              <code className="px-1 bg-muted rounded">Name</code> (имя) и <code className="px-1 bg-muted rounded">Phone</code> (телефон)
            </span>
          </div>

          {/* Результат */}
          <div className="flex items-start gap-2 p-3 bg-muted border rounded-lg">
            <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-muted-foreground">
              После настройки все заявки с сайта будут автоматически поступать в Ai Labirint и привязываться к креативам.
            </p>
          </div>

          {/* Ссылка на документацию */}
          <a
            href="https://help-ru.tilda.cc/webhook"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-primary hover:underline"
          >
            <ExternalLink className="h-4 w-4" />
            Документация Tilda по вебхукам
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// Legacy export for backwards compatibility
interface TildaConnectionCardProps {
  userAccountId: string | null;
}

export const TildaConnectionCard: React.FC<TildaConnectionCardProps> = ({ userAccountId }) => {
  const [instructionsOpen, setInstructionsOpen] = useState(false);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Tilda (сайт)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Подключите формы на вашем сайте Tilda для автоматического получения заявок с привязкой к рекламным креативам.
            </p>

            {userAccountId ? (
              <Button
                onClick={() => setInstructionsOpen(true)}
                className="w-full"
              >
                Инструкция по подключению
              </Button>
            ) : (
              <p className="text-sm text-yellow-600">
                Загрузка данных пользователя...
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <TildaInstructionsDialog
        open={instructionsOpen}
        onOpenChange={setInstructionsOpen}
        userAccountId={userAccountId}
      />
    </>
  );
};

export default TildaConnectionCard;
