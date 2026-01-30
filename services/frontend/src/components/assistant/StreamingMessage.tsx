/**
 * StreamingMessage Component
 * Displays AI response being streamed in real-time
 * Shows thinking status, tool execution progress, and text as it arrives
 */

import { useState, useEffect } from 'react';
import { Bot, Loader2, CheckCircle2, XCircle, Sparkles, Database, BarChart3, MessageSquare, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MarkdownRenderer } from './MarkdownRenderer';
import { getToolLabel, LAYER_LABELS } from '@/services/assistantApi';
import type { StreamEvent, StreamEventLayer } from '@/services/assistantApi';
import type { LayerLog } from './DebugLogsModal';

// Сменяющиеся фразы для состояния "думаю"
const THINKING_PHRASES = [
  'Анализирую запрос...',
  'Изучаю контекст...',
  'Подбираю инструменты...',
  'Обрабатываю данные...',
  'Готовлю ответ...',
  'Собираю информацию...',
];

// Domain icons for classification display
const DOMAIN_ICONS: Record<string, typeof Bot> = {
  ads: BarChart3,
  creative: Sparkles,
  crm: Users,
  whatsapp: MessageSquare,
  memory: Database,
};

const DOMAIN_LABELS: Record<string, string> = {
  ads: 'Реклама',
  creative: 'Креативы',
  crm: 'Лиды',
  whatsapp: 'Диалоги',
  memory: 'Память',
};

interface ToolExecution {
  name: string;
  status: 'running' | 'completed' | 'failed';
  startTime: number;
  duration?: number;
  error?: string;
}

export interface StreamingState {
  phase: 'init' | 'thinking' | 'classifying' | 'processing' | 'done';
  thinkingMessage: string;
  domain: string | null;
  agents: string[];
  text: string;
  tools: ToolExecution[];
  currentTool: string | null;
  layerLogs: LayerLog[];
}

interface StreamingMessageProps {
  state: StreamingState;
}

export function StreamingMessage({ state }: StreamingMessageProps) {
  const DomainIcon = state.domain ? DOMAIN_ICONS[state.domain] || Bot : Bot;
  const domainLabel = state.domain ? DOMAIN_LABELS[state.domain] || state.domain : '';

  // Сменяющиеся фразы когда нет конкретного сообщения
  const [phraseIndex, setPhraseIndex] = useState(0);
  const isThinking = state.phase === 'init' || state.phase === 'thinking' || state.phase === 'classifying';

  useEffect(() => {
    if (!isThinking || state.thinkingMessage) return;

    const interval = setInterval(() => {
      setPhraseIndex((prev) => (prev + 1) % THINKING_PHRASES.length);
    }, 2000);

    return () => clearInterval(interval);
  }, [isThinking, state.thinkingMessage]);

  // Сбрасываем индекс при новом запросе
  useEffect(() => {
    if (state.phase === 'init') {
      setPhraseIndex(0);
    }
  }, [state.phase]);

  const displayMessage = state.thinkingMessage || THINKING_PHRASES[phraseIndex];

  return (
    <div className="flex gap-3 p-4 justify-start">
      {/* Avatar */}
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
        <Bot className="h-4 w-4 text-primary" />
      </div>

      {/* Content */}
      <div className="max-w-[85%] sm:max-w-[80%] rounded-lg p-3 bg-muted min-w-0">
        {/* Thinking/Classification Status */}
        {isThinking && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground animate-pulse">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{displayMessage}</span>
          </div>
        )}

        {/* Domain Badge (after classification) */}
        {state.domain && state.phase !== 'init' && state.phase !== 'thinking' && (
          <div className="flex items-center gap-2 mb-2">
            <div className={cn(
              'flex items-center gap-1 px-2 py-0.5 rounded-full text-xs',
              'bg-primary/10 text-primary'
            )}>
              <DomainIcon className="h-3 w-3" />
              <span>{domainLabel}</span>
            </div>
          </div>
        )}

        {/* Tool Progress */}
        {state.tools.length > 0 && (
          <div className="mb-3 space-y-1">
            {state.tools.map((tool, idx) => (
              <ToolProgressItem key={`${tool.name}-${idx}`} tool={tool} />
            ))}
          </div>
        )}

        {/* Streaming Text */}
        {state.text && (
          <div className="relative">
            <MarkdownRenderer content={state.text} />
            {state.phase === 'processing' && (
              <span className="inline-block w-1.5 h-4 bg-primary/60 animate-pulse ml-0.5 align-middle" />
            )}
          </div>
        )}

        {/* Empty state while waiting for text */}
        {!state.text && state.phase === 'processing' && !state.currentTool && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Формирую ответ...</span>
          </div>
        )}
      </div>
    </div>
  );
}

