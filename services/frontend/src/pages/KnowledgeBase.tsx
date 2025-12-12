import React, { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Header from '../components/Header';
import { KBSidebar } from '../components/knowledge-base/KBSidebar';
import { KBArticle } from '../components/knowledge-base/KBArticle';
import { KBBreadcrumbs } from '../components/knowledge-base/KBBreadcrumbs';
import { KBSearch } from '../components/knowledge-base/KBSearch';
import { knowledgeBaseContent, type Chapter } from '../content/knowledge-base';
import { Input } from '../components/ui/input';
import { Search, BookOpen, Menu, ChevronRight, GraduationCap } from 'lucide-react';
import { forceStartTour } from '@/hooks/useOnboardingTour';
import { Button } from '../components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '../components/ui/sheet';
import { ScrollArea } from '../components/ui/scroll-area';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../components/ui/collapsible';

const KnowledgeBase: React.FC = () => {
  const { chapterId, sectionId } = useParams<{ chapterId?: string; sectionId?: string }>();
  const navigate = useNavigate();
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [expandedChapter, setExpandedChapter] = useState<string | null>(chapterId || null);

  // Находим текущую главу и раздел
  const currentChapter = useMemo(() => {
    if (!chapterId) return null;
    return knowledgeBaseContent.find(ch => ch.id === chapterId) || null;
  }, [chapterId]);

  const currentSection = useMemo(() => {
    if (!currentChapter || !sectionId) return null;
    return currentChapter.sections.find(s => s.id === sectionId) || null;
  }, [currentChapter, sectionId]);

  // Фильтрация по поиску
  const filteredChapters = useMemo(() => {
    if (!searchQuery.trim()) return knowledgeBaseContent;

    const query = searchQuery.toLowerCase();
    return knowledgeBaseContent.map(chapter => {
      const matchingSections = chapter.sections.filter(section =>
        section.title.toLowerCase().includes(query) ||
        section.content.toLowerCase().includes(query)
      );

      const chapterMatches = chapter.title.toLowerCase().includes(query);

      if (chapterMatches || matchingSections.length > 0) {
        return {
          ...chapter,
          sections: matchingSections.length > 0 ? matchingSections : chapter.sections,
        };
      }
      return null;
    }).filter(Boolean) as Chapter[];
  }, [searchQuery]);

  const handleNavigate = (chapterId: string, sectionId?: string) => {
    setMobileSidebarOpen(false);
    if (sectionId) {
      navigate(`/knowledge-base/${chapterId}/${sectionId}`);
    } else {
      navigate(`/knowledge-base/${chapterId}`);
    }
  };

  // Главная страница базы знаний (без выбранной главы)
  const renderHome = () => (
    <div className="space-y-8">
      <div className="text-center space-y-4">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
          <BookOpen className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-3xl font-bold">База знаний</h1>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          Добро пожаловать в базу знаний Performante.ai! Здесь вы найдете подробные инструкции
          по всем функциям платформы — от первых шагов до продвинутых возможностей.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => forceStartTour()}
          className="mt-4"
        >
          <GraduationCap className="h-4 w-4 mr-2" />
          Пройти обучение заново
        </Button>
      </div>

      {/* Поиск */}
      <div className="max-w-md mx-auto">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по базе знаний..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Список глав */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filteredChapters.map((chapter) => (
          <button
            key={chapter.id}
            onClick={() => handleNavigate(chapter.id, chapter.sections[0]?.id)}
            className="p-6 rounded-lg border bg-card text-left hover:border-primary/50 hover:shadow-md transition-all"
          >
            <div className="flex items-start gap-4">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 text-primary font-semibold">
                {chapter.order}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold mb-1">{chapter.title}</h3>
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {chapter.description}
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  {chapter.sections.length} {chapter.sections.length === 1 ? 'раздел' :
                    chapter.sections.length < 5 ? 'раздела' : 'разделов'}
                </p>
              </div>
            </div>
          </button>
        ))}
      </div>

      {filteredChapters.length === 0 && searchQuery && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">
            По запросу "{searchQuery}" ничего не найдено
          </p>
        </div>
      )}
    </div>
  );

  return (
    <div className="w-full">
      <Header
        onOpenDatePicker={() => setDatePickerOpen(true)}
        title="База знаний"
        showBack={!!chapterId}
        onBack={() => navigate('/knowledge-base')}
      />

      <div className="pt-[60px] pb-20 lg:pb-0" data-tour="knowledge-content">
        {/* Mobile: содержание в Sheet */}
        <div className="lg:hidden fixed bottom-20 right-4 z-40">
          <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
            <SheetTrigger asChild>
              <Button size="icon" className="rounded-full shadow-lg">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-80 p-0">
              <div className="p-4 border-b">
                <h2 className="font-semibold">Содержание</h2>
              </div>
              <div className="p-4">
                <KBSearch
                  value={searchQuery}
                  onChange={setSearchQuery}
                />
              </div>
              <div className="overflow-y-auto max-h-[calc(100vh-180px)]">
                <KBSidebar
                  chapters={filteredChapters}
                  currentChapterId={chapterId}
                  currentSectionId={sectionId}
                  onNavigate={handleNavigate}
                />
              </div>
            </SheetContent>
          </Sheet>
        </div>

        {/* Main content */}
        <div className="max-w-4xl mx-auto px-4 py-8">
          {currentChapter && currentSection ? (
            <>
              <KBBreadcrumbs
                chapter={currentChapter}
                section={currentSection}
                onNavigateHome={() => navigate('/knowledge-base')}
                onNavigateChapter={() => handleNavigate(currentChapter.id, currentChapter.sections[0]?.id)}
              />
              <KBArticle
                chapter={currentChapter}
                section={currentSection}
                onNavigate={handleNavigate}
              />
            </>
          ) : currentChapter ? (
            <>
              <KBBreadcrumbs
                chapter={currentChapter}
                onNavigateHome={() => navigate('/knowledge-base')}
              />
              {/* Показываем первый раздел главы */}
              {currentChapter.sections[0] && (
                <KBArticle
                  chapter={currentChapter}
                  section={currentChapter.sections[0]}
                  onNavigate={handleNavigate}
                />
              )}
            </>
          ) : (
            renderHome()
          )}
        </div>
      </div>
    </div>
  );
};

export default KnowledgeBase;
