import { useState, useMemo } from 'react';
import {
  Bug,
  Clock,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  Play,
  Info,
  Layers,
  List,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import type { StreamEventLayer, LayerStatus } from '@/services/assistantApi';
import { LAYER_LABELS } from '@/services/assistantApi';

export interface LayerLog {
  layer: number;
  name: string;
  status: LayerStatus;
  data?: Record<string, unknown>;
  timestamp: number;
  duration_ms?: number;
  error?: string;
  message?: string;
}

interface DebugLogsModalProps {
  logs: LayerLog[];
  open: boolean;
  onClose: () => void;
}

const STATUS_CONFIG: Record<LayerStatus, { icon: typeof Play; color: string; label: string }> = {
  start: { icon: Play, color: 'text-blue-500', label: 'Start' },
  end: { icon: CheckCircle2, color: 'text-green-500', label: 'End' },
  error: { icon: AlertCircle, color: 'text-red-500', label: 'Error' },
  info: { icon: Info, color: 'text-gray-500', label: 'Info' },
};

export function DebugLogsModal({ logs, open, onClose }: DebugLogsModalProps) {
  const [view, setView] = useState<'timeline' | 'layers'>('timeline');

  // Group logs by layer for layer view
  const logsByLayer = useMemo(() => {
    const grouped: Record<number, LayerLog[]> = {};
    for (const log of logs) {
      if (!grouped[log.layer]) {
        grouped[log.layer] = [];
      }
      grouped[log.layer].push(log);
    }
    return grouped;
  }, [logs]);

  // Calculate total duration
  const totalDuration = useMemo(() => {
    if (logs.length === 0) return 0;
    const first = logs[0];
    const last = logs[logs.length - 1];
    return last.timestamp - first.timestamp;
  }, [logs]);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bug className="h-5 w-5 text-orange-500" />
            Debug Logs
            <Badge variant="secondary" className="ml-2">
              {logs.length} events
            </Badge>
            {totalDuration > 0 && (
              <Badge variant="outline" className="ml-1">
                <Clock className="h-3 w-3 mr-1" />
                {totalDuration}ms
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <Tabs value={view} onValueChange={(v) => setView(v as 'timeline' | 'layers')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="timeline" className="flex items-center gap-2">
              <List className="h-4 w-4" />
              Timeline
            </TabsTrigger>
            <TabsTrigger value="layers" className="flex items-center gap-2">
              <Layers className="h-4 w-4" />
              By Layer
            </TabsTrigger>
          </TabsList>

          <TabsContent value="timeline" className="mt-4">
            <ScrollArea className="h-[50vh]">
              <div className="space-y-2 pr-4">
                {logs.length === 0 ? (
                  <div className="text-center text-muted-foreground py-8">
                    No logs available
                  </div>
                ) : (
                  logs.map((log, idx) => (
                    <LogEntry key={idx} log={log} showLayer />
                  ))
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="layers" className="mt-4">
            <ScrollArea className="h-[50vh]">
              <div className="space-y-3 pr-4">
                {Object.keys(logsByLayer).length === 0 ? (
                  <div className="text-center text-muted-foreground py-8">
                    No logs available
                  </div>
                ) : (
                  Object.entries(logsByLayer)
                    .sort(([a], [b]) => Number(a) - Number(b))
                    .map(([layer, layerLogs]) => (
                      <LayerGroup
                        key={layer}
                        layer={Number(layer)}
                        logs={layerLogs}
                      />
                    ))
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function LogEntry({ log, showLayer = false }: { log: LayerLog; showLayer?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const config = STATUS_CONFIG[log.status];
  const Icon = config.icon;
  const hasData = log.data && Object.keys(log.data).length > 0;

  return (
    <div
      className={`p-3 rounded-lg border ${
        log.status === 'error'
          ? 'bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800'
          : 'bg-muted/50'
      }`}
    >
      <div className="flex items-start gap-3">
        <Icon className={`h-4 w-4 mt-0.5 ${config.color}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {showLayer && (
              <Badge variant="outline" className="text-xs">
                L{log.layer}
              </Badge>
            )}
            <span className="font-medium text-sm">{log.name}</span>
            <Badge
              variant={log.status === 'error' ? 'destructive' : 'secondary'}
              className="text-xs"
            >
              {config.label}
            </Badge>
            {log.duration_ms !== undefined && (
              <Badge variant="outline" className="text-xs">
                <Clock className="h-3 w-3 mr-1" />
                {log.duration_ms}ms
              </Badge>
            )}
          </div>

          {log.message && (
            <p className="text-sm text-muted-foreground mt-1">{log.message}</p>
          )}

          {log.error && (
            <p className="text-sm text-red-600 dark:text-red-400 mt-1">{log.error}</p>
          )}

          {hasData && (
            <Collapsible open={expanded} onOpenChange={setExpanded}>
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 mt-1 text-xs"
                >
                  {expanded ? (
                    <ChevronDown className="h-3 w-3 mr-1" />
                  ) : (
                    <ChevronRight className="h-3 w-3 mr-1" />
                  )}
                  Data
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-x-auto">
                  {JSON.stringify(log.data, null, 2)}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {formatTimestamp(log.timestamp)}
        </span>
      </div>
    </div>
  );
}

function LayerGroup({ layer, logs }: { layer: number; logs: LayerLog[] }) {
  const [expanded, setExpanded] = useState(true);
  const hasError = logs.some((l) => l.status === 'error');
  const totalDuration = logs
    .filter((l) => l.duration_ms !== undefined)
    .reduce((sum, l) => sum + (l.duration_ms || 0), 0);

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className={`w-full justify-start h-auto p-3 ${
            hasError ? 'bg-red-50 dark:bg-red-950/20' : 'bg-muted/50'
          }`}
        >
          <div className="flex items-center gap-3 w-full">
            {expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <Badge variant="outline">L{layer}</Badge>
            <span className="font-medium">{LAYER_LABELS[layer] || `Layer ${layer}`}</span>
            <div className="flex-1" />
            <Badge variant="secondary" className="text-xs">
              {logs.length} events
            </Badge>
            {totalDuration > 0 && (
              <Badge variant="outline" className="text-xs">
                <Clock className="h-3 w-3 mr-1" />
                {totalDuration}ms
              </Badge>
            )}
            {hasError && (
              <AlertCircle className="h-4 w-4 text-red-500" />
            )}
          </div>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pl-8 space-y-2 mt-2">
          {logs.map((log, idx) => (
            <LogEntry key={idx} log={log} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  return date.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  });
}

export default DebugLogsModal;
