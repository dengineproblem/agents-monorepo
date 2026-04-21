import { AlertCircle, ExternalLink } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

interface UploadBlockedBannerProps {
  message: string;
  fbAdAccountId: string | null;
}

function buildBillingUrl(fbAdAccountId: string | null): string {
  if (!fbAdAccountId) return 'https://www.facebook.com/ads/manager/account_settings/account_billing/';
  const normalized = fbAdAccountId.startsWith('act_') ? fbAdAccountId.slice(4) : fbAdAccountId;
  return `https://www.facebook.com/ads/manager/account_settings/account_billing/?act=${normalized}`;
}

export function UploadBlockedBanner({ message, fbAdAccountId }: UploadBlockedBannerProps) {
  return (
    <Alert variant="destructive" className="mb-2">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Загрузка креативов недоступна</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>{message}</p>
        <Button asChild variant="outline" size="sm">
          <a href={buildBillingUrl(fbAdAccountId)} target="_blank" rel="noopener noreferrer">
            Открыть биллинг в Ads Manager
            <ExternalLink className="ml-2 h-3 w-3" />
          </a>
        </Button>
      </AlertDescription>
    </Alert>
  );
}
