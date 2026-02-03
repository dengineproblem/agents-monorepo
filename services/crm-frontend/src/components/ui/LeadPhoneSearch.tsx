import { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Lead {
  id: string;
  contact_name?: string;
  contact_phone: string;
}

interface LeadPhoneSearchProps {
  leads: Lead[];
  value?: string;
  onChange: (leadId: string | undefined) => void;
  placeholder?: string;
  className?: string;
  allowNone?: boolean;
}

export function LeadPhoneSearch({
  leads,
  value,
  onChange,
  placeholder = 'Введите номер телефона...',
  className,
  allowNone = true,
}: LeadPhoneSearchProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Найти выбранного лида
  const selectedLead = value ? leads.find((lead) => lead.id === value) : undefined;

  // Фильтрация лидов по номеру телефона
  const filteredLeads = leads.filter((lead) => {
    if (!searchValue) return true;
    // Удаляем все нецифровые символы для поиска
    const cleanSearch = searchValue.replace(/\D/g, '');
    const cleanPhone = lead.contact_phone.replace(/\D/g, '');
    return cleanPhone.includes(cleanSearch);
  });

  // Закрытие при клике вне компонента
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setSearchValue(newValue);
    setIsOpen(true);

    // Если очистили input, сбрасываем выбор
    if (!newValue && selectedLead) {
      onChange(undefined);
    }
  };

  const handleSelectLead = (lead: Lead | null) => {
    if (lead) {
      onChange(lead.id);
      setSearchValue(lead.contact_phone);
    } else {
      onChange(undefined);
      setSearchValue('');
    }
    setIsOpen(false);
    inputRef.current?.blur();
  };

  const handleClear = () => {
    setSearchValue('');
    onChange(undefined);
    setIsOpen(false);
  };

  const handleFocus = () => {
    setIsOpen(true);
  };

  // Отображаемое значение в input
  const displayValue = selectedLead
    ? `${selectedLead.contact_phone}${selectedLead.contact_name ? ` (${selectedLead.contact_name})` : ''}`
    : searchValue;

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          type="text"
          value={displayValue}
          onChange={handleInputChange}
          onFocus={handleFocus}
          placeholder={placeholder}
          className="pl-10 pr-8"
        />
        {selectedLead && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Dropdown список */}
      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-md max-h-60 overflow-auto">
          {allowNone && (
            <button
              type="button"
              onClick={() => handleSelectLead(null)}
              className={cn(
                'w-full text-left px-3 py-2 text-sm hover:bg-accent cursor-pointer',
                !selectedLead && 'bg-accent'
              )}
            >
              <span className="text-muted-foreground">Без лида</span>
            </button>
          )}

          {filteredLeads.length === 0 ? (
            <div className="px-3 py-4 text-sm text-muted-foreground text-center">
              {searchValue ? 'Лиды не найдены' : 'Нет доступных лидов'}
            </div>
          ) : (
            filteredLeads.map((lead) => (
              <button
                key={lead.id}
                type="button"
                onClick={() => handleSelectLead(lead)}
                className={cn(
                  'w-full text-left px-3 py-2 text-sm hover:bg-accent cursor-pointer border-b last:border-0',
                  selectedLead?.id === lead.id && 'bg-accent'
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="font-medium">{lead.contact_phone}</div>
                    {lead.contact_name && (
                      <div className="text-xs text-muted-foreground mt-0.5">{lead.contact_name}</div>
                    )}
                  </div>
                  {selectedLead?.id === lead.id && (
                    <svg
                      className="h-4 w-4 text-primary"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path d="M5 13l4 4L19 7"></path>
                    </svg>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
