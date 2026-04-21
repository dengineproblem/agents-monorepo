import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { StopCircle, Image, TrendingUp, X, Play, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAppContext } from '@/context/AppContext';
import { facebookApi } from '@/services/facebookApi';
import { tiktokApi } from '@/services/tiktokApi';
import { getQualifiedLeadsTotal } from '@/services/amocrmApi';
import { salesApi } from '@/services/salesApi';
import SummaryStats from '@/components/SummaryStats';
import { useDirections } from '@/hooks/useDirections';
import { formatCurrency, formatCurrencyKZT, formatNumber } from '@/utils/formatters';

interface ActiveCreative {
  id: string;
  name: string;
  thumbnail_url: string | null;
  image_url: string | null;
  video_id: string | null;
  campaign_id: string;
  campaign_name: string;
  direction_name: string | null;
  spend: number;
  leads: number;
  cpl: number;
  cpql: number;
}

export function AdStatusSection() {
  const { campaigns, campaignStats, platform, toggleCampaignStatus, dateRange, currentAdAccountId } = useAppContext();

  const [activeTab, setActiveTab] = useState<'campaigns' | 'metrics'>('campaigns');
  const [creatives, setCreatives] = useState<ActiveCreative[]>([]);
  const [creativesLoading, setCreativesLoading] = useState(false);
  const [stoppingAll, setStoppingAll] = useState(false);
  const [modal, setModal] = useState<ActiveCreative | null>(null);
  const [videoEmbed, setVideoEmbed] = useState<{ embedUrl: string; permalinkUrl: string | null } | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [roiByCampaign, setRoiByCampaign] = useState<Map<string, number>>(new Map());

  // Кэш embed данных чтобы не перегружать при повторном открытии
  const embedCache = useRef<Map<string, { embedUrl: string; permalinkUrl: string | null }>>(new Map());

  // AmoCRM
  const [amocrmQualifiedLeads, setAmocrmQualifiedLeads] = useState<number | null>(null);
  const [amocrmConfigured, setAmocrmConfigured] = useState(false);

  const storedUser = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
  const userAccountId = storedUser ? JSON.parse(storedUser).id : null;
  const directionsPlatform = platform === 'tiktok' ? 'tiktok' : 'facebook';
  const { directions } = useDirections(userAccountId, currentAdAccountId, directionsPlatform);

  const hasWhatsAppDirections = useMemo(() => {
    if (platform === 'tiktok') return false;
    return directions.some(d =>
      d.objective === 'whatsapp' ||
      d.objective === 'instagram_dm' ||
      (d.objective === 'conversions' && (d as any).conversion_channel === 'whatsapp')
    );
  }, [directions, platform]);

  const directionByCampaign = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of directions) {
      const cid = platform === 'tiktok' ? d.tiktok_campaign_id : d.fb_campaign_id;
      if (cid) map.set(cid, d.name);
    }
    return map;
  }, [directions, platform]);

  useEffect(() => {
    if (!userAccountId || platform === 'tiktok') return;
    getQualifiedLeadsTotal(userAccountId, dateRange.since, dateRange.until, currentAdAccountId || undefined)
      .then(r => { setAmocrmConfigured(r.configured); setAmocrmQualifiedLeads(r.totalQualifiedLeads); })
      .catch(() => { setAmocrmConfigured(false); setAmocrmQualifiedLeads(null); });
  }, [userAccountId, dateRange, currentAdAccountId, platform]);

  // ROI — независимо от fetchCreatives (не должен вызывать повторный fetch)
  useEffect(() => {
    if (!userAccountId) return;
    salesApi.getROIData(userAccountId, null, 30, null, currentAdAccountId || undefined, platform)
      .then(data => {
        const map = new Map<string, number>();
        for (const c of (data.campaigns || [])) {
          if (c.roi != null && c.roi !== 0) map.set(c.id, c.roi);
        }
        setRoiByCampaign(map);
      })
      .catch(() => {});
  }, [userAccountId, currentAdAccountId, platform]);

  const activeCampaigns = useMemo(() => {
    return campaigns
      .filter(c => c.status === 'ACTIVE')
      .map(c => {
        const stats = campaignStats.find(s => s.campaign_id === c.id);
        return {
          ...c,
          spend: stats?.spend || 0,
          leads: stats?.leads || 0,
          cpl: stats?.cpl || 0,
          cpql: stats?.cpql || 0,
          qualityLeads: stats?.qualityLeads || 0,
        };
      });
  }, [campaigns, campaignStats]);

  const cpqlByCampaign = useMemo(() => {
    if (platform === 'tiktok') return new Map<string, number>();
    const totalFbQualityLeads = activeCampaigns.reduce((sum, c) => sum + (c.qualityLeads || 0), 0);
    return new Map(activeCampaigns.map(c => {
      if (amocrmConfigured && amocrmQualifiedLeads != null && amocrmQualifiedLeads > 0 && totalFbQualityLeads > 0) {
        const campaignAmocrmLeads = amocrmQualifiedLeads * (c.qualityLeads / totalFbQualityLeads);
        return [c.id, campaignAmocrmLeads > 0 ? c.spend / campaignAmocrmLeads : 0];
      }
      if (hasWhatsAppDirections) return [c.id, c.cpql];
      return [c.id, 0];
    }));
  }, [activeCampaigns, amocrmConfigured, amocrmQualifiedLeads, hasWhatsAppDirections, platform]);

  const totalCpql = useMemo(() => {
    if (platform === 'tiktok') return 0;
    const totalSpend = activeCampaigns.reduce((sum, c) => sum + c.spend, 0);
    if (amocrmConfigured && amocrmQualifiedLeads != null && amocrmQualifiedLeads > 0) return totalSpend / amocrmQualifiedLeads;
    const totalFbQualityLeads = activeCampaigns.reduce((sum, c) => sum + (c.qualityLeads || 0), 0);
    if (hasWhatsAppDirections && totalFbQualityLeads > 0) return totalSpend / totalFbQualityLeads;
    return 0;
  }, [activeCampaigns, amocrmConfigured, amocrmQualifiedLeads, hasWhatsAppDirections, platform]);

  // fetchCreatives НЕ зависит от roiByCampaign — ROI берётся при рендере из state
  const fetchCreatives = useCallback(async () => {
    if (activeCampaigns.length === 0) { setCreatives([]); return; }
    setCreativesLoading(true);
    const collected: ActiveCreative[] = [];
    try {
      const campaignsToFetch = activeCampaigns.slice(0, 4);

      if (platform === 'instagram') {
        await Promise.all(campaignsToFetch.map(async (campaign) => {
          try {
            const [creatives, stats] = await Promise.all([
              facebookApi.getAdsByCampaign(campaign.id),
              facebookApi.getAdStatsByCampaign(campaign.id, dateRange),
            ]);
            // Маппинг ad_id → stat для агрегации
            const statsMap = new Map(stats.map(s => [s.ad_id, s]));
            for (const cr of creatives) {
              // Суммируем статистику по всем объявлениям одного креатива
              let spend = 0, leads = 0, qualityLeads = 0;
              for (const adId of cr.ad_ids) {
                const s = statsMap.get(adId);
                if (s) { spend += s.spend; leads += s.leads; qualityLeads += s.qualityLeads; }
              }
              collected.push({
                id: cr.creative_id,
                name: cr.name,
                thumbnail_url: cr.thumbnail_url,
                image_url: cr.image_url,
                video_id: cr.video_id,
                campaign_id: campaign.id,
                campaign_name: campaign.name,
                direction_name: directionByCampaign.get(campaign.id) || null,
                spend,
                leads,
                cpl: leads > 0 ? spend / leads : 0,
                cpql: qualityLeads > 0 ? spend / qualityLeads : 0,
              });
            }
          } catch { /* skip */ }
        }));
      } else {
        await Promise.all(campaignsToFetch.map(async (campaign) => {
          try {
            const adGroups = await tiktokApi.getAdGroupsByCampaign(campaign.id);
            const activeGroups = adGroups.filter((g: any) => g.status === 'ENABLE' || g.status === 'ACTIVE').slice(0, 5);
            await Promise.all(activeGroups.map(async (group: any) => {
              try {
                const [ads, stats] = await Promise.all([
                  tiktokApi.getAdsByAdGroup(group.id),
                  tiktokApi.getAdStatsByAdGroup(group.id, dateRange),
                ]);
                const statsMap = new Map(stats.map((s: any) => [s.ad_id, s]));
                for (const ad of ads) {
                  if (ad.status === 'ENABLE') {
                    const stat = statsMap.get(ad.id) as any;
                    collected.push({
                      id: ad.id,
                      name: ad.name,
                      thumbnail_url: null,
                      image_url: null,
                      video_id: ad.video_id || null,
                      campaign_id: campaign.id,
                      campaign_name: campaign.name,
                      direction_name: directionByCampaign.get(campaign.id) || null,
                      spend: stat?.spend || 0,
                      leads: stat?.leads || 0,
                      cpl: stat?.cpl || 0,
                      cpql: 0,
                    });
                  }
                }
              } catch { /* skip */ }
            }));
          } catch { /* skip */ }
        }));
      }
    } finally {
      collected.sort((a, b) => {
        const dirA = a.direction_name || '\uFFFF';
        const dirB = b.direction_name || '\uFFFF';
        if (dirA !== dirB) return dirA.localeCompare(dirB, 'ru');
        if (a.leads > 0 && b.leads > 0) return a.cpl - b.cpl;
        if (a.leads > 0) return -1;
        if (b.leads > 0) return 1;
        return b.spend - a.spend;
      });
      setCreatives(collected.slice(0, 20));
      setCreativesLoading(false);
    }
  // roiByCampaign намеренно исключён — берётся при рендере, не вызывает повторный fetch
  }, [activeCampaigns, platform, dateRange, directionByCampaign]);

  useEffect(() => { fetchCreatives(); }, [fetchCreatives]);

  const openModal = useCallback((creative: ActiveCreative) => {
    setModal(creative);
    if (creative.video_id && platform === 'instagram') {
      const cached = embedCache.current.get(creative.video_id);
      if (cached) {
        setVideoEmbed(cached);
        setVideoLoading(false);
        return;
      }
      setVideoEmbed(null);
      setVideoLoading(true);
      facebookApi.getVideoEmbedUrl(creative.video_id)
        .then(result => {
          if (result) embedCache.current.set(creative.video_id!, result);
          setVideoEmbed(result);
        })
        .finally(() => setVideoLoading(false));
    } else {
      setVideoEmbed(null);
      setVideoLoading(false);
    }
  }, [platform]);

  const closeModal = useCallback(() => {
    setModal(null);
    setVideoEmbed(null);
    setVideoLoading(false);
  }, []);

  const handleStopAll = async () => {
    if (activeCampaigns.length === 0) return;
    if (!window.confirm(`Остановить все ${activeCampaigns.length} активных кампаний?`)) return;
    setStoppingAll(true);
    try {
      await Promise.allSettled(activeCampaigns.map(c => toggleCampaignStatus(c.id, false)));
      toast.success('Вся реклама остановлена');
    } catch { toast.error('Ошибка при остановке рекламы'); }
    finally { setStoppingAll(false); }
  };

  const fmt = (val: number) => platform === 'tiktok' ? formatCurrencyKZT(val) : formatCurrency(val);

  const creativeGroups = useMemo(() => {
    const groups = new Map<string, ActiveCreative[]>();
    for (const c of creatives) {
      const key = c.direction_name || 'Без направления';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(c);
    }
    return groups;
  }, [creatives]);

  return (
    <>
      <Card className="mb-6 shadow-sm overflow-hidden">
        <CardContent className="p-0">

          {/* Tabs */}
          <div className="flex border-b px-4 pt-3 gap-1">
            <button
              onClick={() => setActiveTab('campaigns')}
              className={cn(
                'pb-2.5 px-1 text-sm font-medium border-b-2 transition-colors',
                activeTab === 'campaigns'
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              Активные кампании
              {activeCampaigns.length > 0 && (
                <span className={cn(
                  'ml-1.5 text-xs px-1.5 py-0.5 rounded-full',
                  activeTab === 'campaigns' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                )}>{activeCampaigns.length}</span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('metrics')}
              className={cn(
                'pb-2.5 px-1 text-sm font-medium border-b-2 transition-colors',
                activeTab === 'metrics'
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              Метрики
            </button>
          </div>

          {/* Metrics tab */}
          {activeTab === 'metrics' && (
            <div className="px-4 py-4">
              <SummaryStats />
            </div>
          )}

          {/* Active campaigns tab */}
          {activeTab === 'campaigns' && <>
          <div className="px-4 pt-4 pb-3">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-sm font-semibold">Активные кампании</h3>
              {activeCampaigns.length > 0 && (
                <Badge variant="secondary" className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-xs px-1.5 py-0 h-5">
                  {activeCampaigns.length}
                </Badge>
              )}
            </div>

            {activeCampaigns.length > 0 ? (
              <div className="space-y-1.5">
                {activeCampaigns.map(campaign => {
                  const cpql = cpqlByCampaign.get(campaign.id) ?? 0;
                  const roi = roiByCampaign.get(campaign.id);
                  return (
                    <div key={campaign.id} className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-muted/50 transition-colors">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="inline-block w-2 h-2 flex-shrink-0 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 shadow-sm" />
                        <span className="text-sm truncate" title={campaign.name}>{campaign.name}</span>
                      </div>
                      <div className="flex items-center gap-3 ml-3 flex-shrink-0 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{fmt(campaign.spend)}</span>
                        <span>{formatNumber(campaign.leads)} лидов</span>
                        <span>CPL {fmt(campaign.cpl)}</span>
                        {cpql > 0 && <span className="text-purple-600 dark:text-purple-400">CPQL {fmt(cpql)}</span>}
                        {roi != null && roi !== 0 && (
                          <span className={roi >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}>
                            ROI {roi > 0 ? '+' : ''}{roi.toFixed(0)}%
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-2">Нет активных кампаний</p>
            )}

            {totalCpql > 0 && (
              <div className="mt-3 pt-3 border-t flex items-center justify-between text-xs text-muted-foreground">
                <span>Итоговый CPQL {amocrmConfigured ? '(AmoCRM)' : '(Facebook)'}</span>
                <span className="font-semibold text-purple-600 dark:text-purple-400">{formatCurrency(totalCpql)}</span>
              </div>
            )}
          </div>

          {/* Active creatives grouped by direction */}
          {(creativesLoading || creatives.length > 0) && (
            <div className="px-4 pb-4 border-t pt-3">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-semibold">Активные креативы</h3>
                {creatives.length > 0 && (
                  <Badge variant="secondary" className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 text-xs px-1.5 py-0 h-5">
                    {creatives.length}
                  </Badge>
                )}
              </div>

              {creativesLoading ? (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {[1, 2, 3, 4, 5].map(i => (
                    <div key={i} className="flex-shrink-0 w-[88px] rounded-lg bg-muted animate-pulse h-[140px]" />
                  ))}
                </div>
              ) : (
                <div
                  className="grid gap-4 items-start"
                  style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
                >
                  {Array.from(creativeGroups.entries()).map(([directionName, groupCreatives]) => (
                    <div key={directionName}>
                      <p className="text-xs text-muted-foreground font-medium mb-2">{directionName}</p>
                      <div className="flex flex-wrap gap-2 pb-1">
                        {groupCreatives.map((creative, index) => {
                          const roi = roiByCampaign.get(creative.campaign_id);
                          return (
                            <div
                              key={creative.id}
                              className="flex-shrink-0 w-[88px] rounded-lg overflow-hidden bg-muted border border-border flex flex-col cursor-pointer hover:border-primary/50 hover:shadow-md transition-all"
                              onClick={() => openModal(creative)}
                            >
                              <div className="relative">
                                <div className="w-full h-[80px] overflow-hidden bg-muted">
                                  {creative.thumbnail_url ? (
                                    <img
                                      src={creative.thumbnail_url}
                                      alt={creative.name}
                                      className="w-full h-full object-cover"
                                      loading="lazy"
                                      onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                    />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                      <Image className="h-6 w-6 text-muted-foreground/40" />
                                    </div>
                                  )}
                                </div>
                                {creative.video_id && (
                                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                    <div className="bg-black/50 rounded-full p-1">
                                      <Play className="h-3.5 w-3.5 text-white fill-white" />
                                    </div>
                                  </div>
                                )}
                                {index < 3 && creative.leads > 0 && (
                                  <span className={`absolute top-1 left-1 text-[10px] font-bold px-1 py-0.5 rounded ${
                                    index === 0 ? 'bg-yellow-400 text-yellow-900'
                                    : index === 1 ? 'bg-gray-300 text-gray-700'
                                    : 'bg-amber-600 text-amber-100'
                                  }`}>#{index + 1}</span>
                                )}
                              </div>

                              <div className="p-1.5 space-y-0.5">
                                <div className="text-[10px] font-medium text-foreground leading-tight truncate" title={creative.name}>
                                  {creative.name}
                                </div>
                                <div className="text-[10px] font-semibold text-foreground leading-tight">
                                  {fmt(creative.spend)}
                                </div>
                                <div className="text-[10px] text-muted-foreground leading-tight">
                                  {formatNumber(creative.leads)} лидов
                                </div>
                                {creative.cpl > 0 && (
                                  <div className="text-[10px] text-muted-foreground leading-tight">CPL {fmt(creative.cpl)}</div>
                                )}
                                {creative.cpql > 0 && (
                                  <div className="text-[10px] text-purple-600 dark:text-purple-400 leading-tight">CPQL {fmt(creative.cpql)}</div>
                                )}
                                {roi != null && roi !== 0 && (
                                  <div className={`text-[10px] leading-tight flex items-center gap-0.5 ${roi >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
                                    <TrendingUp className="h-2.5 w-2.5" />
                                    {roi > 0 ? '+' : ''}{roi.toFixed(0)}%
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Stop all */}
          {activeCampaigns.length > 0 && (
            <div className="px-4 py-3 border-t flex justify-end">
              <Button
                variant="destructive"
                size="sm"
                className="gap-1.5 h-8 dark:bg-destructive/20 dark:text-red-400 dark:border dark:border-red-800 dark:hover:bg-destructive/30"
                onClick={handleStopAll}
                disabled={stoppingAll}
              >
                <StopCircle className="h-3.5 w-3.5" />
                {stoppingAll ? 'Останавливаем...' : 'Остановить всю рекламу'}
              </Button>
            </div>
          )}
          </>}
        </CardContent>
      </Card>

      {/* Creative modal — fullscreen on mobile, centered on desktop */}
      {modal && (
        <Dialog open onOpenChange={closeModal}>
          {/* [&>button]:hidden — скрывает встроенный крестик DialogContent, используем свой */}
          <DialogContent className="p-0 overflow-hidden bg-black gap-0 w-full max-w-full sm:max-w-lg sm:rounded-lg rounded-none border-0 sm:border translate-y-0 top-0 sm:top-[50%] sm:translate-y-[-50%] h-screen sm:h-auto [&>button]:hidden">
            {/* Close button */}
            <button
              className="absolute top-3 right-3 z-20 text-white/80 hover:text-white bg-black/50 rounded-full p-1.5"
              onClick={closeModal}
            >
              <X className="h-5 w-5" />
            </button>

            {/* Media area */}
            <div className="flex items-center justify-center bg-black" style={{ minHeight: modal.video_id ? undefined : '200px' }}>
              {modal.video_id ? (
                videoLoading ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="h-8 w-8 text-white animate-spin" />
                  </div>
                ) : videoEmbed ? (
                  // iOS Safari блокирует third-party cookies в iframe → на мобиле открываем в новой вкладке
                  /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ? (
                    <div className="flex flex-col items-center gap-4 py-10 px-6 w-full">
                      {modal.thumbnail_url && (
                        <img
                          src={modal.thumbnail_url}
                          alt={modal.name}
                          className="w-full rounded-lg object-cover"
                          style={{ maxHeight: '50vh' }}
                        />
                      )}
                      <a
                        href={videoEmbed.permalinkUrl || videoEmbed.embedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 bg-white text-black font-medium text-sm px-5 py-2.5 rounded-full"
                      >
                        <Play className="h-4 w-4 fill-black" />
                        Смотреть видео
                      </a>
                    </div>
                  ) : (
                    // Десктоп — iframe работает
                    <div className="w-full" style={{ aspectRatio: '9/16', maxHeight: 'calc(100vh - 80px)' }}>
                      <iframe
                        key={modal.id}
                        src={videoEmbed.embedUrl}
                        className="w-full h-full"
                        style={{ border: 'none' }}
                        allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media"
                        allowFullScreen
                        scrolling="no"
                      />
                    </div>
                  )
                ) : (
                  <img src={modal.thumbnail_url || ''} alt={modal.name} className="max-w-full max-h-[60vh] object-contain" />
                )
              ) : (
                <img
                  src={modal.image_url || modal.thumbnail_url || ''}
                  alt={modal.name}
                  className="max-w-full max-h-[70vh] sm:max-h-[60vh] object-contain"
                />
              )}
            </div>

            {/* Info bar */}
            <div className="bg-background px-4 py-3 pb-safe">
              <p className="text-sm font-medium truncate">{modal.name}</p>
              <p className="text-xs text-muted-foreground">{modal.direction_name || modal.campaign_name}</p>
              <div className="flex flex-wrap gap-3 mt-1 text-xs text-muted-foreground">
                <span>{fmt(modal.spend)}</span>
                <span>{formatNumber(modal.leads)} лидов</span>
                {modal.cpl > 0 && <span>CPL {fmt(modal.cpl)}</span>}
                {modal.cpql > 0 && <span className="text-purple-600 dark:text-purple-400">CPQL {fmt(modal.cpql)}</span>}
                {(() => { const roi = roiByCampaign.get(modal.campaign_id); return roi != null && roi !== 0 ? (
                  <span className={roi >= 0 ? 'text-emerald-600' : 'text-red-500'}>
                    ROI {roi > 0 ? '+' : ''}{roi.toFixed(0)}%
                  </span>
                ) : null; })()}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
