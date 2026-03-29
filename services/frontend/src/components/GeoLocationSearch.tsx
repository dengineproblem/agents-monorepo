import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Search, X, Loader2, ChevronDown, Globe, MapPin, Map } from 'lucide-react';
import { facebookApi, type GeoLocationResult } from '@/services/facebookApi';
import { tiktokApi, type TikTokRegionResult } from '@/services/tiktokApi';
import { GEO_GROUPS, COUNTRY_IDS, CYPRUS_GEO_IDS } from '@/constants/cities';

interface GeoLocationSearchProps {
  selectedCities: string[];
  onSelectionChange: (cities: string[]) => void;
  disabled?: boolean;
  /** ref контейнера для Popover portal */
  portalContainer?: HTMLElement | null;
  /** Платформа: facebook показывает FB поиск, tiktok — TikTok поиск */
  platform?: 'facebook' | 'tiktok';
}

const TYPE_LABELS: Record<string, string> = {
  country: 'Страна',
  region: 'Регион',
  city: 'Город',
  province: 'Провинция',
  zip: 'Индекс',
  geo_market: 'Рынок',
  electoral_district: 'Округ',
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  country: <Globe className="h-3.5 w-3.5 text-blue-500 shrink-0" />,
  region: <Map className="h-3.5 w-3.5 text-orange-500 shrink-0" />,
  province: <Map className="h-3.5 w-3.5 text-orange-500 shrink-0" />,
  city: <MapPin className="h-3.5 w-3.5 text-green-500 shrink-0" />,
};

/** Собираем плоский словарь name по id из захардкоженных групп */
const KNOWN_NAMES: Record<string, string> = {};
for (const g of GEO_GROUPS) {
  for (const item of g.items) {
    KNOWN_NAMES[item.id] = item.name;
  }
}

/** Унифицированный результат поиска */
interface SearchResult {
  id: string;
  name: string;
  type: string;
  subtitle: string;
}

