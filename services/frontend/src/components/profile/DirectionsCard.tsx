import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Plus, Target, Trash2, Edit } from 'lucide-react';
import { toast } from 'sonner';
import { useDirections } from '@/hooks/useDirections';
import { CreateDirectionDialog } from './CreateDirectionDialog';
import { EditDirectionDialog } from './EditDirectionDialog';
import { DeleteDirectionAlert } from './DeleteDirectionAlert';
import type { Direction, CreateDefaultSettingsInput } from '@/types/direction';
import { OBJECTIVE_LABELS } from '@/types/direction';

interface DirectionsCardProps {
  userAccountId: string | null;
}

const DirectionsCard: React.FC<DirectionsCardProps> = ({ userAccountId }) => {
  const { directions, loading, createDirection, updateDirection, deleteDirection } =
    useDirections(userAccountId);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteAlertOpen, setDeleteAlertOpen] = useState(false);
  const [selectedDirection, setSelectedDirection] = useState<Direction | null>(null);

  // Отладка
  React.useEffect(() => {
    console.log('[DirectionsCard] userAccountId:', userAccountId);
    console.log('[DirectionsCard] directions:', directions);
    console.log('[DirectionsCard] loading:', loading);
  }, [userAccountId, directions, loading]);

  // Обработчик создания направления
  const handleCreate = async (data: {
    name: string;
    objective: 'whatsapp' | 'instagram_traffic' | 'site_leads';
    daily_budget_cents: number;
    target_cpl_cents: number;
    whatsapp_phone_number?: string;
    adSettings: CreateDefaultSettingsInput;
  }) => {
    console.log('[DirectionsCard] Создание направления с настройками:', data);
    
    // Подготовка default_settings для API (без direction_id, он добавится на бэкенде)
    const { direction_id, campaign_goal, ...settingsData } = data.adSettings;
    
    // Создаём направление + настройки одним запросом
    const result = await createDirection({
      name: data.name,
      objective: data.objective,
      daily_budget_cents: data.daily_budget_cents,
      target_cpl_cents: data.target_cpl_cents,
      whatsapp_phone_number: data.whatsapp_phone_number, // Передаем WhatsApp номер
      default_settings: settingsData, // Передаём настройки в том же запросе
    });

    if (!result.success || !result.direction) {
      toast.error(result.error || 'Не удалось создать направление');
      throw new Error(result.error);
    }

    // Проверяем, созданы ли настройки
    if (result.default_settings) {
      toast.success('Направление и настройки успешно созданы!');
    } else {
      toast.success('Направление создано!');
    }
  };

  // Обработчик редактирования направления
  const handleEdit = async (data: {
    name: string;
    daily_budget_cents: number;
    target_cpl_cents: number;
    is_active: boolean;
    whatsapp_phone_number?: string | null;
  }) => {
    if (!selectedDirection) return;

    const result = await updateDirection(selectedDirection.id, data);

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

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Target className="h-5 w-5" />
            Направления бизнеса
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
                          ({OBJECTIVE_LABELS[direction.objective]})
                        </span>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        ${(direction.daily_budget_cents / 100).toFixed(2)}/день •{' '}
                        ${(direction.target_cpl_cents / 100).toFixed(2)}/заявка
                      </div>
                      {direction.fb_campaign_id && (
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

