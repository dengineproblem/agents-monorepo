import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Activity, Plus, Pencil, Trash2, MessageCircle, FileText, Globe } from 'lucide-react';
import { toast } from 'sonner';
import { capiSettingsApi, type CapiSettingsRecord, type CapiChannel, CHANNEL_LABELS } from '@/services/capiSettingsApi';
import CapiWizard from './CapiWizard';

interface CapiSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: CapiSettingsRecord[];
  userAccountId: string;
  accountId: string | null;
  amocrmConnected: boolean;
  bitrix24Connected: boolean;
  onSettingsChanged: () => void;
}

const CHANNEL_ICONS: Record<CapiChannel, React.ReactNode> = {
  whatsapp: <MessageCircle className="h-4 w-4" />,
  lead_forms: <FileText className="h-4 w-4" />,
  site: <Globe className="h-4 w-4" />,
};

const SOURCE_LABELS: Record<string, string> = {
  whatsapp: 'AI анализ переписок',
  crm: 'CRM',
};

const CapiSettingsModal: React.FC<CapiSettingsModalProps> = ({
  open,
  onOpenChange,
  settings,
  userAccountId,
  accountId,
  amocrmConnected,
  bitrix24Connected,
  onSettingsChanged,
}) => {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingSettings, setEditingSettings] = useState<CapiSettingsRecord | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const hasCrm = amocrmConnected || bitrix24Connected;

  const configuredChannels = settings.map(s => s.channel);
  const availableChannels: CapiChannel[] = (['whatsapp', 'lead_forms', 'site'] as CapiChannel[])
    .filter(ch => !configuredChannels.includes(ch));

  const handleAddChannel = () => {
    setEditingSettings(null);
    setWizardOpen(true);
  };

  const handleEdit = (setting: CapiSettingsRecord) => {
    setEditingSettings(setting);
    setWizardOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить настройки CAPI для этого канала?')) return;
    setDeletingId(id);
    try {
      await capiSettingsApi.delete(id);
      toast.success('Настройки CAPI удалены');
      onSettingsChanged();
    } catch (error: any) {
      toast.error(error.message || 'Ошибка удаления');
    } finally {
      setDeletingId(null);
    }
  };

  const handleWizardComplete = () => {
    setWizardOpen(false);
    setEditingSettings(null);
    onSettingsChanged();
  };

  if (wizardOpen) {
    return (
      <CapiWizard
        open={true}
        onOpenChange={(open) => {
          if (!open) {
            setWizardOpen(false);
            setEditingSettings(null);
          }
        }}
        editingSettings={editingSettings}
        userAccountId={userAccountId}
        accountId={accountId}
        amocrmConnected={amocrmConnected}
        bitrix24Connected={bitrix24Connected}
        availableChannels={editingSettings ? [editingSettings.channel] : availableChannels}
        onComplete={handleWizardComplete}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Meta CAPI
          </DialogTitle>
          <DialogDescription>
            Настройки отправки конверсий в Meta Conversions API
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {settings.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Activity className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">Нет настроенных каналов</p>
              <p className="text-xs mt-1">Добавьте канал для отправки конверсий в Meta</p>
            </div>
          ) : (
            settings.map((setting) => (
              <Card key={setting.id} className="border-muted">
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 flex items-center justify-center">
                      {CHANNEL_ICONS[setting.channel]}
                    </div>
                    <div>
                      <div className="font-medium text-sm">{CHANNEL_LABELS[setting.channel]}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2">
                        <span>Pixel: {setting.pixel_id}</span>
                        <span className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-[10px]">
                          {SOURCE_LABELS[setting.capi_source] || setting.capi_source}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => handleEdit(setting)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-red-500 hover:text-red-700"
                      onClick={() => handleDelete(setting.id)}
                      disabled={deletingId === setting.id}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}

          {availableChannels.length > 0 && (
            <Button
              variant="outline"
              className="w-full"
              onClick={handleAddChannel}
            >
              <Plus className="h-4 w-4 mr-2" />
              Добавить канал
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CapiSettingsModal;
