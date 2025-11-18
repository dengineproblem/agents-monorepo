import { DialogAnalysis, FunnelStage } from '@/types/dialogAnalysis';
import { KanbanColumn } from './KanbanColumn';

const FUNNEL_STAGES: Array<{ key: FunnelStage; label: string }> = [
  { key: 'new_lead', label: 'Новый лид' },
  { key: 'not_qualified', label: 'Не квалифицирован' },
  { key: 'qualified', label: 'Квалифицирован' },
  { key: 'consultation_booked', label: 'Консультация назначена' },
  { key: 'consultation_completed', label: 'Консультация прошла' },
  { key: 'deal_closed', label: 'Сделка закрыта' },
  { key: 'deal_lost', label: 'Сделка потеряна' },
];

interface KanbanBoardProps {
  leads: DialogAnalysis[];
  onMoveCard: (leadId: string, newStage: FunnelStage) => void;
  onCardClick: (lead: DialogAnalysis) => void;
  onEdit?: (lead: DialogAnalysis) => void;
  onDelete?: (lead: DialogAnalysis) => void;
}

export function KanbanBoard({ leads, onMoveCard, onCardClick, onEdit, onDelete }: KanbanBoardProps) {
  // Deduplicate leads by id to avoid duplicate key warnings
  const uniqueLeads = Array.from(
    new Map(leads.map(lead => [lead.id, lead])).values()
  );
  
  const groupedLeads = FUNNEL_STAGES.reduce((acc, stage) => {
    acc[stage.key] = uniqueLeads.filter(lead => lead.funnel_stage === stage.key);
    return acc;
  }, {} as Record<FunnelStage, DialogAnalysis[]>);

  return (
    <div className="flex gap-4 overflow-x-auto pb-6">
      {FUNNEL_STAGES.map(stage => (
        <KanbanColumn
          key={stage.key}
          stage={stage.key}
          label={stage.label}
          leads={groupedLeads[stage.key] || []}
          onCardClick={onCardClick}
          onDrop={(leadId) => onMoveCard(leadId, stage.key)}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}





