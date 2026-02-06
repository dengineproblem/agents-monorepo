import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const PaymentSuccess: React.FC = () => {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-12 space-y-4">
        <Card>
          <CardHeader className="space-y-2">
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              Оплата успешна
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>Платеж принят. Подписка обновится автоматически в течение нескольких минут.</p>
            <p>Если доступ не обновился, напишите в поддержку или попробуйте зайти позже.</p>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button asChild>
                <a href="/profile">Перейти в профиль</a>
              </Button>
              <Button asChild variant="outline">
                <a href="/">На главную</a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default PaymentSuccess;
