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
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Plus, RefreshCw, Unlink, ExternalLink } from 'lucide-react';

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
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Linked Ad Sets</CardTitle>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={syncAdSets}
              disabled={isSyncing || adsets.length === 0}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
              Sync
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => setLinkDialogOpen(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              Link Ad Set
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-4 text-muted-foreground">
            Loading ad sets...
          </div>
        ) : adsets.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p className="mb-2">No ad sets linked yet.</p>
            <p className="text-sm">Create ad sets in Facebook Ads Manager and link them here.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {adsets.map((adset) => (
              <div
                key={adset.id}
                className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50 transition-colors"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium">{adset.adset_name}</span>
                    <span className={`text-xs px-2 py-1 rounded-full ${getStatusColor(adset.status)}`}>
                      {adset.status}
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground space-y-1">
                    <div>Facebook ID: {adset.fb_adset_id}</div>
                    <div className="flex gap-4">
                      <span>Ads: {adset.ads_count} / 50</span>
                      <span>Budget: ${(adset.daily_budget_cents / 100).toFixed(2)}/day</span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(`https://business.facebook.com/adsmanager/manage/adsets?act=${adset.fb_adset_id}`, '_blank')}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => unlinkAdSet(adset.id)}
                  >
                    <Unlink className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {/* Link Ad Set Dialog */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link Pre-Created Ad Set</DialogTitle>
            <DialogDescription>
              Follow these steps to link an ad set created in Facebook Ads Manager:
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
              <li>Go to Facebook Ads Manager</li>
              <li>Create a new ad set in <strong>PAUSED</strong> status</li>
              <li>Set your specific WhatsApp number in the ad set</li>
              <li>Copy the ad set ID from the URL or ad set details</li>
              <li>Paste it below:</li>
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
                The ad set must be in PAUSED status and belong to this direction's campaign.
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
                Cancel
              </Button>
              <Button
                onClick={linkAdSet}
                disabled={isLinking || !fbAdSetId.trim()}
              >
                {isLinking ? 'Linking...' : 'Link Ad Set'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

