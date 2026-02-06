import React from 'react';
import { XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const PaymentFail: React.FC = () => {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-12 space-y-4">
        <Card>
          <CardHeader className="space-y-2">
            <CardTitle className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-destructive" />
              Оплата не завершена
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>Платеж не прошел или был отменен. Вы можете попробовать снова.</p>
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

export default PaymentFail;
