import React, { useState, useEffect, useMemo } from 'react';
import { X, Loader2, Check, AlertCircle, Download, Image, Video, DollarSign, Users, ExternalLink, Link2, Unlink, ArrowRight, ArrowLeft, FolderOpen } from 'lucide-react';
import { creativesApi, TopCreativePreview, ImportResult } from '../services/creativesApi';
import { directionsApi } from '../services/directionsApi';
import { Direction } from '../types/direction';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

const MAX_IMPORT_LIMIT = 500; // Практически без лимита

interface CreativeAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  accountId?: string | null;
  onImportComplete: () => void;
}

type ModalState = 'loading' | 'preview' | 'mapping' | 'importing' | 'results' | 'error';

// Креатив с учётом merge
interface MergedCreative extends TopCreativePreview {
  merged_ad_ids?: string[]; // Список ad_id которые были объединены
  merged_count?: number; // Сколько видео объединено
}

export const CreativeAnalysisModal: React.FC<CreativeAnalysisModalProps> = ({
  isOpen,
  onClose,
  accountId,
  onImportComplete
}) => {
  const [state, setState] = useState<ModalState>('loading');
  const [creatives, setCreatives] = useState<TopCreativePreview[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [totalFound, setTotalFound] = useState(0);
  const [alreadyImported, setAlreadyImported] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [importResults, setImportResults] = useState<ImportResult[]>([]);

  // Merge состояние: Map<primary_ad_id, Set<merged_ad_ids>>
  const [mergeGroups, setMergeGroups] = useState<Map<string, Set<string>>>(new Map());

  // Направления и маппинг
  const [directions, setDirections] = useState<Direction[]>([]);
  const [directionsLoading, setDirectionsLoading] = useState(false);
  // Маппинг ad_id -> direction_id
  const [directionMapping, setDirectionMapping] = useState<Map<string, string>>(new Map());

  // Получаем userId из localStorage
  const getUserId = (): string | null => {
    const storedUser = localStorage.getItem('user');
    if (!storedUser) return null;
    try {
      const userData = JSON.parse(storedUser);
      return userData.id || null;
    } catch {
      return null;
    }
  };

  // Загружаем превью при открытии модалки
  useEffect(() => {
    if (isOpen) {
      loadPreview();
    }
  }, [isOpen, accountId]);

  const loadPreview = async () => {
    setState('loading');
    setError(null);
    setSelectedIds(new Set());
    setMergeGroups(new Map());

    try {
      const response = await creativesApi.getTopCreativesPreview(accountId);

      if (!response.success) {
        setError(response.error || 'Не удалось загрузить креативы');
        setState('error');
        return;
      }

      setCreatives(response.creatives);
      setTotalFound(response.total_found);
      setAlreadyImported(response.already_imported);

      // НЕ выбираем автоматически, так как может быть много видео
      setState('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
      setState('error');
    }
  };

  // Вычисляем креативы с учётом merge
  const displayCreatives = useMemo((): MergedCreative[] => {
    // Собираем все ad_id которые были merged в другие группы
    const mergedIntoOthers = new Set<string>();
    mergeGroups.forEach((mergedIds) => {
      mergedIds.forEach(id => mergedIntoOthers.add(id));
    });

    // Фильтруем - показываем только "главные" креативы (не merged в другие)
    return creatives
      .filter(c => !mergedIntoOthers.has(c.ad_id))
      .map(c => {
        const mergedIds = mergeGroups.get(c.ad_id);
        if (!mergedIds || mergedIds.size === 0) {
          return c as MergedCreative;
        }

        // Суммируем статистику merged креативов
        const mergedCreatives = creatives.filter(mc => mergedIds.has(mc.ad_id));
        const totalSpend = c.spend + mergedCreatives.reduce((sum, mc) => sum + mc.spend, 0);
        const totalLeads = c.leads + mergedCreatives.reduce((sum, mc) => sum + mc.leads, 0);
        const mergedCpl = totalLeads > 0 ? totalSpend / totalLeads : 0;

        return {
          ...c,
          spend: totalSpend,
          leads: totalLeads,
          cpl: mergedCpl,
          cpl_cents: Math.round(mergedCpl * 100),
          merged_ad_ids: [c.ad_id, ...Array.from(mergedIds)],
          merged_count: 1 + mergedCreatives.length,
        } as MergedCreative;
      })
      // Пересортируем по CPL после merge
      .sort((a, b) => a.cpl - b.cpl);
  }, [creatives, mergeGroups]);

  const handleSelectAll = () => {
    const notImportedIds = displayCreatives
      .filter(c => !c.already_imported)
      .slice(0, MAX_IMPORT_LIMIT)
      .map(c => c.ad_id);
    setSelectedIds(new Set(notImportedIds));
  };

  const handleDeselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleToggle = (adId: string) => {
    const creative = displayCreatives.find(c => c.ad_id === adId);
    if (creative?.already_imported) return;

    const newSelected = new Set(selectedIds);
    if (newSelected.has(adId)) {
      newSelected.delete(adId);
    } else {
      // Проверяем лимит
      if (newSelected.size >= MAX_IMPORT_LIMIT) {
        return; // Не добавляем если лимит достигнут
      }
      newSelected.add(adId);
    }
    setSelectedIds(newSelected);
  };

  // Функция объединения выбранных видео - простая логика!
  const handleMergeSelected = () => {
    if (selectedIds.size < 2) return;

    const selectionArray = Array.from(selectedIds);
    // Находим креатив с лучшим CPL - он станет "главным"
    const selectedCreatives = displayCreatives.filter(c => selectedIds.has(c.ad_id));
    selectedCreatives.sort((a, b) => a.cpl - b.cpl);
    const primaryId = selectedCreatives[0].ad_id;
    const othersIds = selectionArray.filter(id => id !== primaryId);

    const newMergeGroups = new Map(mergeGroups);

    // Если главный уже имеет merged - добавляем к существующей группе
    const existingGroup = newMergeGroups.get(primaryId) || new Set();

    // Добавляем все выбранные (кроме primary) в группу
    othersIds.forEach(id => {
      // Если этот id сам был primary с группой - переносим его группу тоже
      const itsGroup = newMergeGroups.get(id);
      if (itsGroup) {
        itsGroup.forEach(subId => existingGroup.add(subId));
        newMergeGroups.delete(id);
      }
      existingGroup.add(id);
    });

    newMergeGroups.set(primaryId, existingGroup);

    setMergeGroups(newMergeGroups);

    // Сбрасываем выделение после объединения
    setSelectedIds(new Set());
  };

  // Функция разъединения группы
  const handleUnmerge = (primaryId: string) => {
    const newMergeGroups = new Map(mergeGroups);
    newMergeGroups.delete(primaryId);
    setMergeGroups(newMergeGroups);
  };

  // Загрузка направлений
  const loadDirections = async () => {
    const userId = getUserId();
    if (!userId) {
      setError('Не удалось получить ID пользователя');
      setState('error');
      return;
    }

    setDirectionsLoading(true);
    try {
      const data = await directionsApi.list(userId, accountId, 'facebook');
      setDirections(data);
    } catch (err) {

      setError('Не удалось загрузить направления');
      setState('error');
    } finally {
      setDirectionsLoading(false);
    }
  };

  // Переход к маппингу направлений
  const handleGoToMapping = async () => {
    if (selectedIds.size === 0) return;
    setState('mapping');
    await loadDirections();
  };

  // Подсчёт общего количества ad_ids (с учётом merged)
  const countTotalAdIds = (): number => {
    let total = 0;
    selectedIds.forEach(primaryId => {
      total++; // сам primary
      const mergedIds = mergeGroups.get(primaryId);
      if (mergedIds) {
        total += mergedIds.size;
      }
    });
    return total;
  };

  // Установка направления для креатива
  const handleSetDirection = (adId: string, directionId: string) => {
    const newMapping = new Map(directionMapping);
    if (directionId) {
      newMapping.set(adId, directionId);
    } else {
      newMapping.delete(adId);
    }
    setDirectionMapping(newMapping);
  };

  // Вернуться к preview
  const handleBackToPreview = () => {
    setState('preview');
  };

  const handleImport = async () => {
    if (selectedIds.size === 0) return;

    setState('importing');
    setError(null);

    try {
      // Отправляем ТОЛЬКО primary ad_ids (1 группа = 1 видео)
      // Merged ad_ids не нужно скачивать отдельно - это то же самое видео
      const creativesMappings: Array<{ ad_id: string; direction_id: string | null }> = [];

      selectedIds.forEach(primaryId => {
        const directionId = directionMapping.get(primaryId) || null;
        creativesMappings.push({ ad_id: primaryId, direction_id: directionId });
      });


      const response = await creativesApi.importSelectedCreatives(
        creativesMappings.map(m => m.ad_id),
        accountId,
        creativesMappings
      );

      if (!response.success) {
        setError(response.error || 'Ошибка импорта');
        setState('error');
        return;
      }

      setImportResults(response.results);
      setState('results');

      // Уведомляем родителя об успешном импорте
      if (response.imported > 0) {
        onImportComplete();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка импорта');
      setState('error');
    }
  };

  const handleClose = () => {
    // Сбрасываем состояние при закрытии
    setState('loading');
    setCreatives([]);
    setSelectedIds(new Set());
    setImportResults([]);
    setError(null);
    setMergeGroups(new Map());
    onClose();
  };

  if (!isOpen) return null;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2
    }).format(value);
  };

  const availableForImport = displayCreatives.filter(c => !c.already_imported).length;
  const allSelected = selectedIds.size === Math.min(availableForImport, MAX_IMPORT_LIMIT) && availableForImport > 0;
  const isLimitReached = selectedIds.size >= MAX_IMPORT_LIMIT;
  const canMerge = selectedIds.size >= 2;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative bg-card rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col border border-border">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-xl font-semibold text-foreground">
              Анализ креативов
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Креативы с минимум 5 лидами за 90 дней
            </p>
          </div>
          <button
            onClick={handleClose}
            className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-accent transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Loading State */}
          {state === 'loading' && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="w-10 h-10 text-muted-foreground animate-spin mb-4" />
              <p className="text-foreground">
                Анализируем рекламный кабинет...
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                Ищем креативы с минимум 5 лидами
              </p>
            </div>
          )}

          {/* Error State */}
          {state === 'error' && (
            <div className="flex flex-col items-center justify-center py-12">
              <AlertCircle className="w-12 h-12 text-destructive mb-4" />
              <p className="text-foreground font-medium mb-2">
                Ошибка
              </p>
              <p className="text-muted-foreground text-center max-w-md">
                {error}
              </p>
              <Button onClick={loadPreview} className="mt-4">
                Попробовать снова
              </Button>
            </div>
          )}

          {/* Preview State */}
          {state === 'preview' && (
            <>
              {/* Stats */}
              <div className="flex items-center gap-4 mb-4 text-sm text-muted-foreground">
                <span>Найдено: <strong className="text-foreground">{totalFound}</strong> креативов</span>
                {alreadyImported > 0 && (
                  <span>
                    Уже импортировано: <strong className="text-foreground">{alreadyImported}</strong>
                  </span>
                )}
                {mergeGroups.size > 0 && (
                  <span>
                    Объединено групп: <strong className="text-foreground">{mergeGroups.size}</strong>
                  </span>
                )}
              </div>


              {displayCreatives.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  Не найдено креативов с достаточным количеством лидов
                </div>
              ) : (
                <>
                  {/* Controls */}
                  <div className="flex items-center gap-3 mb-4">
                    <button
                      onClick={allSelected ? handleDeselectAll : handleSelectAll}
                      className="text-sm text-foreground hover:text-muted-foreground transition-colors"
                    >
                      {allSelected ? 'Снять выделение' : `Выбрать все (до ${MAX_IMPORT_LIMIT})`}
                    </button>
                    <span className="text-sm text-muted-foreground">
                      Выбрано: {selectedIds.size} из {Math.min(availableForImport, MAX_IMPORT_LIMIT)}
                    </span>
                  </div>

                  {/* Creatives List */}
                  <div className="space-y-3">
                    {displayCreatives.map((creative, index) => {
                      const isMerged = (creative.merged_count || 0) > 1;
                      const isSelected = selectedIds.has(creative.ad_id);

                      return (
                        <div
                          key={creative.ad_id}
                          onClick={() => handleToggle(creative.ad_id)}
                          className={`
                            flex items-center gap-4 p-4 rounded-lg border-2 transition-all
                            ${creative.already_imported
                              ? 'border-border bg-muted opacity-60 cursor-not-allowed'
                              : isSelected
                                ? 'border-foreground/50 bg-accent cursor-pointer'
                                : isLimitReached
                                  ? 'border-border bg-card opacity-50 cursor-not-allowed'
                                  : 'border-border hover:border-foreground/30 cursor-pointer bg-card'
                            }
                          `}
                        >
                          {/* Rank */}
                          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-sm font-bold text-foreground">
                            {index + 1}
                          </div>

                          {/* Thumbnail */}
                          <div className="flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden bg-secondary relative">
                            {creative.thumbnail_url ? (
                              <img
                                src={creative.thumbnail_url}
                                alt={creative.ad_name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <Image className="w-6 h-6 text-muted-foreground" />
                              </div>
                            )}
                            {creative.is_video && (
                              <div className="absolute bottom-1 right-1 bg-black/70 rounded px-1">
                                <Video className="w-3 h-3 text-white" />
                              </div>
                            )}
                            {isMerged && (
                              <div className="absolute top-1 left-1 bg-foreground rounded px-1.5 py-0.5 text-[10px] text-background font-medium">
                                x{creative.merged_count}
                              </div>
                            )}
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-foreground truncate">
                              {creative.ad_name}
                            </p>
                            <div className="flex items-center gap-4 mt-1 text-sm">
                              <span className="flex items-center gap-1 text-foreground">
                                <DollarSign className="w-3.5 h-3.5" />
                                CPL: {formatCurrency(creative.cpl)}
                              </span>
                              <span className="flex items-center gap-1 text-muted-foreground">
                                <Users className="w-3.5 h-3.5" />
                                {creative.leads} лидов
                              </span>
                            </div>
                          </div>

                          {/* Unmerge button (for merged creatives) */}
                          {isMerged && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleUnmerge(creative.ad_id);
                              }}
                              className="flex-shrink-0 p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-accent transition-colors"
                              title="Разъединить"
                            >
                              <Unlink className="w-4 h-4" />
                            </button>
                          )}

                          {/* View in Ads Manager */}
                          <a
                            href={creative.preview_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="flex-shrink-0 p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-accent transition-colors"
                            title="Открыть в Ads Manager"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>

                          {/* Checkbox / Status */}
                          <div className="flex-shrink-0">
                            {creative.already_imported ? (
                              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-secondary px-2 py-1 rounded">
                                <Check className="w-3 h-3" />
                                Импортирован
                              </span>
                            ) : (
                              <div className={`
                                w-6 h-6 rounded border-2 flex items-center justify-center transition-colors
                                ${isSelected
                                  ? 'bg-foreground border-foreground'
                                  : 'border-border'
                                }
                              `}>
                                {isSelected && (
                                  <Check className="w-4 h-4 text-background" />
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}

          {/* Mapping State */}
          {state === 'mapping' && (
            <>
              {directionsLoading ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 className="w-10 h-10 text-muted-foreground animate-spin mb-4" />
                  <p className="text-foreground">Загружаем направления...</p>
                </div>
              ) : directions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <FolderOpen className="w-12 h-12 text-muted-foreground mb-4" />
                  <p className="text-foreground font-medium mb-2">Нет направлений</p>
                  <p className="text-muted-foreground text-center max-w-md">
                    Создайте направления в профиле, чтобы привязать к ним креативы
                  </p>
                  <Button onClick={handleBackToPreview} className="mt-4" variant="outline">
                    <ArrowLeft className="w-4 h-4" />
                    Назад
                  </Button>
                </div>
              ) : (
                <>
                  <div className="mb-4">
                    <p className="text-sm text-muted-foreground">
                      Выберите направление для каждого креатива. Направление определяет, в какую кампанию будет загружен креатив.
                    </p>
                  </div>

                  {/* Список креативов для маппинга */}
                  <div className="space-y-3">
                    {displayCreatives
                      .filter(c => selectedIds.has(c.ad_id))
                      .map((creative) => {
                        const isMerged = (creative.merged_count || 0) > 1;
                        const selectedDirectionId = directionMapping.get(creative.ad_id) || '';

                        return (
                          <div
                            key={creative.ad_id}
                            className="flex items-center gap-4 p-4 rounded-lg border border-border bg-card"
                          >
                            {/* Thumbnail */}
                            <div className="flex-shrink-0 w-12 h-12 rounded-lg overflow-hidden bg-secondary relative">
                              {creative.thumbnail_url ? (
                                <img
                                  src={creative.thumbnail_url}
                                  alt={creative.ad_name}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <Image className="w-5 h-5 text-muted-foreground" />
                                </div>
                              )}
                              {isMerged && (
                                <div className="absolute top-0.5 left-0.5 bg-foreground rounded px-1 py-0.5 text-[9px] text-background font-medium">
                                  x{creative.merged_count}
                                </div>
                              )}
                            </div>

                            {/* Info */}
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-foreground truncate text-sm">
                                {creative.ad_name}
                              </p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                CPL: {formatCurrency(creative.cpl)} • {creative.leads} лидов
                              </p>
                            </div>

                            {/* Direction Select */}
                            <div className="flex-shrink-0 w-48">
                              <Select
                                value={selectedDirectionId}
                                onValueChange={(value) => handleSetDirection(creative.ad_id, value)}
                              >
                                <SelectTrigger className="h-9">
                                  <SelectValue placeholder="Выберите направление" />
                                </SelectTrigger>
                                <SelectContent>
                                  {directions.map((dir) => (
                                    <SelectItem key={dir.id} value={dir.id}>
                                      {dir.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </>
              )}
            </>
          )}

          {/* Importing State */}
          {state === 'importing' && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="w-10 h-10 text-muted-foreground animate-spin mb-4" />
              <p className="text-foreground">
                Импортируем выбранные креативы...
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                Скачиваем видео и создаём транскрипции
              </p>
            </div>
          )}

          {/* Results State */}
          {state === 'results' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-foreground">
                <Check className="w-6 h-6" />
                <span className="font-medium">
                  Импортировано: {importResults.filter(r => r.success).length} из {importResults.length}
                </span>
              </div>

              <div className="space-y-2 max-h-80 overflow-y-auto">
                {importResults.map(result => (
                  <div
                    key={result.ad_id}
                    className={`
                      flex items-center gap-3 p-3 rounded-lg
                      ${result.success
                        ? 'bg-secondary'
                        : 'bg-destructive/10'
                      }
                    `}
                  >
                    {result.success ? (
                      <Check className="w-5 h-5 text-foreground flex-shrink-0" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">
                        {result.ad_name}
                      </p>
                      {result.error && (
                        <p className="text-xs text-destructive">
                          {result.error}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border bg-muted/50">
          {state === 'preview' && (
            <div className="flex items-center justify-between">
              <Button variant="ghost" onClick={handleClose}>
                Отмена
              </Button>
              <div className="flex items-center gap-2">
                {/* Кнопка объединения - активна когда выбрано 2+ */}
                <Button
                  onClick={handleMergeSelected}
                  disabled={!canMerge}
                  variant="outline"
                  title={canMerge ? 'Объединить выбранные видео в одно' : 'Выберите 2+ видео для объединения'}
                >
                  <Link2 className="w-4 h-4" />
                  Объединить ({selectedIds.size})
                </Button>
                <span className="text-sm text-muted-foreground">
                  {selectedIds.size} видео
                </span>
                <Button
                  onClick={handleGoToMapping}
                  disabled={selectedIds.size === 0}
                >
                  Далее
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}

          {state === 'mapping' && directions.length > 0 && (
            <div className="flex items-center justify-between">
              <Button variant="ghost" onClick={handleBackToPreview}>
                <ArrowLeft className="w-4 h-4" />
                Назад
              </Button>
              <Button
                onClick={handleImport}
                disabled={selectedIds.size === 0}
              >
                <Download className="w-4 h-4" />
                Импортировать ({selectedIds.size})
              </Button>
            </div>
          )}

          {state === 'results' && (
            <div className="flex justify-end">
              <Button onClick={handleClose}>
                Готово
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CreativeAnalysisModal;
