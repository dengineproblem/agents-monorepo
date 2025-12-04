import React from 'react';
import { useAppContext } from '@/context/AppContext';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Building2, CheckCircle, AlertCircle, Clock, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AdAccountSwitcherProps {
  className?: string;
  showAddButton?: boolean;
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

export function AdAccountSwitcher({ className, showAddButton = true }: AdAccountSwitcherProps) {
  const {
    multiAccountEnabled,
    adAccounts,
    currentAdAccountId,
    setCurrentAdAccountId,
  } = useAppContext();

  // Открыть полный онбординг для создания нового аккаунта
  const handleAddAccount = () => {
    window.dispatchEvent(new CustomEvent('openOnboarding'));
  };

  // Не показываем если мультиаккаунтность выключена
  if (!multiAccountEnabled) {
    return null;
  }

  // Если нет аккаунтов - не показываем ничего в хедере
  // Кнопка "Добавить аккаунт" находится на главном экране Dashboard
  if (adAccounts.length === 0) {
    return null;
  }

  // Фильтруем только активные аккаунты для выбора
  const activeAccounts = adAccounts.filter(a => a.is_active);
  const currentAccount = adAccounts.find(a => a.id === currentAdAccountId);
  const canAddMore = adAccounts.length < 5;

  // Если нет активных аккаунтов - показываем предупреждение
  if (activeAccounts.length === 0) {
    return (
      <div className={cn('flex items-center gap-2 text-muted-foreground', className)}>
        <Building2 className="h-4 w-4" />
        <span className="text-sm">Нет активных аккаунтов</span>
        {showAddButton && canAddMore && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={handleAddAccount}
            title="Добавить аккаунт"
          >
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Select
        value={currentAdAccountId || undefined}
        onValueChange={(value) => setCurrentAdAccountId(value)}
      >
        <SelectTrigger className="w-[200px] h-9">
          <SelectValue placeholder="Выберите аккаунт">
            {currentAccount && (
              <div className="flex items-center gap-2">
                <Avatar className="h-5 w-5">
                  {currentAccount.page_picture_url ? (
                    <AvatarImage src={currentAccount.page_picture_url} alt={currentAccount.name} />
                  ) : null}
                  <AvatarFallback className="text-[10px] bg-muted">
                    {currentAccount.name?.charAt(0)?.toUpperCase() || 'A'}
                  </AvatarFallback>
                </Avatar>
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
            const StatusIcon = STATUS_ICONS[account.connection_status as keyof typeof STATUS_ICONS] || Clock;
            return (
              <SelectItem key={account.id} value={account.id}>
                <div className="flex items-center gap-2">
                  {/* Аватар в выпадающем списке */}
                  <Avatar className="h-5 w-5">
                    {account.page_picture_url ? (
                      <AvatarImage src={account.page_picture_url} alt={account.name} />
                    ) : null}
                    <AvatarFallback className="text-[10px] bg-muted">
                      {account.name?.charAt(0)?.toUpperCase() || 'A'}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate">{account.name}</span>
                  <StatusIcon
                    className={cn(
                      'h-3 w-3 ml-auto',
                      STATUS_COLORS[account.connection_status as keyof typeof STATUS_COLORS] || 'text-gray-400'
                    )}
                  />
                </div>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>

      {/* Кнопка добавления нового аккаунта — открывает полный онбординг */}
      {showAddButton && canAddMore && (
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={handleAddAccount}
          title="Добавить аккаунт"
        >
          <Plus className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

export default AdAccountSwitcher;
