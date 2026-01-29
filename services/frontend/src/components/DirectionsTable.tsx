import React, { useState, useEffect, useMemo } from 'react';
import { ChevronDown, ChevronRight, GripVertical, Target } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAppContext } from '@/context/AppContext';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface ParsedCampaign {
  mainDirection: string;
  subDirection: string | null;
  originalCampaign: any;
}

interface DirectionStats {
  spend: number;
  leads: number;
  messagingLeads: number; // Лиды от переписок (для расчета качества)
  qualityLeads: number;
  qualityRate: number;
  campaigns: any[];
}

interface GroupedDirections {
  [mainDirection: string]: {
    mainStats: DirectionStats;
    subDirections: {
      [subDirection: string]: DirectionStats;
    };
  };
}

// Компонент для отдельного направления с drag and drop
interface DirectionItemProps {
  mainDirection: string;
  data: GroupedDirections[string];
  isExpanded: boolean;
  onToggle: (direction: string) => void;
  formatCurrency: (amount: number) => string;
  showQuality: boolean;
}

const DirectionItem: React.FC<DirectionItemProps> = ({ 
  mainDirection, 
  data, 
  isExpanded, 
  onToggle, 
  formatCurrency,
  showQuality
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: mainDirection });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const hasSubDirections = Object.keys(data.subDirections).length > 0;

  return (
    <div 
      ref={setNodeRef} 
      style={style} 
      className={`border rounded-lg overflow-hidden ${isDragging ? 'shadow-lg' : ''}`}
    >
      {/* Главное направление */}
      <div className="p-4 bg-muted/50 hover:bg-muted/80 transition-colors">
        <div className="flex items-center justify-between">
          {/* Drag handle и название */}
          <div className="flex items-center gap-3 flex-1">
            <div 
              {...attributes}
              {...listeners}
              className="cursor-grab hover:cursor-grabbing p-1 rounded hover:bg-muted"
            >
              <GripVertical className="h-4 w-4 text-muted-foreground" />
            </div>
            <div
              className={`flex-1 ${hasSubDirections ? 'cursor-pointer' : ''}`}
              onClick={() => hasSubDirections && onToggle(mainDirection)}
            >
              <span className="font-semibold text-lg">{mainDirection}</span>
            </div>
          </div>
          
          {/* Стрелочка справа */}
          <div className="flex items-center">
            {hasSubDirections && (
              <div 
                className="cursor-pointer p-1"
                onClick={() => onToggle(mainDirection)}
              >
                {isExpanded ? 
                  <ChevronDown className="h-5 w-5 text-muted-foreground" /> :
                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                }
              </div>
            )}
          </div>
        </div>
        
        {/* Показатели под названием */}
        <div className="mt-3 grid grid-cols-4 gap-3 text-sm">
          <div>
            <div className="text-muted-foreground text-xs">Затраты</div>
            <div className="font-medium">{formatCurrency(data.mainStats.spend)}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Лиды</div>
            <div className="font-medium">{data.mainStats.leads}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">CPL</div>
            <div className="font-medium">
              {data.mainStats.leads > 0 
                ? formatCurrency(data.mainStats.spend / data.mainStats.leads)
                : '$0.00'
              }
            </div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Качество</div>
            <div className="font-medium">
              {showQuality
                ? (data.mainStats.qualityRate > 0 ? `${data.mainStats.qualityRate.toFixed(0)}%` : '0%')
                : 'н/д'}
            </div>
          </div>
        </div>
      </div>

      {/* Поднаправления */}
      {hasSubDirections && isExpanded && (
        <div className="border-t bg-background">
          {Object.entries(data.subDirections).map(([subDirection, stats]: [string, DirectionStats]) => (
            <div key={subDirection} className="p-4 border-l-4 border-l-blue-200 ml-6 hover:bg-muted/30 transition-colors">
              <div className="mb-3">
                <span className="font-medium text-base">{subDirection}</span>
              </div>
              
              {/* Показатели поднаправления */}
              <div className="grid grid-cols-4 gap-3 text-sm">
                <div>
                  <div className="text-muted-foreground text-xs">Затраты</div>
                  <div className="font-medium">{formatCurrency(stats.spend)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">Лиды</div>
                  <div className="font-medium">{stats.leads}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">CPL</div>
                  <div className="font-medium">
                    {stats.leads > 0 
                      ? formatCurrency(stats.spend / stats.leads)
                      : '$0.00'
                    }
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">Качество</div>
                  <div className="font-medium">
                    {showQuality
                      ? (stats.qualityRate > 0 ? `${stats.qualityRate.toFixed(0)}%` : '0%')
                      : 'н/д'}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const DirectionsTable: React.FC = () => {
  const { campaignStats, loading, platform } = useAppContext();
  const [expandedDirections, setExpandedDirections] = useState<Set<string>>(new Set());
  const [directionOrder, setDirectionOrder] = useState<string[]>([]);
  
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Парсинг названий кампаний
  const parseCampaignName = (campaignName: string): { mainDirection: string; subDirection: string | null } => {
    const parts = campaignName.split(' | ').map(part => part.trim());
    
    return {
      mainDirection: parts[0] || campaignName,
      subDirection: parts[1] || null
    };
  };

  // Группировка кампаний по направлениям
  const groupedDirections = useMemo((): GroupedDirections => {
    if (!campaignStats || campaignStats.length === 0) return {};

    const grouped: GroupedDirections = {};

    campaignStats.forEach(campaignStat => {
      const parsed = parseCampaignName(campaignStat.campaign_name);
      const mainKey = parsed.mainDirection;

      if (!grouped[mainKey]) {
        grouped[mainKey] = {
          mainStats: {
            spend: 0,
            leads: 0,
            messagingLeads: 0,
            qualityLeads: 0,
            qualityRate: 0,
            campaigns: []
          },
          subDirections: {}
        };
      }

      // Добавляем к общей статистике главного направления
      grouped[mainKey].mainStats.spend += campaignStat.spend || 0;
      grouped[mainKey].mainStats.leads += campaignStat.leads || 0;
      grouped[mainKey].mainStats.messagingLeads += campaignStat.messagingLeads || 0;
      grouped[mainKey].mainStats.qualityLeads += campaignStat.qualityLeads || 0;
      grouped[mainKey].mainStats.campaigns.push(campaignStat);

      // Если есть поднаправление
      if (parsed.subDirection) {
        const subKey = parsed.subDirection;
        if (!grouped[mainKey].subDirections[subKey]) {
          grouped[mainKey].subDirections[subKey] = {
            spend: 0,
            leads: 0,
            messagingLeads: 0,
            qualityLeads: 0,
            qualityRate: 0,
            campaigns: []
          };
        }
        
        grouped[mainKey].subDirections[subKey].spend += campaignStat.spend || 0;
        grouped[mainKey].subDirections[subKey].leads += campaignStat.leads || 0;
        grouped[mainKey].subDirections[subKey].messagingLeads += campaignStat.messagingLeads || 0;
        grouped[mainKey].subDirections[subKey].qualityLeads += campaignStat.qualityLeads || 0;
        grouped[mainKey].subDirections[subKey].campaigns.push(campaignStat);
      }
    });

    // Вычисляем qualityRate после агрегации - только от переписок
    Object.keys(grouped).forEach(mainKey => {
      const mainStats = grouped[mainKey].mainStats;
      // Качество считается только от переписок, не от лидформ
      mainStats.qualityRate = mainStats.messagingLeads > 0 ? (mainStats.qualityLeads / mainStats.messagingLeads) * 100 : 0;
      
      Object.keys(grouped[mainKey].subDirections).forEach(subKey => {
        const subStats = grouped[mainKey].subDirections[subKey];
        // Качество считается только от переписок, не от лидформ
        subStats.qualityRate = subStats.messagingLeads > 0 ? (subStats.qualityLeads / subStats.messagingLeads) * 100 : 0;
      });
    });

    return grouped;
  }, [campaignStats]);

  // Инициализация порядка направлений
  useEffect(() => {
    const directions = Object.keys(groupedDirections);
    if (directions.length > 0 && directionOrder.length === 0) {
      // Пытаемся загрузить сохраненный порядок
      const savedOrder = localStorage.getItem('directions-order');
      if (savedOrder) {
        try {
          const parsedOrder = JSON.parse(savedOrder);
          // Проверяем, что все направления из сохраненного порядка существуют
          const validOrder = parsedOrder.filter((dir: string) => directions.includes(dir));
          // Добавляем новые направления, которых не было в сохраненном порядке
          const newDirections = directions.filter(dir => !validOrder.includes(dir));
          const finalOrder = [...validOrder, ...newDirections];
          setDirectionOrder(finalOrder);
        } catch (error) {

          setDirectionOrder(directions);
        }
      } else {
        setDirectionOrder(directions);
      }
    }
  }, [groupedDirections, directionOrder.length]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setDirectionOrder((items) => {
        const oldIndex = items.indexOf(active.id as string);
        const newIndex = items.indexOf(over.id as string);
        const newOrder = arrayMove(items, oldIndex, newIndex);
        
        // Сохраняем новый порядок в localStorage
        localStorage.setItem('directions-order', JSON.stringify(newOrder));
        
        return newOrder;
      });
    }
  };

  const toggleDirection = (direction: string) => {
    const newExpanded = new Set(expandedDirections);
    if (newExpanded.has(direction)) {
      newExpanded.delete(direction);
    } else {
      newExpanded.add(direction);
    }
    setExpandedDirections(newExpanded);
  };

  const formatCurrency = (amount: number) => {
    if (platform === 'tiktok') {
      return new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: 'KZT',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(amount);
    }
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  if (loading) {
    return (
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Статистика по направлениям
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 animate-in fade-in duration-300">
            {[1, 2, 3].map((i) => (
              <div key={i} className="border rounded-lg overflow-hidden">
                <div className="p-4 bg-muted/50">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="h-4 w-4 bg-muted/70 rounded animate-pulse" />
                    <div className="h-6 w-40 bg-gradient-to-r from-muted via-muted/50 to-muted rounded animate-pulse" />
                  </div>
                  <div className="grid grid-cols-4 gap-3">
                    {[1, 2, 3, 4].map((j) => (
                      <div key={j} className="space-y-1">
                        <div className="h-3 w-16 bg-muted/70 rounded animate-pulse" />
                        <div className="h-5 w-20 bg-gradient-to-r from-muted via-muted/50 to-muted rounded animate-pulse" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (Object.keys(groupedDirections).length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Статистика по направлениям</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            Нет данных по кампаниям
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-5 w-5" />
          Статистика по направлениям
        </CardTitle>
      </CardHeader>
      <CardContent>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={directionOrder} strategy={verticalListSortingStrategy}>
            <div className="space-y-2 animate-in fade-in duration-500">
              {directionOrder.map((mainDirection) => {
                const data = groupedDirections[mainDirection];
                if (!data) return null;

                return (
                  <DirectionItem
                    key={mainDirection}
                    mainDirection={mainDirection}
                    data={data}
                    isExpanded={expandedDirections.has(mainDirection)}
                    onToggle={toggleDirection}
                    formatCurrency={formatCurrency}
                    showQuality={platform !== 'tiktok'}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      </CardContent>
    </Card>
  );
};

export default DirectionsTable;
