/**
 * DirectionAdSets Component
 * 
 * Управление pre-created ad sets для направления в режиме use_existing.
 * Позволяет:
 * - Просматривать список связанных ad sets
 * - Привязывать новые ad sets из Facebook Ads Manager
 * - Отвязывать ad sets
 * - Синхронизировать данные с Facebook
 */

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Plus, RefreshCw, Unlink, ChevronDown, ChevronUp, X } from 'lucide-react';

// Используем API_BASE_URL из config/api.ts (уже содержит /api в конце)
import { API_BASE_URL } from '@/config/api';

interface DirectionAdSet {
  id: string;
  fb_adset_id: string;
  adset_name: string;
  status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'DELETED';
  ads_count: number;
  daily_budget_cents: number;
  linked_at: string;
  is_active: boolean;
}

interface DirectionAdSetsProps {
  directionId: string;
  userAccountId: string;
}

export function DirectionAdSets({ directionId, userAccountId }: DirectionAdSetsProps) {
  const [adsets, setAdsets] = useState<DirectionAdSet[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [fbAdSetIds, setFbAdSetIds] = useState<string[]>(['']);
  const [isLinking, setIsLinking] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const MAX_ADSETS = 20;

  // Fetch ad sets for this direction
  const fetchAdSets = async () => {
    setIsLoading(true);
    try {
      const url = `${API_BASE_URL}/directions/${directionId}/adsets?user_account_id=${userAccountId}`;


      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error('Failed to fetch ad sets');
      }

      const data = await response.json();
      setAdsets(data.adsets || []);
    } catch (error) {

      toast.error('Failed to load ad sets');
    } finally {
      setIsLoading(false);
    }
  };

  // Link multiple ad sets
  const linkAdSets = async () => {
    const validIds = fbAdSetIds.filter(id => id.trim());
    
    if (validIds.length === 0) {
      toast.error('Введите хотя бы один Ad Set ID');
      return;
    }

    // Check if adding these would exceed the limit
    if (adsets.length + validIds.length > MAX_ADSETS) {
      toast.error(`Можно добавить максимум ${MAX_ADSETS} ad sets. У вас уже ${adsets.length}.`);
      return;
    }

    setIsLinking(true);
    let successCount = 0;
    let failCount = 0;

    try {
      for (const fbAdSetId of validIds) {
        try {
          const response = await fetch(
            `${API_BASE_URL}/directions/${directionId}/link-adset`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                fb_adset_id: fbAdSetId.trim(),
                user_account_id: userAccountId
              })
            }
          );

          const data = await response.json();

          if (!response.ok) {
            // Special handling for status errors
            if (data.current_status) {
              throw new Error(`Ad Set ${fbAdSetId}: ${data.error} (текущий статус: ${data.current_status})`);
            }
            throw new Error(data.error || 'Failed to link ad set');
          }

          successCount++;
        } catch (error: any) {

          toast.error(error.message || `Ошибка при привязке ${fbAdSetId}`);
          failCount++;
        }
      }

      if (successCount > 0 && failCount === 0) {
        toast.success(`Успешно привязано ad sets: ${successCount}`);
      } else if (successCount > 0 && failCount > 0) {
        toast.warning(`Привязано: ${successCount}, не удалось: ${failCount}`);
      }

      setLinkDialogOpen(false);
      setFbAdSetIds(['']);
      fetchAdSets();
    } catch (error: any) {

      toast.error(error.message || 'Ошибка при привязке ad sets');
    } finally {
      setIsLinking(false);
    }
  };

  // Add new Ad Set ID input
  const addAdSetIdInput = () => {
    if (fbAdSetIds.length < MAX_ADSETS) {
      setFbAdSetIds([...fbAdSetIds, '']);
    }
  };

  // Remove Ad Set ID input
  const removeAdSetIdInput = (index: number) => {
    if (fbAdSetIds.length > 1) {
      const newIds = fbAdSetIds.filter((_, i) => i !== index);
      setFbAdSetIds(newIds);
    }
  };

  // Update Ad Set ID
  const updateAdSetId = (index: number, value: string) => {
    const newIds = [...fbAdSetIds];
    newIds[index] = value;
    setFbAdSetIds(newIds);
  };

  // Unlink an ad set
  const unlinkAdSet = async (adsetId: string) => {
    if (!confirm('Вы уверены, что хотите отвязать этот ad set?')) {
      return;
    }

    try {
      const response = await fetch(
        `${API_BASE_URL}/directions/${directionId}/adsets/${adsetId}?user_account_id=${userAccountId}`,
        { method: 'DELETE' }
      );

      if (!response.ok) {
        throw new Error('Не удалось отвязать ad set');
      }

      toast.success('Ad set успешно отвязан');
      fetchAdSets();
    } catch (error) {

      toast.error('Не удалось отвязать ad set');
    }
  };

  // Sync ad sets with Facebook
  const syncAdSets = async () => {
    setIsSyncing(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/directions/${directionId}/sync-adsets`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_account_id: userAccountId })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error('Failed to sync ad sets');
      }

      toast.success(`Synced ${data.synced_count} ad sets successfully`);
      fetchAdSets();
    } catch (error) {

      toast.error('Failed to sync ad sets');
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    fetchAdSets();
  }, [directionId]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return 'text-green-600 bg-green-50';
      case 'PAUSED':
        return 'text-blue-600 bg-blue-50';
      case 'ARCHIVED':
        return 'text-gray-600 bg-gray-50';
      case 'DELETED':
        return 'text-red-600 bg-red-50';
      default:
        return 'text-gray-600 bg-gray-50';
    }
  };

  return (
    <Card>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="py-3">
          <div className="flex items-center justify-between">
            <CollapsibleTrigger className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              {isOpen ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
              <CardTitle className="text-base">
                Связанные Ad Sets
                {!isLoading && adsets.length > 0 && (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    ({adsets.length})
                  </span>
                )}
              </CardTitle>
            </CollapsibleTrigger>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={syncAdSets}
                disabled={isSyncing || adsets.length === 0}
                className="h-8"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFbAdSetIds(['']);
                  setLinkDialogOpen(true);
                }}
                disabled={adsets.length >= MAX_ADSETS}
                className="h-8"
                title={adsets.length >= MAX_ADSETS ? `Достигнут лимит ${MAX_ADSETS} ad sets` : 'Добавить ad sets'}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="pt-0 pb-3">
            {isLoading ? (
              <div className="text-center py-2 text-sm text-muted-foreground">
                Загрузка...
              </div>
            ) : adsets.length === 0 ? (
              <div className="text-center py-4 text-sm text-muted-foreground">
                <p>Нет привязанных ad sets.</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {adsets.map((adset) => (
                  <div
                    key={adset.id}
                    className="flex items-center justify-between px-2 py-1.5 border rounded hover:bg-accent/50 transition-colors text-sm"
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${getStatusColor(adset.status)}`}>
                        {adset.status}
                      </span>
                      <span className="font-medium truncate">{adset.adset_name}</span>
                      <span className="text-muted-foreground text-xs">
                        {adset.ads_count}/50
                      </span>
                      <span className="text-muted-foreground text-xs">
                        ${(adset.daily_budget_cents / 100).toFixed(0)}/d
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => unlinkAdSet(adset.id)}
                      className="h-6 w-6 p-0 opacity-60 hover:opacity-100"
                      title="Отвязать ad set"
                    >
                      <Unlink className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>

      {/* Link Ad Sets Dialog */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Привязать Pre-Created Ad Sets</DialogTitle>
            <DialogDescription>
              Следуйте этим шагам, чтобы привязать ad sets, созданные в Facebook Ads Manager:
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
              <li>Перейдите в Facebook Ads Manager</li>
              <li>Создайте новые ad sets и установите статус <strong>PAUSED</strong></li>
              <li>Укажите ваш конкретный номер WhatsApp в каждом ad set</li>
              <li>Скопируйте ID ad sets из URL или деталей ad set</li>
              <li>Вставьте их ниже (до {MAX_ADSETS} ad sets):</li>
            </ol>
            
            <div className="space-y-3">
              <Label>Facebook Ad Set IDs</Label>
              {fbAdSetIds.map((id, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    type="text"
                    placeholder="120232923985510449"
                    value={id}
                    onChange={(e) => updateAdSetId(index, e.target.value)}
                    disabled={isLinking}
                    className="flex-1"
                  />
                  {fbAdSetIds.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeAdSetIdInput(index)}
                      disabled={isLinking}
                      className="h-9 w-9 p-0"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              
              {fbAdSetIds.length < MAX_ADSETS && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addAdSetIdInput}
                  disabled={isLinking}
                  className="w-full"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Добавить еще Ad Set ID
                </Button>
              )}
              
              <div className="text-xs space-y-1">
                <p className="text-muted-foreground">
                  <strong>Требования:</strong>
                </p>
                <ul className="list-disc list-inside text-muted-foreground ml-2 space-y-0.5">
                  <li>Статус: <strong className="text-foreground">PAUSED</strong> (не ACTIVE, не ARCHIVED, не DELETED)</li>
                  <li>Принадлежат кампании этого направления</li>
                  <li>Лимит: {MAX_ADSETS} ad sets на направление</li>
                </ul>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setLinkDialogOpen(false);
                  setFbAdSetIds(['']);
                }}
                disabled={isLinking}
              >
                Отмена
              </Button>
              <Button
                onClick={linkAdSets}
                disabled={isLinking || !fbAdSetIds.some(id => id.trim())}
              >
                {isLinking ? 'Привязываем...' : `Привязать Ad Sets (${fbAdSetIds.filter(id => id.trim()).length})`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

