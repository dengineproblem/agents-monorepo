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
import { Plus, RefreshCw, Unlink, ChevronDown, ChevronUp } from 'lucide-react';

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
  const [fbAdSetId, setFbAdSetId] = useState('');
  const [isLinking, setIsLinking] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  // Fetch ad sets for this direction
  const fetchAdSets = async () => {
    setIsLoading(true);
    try {
      const url = `${API_BASE_URL}/directions/${directionId}/adsets?user_account_id=${userAccountId}`;
      console.log('[DirectionAdSets] Fetching from:', url);
      console.log('[DirectionAdSets] API_BASE_URL:', API_BASE_URL);
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error('Failed to fetch ad sets');
      }

      const data = await response.json();
      setAdsets(data.adsets || []);
    } catch (error) {
      console.error('Error fetching ad sets:', error);
      toast.error('Failed to load ad sets');
    } finally {
      setIsLoading(false);
    }
  };

  // Link a new ad set
  const linkAdSet = async () => {
    if (!fbAdSetId.trim()) {
      toast.error('Please enter an ad set ID');
      return;
    }

    setIsLinking(true);
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
        throw new Error(data.error || 'Failed to link ad set');
      }

      toast.success('Ad set linked successfully!');
      setLinkDialogOpen(false);
      setFbAdSetId('');
      fetchAdSets();
    } catch (error: any) {
      console.error('Error linking ad set:', error);
      toast.error(error.message || 'Failed to link ad set');
    } finally {
      setIsLinking(false);
    }
  };

  // Unlink an ad set
  const unlinkAdSet = async (adsetId: string) => {
    if (!confirm('Are you sure you want to unlink this ad set?')) {
      return;
    }

    try {
      const response = await fetch(
        `${API_BASE_URL}/directions/${directionId}/adsets/${adsetId}?user_account_id=${userAccountId}`,
        { method: 'DELETE' }
      );

      if (!response.ok) {
        throw new Error('Failed to unlink ad set');
      }

      toast.success('Ad set unlinked');
      fetchAdSets();
    } catch (error) {
      console.error('Error unlinking ad set:', error);
      toast.error('Failed to unlink ad set');
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
      console.error('Error syncing ad sets:', error);
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
                onClick={() => setLinkDialogOpen(true)}
                className="h-8"
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

      {/* Link Ad Set Dialog */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Привязать Pre-Created Ad Set</DialogTitle>
            <DialogDescription>
              Следуйте этим шагам, чтобы привязать ad set, созданный в Facebook Ads Manager:
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
              <li>Перейдите в Facebook Ads Manager</li>
              <li>Создайте новый ad set в статусе <strong>PAUSED</strong></li>
              <li>Укажите ваш конкретный номер WhatsApp в ad set</li>
              <li>Скопируйте ID ad set из URL или деталей ad set</li>
              <li>Вставьте его ниже:</li>
            </ol>
            
            <div className="space-y-2">
              <Label htmlFor="fb-adset-id">Facebook Ad Set ID</Label>
              <Input
                id="fb-adset-id"
                type="text"
                placeholder="120232923985510449"
                value={fbAdSetId}
                onChange={(e) => setFbAdSetId(e.target.value)}
                disabled={isLinking}
              />
              <p className="text-xs text-muted-foreground">
                Ad set должен быть в статусе PAUSED и принадлежать кампании этого направления.
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setLinkDialogOpen(false);
                  setFbAdSetId('');
                }}
                disabled={isLinking}
              >
                Отмена
              </Button>
              <Button
                onClick={linkAdSet}
                disabled={isLinking || !fbAdSetId.trim()}
              >
                {isLinking ? 'Привязываем...' : 'Привязать Ad Set'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

