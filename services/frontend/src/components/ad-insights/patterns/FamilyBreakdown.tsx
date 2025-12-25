/**
 * FamilyBreakdown - Breakdown аномалий по result_family
 *
 * Показывает распределение аномалий по семействам результатов:
 * messages, leadgen_form, website_lead, purchase, click, etc.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { MessageSquare, FileText, Globe, ShoppingCart, MousePointer, Video, Smartphone } from 'lucide-react';
import type { FamilyBreakdownItem } from '@/types/adInsights';

interface FamilyBreakdownProps {
  breakdown: FamilyBreakdownItem[];
  totalAnomalies: number;
  isLoading?: boolean;
}

// Иконки и цвета для семейств
const FAMILY_CONFIG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  messages: { icon: MessageSquare, color: 'bg-blue-500', label: 'Messages' },
  leadgen_form: { icon: FileText, color: 'bg-green-500', label: 'Lead Forms' },
  website_lead: { icon: Globe, color: 'bg-purple-500', label: 'Website Leads' },
  purchase: { icon: ShoppingCart, color: 'bg-amber-500', label: 'Purchases' },
  click: { icon: MousePointer, color: 'bg-cyan-500', label: 'Clicks' },
  video_view: { icon: Video, color: 'bg-pink-500', label: 'Video Views' },
  app_install: { icon: Smartphone, color: 'bg-indigo-500', label: 'App Installs' },
  unknown: { icon: FileText, color: 'bg-gray-500', label: 'Unknown' },
};

export function FamilyBreakdown({
  breakdown,
  totalAnomalies,
  isLoading,
}: FamilyBreakdownProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">По типу результата</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[150px] flex items-center justify-center text-muted-foreground">
            Загрузка...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (breakdown.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">По типу результата</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[150px] flex items-center justify-center text-muted-foreground">
            Нет данных
          </div>
        </CardContent>
      </Card>
    );
  }

  // Сортируем по количеству аномалий
  const sorted = [...breakdown].sort((a, b) => b.anomaly_count - a.anomaly_count);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">По типу результата</CardTitle>
          <span className="text-sm text-muted-foreground">
            {sorted.length} семейств
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {sorted.map((item) => {
            const config = FAMILY_CONFIG[item.result_family] || FAMILY_CONFIG.unknown;
            const Icon = config.icon;
            const pct = totalAnomalies > 0 ? (item.anomaly_count / totalAnomalies) * 100 : 0;

            return (
              <div key={item.result_family} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-6 h-6 rounded flex items-center justify-center ${config.color}`}>
                      <Icon className="w-3.5 h-3.5 text-white" />
                    </div>
                    <span className="text-sm font-medium">{config.label}</span>
                  </div>
                  <div className="text-sm">
                    <span className="font-medium">{item.anomaly_count}</span>
                    <span className="text-muted-foreground"> ({pct.toFixed(0)}%)</span>
                  </div>
                </div>
                <Progress value={pct} className="h-1.5" />
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
