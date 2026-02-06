/**
 * Admin Notifications Center
 *
 * Единый центр управления уведомлениями:
 * - конструктор системных шаблонов
 * - ручная рассылка по сегментам
 * - история фактических отправок
 *
 * @module pages/admin/AdminNotificationsCenter
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bell,
  Send,
  History,
  RefreshCw,
  Save,
  Users,
  Settings2,
  RotateCcw,
} from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { toast } from 'sonner';
import { API_BASE_URL } from '@/config/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type NotificationChannel = 'telegram' | 'in_app';

interface NotificationSettingsConfig {
  daily_limit: number;
  weekly_limit: number;
  send_hour: number;
  is_active: boolean;
  enabled_types: string[];
  type_cooldowns: Record<string, number>;
}

interface NotificationTemplateConfig {
  type: string;
  title: string;
  message: string;
  telegram_message: string;
  cta_url: string | null;
  cta_label: string | null;
  cooldown_days: number;
  channels: NotificationChannel[];
  enabled: boolean;
  source_template_keys: string[];
  merged_from_multiple_templates: boolean;
}

interface SegmentStats {
  total_users: number;
  active_users: number;
  subscription_active_users: number;
  users_with_telegram: number;
  users_without_subscription: number;
  subscription_expiring_7d_users: number;
}

interface Recipient {
  id: string;
  username: string | null;
  telegram_id: string | null;
  is_active: boolean | null;
  tarif: string | null;
  tarif_expires: string | null;
}

interface NotificationHistoryItem {
  id: string;
  user_account_id: string;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  telegram_sent: boolean;
  metadata?: Record<string, unknown>;
  created_at: string;
  user?: {
    id: string;
    username: string | null;
    telegram_id: string | null;
    is_active: boolean | null;
    tarif: string | null;
    tarif_expires: string | null;
  } | null;
}

interface DeliveryHistoryItem {
  id: string;
  user_account_id: string;
  notification_type: string;
  channel: string;
  telegram_sent: boolean;
  in_app_created: boolean;
  notification_id?: string | null;
  message_preview?: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
  user?: {
    id: string;
    username: string | null;
    telegram_id: string | null;
    is_active: boolean | null;
    tarif: string | null;
    tarif_expires: string | null;
  } | null;
}

interface NotificationCampaign {
  id: string;
  name: string;
  type: string;
  title: string;
  message: string;
  telegram_message: string | null;
  cta_url: string | null;
  cta_label: string | null;
  channels: NotificationChannel[];
  segment:
    | 'all'
    | 'all_active'
    | 'subscription_active'
    | 'with_telegram'
    | 'without_subscription'
    | 'subscription_expiring_7d'
    | 'custom';
  user_ids: string[];
  only_with_telegram: boolean;
  schedule_mode: 'once' | 'daily' | 'weekly';
  scheduled_at: string | null;
  send_hour_utc: number | null;
  send_minute_utc: number;
  weekly_day: number | null;
  next_run_at: string | null;
  last_run_at: string | null;
  last_result: Record<string, unknown> | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface CampaignFormState {
  name: string;
  type: string;
  title: string;
  message: string;
  telegram_message: string;
  cta_url: string;
  cta_label: string;
  channels: NotificationChannel[];
  segment:
    | 'all'
    | 'all_active'
    | 'subscription_active'
    | 'with_telegram'
    | 'without_subscription'
    | 'subscription_expiring_7d'
    | 'custom';
  user_ids: string[];
  only_with_telegram: boolean;
  schedule_mode: 'once' | 'daily' | 'weekly';
  scheduled_at: string;
  send_hour_utc: string;
  send_minute_utc: string;
  weekly_day: string;
  is_active: boolean;
}

interface BroadcastFormState {
  type: string;
  title: string;
  message: string;
  telegram_message: string;
  cta_url: string;
  cta_label: string;
  channels: NotificationChannel[];
  segment:
    | 'all'
    | 'all_active'
    | 'subscription_active'
    | 'with_telegram'
    | 'without_subscription'
    | 'subscription_expiring_7d'
    | 'custom';
  only_with_telegram: boolean;
}

const DEFAULT_SETTINGS: NotificationSettingsConfig = {
  daily_limit: 3,
  weekly_limit: 10,
  send_hour: 4,
  is_active: false,
  enabled_types: [],
  type_cooldowns: {},
};

const DEFAULT_BROADCAST_FORM: BroadcastFormState = {
  type: 'admin_broadcast',
  title: '',
  message: '',
  telegram_message: '',
  cta_url: '',
  cta_label: '',
  channels: ['in_app'],
  segment: 'all_active',
  only_with_telegram: false,
};

const DEFAULT_CAMPAIGN_FORM: CampaignFormState = {
  name: '',
  type: 'admin_broadcast',
  title: '',
  message: '',
  telegram_message: '',
  cta_url: '',
  cta_label: '',
  channels: ['in_app'],
  segment: 'all_active',
  user_ids: [],
  only_with_telegram: false,
  schedule_mode: 'daily',
  scheduled_at: '',
  send_hour_utc: '4',
  send_minute_utc: '0',
  weekly_day: '1',
  is_active: true,
};

function getUserIdFromStorage(): string {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    return typeof user?.id === 'string' ? user.id : '';
  } catch {
    return '';
  }
}

function authHeaders(withJson = false): Record<string, string> {
  const userId = getUserIdFromStorage();
  return {
    ...(withJson ? { 'Content-Type': 'application/json' } : {}),
    'x-user-id': userId,
  };
}

function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return format(date, 'dd.MM.yyyy HH:mm', { locale: ru });
}

const AdminNotificationsCenter: React.FC = () => {
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [sendingBroadcast, setSendingBroadcast] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [segments, setSegments] = useState<SegmentStats>({
    total_users: 0,
    active_users: 0,
    subscription_active_users: 0,
    users_with_telegram: 0,
    users_without_subscription: 0,
    subscription_expiring_7d_users: 0,
  });

  const [settings, setSettings] = useState<NotificationSettingsConfig>(DEFAULT_SETTINGS);
  const [templates, setTemplates] = useState<NotificationTemplateConfig[]>([]);
  const [selectedTemplateType, setSelectedTemplateType] = useState<string>('');
  const [templateDraft, setTemplateDraft] = useState<NotificationTemplateConfig | null>(null);

  const [broadcastForm, setBroadcastForm] = useState<BroadcastFormState>(DEFAULT_BROADCAST_FORM);
  const [recipientSearch, setRecipientSearch] = useState('');
  const [recipientOptions, setRecipientOptions] = useState<Recipient[]>([]);
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([]);
  const [campaigns, setCampaigns] = useState<NotificationCampaign[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [savingCampaign, setSavingCampaign] = useState(false);
  const [runningCampaignId, setRunningCampaignId] = useState<string | null>(null);
  const [deletingCampaignId, setDeletingCampaignId] = useState<string | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('new');
  const [campaignForm, setCampaignForm] = useState<CampaignFormState>(DEFAULT_CAMPAIGN_FORM);
  const [campaignRecipientSearch, setCampaignRecipientSearch] = useState('');
  const [campaignRecipientOptions, setCampaignRecipientOptions] = useState<Recipient[]>([]);
  const [loadingCampaignRecipients, setLoadingCampaignRecipients] = useState(false);

  const [historySearch, setHistorySearch] = useState('');
  const [historyType, setHistoryType] = useState<string>('all');
  const [notificationHistory, setNotificationHistory] = useState<NotificationHistoryItem[]>([]);
  const [deliveryHistory, setDeliveryHistory] = useState<DeliveryHistoryItem[]>([]);

  const [historyView, setHistoryView] = useState<'user' | 'delivery'>('user');

  const availableTypes = useMemo(() => {
    return Array.from(new Set(templates.map((item) => item.type))).sort((a, b) => a.localeCompare(b));
  }, [templates]);

  const selectedTemplate = useMemo(
    () => templates.find((item) => item.type === selectedTemplateType) || null,
    [templates, selectedTemplateType]
  );

  const selectedCampaign = useMemo(
    () => campaigns.find((campaign) => campaign.id === selectedCampaignId) || null,
    [campaigns, selectedCampaignId]
  );

  const mapCampaignToForm = useCallback((campaign: NotificationCampaign): CampaignFormState => ({
    name: campaign.name || '',
    type: campaign.type || 'admin_broadcast',
    title: campaign.title || '',
    message: campaign.message || '',
    telegram_message: campaign.telegram_message || '',
    cta_url: campaign.cta_url || '',
    cta_label: campaign.cta_label || '',
    channels: Array.isArray(campaign.channels) && campaign.channels.length > 0 ? campaign.channels : ['in_app'],
    segment: campaign.segment || 'all_active',
    user_ids: Array.isArray(campaign.user_ids) ? campaign.user_ids : [],
    only_with_telegram: Boolean(campaign.only_with_telegram),
    schedule_mode: campaign.schedule_mode || 'daily',
    scheduled_at: campaign.scheduled_at ? String(campaign.scheduled_at).slice(0, 16) : '',
    send_hour_utc: campaign.send_hour_utc !== null && campaign.send_hour_utc !== undefined
      ? String(campaign.send_hour_utc)
      : '4',
    send_minute_utc: campaign.send_minute_utc !== null && campaign.send_minute_utc !== undefined
      ? String(campaign.send_minute_utc)
      : '0',
    weekly_day: campaign.weekly_day !== null && campaign.weekly_day !== undefined
      ? String(campaign.weekly_day)
      : '1',
    is_active: Boolean(campaign.is_active),
  }), []);

  const fetchConfig = useCallback(async () => {
    setLoadingConfig(true);
    try {
      const res = await fetch(`${API_BASE_URL}/admin/notifications/config`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error('Не удалось загрузить конфигурацию уведомлений');

      const data = await res.json();
      const nextSettings = data.settings || DEFAULT_SETTINGS;
      const nextTemplates = (data.templates || []) as NotificationTemplateConfig[];

      setSettings({
        daily_limit: Number(nextSettings.daily_limit ?? DEFAULT_SETTINGS.daily_limit),
        weekly_limit: Number(nextSettings.weekly_limit ?? DEFAULT_SETTINGS.weekly_limit),
        send_hour: Number(nextSettings.send_hour ?? DEFAULT_SETTINGS.send_hour),
        is_active: Boolean(nextSettings.is_active),
        enabled_types: Array.isArray(nextSettings.enabled_types) ? nextSettings.enabled_types : [],
        type_cooldowns: nextSettings.type_cooldowns || {},
      });
      setTemplates(nextTemplates);

      if (nextTemplates.length > 0) {
        const nextType = selectedTemplateType && nextTemplates.some((item) => item.type === selectedTemplateType)
          ? selectedTemplateType
          : nextTemplates[0].type;
        setSelectedTemplateType(nextType);
      }
    } catch (err: any) {
      toast.error(err?.message || 'Ошибка загрузки конфигурации');
    } finally {
      setLoadingConfig(false);
    }
  }, [selectedTemplateType]);

  const fetchSegments = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/admin/notifications/segments`, {
        headers: authHeaders(),
      });
      if (!res.ok) return;
      const data = await res.json();
      setSegments({
        total_users: Number(data.total_users || 0),
        active_users: Number(data.active_users || 0),
        subscription_active_users: Number(data.subscription_active_users || 0),
        users_with_telegram: Number(data.users_with_telegram || 0),
        users_without_subscription: Number(data.users_without_subscription || 0),
        subscription_expiring_7d_users: Number(data.subscription_expiring_7d_users || 0),
      });
    } catch (err) {
      console.error('Failed to fetch segments', err);
    }
  }, []);

  const fetchRecipients = useCallback(async (searchValue: string) => {
    if (broadcastForm.segment !== 'custom') return;

    setLoadingRecipients(true);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (searchValue.trim()) {
        params.set('search', searchValue.trim());
      }

      const res = await fetch(`${API_BASE_URL}/admin/notifications/recipients?${params.toString()}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error('Не удалось загрузить получателей');
      const data = await res.json();
      setRecipientOptions(data.recipients || []);
    } catch (err: any) {
      toast.error(err?.message || 'Ошибка загрузки получателей');
    } finally {
      setLoadingRecipients(false);
    }
  }, [broadcastForm.segment]);

  const fetchCampaigns = useCallback(async () => {
    setLoadingCampaigns(true);
    try {
      const res = await fetch(`${API_BASE_URL}/admin/notifications/campaigns`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error('Не удалось загрузить кампании');
      const data = await res.json();
      setCampaigns((data.campaigns || []) as NotificationCampaign[]);
    } catch (err: any) {
      toast.error(err?.message || 'Ошибка загрузки кампаний');
    } finally {
      setLoadingCampaigns(false);
    }
  }, []);

  const fetchCampaignRecipients = useCallback(async (searchValue: string) => {
    if (campaignForm.segment !== 'custom') return;

    setLoadingCampaignRecipients(true);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (searchValue.trim()) {
        params.set('search', searchValue.trim());
      }

      const res = await fetch(`${API_BASE_URL}/admin/notifications/recipients?${params.toString()}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error('Не удалось загрузить получателей кампании');
      const data = await res.json();
      setCampaignRecipientOptions(data.recipients || []);
    } catch (err: any) {
      toast.error(err?.message || 'Ошибка загрузки получателей кампании');
    } finally {
      setLoadingCampaignRecipients(false);
    }
  }, [campaignForm.segment]);

  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const params = new URLSearchParams({
        limit: '100',
        offset: '0',
      });
      if (historyType !== 'all') params.set('type', historyType);
      if (historySearch.trim()) params.set('search', historySearch.trim());

      const [userRes, deliveryRes] = await Promise.all([
        fetch(`${API_BASE_URL}/admin/notifications/user-history?${params.toString()}`, {
          headers: authHeaders(),
        }),
        fetch(`${API_BASE_URL}/admin/notifications/delivery-history?${params.toString()}`, {
          headers: authHeaders(),
        }),
      ]);

      if (userRes.ok) {
        const userData = await userRes.json();
        setNotificationHistory(userData.notifications || []);
      }
      if (deliveryRes.ok) {
        const deliveryData = await deliveryRes.json();
        setDeliveryHistory(deliveryData.history || []);
      }
    } catch (err) {
      console.error('Failed to fetch history', err);
      toast.error('Не удалось загрузить историю уведомлений');
    } finally {
      setLoadingHistory(false);
    }
  }, [historySearch, historyType]);

  useEffect(() => {
    fetchConfig();
    fetchSegments();
    fetchHistory();
    fetchCampaigns();
  }, [fetchConfig, fetchHistory, fetchSegments, fetchCampaigns]);

  useEffect(() => {
    if (!selectedTemplate) {
      setTemplateDraft(null);
      return;
    }
    setTemplateDraft({ ...selectedTemplate });
  }, [selectedTemplate]);

  useEffect(() => {
    if (broadcastForm.segment !== 'custom') return;
    const timer = setTimeout(() => {
      fetchRecipients(recipientSearch);
    }, 250);
    return () => clearTimeout(timer);
  }, [broadcastForm.segment, recipientSearch, fetchRecipients]);

  useEffect(() => {
    if (!selectedCampaign) {
      if (selectedCampaignId === 'new') {
        setCampaignForm(DEFAULT_CAMPAIGN_FORM);
      }
      return;
    }
    setCampaignForm(mapCampaignToForm(selectedCampaign));
  }, [selectedCampaign, selectedCampaignId, mapCampaignToForm]);

  useEffect(() => {
    if (campaignForm.segment !== 'custom') return;
    const timer = setTimeout(() => {
      fetchCampaignRecipients(campaignRecipientSearch);
    }, 250);
    return () => clearTimeout(timer);
  }, [campaignForm.segment, campaignRecipientSearch, fetchCampaignRecipients]);

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      const res = await fetch(`${API_BASE_URL}/admin/notifications/config`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify({
          daily_limit: settings.daily_limit,
          weekly_limit: settings.weekly_limit,
          send_hour: settings.send_hour,
          is_active: settings.is_active,
          enabled_types: settings.enabled_types,
          type_cooldowns: settings.type_cooldowns,
        }),
      });
      if (!res.ok) throw new Error('Не удалось сохранить настройки');

      toast.success('Настройки уведомлений сохранены');
      await fetchConfig();
    } catch (err: any) {
      toast.error(err?.message || 'Ошибка сохранения настроек');
    } finally {
      setSavingSettings(false);
    }
  };

  const saveTemplate = async () => {
    if (!templateDraft) return;
    setSavingTemplate(true);
    try {
      const res = await fetch(`${API_BASE_URL}/admin/notifications/templates/${encodeURIComponent(templateDraft.type)}`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify({
          title: templateDraft.title,
          message: templateDraft.message,
          telegram_message: templateDraft.telegram_message,
          cta_url: templateDraft.cta_url || '',
          cta_label: templateDraft.cta_label || '',
          cooldown_days: templateDraft.cooldown_days,
          channels: templateDraft.channels,
          enabled: templateDraft.enabled,
        }),
      });
      if (!res.ok) throw new Error('Не удалось сохранить шаблон');

      toast.success('Шаблон уведомления обновлён');
      await fetchConfig();
      await fetchHistory();
    } catch (err: any) {
      toast.error(err?.message || 'Ошибка сохранения шаблона');
    } finally {
      setSavingTemplate(false);
    }
  };

  const resetTemplate = async () => {
    if (!templateDraft) return;
    setSavingTemplate(true);
    try {
      const res = await fetch(`${API_BASE_URL}/admin/notifications/templates/${encodeURIComponent(templateDraft.type)}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error('Не удалось сбросить overrides');

      toast.success('Переопределения сброшены к системным дефолтам');
      await fetchConfig();
    } catch (err: any) {
      toast.error(err?.message || 'Ошибка сброса шаблона');
    } finally {
      setSavingTemplate(false);
    }
  };

  const toggleChannel = (channel: NotificationChannel) => {
    setBroadcastForm((prev) => {
      const has = prev.channels.includes(channel);
      const next = has
        ? prev.channels.filter((item) => item !== channel)
        : [...prev.channels, channel];
      return {
        ...prev,
        channels: next.length > 0 ? next : ['in_app'],
      };
    });
  };

  const toggleRecipient = (recipientId: string) => {
    setSelectedRecipientIds((prev) =>
      prev.includes(recipientId)
        ? prev.filter((id) => id !== recipientId)
        : [...prev, recipientId]
    );
  };

  const sendBroadcast = async () => {
    if (!broadcastForm.title.trim()) {
      toast.error('Введите заголовок уведомления');
      return;
    }
    if (!broadcastForm.message.trim()) {
      toast.error('Введите текст уведомления');
      return;
    }
    if (broadcastForm.segment === 'custom' && selectedRecipientIds.length === 0) {
      toast.error('Выберите получателей для custom-сегмента');
      return;
    }

    setSendingBroadcast(true);
    try {
      const res = await fetch(`${API_BASE_URL}/admin/notifications/broadcast`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          ...broadcastForm,
          user_ids: broadcastForm.segment === 'custom' ? selectedRecipientIds : undefined,
          telegram_message: broadcastForm.telegram_message.trim() || undefined,
          cta_url: broadcastForm.cta_url.trim() || undefined,
          cta_label: broadcastForm.cta_label.trim() || undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Не удалось отправить рассылку');
      }

      toast.success(
        `Рассылка отправлена: ${data.recipients || 0} пользователей, in-app ${data.in_app_created || 0}, Telegram ${data.telegram_sent || 0}`
      );

      setBroadcastForm(DEFAULT_BROADCAST_FORM);
      setSelectedRecipientIds([]);
      setRecipientSearch('');
      await Promise.all([fetchSegments(), fetchHistory()]);
    } catch (err: any) {
      toast.error(err?.message || 'Ошибка отправки рассылки');
    } finally {
      setSendingBroadcast(false);
    }
  };

  const toggleCampaignChannel = (channel: NotificationChannel) => {
    setCampaignForm((prev) => {
      const has = prev.channels.includes(channel);
      const next = has
        ? prev.channels.filter((item) => item !== channel)
        : [...prev.channels, channel];
      return {
        ...prev,
        channels: next.length > 0 ? next : ['in_app'],
      };
    });
  };

  const toggleCampaignRecipient = (recipientId: string) => {
    setCampaignForm((prev) => ({
      ...prev,
      user_ids: prev.user_ids.includes(recipientId)
        ? prev.user_ids.filter((id) => id !== recipientId)
        : [...prev.user_ids, recipientId],
    }));
  };

  const validateCampaign = (): string | null => {
    if (!campaignForm.name.trim()) return 'Введите название кампании';
    if (!campaignForm.title.trim()) return 'Введите заголовок кампании';
    if (!campaignForm.message.trim()) return 'Введите текст кампании';
    if (campaignForm.channels.length === 0) return 'Выберите минимум один канал';
    if (campaignForm.segment === 'custom' && campaignForm.user_ids.length === 0) {
      return 'Для custom кампании выберите получателей';
    }
    if (campaignForm.schedule_mode === 'once' && !campaignForm.scheduled_at.trim()) {
      return 'Для одноразовой кампании укажите дату/время запуска';
    }
    if (campaignForm.schedule_mode === 'once') {
      const parsed = new Date(campaignForm.scheduled_at);
      if (Number.isNaN(parsed.getTime())) {
        return 'Некорректная дата/время запуска';
      }
    }
    if (campaignForm.schedule_mode !== 'once' && campaignForm.send_hour_utc.trim() === '') {
      return 'Для регулярной кампании укажите send hour (UTC)';
    }
    if (campaignForm.schedule_mode !== 'once') {
      const hour = Number(campaignForm.send_hour_utc);
      const minute = Number(campaignForm.send_minute_utc);
      if (!Number.isFinite(hour) || hour < 0 || hour > 23) {
        return 'send hour (UTC) должен быть от 0 до 23';
      }
      if (!Number.isFinite(minute) || minute < 0 || minute > 59) {
        return 'send minute (UTC) должен быть от 0 до 59';
      }
    }
    if (campaignForm.schedule_mode === 'weekly' && campaignForm.weekly_day.trim() === '') {
      return 'Для weekly кампании укажите день недели';
    }
    if (campaignForm.schedule_mode === 'weekly') {
      const weeklyDay = Number(campaignForm.weekly_day);
      if (!Number.isFinite(weeklyDay) || weeklyDay < 0 || weeklyDay > 6) {
        return 'День недели должен быть от 0 (вск) до 6 (сб)';
      }
    }
    return null;
  };

  const buildCampaignPayload = () => {
    const scheduledAtDate = new Date(campaignForm.scheduled_at);

    return {
      name: campaignForm.name.trim(),
      type: campaignForm.type.trim() || 'admin_broadcast',
      title: campaignForm.title.trim(),
      message: campaignForm.message.trim(),
      telegram_message: campaignForm.telegram_message.trim() || undefined,
      cta_url: campaignForm.cta_url.trim() || undefined,
      cta_label: campaignForm.cta_label.trim() || undefined,
      channels: campaignForm.channels,
      segment: campaignForm.segment,
      user_ids: campaignForm.segment === 'custom' ? campaignForm.user_ids : undefined,
      only_with_telegram: campaignForm.only_with_telegram,
      schedule_mode: campaignForm.schedule_mode,
      scheduled_at: campaignForm.schedule_mode === 'once' && !Number.isNaN(scheduledAtDate.getTime())
        ? scheduledAtDate.toISOString()
        : undefined,
      send_hour_utc: campaignForm.schedule_mode === 'once'
        ? undefined
        : Number(campaignForm.send_hour_utc || 0),
      send_minute_utc: campaignForm.schedule_mode === 'once'
        ? 0
        : Number(campaignForm.send_minute_utc || 0),
      weekly_day: campaignForm.schedule_mode === 'weekly'
        ? Number(campaignForm.weekly_day || 0)
        : undefined,
      is_active: campaignForm.is_active,
    };
  };

  const saveCampaign = async () => {
    const validationError = validateCampaign();
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setSavingCampaign(true);
    try {
      const payload = buildCampaignPayload();
      const isNew = selectedCampaignId === 'new';
      const url = isNew
        ? `${API_BASE_URL}/admin/notifications/campaigns`
        : `${API_BASE_URL}/admin/notifications/campaigns/${selectedCampaignId}`;
      const method = isNew ? 'POST' : 'PUT';

      const res = await fetch(url, {
        method,
        headers: authHeaders(true),
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Не удалось сохранить кампанию');

      toast.success(isNew ? 'Кампания создана' : 'Кампания обновлена');
      await fetchCampaigns();
      await fetchSegments();
      if (data?.campaign?.id) {
        setSelectedCampaignId(data.campaign.id);
      }
    } catch (err: any) {
      toast.error(err?.message || 'Ошибка сохранения кампании');
    } finally {
      setSavingCampaign(false);
    }
  };

  const runCampaignNow = async (campaignId: string) => {
    setRunningCampaignId(campaignId);
    try {
      const res = await fetch(`${API_BASE_URL}/admin/notifications/campaigns/${campaignId}/run-now`, {
        method: 'POST',
        headers: authHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Не удалось запустить кампанию');

      toast.success(
        `Кампания отправлена: ${data?.result?.recipients || 0}, in-app ${data?.result?.in_app_created || 0}, Telegram ${data?.result?.telegram_sent || 0}`
      );
      await Promise.all([fetchCampaigns(), fetchHistory()]);
    } catch (err: any) {
      toast.error(err?.message || 'Ошибка запуска кампании');
    } finally {
      setRunningCampaignId(null);
    }
  };

  const deleteCampaign = async (campaignId: string) => {
    setDeletingCampaignId(campaignId);
    try {
      const res = await fetch(`${API_BASE_URL}/admin/notifications/campaigns/${campaignId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Не удалось удалить кампанию');

      toast.success('Кампания удалена');
      await fetchCampaigns();

      if (selectedCampaignId === campaignId) {
        setSelectedCampaignId('new');
        setCampaignForm(DEFAULT_CAMPAIGN_FORM);
      }
    } catch (err: any) {
      toast.error(err?.message || 'Ошибка удаления кампании');
    } finally {
      setDeletingCampaignId(null);
    }
  };

  const renderSegmentHint = () => {
    if (broadcastForm.segment === 'all') {
      return `Все пользователи: ${segments.total_users}`;
    }
    if (broadcastForm.segment === 'all_active') {
      return `Все активные: ${segments.active_users}`;
    }
    if (broadcastForm.segment === 'subscription_active') {
      return `Активные с подпиской: ${segments.subscription_active_users}`;
    }
    if (broadcastForm.segment === 'with_telegram') {
      return `С Telegram: ${segments.users_with_telegram}`;
    }
    if (broadcastForm.segment === 'without_subscription') {
      return `Без подписки: ${segments.users_without_subscription}`;
    }
    if (broadcastForm.segment === 'subscription_expiring_7d') {
      return `Истекает <= 7 дней: ${segments.subscription_expiring_7d_users}`;
    }
    return `Custom выбор: ${selectedRecipientIds.length}`;
  };

  const renderCampaignSegmentHint = () => {
    if (campaignForm.segment === 'all') {
      return `Все пользователи: ${segments.total_users}`;
    }
    if (campaignForm.segment === 'all_active') {
      return `Все активные: ${segments.active_users}`;
    }
    if (campaignForm.segment === 'subscription_active') {
      return `Активные с подпиской: ${segments.subscription_active_users}`;
    }
    if (campaignForm.segment === 'with_telegram') {
      return `С Telegram: ${segments.users_with_telegram}`;
    }
    if (campaignForm.segment === 'without_subscription') {
      return `Без подписки: ${segments.users_without_subscription}`;
    }
    if (campaignForm.segment === 'subscription_expiring_7d') {
      return `Истекает <= 7 дней: ${segments.subscription_expiring_7d_users}`;
    }
    return `Custom выбор: ${campaignForm.user_ids.length}`;
  };

  const formatCampaignSchedule = (campaign: NotificationCampaign) => {
    if (campaign.schedule_mode === 'once') {
      return campaign.scheduled_at
        ? `Once: ${formatDateTime(campaign.scheduled_at)}`
        : 'Once: не задано';
    }
    if (campaign.schedule_mode === 'daily') {
      const hour = campaign.send_hour_utc ?? 0;
      const minute = campaign.send_minute_utc ?? 0;
      return `Daily: ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} UTC`;
    }

    const weekDays = ['Вск', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    const day = campaign.weekly_day !== null && campaign.weekly_day !== undefined
      ? weekDays[campaign.weekly_day] || String(campaign.weekly_day)
      : 'не задано';
    const hour = campaign.send_hour_utc ?? 0;
    const minute = campaign.send_minute_utc ?? 0;
    return `Weekly (${day}): ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} UTC`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bell className="h-6 w-6" />
            Уведомления
          </h1>
          <p className="text-muted-foreground">
            Конструктор шаблонов, ручная рассылка и журнал отправок
          </p>
        </div>
        <Button variant="outline" onClick={() => { fetchConfig(); fetchSegments(); fetchHistory(); fetchCampaigns(); }}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Обновить
        </Button>
      </div>

      <Tabs defaultValue="constructor" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="constructor" className="gap-2">
            <Settings2 className="h-4 w-4" /> Конструктор
          </TabsTrigger>
          <TabsTrigger value="send" className="gap-2">
            <Send className="h-4 w-4" /> Рассылка
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2">
            <History className="h-4 w-4" /> История
          </TabsTrigger>
        </TabsList>

        <TabsContent value="constructor" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Глобальные настройки</CardTitle>
              <CardDescription>
                Эти настройки применяются ко всей системе engagement-уведомлений
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <p className="font-medium">Система активна</p>
                  <p className="text-sm text-muted-foreground">Полностью включает/выключает автоматические уведомления</p>
                </div>
                <Switch
                  checked={settings.is_active}
                  onCheckedChange={(value) => setSettings((prev) => ({ ...prev, is_active: value }))}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label>Дневной лимит</Label>
                  <Input
                    type="number"
                    min={0}
                    value={settings.daily_limit}
                    onChange={(e) => setSettings((prev) => ({ ...prev, daily_limit: Number(e.target.value || 0) }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Недельный лимит</Label>
                  <Input
                    type="number"
                    min={0}
                    value={settings.weekly_limit}
                    onChange={(e) => setSettings((prev) => ({ ...prev, weekly_limit: Number(e.target.value || 0) }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Час отправки (UTC)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={23}
                    value={settings.send_hour}
                    onChange={(e) => setSettings((prev) => ({ ...prev, send_hour: Number(e.target.value || 0) }))}
                  />
                </div>
              </div>

              <Button onClick={saveSettings} disabled={savingSettings}>
                {savingSettings ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Сохранение...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Сохранить настройки
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-12">
            <Card className="lg:col-span-4">
              <CardHeader>
                <CardTitle>Системные типы</CardTitle>
                <CardDescription>Выберите тип для редактирования</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 max-h-[560px] overflow-auto">
                {loadingConfig && (
                  <div className="text-sm text-muted-foreground">Загрузка...</div>
                )}
                {!loadingConfig && templates.length === 0 && (
                  <div className="text-sm text-muted-foreground">Шаблоны не найдены</div>
                )}
                {templates.map((item) => {
                  const isActive = item.type === selectedTemplateType;
                  return (
                    <button
                      key={item.type}
                      className={`w-full text-left border rounded-md p-3 transition-colors ${isActive ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'}`}
                      onClick={() => setSelectedTemplateType(item.type)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium text-sm break-all">{item.type}</p>
                        <Badge variant={item.enabled ? 'default' : 'outline'}>
                          {item.enabled ? 'Вкл' : 'Выкл'}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {item.title}
                      </p>
                      {item.merged_from_multiple_templates && (
                        <p className="text-[11px] text-amber-600 mt-1">
                          Общий тип для {item.source_template_keys.length} шаблонов
                        </p>
                      )}
                    </button>
                  );
                })}
              </CardContent>
            </Card>

            <Card className="lg:col-span-8">
              <CardHeader>
                <CardTitle>Редактор шаблона</CardTitle>
                <CardDescription>
                  Изменения сразу применяются в автоматических отправках по выбранному типу
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!templateDraft && (
                  <div className="text-sm text-muted-foreground">Выберите тип уведомления слева</div>
                )}

                {templateDraft && (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">type: {templateDraft.type}</Badge>
                      <Badge variant="outline">cooldown: {templateDraft.cooldown_days} дн</Badge>
                      <Badge variant="outline">
                        channels: {templateDraft.channels.join(', ')}
                      </Badge>
                    </div>

                    <div className="flex items-center justify-between rounded-md border p-3">
                      <div>
                        <p className="font-medium">Тип включён</p>
                        <p className="text-sm text-muted-foreground">Управляет участием типа в авто-отправках</p>
                      </div>
                      <Switch
                        checked={templateDraft.enabled}
                        onCheckedChange={(value) => setTemplateDraft((prev) => prev ? ({ ...prev, enabled: value }) : prev)}
                      />
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Заголовок</Label>
                        <Input
                          value={templateDraft.title}
                          onChange={(e) => setTemplateDraft((prev) => prev ? ({ ...prev, title: e.target.value }) : prev)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Cooldown (дни)</Label>
                        <Input
                          type="number"
                          min={0}
                          max={9999}
                          value={templateDraft.cooldown_days}
                          onChange={(e) => setTemplateDraft((prev) => prev ? ({ ...prev, cooldown_days: Number(e.target.value || 0) }) : prev)}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Текст in-app</Label>
                      <Textarea
                        rows={4}
                        value={templateDraft.message}
                        onChange={(e) => setTemplateDraft((prev) => prev ? ({ ...prev, message: e.target.value }) : prev)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Текст Telegram (HTML поддерживается)</Label>
                      <Textarea
                        rows={6}
                        value={templateDraft.telegram_message}
                        onChange={(e) => setTemplateDraft((prev) => prev ? ({ ...prev, telegram_message: e.target.value }) : prev)}
                      />
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>CTA URL</Label>
                        <Input
                          placeholder="https://app.performanteaiagency.com/profile"
                          value={templateDraft.cta_url || ''}
                          onChange={(e) => setTemplateDraft((prev) => prev ? ({ ...prev, cta_url: e.target.value }) : prev)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>CTA Label</Label>
                        <Input
                          placeholder="Открыть"
                          value={templateDraft.cta_label || ''}
                          onChange={(e) => setTemplateDraft((prev) => prev ? ({ ...prev, cta_label: e.target.value }) : prev)}
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-4">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={templateDraft.channels.includes('in_app')}
                          onCheckedChange={(checked) => {
                            setTemplateDraft((prev) => {
                              if (!prev) return prev;
                              const next = checked
                                ? Array.from(new Set([...prev.channels, 'in_app']))
                                : prev.channels.filter((item) => item !== 'in_app');
                              return { ...prev, channels: next.length > 0 ? next : ['telegram'] };
                            });
                          }}
                        />
                        <Label>In-app</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={templateDraft.channels.includes('telegram')}
                          onCheckedChange={(checked) => {
                            setTemplateDraft((prev) => {
                              if (!prev) return prev;
                              const next = checked
                                ? Array.from(new Set([...prev.channels, 'telegram']))
                                : prev.channels.filter((item) => item !== 'telegram');
                              return { ...prev, channels: next.length > 0 ? next : ['in_app'] };
                            });
                          }}
                        />
                        <Label>Telegram</Label>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button onClick={saveTemplate} disabled={savingTemplate}>
                        {savingTemplate ? (
                          <>
                            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                            Сохранение...
                          </>
                        ) : (
                          <>
                            <Save className="h-4 w-4 mr-2" />
                            Сохранить тип
                          </>
                        )}
                      </Button>
                      <Button variant="outline" onClick={resetTemplate} disabled={savingTemplate}>
                        <RotateCcw className="h-4 w-4 mr-2" />
                        Сбросить overrides
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="send" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Все пользователи</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{segments.total_users}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Активные</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{segments.active_users}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Активная подписка</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{segments.subscription_active_users}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">С Telegram</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{segments.users_with_telegram}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Без подписки</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{segments.users_without_subscription}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{"Истекает <= 7 дн"}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{segments.subscription_expiring_7d_users}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Send className="h-5 w-5" />
                Ручная отправка уведомления
              </CardTitle>
              <CardDescription>
                Сегмент: {renderSegmentHint()}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Тип уведомления</Label>
                  <Input
                    value={broadcastForm.type}
                    onChange={(e) => setBroadcastForm((prev) => ({ ...prev, type: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Сегмент получателей</Label>
                  <Select
                    value={broadcastForm.segment}
                    onValueChange={(value) => {
                      setBroadcastForm((prev) => ({ ...prev, segment: value as BroadcastFormState['segment'] }));
                      if (value !== 'custom') {
                        setSelectedRecipientIds([]);
                      } else {
                        fetchRecipients(recipientSearch);
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Все пользователи</SelectItem>
                      <SelectItem value="all_active">Все активные</SelectItem>
                      <SelectItem value="subscription_active">Активные с подпиской</SelectItem>
                      <SelectItem value="with_telegram">Пользователи с Telegram</SelectItem>
                      <SelectItem value="without_subscription">Пользователи без подписки</SelectItem>
                      <SelectItem value="subscription_expiring_7d">{"Подписка истекает <= 7 дней"}</SelectItem>
                      <SelectItem value="custom">Custom (выбрать вручную)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Заголовок</Label>
                  <Input
                    value={broadcastForm.title}
                    onChange={(e) => setBroadcastForm((prev) => ({ ...prev, title: e.target.value }))}
                    placeholder="Например: Напоминание о запуске рекламы"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Только пользователи с Telegram</Label>
                  <div className="h-10 px-3 border rounded-md flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Фильтр отправки</span>
                    <Switch
                      checked={broadcastForm.only_with_telegram}
                      onCheckedChange={(value) => setBroadcastForm((prev) => ({ ...prev, only_with_telegram: value }))}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Текст in-app</Label>
                <Textarea
                  rows={4}
                  value={broadcastForm.message}
                  onChange={(e) => setBroadcastForm((prev) => ({ ...prev, message: e.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <Label>Текст Telegram (опционально)</Label>
                <Textarea
                  rows={5}
                  value={broadcastForm.telegram_message}
                  onChange={(e) => setBroadcastForm((prev) => ({ ...prev, telegram_message: e.target.value }))}
                  placeholder="Если пусто — текст соберется автоматически из заголовка и сообщения."
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>CTA URL</Label>
                  <Input
                    value={broadcastForm.cta_url}
                    onChange={(e) => setBroadcastForm((prev) => ({ ...prev, cta_url: e.target.value }))}
                    placeholder="https://app.performanteaiagency.com/profile"
                  />
                </div>
                <div className="space-y-2">
                  <Label>CTA Label</Label>
                  <Input
                    value={broadcastForm.cta_label}
                    onChange={(e) => setBroadcastForm((prev) => ({ ...prev, cta_label: e.target.value }))}
                    placeholder="Открыть"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={broadcastForm.channels.includes('in_app')}
                    onCheckedChange={() => toggleChannel('in_app')}
                  />
                  <Label>Отправлять in-app</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={broadcastForm.channels.includes('telegram')}
                    onCheckedChange={() => toggleChannel('telegram')}
                  />
                  <Label>Отправлять в Telegram</Label>
                </div>
              </div>

              {broadcastForm.segment === 'custom' && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      Выбор получателей
                    </CardTitle>
                    <CardDescription>
                      Выбрано: {selectedRecipientIds.length}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex gap-2">
                      <Input
                        value={recipientSearch}
                        onChange={(e) => setRecipientSearch(e.target.value)}
                        placeholder="Поиск по username или telegram_id"
                      />
                      <Button variant="outline" onClick={() => fetchRecipients(recipientSearch)}>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Найти
                      </Button>
                      <Button variant="ghost" onClick={() => setSelectedRecipientIds([])}>
                        Сбросить выбор
                      </Button>
                    </div>

                    {loadingRecipients && (
                      <div className="text-sm text-muted-foreground">Загрузка получателей...</div>
                    )}

                    {!loadingRecipients && recipientOptions.length === 0 && (
                      <div className="text-sm text-muted-foreground">Получатели не найдены</div>
                    )}

                    <div className="max-h-64 overflow-auto border rounded-md">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-10"></TableHead>
                            <TableHead>Пользователь</TableHead>
                            <TableHead>Telegram</TableHead>
                            <TableHead>Статус</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {recipientOptions.map((recipient) => (
                            <TableRow key={recipient.id}>
                              <TableCell>
                                <Checkbox
                                  checked={selectedRecipientIds.includes(recipient.id)}
                                  onCheckedChange={() => toggleRecipient(recipient.id)}
                                />
                              </TableCell>
                              <TableCell className="font-mono text-xs">
                                <div>{recipient.username || '—'}</div>
                                <div className="text-muted-foreground">{recipient.id.slice(0, 8)}...</div>
                              </TableCell>
                              <TableCell>{recipient.telegram_id || '—'}</TableCell>
                              <TableCell>
                                <Badge variant={recipient.is_active ? 'default' : 'outline'}>
                                  {recipient.is_active ? 'Активен' : 'Неактивен'}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}

              <Button onClick={sendBroadcast} disabled={sendingBroadcast}>
                {sendingBroadcast ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Отправка...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Отправить уведомление
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-12">
            <Card className="xl:col-span-7">
              <CardHeader>
                <CardTitle>Запланированные кампании</CardTitle>
                <CardDescription>
                  Конструктор регулярных и одноразовых рассылок. {renderCampaignSegmentHint()}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Кампания</Label>
                    <Select
                      value={selectedCampaignId}
                      onValueChange={(value) => {
                        setSelectedCampaignId(value);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите кампанию" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="new">Новая кампания</SelectItem>
                        {campaigns.map((campaign) => (
                          <SelectItem key={campaign.id} value={campaign.id}>
                            {campaign.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Режим редактирования</Label>
                    <div className="h-10 px-3 border rounded-md flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        {selectedCampaignId === 'new' ? 'Создание новой кампании' : 'Редактирование существующей'}
                      </span>
                      <Button
                        variant="ghost"
                        className="h-7 px-2"
                        onClick={() => {
                          setSelectedCampaignId('new');
                          setCampaignForm(DEFAULT_CAMPAIGN_FORM);
                          setCampaignRecipientSearch('');
                          setCampaignRecipientOptions([]);
                        }}
                      >
                        Новая
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Название кампании</Label>
                    <Input
                      value={campaignForm.name}
                      onChange={(e) => setCampaignForm((prev) => ({ ...prev, name: e.target.value }))}
                      placeholder="Например: Напоминание о продлении"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Тип уведомления</Label>
                    <Input
                      value={campaignForm.type}
                      onChange={(e) => setCampaignForm((prev) => ({ ...prev, type: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Сегмент получателей</Label>
                    <Select
                      value={campaignForm.segment}
                      onValueChange={(value) => {
                        setCampaignForm((prev) => ({
                          ...prev,
                          segment: value as CampaignFormState['segment'],
                          user_ids: value === 'custom' ? prev.user_ids : [],
                        }));
                        if (value === 'custom') {
                          fetchCampaignRecipients(campaignRecipientSearch);
                        } else {
                          setCampaignRecipientSearch('');
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Все пользователи</SelectItem>
                        <SelectItem value="all_active">Все активные</SelectItem>
                        <SelectItem value="subscription_active">Активные с подпиской</SelectItem>
                        <SelectItem value="with_telegram">Пользователи с Telegram</SelectItem>
                        <SelectItem value="without_subscription">Пользователи без подписки</SelectItem>
                        <SelectItem value="subscription_expiring_7d">{"Подписка истекает <= 7 дней"}</SelectItem>
                        <SelectItem value="custom">Custom (выбрать вручную)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Флаги</Label>
                    <div className="h-10 px-3 border rounded-md flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={campaignForm.only_with_telegram}
                            onCheckedChange={(value) => setCampaignForm((prev) => ({ ...prev, only_with_telegram: value }))}
                          />
                          <span className="text-sm text-muted-foreground">Только с Telegram</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={campaignForm.is_active}
                            onCheckedChange={(value) => setCampaignForm((prev) => ({ ...prev, is_active: value }))}
                          />
                          <span className="text-sm text-muted-foreground">Активна</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Заголовок</Label>
                  <Input
                    value={campaignForm.title}
                    onChange={(e) => setCampaignForm((prev) => ({ ...prev, title: e.target.value }))}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Текст in-app</Label>
                  <Textarea
                    rows={4}
                    value={campaignForm.message}
                    onChange={(e) => setCampaignForm((prev) => ({ ...prev, message: e.target.value }))}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Текст Telegram (опционально)</Label>
                  <Textarea
                    rows={5}
                    value={campaignForm.telegram_message}
                    onChange={(e) => setCampaignForm((prev) => ({ ...prev, telegram_message: e.target.value }))}
                    placeholder="Если пусто — текст соберется автоматически из заголовка и сообщения."
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>CTA URL</Label>
                    <Input
                      value={campaignForm.cta_url}
                      onChange={(e) => setCampaignForm((prev) => ({ ...prev, cta_url: e.target.value }))}
                      placeholder="https://app.performanteaiagency.com/profile"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>CTA Label</Label>
                    <Input
                      value={campaignForm.cta_label}
                      onChange={(e) => setCampaignForm((prev) => ({ ...prev, cta_label: e.target.value }))}
                      placeholder="Открыть"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4 rounded-md border p-3">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={campaignForm.channels.includes('in_app')}
                      onCheckedChange={() => toggleCampaignChannel('in_app')}
                    />
                    <Label>Отправлять in-app</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={campaignForm.channels.includes('telegram')}
                      onCheckedChange={() => toggleCampaignChannel('telegram')}
                    />
                    <Label>Отправлять в Telegram</Label>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-2">
                    <Label>Расписание</Label>
                    <Select
                      value={campaignForm.schedule_mode}
                      onValueChange={(value) => {
                        setCampaignForm((prev) => ({ ...prev, schedule_mode: value as CampaignFormState['schedule_mode'] }));
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="once">Один раз</SelectItem>
                        <SelectItem value="daily">Каждый день</SelectItem>
                        <SelectItem value="weekly">Раз в неделю</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {campaignForm.schedule_mode === 'once' && (
                    <div className="space-y-2 md:col-span-1 lg:col-span-3">
                      <Label>Дата/время запуска (UTC)</Label>
                      <Input
                        type="datetime-local"
                        value={campaignForm.scheduled_at}
                        onChange={(e) => setCampaignForm((prev) => ({ ...prev, scheduled_at: e.target.value }))}
                      />
                    </div>
                  )}

                  {campaignForm.schedule_mode !== 'once' && (
                    <>
                      <div className="space-y-2">
                        <Label>Час (UTC)</Label>
                        <Input
                          type="number"
                          min={0}
                          max={23}
                          value={campaignForm.send_hour_utc}
                          onChange={(e) => setCampaignForm((prev) => ({ ...prev, send_hour_utc: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Минута (UTC)</Label>
                        <Input
                          type="number"
                          min={0}
                          max={59}
                          value={campaignForm.send_minute_utc}
                          onChange={(e) => setCampaignForm((prev) => ({ ...prev, send_minute_utc: e.target.value }))}
                        />
                      </div>
                    </>
                  )}

                  {campaignForm.schedule_mode === 'weekly' && (
                    <div className="space-y-2">
                      <Label>День недели</Label>
                      <Select
                        value={campaignForm.weekly_day}
                        onValueChange={(value) => setCampaignForm((prev) => ({ ...prev, weekly_day: value }))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="0">Воскресенье</SelectItem>
                          <SelectItem value="1">Понедельник</SelectItem>
                          <SelectItem value="2">Вторник</SelectItem>
                          <SelectItem value="3">Среда</SelectItem>
                          <SelectItem value="4">Четверг</SelectItem>
                          <SelectItem value="5">Пятница</SelectItem>
                          <SelectItem value="6">Суббота</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>

                {campaignForm.segment === 'custom' && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Users className="h-4 w-4" />
                        Получатели кампании
                      </CardTitle>
                      <CardDescription>
                        Выбрано: {campaignForm.user_ids.length}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex gap-2">
                        <Input
                          value={campaignRecipientSearch}
                          onChange={(e) => setCampaignRecipientSearch(e.target.value)}
                          placeholder="Поиск по username или telegram_id"
                        />
                        <Button variant="outline" onClick={() => fetchCampaignRecipients(campaignRecipientSearch)}>
                          <RefreshCw className="h-4 w-4 mr-2" />
                          Найти
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => setCampaignForm((prev) => ({ ...prev, user_ids: [] }))}
                        >
                          Сбросить выбор
                        </Button>
                      </div>

                      {loadingCampaignRecipients && (
                        <div className="text-sm text-muted-foreground">Загрузка получателей...</div>
                      )}

                      {!loadingCampaignRecipients && campaignRecipientOptions.length === 0 && (
                        <div className="text-sm text-muted-foreground">Получатели не найдены</div>
                      )}

                      <div className="max-h-64 overflow-auto border rounded-md">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-10"></TableHead>
                              <TableHead>Пользователь</TableHead>
                              <TableHead>Telegram</TableHead>
                              <TableHead>Статус</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {campaignRecipientOptions.map((recipient) => (
                              <TableRow key={recipient.id}>
                                <TableCell>
                                  <Checkbox
                                    checked={campaignForm.user_ids.includes(recipient.id)}
                                    onCheckedChange={() => toggleCampaignRecipient(recipient.id)}
                                  />
                                </TableCell>
                                <TableCell className="font-mono text-xs">
                                  <div>{recipient.username || '—'}</div>
                                  <div className="text-muted-foreground">{recipient.id.slice(0, 8)}...</div>
                                </TableCell>
                                <TableCell>{recipient.telegram_id || '—'}</TableCell>
                                <TableCell>
                                  <Badge variant={recipient.is_active ? 'default' : 'outline'}>
                                    {recipient.is_active ? 'Активен' : 'Неактивен'}
                                  </Badge>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button onClick={saveCampaign} disabled={savingCampaign}>
                    {savingCampaign ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        Сохранение...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" />
                        {selectedCampaignId === 'new' ? 'Создать кампанию' : 'Сохранить кампанию'}
                      </>
                    )}
                  </Button>
                  {selectedCampaignId !== 'new' && (
                    <Button
                      variant="outline"
                      onClick={() => runCampaignNow(selectedCampaignId)}
                      disabled={runningCampaignId === selectedCampaignId}
                    >
                      {runningCampaignId === selectedCampaignId ? 'Выполняется...' : 'Запустить сейчас'}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="xl:col-span-5">
              <CardHeader>
                <CardTitle>История кампаний</CardTitle>
                <CardDescription>
                  Статусы, последние запуски и расписание
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button variant="outline" onClick={fetchCampaigns} disabled={loadingCampaigns}>
                  <RefreshCw className={`h-4 w-4 mr-2 ${loadingCampaigns ? 'animate-spin' : ''}`} />
                  Обновить кампании
                </Button>

                <div className="max-h-[760px] overflow-auto border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Кампания</TableHead>
                        <TableHead>Сегмент</TableHead>
                        <TableHead>Расписание</TableHead>
                        <TableHead>Статус</TableHead>
                        <TableHead>Действия</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {campaigns.map((campaign) => {
                        const isSelected = selectedCampaignId === campaign.id;
                        const lastResult = campaign.last_result && typeof campaign.last_result === 'object'
                          ? campaign.last_result
                          : null;
                        const wasSuccessful = lastResult && (lastResult as Record<string, unknown>).success === true;
                        const hadError = lastResult && (lastResult as Record<string, unknown>).success === false;

                        return (
                          <TableRow
                            key={campaign.id}
                            className={isSelected ? 'bg-primary/5' : undefined}
                          >
                            <TableCell>
                              <div className="font-medium text-sm">{campaign.name}</div>
                              <div className="text-xs text-muted-foreground font-mono">{campaign.type}</div>
                            </TableCell>
                            <TableCell className="text-xs font-mono">{campaign.segment}</TableCell>
                            <TableCell>
                              <div className="text-xs">{formatCampaignSchedule(campaign)}</div>
                              <div className="text-[11px] text-muted-foreground">
                                next: {formatDateTime(campaign.next_run_at)}
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                last: {formatDateTime(campaign.last_run_at)}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant={campaign.is_active ? 'default' : 'outline'}>
                                {campaign.is_active ? 'Активна' : 'Пауза'}
                              </Badge>
                              {wasSuccessful && (
                                <div className="text-[11px] text-emerald-600 mt-1">Последний запуск: success</div>
                              )}
                              {hadError && (
                                <div className="text-[11px] text-red-600 mt-1">Последний запуск: error</div>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-2">
                                <Button
                                  variant="outline"
                                  className="h-8"
                                  onClick={() => setSelectedCampaignId(campaign.id)}
                                >
                                  Редактировать
                                </Button>
                                <Button
                                  variant="outline"
                                  className="h-8"
                                  onClick={() => runCampaignNow(campaign.id)}
                                  disabled={runningCampaignId === campaign.id}
                                >
                                  {runningCampaignId === campaign.id ? 'Запуск...' : 'Run now'}
                                </Button>
                                <Button
                                  variant="outline"
                                  className="h-8"
                                  onClick={() => deleteCampaign(campaign.id)}
                                  disabled={deletingCampaignId === campaign.id}
                                >
                                  {deletingCampaignId === campaign.id ? 'Удаление...' : 'Удалить'}
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {!loadingCampaigns && campaigns.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-muted-foreground">
                            Кампании не найдены
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Фильтры</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
              <Input
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Поиск по типу/тексту"
              />
              <Select value={historyType} onValueChange={setHistoryType}>
                <SelectTrigger>
                  <SelectValue placeholder="Тип уведомления" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все типы</SelectItem>
                  {availableTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                  <SelectItem value="admin_broadcast">admin_broadcast</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={fetchHistory}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Обновить историю
              </Button>
            </CardContent>
          </Card>

          <Tabs value={historyView} onValueChange={(value) => setHistoryView(value as 'user' | 'delivery')}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="user">User notifications</TabsTrigger>
              <TabsTrigger value="delivery">Delivery history</TabsTrigger>
            </TabsList>

            <TabsContent value="user">
              <Card>
                <CardHeader>
                  <CardTitle>Фактические уведомления (in-app)</CardTitle>
                  <CardDescription>
                    Таблица `user_notifications` — что реально увидит пользователь в приложении
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {loadingHistory ? (
                    <div className="text-sm text-muted-foreground">Загрузка...</div>
                  ) : (
                    <div className="max-h-[600px] overflow-auto border rounded-md">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Дата</TableHead>
                            <TableHead>Пользователь</TableHead>
                            <TableHead>Тип</TableHead>
                            <TableHead>Заголовок</TableHead>
                            <TableHead>Telegram</TableHead>
                            <TableHead>Read</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {notificationHistory.map((item) => (
                            <TableRow key={item.id}>
                              <TableCell className="text-xs whitespace-nowrap">{formatDateTime(item.created_at)}</TableCell>
                              <TableCell>
                                <div className="text-sm">{item.user?.username || '—'}</div>
                                <div className="text-xs text-muted-foreground">{item.user?.telegram_id || ''}</div>
                              </TableCell>
                              <TableCell className="font-mono text-xs">{item.type}</TableCell>
                              <TableCell>
                                <div className="font-medium text-sm">{item.title}</div>
                                <div className="text-xs text-muted-foreground line-clamp-2">{item.message}</div>
                              </TableCell>
                              <TableCell>
                                <Badge variant={item.telegram_sent ? 'default' : 'outline'}>
                                  {item.telegram_sent ? 'sent' : 'no'}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Badge variant={item.is_read ? 'default' : 'secondary'}>
                                  {item.is_read ? 'read' : 'unread'}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                          {notificationHistory.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={6} className="text-center text-muted-foreground">
                                Записей нет
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="delivery">
              <Card>
                <CardHeader>
                  <CardTitle>Журнал доставок</CardTitle>
                  <CardDescription>
                    Таблица `notification_history` — учитывает и telegram-only отправки
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {loadingHistory ? (
                    <div className="text-sm text-muted-foreground">Загрузка...</div>
                  ) : (
                    <div className="max-h-[600px] overflow-auto border rounded-md">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Дата</TableHead>
                            <TableHead>Пользователь</TableHead>
                            <TableHead>Тип</TableHead>
                            <TableHead>Канал</TableHead>
                            <TableHead>in-app</TableHead>
                            <TableHead>tg</TableHead>
                            <TableHead>Preview</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {deliveryHistory.map((item) => (
                            <TableRow key={item.id}>
                              <TableCell className="text-xs whitespace-nowrap">{formatDateTime(item.created_at)}</TableCell>
                              <TableCell>
                                <div className="text-sm">{item.user?.username || '—'}</div>
                                <div className="text-xs text-muted-foreground">{item.user?.telegram_id || ''}</div>
                              </TableCell>
                              <TableCell className="font-mono text-xs">{item.notification_type}</TableCell>
                              <TableCell>{item.channel}</TableCell>
                              <TableCell>
                                <Badge variant={item.in_app_created ? 'default' : 'outline'}>
                                  {item.in_app_created ? 'yes' : 'no'}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Badge variant={item.telegram_sent ? 'default' : 'outline'}>
                                  {item.telegram_sent ? 'yes' : 'no'}
                                </Badge>
                              </TableCell>
                              <TableCell className="max-w-[320px]">
                                <div className="text-xs text-muted-foreground line-clamp-2">
                                  {item.message_preview || '—'}
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                          {deliveryHistory.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={7} className="text-center text-muted-foreground">
                                Записей нет
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AdminNotificationsCenter;
