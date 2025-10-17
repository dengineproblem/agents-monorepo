import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Instagram, CheckCircle2, CircleDashed, Link } from 'lucide-react';
import { toast } from 'sonner';

// TikTok icon SVG
const TikTokIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/>
  </svg>
);

export interface ConnectionItem {
  id: 'instagram' | 'tiktok';
  title: string;
  connected: boolean;
  onClick: () => void;
  disabled?: boolean;
}

const brandBg: Record<ConnectionItem['id'], string> = {
  instagram: 'bg-gradient-to-br from-purple-500/10 to-pink-500/10 text-pink-600',
  tiktok: 'bg-gradient-to-br from-cyan-500/10 to-blue-500/10 text-cyan-600',
};

const brandIcon: Record<ConnectionItem['id'], React.ReactNode> = {
  instagram: <Instagram className="h-5 w-5" />,
  tiktok: <TikTokIcon />,
};

interface ConnectionsGridProps {
  items: ConnectionItem[];
}

const ConnectionsGrid: React.FC<ConnectionsGridProps> = ({ items }) => {
  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-lg flex items-center gap-2">
          <Link className="h-5 w-5" />
          Подключения
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {items.map((it) => (
          <Card
            key={it.id}
            className={`transition-all ${it.disabled ? 'opacity-60' : ''} hover:shadow-md border-muted`}
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
                        <span className="text-emerald-600">Подключено</span>
                      </>
                    ) : (
                      <>
                        <CircleDashed className="h-3.5 w-3.5" />
                        <span>Не подключено</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <Button
                variant={it.connected ? "outline" : "default"}
                size="sm"
                onClick={it.onClick}
                disabled={it.disabled}
                className="transition-all hover:shadow-sm"
              >
                {it.connected ? 'Отключить' : 'Подключить'}
              </Button>
            </CardContent>
          </Card>
        ))}
      </CardContent>
    </Card>
  );
};

export default ConnectionsGrid;
