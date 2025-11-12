import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DailyCampaignQueue } from '@/components/campaigns/DailyCampaignQueue';
import { ScrollArea } from '@/components/ui/scroll-area';

interface CampaignQueueModalProps {
  open: boolean;
  onClose: () => void;
}

export function CampaignQueueModal({ open, onClose }: CampaignQueueModalProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Рассылки на сегодня</DialogTitle>
        </DialogHeader>
        
        <ScrollArea className="h-[75vh] pr-4">
          <DailyCampaignQueue />
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

