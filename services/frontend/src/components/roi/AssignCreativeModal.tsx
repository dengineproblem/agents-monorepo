import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Video, Image, Images, Search, Check } from 'lucide-react';
import { salesApi } from '@/services/salesApi';
import { cn } from '@/lib/utils';

interface Creative {
  id: string;
  title: string;
  media_type: 'video' | 'image' | 'carousel';
  direction_name?: string;
}

interface AssignCreativeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAssigned: () => void;
  leadId: string;
  leadPhone: string;
  userAccountId: string;
  directionId: string | null;
}

const MediaIcon: React.FC<{ type: string; className?: string }> = ({ type, className }) => {
  switch (type) {
    case 'video':
      return <Video className={className} />;
    case 'image':
      return <Image className={className} />;
    case 'carousel':
      return <Images className={className} />;
    default:
      return null;
  }
};

export const AssignCreativeModal: React.FC<AssignCreativeModalProps> = ({
  isOpen,
  onClose,
  onAssigned,
  leadId,
  leadPhone,
  userAccountId,
  directionId
}) => {
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedCreativeId, setSelectedCreativeId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && userAccountId) {
      loadCreatives();
    }
  }, [isOpen, userAccountId]);

  const loadCreatives = async () => {
    setLoading(true);
    try {
      const { data, error } = await salesApi.getCreativesForAssignment(userAccountId, directionId);
      if (!error && data) {
        setCreatives(data);
      }
    } catch (e) {
      console.error('Error loading creatives:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleAssign = async () => {
    if (!selectedCreativeId) return;

    setSaving(true);
    try {
      const { error } = await salesApi.assignCreativeToLead(leadId, selectedCreativeId);
      if (!error) {
        onAssigned();
      } else {
        console.error('Error assigning creative:', error);
      }
    } catch (e) {
      console.error('Error assigning creative:', e);
    } finally {
      setSaving(false);
    }
  };

  const filteredCreatives = creatives.filter(c =>
    c.title.toLowerCase().includes(search.toLowerCase()) ||
    c.direction_name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Привязать креатив к лиду</DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Лид: {leadPhone}
          </p>
        </DialogHeader>

        {/* Поиск */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по названию креатива..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Список креативов */}
        <ScrollArea className="h-[300px] border rounded-md">
          {loading ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              Загрузка...
            </div>
          ) : filteredCreatives.length === 0 ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              {search ? 'Ничего не найдено' : 'Нет доступных креативов'}
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {filteredCreatives.map((creative) => (
                <button
                  key={creative.id}
                  className={cn(
                    'w-full flex items-center gap-3 p-2 rounded-md text-left transition-colors',
                    selectedCreativeId === creative.id
                      ? 'bg-primary/10 border border-primary'
                      : 'hover:bg-muted border border-transparent'
                  )}
                  onClick={() => setSelectedCreativeId(creative.id)}
                >
                  {/* Иконка типа медиа */}
                  <div className="w-10 h-10 bg-muted rounded flex items-center justify-center flex-shrink-0">
                    <MediaIcon type={creative.media_type} className="h-5 w-5 text-muted-foreground" />
                  </div>

                  {/* Название и направление */}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{creative.title}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2">
                      <span className="capitalize">{creative.media_type}</span>
                      {creative.direction_name && (
                        <>
                          <span>•</span>
                          <span>{creative.direction_name}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Галочка выбора */}
                  {selectedCreativeId === creative.id && (
                    <Check className="h-4 w-4 text-primary flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>
          )}
        </ScrollArea>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Отмена
          </Button>
          <Button
            onClick={handleAssign}
            disabled={!selectedCreativeId || saving}
          >
            {saving ? 'Сохранение...' : 'Привязать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AssignCreativeModal;
