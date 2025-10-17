import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CalendarDays, Lock, User } from 'lucide-react';
import { cn } from '@/lib/utils';

type Tarif = 'ai_target' | 'target' | 'ai_manager' | 'complex';

export interface TariffInfoCardProps {
  username?: string | null;
  email?: string | null;
  tarif?: Tarif; // может быть не указан
  expiry?: string | null; // формат уже подготовлен
  onChangePassword: () => void;
  className?: string;
}

const TARIF_LABELS: Record<Tarif, string> = {
  ai_target: 'AI Target',
  target: 'Target',
  ai_manager: 'AI Manager',
  complex: 'Complex',
};

const TARIF_BADGE_COLORS: Record<Tarif, string> = {
  ai_target:
    'bg-gradient-to-r from-gray-600/10 to-gray-500/10 text-foreground ring-1 ring-inset ring-gray-500/20',
  target:
    'bg-gradient-to-r from-gray-600/10 to-gray-500/10 text-foreground ring-1 ring-inset ring-gray-500/20',
  ai_manager:
    'bg-gradient-to-r from-gray-600/10 to-gray-500/10 text-foreground ring-1 ring-inset ring-gray-500/20',
  complex:
    'bg-gradient-to-r from-gray-600/10 to-gray-500/10 text-foreground ring-1 ring-inset ring-gray-500/20',
};

const TariffInfoCard: React.FC<TariffInfoCardProps> = ({
  username,
  email,
  tarif,
  expiry,
  onChangePassword,
  className,
}) => {
  const tarifBadge = tarif ? (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium',
        TARIF_BADGE_COLORS[tarif]
      )}
    >
      {TARIF_LABELS[tarif]}
    </span>
  ) : (
    <span className="text-muted-foreground text-sm">—</span>
  );

  return (
    <Card className={cn('overflow-hidden shadow-sm', className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <User className="h-5 w-5" />
          Основная информация
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-muted-foreground">Имя пользователя:</span>{' '}
              <b>{username || '—'}</b>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Тариф:</span>
              {tarifBadge}
            </div>
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              Действителен до: <b>{expiry || 'Не указано'}</b>
            </div>
          </div>
          <div className="flex md:justify-end items-start">
            <Button onClick={onChangePassword} variant="outline" className="gap-2">
              <Lock className="h-4 w-4" /> Сменить пароль
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default TariffInfoCard;

