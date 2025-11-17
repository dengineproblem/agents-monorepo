import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Instagram, CheckCircle2, CircleDashed, Link, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '../../i18n/LanguageContext';

// TikTok icon SVG
const TikTokIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/>
  </svg>
);

// AmoCRM icon SVG
const AmoCRMIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5zm0 18c-3.86-.92-7-5.17-7-9V8.5l7-3.5 7 3.5V11c0 3.83-3.14 8.08-7 9z"/>
    <circle cx="12" cy="12" r="3" fill="currentColor"/>
  </svg>
);

export interface ConnectionItem {
  id: 'facebook' | 'instagram' | 'tiktok' | 'amocrm';
  title: string;
  connected: boolean;
  onClick: () => void;
  disabled?: boolean;
  badge?: string;
}

const brandBg: Record<ConnectionItem['id'], string> = {
  facebook: 'bg-gradient-to-br from-blue-500/10 to-indigo-500/10 text-blue-600',
  instagram: 'bg-gradient-to-br from-purple-500/10 to-pink-500/10 text-pink-600',
  tiktok: 'bg-gradient-to-br from-cyan-500/10 to-blue-500/10 text-cyan-600',
  amocrm: 'bg-gradient-to-br from-green-500/10 to-emerald-500/10 text-green-600',
};

const FacebookIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
  </svg>
);

const brandIcon: Record<ConnectionItem['id'], React.ReactNode> = {
  facebook: <FacebookIcon />,
  instagram: <Instagram className="h-5 w-5" />,
  tiktok: <TikTokIcon />,
  amocrm: <AmoCRMIcon />,
};

interface ConnectionsGridProps {
  items: ConnectionItem[];
}

const ConnectionsGrid: React.FC<ConnectionsGridProps> = ({ items }) => {
  const { t } = useTranslation();
  
  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-lg flex items-center gap-2">
          <Link className="h-5 w-5" />
          {t('profile.connections')}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {items.map((it) => (
          <Card
            key={it.id}
            className={`transition-all ${it.disabled ? 'opacity-60' : 'cursor-pointer'} hover:shadow-md border-muted`}
            onClick={it.disabled ? undefined : it.onClick}
          >
            <CardContent className="p-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`h-11 w-11 rounded-xl flex items-center justify-center ${brandBg[it.id]} shadow-sm`}>
                  {brandIcon[it.id]}
                </div>
                <div>
                  <div className="font-semibold text-base">{it.title}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                    {it.connected ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        <span className="text-emerald-600">{t('profile.connected')}</span>
                        {it.badge && (
                          <span className="ml-1 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-medium">
                            {it.badge}
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        <CircleDashed className="h-3.5 w-3.5" />
                        <span>{t('profile.notConnected')}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <Button
                variant={it.connected ? "outline" : "default"}
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  console.log('[ConnectionsGrid] Button clicked:', it.id, it.connected);
                  it.onClick();
                }}
                disabled={it.disabled}
                className="transition-all hover:shadow-sm px-2 sm:px-4"
              >
                {it.connected ? (
                  <>
                    <X className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">{t('profile.disconnect')}</span>
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">{t('profile.connect')}</span>
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        ))}
      </CardContent>
    </Card>
  );
};

export default ConnectionsGrid;
