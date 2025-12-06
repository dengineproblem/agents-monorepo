import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Copy, CheckCircle2, ExternalLink, Globe, AlertCircle, Settings, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAppContext } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';

// Production webhook URL (always use production for external integrations)
const WEBHOOK_BASE_URL = 'https://app.performanteaiagency.com';

// UTM field options
type TildaUtmField = 'utm_source' | 'utm_medium' | 'utm_campaign';

const UTM_FIELD_OPTIONS: { value: TildaUtmField; label: string }[] = [
  { value: 'utm_source', label: 'utm_source' },
  { value: 'utm_medium', label: 'utm_medium' },
  { value: 'utm_campaign', label: 'utm_campaign' },
];

interface TildaInstructionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userAccountId: string | null;
  onSettingsSaved?: () => void;
}

export const TildaInstructionsDialog: React.FC<TildaInstructionsDialogProps> = ({
  open,
  onOpenChange,
  userAccountId,
  onSettingsSaved
}) => {
  const { multiAccountEnabled, currentAdAccountId } = useAppContext();

  const [selectedUtmField, setSelectedUtmField] = useState<TildaUtmField>('utm_medium');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load current UTM field setting when dialog opens
  useEffect(() => {
    if (!open || !userAccountId) return;

    const loadUtmField = async () => {
      setLoading(true);
      try {
        if (multiAccountEnabled && currentAdAccountId) {
          // Multi-account mode: load from ad_accounts
          const { data, error } = await supabase
            .from('ad_accounts')
            .select('tilda_utm_field')
            .eq('id', currentAdAccountId)
            .single();

          if (!error && data?.tilda_utm_field) {
            setSelectedUtmField(data.tilda_utm_field as TildaUtmField);
          }
        } else {
          // Legacy mode: load from user_accounts
          const { data, error } = await supabase
            .from('user_accounts')
            .select('tilda_utm_field')
            .eq('id', userAccountId)
            .single();

          if (!error && data?.tilda_utm_field) {
            setSelectedUtmField(data.tilda_utm_field as TildaUtmField);
          }
        }
      } catch (err) {
        console.error('Error loading tilda_utm_field:', err);
      } finally {
        setLoading(false);
      }
    };

    loadUtmField();
  }, [open, userAccountId, multiAccountEnabled, currentAdAccountId]);

  // Save UTM field setting
  const handleFieldChange = async (field: TildaUtmField) => {
    if (!userAccountId) return;

    setSaving(true);
    try {
      if (multiAccountEnabled && currentAdAccountId) {
        // Multi-account mode: save to ad_accounts
        const { error } = await supabase
          .from('ad_accounts')
          .update({ tilda_utm_field: field })
          .eq('id', currentAdAccountId);

        if (error) throw error;
      } else {
        // Legacy mode: save to user_accounts
        const { error } = await supabase
          .from('user_accounts')
          .update({ tilda_utm_field: field })
          .eq('id', userAccountId);

        if (error) throw error;
      }

      setSelectedUtmField(field);
      toast.success('Настройка сохранена');
      onSettingsSaved?.();
    } catch (err) {
      console.error('Error saving tilda_utm_field:', err);
      toast.error('Не удалось сохранить настройку');
    } finally {
      setSaving(false);
    }
  };

  // Generate webhook URL for this user (always production URL)
  const webhookUrl = userAccountId
    ? `${WEBHOOK_BASE_URL}/api/leads/${userAccountId}`
    : null;

  // Generate UTM parameter based on selected field
  const utmParameter = `${selectedUtmField}={{ad.id}}`;

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

          {/* Настройка UTM-поля */}
          <div className="border rounded-lg p-4 space-y-4">
            <div className="flex items-start gap-2">
              <Settings className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-medium">Настройка UTM-параметра</div>
                <p className="text-sm text-muted-foreground mt-1">
                  Выберите, в каком UTM-параметре вы передаёте ID рекламного объявления:
                </p>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center gap-2 ml-7 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Загрузка...
              </div>
            ) : (
              <RadioGroup
                value={selectedUtmField}
                onValueChange={(value) => handleFieldChange(value as TildaUtmField)}
                disabled={saving}
                className="ml-7 space-y-2"
              >
                {UTM_FIELD_OPTIONS.map((option) => (
                  <div key={option.value} className="flex items-center space-x-3">
                    <RadioGroupItem value={option.value} id={`utm-${option.value}`} />
                    <Label htmlFor={`utm-${option.value}`} className="cursor-pointer">
                      <code className="font-mono text-sm bg-muted px-1.5 py-0.5 rounded">{option.label}</code>
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            )}

            {saving && (
              <div className="flex items-center gap-2 ml-7 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Сохранение...
              </div>
            )}
          </div>

          {/* UTM для привязки к креативам */}
          <div className="border rounded-lg p-4 space-y-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-medium">Привязка заявок к креативам</div>
                <p className="text-sm text-muted-foreground mt-1">
                  Добавьте в Facebook Ads параметр (скопируйте и вставьте):
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 ml-7">
              <code className="flex-1 p-2 bg-muted rounded text-sm font-mono">
                {utmParameter}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard(utmParameter, 'UTM параметр')}
              >
                <Copy className="h-3 w-3" />
              </Button>
            </div>

            <p className="text-xs text-muted-foreground ml-7">
              Facebook Ads Manager → Объявление → Tracking → URL Parameters
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

// Legacy card component (kept for backwards compatibility)
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
