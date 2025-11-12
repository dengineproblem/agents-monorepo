/**
 * Creative Funnel Modal Component
 * 
 * Displays funnel stage distribution for a specific creative
 * Shows table with stages, lead counts, and percentages
 */

import React, { useEffect, useState } from 'react';
import { X, RefreshCw, Loader2 } from 'lucide-react';
import { getCreativeFunnelStats, triggerLeadsSync, FunnelStats } from '../services/amocrmApi';

interface CreativeFunnelModalProps {
  isOpen: boolean;
  onClose: () => void;
  creativeId: string;
  creativeName: string;
  userAccountId: string;
  directionId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export function CreativeFunnelModal({
  isOpen,
  onClose,
  creativeId,
  creativeName,
  userAccountId,
  directionId,
  dateFrom,
  dateTo,
}: CreativeFunnelModalProps) {
  const [stats, setStats] = useState<FunnelStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getCreativeFunnelStats({
        userAccountId,
        creativeId,
        directionId,
        dateFrom,
        dateTo,
      });
      setStats(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load funnel stats');
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await triggerLeadsSync(userAccountId);
      // Reload stats after sync
      await loadStats();
    } catch (err: any) {
      setError(err.message || 'Failed to sync leads');
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadStats();
    }
  }, [isOpen, creativeId, userAccountId, directionId, dateFrom, dateTo]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-3xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
              Funnel Distribution
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {creativeName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            </div>
          ) : error ? (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <p className="text-red-800 dark:text-red-200">{error}</p>
            </div>
          ) : stats && stats.total_leads > 0 ? (
            <>
              {/* Summary */}
              <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <p className="text-lg font-semibold text-blue-900 dark:text-blue-100">
                  Total Leads: {stats.total_leads}
                </p>
              </div>

              {/* Stages Table */}
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-900">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Stage
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Pipeline
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Leads
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        %
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Progress
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {stats.stages.map((stage, index) => (
                      <tr key={index} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td className="px-4 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div
                              className="w-3 h-3 rounded-full mr-3"
                              style={{ backgroundColor: stage.color || '#999' }}
                            />
                            <span className="text-sm font-medium text-gray-900 dark:text-white">
                              {stage.stage_name}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                          {stage.pipeline_name}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-right text-sm font-semibold text-gray-900 dark:text-white">
                          {stage.count}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-right text-sm font-semibold text-gray-900 dark:text-white">
                          {stage.percentage}%
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                            <div
                              className="h-2 rounded-full transition-all duration-300"
                              style={{
                                width: `${stage.percentage}%`,
                                backgroundColor: stage.color || '#3b82f6',
                              }}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="text-center py-12">
              <p className="text-gray-600 dark:text-gray-400">
                No leads found in AmoCRM for this creative
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-500 mt-2">
                Make sure leads are synced to AmoCRM and have the correct creative_id
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {syncing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            {syncing ? 'Syncing...' : 'Update from AmoCRM'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}



