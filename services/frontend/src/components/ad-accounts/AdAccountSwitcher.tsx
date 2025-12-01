import React from 'react';
import { useAppContext } from '@/context/AppContext';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Building2, CheckCircle, AlertCircle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AdAccountSwitcherProps {
  className?: string;
}

const STATUS_ICONS = {
  connected: CheckCircle,
  pending: Clock,
  error: AlertCircle,
};

const STATUS_COLORS = {
  connected: 'text-green-500',
  pending: 'text-yellow-500',
  error: 'text-red-500',
};

export function AdAccountSwitcher({ className }: AdAccountSwitcherProps) {
  const {
    multiAccountEnabled,
    adAccounts,
    currentAdAccountId,
    setCurrentAdAccountId,
  } = useAppContext();

  // Не показываем если мультиаккаунтность выключена или нет аккаунтов
  if (!multiAccountEnabled || adAccounts.length === 0) {
    return null;
  }

  // Фильтруем только активные аккаунты для выбора
  const activeAccounts = adAccounts.filter(a => a.is_active);
  const currentAccount = adAccounts.find(a => a.id === currentAdAccountId);

  // Если нет активных аккаунтов - показываем предупреждение
  if (activeAccounts.length === 0) {
    return (
      <div className={cn('flex items-center gap-2 text-muted-foreground', className)}>
        <Building2 className="h-4 w-4" />
        <span className="text-sm">Нет активных аккаунтов</span>
      </div>
    );
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Building2 className="h-4 w-4 text-muted-foreground" />
      <Select
        value={currentAdAccountId || undefined}
        onValueChange={(value) => setCurrentAdAccountId(value)}
      >
        <SelectTrigger className="w-[200px] h-9">
          <SelectValue placeholder="Выберите аккаунт">
            {currentAccount && (
              <div className="flex items-center gap-2">
                <span className="truncate">{currentAccount.name}</span>
                {currentAccount.connection_status && (
                  <span className={cn('h-2 w-2 rounded-full', {
                    'bg-green-500': currentAccount.connection_status === 'connected',
                    'bg-yellow-500': currentAccount.connection_status === 'pending',
                    'bg-red-500': currentAccount.connection_status === 'error',
                  })} />
                )}
              </div>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {activeAccounts.map((account) => {
            const StatusIcon = STATUS_ICONS[account.connection_status] || Clock;
            return (
              <SelectItem key={account.id} value={account.id}>
                <div className="flex items-center gap-2">
                  <StatusIcon
                    className={cn(
                      'h-4 w-4',
                      STATUS_COLORS[account.connection_status] || 'text-gray-400'
                    )}
                  />
                  <span className="truncate">{account.name}</span>
                  {account.is_default && (
                    <span className="text-xs text-muted-foreground">(по умолчанию)</span>
                  )}
                </div>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}

export default AdAccountSwitcher;
