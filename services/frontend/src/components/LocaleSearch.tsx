import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Search, X, Loader2, ChevronDown, Languages } from 'lucide-react';
import { facebookApi, type LocaleResult } from '@/services/facebookApi';

interface LocaleSearchProps {
  selectedLocales: number[];
  onSelectionChange: (locales: number[]) => void;
  disabled?: boolean;
  /** ref контейнера для Popover portal */
  portalContainer?: HTMLElement | null;
}

/** Часто используемые языки для быстрого выбора (ID = Facebook locale key) */
const QUICK_LOCALES: { id: number; name: string }[] = [
  { id: 6, name: 'Russian' },
  { id: 26, name: 'English (US)' },
  { id: 27, name: 'English (UK)' },
  { id: 96, name: 'Kazakh' },
  { id: 87, name: 'Ukrainian' },
  { id: 50, name: 'Turkish' },
  { id: 7, name: 'Spanish' },
  { id: 5, name: 'German' },
];

const QUICK_NAMES: Record<number, string> = QUICK_LOCALES.reduce(
  (acc, l) => ({ ...acc, [l.id]: l.name }),
  {} as Record<number, string>
);

export function LocaleSearch({
  selectedLocales,
  onSelectionChange,
  disabled = false,
  portalContainer,
}: LocaleSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<LocaleResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'search' | 'quick'>('quick');
  const [searchedNames, setSearchedNames] = useState<Record<number, string>>({});

  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    setLoading(true);
    try {
      const data = await facebookApi.searchLocales(q, 25);
      setSearchResults(data);
    } catch {
      setSearchResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (tab === 'quick') setTab('search');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 350);
  };

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const toggleLocale = (id: number, name?: string) => {
    const next = selectedLocales.includes(id)
      ? selectedLocales.filter(l => l !== id)
      : [...selectedLocales, id];
    if (name && !QUICK_NAMES[id]) {
      setSearchedNames(prev => ({ ...prev, [id]: name }));
    }
    onSelectionChange(next);
  };

  const getDisplayName = (id: number) =>
    QUICK_NAMES[id] || searchedNames[id] || `#${id}`;

  const popoverContentProps: Record<string, unknown> = {};
  if (portalContainer) {
    popoverContentProps.container = portalContainer;
  }

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            disabled={disabled}
            className="w-full justify-between"
          >
            <span>
              {selectedLocales.length === 0
                ? 'Все языки (по умолчанию)'
                : `Выбрано: ${selectedLocales.length}`}
            </span>
            <ChevronDown className="h-4 w-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          {...popoverContentProps}
          className="z-50 w-80 max-h-[420px] p-0 flex flex-col"
          side="bottom"
          align="start"
          sideOffset={6}
        >
          <div className="p-3 pb-2 border-b">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Поиск языков (например, Russian)..."
                value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
                className="h-8 pl-7 pr-7 text-sm"
                autoFocus
              />
              {loading && (
                <Loader2 className="absolute right-2 top-2.5 h-3.5 w-3.5 animate-spin text-muted-foreground" />
              )}
            </div>
            <div className="flex gap-1 mt-2">
              <button
                type="button"
                className={`text-xs px-2 py-1 rounded ${tab === 'quick' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
                onClick={() => { setTab('quick'); setQuery(''); setSearchResults([]); }}
              >
                Быстрый выбор
              </button>
              <button
                type="button"
                className={`text-xs px-2 py-1 rounded ${tab === 'search' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
                onClick={() => setTab('search')}
              >
                Поиск Facebook
              </button>
            </div>
          </div>

          <div className="overflow-y-auto p-2 flex-1 min-h-0 max-h-[300px]">
            {tab === 'search' ? (
              <>
                {!loading && searchResults.length === 0 && query.length >= 2 && (
                  <div className="text-sm text-muted-foreground text-center py-4">
                    Ничего не найдено
                  </div>
                )}
                {!loading && query.length < 2 && (
                  <div className="text-sm text-muted-foreground text-center py-4">
                    Введите минимум 2 символа для поиска
                  </div>
                )}
                {searchResults.map((item) => (
                  <div
                    key={item.key}
                    className="flex items-center gap-2 cursor-pointer text-sm py-1.5 hover:bg-accent px-2 rounded select-none"
                    onClick={() => toggleLocale(item.key, item.name)}
                  >
                    <input
                      type="checkbox"
                      checked={selectedLocales.includes(item.key)}
                      onChange={() => toggleLocale(item.key, item.name)}
                      className="shrink-0"
                    />
                    <Languages className="h-3.5 w-3.5 text-purple-500 shrink-0" />
                    <div className="min-w-0 truncate">{item.name}</div>
                  </div>
                ))}
              </>
            ) : (
              QUICK_LOCALES.map((loc) => (
                <div
                  key={loc.id}
                  className="flex items-center gap-2 cursor-pointer text-sm py-1 hover:bg-accent px-2 rounded select-none"
                  onClick={() => toggleLocale(loc.id, loc.name)}
                >
                  <input
                    type="checkbox"
                    checked={selectedLocales.includes(loc.id)}
                    onChange={() => toggleLocale(loc.id, loc.name)}
                  />
                  <Languages className="h-3.5 w-3.5 text-purple-500 shrink-0" />
                  <span>{loc.name}</span>
                </div>
              ))
            )}
          </div>

          {selectedLocales.length > 0 && (
            <div className="border-t p-2">
              <div className="flex flex-wrap gap-1 mb-2">
                {selectedLocales.map(id => (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 bg-accent text-xs px-2 py-0.5 rounded-full"
                  >
                    {getDisplayName(id)}
                    <X
                      className="h-3 w-3 cursor-pointer hover:text-destructive"
                      onClick={() => toggleLocale(id)}
                    />
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="p-2 border-t">
            <Button
              className="w-full"
              onClick={() => { setOpen(false); setQuery(''); setSearchResults([]); setTab('quick'); }}
              variant="outline"
              size="sm"
            >
              ОК
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
