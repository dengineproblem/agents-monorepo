import { useState } from 'react';
import { ChevronDown, ChevronRight, Clock, Coins, Cpu, MessageSquare, Wrench } from 'lucide-react';
import type { AIDebugInfo } from '@/types/chat';

interface DebugPanelProps {
  debug: AIDebugInfo;
}

export function DebugPanel({ debug }: DebugPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set());

  const toggleTool = (index: number) => {
    setExpandedTools(prev => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  };

  const formatMs = (ms: number) => {
    if (ms >= 1000) {
      return `${(ms / 1000).toFixed(1)}s`;
    }
    return `${ms}ms`;
  };

  const formatCost = (cents: number) => {
    if (cents < 1) {
      return `$${(cents / 100).toFixed(4)}`;
    }
    return `$${(cents / 100).toFixed(2)}`;
  };

  return (
    <div className="mt-1 text-xs border border-border/50 rounded bg-muted/30">
      {/* Summary row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-muted/50 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-3 h-3 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 flex-shrink-0" />
        )}

        <div className="flex items-center gap-3 text-muted-foreground overflow-hidden">
          <span className="flex items-center gap-1" title="Время обработки">
            <Clock className="w-3 h-3" />
            {formatMs(debug.totalProcessingMs)}
          </span>

          <span className="flex items-center gap-1" title="Токены">
            <Cpu className="w-3 h-3" />
            {debug.totalTokens.toLocaleString()}
          </span>

          <span className="flex items-center gap-1" title="Стоимость">
            <Coins className="w-3 h-3" />
            {formatCost(debug.costCents)}
          </span>

          {debug.toolCalls.length > 0 && (
            <span className="flex items-center gap-1" title="Tool calls">
              <Wrench className="w-3 h-3" />
              {debug.toolCalls.length}
            </span>
          )}

          <span className="text-muted-foreground/60 truncate" title={debug.model}>
            {debug.model}
          </span>
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-2 pb-2 space-y-2 border-t border-border/30">
          {/* Timing details */}
          <div className="pt-2">
            <h4 className="font-medium text-muted-foreground mb-1">Timing</h4>
            <div className="grid grid-cols-3 gap-2 text-muted-foreground">
              <div>
                <span className="block text-[10px] text-muted-foreground/60">AI</span>
                {formatMs(debug.aiLatencyMs)}
              </div>
              <div>
                <span className="block text-[10px] text-muted-foreground/60">Send</span>
                {formatMs(debug.sendLatencyMs)}
              </div>
              <div>
                <span className="block text-[10px] text-muted-foreground/60">Total</span>
                {formatMs(debug.totalProcessingMs)}
              </div>
            </div>
          </div>

          {/* Token details */}
          <div>
            <h4 className="font-medium text-muted-foreground mb-1">Tokens</h4>
            <div className="grid grid-cols-3 gap-2 text-muted-foreground">
              <div>
                <span className="block text-[10px] text-muted-foreground/60">Prompt</span>
                {debug.promptTokens.toLocaleString()}
              </div>
              <div>
                <span className="block text-[10px] text-muted-foreground/60">Completion</span>
                {debug.completionTokens.toLocaleString()}
              </div>
              <div>
                <span className="block text-[10px] text-muted-foreground/60">Total</span>
                {debug.totalTokens.toLocaleString()}
              </div>
            </div>
          </div>

          {/* Context */}
          <div>
            <h4 className="font-medium text-muted-foreground mb-1">Context</h4>
            <div className="flex gap-4 text-muted-foreground">
              <div className="flex items-center gap-1">
                <MessageSquare className="w-3 h-3" />
                <span>{debug.historyMessagesCount ?? 0} msgs</span>
              </div>
              {debug.iterations > 0 && (
                <div className="flex items-center gap-1">
                  <Wrench className="w-3 h-3" />
                  <span>{debug.iterations} iterations</span>
                </div>
              )}
            </div>
          </div>

          {/* Tool Calls */}
          {debug.toolCalls.length > 0 && (
            <div>
              <h4 className="font-medium text-muted-foreground mb-1">Tool Calls ({debug.toolCalls.length})</h4>
              <div className="space-y-1">
                {debug.toolCalls.map((tool, idx) => (
                  <div key={idx} className="border border-border/30 rounded">
                    <button
                      onClick={() => toggleTool(idx)}
                      className="w-full flex items-center gap-2 px-2 py-1 hover:bg-muted/30"
                    >
                      {expandedTools.has(idx) ? (
                        <ChevronDown className="w-3 h-3 flex-shrink-0" />
                      ) : (
                        <ChevronRight className="w-3 h-3 flex-shrink-0" />
                      )}
                      <span className="font-mono text-primary">{tool.name}</span>
                      <span className="text-muted-foreground/60 ml-auto">{formatMs(tool.durationMs)}</span>
                    </button>

                    {expandedTools.has(idx) && (
                      <div className="px-2 pb-2 space-y-2 text-[11px]">
                        <div>
                          <span className="block text-muted-foreground/60 mb-0.5">Arguments:</span>
                          <pre className="bg-background/50 p-1.5 rounded overflow-x-auto max-h-32 text-muted-foreground">
                            {JSON.stringify(tool.arguments, null, 2)}
                          </pre>
                        </div>
                        <div>
                          <span className="block text-muted-foreground/60 mb-0.5">Result:</span>
                          <pre className="bg-background/50 p-1.5 rounded overflow-x-auto max-h-48 text-muted-foreground whitespace-pre-wrap">
                            {tool.result}
                          </pre>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* System Prompt */}
          {debug.systemPrompt && (
            <div>
              <button
                onClick={() => setShowPrompt(!showPrompt)}
                className="flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground"
              >
                {showPrompt ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
                System Prompt
              </button>
              {showPrompt && (
                <pre className="mt-1 bg-background/50 p-2 rounded overflow-x-auto max-h-64 text-[11px] text-muted-foreground whitespace-pre-wrap">
                  {debug.systemPrompt}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
