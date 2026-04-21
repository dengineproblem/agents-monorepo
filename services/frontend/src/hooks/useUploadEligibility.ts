import { useEffect, useState } from 'react';
import { adAccountsApi, type UploadEligibilityResponse } from '@/services/adAccountsApi';

interface UseUploadEligibilityResult {
  eligibility: UploadEligibilityResponse | null;
  loading: boolean;
  refetch: () => void;
}

/**
 * Проверяет, может ли юзер загружать креативы в выбранный Meta-кабинет.
 * Для TikTok сразу возвращает canUpload: true — там нет понятия задолженности (prepaid).
 *
 * @param userId — UUID пользователя (user_accounts.id)
 * @param accountId — UUID из ad_accounts.id, либо null для single-account режима
 * @param platform — 'instagram' (Meta) | 'tiktok'
 */
export function useUploadEligibility(
  userId: string | null,
  accountId: string | null,
  platform: 'instagram' | 'tiktok'
): UseUploadEligibilityResult {
  const [eligibility, setEligibility] = useState<UploadEligibilityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!userId) {
      setEligibility(null);
      return;
    }

    // TikTok: prepaid — задолженности нет, пропускаем проверку
    if (platform === 'tiktok') {
      setEligibility({
        canUpload: true,
        reason: 'ok',
        message: null,
        accountStatus: null,
        fbAdAccountId: null,
      });
      return;
    }

    let cancelled = false;
    setLoading(true);
    const resolvedAccountId = accountId ?? 'legacy';

    adAccountsApi.getUploadEligibility(userId, resolvedAccountId)
      .then(result => {
        if (!cancelled) setEligibility(result);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [userId, accountId, platform, reloadKey]);

  return {
    eligibility,
    loading,
    refetch: () => setReloadKey(k => k + 1),
  };
}
