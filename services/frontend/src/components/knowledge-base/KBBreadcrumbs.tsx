import React from 'react';
import { ChevronRight, Home } from 'lucide-react';
import type { Chapter, Section } from '../../content/knowledge-base';

interface KBBreadcrumbsProps {
  chapter: Chapter;
  section?: Section;
  onNavigateHome: () => void;
  onNavigateChapter?: () => void;
}

export const KBBreadcrumbs: React.FC<KBBreadcrumbsProps> = ({
  chapter,
  section,
  onNavigateHome,
  onNavigateChapter,
}) => {
  return (
    <nav className="flex items-center gap-1 text-sm text-muted-foreground mb-6 flex-wrap">
      <button
        onClick={onNavigateHome}
        className="flex items-center gap-1 hover:text-foreground transition-colors"
      >
        <Home className="h-4 w-4" />
        <span className="hidden sm:inline">База знаний</span>
      </button>

      <ChevronRight className="h-4 w-4" />

      {section ? (
        <>
          <button
            onClick={onNavigateChapter}
            className="hover:text-foreground transition-colors truncate max-w-[150px] sm:max-w-none"
          >
            {chapter.title}
          </button>
          <ChevronRight className="h-4 w-4" />
          <span className="text-foreground truncate max-w-[150px] sm:max-w-none">
            {section.title}
          </span>
        </>
      ) : (
        <span className="text-foreground truncate">
          {chapter.title}
        </span>
      )}
    </nav>
  );
};
