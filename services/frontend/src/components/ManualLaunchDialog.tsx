import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Rocket, Trash2, Video, Image, Images } from "lucide-react";
import { toast } from "sonner";
import {
  manualLaunchMultiAdSets,
  manualLaunchExisting,
  getDirectionActiveAdsets,
  type MultiAdSetLaunchResponse,
  type ActiveAdsetInfo,
} from "@/services/manualLaunchApi";
import { type UserCreative } from "@/services/creativesApi";
import { type LabelStats } from "@/services/directionsApi";
import { type Direction, getDirectionObjectiveLabel } from "@/types/direction";
import { API_BASE_URL } from "@/config/api";
import { getAuthHeaders } from '@/lib/apiAuth';

const FACEBOOK_MIN_DAILY_BUDGET = 5;
const TIKTOK_MIN_DAILY_BUDGET = 2500;
const OPT_GOAL_LABEL_THRESHOLD = 10; // Facebook требует минимум 10 ярлыков для разблокировки

type AdSetConfig = {
  id: string;
  creative_ids: Set<string>;
  daily_budget: number;
  optimization_goal_override?: string;
};

let adsetIdCounter = 0;
function nextAdSetId(): string {
  return `adset_${++adsetIdCounter}`;
}

type ManualLaunchDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platform: 'facebook' | 'tiktok';
  currentAdAccountId: string | null;
  labelStats?: LabelStats | null;
  onSuccess: (result: MultiAdSetLaunchResponse) => void;
} & (
  | {
      // Mode 1: preselected direction + creatives (Creatives.tsx)
      mode: 'preselected';
      direction: Direction | undefined;
      selectedCreativeIds: Set<string>;
      items: UserCreative[];
    }
  | {
      // Mode 2: standalone with direction/creative selection (VideoUpload.tsx)
      mode: 'standalone';
      directions: Direction[];
      userId: string;
    }
);

function MediaIcon({ type }: { type?: 'video' | 'image' | 'carousel' | null }) {
  if (type === 'video') return <Video className="h-3.5 w-3.5 text-muted-foreground" />;
  if (type === 'carousel') return <Images className="h-3.5 w-3.5 text-muted-foreground" />;
  return <Image className="h-3.5 w-3.5 text-muted-foreground" />;
}

