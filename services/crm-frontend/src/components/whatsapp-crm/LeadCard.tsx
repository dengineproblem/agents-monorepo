import { DialogAnalysis } from '@/types/dialogAnalysis';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useDrag } from 'react-dnd';
import { 
  MoreVertical,
  TrendingUp
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface LeadCardProps {
  lead: DialogAnalysis;
  onClick: () => void;
  onEdit?: (lead: DialogAnalysis) => void;
  onDelete?: (lead: DialogAnalysis) => void;
}

export function LeadCard({ lead, onClick, onEdit, onDelete }: LeadCardProps) {
  const [{ isDragging }, drag] = useDrag({
    type: 'LEAD_CARD',
    item: { id: lead.id },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  const getInterestVariant = () => {
    switch (lead.interest_level) {
      case 'hot': return 'destructive';
      case 'warm': return 'default';
      case 'cold': return 'secondary';
      default: return 'outline';
    }
  };

  const getInterestColor = () => {
    switch (lead.interest_level) {
      case 'hot': return 'border-l-4 border-l-red-500';
      case 'warm': return 'border-l-4 border-l-orange-500';
      case 'cold': return 'border-l-4 border-l-blue-500';
      default: return 'border-l-4 border-l-gray-300';
    }
  };

  const getInterestLabel = () => {
    switch (lead.interest_level) {
      case 'hot': return '🔥';
      case 'warm': return '☀️';
      case 'cold': return '❄️';
      default: return '—';
    }
  };

  // Check if contact name is valid (not empty and not same as phone)
  const hasValidName = lead.contact_name && lead.contact_name !== lead.contact_phone && lead.contact_name.toLowerCase() !== 'без имени';

  return (
    <Card
      ref={drag}
      onClick={onClick}
      className={`cursor-pointer transition-all border-l-2 ${
        isDragging ? 'opacity-50' : 'hover:shadow-md'
      } ${getInterestColor()}`}
    >
      <div className="p-1.5">
        {/* Top: Badge + Actions */}
        <div className="flex items-center justify-between mb-0.5">
          <Badge variant={getInterestVariant()} className="text-[10px] px-1 py-0 h-4">
            {getInterestLabel()} {lead.score ?? '—'}
          </Badge>

          {/* Actions Menu */}
          {(onEdit || onDelete) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon" className="h-5 w-5">
                  <MoreVertical className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onEdit && (
                  <DropdownMenuItem onClick={(e) => {
                    e.stopPropagation();
                    onEdit(lead);
                  }}>
                    <TrendingUp className="mr-2 h-4 w-4" />
                    Редактировать
                  </DropdownMenuItem>
                )}
                {onDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem 
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(lead);
                      }}
                      className="text-red-600"
                    >
                      <span className="mr-2">🗑️</span>
                      Удалить
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Contact Info */}
        <div className="mb-0.5">
          {hasValidName ? (
            <>
              <div className="font-semibold text-[10px] truncate">{lead.contact_name}</div>
              <div className="text-[9px] text-muted-foreground truncate">
                {lead.contact_phone}
              </div>
            </>
          ) : (
            <div className="font-medium text-[10px] truncate">
              {lead.contact_phone}
            </div>
          )}
        </div>

        {/* Tags */}
        {lead.lead_tags && lead.lead_tags.length > 0 && (
          <div className="flex flex-wrap gap-0.5 mb-0.5">
            {lead.lead_tags.slice(0, 2).map((tag, index) => (
              <Badge 
                key={index} 
                variant="secondary" 
                className="text-[8px] px-1 py-0 h-3 font-normal leading-none"
              >
                {tag}
              </Badge>
            ))}
            {lead.lead_tags.length > 2 && (
              <Badge variant="secondary" className="text-[8px] px-1 py-0 h-3 font-normal leading-none">
                +{lead.lead_tags.length - 2}
              </Badge>
            )}
          </div>
        )}

        {/* Time */}
        {lead.last_message && (
          <div className="text-[8px] text-muted-foreground border-t pt-0.5">
            {formatDistanceToNow(new Date(lead.last_message), {
              addSuffix: true,
              locale: ru,
            })}
          </div>
        )}
      </div>
    </Card>
  );
}



