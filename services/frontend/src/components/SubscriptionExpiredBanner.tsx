import React from 'react';
import { LockKeyhole, CreditCard } from 'lucide-react';
import { buildPaymentRedirectUrl } from '@/utils/paymentLinks';
import { API_BASE_URL } from '@/config/api';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';

interface SubscriptionExpiredBannerProps {
  tarif?: string | null;
  renewalCost?: number | null;
  expiresAt?: string | null;
}

export const SubscriptionExpiredBanner: React.FC<SubscriptionExpiredBannerProps> = ({
  tarif,
  renewalCost,
  expiresAt,
}) => {
  const userId = (() => {
    try {
      return JSON.parse(localStorage.getItem('user') || '{}').id ?? null;
    } catch {
      return null;
    }
  })();

  const paymentUrl = buildPaymentRedirectUrl({
    tarif,
    renewalCost,
    userId,
    apiBaseUrl: API_BASE_URL,
  });

  const formattedDate = expiresAt
    ? new Date(expiresAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl text-center">
        <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-5">
          <LockKeyhole className="h-8 w-8 text-destructive" />
        </div>

        <h2 className="text-2xl font-bold text-foreground mb-2">
          Подписка истекла
        </h2>

        {formattedDate && (
          <p className="text-sm text-muted-foreground mb-4">
            Срок действия закончился: <span className="font-medium text-foreground">{formattedDate}</span>
          </p>
        )}

        <p className="text-muted-foreground mb-8">
          Доступ к рекламным аккаунтам и статистике заблокирован.
          Продлите подписку для продолжения работы.
        </p>

        {paymentUrl ? (
          <a href={paymentUrl} className={cn(buttonVariants(), 'w-full gap-2')}>
            <CreditCard className="h-4 w-4" />
            Оплатить подписку
          </a>
        ) : (
          <p className="text-sm text-muted-foreground">
            Обратитесь к менеджеру для продления подписки
          </p>
        )}
      </div>
    </div>
  );
};
