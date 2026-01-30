import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppContext } from "@/context/AppContext";
import Header from "@/components/Header";
import PageHero from "@/components/common/PageHero";
import { useUserCreatives } from "@/hooks/useUserCreatives";
import { creativesApi, UserCreative, CarouselCard } from "@/services/creativesApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Upload, PlayCircle, Trash2, RefreshCw, CheckCircle2, XCircle, Sparkles, Loader2, TrendingUp, Target, Video, Image, Images, Pencil, Megaphone, Mic, Rocket, Download, Zap, Instagram } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { manualLaunchAds, ManualLaunchResponse } from "@/services/manualLaunchApi";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { creativesApi as creativesService } from "@/services/creativesApi";
import { API_BASE_URL } from "@/config/api";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDirections } from "@/hooks/useDirections";
import { getDirectionObjectiveLabel, OBJECTIVE_LABELS } from "@/types/direction";
import { useNavigate } from "react-router-dom";
import { getCreativeAnalytics, type CreativeAnalytics } from "@/services/creativeAnalyticsApi";
import { TestStatusIndicator } from "@/components/TestStatusIndicator";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { TooltipKeys } from "@/content/tooltips";
import { CreativeAnalysisModal } from "@/components/CreativeAnalysisModal";
import { cn } from "@/lib/utils";
import { FEATURES } from "@/config/appReview";

// Утилита для получения thumbnail URL через Supabase Transform
const getThumbnailUrl = (url: string | null | undefined, width = 200, height = 250): string | null => {
  if (!url) return null;

  // Проверяем, что это Supabase Storage URL
  if (!url.includes('supabase')) return url;

  // Разбиваем URL на части
  const urlParts = url.split('/storage/v1/object/public/');
  if (urlParts.length !== 2) return url;

  const baseUrl = urlParts[0];
  const pathPart = urlParts[1];

  // Формируем URL с трансформацией
  return `${baseUrl}/storage/v1/render/image/public/${pathPart}?width=${width}&height=${height}&resize=contain`;
};

type UploadItemStatus = "queued" | "uploading" | "success" | "error";

type UploadItem = {
  id: string;
  file: File;
  name: string;
  status: UploadItemStatus;
  progress: number;
  recordId?: string | null;
  error?: string;
};

type CreativeDetailsProps = {
  creativeId: string;
  createdAt: string;
  fbCreativeIds: string[];
  demoMode?: boolean;
  mediaType?: 'video' | 'image' | 'carousel' | null;
  imageUrl?: string | null;
  carouselData?: CarouselCard[] | null;
};

type TranscriptSuggestion = {
  from: string;
  to: string;
  reason: string;
};

type CreativeTest = {
  id: string;
  user_creative_id: string;
  user_id: string;
  campaign_id: string | null;
  adset_id: string | null;
  ad_id: string | null;
  rule_id: string | null;
  test_budget_cents: number;
  test_impressions_limit: number;
  objective: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  started_at: string | null;
  completed_at: string | null;
  impressions: number;
  reach: number;
  frequency: number;
  clicks: number;
  link_clicks: number;
  ctr: number;
  link_ctr: number;
  leads: number;
  spend_cents: number;
  cpm_cents: number | null;
  cpc_cents: number | null;
  cpl_cents: number | null;
  video_views: number;
  video_views_25_percent: number;
  video_views_50_percent: number;
  video_views_75_percent: number;
  video_views_95_percent: number;
  video_avg_watch_time_sec: number;
  llm_score: number | null;
  llm_verdict: "excellent" | "good" | "average" | "poor" | null;
  llm_reasoning: string | null;
  llm_video_analysis: string | null;
  llm_text_recommendations: string | null;
  transcript_match_quality: "high" | "medium" | "low" | "N/A" | null;
  transcript_suggestions: TranscriptSuggestion[] | null;
  created_at: string;
  updated_at: string;
};