export function ManualLaunchDialog(props: ManualLaunchDialogProps) {
  const { open, onOpenChange, platform, currentAdAccountId, labelStats, onSuccess } = props;

  const isTikTok = platform === 'tiktok';
  const minBudget = isTikTok ? TIKTOK_MIN_DAILY_BUDGET : FACEBOOK_MIN_DAILY_BUDGET;
  const budgetSymbol = isTikTok ? '₸' : '$';
  const budgetLabel = isTikTok ? 'KZT' : 'USD';
  const minBudgetText = isTikTok ? `${minBudget}₸` : `${budgetSymbol}${minBudget}`;

  // Standalone mode state
  const [selectedDirectionId, setSelectedDirectionId] = useState<string>('');
  const [loadedCreatives, setLoadedCreatives] = useState<UserCreative[]>([]);
  const [loadingCreatives, setLoadingCreatives] = useState(false);

  // Common state
  const [adsets, setAdsets] = useState<AdSetConfig[]>([]);
  const [startMode, setStartMode] = useState<'now' | 'midnight_almaty'>('now');
  const [isLaunching, setIsLaunching] = useState(false);

  // === Existing-adsets mode (только Facebook) ===
  // 'create' = текущее поведение (создаём новые адсеты),
  // 'existing' = добавить креативы в живые адсеты направления.
  const [launchMode, setLaunchMode] = useState<'create' | 'existing'>('create');
  const [activeAdsets, setActiveAdsets] = useState<ActiveAdsetInfo[]>([]);
  const [loadingActiveAdsets, setLoadingActiveAdsets] = useState(false);
  const [selectedAdsetIds, setSelectedAdsetIds] = useState<Set<string>>(new Set());
  const [selectedExistingCreativeIds, setSelectedExistingCreativeIds] = useState<Set<string>>(new Set());

  // Resolve direction + creatives based on mode
  const direction = props.mode === 'preselected'
    ? props.direction
    : (props.directions.find(d => d.id === selectedDirectionId) || undefined);

  const allCreatives = props.mode === 'preselected'
    ? props.items.filter(it => props.selectedCreativeIds.has(it.id))
    : loadedCreatives;

  // Load creatives when direction changes in standalone mode
  useEffect(() => {
    if (props.mode !== 'standalone') return;
    if (!selectedDirectionId || !props.userId) {
      setLoadedCreatives([]);
      return;
    }

    let cancelled = false;
    const load = async () => {
      setLoadingCreatives(true);
      try {
        const params = new URLSearchParams({ userId: props.userId!, status: 'ready' });
        const res = await fetch(`${API_BASE_URL}/user-creatives?${params}`, {
          headers: getAuthHeaders()
        });
        if (!cancelled) {
          if (!res.ok) {
            toast.error('Не удалось загрузить креативы');
            setLoadedCreatives([]);
          } else {
            const allCreatives = (await res.json()) || [];
            // Filter by direction, is_active on client
            const filtered = allCreatives.filter((c: any) =>
              c.direction_id === selectedDirectionId && c.is_active === true
            );
            setLoadedCreatives(filtered as UserCreative[]);
          }
        }
      } finally {
        if (!cancelled) setLoadingCreatives(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [props.mode, props.mode === 'standalone' ? props.userId : null, selectedDirectionId]);

  // Reset on open
  useEffect(() => {
    if (!open) return;
    if (props.mode === 'preselected') {
      setAdsets([{
        id: nextAdSetId(),
        creative_ids: new Set(props.selectedCreativeIds),
        daily_budget: minBudget,
      }]);
      setSelectedExistingCreativeIds(new Set(props.selectedCreativeIds));
    } else {
      setSelectedDirectionId('');
      setLoadedCreatives([]);
      setAdsets([{
        id: nextAdSetId(),
        creative_ids: new Set<string>(),
        daily_budget: minBudget,
      }]);
      setSelectedExistingCreativeIds(new Set<string>());
    }
    setStartMode('now');
    setLaunchMode('create');
    setActiveAdsets([]);
    setSelectedAdsetIds(new Set());
  }, [open]);

  // Загружаем активные адсеты при включении режима 'existing' и наличии направления
  useEffect(() => {
    if (isTikTok) return; // TikTok пока только в режиме создания
    if (launchMode !== 'existing') return;
    if (!direction?.id) return;

    let cancelled = false;
    const load = async () => {
      setLoadingActiveAdsets(true);
      try {
        const res = await getDirectionActiveAdsets(direction.id, currentAdAccountId || undefined);
        if (cancelled) return;
        if (res.success) {
          setActiveAdsets(res.adsets);
        } else {
          setActiveAdsets([]);
          toast.error(res.error || 'Не удалось загрузить адсеты');
        }
      } finally {
        if (!cancelled) setLoadingActiveAdsets(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [launchMode, direction?.id, currentAdAccountId, isTikTok]);

  const totalBudget = useMemo(
    () => adsets.reduce((sum, a) => sum + a.daily_budget, 0),
    [adsets]
  );

  const addAdSet = useCallback(() => {
    setAdsets(prev => [...prev, {
      id: nextAdSetId(),
      creative_ids: new Set<string>(),
      daily_budget: minBudget,
    }]);
  }, [minBudget]);

  const removeAdSet = useCallback((adsetId: string) => {
    setAdsets(prev => prev.length > 1 ? prev.filter(a => a.id !== adsetId) : prev);
  }, []);

  const toggleCreativeInAdSet = useCallback((adsetId: string, creativeId: string) => {
    setAdsets(prev => prev.map(a => {
      if (a.id !== adsetId) return a;
      const next = new Set(a.creative_ids);
      if (next.has(creativeId)) next.delete(creativeId);
      else next.add(creativeId);
      return { ...a, creative_ids: next };
    }));
  }, []);

  const setBudget = useCallback((adsetId: string, budget: number) => {
    setAdsets(prev => prev.map(a =>
      a.id === adsetId ? { ...a, daily_budget: budget } : a
    ));
  }, []);

  const updateOptGoal = useCallback((adsetId: string, goal: string) => {
    setAdsets(prev => prev.map(a =>
      a.id === adsetId ? { ...a, optimization_goal_override: goal === 'CONVERSATIONS' ? undefined : goal } : a
    ));
  }, []);

  const toggleExistingCreative = useCallback((creativeId: string) => {
    setSelectedExistingCreativeIds(prev => {
      const next = new Set(prev);
      if (next.has(creativeId)) next.delete(creativeId);
      else next.add(creativeId);
      return next;
    });
  }, []);

  const toggleAdset = useCallback((adsetId: string) => {
    setSelectedAdsetIds(prev => {
      const next = new Set(prev);
      if (next.has(adsetId)) next.delete(adsetId);
      else next.add(adsetId);
      return next;
    });
  }, []);

  const handleLaunchExisting = async () => {
    if (!direction || !direction.user_account_id) {
      toast.error('Выберите направление');
      return;
    }
    if (selectedExistingCreativeIds.size === 0) {
      toast.error('Выберите креативы для добавления');
      return;
    }
    if (selectedAdsetIds.size === 0) {
      toast.error('Выберите адсеты');
      return;
    }

    setIsLaunching(true);
    try {
      const result = await manualLaunchExisting({
        user_account_id: direction.user_account_id,
        account_id: currentAdAccountId || undefined,
        direction_id: direction.id,
        creative_ids: Array.from(selectedExistingCreativeIds),
        target_adset_ids: Array.from(selectedAdsetIds),
      });
      if (result.success) {
        onOpenChange(false);
        // Адаптируем ответ к существующему MultiAdSetLaunchResponse-обработчику
        onSuccess({
          success: true,
          message: result.message,
          direction_id: result.direction_id,
          direction_name: result.direction_name,
          campaign_id: result.campaign_id,
          total_adsets: result.adsets_used || 0,
          total_ads: result.total_ads || 0,
          success_count: result.adsets_used || 0,
          failed_count: result.failed_count || 0,
          adsets: (result.results || []).map(r => ({
            success: true,
            adset_id: r.fb_adset_id,
            adset_name: r.adset_name || undefined,
            ads_created: r.ads_created,
            ads: r.ads.map(a => ({ ad_id: a.ad_id, name: '' })),
          })),
        });
        toast.success(result.message || 'Объявления добавлены');
      } else {
        toast.error(result.error || 'Ошибка добавления объявлений', { duration: 8000 });
      }
    } catch (error: any) {
      console.error('Launch existing error:', error);
      toast.error(error.message || 'Не удалось добавить объявления');
    } finally {
      setIsLaunching(false);
    }
  };

  const handleLaunch = async () => {
    if (launchMode === 'existing' && !isTikTok) {
      return handleLaunchExisting();
    }

    if (!direction) {
      toast.error('Выберите направление');
      return;
    }
    if (!direction.user_account_id) {
      toast.error('Направление не связано с рекламным аккаунтом');
      return;
    }

    const emptyAdsets = adsets.filter(a => a.creative_ids.size === 0);
    if (emptyAdsets.length > 0) {
      toast.error(`Выберите креативы для каждого адсета (${emptyAdsets.length} пустых)`);
      return;
    }

    const lowBudgetAdsets = adsets.filter(a => a.daily_budget < minBudget);
    if (lowBudgetAdsets.length > 0) {
      toast.error(`Минимальный бюджет - ${minBudgetText} в день`);
      return;
    }

    setIsLaunching(true);
    try {
      const result = await manualLaunchMultiAdSets({
        platform: isTikTok ? 'tiktok' : 'facebook',
        user_account_id: direction.user_account_id,
        account_id: currentAdAccountId || undefined,
        direction_id: direction.id,
        start_mode: isTikTok ? undefined : startMode,
        objective: isTikTok ? direction.tiktok_objective || undefined : undefined,
        adsets: adsets.map(a => ({
          creative_ids: Array.from(a.creative_ids),
          daily_budget_cents: isTikTok ? undefined : Math.round(a.daily_budget * 100),
          daily_budget: isTikTok ? a.daily_budget : undefined,
          optimization_goal_override: !isTikTok ? a.optimization_goal_override : undefined,
        })),
      });

      if (result.success) {
        onOpenChange(false);
        onSuccess(result);
        toast.success(result.message || 'Реклама успешно запущена!');
      } else {
        const errorMsg = result.error || 'Ошибка запуска рекламы';
        toast.error(errorMsg, { duration: 8000 });
      }
    } catch (error: any) {
      console.error('Ошибка multi-launch:', error);
      toast.error(error.message || 'Не удалось запустить рекламу');
    } finally {
      setIsLaunching(false);
    }
  };

  const hasCreatives = allCreatives.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Запуск рекламы</DialogTitle>
          <DialogDescription>
            Настройте адсеты и распределите креативы
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-4">
          {/* Направление */}
          {props.mode === 'standalone' ? (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Направление</Label>
              <Select
                value={selectedDirectionId}
                onValueChange={(value) => {
                  setSelectedDirectionId(value);
                  setAdsets([{
                    id: nextAdSetId(),
                    creative_ids: new Set<string>(),
                    daily_budget: minBudget,
                  }]);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Выберите направление" />
                </SelectTrigger>
                <SelectContent>
                  {props.directions.filter(d => d.is_active).map(d => (
                    <SelectItem key={d.id} value={d.id}>
                      <span className="block truncate max-w-[350px]" title={`${d.name} (${getDirectionObjectiveLabel(d)})`}>
                        {d.name} ({getDirectionObjectiveLabel(d)})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Направление</Label>
              <div className="text-sm font-medium">
                {direction?.name || 'Не выбрано'}
                {direction && (
                  <span className="text-muted-foreground ml-2 font-normal">
                    ({getDirectionObjectiveLabel(direction)})
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Режим запуска (Facebook only) */}
          {!isTikTok && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Режим</Label>
              <RadioGroup
                value={launchMode}
                onValueChange={(v: 'create' | 'existing') => setLaunchMode(v)}
                className="flex gap-4"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="create" id="ml-mode-create" />
                  <Label htmlFor="ml-mode-create" className="cursor-pointer text-sm">Создать новые адсеты</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="existing" id="ml-mode-existing" />
                  <Label htmlFor="ml-mode-existing" className="cursor-pointer text-sm">Добавить в существующие</Label>
                </div>
              </RadioGroup>
            </div>
          )}

          {/* Время запуска (Facebook only, только для режима 'create') */}
          {!isTikTok && launchMode === 'create' && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Время запуска</Label>
              <RadioGroup
                value={startMode}
                onValueChange={(v: 'now' | 'midnight_almaty') => setStartMode(v)}
                className="flex gap-4"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="midnight_almaty" id="ml-start-midnight" />
                  <Label htmlFor="ml-start-midnight" className="cursor-pointer text-sm">С полуночи</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="now" id="ml-start-now" />
                  <Label htmlFor="ml-start-now" className="cursor-pointer text-sm">Сейчас</Label>
                </div>
              </RadioGroup>
            </div>
          )}

          {/* Loading indicator for standalone mode */}
          {props.mode === 'standalone' && loadingCreatives && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* No creatives message */}
          {props.mode === 'standalone' && selectedDirectionId && !loadingCreatives && !hasCreatives && (
            <div className="p-4 border border-dashed rounded-lg text-center text-sm text-muted-foreground">
              Нет активных креативов в этом направлении
            </div>
          )}

          {/* Список адсетов (режим: создать новые) */}
          {hasCreatives && (launchMode === 'create' || isTikTok) && (
            <div className="space-y-3">
              {adsets.map((adset, idx) => (
                <div key={adset.id} className="border rounded-lg p-4 space-y-3 bg-muted/20">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">Ad Set {idx + 1}</span>
                      <Badge variant="secondary" className="text-xs">
                        {adset.creative_ids.size} креативов
                      </Badge>
                    </div>
                    {adsets.length > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => removeAdSet(adset.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>

                  {/* Бюджет */}
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground whitespace-nowrap">
                      Бюджет ({budgetLabel})
                    </Label>
                    <div className="flex items-center gap-1.5">
                      <span className="text-lg">{budgetSymbol}</span>
                      <input
                        type="number"
                        min={minBudget}
                        step="1"
                        value={adset.daily_budget}
                        onChange={(e) => setBudget(adset.id, Number(e.target.value))}
                        className="flex h-8 w-28 rounded-md border border-input bg-background px-2 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={isLaunching}
                      />
                    </div>
                  </div>

                  {/* Цель оптимизации — скрыто */}

                  {/* Креативы */}
                  <div className="space-y-1 max-h-[140px] overflow-y-auto">
                    {allCreatives.map(creative => (
                      <label
                        key={creative.id}
                        className="flex items-center gap-2.5 p-1.5 rounded hover:bg-muted/40 cursor-pointer"
                      >
                        <Checkbox
                          checked={adset.creative_ids.has(creative.id)}
                          onCheckedChange={() => toggleCreativeInAdSet(adset.id, creative.id)}
                          disabled={isLaunching}
                        />
                        <div className="shrink-0 w-6 h-6 rounded overflow-hidden bg-muted flex items-center justify-center">
                          <MediaIcon type={creative.media_type} />
                        </div>
                        <span className="text-sm truncate">{creative.title}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}

              {/* Кнопка добавления адсета */}
              <Button
                variant="outline"
                size="sm"
                className="w-full border-dashed"
                onClick={addAdSet}
                disabled={isLaunching}
              >
                <Plus className="h-4 w-4 mr-1.5" />
                Добавить Ad Set
              </Button>
            </div>
          )}

          {/* Итого */}
          {adsets.length > 1 && hasCreatives && (launchMode === 'create' || isTikTok) && (
            <div className="flex items-center justify-between px-1 text-sm">
              <span className="text-muted-foreground">Итого бюджет:</span>
              <span className="font-medium">
                {budgetSymbol}{isTikTok ? totalBudget.toLocaleString('ru-RU') : totalBudget} {budgetLabel}/день
              </span>
            </div>
          )}

          {/* Режим: добавить в существующие адсеты (Facebook only) */}
          {!isTikTok && launchMode === 'existing' && hasCreatives && (
            <div className="space-y-4">
              {/* Блок: общий пул креативов */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Креативы для добавления</Label>
                  <Badge variant="secondary" className="text-xs">
                    {selectedExistingCreativeIds.size} выбрано
                  </Badge>
                </div>
                <div className="space-y-1 max-h-[180px] overflow-y-auto border rounded-md p-2 bg-muted/20">
                  {allCreatives.map(creative => (
                    <label
                      key={creative.id}
                      className="flex items-center gap-2.5 p-1.5 rounded hover:bg-muted/40 cursor-pointer"
                    >
                      <Checkbox
                        checked={selectedExistingCreativeIds.has(creative.id)}
                        onCheckedChange={() => toggleExistingCreative(creative.id)}
                        disabled={isLaunching}
                      />
                      <div className="shrink-0 w-6 h-6 rounded overflow-hidden bg-muted flex items-center justify-center">
                        <MediaIcon type={creative.media_type} />
                      </div>
                      <span className="text-sm truncate">{creative.title}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Блок: выбор активных адсетов */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Активные адсеты направления</Label>
                  {activeAdsets.length > 0 && (
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline"
                      onClick={() => {
                        const eligible = activeAdsets.filter(a => a.ads_count + selectedExistingCreativeIds.size <= 50);
                        if (selectedAdsetIds.size === eligible.length) {
                          setSelectedAdsetIds(new Set());
                        } else {
                          setSelectedAdsetIds(new Set(eligible.map(a => a.fb_adset_id)));
                        }
                      }}
                      disabled={isLaunching}
                    >
                      {selectedAdsetIds.size > 0 ? 'Снять все' : 'Выбрать все'}
                    </button>
                  )}
                </div>

                {loadingActiveAdsets ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : activeAdsets.length === 0 ? (
                  <div className="p-4 border border-dashed rounded-lg text-center text-sm text-muted-foreground space-y-2">
                    <div>В этом направлении нет активных адсетов</div>
                    <Button variant="outline" size="sm" onClick={() => setLaunchMode('create')}>
                      Создать новый адсет
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-1 max-h-[260px] overflow-y-auto border rounded-md p-2">
                    {activeAdsets.map(adset => {
                      const willAdd = selectedExistingCreativeIds.size;
                      const remaining = 50 - adset.ads_count;
                      const isOverLimit = willAdd > 0 && willAdd > remaining;
                      const disabled = isLaunching || isOverLimit;
                      const checked = selectedAdsetIds.has(adset.fb_adset_id);
                      const budgetUsd = adset.daily_budget != null ? (adset.daily_budget / 100).toFixed(0) : '—';
                      return (
                        <label
                          key={adset.fb_adset_id}
                          className={`flex items-center gap-2.5 p-2 rounded ${disabled && !checked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-muted/40'}`}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggleAdset(adset.fb_adset_id)}
                            disabled={disabled && !checked}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{adset.name}</div>
                            <div className="text-xs text-muted-foreground">
                              ${budgetUsd}/день · {adset.ads_count} объявлений
                              {isOverLimit && (
                                <span className="text-destructive ml-2">
                                  осталось {Math.max(0, remaining)} слот(ов)
                                </span>
                              )}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              {selectedAdsetIds.size > 0 && selectedExistingCreativeIds.size > 0 && (
                <div className="flex items-center justify-between px-1 text-sm">
                  <span className="text-muted-foreground">Будет создано объявлений:</span>
                  <span className="font-medium">
                    {selectedAdsetIds.size * selectedExistingCreativeIds.size}
                    <span className="text-muted-foreground font-normal ml-1">
                      ({selectedExistingCreativeIds.size} × {selectedAdsetIds.size})
                    </span>
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLaunching}
          >
            Отмена
          </Button>
          <Button
            onClick={handleLaunch}
            disabled={
              isLaunching ||
              !hasCreatives ||
              !direction ||
              (launchMode === 'existing' && !isTikTok && (selectedAdsetIds.size === 0 || selectedExistingCreativeIds.size === 0))
            }
            className="dark:bg-gray-700 dark:hover:bg-gray-800"
          >
            {isLaunching ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Запуск...
              </>
            ) : launchMode === 'existing' && !isTikTok ? (
              <>
                <Rocket className="h-4 w-4 mr-2" />
                Добавить{selectedAdsetIds.size > 0 ? ` (${selectedAdsetIds.size * selectedExistingCreativeIds.size})` : ''}
              </>
            ) : (
              <>
                <Rocket className="h-4 w-4 mr-2" />
                Запустить {adsets.length > 1 ? `(${adsets.length} адсетов)` : ''}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
