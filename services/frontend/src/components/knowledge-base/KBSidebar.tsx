import React, { useState } from 'react';
import { ChevronDown, ChevronRight, BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Chapter } from '../../content/knowledge-base';

interface KBSidebarProps {
  chapters: Chapter[];
  currentChapterId?: string;
  currentSectionId?: string;
  onNavigate: (chapterId: string, sectionId?: string) => void;
}

export const KBSidebar: React.FC<KBSidebarProps> = ({
  chapters,
  currentChapterId,
  currentSectionId,
  onNavigate,
}) => {
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(() => {
    // По умолчанию открываем текущую главу
    const initial = new Set<string>();
    if (currentChapterId) {
      initial.add(currentChapterId);
    }
    return initial;
  });

  const toggleChapter = (chapterId: string) => {
    setExpandedChapters(prev => {
      const next = new Set(prev);
      if (next.has(chapterId)) {
        next.delete(chapterId);
      } else {
        next.add(chapterId);
      }
      return next;
    });
  };

  // Открываем текущую главу при изменении
  React.useEffect(() => {
    if (currentChapterId) {
      setExpandedChapters(prev => new Set(prev).add(currentChapterId));
    }
  }, [currentChapterId]);

  return (
    <nav className="pb-8">
      {chapters.map((chapter) => {
        const isExpanded = expandedChapters.has(chapter.id);
        const isCurrentChapter = currentChapterId === chapter.id;

        return (
          <div key={chapter.id} className="mb-1">
            {/* Chapter header */}
            <button
              onClick={() => toggleChapter(chapter.id)}
              className={cn(
                "w-full flex items-center gap-2 px-4 py-2 text-left text-sm font-medium hover:bg-muted/50 transition-colors",
                isCurrentChapter && "bg-muted/50 text-primary"
              )}
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 flex-shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 flex-shrink-0" />
              )}
              <span className="flex items-center justify-center w-6 h-6 rounded bg-primary/10 text-primary text-xs font-semibold flex-shrink-0">
                {chapter.order}
              </span>
              <span className="truncate">{chapter.title}</span>
            </button>

            {/* Sections */}
            {isExpanded && (
              <div className="ml-6 border-l">
                {chapter.sections.map((section) => {
                  const isCurrentSection = isCurrentChapter && currentSectionId === section.id;

                  return (
                    <button
                      key={section.id}
                      onClick={() => onNavigate(chapter.id, section.id)}
                      className={cn(
                        "w-full flex items-center gap-2 px-4 py-1.5 text-left text-sm hover:bg-muted/50 transition-colors",
                        isCurrentSection
                          ? "bg-primary/10 text-primary font-medium border-l-2 border-primary -ml-[1px]"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <span className="truncate">{section.title}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
};
