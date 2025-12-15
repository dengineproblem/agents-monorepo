import React from 'react';
import { cn } from '@/lib/utils';
import type { Chapter } from '../../content/knowledge-base';

interface KBTableOfContentsProps {
  chapters: Chapter[];
  currentChapterId?: string;
  currentSectionId?: string;
  onNavigate: (chapterId: string, sectionId?: string) => void;
}

export const KBTableOfContents: React.FC<KBTableOfContentsProps> = ({
  chapters,
  currentChapterId,
  currentSectionId,
  onNavigate,
}) => {
  const currentChapter = chapters.find(ch => ch.id === currentChapterId);

  return (
    <nav className="sticky top-20">
      <h3 className="text-sm font-semibold mb-3 text-muted-foreground">Содержание</h3>

      {/* Список глав */}
      <div className="space-y-1 mb-4">
        {chapters.map((chapter) => {
          const isCurrentChapter = currentChapterId === chapter.id;

          return (
            <button
              key={chapter.id}
              onClick={() => onNavigate(chapter.id, chapter.sections[0]?.id)}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1.5 text-left text-sm rounded-md transition-colors",
                isCurrentChapter
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              <span className="flex items-center justify-center w-5 h-5 rounded bg-primary/10 text-primary text-xs font-semibold flex-shrink-0">
                {chapter.order}
              </span>
              <span className="truncate text-xs">{chapter.title}</span>
            </button>
          );
        })}
      </div>

      {/* Разделы текущей главы */}
      {currentChapter && (
        <>
          <div className="border-t pt-3 mt-3">
            <h4 className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wider">
              Разделы
            </h4>
            <div className="space-y-0.5">
              {currentChapter.sections.map((section) => {
                const isCurrentSection = currentSectionId === section.id;

                return (
                  <button
                    key={section.id}
                    onClick={() => onNavigate(currentChapter.id, section.id)}
                    className={cn(
                      "w-full flex items-center px-2 py-1.5 text-left text-xs rounded-md transition-colors",
                      isCurrentSection
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    )}
                  >
                    <span className="truncate">{section.title}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </nav>
  );
};
