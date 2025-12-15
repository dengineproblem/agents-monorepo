/**
 * StreamingMessage Component
 * Displays AI response being streamed in real-time
 * Shows thinking status, tool execution progress, and text as it arrives
 */

import { Bot, Loader2, CheckCircle2, Sparkles, Database, BarChart3, MessageSquare, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import { getToolLabel } from '@/services/assistantApi';
import type { StreamEvent } from '@/services/assistantApi';

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
  status: 'running' | 'completed';
  startTime: number;
  duration?: number;
}

export interface StreamingState {
  phase: 'init' | 'thinking' | 'classifying' | 'processing' | 'done';
  thinkingMessage: string;
  domain: string | null;
  agents: string[];
  text: string;
  tools: ToolExecution[];
  currentTool: string | null;
}

interface StreamingMessageProps {
  state: StreamingState;
}

export function StreamingMessage({ state }: StreamingMessageProps) {
  const DomainIcon = state.domain ? DOMAIN_ICONS[state.domain] || Bot : Bot;
  const domainLabel = state.domain ? DOMAIN_LABELS[state.domain] || state.domain : '';

  return (
    <div className="flex gap-3 p-4 justify-start">
      {/* Avatar */}
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
        <Bot className="h-4 w-4 text-primary" />
      </div>

      {/* Content */}
      <div className="max-w-[80%] rounded-lg p-3 bg-muted min-w-[200px]">
        {/* Thinking/Classification Status */}
        {(state.phase === 'init' || state.phase === 'thinking' || state.phase === 'classifying') && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground animate-pulse">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{state.thinkingMessage || 'Обрабатываю запрос...'}</span>
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

        {/* Current Tool (if running) */}
        {state.currentTool && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>{getToolLabel(state.currentTool)}</span>
          </div>
        )}

        {/* Streaming Text */}
        {state.text && (
          <div className="prose prose-sm max-w-none">
            <ReactMarkdown>{state.text}</ReactMarkdown>
            {state.phase === 'processing' && (
              <span className="inline-block w-1.5 h-4 bg-primary/60 animate-pulse ml-0.5" />
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
  const label = getToolLabel(tool.name);

  return (
    <div className={cn(
      'flex items-center gap-2 text-xs px-2 py-1 rounded',
      isRunning ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-600'
    )}>
      {isRunning ? (
        <Loader2 className="h-3 w-3 animate-spin" />
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
                status: 'completed' as const,
                duration: Date.now() - t.startTime,
              }
            : t
        ),
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

    default:
      return state;
  }
}

export default StreamingMessage;
