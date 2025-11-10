import { DialogAnalysis, FunnelStage } from '@/types/dialogAnalysis';
import { LeadCard } from './LeadCard';
import { useDrop } from 'react-dnd';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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
  stage, 
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

  const getColumnColor = () => {
    switch (stage) {
      case 'new_lead': return 'bg-slate-50 dark:bg-slate-900/20';
      case 'not_qualified': return 'bg-yellow-50 dark:bg-yellow-900/20';
      case 'qualified': return 'bg-green-50 dark:bg-green-900/20';
      case 'consultation_booked': return 'bg-blue-50 dark:bg-blue-900/20';
      case 'consultation_completed': return 'bg-purple-50 dark:bg-purple-900/20';
      case 'deal_closed': return 'bg-emerald-50 dark:bg-emerald-900/20';
      case 'deal_lost': return 'bg-red-50 dark:bg-red-900/20';
      default: return 'bg-muted';
    }
  };

  return (
    <div
      ref={drop}
      className={`flex-shrink-0 w-80 transition-all ${
        isOver && canDrop ? 'scale-105' : ''
      }`}
    >
      <Card className={`h-full ${getColumnColor()}`}>
        <CardHeader className="pb-3 sticky top-0 z-10 bg-card/95 backdrop-blur">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">{label}</h3>
            <Badge variant="secondary" className="ml-2">
              {leads.length}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {leads.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm border-2 border-dashed rounded-lg">
              Перетащите лида сюда
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
        </CardContent>
      </Card>
    </div>
  );
}


