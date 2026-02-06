import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CreditCard } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { PaymentPlanSlug } from '@/utils/paymentLinks';
import { API_BASE_URL } from '@/config/api';

const PAYMENT_PLANS: Record<
  PaymentPlanSlug,
  {
    title: string;
    description: string;
    amount: number;
  }
> = {
  '1m-49k': {
    title: 'Тариф 1 месяц',
    description: 'Стандартная подписка на 1 месяц.',
    amount: 49000,
  },
  '3m-99k': {
    title: 'Тариф 3 месяца',
    description: 'Подписка на 3 месяца.',
    amount: 99000,
  },
  '1m-35k': {
    title: 'Тариф 1 месяц (спец.)',
    description: 'Специальная стоимость для действующих клиентов.',
    amount: 35000,
  },
  'test-500': {
    title: 'Тестовый платеж',
    description: 'Тестовая оплата через Robokassa (500 KZT).',
    amount: 500,
  },
};

const PaymentPage: React.FC = () => {
  const { plan } = useParams<{ plan?: string }>();
  const [searchParams] = useSearchParams();
  const widgetRef = useRef<HTMLDivElement>(null);
  const [iframeSrc, setIframeSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const config = plan && plan in PAYMENT_PLANS ? PAYMENT_PLANS[plan as PaymentPlanSlug] : null;
  const userIdFromQuery = (searchParams.get('uid') || '').trim();
  const userIdFromStorage = (() => {
    try {
      const stored = localStorage.getItem('user');
      if (!stored) return '';
      const parsed = JSON.parse(stored);
      return typeof parsed?.id === 'string' ? parsed.id : '';
    } catch {
      return '';
    }
  })();
  const userId = userIdFromQuery || userIdFromStorage;
  const apiBase = useMemo(() => {
    if (typeof window === 'undefined') return API_BASE_URL;
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'http://localhost:8082';
    }
    return API_BASE_URL;
  }, []);

  const formattedAmount = useMemo(() => {
    if (!config) return '';
    return new Intl.NumberFormat('ru-RU').format(config.amount);
  }, [config]);

  useEffect(() => {
    if (!config) return;
    if (!userId) {
      setError('Не удалось определить пользователя. Откройте ссылку из уведомления или войдите в профиль.');
      return;
    }

    let ignore = false;
    const fetchForm = async () => {
      setLoading(true);
      setError(null);
      setIframeSrc(null);
      try {
        const params = new URLSearchParams({
          plan,
          user_id: userId,
        });
        const response = await fetch(`${apiBase}/robokassa/form?${params.toString()}`, {
          headers: userId ? { 'x-user-id': userId } : undefined,
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error || 'Не удалось загрузить форму оплаты');
        }
        if (!data?.script_src) {
          throw new Error('Не удалось получить ссылку на форму оплаты');
        }
        const resolvedIframeSrc = String(data.script_src).replace('FormSS.js', 'FormSS.if');
        if (!ignore) {
          setIframeSrc(resolvedIframeSrc);
        }
      } catch (err: any) {
        if (!ignore) {
          setError(err?.message || 'Не удалось загрузить форму оплаты');
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    };

    fetchForm();
    return () => {
      ignore = true;
    };
  }, [config, plan, userId]);

  useEffect(() => {
    if (!widgetRef.current) return;
    widgetRef.current.innerHTML = '';
  }, []);

  if (!config) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-3xl mx-auto px-4 py-12 space-y-4">
          <Button variant="ghost" className="gap-2" onClick={() => window.history.back()}>
            <ArrowLeft className="h-4 w-4" /> Назад
          </Button>
          <Card>
            <CardHeader>
              <CardTitle>Страница оплаты не найдена</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Проверьте ссылку на оплату или обратитесь в поддержку.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-12 space-y-4">
        <Button variant="ghost" className="gap-2" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4" /> Назад
        </Button>
        <Card>
          <CardHeader className="space-y-2">
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Оплата подписки
            </CardTitle>
            <div className="text-sm text-muted-foreground">
              {config.title} • {formattedAmount} KZT
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{config.description}</p>
            <div className="text-xs text-muted-foreground">
              Форма оплаты появится ниже. Если она не загрузилась, обновите страницу.
            </div>
            {loading && (
              <div className="text-sm text-muted-foreground">Загрузка формы оплаты…</div>
            )}
            {error && (
              <div className="text-sm text-destructive">{error}</div>
            )}
            <div ref={widgetRef}>
              {iframeSrc && (
                <iframe
                  title="Robokassa payment"
                  src={iframeSrc}
                  width={242}
                  height={55}
                  style={{
                    border: 0,
                    width: 242,
                    height: 55,
                    overflow: 'hidden',
                    backgroundColor: 'transparent',
                  }}
                />
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default PaymentPage;
