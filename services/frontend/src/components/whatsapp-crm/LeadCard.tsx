import { DialogAnalysis } from '@/types/dialogAnalysis';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useDrag } from 'react-dnd';
import { 
  Phone, 
  Building2, 
  MoreVertical,
  Calendar,
  TrendingUp,
  User,
  Briefcase,
  Bot,
  Pause
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
      case 'hot': return 'HOT';
      case 'warm': return 'WARM';
      case 'cold': return 'COLD';
      default: return '—';
    }
  };

  return (
    <Card
      ref={drag}
      onClick={onClick}
      className={`cursor-pointer hover:shadow-md transition-all ${
        isDragging ? 'opacity-50 scale-95' : ''
      } ${getInterestColor()}`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Badge variant={getInterestVariant()} className="flex-shrink-0">
              {getInterestLabel()}
            </Badge>
            <Badge variant="outline" className="flex-shrink-0">
              {lead.score ?? '—'}
            </Badge>
            {/* Bot Status Indicator */}
            {lead.assigned_to_human && (
              <div className="flex items-center" title="Менеджер в работе">
                <User className="h-4 w-4 text-orange-500" />
              </div>
            )}
            {lead.bot_paused && (
              <div className="flex items-center" title="Бот на паузе">
                <Pause className="h-4 w-4 text-gray-500" />
              </div>
            )}
            {!lead.assigned_to_human && !lead.bot_paused && (
              <div className="flex items-center" title="Бот активен">
                <Bot className="h-4 w-4 text-green-500" />
              </div>
            )}
          </div>
          
          {(onEdit || onDelete) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0">
                  <MoreVertical className="h-4 w-4" />
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

        <div className="space-y-1 mt-2">
          <h4 className="font-semibold text-base leading-tight">
            {lead.contact_name || 'Без имени'}
          </h4>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Phone className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{lead.contact_phone}</span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-2.5 pt-0">
        {/* Business Type */}
        {lead.business_type && (
          <div className="flex items-center gap-2 text-sm">
            <Building2 className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            <span className="truncate flex-1" title={lead.business_type}>
              {lead.business_type}
            </span>
            {lead.is_medical && (
              <Badge variant="secondary" className="text-xs flex-shrink-0">
                🏥
              </Badge>
            )}
          </div>
        )}

        {/* Qualification Info */}
        <div className="flex flex-wrap gap-1.5">
          {lead.is_owner && (
            <Badge variant="outline" className="text-xs">
              <User className="w-3 h-3 mr-1" />
              Владелец
            </Badge>
          )}
          {lead.uses_ads_now && (
            <Badge variant="outline" className="text-xs">
              <Briefcase className="w-3 h-3 mr-1" />
              Реклама
            </Badge>
          )}
        </div>

        {/* Last Message Time */}
        {lead.last_message && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-1 border-t">
            <Calendar className="h-3 w-3" />
            <span>
              {formatDistanceToNow(new Date(lead.last_message), {
                addSuffix: true,
                locale: ru,
              })}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
