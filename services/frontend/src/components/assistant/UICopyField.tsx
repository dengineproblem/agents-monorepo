import { useState } from 'react';
import { Copy, Check, Phone, Link, Hash } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CopyFieldData } from '@/types/assistantUI';

interface UICopyFieldProps {
  data: CopyFieldData;
}

const iconMap = {
  phone: Phone,
  link: Link,
  id: Hash,
} as const;

export function UICopyField({ data }: UICopyFieldProps) {
  const { label, value, icon } = data;
  const [copied, setCopied] = useState(false);

  const Icon = icon ? iconMap[icon] : null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {

    }
  };

  return (
    <div className="flex items-center gap-2 bg-muted/50 rounded-md px-3 py-2">
      {Icon && <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />}

      <div className="flex-1 min-w-0">
        {label && (
          <span className="text-xs text-muted-foreground mr-2">{label}:</span>
        )}
        <span className="font-mono text-sm truncate">{value}</span>
      </div>

      <button
        onClick={handleCopy}
        className={cn(
          'p-1 rounded hover:bg-muted transition-colors flex-shrink-0',
          copied && 'text-green-600'
        )}
        title={copied ? 'Скопировано!' : 'Копировать'}
      >
        {copied ? (
          <Check className="h-4 w-4" />
        ) : (
          <Copy className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}

export default UICopyField;
