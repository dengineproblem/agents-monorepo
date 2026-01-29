import { useEffect, useState } from 'react';
import { useAppContext } from '@/context/AppContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Building2, CheckCircle, AlertCircle, Clock, Plus, ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AdAccountSwitcherProps {
  className?: string;
  showAddButton?: boolean;
  compact?: boolean; // Для мобильной версии - только аватар
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

export function AdAccountSwitcher({ className, showAddButton = true, compact = false }: AdAccountSwitcherProps) {
  const {
    multiAccountEnabled,
    adAccounts,
    currentAdAccountId,
    setCurrentAdAccountId,
  } = useAppContext();

  // Трекинг ошибок загрузки изображений
  const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({});
  const handleImageError = (accountId: string) => {
    setImageErrors(prev => ({ ...prev, [accountId]: true }));
  };

  // Фильтруем только активные аккаунты для выбора
  const activeAccounts = adAccounts.filter(a => a.is_active);
  const currentAccount = adAccounts.find(a => a.id === currentAdAccountId);
  const canAddMore = adAccounts.length < 5;

  // Debug: логируем при изменении аккаунта (до условных return!)
  useEffect(() => {
    if (currentAdAccountId) {
      console.log('[AdAccountSwitcher] ACCOUNT CHANGED:', {
        currentAdAccountId,
        currentAccountName: currentAccount?.name,
        currentAccountId: currentAccount?.id,
      });
    }
  }, [currentAdAccountId, currentAccount]);

  // Открыть полный онбординг для создания нового аккаунта
  const handleAddAccount = () => {
    window.dispatchEvent(new CustomEvent('openOnboarding'));
  };

  // Не показываем если мультиаккаунтность выключена
  if (!multiAccountEnabled) {
    return null;
  }

  // Если нет аккаунтов - не показываем ничего в хедере
  if (adAccounts.length === 0) {
    return null;
  }

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

  // Получаем URL аватара напрямую с Facebook Graph API
  const getAvatarSrc = (fbPageId: string | null | undefined) => {
    if (!fbPageId) return '';
    return `https://graph.facebook.com/${fbPageId}/picture?type=large`;
  };

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {compact ? (
            // Компактный режим для мобильных - только аватар
            <Button
              key={`btn-compact-${currentAdAccountId}`}
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full p-0"
              data-current-account={currentAccount?.name}
            >
              {currentAccount?.fb_page_id && !imageErrors[currentAccount.id] ? (
                <img
                  key={currentAccount.id}
                  src={getAvatarSrc(currentAccount.fb_page_id)}
                  alt={currentAccount.name}
                  className="h-7 w-7 rounded-full object-cover"
                  referrerPolicy="no-referrer"
                  loading="eager"
                  onError={() => handleImageError(currentAccount.id)}
                />
              ) : (
                <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
                  {currentAccount?.name?.charAt(0)?.toUpperCase() || 'A'}
                </div>
              )}
              {currentAccount?.connection_status && (
                <span className={cn('absolute bottom-0 right-0 h-2 w-2 rounded-full border border-background', {
                  'bg-green-500': currentAccount.connection_status === 'connected',
                  'bg-yellow-500': currentAccount.connection_status === 'pending',
                  'bg-red-500': currentAccount.connection_status === 'error',
                })} />
              )}
            </Button>
          ) : (
            // Полный режим для десктопа
            <Button
              key={`btn-${currentAdAccountId}`}
              variant="outline"
              className="w-[200px] h-9 justify-between px-3"
              data-current-account={currentAccount?.name}
            >
              {currentAccount ? (
                <div key={currentAccount.id} className="flex items-center gap-2 flex-1 min-w-0">
                  {/* Аватар напрямую с Facebook Graph API */}
                  {currentAccount.fb_page_id && !imageErrors[currentAccount.id] ? (
                    <img
                      key={currentAccount.id}
                      src={getAvatarSrc(currentAccount.fb_page_id)}
                      alt={currentAccount.name}
                      className="h-5 w-5 rounded-full flex-shrink-0 object-cover"
                      referrerPolicy="no-referrer"
                      loading="eager"
                      onError={() => handleImageError(currentAccount.id)}
                    />
                  ) : (
                    <div className="h-5 w-5 rounded-full flex-shrink-0 bg-muted flex items-center justify-center text-[10px]">
                      {currentAccount.name?.charAt(0)?.toUpperCase() || 'A'}
                    </div>
                  )}
                  <span key={`name-${currentAccount.id}`} className="truncate flex-1 text-left">
                    {currentAccount.name}
                  </span>
                  {currentAccount.connection_status && (
                    <span className={cn('h-2 w-2 rounded-full flex-shrink-0', {
                      'bg-green-500': currentAccount.connection_status === 'connected',
                      'bg-yellow-500': currentAccount.connection_status === 'pending',
                      'bg-red-500': currentAccount.connection_status === 'error',
                    })} />
                  )}
                </div>
              ) : (
                <span className="text-muted-foreground">Выберите аккаунт</span>
              )}
              <ChevronDown className="h-4 w-4 opacity-50 flex-shrink-0 ml-2" />
            </Button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[200px]">
          {activeAccounts.map((account) => {
            const StatusIcon = STATUS_ICONS[account.connection_status as keyof typeof STATUS_ICONS] || Clock;
            const isSelected = account.id === currentAdAccountId;
            return (
              <DropdownMenuItem
                key={account.id}
                onClick={() => {
                  console.log('[AdAccountSwitcher] select:', account.name);
                  setCurrentAdAccountId(account.id);
                }}
                className="cursor-pointer"
              >
                <div className="flex items-center gap-2 flex-1">
                  <Avatar className="h-5 w-5">
                    {account.fb_page_id && !imageErrors[account.id] ? (
                      <AvatarImage
                        src={getAvatarSrc(account.fb_page_id)}
                        alt={account.name}
                        referrerPolicy="no-referrer"
                        onError={() => handleImageError(account.id)}
                      />
                    ) : null}
                    <AvatarFallback className="text-[10px] bg-muted">
                      {account.name?.charAt(0)?.toUpperCase() || 'A'}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate flex-1">{account.name}</span>
                  {isSelected ? (
                    <Check className="h-4 w-4 text-primary flex-shrink-0" />
                  ) : (
                    <StatusIcon
                      className={cn(
                        'h-3 w-3 flex-shrink-0',
                        STATUS_COLORS[account.connection_status as keyof typeof STATUS_COLORS] || 'text-gray-400'
                      )}
                    />
                  )}
                </div>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Кнопка добавления нового аккаунта */}
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