export function GeoLocationSearch({
  selectedCities,
  onSelectionChange,
  disabled = false,
  portalContainer,
  platform = 'facebook',
}: GeoLocationSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'search' | 'groups'>('groups');
  const [searchedNames, setSearchedNames] = useState<Record<string, string>>({});

  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    setLoading(true);
    try {
      if (platform === 'tiktok') {
        const data = await tiktokApi.searchRegions(q);
        setSearchResults(data.map((r: TikTokRegionResult) => ({
          id: r.location_id,
          name: r.name,
          type: r.level,
          subtitle: TYPE_LABELS[r.level] || r.level,
        })));
      } else {
        const data = await facebookApi.searchGeoLocations(q, ['country', 'region', 'city'], 20);
        setSearchResults(data.map((loc: GeoLocationResult) => {
          const id = loc.type === 'country'
            ? (loc.key.length === 2 ? loc.key : loc.country_code || loc.key)
            : loc.key;
          return {
            id,
            name: loc.name,
            type: loc.type,
            subtitle: [TYPE_LABELS[loc.type] || loc.type, loc.region, loc.country_name].filter(Boolean).join(' · '),
          };
        }));
      }
    } catch {
      setSearchResults([]);
    } finally {
      setLoading(false);
    }
  }, [platform]);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (tab === 'groups') setTab('search');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 350);
  };

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const toggleGeo = (id: string, name?: string) => {
    let next: string[];
    if (selectedCities.includes(id)) {
      next = selectedCities.filter(c => c !== id);
    } else {
      if (id === 'KZ') {
        next = selectedCities.filter(c => COUNTRY_IDS.includes(c) || CYPRUS_GEO_IDS.includes(c));
        next.push(id);
      } else if (id === 'CY') {
        next = selectedCities.filter(c => !CYPRUS_GEO_IDS.includes(c));
        next.push(id);
      } else if (CYPRUS_GEO_IDS.includes(id)) {
        next = selectedCities.filter(c => c !== 'CY');
        next.push(id);
      } else if (!COUNTRY_IDS.includes(id)) {
        next = selectedCities.filter(c => c !== 'KZ');
        next.push(id);
      } else {
        next = [...selectedCities, id];
      }
    }
    if (name && !KNOWN_NAMES[id]) {
      setSearchedNames(prev => ({ ...prev, [id]: name }));
    }
    onSelectionChange(next);
  };

  const getDisplayName = (id: string) => {
    return KNOWN_NAMES[id] || searchedNames[id] || id;
  };

  const isDisabledItem = (id: string) => {
    if (disabled) return true;
    const isWholeCountry = id === 'KZ' || id === 'CY';
    const isCyprusGeo = CYPRUS_GEO_IDS.includes(id);
    const isOtherCountry = COUNTRY_IDS.includes(id) && !isWholeCountry;
    const anyCitySelected = selectedCities.some(c => !COUNTRY_IDS.includes(c) && !CYPRUS_GEO_IDS.includes(c));
    const isKZSelected = selectedCities.includes('KZ');
    const isCYSelected = selectedCities.includes('CY');

    if (id === 'KZ' && anyCitySelected) return true;
    if (!isWholeCountry && !isOtherCountry && !isCyprusGeo && isKZSelected) return true;
    if (id === 'CY' && selectedCities.some(c => CYPRUS_GEO_IDS.includes(c))) return true;
    if (isCyprusGeo && isCYSelected) return true;
    return false;
  };

  const searchLabel = platform === 'tiktok' ? 'Поиск TikTok' : 'Поиск Facebook';

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
              {selectedCities.length === 0
                ? 'Выберите гео-локации'
                : `Выбрано: ${selectedCities.length}`}
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
          {/* Поиск */}
          <div className="p-3 pb-2 border-b">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Поиск городов, стран..."
                value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
                className="h-8 pl-7 pr-7 text-sm"
                autoFocus
              />
              {loading && (
                <Loader2 className="absolute right-2 top-2.5 h-3.5 w-3.5 animate-spin text-muted-foreground" />
              )}
            </div>
            {/* Табы */}
            <div className="flex gap-1 mt-2">
              <button
                type="button"
                className={`text-xs px-2 py-1 rounded ${tab === 'groups' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
                onClick={() => { setTab('groups'); setQuery(''); setSearchResults([]); }}
              >
                Быстрый выбор
              </button>
              <button
                type="button"
                className={`text-xs px-2 py-1 rounded ${tab === 'search' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
                onClick={() => setTab('search')}
              >
                {searchLabel}
              </button>
            </div>
          </div>

          {/* Контент */}
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
                    key={`${item.type}-${item.id}`}
                    className="flex items-center gap-2 cursor-pointer text-sm py-1.5 hover:bg-accent px-2 rounded select-none"
                    onClick={() => toggleGeo(item.id, item.name)}
                  >
                    <input
                      type="checkbox"
                      checked={selectedCities.includes(item.id)}
                      onChange={() => toggleGeo(item.id, item.name)}
                      className="shrink-0"
                    />
                    {TYPE_ICONS[item.type] || <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                    <div className="min-w-0">
                      <div className="truncate">{item.name}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{item.subtitle}</div>
                    </div>
                  </div>
                ))}
              </>
            ) : (
              /* Быстрый выбор — захардкоженные группы с локальным фильтром */
              GEO_GROUPS.map(group => {
                const searchLower = query.toLowerCase();
                const filteredItems = query
                  ? group.items.filter(c => c.name.toLowerCase().includes(searchLower))
                  : group.items;
                if (filteredItems.length === 0) return null;
                return (
                  <div key={group.label} className="mb-2">
                    <div className="text-xs font-semibold text-muted-foreground px-2 py-1 uppercase tracking-wider">
                      {group.label}
                    </div>
                    {filteredItems.map(city => {
                      const itemDisabled = isDisabledItem(city.id);
                      return (
                        <div
                          key={city.id}
                          className={`flex items-center gap-2 cursor-pointer text-sm py-1 hover:bg-accent px-2 rounded select-none ${itemDisabled ? 'opacity-50' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!itemDisabled) toggleGeo(city.id, city.name);
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={selectedCities.includes(city.id)}
                            disabled={itemDisabled}
                            onChange={() => { if (!itemDisabled) toggleGeo(city.id, city.name); }}
                          />
                          <span>{city.name}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>

          {/* Выбранные теги */}
          {selectedCities.length > 0 && (
            <div className="border-t p-2">
              <div className="flex flex-wrap gap-1 mb-2">
                {selectedCities.map(id => (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 bg-accent text-xs px-2 py-0.5 rounded-full"
                  >
                    {getDisplayName(id)}
                    <X
                      className="h-3 w-3 cursor-pointer hover:text-destructive"
                      onClick={() => toggleGeo(id)}
                    />
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* OK */}
          <div className="p-2 border-t">
            <Button
              className="w-full"
              onClick={() => { setOpen(false); setQuery(''); setSearchResults([]); setTab('groups'); }}
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
