import React from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  PUBLISHER_PLATFORM_OPTIONS,
  FACEBOOK_PLACEMENT_OPTIONS,
  INSTAGRAM_PLACEMENT_OPTIONS,
  getPlacementSummary,
} from '@/constants/placements';

interface PlacementsSelectorProps {
  publisherPlatforms: string[];
  facebookPlacements: string[];
  instagramPlacements: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
  onReset: () => void;
  onTogglePlatform: (val: string) => void;
  onToggleFb: (val: string) => void;
  onToggleIg: (val: string) => void;
}

/**
 * Выпадающий список с чекбоксами для выбора площадок (Facebook/Instagram)
 * и конкретных плейсментов внутри каждой площадки.
 *
 * Пустые массивы = Advantage+ (Meta выбирает автоматически).
 */
export const PlacementsSelector: React.FC<PlacementsSelectorProps> = ({
  publisherPlatforms,
  facebookPlacements,
  instagramPlacements,
  open,
  onOpenChange,
  disabled = false,
  onReset,
  onTogglePlatform,
  onToggleFb,
  onToggleIg,
}) => {
  const hasAny =
    publisherPlatforms.length > 0 ||
    facebookPlacements.length > 0 ||
    instagramPlacements.length > 0;

  // Если платформы не выбраны явно — показываем обе (по умолчанию Meta использует обе)
  const activePlatforms =
    publisherPlatforms.length > 0 ? publisherPlatforms : ['facebook', 'instagram'];

  const summary = getPlacementSummary(publisherPlatforms, facebookPlacements, instagramPlacements);

  return (
    <div className="space-y-2">
      <Label>Площадки и плейсменты</Label>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className={!hasAny ? 'text-muted-foreground' : ''}>{summary}</span>
            <ChevronDown className="h-4 w-4 opacity-50 shrink-0 ml-2" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-2" align="start">
          <div className="space-y-1">
            {/* Сброс в Advantage+ */}
            <div
              className="flex items-center gap-2 rounded px-2 py-1.5 cursor-pointer hover:bg-muted"
              onClick={onReset}
            >
              <div className="flex h-4 w-4 items-center justify-center">
                {!hasAny && <Check className="h-3 w-3" />}
              </div>
              <span className="text-sm font-medium">Все площадки (Advantage+)</span>
            </div>

            <div className="border-t my-1" />

            {/* Платформы */}
            <p className="px-2 py-0.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Платформы
            </p>
            {PUBLISHER_PLATFORM_OPTIONS.map(opt => (
              <div
                key={opt.value}
                className="flex items-center gap-2 rounded px-2 py-1.5 cursor-pointer hover:bg-muted"
                onClick={() => onTogglePlatform(opt.value)}
              >
                <Checkbox
                  checked={publisherPlatforms.includes(opt.value)}
                  onCheckedChange={() => onTogglePlatform(opt.value)}
                />
                <span className="text-sm">{opt.label}</span>
              </div>
            ))}

            {/* Facebook плейсменты */}
            {activePlatforms.includes('facebook') && (
              <>
                <div className="border-t my-1" />
                <p className="px-2 py-0.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Facebook плейсменты
                </p>
                {FACEBOOK_PLACEMENT_OPTIONS.map(opt => (
                  <div
                    key={opt.value}
                    className="flex items-center gap-2 rounded px-2 py-1.5 cursor-pointer hover:bg-muted pl-4"
                    onClick={() => onToggleFb(opt.value)}
                  >
                    <Checkbox
                      checked={facebookPlacements.includes(opt.value)}
                      onCheckedChange={() => onToggleFb(opt.value)}
                    />
                    <span className="text-sm">{opt.label}</span>
                  </div>
                ))}
              </>
            )}

            {/* Instagram плейсменты */}
            {activePlatforms.includes('instagram') && (
              <>
                <div className="border-t my-1" />
                <p className="px-2 py-0.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Instagram плейсменты
                </p>
                {INSTAGRAM_PLACEMENT_OPTIONS.map(opt => (
                  <div
                    key={opt.value}
                    className="flex items-center gap-2 rounded px-2 py-1.5 cursor-pointer hover:bg-muted pl-4"
                    onClick={() => onToggleIg(opt.value)}
                  >
                    <Checkbox
                      checked={instagramPlacements.includes(opt.value)}
                      onCheckedChange={() => onToggleIg(opt.value)}
                    />
                    <span className="text-sm">{opt.label}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>
      <p className="text-xs text-muted-foreground">
        Оставьте «Advantage+» — и Meta сама выберет лучшие площадки. При выборе платформы без
        конкретных плейсментов будут использоваться все плейсменты этой платформы.
      </p>
    </div>
  );
};
