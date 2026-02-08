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
import { manualLaunchMultiAdSets, type MultiAdSetLaunchResponse } from "@/services/manualLaunchApi";
import { type UserCreative } from "@/services/creativesApi";
import { type Direction, getDirectionObjectiveLabel } from "@/types/direction";
import { supabase } from "@/integrations/supabase/client";

const FACEBOOK_MIN_DAILY_BUDGET = 5;
const TIKTOK_MIN_DAILY_BUDGET = 2500;

type AdSetConfig = {
  id: string;
  creative_ids: Set<string>;
  daily_budget: number;
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
  const { open, onOpenChange, platform, currentAdAccountId, onSuccess } = props;

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
        const { data, error } = await supabase
          .from('user_creatives')
          .select('*')
          .eq('user_id', props.userId)
          .eq('direction_id', selectedDirectionId)
          .eq('is_active', true)
          .eq('status', 'ready')
          .order('created_at', { ascending: false });

        if (!cancelled) {
          if (error) {
            toast.error('Не удалось загрузить креативы');
            setLoadedCreatives([]);
          } else {
            setLoadedCreatives((data || []) as UserCreative[]);
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
    } else {
      setSelectedDirectionId('');
      setLoadedCreatives([]);
      setAdsets([{
        id: nextAdSetId(),
        creative_ids: new Set<string>(),
        daily_budget: minBudget,
      }]);
    }
    setStartMode('now');
  }, [open]);

  // When creatives load in standalone mode, auto-select all into first adset
  useEffect(() => {
    if (props.mode !== 'standalone' || loadedCreatives.length === 0) return;
    setAdsets(prev => {
      if (prev.length === 1 && prev[0].creative_ids.size === 0) {
        return [{
          ...prev[0],
          creative_ids: new Set(loadedCreatives.map(c => c.id)),
        }];
      }
      return prev;
    });
  }, [loadedCreatives]);

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

  const handleLaunch = async () => {
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

          {/* Время запуска (Facebook only) */}
          {!isTikTok && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Время запуска</Label>
              <RadioGroup
                value={startMode}
                onValueChange={(v: 'now' | 'midnight_almaty') => setStartMode(v)}
                className="flex gap-4"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="midnight_almaty" id="ml-start-midnight" />
                  <Label htmlFor="ml-start-midnight" className="cursor-pointer text-sm">С полуночи (Алматы)</Label>
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

          {/* Список адсетов */}
          {hasCreatives && (
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
          {adsets.length > 1 && hasCreatives && (
            <div className="flex items-center justify-between px-1 text-sm">
              <span className="text-muted-foreground">Итого бюджет:</span>
              <span className="font-medium">
                {budgetSymbol}{isTikTok ? totalBudget.toLocaleString('ru-RU') : totalBudget} {budgetLabel}/день
              </span>
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
            disabled={isLaunching || !hasCreatives || !direction}
            className="dark:bg-gray-700 dark:hover:bg-gray-800"
          >
            {isLaunching ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Запуск...
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
