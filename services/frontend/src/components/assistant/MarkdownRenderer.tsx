/**
 * MarkdownRenderer - Reusable markdown rendering with custom components
 * Features:
 * - Beautiful tables with headers and icons
 * - Proper spacing between paragraphs and sections
 * - Styled code blocks, lists, and blockquotes
 */

import ReactMarkdown, { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Table2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MarkdownRendererProps {
  content: string;
  className?: string;
  isUser?: boolean;
}

// Custom markdown components with proper styling
const createMarkdownComponents = (isUser: boolean): Components => ({
  // Paragraphs with better spacing - key for readability
  p: ({ children }) => (
    <p className="mb-4 last:mb-0 leading-relaxed">{children}</p>
  ),

  // Lists with proper margins
  ul: ({ children }) => (
    <ul className="mb-4 ml-4 list-disc space-y-1.5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-4 ml-4 list-decimal space-y-1.5">{children}</ol>
  ),

  // List items with good spacing
  li: ({ children }) => (
    <li className="leading-relaxed pl-1">{children}</li>
  ),

  // Headers with proper spacing
  h1: ({ children }) => (
    <h1 className="text-lg font-bold mt-6 mb-3 first:mt-0 pb-1 border-b border-border/50">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-base font-bold mt-5 mb-2.5 first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold mt-4 mb-2 first:mt-0">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-sm font-medium mt-3 mb-1.5 first:mt-0">{children}</h4>
  ),

  // Bold text for emphasis
  strong: ({ children }) => (
    <strong className={cn(
      "font-semibold",
      isUser ? "text-primary-foreground" : "text-foreground"
    )}>
      {children}
    </strong>
  ),

  // Code blocks with syntax highlighting placeholder
  code: ({ className, children }) => {
    const isBlock = className?.includes('language-');
    if (isBlock) {
      return (
        <code className="block bg-slate-900 text-slate-50 rounded-lg p-3 text-xs overflow-x-auto my-3 font-mono">
          {children}
        </code>
      );
    }
    return (
      <code className={cn(
        "rounded px-1.5 py-0.5 text-xs font-mono",
        isUser ? "bg-primary-foreground/20" : "bg-muted"
      )}>
        {children}
      </code>
    );
  },

  // Pre for code blocks
  pre: ({ children }) => (
    <pre className="my-3">{children}</pre>
  ),

  // Beautiful tables with header icon (like actions component)
  table: ({ children }) => (
    <div className="my-4 rounded-lg border border-border overflow-hidden bg-background/50">
      {/* Table header with icon */}
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b border-border">
        <Table2 className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">Данные</span>
      </div>
      {/* Table content */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          {children}
        </table>
      </div>
    </div>
  ),

  thead: ({ children }) => (
    <thead className="bg-muted/30 border-b border-border">{children}</thead>
  ),

  th: ({ children }) => (
    <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
      {children}
    </th>
  ),

  tbody: ({ children }) => (
    <tbody className="divide-y divide-border/50">{children}</tbody>
  ),

  tr: ({ children }) => (
    <tr className="hover:bg-muted/20 transition-colors">{children}</tr>
  ),

  td: ({ children }) => (
    <td className="px-3 py-2 text-sm">{children}</td>
  ),

  // Blockquotes with colored border
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-primary/40 bg-muted/30 pl-4 pr-3 py-2 my-4 rounded-r-lg text-muted-foreground italic">
      {children}
    </blockquote>
  ),

  // Horizontal rule for section separation
  hr: () => (
    <hr className="my-6 border-border" />
  ),

  // Links
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "underline underline-offset-2 hover:opacity-80 transition-opacity",
        isUser ? "text-primary-foreground" : "text-primary"
      )}
    >
      {children}
    </a>
  ),
});

export function MarkdownRenderer({ content, className, isUser = false }: MarkdownRendererProps) {
  return (
    <div className={cn(
      'prose prose-sm max-w-none',
      isUser && 'prose-invert',
      className
    )}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={createMarkdownComponents(isUser)}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default MarkdownRenderer;
