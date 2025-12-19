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
  Inbox,
  Brain,
  Cpu,
  Wrench,
  GitBranch,
  Link,
  Cog,
  Database,
  MessageSquare,
  Save,
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
import type { LayerStatus } from '@/services/assistantApi';

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

// Иконки для каждого слоя
const LAYER_ICONS: Record<number, typeof Inbox> = {
  1: Inbox,
  2: Brain,
  3: Cpu,
  4: Wrench,
  5: GitBranch,
  6: Link,
  7: Cog,
  8: Database,
  9: MessageSquare,
  10: MessageSquare,
  11: Save,
};

// Русские названия слоёв
const LAYER_NAMES_RU: Record<number, string> = {
  1: 'Входящий запрос',
  2: 'Оркестратор',
  3: 'Мета-оркестратор',
  4: 'Мета-инструменты',
  5: 'Маршрутизатор доменов',
  6: 'MCP мост',
  7: 'MCP исполнитель',
  8: 'Обработчики доменов',
  9: 'Доменные агенты',
  10: 'Сборка ответа',
  11: 'Сохранение',
};

/**
 * Генерирует понятное описание на русском языке
 */
function getHumanReadableDescription(log: LayerLog): string {
  const { layer, status, data, message } = log;

  // Layer 1: HTTP Entry
  if (layer === 1) {
    if (status === 'start') {
      const msg = data?.message as string;
      return `📥 Получен запрос: "${msg?.substring(0, 50)}${msg && msg.length > 50 ? '...' : ''}"`;
    }
    if (status === 'info' && message?.includes('Ad account')) {
      return `✅ Рекламный аккаунт найден`;
    }
    if (status === 'info' && message?.includes('Context')) {
      return `📋 Контекст собран (${data?.recentMessages || 0} сообщений в истории)`;
    }
    if (status === 'end') {
      return `✅ Запрос принят, conversationId: ${(data?.conversationId as string)?.substring(0, 8)}...`;
    }
  }

  // Layer 2: Orchestrator
  if (layer === 2) {
    if (status === 'start') {
      return `🎯 Оркестратор начал обработку (режим: ${data?.mode || 'auto'})`;
    }
    if (status === 'info') {
      if (message?.includes('Memory command')) {
        return `📝 Обнаружена команда памяти: ${data?.type}`;
      }
      if (message?.includes('Routing')) {
        return `➡️ Направляю запрос в мета-оркестратор`;
      }
      if (message?.includes('context')) {
        return `📋 Собираю контекст пользователя`;
      }
    }
    if (status === 'end') {
      return `✅ Оркестратор завершил обработку`;
    }
  }

  // Layer 3: Meta Orchestrator
  if (layer === 3) {
    if (status === 'start') {
      return `🤖 Мета-оркестратор запущен (модель: ${data?.model || 'gpt-4o'})`;
    }
    if (status === 'info') {
      if (message?.includes('MCP session')) {
        return `🔗 Создана MCP сессия: ${(data?.sessionId as string)?.substring(0, 8)}...`;
      }
      if (message?.includes('LLM iteration')) {
        const iteration = data?.iteration || message?.match(/\d+/)?.[0];
        return `💭 LLM думает (итерация ${iteration})`;
      }
      if (message?.includes('Max iterations')) {
        return `⚠️ Достигнут лимит итераций`;
      }
      if (message?.includes('cleaned up')) {
        return `🧹 MCP сессия очищена`;
      }
    }
    if (status === 'end') {
      return `✅ Мета-оркестратор завершил (${data?.iterations || 0} итераций, ${data?.toolCalls || 0} вызовов инструментов)`;
    }
  }

  // Layer 4: Meta Tools
  if (layer === 4) {
    const toolName = data?.toolName as string;
    if (status === 'start') {
      if (toolName === 'executeTools') {
        return `🛠️ Вызываю инструменты для выполнения задач`;
      }
      if (toolName === 'askClarifyingQuestion') {
        return `❓ Задаю уточняющий вопрос`;
      }
      if (toolName === 'respondToUser') {
        return `💬 Формирую ответ пользователю`;
      }
      return `🔧 Вызов мета-инструмента: ${toolName}`;
    }
    if (status === 'end') {
      return `✅ Мета-инструмент ${toolName} выполнен (${data?.latencyMs || 0}мс)`;
    }
    if (status === 'error') {
      return `❌ Ошибка мета-инструмента: ${toolName}`;
    }
  }

  // Layer 5: Domain Router
  if (layer === 5) {
    if (status === 'start') {
      const domains = data?.domains as string[];
      return `📊 Группирую задачи по доменам: ${domains?.join(', ') || '...'}`;
    }
    if (status === 'info') {
      if (message?.includes('Processing domain')) {
        const domain = data?.domain as string;
        const tools = data?.tools as string[];
        return `🔄 Обрабатываю домен "${domain}": ${tools?.join(', ')}`;
      }
      if (message?.includes('completed')) {
        return `✅ Домен ${data?.domain} обработан`;
      }
      if (message?.includes('failed')) {
        return `❌ Ошибка домена ${data?.domain}: ${data?.error}`;
      }
    }
    if (status === 'end') {
      return `✅ Маршрутизация завершена (${(data?.domainsProcessed as string[])?.length || 0} доменов)`;
    }
  }

  // Layer 6: MCP Bridge
  if (layer === 6) {
    const toolName = data?.toolName as string;
    if (status === 'start') {
      return `🔗 Выполняю инструмент через MCP: ${toolName}`;
    }
    if (status === 'end') {
      if (data?.approval_required) {
        return `⚠️ Инструмент ${toolName} требует подтверждения`;
      }
      if (data?.cached) {
        return `💾 Результат ${toolName} взят из кэша`;
      }
      return `✅ Инструмент ${toolName} выполнен (${data?.latencyMs || 0}мс)`;
    }
    if (status === 'error') {
      return `❌ Ошибка MCP: ${toolName}`;
    }
  }

  // Layer 7: MCP Executor
  if (layer === 7) {
    const toolName = data?.toolName as string;
    if (status === 'start') {
      return `⚙️ Запускаю исполнитель: ${toolName}`;
    }
    if (status === 'info') {
      if (message?.includes('Validation passed')) {
        return `✅ Валидация ${toolName} пройдена`;
      }
      if (message?.includes('Dangerous tool')) {
        return `⚠️ Обнаружен опасный инструмент: ${toolName}`;
      }
    }
    if (status === 'end') {
      if (data?.error === 'TOOL_CALL_LIMIT') {
        return `🚫 Превышен лимит вызовов инструментов`;
      }
      if (data?.error === 'VALIDATION_ERROR') {
        return `❌ Ошибка валидации параметров`;
      }
      return `✅ Исполнитель ${toolName} завершён`;
    }
    if (status === 'error') {
      return `❌ Ошибка исполнителя: ${log.error}`;
    }
  }

  // Layer 8: Domain Handlers
  if (layer === 8) {
    const handler = data?.handler as string;
    if (status === 'start') {
      return `🔨 Запускаю обработчик: ${handler}`;
    }
    if (status === 'end') {
      return `✅ Обработчик ${handler} завершён`;
    }
    if (status === 'error') {
      return `❌ Ошибка обработчика: ${handler}`;
    }
  }

  // Layer 9: Domain Agents
  if (layer === 9) {
    const domain = data?.domain as string;
    if (status === 'start') {
      return `🧠 Доменный агент "${domain}" анализирует данные`;
    }
    if (status === 'info' && message?.includes('LLM call')) {
      return `💭 Агент "${domain}" обращается к LLM (${data?.model})`;
    }
    if (status === 'end') {
      return `✅ Агент "${domain}" сформировал ответ (${data?.responseLength || 0} символов)`;
    }
    if (status === 'error') {
      return `❌ Ошибка агента "${domain}"`;
    }
  }

  // Layer 10: Response Assembly
  if (layer === 10) {
    if (status === 'start') {
      return `📝 Собираю финальный ответ`;
    }
    if (status === 'end') {
      return `✅ Ответ сформирован (${data?.contentLength || 0} символов)`;
    }
  }

  // Layer 11: Persistence
  if (layer === 11) {
    if (status === 'start') {
      return `💾 Сохраняю в базу данных`;
    }
    if (status === 'end') {
      return `✅ Сохранено (${data?.logsCount || 0} логов)`;
    }
  }

  // Default fallback
  if (status === 'error') {
    return `❌ Ошибка: ${log.error || 'Неизвестная ошибка'}`;
  }
  if (message) {
    return message;
  }
  return `${LAYER_NAMES_RU[layer] || log.name} - ${status}`;
}

