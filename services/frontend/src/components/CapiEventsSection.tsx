import React, { useEffect, useState, useMemo } from 'react';
import { useAppContext } from '../context/AppContext';
import { formatCurrency, formatPercent, formatNumber } from '../utils/formatters';
import { UserPlus, UserCheck, CalendarCheck, ArrowRight, Zap, CircleDollarSign } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { HelpTooltip } from './ui/help-tooltip';
import { TooltipKeys, type TooltipKey } from '@/content/tooltips';
import { getCapiStats, type CapiStats } from '@/services/capiApi';

interface CapiEventsSectionProps {
  showTitle?: boolean;
}

interface StatCardProps {
  title: string;
  value: string;
  subValue?: string;
  icon: React.ReactNode;
  loading: boolean;
  tooltipKey?: TooltipKey;
}

const StatCard: React.FC<StatCardProps> = ({ title, value, subValue, icon, loading, tooltipKey }) => {
  return (
    <Card className="transition-all duration-200 hover:shadow-md shadow-sm">
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-2">
          <div className="p-1.5 rounded-lg bg-muted flex-shrink-0">
            {icon}
          </div>
          <div className="flex items-center gap-1 flex-1 min-w-0">
            <p className="text-xs text-muted-foreground leading-tight truncate">{title}</p>
            {tooltipKey && <HelpTooltip tooltipKey={tooltipKey} />}
          </div>
        </div>
        {loading ? (
          <div className="relative h-6 w-24 overflow-hidden rounded-md">
            <div className="absolute inset-0 bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 animate-pulse" />
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/60 to-transparent animate-shimmer" />
          </div>
        ) : (
          <div className="flex items-baseline gap-2">
            <p className="text-lg font-semibold animate-in fade-in duration-500">{value}</p>
            {subValue && (
              <p className="text-xs text-muted-foreground">{subValue}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const CapiEventsSection: React.FC<CapiEventsSectionProps> = ({ showTitle = false }) => {
  const { campaignStats, loading: contextLoading, dateRange, platform } = useAppContext();
  const [capiStats, setCapiStats] = useState<CapiStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load CAPI stats when date range changes
  useEffect(() => {
    const loadCapiStats = async () => {
      const startTime = Date.now();
      console.debug('[CapiEventsSection] Loading CAPI stats:', {
        since: dateRange.since,
        until: dateRange.until,
        platform,
      });

      setLoading(true);
      setError(null);

      try {
        const stats = await getCapiStats(dateRange.since, dateRange.until);

        if (stats) {
          setCapiStats(stats);
          console.debug('[CapiEventsSection] CAPI stats loaded:', {
            capiEnabled: stats.capiEnabled,
            lead: stats.lead,
            registration: stats.registration,
            schedule: stats.schedule,
            durationMs: Date.now() - startTime,
          });
        } else {
          // API returned null - could be user has no CAPI or error
          setCapiStats(null);
          console.debug('[CapiEventsSection] No CAPI stats returned (user may not have CAPI configured)');
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error('[CapiEventsSection] Failed to load CAPI stats:', {
          error: errorMessage,
          durationMs: Date.now() - startTime,
        });
        setCapiStats(null);
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    };

    loadCapiStats();
  }, [dateRange, platform]);

  // Calculate cost per event using total spend from campaignStats
  const calculations = useMemo(() => {
    const totalSpend = campaignStats.reduce((sum, stat) => sum + stat.spend, 0);
    const totalLeads = campaignStats.reduce((sum, stat) => sum + (stat.leads || 0), 0);

    if (!capiStats) {
      return {
        totalSpend,
        totalLeads,
        costPerLead: 0,
        costPerRegistration: 0,
        costPerSchedule: 0,
        conversionLeadsToCapiLead: 0
      };
    }

    return {
      totalSpend,
      totalLeads,
      costPerLead: capiStats.lead > 0 ? totalSpend / capiStats.lead : 0,
      costPerRegistration: capiStats.registration > 0 ? totalSpend / capiStats.registration : 0,
      costPerSchedule: capiStats.schedule > 0 ? totalSpend / capiStats.schedule : 0,
      conversionLeadsToCapiLead: totalLeads > 0 ? (capiStats.lead / totalLeads) * 100 : 0
    };
  }, [campaignStats, capiStats]);

  // Don't show for TikTok platform
  if (platform === 'tiktok') {
    console.debug('[CapiEventsSection] Hidden: TikTok platform');
    return null;
  }

  // Don't show if CAPI is not enabled for any direction
  if (!loading && capiStats && !capiStats.capiEnabled) {
    console.debug('[CapiEventsSection] Hidden: CAPI not enabled for any direction');
    return null;
  }

  // Don't show if there was an error and no cached data
  if (!loading && error && !capiStats) {
    console.debug('[CapiEventsSection] Hidden: Error loading data');
    return null;
  }

  const isLoading = loading || contextLoading;

  const content = (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
      {/* Ряд 1: Количество событий */}
      <StatCard
        title="CAPI Lead"
        value={formatNumber(capiStats?.lead ?? 0)}
        icon={<UserPlus className="w-4 h-4 text-blue-600 dark:text-blue-500/70" />}
        loading={isLoading}
        tooltipKey={TooltipKeys.CAPI_LEAD}
      />
      <StatCard
        title="CAPI Registration"
        value={formatNumber(capiStats?.registration ?? 0)}
        icon={<UserCheck className="w-4 h-4 text-green-600 dark:text-green-500/70" />}
        loading={isLoading}
        tooltipKey={TooltipKeys.CAPI_REGISTRATION}
      />
      <StatCard
        title="CAPI Schedule"
        value={formatNumber(capiStats?.schedule ?? 0)}
        icon={<CalendarCheck className="w-4 h-4 text-purple-600 dark:text-purple-500/70" />}
        loading={isLoading}
        tooltipKey={TooltipKeys.CAPI_SCHEDULE}
      />
      {/* Ряд 2: Конверсии */}
      <StatCard
        title="Лиды → CAPI Lead"
        value={formatPercent(calculations.conversionLeadsToCapiLead)}
        icon={<Zap className="w-4 h-4 text-cyan-600 dark:text-cyan-500/70" />}
        loading={isLoading}
        tooltipKey={TooltipKeys.CAPI_CONVERSION_LEADS}
      />
      <StatCard
        title="Lead → Registration"
        value={formatPercent(capiStats?.conversionL1toL2 ?? 0)}
        icon={<ArrowRight className="w-4 h-4 text-orange-600 dark:text-orange-500/70" />}
        loading={isLoading}
        tooltipKey={TooltipKeys.CAPI_CONVERSION_L1L2}
      />
      <StatCard
        title="Registration → Schedule"
        value={formatPercent(capiStats?.conversionL2toL3 ?? 0)}
        icon={<ArrowRight className="w-4 h-4 text-amber-600 dark:text-amber-500/70" />}
        loading={isLoading}
        tooltipKey={TooltipKeys.CAPI_CONVERSION_L2L3}
      />
      {/* Ряд 3: Стоимость за событие */}
      <StatCard
        title="Cost per Lead"
        value={formatCurrency(calculations.costPerLead)}
        icon={<CircleDollarSign className="w-4 h-4 text-blue-600 dark:text-blue-500/70" />}
        loading={isLoading}
        tooltipKey={TooltipKeys.CAPI_COST_LEAD}
      />
      <StatCard
        title="Cost per Registration"
        value={formatCurrency(calculations.costPerRegistration)}
        icon={<CircleDollarSign className="w-4 h-4 text-green-600 dark:text-green-500/70" />}
        loading={isLoading}
        tooltipKey={TooltipKeys.CAPI_COST_REGISTRATION}
      />
      <StatCard
        title="Cost per Schedule"
        value={formatCurrency(calculations.costPerSchedule)}
        icon={<CircleDollarSign className="w-4 h-4 text-purple-600 dark:text-purple-500/70" />}
        loading={isLoading}
        tooltipKey={TooltipKeys.CAPI_COST_SCHEDULE}
      />
    </div>
  );

  if (showTitle) {
    return (
      <Card className="mb-4">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="h-4 w-4" />
            CAPI Events
          </CardTitle>
        </CardHeader>
        <CardContent>
          {content}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2">
        <Zap className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-medium text-muted-foreground">CAPI Events</p>
      </div>
      {content}
    </div>
  );
};

export default CapiEventsSection;
