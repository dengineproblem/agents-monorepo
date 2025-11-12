import { DialogAnalysis, FunnelStage } from '@/types/dialogAnalysis';
import { LeadCard } from './LeadCard';
import { useDrop } from 'react-dnd';
import { Badge } from '@/components/ui/badge';

interface KanbanColumnProps {
  stage: FunnelStage;
  label: string;
  leads: DialogAnalysis[];
  onCardClick: (lead: DialogAnalysis) => void;
  onDrop: (leadId: string) => void;
  onEdit?: (lead: DialogAnalysis) => void;
  onDelete?: (lead: DialogAnalysis) => void;
}

export function KanbanColumn({ 
  label, 
  leads, 
  onCardClick, 
  onDrop,
  onEdit,
  onDelete,
}: KanbanColumnProps) {
  const [{ isOver, canDrop }, drop] = useDrop({
    accept: 'LEAD_CARD',
    drop: (item: { id: string }) => onDrop(item.id),
    collect: (monitor) => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop(),
    }),
  });

  return (
    <div
      ref={drop}
      className={`flex-shrink-0 w-64 transition-all ${
        isOver && canDrop ? 'opacity-80' : ''
      }`}
    >
      <div className="h-full flex flex-col">
        {/* Minimal header */}
        <div className="pb-1.5 mb-2">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-xs text-muted-foreground uppercase tracking-wider">{label}</h3>
            <Badge variant="outline" className="text-xs h-5 px-1.5">
              {leads.length}
            </Badge>
          </div>
        </div>
        
        {/* Cards - minimal spacing */}
        <div className="space-y-1.5 overflow-y-auto flex-1">
          {leads.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-xs">
              Пусто
            </div>
          )}
          {leads.map(lead => (
            <LeadCard
              key={lead.id}
              lead={lead}
              onClick={() => onCardClick(lead)}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      </div>
    </div>
  );
}