const STATUS_CONFIG: Record<LayerStatus, { icon: typeof Play; color: string; label: string }> = {
  start: { icon: Play, color: 'text-blue-500', label: 'Старт' },
  end: { icon: CheckCircle2, color: 'text-green-500', label: 'Готово' },
  error: { icon: AlertCircle, color: 'text-red-500', label: 'Ошибка' },
  info: { icon: Info, color: 'text-gray-500', label: 'Инфо' },
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
            Логи обработки запроса
            <Badge variant="secondary" className="ml-2">
              {logs.length} событий
            </Badge>
            {totalDuration > 0 && (
              <Badge variant="outline" className="ml-1">
                <Clock className="h-3 w-3 mr-1" />
                {(totalDuration / 1000).toFixed(2)}с
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <Tabs value={view} onValueChange={(v) => setView(v as 'timeline' | 'layers')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="timeline" className="flex items-center gap-2">
              <List className="h-4 w-4" />
              Хронология
            </TabsTrigger>
            <TabsTrigger value="layers" className="flex items-center gap-2">
              <Layers className="h-4 w-4" />
              По слоям
            </TabsTrigger>
          </TabsList>

          <TabsContent value="timeline" className="mt-4">
            <ScrollArea className="h-[50vh]">
              <div className="space-y-2 pr-4">
                {logs.length === 0 ? (
                  <div className="text-center text-muted-foreground py-8">
                    Нет логов
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
                    Нет логов
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
  const LayerIcon = LAYER_ICONS[log.layer] || Info;
  const hasData = log.data && Object.keys(log.data).length > 0;
  const description = getHumanReadableDescription(log);

  return (
    <div
      className={`p-3 rounded-lg border ${
        log.status === 'error'
          ? 'bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800'
          : 'bg-muted/50'
      }`}
    >
      <div className="flex items-start gap-3">
        <LayerIcon className={`h-4 w-4 mt-0.5 ${config.color}`} />
        <div className="flex-1 min-w-0">
          {/* Понятное описание */}
          <p className="text-sm font-medium">{description}</p>

          {/* Badges с layer и временем */}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {showLayer && (
              <Badge variant="outline" className="text-xs">
                Слой {log.layer}: {LAYER_NAMES_RU[log.layer]}
              </Badge>
            )}
            {log.duration_ms !== undefined && log.duration_ms > 0 && (
              <Badge variant="secondary" className="text-xs">
                <Clock className="h-3 w-3 mr-1" />
                {log.duration_ms}мс
              </Badge>
            )}
          </div>

          {log.error && (
            <p className="text-sm text-red-600 dark:text-red-400 mt-1">{log.error}</p>
          )}

          {/* Кнопка "Подробнее" для технических данных */}
          {hasData && (
            <Collapsible open={expanded} onOpenChange={setExpanded}>
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 mt-1 text-xs text-muted-foreground"
                >
                  {expanded ? (
                    <ChevronDown className="h-3 w-3 mr-1" />
                  ) : (
                    <ChevronRight className="h-3 w-3 mr-1" />
                  )}
                  Подробнее
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
  const LayerIcon = LAYER_ICONS[layer] || Info;

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
            <LayerIcon className="h-4 w-4" />
            <Badge variant="outline">{layer}</Badge>
            <span className="font-medium">{LAYER_NAMES_RU[layer] || `Слой ${layer}`}</span>
            <div className="flex-1" />
            <Badge variant="secondary" className="text-xs">
              {logs.length} событий
            </Badge>
            {totalDuration > 0 && (
              <Badge variant="outline" className="text-xs">
                <Clock className="h-3 w-3 mr-1" />
                {totalDuration}мс
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
  });
}

export default DebugLogsModal;
