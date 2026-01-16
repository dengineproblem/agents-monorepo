import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Plus, Target, Trash2, Edit } from 'lucide-react';
import { toast } from 'sonner';
import { useDirections } from '@/hooks/useDirections';
import { CreateDirectionDialog, type CreateDirectionFormData } from './CreateDirectionDialog';
import { EditDirectionDialog, type EditDirectionCapiSettings } from './EditDirectionDialog';
import { DeleteDirectionAlert } from './DeleteDirectionAlert';
import { DirectionAdSets } from '../DirectionAdSets';
import { supabase } from '@/integrations/supabase/client';
import type { Direction, CreateDefaultSettingsInput } from '@/types/direction';
import { getDirectionObjectiveLabel } from '@/types/direction';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { TooltipKeys } from '@/content/tooltips';
import { useAppContext } from '@/context/AppContext';

interface DirectionsCardProps {
  userAccountId: string | null;
  accountId?: string | null; // UUID из ad_accounts.id для мультиаккаунтности
}

const DirectionsCard: React.FC<DirectionsCardProps> = ({ userAccountId, accountId }) => {
  const { platform } = useAppContext();
  const directionsPlatform = platform === 'tiktok' ? 'tiktok' : 'facebook';
  const { directions, loading, createDirection, updateDirection, deleteDirection } =
    useDirections(userAccountId, accountId, directionsPlatform);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteAlertOpen, setDeleteAlertOpen] = useState(false);
  const [selectedDirection, setSelectedDirection] = useState<Direction | null>(null);
  const [adsetMode, setAdsetMode] = useState<'api_create' | 'use_existing'>('api_create');

  // Загрузить режим ad set creation
  useEffect(() => {
    const loadAdsetMode = async () => {
      if (!userAccountId) return;
      
      const { data, error } = await supabase
        .from('user_accounts')
        .select('default_adset_mode')
        .eq('id', userAccountId)
        .single();
      
      if (data && !error) {
        setAdsetMode(data.default_adset_mode || 'api_create');
      }
    };
    
    loadAdsetMode();
  }, [userAccountId]);

  // Отладка
  React.useEffect(() => {
    console.log('[DirectionsCard] userAccountId:', userAccountId);
    console.log('[DirectionsCard] directions:', directions);
    console.log('[DirectionsCard] loading:', loading);
  }, [userAccountId, directions, loading]);

  // Обработчик создания направления
  const handleCreate = async (data: CreateDirectionFormData) => {
    console.log('[DirectionsCard] Создание направления с настройками:', data);

    const stripSettings = (settings?: CreateDefaultSettingsInput) => {
      if (!settings) return undefined;
      const { direction_id, campaign_goal, ...rest } = settings;
      return rest;
    };

    const sharedSettings = stripSettings(data.adSettings);
    const facebookSettings = stripSettings(data.facebookAdSettings);
    const tiktokSettings = stripSettings(data.tiktokAdSettings);

    // Создаём направление + настройки одним запросом
    const result = await createDirection({
      name: data.name,
      platform: data.platform,
      ...(data.objective && { objective: data.objective }),
      ...(data.optimization_level && { optimization_level: data.optimization_level }),
      ...(data.use_instagram !== undefined && { use_instagram: data.use_instagram }),
      ...(data.daily_budget_cents !== undefined && { daily_budget_cents: data.daily_budget_cents }),
      ...(data.target_cpl_cents !== undefined && { target_cpl_cents: data.target_cpl_cents }),
      ...(data.whatsapp_phone_number && { whatsapp_phone_number: data.whatsapp_phone_number }),
      ...(data.tiktok_objective && { tiktok_objective: data.tiktok_objective }),
      ...(data.tiktok_daily_budget !== undefined && { tiktok_daily_budget: data.tiktok_daily_budget }),
      ...(data.tiktok_target_cpl_kzt !== undefined && { tiktok_target_cpl_kzt: data.tiktok_target_cpl_kzt }),
      ...(facebookSettings && { facebook_default_settings: facebookSettings }),
      ...(tiktokSettings && { tiktok_default_settings: tiktokSettings }),
      ...(sharedSettings && !facebookSettings && !tiktokSettings && { default_settings: sharedSettings }),
      ...(data.capiSettings && {
        // CAPI settings (direction-level)
        capi_enabled: data.capiSettings.capi_enabled,
        capi_source: data.capiSettings.capi_source,
        capi_crm_type: data.capiSettings.capi_crm_type,
        capi_interest_fields: data.capiSettings.capi_interest_fields,
        capi_qualified_fields: data.capiSettings.capi_qualified_fields,
        capi_scheduled_fields: data.capiSettings.capi_scheduled_fields,
      }),
    });

    if (!result.success || !result.direction) {
      toast.error(result.error || 'Не удалось создать направление');
      throw new Error(result.error);
    }

    // Проверяем, созданы ли настройки
    if (result.default_settings) {
      const createdCount = result.directions?.length || 1;
      toast.success(createdCount > 1 ? `Создано направлений: ${createdCount}` : 'Направление и настройки успешно созданы!');
    } else {
      toast.success('Направление создано!');
    }
  };

  // Обработчик редактирования направления
  const handleEdit = async (data: {
    name: string;
    daily_budget_cents?: number;
    target_cpl_cents?: number;
    tiktok_daily_budget?: number;
    tiktok_target_cpl_kzt?: number;
    is_active: boolean;
    whatsapp_phone_number?: string | null;
    capiSettings?: EditDirectionCapiSettings;
  }) => {
    if (!selectedDirection) return;

    // Подготавливаем данные для обновления, включая CAPI настройки
    const updatePayload = {
      name: data.name,
      is_active: data.is_active,
      ...(data.daily_budget_cents !== undefined && { daily_budget_cents: data.daily_budget_cents }),
      ...(data.target_cpl_cents !== undefined && { target_cpl_cents: data.target_cpl_cents }),
      ...(data.tiktok_daily_budget !== undefined && { tiktok_daily_budget: data.tiktok_daily_budget }),
      ...(data.tiktok_target_cpl_kzt !== undefined && { tiktok_target_cpl_kzt: data.tiktok_target_cpl_kzt }),
      ...(data.whatsapp_phone_number !== undefined && { whatsapp_phone_number: data.whatsapp_phone_number }),
      // CAPI settings
      ...(data.capiSettings && {
        capi_enabled: data.capiSettings.capi_enabled,
        capi_source: data.capiSettings.capi_source,
      }),
    };

    const result = await updateDirection(selectedDirection.id, updatePayload);

    if (result.success) {
      toast.success('Направление обновлено!');
      setSelectedDirection(null);
    } else {
      toast.error(result.error || 'Не удалось обновить направление');
      throw new Error(result.error);
    }
  };

  // Обработчик удаления направления
  const handleDelete = async () => {
    if (!selectedDirection) return;

    const result = await deleteDirection(selectedDirection.id);

    if (result.success) {
      toast.success('Направление удалено');
      setSelectedDirection(null);
    } else {
      toast.error(result.error || 'Не удалось удалить направление');
      throw new Error(result.error);
    }
  };

  const formatUsd = (amount: number) => new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);

  const formatKzt = (amount: number) => new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'KZT',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);

  const getBudgetLine = (direction: Direction) => {
    if (direction.platform === 'tiktok') {
      const budgetLabel = direction.tiktok_daily_budget != null
        ? formatKzt(direction.tiktok_daily_budget)
        : '—';
      const target = direction.tiktok_target_cpl_kzt ?? direction.tiktok_target_cpl;
      const targetLabel = target != null ? formatKzt(target) : '—';
      const objective = direction.tiktok_objective || 'traffic';
      const targetSuffix = objective === 'traffic' ? 'клик' : 'лид';
      return `${budgetLabel}/день • цель: ${targetLabel}/${targetSuffix}`;
    }
    return `${formatUsd(direction.daily_budget_cents / 100)}/день • ${formatUsd(direction.target_cpl_cents / 100)}/заявка`;
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Target className="h-5 w-5" />
            Направления бизнеса
            <HelpTooltip tooltipKey={TooltipKeys.DIRECTION_WHAT} iconSize="md" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : directions.length === 0 ? (
            // Пустое состояние
            <div className="text-center py-8 space-y-3">
              <div className="text-4xl">🎯</div>
              <div className="space-y-1">
                <p className="font-medium">У вас пока нет направлений</p>
                <p className="text-sm text-muted-foreground">
                  Направления помогают разделить рекламу
                  <br />
                  по разным услугам или продуктам
                </p>
              </div>
              <Button 
                onClick={() => setCreateDialogOpen(true)} 
                variant="outline"
                size="sm"
              >
                <Plus className="h-4 w-4 mr-1" />
                Создать направление
              </Button>
            </div>
          ) : (
            // Список направлений
            <div className="space-y-3">
              {directions.map((direction) => (
                <div
                  key={direction.id}
                  className={`rounded-lg border p-4 transition-all ${
                    direction.is_active
                      ? 'border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/20'
                      : 'border-muted bg-muted/20 opacity-70'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 sm:gap-3">
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div
                          className={`h-2 w-2 rounded-full flex-shrink-0 ${
                            direction.is_active ? 'bg-green-500' : 'bg-gray-400'
                          }`}
                        />
                        <h3 className="font-semibold truncate">
                          {direction.name}
                        </h3>
                        <span className="text-xs text-muted-foreground flex-shrink-0">
                          ({getDirectionObjectiveLabel(direction)})
                        </span>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {getBudgetLine(direction)}
                      </div>
                      {direction.platform === 'tiktok' && direction.tiktok_campaign_id && (
                        <div className="text-xs text-muted-foreground font-mono">
                          Campaign ID: {direction.tiktok_campaign_id}
                        </div>
                      )}
                      {direction.platform !== 'tiktok' && direction.fb_campaign_id && (
                        <div className="text-xs text-muted-foreground font-mono">
                          Campaign ID: {direction.fb_campaign_id}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
                      <div className="flex items-center gap-2">
                        <Switch
                          id={`active-${direction.id}`}
                          checked={direction.is_active}
                          onCheckedChange={async (newActive) => {
                            const result = await updateDirection(direction.id, {
                              is_active: newActive,
                            });
                            if (result.success) {
                              toast.success(
                                newActive ? 'Направление активировано' : 'Направление деактивировано'
                              );
                            } else {
                              toast.error('Не удалось изменить статус');
                            }
                          }}
                        />
                        <Label 
                          htmlFor={`active-${direction.id}`} 
                          className="text-xs text-muted-foreground cursor-pointer hidden sm:inline"
                        >
                          Активно
                        </Label>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSelectedDirection(direction);
                          setEditDialogOpen(true);
                        }}
                        className="px-2 sm:px-4"
                      >
                        <Edit className="h-4 w-4 sm:mr-2" />
                        <span className="hidden sm:inline">Изменить</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setSelectedDirection(direction);
                          setDeleteAlertOpen(true);
                        }}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10 px-2"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  
                  {/* Pre-created Ad Sets Management (только для use_existing режима) */}
                  {platform !== 'tiktok' && adsetMode === 'use_existing' && userAccountId && (
                    <div className="mt-4 pt-4 border-t">
                      <DirectionAdSets 
                        directionId={direction.id} 
                        userAccountId={userAccountId} 
                      />
                    </div>
                  )}
                </div>
              ))}
              
              {/* Кнопка добавить направление */}
              <div className="pt-2 border-t">
                <Button 
                  variant="ghost"
                  size="sm"
                  onClick={() => setCreateDialogOpen(true)}
                  className="w-full"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Добавить направление
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Диалоги */}
      <CreateDirectionDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSubmit={handleCreate}
        userAccountId={userAccountId || ''}
        defaultPlatform={directionsPlatform}
      />

      <EditDirectionDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        direction={selectedDirection}
        onSubmit={handleEdit}
      />

      <DeleteDirectionAlert
        open={deleteAlertOpen}
        onOpenChange={setDeleteAlertOpen}
        direction={selectedDirection}
        onConfirm={handleDelete}
      />
    </>
  );
};

export default DirectionsCard;
