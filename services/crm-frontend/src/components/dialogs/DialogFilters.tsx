import { DialogFilters as DialogFiltersType, InterestLevel, FunnelStage } from '@/types/dialogAnalysis';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Search, X } from 'lucide-react';

interface DialogFiltersProps {
  filters: DialogFiltersType;
  onFiltersChange: (filters: DialogFiltersType) => void;
  onReset: () => void;
}

export function DialogFilters({ filters, onFiltersChange, onReset }: DialogFiltersProps) {
  const hasActiveFilters = filters.interestLevel || filters.funnelStage || filters.search || filters.minScore;

  return (
    <div className="bg-white rounded-lg border p-4 mb-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Фильтры</h3>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={onReset}>
            <X className="w-4 h-4 mr-1" />
            Сбросить
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
          <Input
            placeholder="Поиск по телефону или имени..."
            value={filters.search || ''}
            onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
            className="pl-9"
          />
        </div>

        {/* Interest Level */}
        <Select
          value={filters.interestLevel || 'all'}
          onValueChange={(value) => 
            onFiltersChange({ 
              ...filters, 
              interestLevel: value === 'all' ? undefined : value as InterestLevel 
            })
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Уровень интереса" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все уровни</SelectItem>
            <SelectItem value="hot">🔥 HOT</SelectItem>
            <SelectItem value="warm">🌤️ WARM</SelectItem>
            <SelectItem value="cold">❄️ COLD</SelectItem>
          </SelectContent>
        </Select>

        {/* Funnel Stage */}
        <Select
          value={filters.funnelStage || 'all'}
          onValueChange={(value) => 
            onFiltersChange({ 
              ...filters, 
              funnelStage: value === 'all' ? undefined : value as FunnelStage 
            })
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Этап воронки" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все этапы</SelectItem>
            <SelectItem value="new_lead">Новый лид</SelectItem>
            <SelectItem value="not_qualified">Не квалифицирован</SelectItem>
            <SelectItem value="qualified">Квалифицирован</SelectItem>
            <SelectItem value="consultation_booked">Записан</SelectItem>
            <SelectItem value="consultation_completed">Прошел консультацию</SelectItem>
            <SelectItem value="deal_closed">Сделка закрыта</SelectItem>
            <SelectItem value="deal_lost">Сделка проиграна</SelectItem>
          </SelectContent>
        </Select>

        {/* Min Score */}
        <Input
          type="number"
          placeholder="Мин. score"
          min={0}
          max={100}
          value={filters.minScore || ''}
          onChange={(e) => 
            onFiltersChange({ 
              ...filters, 
              minScore: e.target.value ? parseInt(e.target.value) : undefined 
            })
          }
        />
      </div>
    </div>
  );
}