const statusMeta: Record<CreativeTest["status"], { label: string; className: string }> = {
  pending: { label: "⏳ Ожидание", className: "bg-muted text-muted-foreground" },
  running: { label: "▶️ Тестируется", className: "bg-blue-100 text-blue-700 dark:bg-gray-800/40 dark:text-gray-300" },
  completed: { label: "✅ Завершено", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200" },
  failed: { label: "❌ Ошибка", className: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200" },
  cancelled: { label: "⛔ Отменено", className: "bg-muted text-muted-foreground" },
};

const verdictMeta: Record<NonNullable<CreativeTest["llm_verdict"]>, { label: string; emoji: string; className: string }> = {
  excellent: { label: "Отлично", emoji: "🌟", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200" },
  good: { label: "Хорошо", emoji: "👍", className: "bg-blue-100 text-blue-700 dark:bg-gray-800/40 dark:text-gray-300" },
  average: { label: "Средне", emoji: "😐", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200" },
  poor: { label: "Слабо", emoji: "👎", className: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200" },
};

const formatCurrency = (cents: number | null | undefined) => {
  if (cents === null || cents === undefined) return "—";
  return `$${(cents / 100).toFixed(2)}`;
};

const formatPercent = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value.toFixed(2)}%`;
};

const formatNumber = (value: number | null | undefined) => {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString();
};

const formatSeconds = (seconds: number | null | undefined) => {
  if (!seconds || Number.isNaN(seconds)) return "—";
  if (seconds < 60) return `${seconds.toFixed(1)} сек`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins} мин ${secs.toString().padStart(2, "0")} сек`;
};

const FACEBOOK_MIN_DAILY_BUDGET = 10;
const TIKTOK_MIN_DAILY_BUDGET = 2500;

// Генерация цвета для направления на основе его ID
const getDirectionColor = (directionId: string): string => {
  const colors = [
    "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200",
    "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-200",
    "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200",
    "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-200",
    "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-200",
    "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200",
    "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-200",
    "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-200",
  ];
  
  // Используем хеш от ID для выбора цвета
  let hash = 0;
  for (let i = 0; i < directionId.length; i++) {
    hash = directionId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % colors.length;
  return colors[index];
};

// Генерация цвета кружка (hex) для направления
const getDirectionDotColor = (directionId: string): string => {
  const colors = [
    "#3B82F6", // blue
    "#A855F7", // purple
    "#F59E0B", // amber
    "#EC4899", // pink
    "#06B6D4", // cyan
    "#6366F1", // indigo
    "#14B8A6", // teal
    "#F97316", // orange
  ];

  let hash = 0;
  for (let i = 0; i < directionId.length; i++) {
    hash = directionId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % colors.length;
  return colors[index];
};

// Компонент Badge с быстрым выбором направления
type DirectionBadgeProps = {
  creative: UserCreative;
  currentDirection: any;
  directions: any[];
  onDirectionChange: (directionId: string | null) => Promise<void>;
};

const DirectionBadge: React.FC<DirectionBadgeProps> = ({ 
  creative, 
  currentDirection, 
  directions,
  onDirectionChange 
}) => {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const handleDirectionSelect = async (directionId: string | null) => {
    setOpen(false);
    await onDirectionChange(directionId);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div onClick={(e) => e.stopPropagation()}>
          {currentDirection ? (
            <>
              {/* Мобильная версия: цветной кружок */}
              <div
                className="sm:hidden w-3 h-3 rounded-full cursor-pointer hover:opacity-80 transition-opacity"
                style={{ backgroundColor: getDirectionDotColor(currentDirection.id) }}
                title={currentDirection.name}
              />
              {/* Десктопная версия: полное название */}
              <Badge
                className={`hidden sm:inline-flex ${getDirectionColor(currentDirection.id)} text-xs px-2 py-0.5 cursor-pointer hover:opacity-80 transition-opacity max-w-[120px] truncate`}
                title={currentDirection.name}
              >
                {currentDirection.name}
              </Badge>
            </>
          ) : (
            <>
              {/* Мобильная версия: серый кружок */}
              <div
                className="sm:hidden w-3 h-3 rounded-full border border-dashed border-gray-400 cursor-pointer hover:bg-muted/50 transition-colors"
                title="Без направления"
              />
              {/* Десктопная версия: полное название */}
              <Badge
                variant="outline"
                className="hidden sm:inline-flex text-xs px-2 py-0.5 text-muted-foreground border-dashed cursor-pointer hover:bg-muted/50 transition-colors whitespace-nowrap"
              >
                Без направления
              </Badge>
            </>
          )}
        </div>
      </PopoverTrigger>
      <PopoverContent 
        className="w-64 p-2" 
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground px-2 py-1">
            Выберите направление
          </div>
          <div className="space-y-0.5 max-h-48 overflow-y-auto">
            <button
              onClick={() => handleDirectionSelect(null)}
              className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted transition-colors"
            >
              <span className="text-muted-foreground">Без направления</span>
            </button>
            {directions.map((dir) => (
              <button
                key={dir.id}
                onClick={() => handleDirectionSelect(dir.id)}
                className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted transition-colors flex items-center gap-2"
              >
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: getDirectionDotColor(dir.id) }}
                />
                <span className="flex-1 truncate">{dir.name}</span>
                <span className="text-xs text-muted-foreground">
                  {getDirectionObjectiveLabel(dir)}
                </span>
              </button>
            ))}
          </div>
          {directions.length === 0 && (
            <div className="px-2 py-3 text-xs text-muted-foreground">
              Нет направлений.{' '}
              <button
                onClick={() => {
                  setOpen(false);
                  navigate('/profile');
                }}
                className="text-primary underline hover:no-underline"
              >
                Создать
              </button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

type TestLaunchResult = {
  success: boolean;
  test_id: string;
  campaign_id: string;
  adset_id: string;
  ad_id: string;
  rule_id: string | null;
  objective: string;
  direction_id: string;
  message: string;
};

// Форматирование даты+времени по часовому поясу Алматы (UTC+5)
const formatDateAlmaty = (dateString: string): string => {
  const date = new Date(dateString);
  const almatyOffset = 5 * 60; // UTC+5 в минутах
  const localOffset = date.getTimezoneOffset();
  const almatyDate = new Date(date.getTime() + (almatyOffset + localOffset) * 60 * 1000);
  return format(almatyDate, 'yyyy-MM-dd HH:mm');
};

// Конфигурация для badge типа медиа
type MediaType = 'video' | 'image' | 'carousel' | null | undefined;

const MEDIA_TYPE_CONFIG: Record<string, { icon: React.ComponentType<{ className?: string }>; label: string; className: string }> = {
  video: {
    icon: Video,
    label: 'Видео',
    className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200'
  },
  image: {
    icon: Image,
    label: 'Картинка',
    className: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200'
  },
  carousel: {
    icon: Images,
    label: 'Карусель',
    className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-200'
  }
};

// Компонент Badge типа медиа
type MediaTypeBadgeProps = {
  mediaType: MediaType;
  showLabel?: boolean;
};

const MediaTypeBadge: React.FC<MediaTypeBadgeProps> = ({ mediaType, showLabel = true }) => {
  if (!mediaType) return null;

  const config = MEDIA_TYPE_CONFIG[mediaType];
  if (!config) return null;

  const Icon = config.icon;

  return (
    <Badge className={`text-xs px-2 py-0.5 gap-1 flex items-center ${config.className}`}>
      <Icon className="h-3 w-3" />
      {showLabel && <span>{config.label}</span>}
    </Badge>
  );
};

// Компонент для inline-редактирования названия
type EditableTitleProps = {
  title: string;
  creativeId: string;
  onSave: (id: string, newTitle: string) => Promise<void>;
};

const EditableTitle: React.FC<EditableTitleProps> = ({ title, creativeId, onSave }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(title);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    setEditValue(title);
  }, [title]);

  const handleSave = async () => {
    if (editValue.trim() === title || !editValue.trim()) {
      setEditValue(title);
      setIsEditing(false);
      return;
    }
    setIsSaving(true);
    try {
      await onSave(creativeId, editValue.trim());
    } finally {
      setIsSaving(false);
      setIsEditing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    }
    if (e.key === 'Escape') {
      setEditValue(title);
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <Input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSave}
          disabled={isSaving}
          className="h-7 text-sm py-1 px-2 max-w-[200px]"
        />
        {isSaving && <Loader2 className="h-3 w-3 animate-spin" />}
      </div>
    );
  }

  return (
    <div
      className="font-medium text-left truncate max-w-[150px] sm:max-w-[250px] cursor-pointer hover:underline group flex items-center gap-1"
      title={`${title} (нажмите для редактирования)`}
      onClick={(e) => {
        e.stopPropagation();
        setIsEditing(true);
      }}
    >
      <span className="truncate">{title}</span>
      <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-50 transition-opacity flex-shrink-0" />
    </div>
  );
};

const CreativeDetails: React.FC<CreativeDetailsProps> = ({ creativeId, fbCreativeIds, demoMode = false, mediaType, imageUrl, carouselData }) => {
  const { currentAdAccountId } = useAppContext();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<CreativeAnalytics | null>(null);
  const [quickTestLoading, setQuickTestLoading] = useState(false);
  const [stopTestLoading, setStopTestLoading] = useState(false);
  const [refreshLoading, setRefreshLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [testResultDialogOpen, setTestResultDialogOpen] = useState(false);
  const [testLaunchResult, setTestLaunchResult] = useState<TestLaunchResult | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  // Локальное состояние для отслеживания запущенного теста (не зависит от analytics API)
  const [localTestRunning, setLocalTestRunning] = useState(false);

  const fetchData = useCallback(async (forceRefresh: boolean = false) => {
    const transcriptPromise = creativesService.getCreativeText(creativeId, mediaType || 'video', carouselData).catch((error) => {
      console.error("creative text load error", error);
      return { text: null };
    });

    const analyticsPromise = (async () => {
      try {
        console.log(`[CreativeAnalytics] Загружаем аналитику для креатива: ${creativeId}, force: ${forceRefresh}`);

        // Получаем userId
        const storedUser = localStorage.getItem('user');
        if (!storedUser) {
          console.error('[CreativeAnalytics] Пользователь не авторизован');
          return null;
        }

        const userData = JSON.parse(storedUser);
        const userId = userData.id;

        if (!userId) {
          console.error('[CreativeAnalytics] ID пользователя не найден');
          return null;
        }

        const data = await getCreativeAnalytics(creativeId, userId, forceRefresh);
        console.log('[CreativeAnalytics] Получена аналитика:', {
          data_source: data.data_source,
          has_test: data.test !== null,
          has_production: data.production !== null,
          has_analysis: data.analysis !== null
        });

        return data;
      } catch (error) {
        console.error("[CreativeAnalytics] Ошибка при загрузке аналитики:", error);
        return null;
      }
    })();

    const [textResult, analyticsData] = await Promise.all([transcriptPromise, analyticsPromise]);
    return { transcript: textResult.text, analytics: analyticsData };
  }, [creativeId, mediaType, carouselData]);

  // Загружаем данные при открытии креатива
  useEffect(() => {
    console.log(`[CreativeDetails] useEffect triggered для креатива: ${creativeId}`);
    
    const loadData = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        console.log(`[CreativeDetails] Начинаем загрузку данных...`);
        const { transcript: t, analytics: analyticsData } = await fetchData();
        
        console.log(`[CreativeDetails] Результат загрузки:`, { 
          hasTranscript: !!t, 
          hasAnalytics: !!analyticsData,
          dataSource: analyticsData?.data_source,
        });
        
        setTranscript(t);
        setAnalytics(analyticsData);
      } catch (error) {
        console.error("[CreativeDetails] Ошибка загрузки данных:", error);
        setLoadError("Ошибка загрузки данных");
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [fetchData, creativeId]);

  // Demo mode пока отключаем, т.к. новый API предоставляет реальные данные
  // TODO: если нужен demo mode, можно создать mock analytics объект

  // Polling для обновления аналитики когда тест запущен
  useEffect(() => {
    if (!analytics?.test?.exists) return;
    if (analytics.test.status !== 'running') return;

    console.log('[CreativeDetails] Запуск polling для running теста');

    // Обновляем analytics каждые 30 секунд
    const intervalId = setInterval(async () => {
      console.log('[CreativeDetails] Polling: обновление аналитики...');
      try {
        const storedUser = localStorage.getItem('user');
        if (!storedUser) return;

        const userData = JSON.parse(storedUser);
        const userId = userData.id;
        if (!userId) return;

        const updatedAnalytics = await getCreativeAnalytics(creativeId, userId);
        setAnalytics(updatedAnalytics);

        console.log('[CreativeDetails] Polling: аналитика обновлена', {
          test_status: updatedAnalytics.test?.status,
          impressions: updatedAnalytics.test?.metrics?.impressions,
        });

        // Останавливаем polling если тест завершился
        if (updatedAnalytics.test?.status !== 'running') {
          console.log('[CreativeDetails] Тест завершён, останавливаем polling');
          clearInterval(intervalId);
        }
      } catch (error) {
        console.error('[CreativeDetails] Polling: ошибка обновления', error);
      }
    }, 30000); // 30 секунд

    return () => {
      console.log('[CreativeDetails] Очистка polling interval');
      clearInterval(intervalId);
    };
  }, [analytics?.test?.exists, analytics?.test?.status, creativeId]);

  const mockTranscript = `Демо-скрипт:\n1. Представление оффера\n2. Преимущества продукта\n3. Призыв к действию`;

  const mockTest: CreativeTest = {
    id: `mock-${creativeId}`,
    user_creative_id: creativeId,
    user_id: 'demo-user',
    campaign_id: '120235632935580463',
    adset_id: '120235644928620463',
    ad_id: '120235644931430463',
    rule_id: null,
    test_budget_cents: 1500,
    test_impressions_limit: 1000,
    objective: 'traffic',
    status: 'completed',
    started_at: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
    completed_at: new Date(Date.now() - 1 * 3600 * 1000).toISOString(),
    impressions: 940,
    reach: 720,
    frequency: 1.3,
    clicks: 132,
    link_clicks: 98,
    ctr: 14.04,
    link_ctr: 10.4,
    leads: 12,
    spend_cents: 1245,
    cpm_cents: 1326,
    cpc_cents: 944,
    cpl_cents: 10375,
    video_views: 480,
    video_views_25_percent: 360,
    video_views_50_percent: 280,
    video_views_75_percent: 180,
    video_views_95_percent: 120,
    video_avg_watch_time_sec: 23,
    llm_score: 86,
    llm_verdict: 'good',
    llm_reasoning: 'Креатив соответствует best practices: чёткий оффер, социальное доказательство и понятный CTA.',
    llm_video_analysis: 'Видео динамичное, ключевые преимущества показаны на первых секундах.',
    llm_text_recommendations: 'Добавить конкретные цифры выгоды и ограничение по времени.',
    transcript_match_quality: 'high',
    transcript_suggestions: [
      {
        from: 'Получите результат без вложений уже сегодня!',
        to: 'Получите первые 10 лидов бесплатно уже сегодня!',
        reason: 'Цифровое обещание усиливает доверие и конкретизирует выгоду.',
      },
    ],
    created_at: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };

  const handleQuickTest = async () => {
    if (demoMode) {
      toast.info('Демо-режим не поддерживается');
      return;
    }
    setQuickTestLoading(true);
    
    try {
      const storedUser = localStorage.getItem('user');
      if (!storedUser) {
        toast.error('Пользователь не авторизован');
        return;
      }
      
      const userData = JSON.parse(storedUser);
      const userId = userData.id;
      
      if (!userId) {
        toast.error('ID пользователя не найден');
        return;
      }

      // Отправляем запрос на запуск теста
      const payload: Record<string, unknown> = {
        user_creative_id: creativeId,
        user_id: userId,
        account_id: currentAdAccountId || undefined, // UUID для мультиаккаунтности
      };

      // Если тест уже был завершен/отменен, отправляем force:true для перезапуска
      const hasCompletedTest = analytics?.test?.exists && 
        (analytics.test.status === 'completed' || analytics.test.status === 'cancelled');
      
      if (hasCompletedTest) {
        payload.force = true;
      }

      const response = await fetch(`${API_BASE_URL}/creative-test/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (data.success) {
        // Сохраняем результат и открываем модальное окно
        setTestLaunchResult(data as TestLaunchResult);
        setTestResultDialogOpen(true);

        // Устанавливаем локальное состояние - тест запущен
        setLocalTestRunning(true);

        // Оптимистичное обновление analytics (для совместимости)
        setAnalytics(prev => ({
          ...prev,
          creative: prev?.creative || { id: creativeId, title: '', status: '', direction_id: null, direction_name: null },
          data_source: 'test',
          test: {
            exists: true,
            status: 'running',
            completed_at: '',
            metrics: {
              impressions: 0, reach: 0, ctr: 0, leads: 0, cpm_cents: null, cpl_cents: null,
              video_views: 0, video_views_25_percent: 0, video_views_50_percent: 0,
              video_views_75_percent: 0, video_views_95_percent: 0
            },
            llm_analysis: { score: 0, verdict: '', reasoning: '' }
          },
          production: prev?.production || null,
          analysis: prev?.analysis || null,
          from_cache: false
        }));

        // Пробуем обновить аналитику, но игнорируем ошибки (локальное состояние уже установлено)
        try {
          const freshData = await fetchData(true);
          setTranscript(freshData.transcript);
          if (freshData.analytics) {
            setAnalytics(freshData.analytics);
          }
        } catch (e) {
          console.warn('[CreativeDetails] Не удалось обновить аналитику после запуска теста:', e);
        }
      } else {
        toast.error('Не удалось запустить тест');
      }
    } catch (error) {
      console.error('Ошибка запуска теста:', error);
      toast.error('Ошибка при запуске теста креатива');
    } finally {
      setQuickTestLoading(false);
    }
  };

  const handleStopTest = async () => {
    if (demoMode) {
      toast.info('Демо-режим не поддерживается');
      return;
    }
    // Проверяем локальное состояние ИЛИ analytics
    if (!localTestRunning && !analytics?.test?.exists) return;

    setStopTestLoading(true);
    try {
      const storedUser = localStorage.getItem('user');
      if (!storedUser) {
        toast.error('Пользователь не авторизован');
        return;
      }

      const userData = JSON.parse(storedUser);
      const userId = userData.id;

      if (!userId) {
        toast.error('ID пользователя не найден');
        return;
      }

      // Формируем URL с параметрами (добавляем account_id для мультиаккаунтности)
      const params = new URLSearchParams({ user_id: userId });
      if (currentAdAccountId) {
        params.append('account_id', currentAdAccountId);
      }

      const response = await fetch(`${API_BASE_URL}/creative-test/${creativeId}?${params.toString()}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const errorMessage = data?.error || 'Не удалось остановить тест';
        toast.error(errorMessage);
        return;
      }

      toast.success('Тест остановлен');

      // Сбрасываем локальное состояние
      setLocalTestRunning(false);

      // Оптимистичное обновление analytics
      setAnalytics(prev => prev ? {
        ...prev,
        data_source: 'none',
        test: prev.test ? {
          ...prev.test,
          exists: false,
          status: 'cancelled'
        } : null
      } : null);

      // Пробуем обновить аналитику, но игнорируем ошибки
      try {
        const freshData = await fetchData(true);
        setTranscript(freshData.transcript);
        if (freshData.analytics) {
          setAnalytics(freshData.analytics);
        }
      } catch (e) {
        console.warn('[CreativeDetails] Не удалось обновить аналитику после остановки теста:', e);
      }
    } catch (error) {
      console.error('Ошибка остановки теста:', error);
      toast.error('Ошибка при остановке теста');
    } finally {
      setStopTestLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshLoading(true);
    setLoadError(null);
    try {
      console.log('[CreativeDetails] Ручное обновление данных...');

      const storedUser = localStorage.getItem('user');
      if (!storedUser) {
        toast.error('Пользователь не авторизован');
        return;
      }

      const userData = JSON.parse(storedUser);
      const userId = userData.id;

      if (!userId) {
        toast.error('ID пользователя не найден');
        return;
      }

      // Принудительное обновление с force=true для игнорирования кеша
      const updatedAnalytics = await getCreativeAnalytics(creativeId, userId, true);
      setAnalytics(updatedAnalytics);

      console.log('[CreativeDetails] Данные успешно обновлены');
      toast.success('Данные обновлены');
    } catch (error) {
      console.error('[CreativeDetails] Ошибка обновления данных:', error);
      toast.error('Не удалось обновить данные');
      setLoadError('Ошибка обновления данных');
    } finally {
      setRefreshLoading(false);
    }
  };

  // Ручная транскрибация видео
  const handleTranscribe = async () => {
    if (transcribing || mediaType !== 'video') return;

    setTranscribing(true);
    toast.info('Запускаем транскрибацию...', {
      description: 'Это может занять 1-2 минуты',
    });

    try {
      const result = await creativesService.reTranscribe(creativeId, 'ru');

      if (result.success && result.text) {
        setTranscript(result.text);
        toast.success('Транскрипция готова!');
      } else {
        toast.error('Не удалось транскрибировать', {
          description: result.error || 'Попробуйте позже',
        });
      }
    } catch (error) {
      console.error('Transcription error:', error);
      toast.error('Ошибка транскрибации', {
        description: 'Проверьте подключение и попробуйте снова',
      });
    } finally {
      setTranscribing(false);
    }
  };

  // Дубликаты useEffect удалены - основная логика загрузки выше

  if (loading) {
    return <div className="text-sm text-muted-foreground">Загрузка деталей...</div>;
  }

  // Определяем источник данных и метрики
  const dataSource = analytics?.data_source || 'none';
  // hasTest учитывает локальное состояние (для случаев когда analytics API недоступен)
  const hasTest = localTestRunning || analytics?.test?.exists || false;
  // testIsRunning - локальное состояние ИЛИ статус из analytics
  const testIsRunning = localTestRunning || analytics?.test?.status === 'running';
  const hasProduction = analytics?.production?.in_use || false;
  const metrics = analytics?.production?.metrics || analytics?.test?.metrics;
  const analysis = analytics?.analysis;

  const videoMetrics = metrics && metrics.video_views > 0 ? [
    {
      label: "25%",
      value: formatNumber(metrics.video_views_25_percent),
      percent: metrics.video_views > 0 ? ((metrics.video_views_25_percent / metrics.video_views) * 100).toFixed(1) : null,
    },
    {
      label: "50%",
      value: formatNumber(metrics.video_views_50_percent),
      percent: metrics.video_views > 0 ? ((metrics.video_views_50_percent / metrics.video_views) * 100).toFixed(1) : null,
    },
    {
      label: "75%",
      value: formatNumber(metrics.video_views_75_percent),
      percent: metrics.video_views > 0 ? ((metrics.video_views_75_percent / metrics.video_views) * 100).toFixed(1) : null,
    },
    {
      label: "95%",
      value: formatNumber(metrics.video_views_95_percent),
      percent: metrics.video_views > 0 ? ((metrics.video_views_95_percent / metrics.video_views) * 100).toFixed(1) : null,
    },
  ] : [];

  const metricCards = metrics ? [
    {
      label: "Показы",
      value: formatNumber(metrics.impressions),
      hint: metrics.reach ? `Охват: ${metrics.reach.toLocaleString()}` : null,
    },
    {
      label: "Охват",
      value: formatNumber(metrics.reach),
      hint: metrics.frequency ? `Частота ${metrics.frequency.toFixed(2)}` : null,
    },
    {
      label: "CTR",
      value: formatPercent(metrics.ctr),
      hint: metrics.link_ctr ? `Link CTR ${formatPercent(metrics.link_ctr)}` : null,
    },
    {
      label: "Клики",
      value: formatNumber(metrics.clicks || 0),
      hint: metrics.link_clicks ? `${metrics.link_clicks.toLocaleString()} по ссылке` : null,
    },
    {
      label: "Лиды",
      value: formatNumber(metrics.leads),
      hint: metrics.cpl_cents ? `CPL ${formatCurrency(metrics.cpl_cents)}` : null,
    },
    {
      label: "Потрачено",
      value: formatCurrency(metrics.spend_cents || null),
      hint: metrics.cpm_cents ? `CPM ${formatCurrency(metrics.cpm_cents)}` : null,
    },
  ] : [];

  const transcriptSuggestions = analysis && Array.isArray(analysis.transcript_suggestions)
    ? analysis.transcript_suggestions
    : [];

  // Использовать текст креатива как референс для генерации сценария
  const handleUseAsReference = () => {
    if (!transcript) {
      toast.error('Сначала дождитесь загрузки текста креатива');
      return;
    }
    const encodedText = encodeURIComponent(transcript);
    navigate(`/creatives?tab=video-scripts&textType=reference&prompt=${encodedText}`);
  };

  return (
    <div className="space-y-4">
      {/* Миниатюра для image креатива */}
      {mediaType === 'image' && imageUrl && (
        <Card className="bg-muted/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              🖼️ Превью креатива
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex justify-center">
              <img
                src={getThumbnailUrl(imageUrl, 300, 375) || imageUrl}
                alt="Превью креатива"
                className="max-w-full h-auto rounded-lg border max-h-[300px] object-contain"
                onError={(e) => {
                  // Fallback на оригинальный URL при ошибке
                  (e.target as HTMLImageElement).src = imageUrl;
                }}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Миниатюры для carousel креатива */}
      {mediaType === 'carousel' && carouselData && carouselData.length > 0 && (
        <Card className="bg-muted/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              🖼️ Карточки карусели ({carouselData.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {carouselData
                .sort((a, b) => a.order - b.order)
                .map((card, index) => {
                  const cardImageUrl = card.image_url_4k || card.image_url;
                  return (
                <div key={index} className="relative group">
                  {cardImageUrl ? (
                    <img
                      src={getThumbnailUrl(cardImageUrl, 150, 150) || cardImageUrl}
                      alt={`Карточка ${index + 1}`}
                      className="w-full aspect-square object-cover rounded-lg border"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = cardImageUrl;
                      }}
                    />
                  ) : (
                    <div className="w-full aspect-square bg-muted rounded-lg border flex items-center justify-center">
                      <Images className="h-6 w-6 text-muted-foreground" />
                    </div>
                  )}
                  <div className="absolute bottom-1 left-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
                    {index + 1}
                  </div>
                  {card.text && (
                    <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg p-2 flex items-center justify-center">
                      <span className="text-white text-xs text-center line-clamp-4">{card.text}</span>
                    </div>
                  )}
                </div>
                  );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Транскрибация для video или текст для других типов */}
      <Card className="bg-muted/30">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              {mediaType === 'video' ? '📝 Транскрибация видео' : '📝 Текст креатива'}
            </CardTitle>
            {/* Кнопка ручной транскрибации для видео */}
            {mediaType === 'video' && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1"
                onClick={handleTranscribe}
                disabled={transcribing}
              >
                {transcribing ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Транскрибация...
                  </>
                ) : (
                  <>
                    <Mic className="h-3 w-3" />
                    {transcript ? 'Перетранскрибировать' : 'Транскрибировать'}
                  </>
                )}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-sm whitespace-pre-wrap text-muted-foreground">
            {transcript ? transcript : (
              mediaType === 'video'
                ? 'Транскрибация еще не готова. Нажмите кнопку "Транскрибировать" выше.'
                : 'Текст недоступен'
            )}
          </div>
        </CardContent>
      </Card>

      <div className="pt-2 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            className="gap-2 w-full sm:w-auto"
            onClick={handleQuickTest}
            disabled={quickTestLoading || (hasTest && testIsRunning)}
          >
            {quickTestLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Запуск...
              </>
            ) : (hasTest && testIsRunning) ? (
              <>
                <TrendingUp className="h-4 w-4" />
                Тест запущен
              </>
            ) : (
              <>
              <Sparkles className="h-4 w-4" />
              Быстрый тест
              </>
            )}
          </Button>
          <HelpTooltip tooltipKey={TooltipKeys.TEST_CAMPAIGN_WHAT} iconSize="sm" />
        </div>
        {hasTest && (
          <Button
            size="sm"
            variant={testIsRunning ? 'destructive' : 'outline'}
            className="w-full sm:w-auto"
            onClick={handleStopTest}
            disabled={stopTestLoading}
          >
            {stopTestLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Остановка...
              </>
            ) : testIsRunning ? (
              'Остановить тест'
            ) : (
              'Сбросить тест'
            )}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          className="w-full sm:w-auto gap-2"
          onClick={handleRefresh}
          disabled={refreshLoading}
        >
          {refreshLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Обновление...
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4" />
              Обновить
            </>
          )}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="w-full sm:w-auto gap-2"
          onClick={handleUseAsReference}
          disabled={!transcript}
          title={!transcript ? 'Дождитесь загрузки текста' : 'Переписать сценарий на основе этого текста'}
        >
          <Pencil className="h-4 w-4" />
          Переписать сценарий
        </Button>
      </div>

      {loadError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {loadError}
        </div>
      )}

      {/* Индикатор источника данных */}
      {dataSource !== 'none' && (
        <div className="flex items-center gap-2">
          <Badge className={hasProduction ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200" : "bg-blue-100 text-blue-700 dark:bg-gray-800/40 dark:text-gray-300"}>
            {hasProduction ? '⚡ Production' : '🧪 Тест'}
          </Badge>
          {analytics?.from_cache && (
            <span className="text-xs text-muted-foreground">
              ℹ️ Из кеша
            </span>
          )}
        </div>
      )}

      {/* Отображение метрик и анализа */}
      {dataSource !== 'none' && metrics ? (
        <div className="space-y-4">
          {/* Сетка метрик */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {metricCards.map((metric) => (
              <div key={metric.label} className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">{metric.label}</div>
                <div className="text-lg font-semibold">{metric.value}</div>
                {metric.hint && <div className="text-xs text-muted-foreground mt-1">{metric.hint}</div>}
              </div>
            ))}
          </div>

          {/* Видео retention */}
          {metrics.video_views > 0 && (
          <div className="space-y-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                <div className="text-sm font-medium">Досмотры видео</div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {videoMetrics.map((point) => (
                  <div key={point.label} className="rounded-lg border p-3 space-y-1">
                    <div className="text-xs text-muted-foreground">{point.label}</div>
                    <div className="text-lg font-semibold">{point.value}</div>
                    {point.percent && <div className="text-xs text-muted-foreground">{point.percent}% от просмотров</div>}
                  </div>
                ))}
              </div>
              <div className="text-xs text-muted-foreground">
                Среднее время просмотра: {formatSeconds(metrics.video_avg_watch_time_sec)} · Всего просмотров: {metrics.video_views.toLocaleString()}
              </div>
            </div>
          )}

          {/* LLM анализ */}
          {analysis && analysis.score !== null && (
            <Card className="border-primary/30 bg-primary/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${verdictMeta[analysis.verdict].className}`}>
                    {verdictMeta[analysis.verdict].emoji} {verdictMeta[analysis.verdict].label}
                  </span>
                  <HelpTooltip tooltipKey={TooltipKeys.CREATIVE_LLM_VERDICT} iconSize="sm" />
                  <span className="text-muted-foreground">Оценка: {analysis.score}/100</span>
                  <HelpTooltip tooltipKey={TooltipKeys.CREATIVE_LLM_SCORE} iconSize="sm" />
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                {analysis.reasoning && <div>{analysis.reasoning}</div>}
                {analysis.video_analysis && (
                  <div>
                    <span className="font-medium text-foreground">Видео:</span> {analysis.video_analysis}
                  </div>
                )}
                {analysis.text_recommendations && (
                  <div>
                    <span className="font-medium text-foreground">Текст:</span> {analysis.text_recommendations}
                  </div>
                )}
                {analysis.transcript_match_quality && (
                  <div>
                    <span className="font-medium text-foreground">Соответствие транскрипта:</span> {analysis.transcript_match_quality}
                  </div>
                )}
                {transcriptSuggestions.length > 0 && (
                  <div className="space-y-2">
                    <div className="font-medium text-foreground">Предложения по тексту</div>
                    <div className="space-y-2">
                      {transcriptSuggestions.map((suggestion, index) => (
                        <div key={`${suggestion.from}-${index}`} className="rounded-md border p-2">
                          <div className="text-xs text-muted-foreground">Исходный текст</div>
                          <div className="text-sm font-medium">"{suggestion.from}"</div>
                          <div className="text-xs text-muted-foreground mt-2">Новый текст</div>
                          <div className="text-sm font-medium text-foreground">"{suggestion.to}"</div>
                          <div className="text-xs text-muted-foreground mt-2">Почему: {suggestion.reason}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {analysis.note && (
                  <div className="text-xs text-muted-foreground italic mt-2">
                    {analysis.note}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          {loadError ? 'Статистика временно недоступна' : 'Нет данных. Запустите быстрый тест, чтобы увидеть статистику.'}
          </div>
      )}

      {/* Модальное окно с результатом запуска теста */}
      <Dialog open={testResultDialogOpen} onOpenChange={setTestResultDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Тест запущен!</DialogTitle>
            <DialogDescription>
              {testLaunchResult?.message || 'Тест креатива успешно запущен'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {testLaunchResult && (
              <>
                {/* Информация о кампании */}
                <div className="space-y-2">
                  <div className="text-sm">
                    <span className="text-muted-foreground">Objective:</span>{' '}
                    <span className="font-medium">{OBJECTIVE_LABELS[testLaunchResult.objective as keyof typeof OBJECTIVE_LABELS] || testLaunchResult.objective}</span>
                  </div>
                  <div className="text-sm">
                    <span className="text-muted-foreground">Campaign ID:</span>{' '}
                    <span className="font-mono text-xs">{testLaunchResult.campaign_id}</span>
                  </div>
                </div>

                {/* Информация об Ad Set и Ad */}
                <div className="p-4 bg-muted/30 rounded-lg space-y-2">
                  <div className="text-sm font-medium">Ad Set</div>
                  <div className="text-xs text-muted-foreground font-mono">
                    ID: {testLaunchResult.adset_id}
                  </div>
                  <div className="text-sm pt-2 border-t border-border/50">
                    <span className="text-muted-foreground">Дневной бюджет:</span>{' '}
                    <span className="font-medium">$20</span>
                  </div>
                  <div className="text-sm">
                    <span className="text-muted-foreground">Цель:</span>{' '}
                    <span className="font-medium">1000 показов</span>
                  </div>
                </div>

                {/* Ad ID */}
                <div className="space-y-2">
                  <div className="text-sm font-medium">Объявление</div>
                  <div className="p-3 border rounded-lg text-sm">
                    <div className="text-xs text-muted-foreground font-mono">
                      Ad ID: {testLaunchResult.ad_id}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button
              variant="outline"
              onClick={() => {
                setTestResultDialogOpen(false);
                setTestLaunchResult(null);
              }}
            >
              Закрыть
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
};

const Creatives: React.FC = () => {
  const navigate = useNavigate();
  const { currentAdAccountId, platform, setPlatform } = useAppContext();
  // Передаём currentAdAccountId для фильтрации креативов по выбранному рекламному аккаунту
  const { items, loading, reload, testStatuses } = useUserCreatives(currentAdAccountId, platform);

  const [queue, setQueue] = useState<UploadItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const processingRef = useRef(false);
  const [selectedDirectionId, setSelectedDirectionId] = useState<string>('');
  const [mediaTypeFilter, setMediaTypeFilter] = useState<'all' | 'video' | 'image' | 'carousel'>('all');
  const [selectedCreativeIds, setSelectedCreativeIds] = useState<Set<string>>(new Set());
  const [isLaunching, setIsLaunching] = useState(false);
  const [isAnalysisModalOpen, setIsAnalysisModalOpen] = useState(false);

  // Состояния для Manual Launch модалки
  const [manualLaunchDialogOpen, setManualLaunchDialogOpen] = useState(false);
  const [manualLaunchBudget, setManualLaunchBudget] = useState<number>(
    platform === 'tiktok' ? TIKTOK_MIN_DAILY_BUDGET : FACEBOOK_MIN_DAILY_BUDGET
  );
  const [manualStartMode, setManualStartMode] = useState<'now' | 'midnight_almaty'>('now');
  const [launchResult, setLaunchResult] = useState<ManualLaunchResponse | null>(null);
  const [resultDialogOpen, setResultDialogOpen] = useState(false);
  const [launchedBudget, setLaunchedBudget] = useState<number>(
    platform === 'tiktok' ? TIKTOK_MIN_DAILY_BUDGET : FACEBOOK_MIN_DAILY_BUDGET
  );
  const [launchDirectionId, setLaunchDirectionId] = useState<string>('');
  const isTikTokPlatform = platform === 'tiktok';
  const manualLaunchMinBudget = isTikTokPlatform ? TIKTOK_MIN_DAILY_BUDGET : FACEBOOK_MIN_DAILY_BUDGET;
  const manualLaunchBudgetSymbol = isTikTokPlatform ? '₸' : '$';
  const manualLaunchBudgetLabel = isTikTokPlatform ? 'KZT' : 'USD';
  const manualLaunchMinBudgetText = isTikTokPlatform
    ? `${manualLaunchMinBudget}₸`
    : `${manualLaunchBudgetSymbol}${manualLaunchMinBudget}`;
  const adGroupId =
    launchResult?.adset_id || launchResult?.adgroup_id || launchResult?.tiktok_adgroup_id;
  const adGroupTitle = isTikTokPlatform ? 'Ad Group' : 'Ad Set';
  const launchedBudgetLabel = isTikTokPlatform
    ? `${launchedBudget.toLocaleString('ru-RU')} ₸`
    : `${manualLaunchBudgetSymbol}${launchedBudget}`;

  // Фильтрация креативов по типу медиа
  const filteredItems = useMemo(() => {
    if (mediaTypeFilter === 'all') return items;
    return items.filter(item => item.media_type === mediaTypeFilter);
  }, [items, mediaTypeFilter]);

  useEffect(() => {
    setManualLaunchBudget(manualLaunchMinBudget);
    setLaunchedBudget(manualLaunchMinBudget);
  }, [manualLaunchMinBudget]);

  // Обработчик обновления названия креатива
  const handleTitleUpdate = async (id: string, newTitle: string) => {
    const success = await creativesApi.update(id, { title: newTitle });
    if (success) {
      await reload();
      toast.success('Название обновлено');
    } else {
      toast.error('Не удалось обновить название');
    }
  };

  // Переключение выбора креатива
  const toggleCreativeSelection = (id: string) => {
    setSelectedCreativeIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  // Выбрать/снять все креативы
  const toggleSelectAll = () => {
    if (selectedCreativeIds.size === filteredItems.length) {
      setSelectedCreativeIds(new Set());
    } else {
      setSelectedCreativeIds(new Set(filteredItems.map(it => it.id)));
    }
  };

  // Удалить выбранные креативы
  const handleDeleteSelected = async () => {
    if (selectedCreativeIds.size === 0) return;
    if (!confirm(`Удалить выбранные креативы (${selectedCreativeIds.size} шт.)?`)) return;

    try {
      const deletePromises = Array.from(selectedCreativeIds).map(id => creativesApi.delete(id));
      await Promise.all(deletePromises);
      setSelectedCreativeIds(new Set());
      await reload();
      toast.success(`Удалено ${selectedCreativeIds.size} креативов`);
    } catch (error) {
      console.error('Ошибка при удалении креативов:', error);
      toast.error('Не удалось удалить креативы');
    }
  };

  // Открыть модалку анализа топ креативов
  const handleImportTopCreatives = () => {
    if (!currentAdAccountId) {
      toast.error('Выберите рекламный аккаунт');
      return;
    }
    setIsAnalysisModalOpen(true);
  };

  // Открыть модалку для запуска с выбранными креативами
  const handleCreateAdset = () => {
    if (selectedCreativeIds.size === 0) {
      toast.error('Выберите хотя бы один креатив');
      return;
    }

    // Получаем направление из первого выбранного креатива
    const firstSelectedId = Array.from(selectedCreativeIds)[0];
    const firstCreative = items.find(it => it.id === firstSelectedId);

    if (!firstCreative?.direction_id) {
      toast.error('Выберите креатив с назначенным направлением');
      return;
    }

    // Проверяем, что все выбранные креативы из одного направления
    const selectedItems = items.filter(it => selectedCreativeIds.has(it.id));
    const differentDirections = selectedItems.some(it => it.direction_id !== firstCreative.direction_id);
    if (differentDirections) {
      toast.error('Все выбранные креативы должны быть из одного направления');
      return;
    }

    // Сохраняем направление и открываем модалку
    setLaunchDirectionId(firstCreative.direction_id);
    setManualLaunchDialogOpen(true);
  };

  // Фактический запуск рекламы
  const handleManualLaunch = async () => {
    if (selectedCreativeIds.size === 0) {
      toast.error('Выберите хотя бы один креатив');
      return;
    }

    if (!launchDirectionId) {
      toast.error('Не выбрано направление');
      return;
    }

    if (manualLaunchBudget < manualLaunchMinBudget) {
      toast.error(`Минимальный бюджет - ${manualLaunchMinBudgetText}`);
      return;
    }

    setIsLaunching(true);
    try {
      // Получаем user_account_id из направления
      const direction = directions.find(d => d.id === launchDirectionId);
      if (!direction?.user_account_id) {
        toast.error('Направление не связано с рекламным аккаунтом');
        return;
      }

      // Сохраняем бюджет для показа в результате
      setLaunchedBudget(manualLaunchBudget);

      const result = await manualLaunchAds({
        platform: isTikTokPlatform ? 'tiktok' : 'facebook',
        user_account_id: direction.user_account_id,
        account_id: currentAdAccountId || undefined,
        direction_id: launchDirectionId,
        creative_ids: Array.from(selectedCreativeIds),
        ...(isTikTokPlatform
          ? {
              daily_budget: manualLaunchBudget,
              objective: direction.tiktok_objective || undefined,
            }
          : {
              start_mode: manualStartMode,
              daily_budget_cents: Math.round(manualLaunchBudget * 100),
            }),
      });

      if (result.success) {
        setLaunchResult(result);
        setManualLaunchDialogOpen(false);
        setResultDialogOpen(true);
        toast.success(result.message || 'Реклама успешно запущена!');

        // Сброс
        setSelectedCreativeIds(new Set());
        setManualLaunchBudget(manualLaunchMinBudget);
        setManualStartMode('now');
      } else {
        toast.error(result.error || 'Ошибка создания adset');
      }
    } catch (error: any) {
      console.error('Ошибка создания adset:', error);
      toast.error(error.message || 'Не удалось создать adset');
    } finally {
      setIsLaunching(false);
    }
  };

  // Получаем user_id для загрузки направлений (один раз)
  const [userId] = useState<string | null>(() => {
    try {
      const stored = localStorage.getItem('user');
      return stored ? JSON.parse(stored).id : null;
    } catch {
      return null;
    }
  });
  
  // Загрузка списка направлений (с фильтрацией по currentAdAccountId для мультиаккаунтности)
  // Показываем ВСЕ направления (и Facebook, и TikTok)
  const { directions, loading: directionsLoading } = useDirections(userId, currentAdAccountId);
  const launchDirection = useMemo(
    () => directions.find(d => d.id === launchDirectionId),
    [directions, launchDirectionId]
  );

  // Сбрасываем выбранное направление при смене аккаунта
  useEffect(() => {
    setSelectedDirectionId('');
  }, [currentAdAccountId]);

  // Автоматически выбираем первое направление если ничего не выбрано
  useEffect(() => {
    if (!directionsLoading && directions.length > 0 && !selectedDirectionId) {
      setSelectedDirectionId(directions[0].id);
    }
  }, [directions, directionsLoading, selectedDirectionId]);

  const overallProgress = useMemo(() => {
    const active = queue.filter(q => q.status === "uploading" || q.status === "queued");
    if (active.length === 0) return 0;
    const sum = active.reduce((acc, it) => acc + it.progress, 0);
    return Math.round(sum / active.length);
  }, [queue]);

  const handleFilesSelected = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;

    const maxSizeBytes = 10 * 1024 * 1024; // 10MB для изображений
    const fileArray = Array.from(files);
    const allowed = fileArray.filter((f) => {
      if (f.type.startsWith('image/')) return f.size <= maxSizeBytes; // изображения ограничиваем 10MB
      if (f.type.startsWith('video/')) return true;
      return false;
    });
    const rejectedCount = fileArray.length - allowed.length;
    if (rejectedCount > 0) {
      toast.error(`Отклонено ${rejectedCount} файлов (только видео или JPG/PNG/WebP до 10MB)`);
    }
    if (allowed.length === 0) return;
    const added: UploadItem[] = allowed.map((file) => ({
      id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
      file,
      name: file.name,
      status: 'queued',
      progress: 0,
    }));
    setQueue(prev => [...prev, ...added]);
  }, []);

  const clearCompleted = useCallback(() => {
    setQueue(prev => prev.filter(i => i.status === "queued" || i.status === "uploading"));
  }, []);

  // Повторная загрузка неудачного элемента
  const retryItem = useCallback((itemId: string) => {
    console.log(`retryItem: Повторная загрузка элемента ${itemId}`);
    setQueue(prev => prev.map(item =>
      item.id === itemId
        ? { ...item, status: "queued" as const, progress: 0, error: undefined }
        : item
    ));
  }, []);

  // Повторная загрузка всех неудачных элементов
  const retryAllFailed = useCallback(() => {
    console.log('retryAllFailed: Повторная загрузка всех неудачных элементов');
    setQueue(prev => prev.map(item =>
      item.status === "error"
        ? { ...item, status: "queued" as const, progress: 0, error: undefined }
        : item
    ));
  }, []);

  const processNext = useCallback(async (): Promise<boolean> => {
    return new Promise((resolve) => {
      setQueue(prev => {
        console.log('processNext: Текущая очередь:', prev.map(i => `${i.name} (${i.status})`).join(', '));
        
        const nextIndex = prev.findIndex(i => i.status === "queued");
        if (nextIndex === -1) {
          console.log('processNext: Нет файлов в очереди со статусом "queued"');
          resolve(false);
          return prev;
        }

        const item = prev[nextIndex];
        console.log(`processNext: ✅ Начинаем загрузку файла "${item.name}", ID: ${item.id}, статус: ${item.status}`);
        
        // Асинхронная загрузка
        (async () => {
          try {
            // НЕ создаем placeholder - пусть webhook сам создаст запись
            console.log(`processNext: Загружаем на webhook для "${item.name}" (без placeholder)`);
            console.log('[processNext] selectedDirectionId:', selectedDirectionId);
            console.log('[processNext] Передаем directionId:', selectedDirectionId || null);
      const ok = await creativesApi.uploadToWebhook(
        item.file,
        item.name,
              null, // Не передаем record_id
        {},
        (pct) => {
                setQueue(prev2 => prev2.map((it) => it.id === item.id ? { ...it, progress: pct } : it));
        },
        undefined, // description
        selectedDirectionId || null, // directionId
        currentAdAccountId || null // adAccountId (UUID из ad_accounts)
      );

      if (!ok) {
              console.log(`processNext: ❌ Ошибка загрузки для "${item.name}"`);
              setQueue(prev2 => prev2.map((it) => it.id === item.id ? { ...it, status: "error", error: "Ошибка загрузки" } : it));
        toast.error(`Не удалось загрузить: ${item.name}`);
      } else {
              console.log(`processNext: ✅ Успешно загружено "${item.name}"`);
              setQueue(prev2 => prev2.map((it) => it.id === item.id ? { ...it, status: "success", progress: 100, recordId: null } : it));
        toast.success(`Загружено: ${item.name}`);
        // Обновляем список креативов после успешной загрузки
        reload();
      }
    } catch (e) {
            console.error(`processNext: ❌ Исключение при загрузке "${item.name}"`, e);
            setQueue(prev2 => prev2.map((it) => it.id === item.id ? { ...it, status: "error", error: "Исключение при загрузке" } : it));
      toast.error(`Ошибка при загрузке: ${item.name}`);
          } finally {
            console.log(`processNext: Завершена обработка "${item.name}"`);
            resolve(true);
          }
        })();
        
        // Сразу помечаем как uploading
        console.log(`processNext: Меняем статус "${item.name}" с "queued" на "uploading"`);
        return prev.map((it, idx) => idx === nextIndex ? { ...it, status: "uploading", progress: 0 } : it);
      });
    });
  }, [selectedDirectionId, currentAdAccountId, reload]);

  const startProcessing = useCallback(async () => {
    if (processingRef.current) {
      console.log('startProcessing: Уже выполняется (ref), выход');
      return;
    }
    
    console.log('startProcessing: Начинаем обработку очереди');
    processingRef.current = true;
    setIsProcessing(true);
    
    try {
      let continueProcessing = true;
      let processedCount = 0;
      
      while (continueProcessing && processingRef.current) {
        const progressed = await processNext();
        if (progressed) {
          processedCount++;
          console.log(`startProcessing: Обработано файлов: ${processedCount}`);
        } else {
          continueProcessing = false;
          console.log('startProcessing: Больше нет файлов для обработки');
        }
      }
      
      if (processedCount > 0) {
        toast.success(`Все файлы загружены! (${processedCount} шт.)`);
      } else {
        toast.info('Нет файлов для загрузки');
      }
    } catch (error) {
      console.error('startProcessing: Критическая ошибка', error);
      toast.error('Ошибка при обработке очереди');
    } finally {
      console.log('startProcessing: Завершение обработки');
      processingRef.current = false;
      setIsProcessing(false);
    }
  }, [processNext]);

  const stopProcessing = useCallback(() => {
    console.log('stopProcessing: Остановка обработки');
    processingRef.current = false;
    setIsProcessing(false);
    // Помечаем все "queued" как отмененные, оставляя только uploading
    setQueue(prev => prev.map(item => 
      item.status === "queued" ? { ...item, status: "error" } : item
    ));
  }, []);

  // Убрали автозапуск - теперь загрузка только по кнопке "Начать"

  return (
    <div className="w-full max-w-full overflow-x-hidden">
      <Header onOpenDatePicker={() => {}} />
      <div className="container mx-auto px-4 py-6 pt-[76px] max-w-full" data-tour="videos-content">
        <PageHero
          title="Видео"
          subtitle="Загружайте и управляйте вашими видео креативами"
          tooltipKey={TooltipKeys.CREATIVES_PAGE_OVERVIEW}
        />

        {/* Селектор платформы */}
        {(() => {
          const TikTokIcon = () => (
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/>
            </svg>
          );
          return (
            <div className="flex items-center gap-3 mb-6">
              <span className="text-sm font-medium text-muted-foreground">Платформа:</span>
              <Tabs
                value={platform}
                onValueChange={(value) => setPlatform(value as 'instagram' | 'tiktok')}
              >
                <TabsList className="h-auto bg-transparent p-0 gap-2">
                  <TabsTrigger
                    value="instagram"
                    className={cn(
                      "gap-2 transition-all duration-200",
                      "data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-500 data-[state=active]:to-pink-500 data-[state=active]:hover:from-purple-600 data-[state=active]:hover:to-pink-600 data-[state=active]:text-white data-[state=active]:border-0 data-[state=active]:shadow-md data-[state=active]:dark:from-transparent data-[state=active]:dark:to-transparent data-[state=active]:dark:bg-accent data-[state=active]:dark:border-2 data-[state=active]:dark:border-foreground",
                      "data-[state=inactive]:border data-[state=inactive]:border-purple-200 data-[state=inactive]:text-purple-600 data-[state=inactive]:hover:bg-purple-50 data-[state=inactive]:hover:border-purple-300 data-[state=inactive]:dark:border data-[state=inactive]:dark:text-foreground data-[state=inactive]:dark:hover:bg-accent"
                    )}
                  >
                    <Instagram className="h-4 w-4" />
                    Instagram
                  </TabsTrigger>
                  {FEATURES.SHOW_TIKTOK && (
                    <TabsTrigger
                      value="tiktok"
                      className={cn(
                        "gap-2 transition-all duration-200",
                        "data-[state=active]:bg-gradient-to-r data-[state=active]:from-black data-[state=active]:to-gray-900 data-[state=active]:hover:from-gray-900 data-[state=active]:hover:to-black data-[state=active]:text-white data-[state=active]:border-0 data-[state=active]:shadow-md data-[state=active]:dark:from-transparent data-[state=active]:dark:to-transparent data-[state=active]:dark:bg-accent data-[state=active]:dark:border-2 data-[state=active]:dark:border-foreground",
                        "data-[state=inactive]:border data-[state=inactive]:border-gray-300 data-[state=inactive]:text-gray-700 data-[state=inactive]:hover:bg-gray-50 data-[state=inactive]:hover:border-gray-400 data-[state=inactive]:dark:border data-[state=inactive]:dark:text-foreground data-[state=inactive]:dark:hover:bg-accent"
                      )}
                    >
                      <TikTokIcon />
                      TikTok
                    </TabsTrigger>
                  )}
                </TabsList>
              </Tabs>
            </div>
          );
        })()}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Очередь загрузок
                <HelpTooltip tooltipKey={TooltipKeys.UPLOAD_DROPZONE} iconSize="sm" />
              </CardTitle>
              <CardDescription>Добавляйте видео — загрузим по очереди</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <input
                ref={inputRef}
                id="queue-file-input"
                type="file"
                accept="video/*,image/*"
                multiple
                className="hidden"
                onChange={(e) => handleFilesSelected(e.currentTarget.files)}
                disabled={isProcessing}
              />

              {/* Выбор направления */}
              {directions.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-1">
                    <label className="text-sm font-medium">Направление бизнеса</label>
                    <HelpTooltip tooltipKey={TooltipKeys.UPLOAD_SELECT_DIRECTION} iconSize="sm" />
                  </div>
                  <Select
                    value={selectedDirectionId}
                    onValueChange={setSelectedDirectionId}
                    disabled={isProcessing || directionsLoading}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Выберите направление" />
                    </SelectTrigger>
                    <SelectContent>
                      {directions.map((direction) => (
                        <SelectItem key={direction.id} value={direction.id}>
                          <span className="flex items-center gap-2">
                            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                              direction.platform === 'tiktok'
                                ? 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400'
                                : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                            }`}>
                              {direction.platform === 'tiktok' ? 'TT' : 'FB'}
                            </span>
                            {direction.name} ({getDirectionObjectiveLabel(direction)})
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Все загружаемые креативы будут привязаны к этому направлению
                  </p>
                </div>
              ) : !directionsLoading && (
                <div className="space-y-2 p-4 border border-dashed rounded-lg bg-muted/20">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                    <Target className="h-4 w-4" />
                    <span className="font-medium">Направление не создано</span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">
                    Для загрузки креативов необходимо создать направление бизнеса
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate('/profile')}
                    className="w-full"
                  >
                    <Target className="mr-2 h-4 w-4" />
                    Создать направление
                  </Button>
                </div>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="outline"
                  onClick={() => inputRef.current?.click()}
                  disabled={isProcessing || directions.length === 0 || !selectedDirectionId}
                  className="flex-1 min-w-[140px]"
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Добавить файл
                </Button>
                {!isProcessing ? (
                  <Button variant="default" onClick={startProcessing} disabled={!queue.some(i => i.status === "queued") || !selectedDirectionId}>
                  <PlayCircle className="mr-2 h-4 w-4" />
                  Начать
                </Button>
                ) : (
                  <Button variant="destructive" onClick={stopProcessing}>
                    <XCircle className="mr-2 h-4 w-4" />
                    Остановить
                  </Button>
                )}
                {queue.some(i => i.status === "error") && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      retryAllFailed();
                      if (!processingRef.current) {
                        startProcessing();
                      }
                    }}
                    disabled={isProcessing}
                    title="Повторить все неудачные загрузки"
                  >
                    <RefreshCw className="mr-1 h-4 w-4" />
                    Повторить всё
                  </Button>
                )}
                <Button variant="ghost" onClick={clearCompleted} disabled={isProcessing} className="shrink-0">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              {(isProcessing || queue.length > 0) && (
                <div className="space-y-2">
                  <div className="text-sm text-muted-foreground">Общий прогресс: {overallProgress}%</div>
                  <Progress value={overallProgress} />
                </div>
              )}

              <div className="space-y-2 max-h-[320px] overflow-auto">
                {queue.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Очередь пуста</div>
                ) : (
                  queue.map(item => (
                    <div key={item.id} className="flex items-center justify-between gap-3 p-3 border rounded-lg">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate" title={item.name}>{item.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.status === "queued" && "В очереди"}
                          {item.status === "uploading" && `Загрузка: ${item.progress}%`}
                          {item.status === "success" && "Готово"}
                          {item.status === "error" && (item.error || "Ошибка")}
                        </div>
                        {(item.status === "uploading" || item.status === "queued") && (
                          <div className="mt-1">
                            <Progress value={item.progress} />
                          </div>
                        )}
                      </div>
                      {item.status === "success" ? (
                        <CheckCircle2 className="text-green-600 h-5 w-5 flex-shrink-0" />
                      ) : item.status === "error" ? (
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => {
                              retryItem(item.id);
                              // Запускаем обработку, если она не идёт
                              if (!processingRef.current) {
                                startProcessing();
                              }
                            }}
                            title="Повторить загрузку"
                          >
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                          <XCircle className="text-red-600 h-5 w-5" />
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Загруженные креативы</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between mb-3 gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="text-sm text-muted-foreground whitespace-nowrap">
                    {items.length}{mediaTypeFilter !== 'all' && ` / ${filteredItems.length}`}
                  </div>
                  {/* Фильтр по типу */}
                  <Select value={mediaTypeFilter} onValueChange={(v) => setMediaTypeFilter(v as typeof mediaTypeFilter)}>
                    <SelectTrigger className="w-[110px] h-7 text-xs">
                      <SelectValue placeholder="Тип" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Все типы</SelectItem>
                      <SelectItem value="video">
                        <span className="flex items-center gap-2">
                          <Video className="h-3 w-3" />
                          Видео
                        </span>
                      </SelectItem>
                      <SelectItem value="image">
                        <span className="flex items-center gap-2">
                          <Image className="h-3 w-3" />
                          Картинки
                        </span>
                      </SelectItem>
                      <SelectItem value="carousel">
                        <span className="flex items-center gap-2">
                          <Images className="h-3 w-3" />
                          Карусели
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-1">
                  {/* Кнопка создать adset */}
                  {selectedCreativeIds.size > 0 && (
                    <Button
                      size="sm"
                      variant="default"
                      onClick={handleCreateAdset}
                      disabled={isLaunching}
                      className="h-7 px-2 text-xs gap-1"
                    >
                      {isLaunching ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Megaphone className="h-3.5 w-3.5" />
                      )}
                      <span className="hidden sm:inline">Запустить</span>
                      <span className="sm:hidden">{selectedCreativeIds.size}</span>
                    </Button>
                  )}
                  {/* Кнопка удалить выбранные */}
                  {selectedCreativeIds.size > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleDeleteSelected}
                      disabled={loading}
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                      title={`Удалить выбранные (${selectedCreativeIds.size})`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {/* Кнопка импорта лучших креативов (только для Facebook) */}
                  {platform !== 'tiktok' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleImportTopCreatives}
                      disabled={!currentAdAccountId}
                      className="h-7 px-2 text-xs gap-1"
                      title="Анализировать и импортировать топ-5 креативов по CPL из Facebook"
                    >
                      <Zap className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Импорт лучших</span>
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={reload} disabled={loading} className="h-7 w-7 p-0">
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              {loading || directionsLoading ? (
                <div className="text-sm text-muted-foreground">Загрузка...</div>
              ) : items.length === 0 ? (
                <div className="text-sm text-muted-foreground">Пока нет креативов</div>
              ) : filteredItems.length === 0 ? (
                <div className="text-sm text-muted-foreground">Нет креативов выбранного типа</div>
              ) : (
                <Accordion type="single" collapsible className="w-full">
                  {filteredItems.map((it, index) => {
                    const currentDirection = it.direction_id 
                      ? directions.find(d => d.id === it.direction_id)
                      : null;
                    
                    const handleDirectionChange = async (directionId: string | null) => {
                      const success = await creativesApi.update(it.id, { 
                        direction_id: directionId 
                      } as Partial<UserCreative>);
                      
                      if (success) {
                        await reload();
                        toast.success(
                          directionId 
                            ? 'Направление обновлено' 
                            : 'Направление удалено'
                        );
                      } else {
                        toast.error('Не удалось обновить направление');
                      }
                    };
                    
                    return (
                    <AccordionItem key={it.id} value={it.id}>
                      <div className="flex items-center justify-between w-full py-2 gap-4">
                        {/* Checkbox в начале строки */}
                        <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedCreativeIds.has(it.id)}
                            onCheckedChange={() => toggleCreativeSelection(it.id)}
                            className="h-5 w-5"
                          />
                        </div>
                        {/* Миниатюра креатива 40x40 */}
                        <div className="shrink-0 w-10 h-10 rounded overflow-hidden bg-muted flex items-center justify-center">
                          {(() => {
                            // Для видео - thumbnail_url, для картинки - image_url, для карусели - первая картинка
                            const previewUrl = it.media_type === 'video'
                              ? it.thumbnail_url
                              : it.media_type === 'carousel' && it.carousel_data?.[0]
                                ? (it.carousel_data[0].image_url || it.carousel_data[0].image_url_4k)
                                : it.image_url;

                            if (previewUrl) {
                              return (
                                <img
                                  src={getThumbnailUrl(previewUrl, 80, 80) || previewUrl}
                                  alt=""
                                  className="w-full h-full object-cover"
                                  loading="lazy"
                                />
                              );
                            }

                            // Fallback - иконка типа медиа
                            const Icon = it.media_type === 'video' ? Video : it.media_type === 'carousel' ? Images : Image;
                            return <Icon className="w-5 h-5 text-muted-foreground" />;
                          })()}
                        </div>
                        <div className="min-w-0 flex-1 flex items-center gap-2">
                          <AccordionTrigger className="hover:no-underline min-w-0">
                            <EditableTitle
                              title={it.title}
                              creativeId={it.id}
                              onSave={handleTitleUpdate}
                            />
                          </AccordionTrigger>

                          {/* Badge типа медиа */}
                          <div className="flex-shrink-0 hidden sm:block">
                            <MediaTypeBadge mediaType={it.media_type} showLabel={false} />
                          </div>

                          {/* Badge "Импортирован" для креативов из анализа */}
                          {it.source === 'imported_analysis' && (
                            <div className="flex-shrink-0 hidden sm:flex items-center gap-1">
                              <Badge
                                className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200"
                                title={it.imported_cpl_cents ? `CPL: $${(it.imported_cpl_cents / 100).toFixed(2)}, ${it.imported_leads || 0} лидов` : 'Импортирован из Facebook'}
                              >
                                <Zap className="h-3 w-3 mr-1" />
                                Топ
                                {it.imported_cpl_cents && (
                                  <span className="ml-1 opacity-80">
                                    ${(it.imported_cpl_cents / 100).toFixed(2)}
                                  </span>
                                )}
                              </Badge>
                            </div>
                          )}

                          {/* Индикатор статуса теста */}
                          <div className="flex-shrink-0">
                            <TestStatusIndicator
                              status={testStatuses[it.id]?.status}
                              impressions={testStatuses[it.id]?.impressions}
                              limit={1000}
                            />
                          </div>

                          {/* Badge с направлением */}
                          <div className="flex-shrink-0">
                            <DirectionBadge
                              creative={it}
                              currentDirection={currentDirection}
                              directions={directions}
                              onDirectionChange={handleDirectionChange}
                            />
                          </div>
                        </div>
                        <div className="shrink-0 text-xs text-muted-foreground whitespace-nowrap hidden sm:block">
                          {formatDateAlmaty(it.created_at)}
                        </div>
                        <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                          <span
                            className={`inline-block w-2.5 h-2.5 rounded-full transition-all ${
                              it.is_active
                                ? 'bg-gradient-to-br from-green-400 to-emerald-500 dark:from-green-500/70 dark:to-emerald-500/70 shadow-sm'
                                : 'bg-gray-300 dark:bg-gray-600'
                            }`}
                            title={it.is_active ? 'Активен' : 'Неактивен'}
                          />
                          <Switch
                            checked={it.is_active ?? true}
                            onCheckedChange={async (checked) => {
                              await creativesApi.toggleActive(it.id, checked);
                              await reload();
                              toast.success(checked ? 'Креатив активирован' : 'Креатив деактивирован');
                            }}
                          />
                        </div>
                      </div>
                      <AccordionContent>
                    <div className="space-y-4">
                      <CreativeDetails
                        creativeId={it.id}
                        createdAt={it.created_at}
                        fbCreativeIds={[it.fb_creative_id_whatsapp, it.fb_creative_id_instagram_traffic, it.fb_creative_id_site_leads].filter(Boolean) as string[]}
                        demoMode={false}
                        mediaType={it.media_type}
                        imageUrl={it.image_url}
                        carouselData={it.carousel_data}
                      />
                    </div>
                      </AccordionContent>
                    </AccordionItem>
                    );
                  })}
                </Accordion>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Модальное окно для Manual Launch */}
        <Dialog open={manualLaunchDialogOpen} onOpenChange={setManualLaunchDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Запуск рекламы</DialogTitle>
              <DialogDescription>
                Настройте параметры запуска для выбранных креативов
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6 py-4">
              {/* Информация о выбранных креативах */}
              <div className="space-y-2">
                <Label>Выбранные креативы ({selectedCreativeIds.size})</Label>
                <div className="space-y-2 max-h-[150px] overflow-y-auto border rounded-lg p-3">
                  {Array.from(selectedCreativeIds).map((id) => {
                    const creative = items.find(it => it.id === id);
                    return creative ? (
                      <div
                        key={id}
                        className="flex items-center gap-3 p-2 bg-muted/30 rounded"
                      >
                        <div className="shrink-0 w-8 h-8 rounded overflow-hidden bg-muted flex items-center justify-center">
                          {creative.media_type === 'video' ? (
                            <Video className="h-4 w-4 text-muted-foreground" />
                          ) : creative.media_type === 'carousel' ? (
                            <Images className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <Image className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{creative.title}</div>
                        </div>
                      </div>
                    ) : null;
                  })}
                </div>
              </div>

              {/* Направление */}
              <div className="space-y-2">
                <Label>Направление</Label>
                <div className="p-3 bg-muted/30 rounded-lg text-sm">
                  {launchDirection?.name || 'Не выбрано'}
                  {launchDirection && (
                    <span className="text-muted-foreground ml-2">
                      ({getDirectionObjectiveLabel(launchDirection)})
                    </span>
                  )}
                </div>
              </div>

              {/* Дневной бюджет */}
              <div className="space-y-2">
                <Label htmlFor="manual-budget">Дневной бюджет ({manualLaunchBudgetLabel})</Label>
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{manualLaunchBudgetSymbol}</span>
                  <input
                    id="manual-budget"
                    type="number"
                    min={manualLaunchMinBudget}
                    step="1"
                    value={manualLaunchBudget}
                    onChange={(e) => setManualLaunchBudget(Number(e.target.value))}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={isLaunching}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Минимальный бюджет: {manualLaunchMinBudgetText} в день
                </p>
              </div>

              {/* Время запуска */}
              {!isTikTokPlatform && (
                <div className="space-y-2">
                  <Label>Время запуска</Label>
                  <RadioGroup
                    value={manualStartMode}
                    onValueChange={(v: 'now' | 'midnight_almaty') => setManualStartMode(v)}
                    className="grid grid-cols-1 gap-2"
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="midnight_almaty" id="start-midnight" />
                      <Label htmlFor="start-midnight" className="cursor-pointer">С полуночи (Алматы)</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="now" id="start-now" />
                      <Label htmlFor="start-now" className="cursor-pointer">Сейчас</Label>
                    </div>
                  </RadioGroup>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button
                variant="outline"
                onClick={() => {
                  setManualLaunchDialogOpen(false);
                  setManualLaunchBudget(manualLaunchMinBudget);
                  setManualStartMode('now');
                }}
                disabled={isLaunching}
              >
                Отмена
              </Button>
              <Button
                onClick={handleManualLaunch}
                disabled={isLaunching || selectedCreativeIds.size === 0}
                variant="default"
                className="dark:bg-gray-700 dark:hover:bg-gray-800"
              >
                {isLaunching ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Запуск...
                  </>
                ) : (
                  <>
                    <Rocket className="h-4 w-4 mr-2" />
                    Запустить
                  </>
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Модальное окно с результатом запуска */}
        <Dialog open={resultDialogOpen} onOpenChange={setResultDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Реклама запущена!</DialogTitle>
              <DialogDescription>
                {launchResult?.message || 'Реклама успешно запущена'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {launchResult && (
                <>
                  {/* Информация о направлении */}
                  <div className="space-y-2">
                    <div className="text-sm">
                      <span className="text-muted-foreground">Направление:</span>{' '}
                      <span className="font-medium">{launchResult.direction_name}</span>
                    </div>
                    {launchResult.campaign_id && (
                      <div className="text-sm">
                        <span className="text-muted-foreground">Campaign ID:</span>{' '}
                        <span className="font-mono text-xs">{launchResult.campaign_id}</span>
                      </div>
                    )}
                  </div>

                  {/* Информация об Ad Set */}
                  <div className="p-4 bg-muted/30 rounded-lg space-y-2">
                    <div className="text-sm font-medium">{adGroupTitle}</div>
                    <div className="text-sm text-muted-foreground">
                      {launchResult.adset_name || '—'}
                    </div>
                    {adGroupId && (
                      <div className="text-xs text-muted-foreground font-mono">
                        ID: {adGroupId}
                      </div>
                    )}
                    <div className="text-sm pt-2 border-t border-border/50">
                      <span className="text-muted-foreground">Дневной бюджет:</span>{' '}
                      <span className="font-medium">{launchedBudgetLabel}</span>
                    </div>
                  </div>

                  {/* Список созданных объявлений */}
                  {launchResult.ads && launchResult.ads.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-sm font-medium">
                        Создано объявлений: {launchResult.ads_created}
                      </div>
                      <div className="space-y-2 max-h-[200px] overflow-y-auto">
                        {launchResult.ads.map((ad, index) => (
                          <div
                            key={ad.ad_id}
                            className="p-3 border rounded-lg text-sm space-y-1"
                          >
                            <div className="font-medium">
                              {index + 1}. {ad.name}
                            </div>
                            <div className="text-xs text-muted-foreground font-mono">
                              ID: {ad.ad_id}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button
                variant="outline"
                onClick={() => {
                  setResultDialogOpen(false);
                  setLaunchResult(null);
                }}
              >
                Закрыть
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Модалка анализа топ креативов */}
        <CreativeAnalysisModal
          isOpen={isAnalysisModalOpen}
          onClose={() => setIsAnalysisModalOpen(false)}
          accountId={currentAdAccountId}
          onImportComplete={() => {
            reload();
            toast.success('Креативы успешно импортированы');
          }}
        />
      </div>
    </div>
  );
};

export default Creatives;