function ToolProgressItem({ tool }: { tool: ToolExecution }) {
  const isRunning = tool.status === 'running';
  const isFailed = tool.status === 'failed';
  const label = getToolLabel(tool.name);

  return (
    <div className={cn(
      'flex items-center gap-2 text-xs px-2 py-1 rounded',
      isRunning
        ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400'
        : isFailed
        ? 'bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400'
        : 'bg-green-50 text-green-600 dark:bg-green-950/50 dark:text-green-400'
    )}>
      {isRunning ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : isFailed ? (
        <XCircle className="h-3 w-3" />
      ) : (
        <CheckCircle2 className="h-3 w-3" />
      )}
      <span>{label}</span>
      {tool.duration && (
        <span className="text-[10px] opacity-60">
          {(tool.duration / 1000).toFixed(1)}s
        </span>
      )}
    </div>
  );
}

/**
 * Create initial streaming state
 */
export function createInitialStreamingState(): StreamingState {
  return {
    phase: 'init',
    thinkingMessage: '',
    domain: null,
    agents: [],
    text: '',
    tools: [],
    currentTool: null,
    layerLogs: [],
  };
}

/**
 * Update streaming state based on incoming event
 */
export function updateStreamingState(
  state: StreamingState,
  event: StreamEvent
): StreamingState {
  switch (event.type) {
    case 'init':
      return {
        ...state,
        phase: 'init',
      };

    case 'thinking':
      return {
        ...state,
        phase: 'thinking',
        thinkingMessage: event.message,
      };

    case 'classification':
      return {
        ...state,
        phase: 'classifying',
        domain: event.domain,
        agents: event.agents,
        thinkingMessage: `${DOMAIN_LABELS[event.domain] || event.domain}...`,
      };

    case 'text':
      return {
        ...state,
        phase: 'processing',
        text: event.accumulated,
        currentTool: null, // Clear current tool when text arrives
      };

    case 'tool_start':
      return {
        ...state,
        phase: 'processing',
        currentTool: event.name,
        tools: [
          ...state.tools,
          {
            name: event.name,
            status: 'running',
            startTime: Date.now(),
          },
        ],
      };

    case 'tool_result':
      return {
        ...state,
        currentTool: null,
        tools: state.tools.map((t) =>
          t.name === event.name && t.status === 'running'
            ? {
                ...t,
                status: event.success ? 'completed' as const : 'failed' as const,
                duration: event.duration || (Date.now() - t.startTime),
                error: event.error,
              }
            : t
        ),
      };

    case 'clarifying':
      // Clarifying questions are displayed as text with optional choices
      const clarifyText = event.options?.length
        ? `${event.question}\n\n${event.options.map((o, i) => `${i + 1}. ${o}`).join('\n')}`
        : event.question;
      return {
        ...state,
        phase: 'processing',
        text: clarifyText,
      };

    case 'done':
      return {
        ...state,
        phase: 'done',
        text: event.content,
        currentTool: null,
      };

    case 'error':
      return {
        ...state,
        phase: 'done',
        text: `❌ Ошибка: ${event.message}`,
        currentTool: null,
      };

    case 'layer': {
      const layerEvent = event as StreamEventLayer;
      const log: LayerLog = {
        layer: layerEvent.layer,
        name: layerEvent.name || LAYER_LABELS[layerEvent.layer] || `Layer ${layerEvent.layer}`,
        status: layerEvent.status,
        data: layerEvent.data,
        timestamp: layerEvent.timestamp,
        duration_ms: layerEvent.duration_ms,
        error: layerEvent.error,
        message: layerEvent.message,
      };
      return {
        ...state,
        layerLogs: [...state.layerLogs, log],
      };
    }

    default:
      return state;
  }
}

export default StreamingMessage;
