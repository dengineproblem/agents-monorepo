import React from 'react';
import { ChevronLeft, ChevronRight, ImageIcon } from 'lucide-react';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import type { Chapter, Section } from '../../content/knowledge-base';
import { knowledgeBaseContent } from '../../content/knowledge-base';

interface KBArticleProps {
  chapter: Chapter;
  section: Section;
  onNavigate: (chapterId: string, sectionId?: string) => void;
}

export const KBArticle: React.FC<KBArticleProps> = ({
  chapter,
  section,
  onNavigate,
}) => {
  // Находим предыдущий и следующий разделы
  const currentSectionIndex = chapter.sections.findIndex(s => s.id === section.id);
  const prevSection = currentSectionIndex > 0 ? chapter.sections[currentSectionIndex - 1] : null;
  const nextSection = currentSectionIndex < chapter.sections.length - 1
    ? chapter.sections[currentSectionIndex + 1]
    : null;

  // Если нет следующего раздела в главе, ищем первый раздел следующей главы
  const currentChapterIndex = knowledgeBaseContent.findIndex(ch => ch.id === chapter.id);
  const nextChapter = currentChapterIndex < knowledgeBaseContent.length - 1
    ? knowledgeBaseContent[currentChapterIndex + 1]
    : null;
  const prevChapter = currentChapterIndex > 0
    ? knowledgeBaseContent[currentChapterIndex - 1]
    : null;

  const handlePrev = () => {
    if (prevSection) {
      onNavigate(chapter.id, prevSection.id);
    } else if (prevChapter) {
      const lastSection = prevChapter.sections[prevChapter.sections.length - 1];
      onNavigate(prevChapter.id, lastSection?.id);
    }
  };

  const handleNext = () => {
    if (nextSection) {
      onNavigate(chapter.id, nextSection.id);
    } else if (nextChapter) {
      onNavigate(nextChapter.id, nextChapter.sections[0]?.id);
    }
  };

  const hasPrev = prevSection || prevChapter;
  const hasNext = nextSection || nextChapter;

  // Рендерим контент с поддержкой markdown-подобного форматирования
  const renderContent = (content: string) => {
    const lines = content.split('\n');
    const elements: React.ReactNode[] = [];
    let listItems: string[] = [];
    let listType: 'ul' | 'ol' | null = null;
    let infoBlock: string[] = [];
    let warningBlock: string[] = [];

    const flushList = () => {
      if (listItems.length > 0 && listType) {
        const ListTag = listType;
        elements.push(
          <ListTag key={elements.length} className={listType === 'ol' ? 'list-decimal list-inside space-y-1 my-4' : 'list-disc list-inside space-y-1 my-4'}>
            {listItems.map((item, i) => (
              <li key={i} className="text-muted-foreground">{renderInlineFormatting(item)}</li>
            ))}
          </ListTag>
        );
        listItems = [];
        listType = null;
      }
    };

    const flushInfoBlock = () => {
      if (infoBlock.length > 0) {
        elements.push(
          <Card key={elements.length} className="p-4 my-4 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800">
            <div className="flex gap-3">
              <span className="text-blue-600">💡</span>
              <div className="text-sm text-blue-900 dark:text-blue-100">
                {infoBlock.map((line, i) => (
                  <p key={i}>{renderInlineFormatting(line)}</p>
                ))}
              </div>
            </div>
          </Card>
        );
        infoBlock = [];
      }
    };

    const flushWarningBlock = () => {
      if (warningBlock.length > 0) {
        elements.push(
          <Card key={elements.length} className="p-4 my-4 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800">
            <div className="flex gap-3">
              <span className="text-amber-600">⚠️</span>
              <div className="text-sm text-amber-900 dark:text-amber-100">
                {warningBlock.map((line, i) => (
                  <p key={i}>{renderInlineFormatting(line)}</p>
                ))}
              </div>
            </div>
          </Card>
        );
        warningBlock = [];
      }
    };

    const renderInlineFormatting = (text: string): React.ReactNode => {
      // Bold: **text**
      // Italic: *text*
      // Code: `code`
      // Link: [text](url)
      const parts: React.ReactNode[] = [];
      let remaining = text;
      let key = 0;

      while (remaining.length > 0) {
        // Bold
        const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
        // Code
        const codeMatch = remaining.match(/`([^`]+)`/);
        // Link
        const linkMatch = remaining.match(/\[([^\]]+)\]\(([^)]+)\)/);

        const matches = [
          boldMatch ? { type: 'bold', index: boldMatch.index!, match: boldMatch } : null,
          codeMatch ? { type: 'code', index: codeMatch.index!, match: codeMatch } : null,
          linkMatch ? { type: 'link', index: linkMatch.index!, match: linkMatch } : null,
        ].filter(Boolean).sort((a, b) => a!.index - b!.index);

        if (matches.length === 0) {
          parts.push(remaining);
          break;
        }

        const first = matches[0]!;
        if (first.index > 0) {
          parts.push(remaining.slice(0, first.index));
        }

        if (first.type === 'bold') {
          parts.push(<strong key={key++}>{first.match[1]}</strong>);
          remaining = remaining.slice(first.index + first.match[0].length);
        } else if (first.type === 'code') {
          parts.push(
            <code key={key++} className="px-1.5 py-0.5 rounded bg-muted text-sm font-mono">
              {first.match[1]}
            </code>
          );
          remaining = remaining.slice(first.index + first.match[0].length);
        } else if (first.type === 'link') {
          parts.push(
            <a key={key++} href={first.match[2]} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
              {first.match[1]}
            </a>
          );
          remaining = remaining.slice(first.index + first.match[0].length);
        }
      }

      return parts;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Заголовки
      if (line.startsWith('### ')) {
        flushList();
        flushInfoBlock();
        flushWarningBlock();
        elements.push(<h3 key={elements.length} className="text-lg font-semibold mt-6 mb-3">{line.slice(4)}</h3>);
        continue;
      }
      if (line.startsWith('## ')) {
        flushList();
        flushInfoBlock();
        flushWarningBlock();
        elements.push(<h2 key={elements.length} className="text-xl font-semibold mt-8 mb-4">{line.slice(3)}</h2>);
        continue;
      }

      // Info block
      if (line.startsWith('> INFO:')) {
        flushList();
        flushWarningBlock();
        infoBlock.push(line.slice(7).trim());
        continue;
      }
      if (line.startsWith('> ') && infoBlock.length > 0) {
        infoBlock.push(line.slice(2));
        continue;
      }

      // Warning block
      if (line.startsWith('> WARNING:')) {
        flushList();
        flushInfoBlock();
        warningBlock.push(line.slice(10).trim());
        continue;
      }
      if (line.startsWith('> ') && warningBlock.length > 0) {
        warningBlock.push(line.slice(2));
        continue;
      }

      // Screenshot placeholder
      if (line.startsWith('[SCREENSHOT:')) {
        flushList();
        flushInfoBlock();
        flushWarningBlock();
        const description = line.slice(12, -1);
        elements.push(
          <Card key={elements.length} className="p-8 my-4 border-dashed border-2 bg-muted/30">
            <div className="flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <ImageIcon className="h-12 w-12" />
              <p className="text-sm text-center">{description}</p>
            </div>
          </Card>
        );
        continue;
      }

      // Unordered list
      if (line.startsWith('- ') || line.startsWith('• ')) {
        flushInfoBlock();
        flushWarningBlock();
        if (listType !== 'ul') {
          flushList();
          listType = 'ul';
        }
        listItems.push(line.slice(2));
        continue;
      }

      // Ordered list
      const olMatch = line.match(/^(\d+)\.\s/);
      if (olMatch) {
        flushInfoBlock();
        flushWarningBlock();
        if (listType !== 'ol') {
          flushList();
          listType = 'ol';
        }
        listItems.push(line.slice(olMatch[0].length));
        continue;
      }

      // Empty line
      if (line.trim() === '') {
        flushList();
        flushInfoBlock();
        flushWarningBlock();
        continue;
      }

      // Regular paragraph
      flushList();
      flushInfoBlock();
      flushWarningBlock();
      elements.push(
        <p key={elements.length} className="text-muted-foreground my-3">
          {renderInlineFormatting(line)}
        </p>
      );
    }

    flushList();
    flushInfoBlock();
    flushWarningBlock();

    return elements;
  };

  return (
    <article className="space-y-6">
      {/* Title */}
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">{section.title}</h1>
        <p className="text-sm text-muted-foreground">
          Глава {chapter.order}: {chapter.title}
        </p>
      </div>

      {/* Content */}
      <div className="prose prose-slate dark:prose-invert max-w-none">
        {renderContent(section.content)}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-8 border-t">
        {hasPrev ? (
          <Button variant="ghost" onClick={handlePrev} className="gap-2">
            <ChevronLeft className="h-4 w-4" />
            <span className="hidden sm:inline">
              {prevSection ? prevSection.title : `${prevChapter?.title}`}
            </span>
            <span className="sm:hidden">Назад</span>
          </Button>
        ) : (
          <div />
        )}

        {hasNext ? (
          <Button variant="ghost" onClick={handleNext} className="gap-2">
            <span className="hidden sm:inline">
              {nextSection ? nextSection.title : `${nextChapter?.title}`}
            </span>
            <span className="sm:hidden">Далее</span>
            <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <div />
        )}
      </div>
    </article>
  );
};
