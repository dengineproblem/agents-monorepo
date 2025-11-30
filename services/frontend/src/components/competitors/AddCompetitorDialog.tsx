import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Loader2, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { competitorsApi } from '@/services/competitorsApi';
import { toast } from 'sonner';
import type { Competitor } from '@/types/competitor';
import { useTranslation } from '@/i18n/LanguageContext';

interface AddCompetitorDialogProps {
  userAccountId: string;
  onAdded: (competitor: Competitor) => void;
}

const COUNTRIES = [
  { code: 'KZ', label: 'Казахстан' },
  { code: 'RU', label: 'Россия' },
  { code: 'BY', label: 'Беларусь' },
  { code: 'UA', label: 'Украина' },
  { code: 'UZ', label: 'Узбекистан' },
  { code: 'ALL', label: 'Все страны' },
];

export function AddCompetitorDialog({ userAccountId, onAdded }: AddCompetitorDialogProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [socialUrl, setSocialUrl] = useState('');
  const [name, setName] = useState('');
  const [countryCode, setCountryCode] = useState('ALL');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!socialUrl.trim()) {
      setError('Введите ссылку на Instagram или Facebook');
      return;
    }

    if (!name.trim()) {
      setError('Введите название конкурента');
      return;
    }

    setLoading(true);

    try {
      const result = await competitorsApi.add({
        userAccountId,
        socialUrl: socialUrl.trim(),
        name: name.trim(),
        countryCode,
      });

      if (result.success && result.competitor) {
        toast.success(`Конкурент "${name}" добавлен`);
        onAdded(result.competitor);
        setOpen(false);
        // Reset form
        setSocialUrl('');
        setName('');
        setCountryCode('ALL');
      } else {
        setError(result.error || 'Не удалось добавить конкурента');
      }
    } catch (err: any) {
      setError(err.message || 'Произошла ошибка');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="w-4 h-4 mr-2" />
          {t('competitors.add')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t('competitors.addTitle')}</DialogTitle>
            <DialogDescription>
              {t('competitors.addDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="grid gap-2">
              <Label htmlFor="name">{t('competitors.name')}</Label>
              <Input
                id="name"
                placeholder="Название бренда/конкурента"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={loading}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="socialUrl">Instagram / Facebook</Label>
              <Input
                id="socialUrl"
                placeholder="@username или instagram.com/username"
                value={socialUrl}
                onChange={(e) => setSocialUrl(e.target.value)}
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                Введите @username, ссылку на Instagram или Facebook
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="country">{t('competitors.country')}</Label>
              <Select value={countryCode} onValueChange={setCountryCode} disabled={loading}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COUNTRIES.map((country) => (
                    <SelectItem key={country.code} value={country.code}>
                      {country.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Страна для поиска креативов в Ads Library
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {t('competitors.adding')}
                </>
              ) : (
                t('competitors.add')
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
