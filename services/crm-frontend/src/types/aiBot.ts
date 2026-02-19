export type AIModel =
  | 'gpt-5.2' | 'gpt-5.1' | 'gpt-5' | 'gpt-5-mini' | 'gpt-5-nano'
  | 'gpt-4.1' | 'gpt-4.1-mini' | 'gpt-4.1-nano'
  | 'gpt-4o' | 'gpt-4o-mini' | 'gpt-o3';

export type VoiceResponseMode = 'never' | 'on_voice' | 'always';
export type FileHandlingMode = 'ignore' | 'respond';

export type OffHoursBehavior = 'send_immediately' | 'next_day_at_time' | 'skip';

export interface DelayedMessage {
  hours: number;           // 0-23
  minutes: number;         // 0-59
  prompt: string;          // mini prompt для генерации LLM
  repeatCount?: number;    // 1-10, default 1
  offHoursBehavior?: OffHoursBehavior; // default 'next_day_at_time'
  offHoursTime?: string;   // optional
}

export interface ConsultationIntegrationSettings {
  consultantIds: string[];           // пустой = все консультанты
  slotsToShow: number;               // кол-во слотов для показа (3-10)
  defaultDurationMinutes: number;    // длительность консультации (30, 60, 90, 120)
  daysAheadLimit: number;            // дней вперёд для поиска (7, 14, 30)
  autoSummarizeDialog: boolean;      // авто-саммаризация диалога
  collectClientName: boolean;        // спрашивать имя если нет
}

export const DEFAULT_CONSULTATION_SETTINGS: ConsultationIntegrationSettings = {
  consultantIds: [],
  slotsToShow: 5,
  defaultDurationMinutes: 60,
  daysAheadLimit: 14,
  autoSummarizeDialog: true,
  collectClientName: true
};

export interface AIBotConfiguration {
  id: string;
  userAccountId: string;

  // Основные настройки
  name: string;
  isActive: boolean;

  // Инструкция для AI
  systemPrompt: string;
  temperature: number;

  // Выбор модели
  model: AIModel;

  // Оптимизация истории диалога
  historyTokenLimit: number;
  historyMessageLimit: number | null;
  historyTimeLimitHours: number | null;

  // Контроль вмешательства оператора
  operatorPauseEnabled: boolean;
  operatorPauseIgnoreFirstMessage: boolean;
  operatorAutoResumeHours: number;
  operatorAutoResumeMinutes: number;
  operatorPauseExceptions: string[];

  // Управление диалогом по ключевым фразам
  stopPhrases: string[];
  resumePhrases: string[];

  // Буфер сообщений
  messageBufferSeconds: number;

  // Деление сообщений
  splitMessages: boolean;
  splitMaxLength: number;

  // Лимиты расходов
  dailyCostLimitCents: number | null;
  userCostLimitCents: number | null;

  // Форматирование текста
  adaptiveFormatting: boolean;
  cleanMarkdown: boolean;

  // Дата и время
  passCurrentDatetime: boolean;
  timezone: string;

  // Расписание работы агента
  scheduleEnabled: boolean;
  scheduleHoursStart: number;
  scheduleHoursEnd: number;
  scheduleDays: number[];

  // Голосовые сообщения
  voiceRecognitionEnabled: boolean;
  voiceRecognitionModel: string;
  voiceResponseMode: VoiceResponseMode;
  voiceDefaultResponse: string;

  // Изображения
  imageRecognitionEnabled: boolean;
  imageDefaultResponse: string;
  imageSendFromLinks: boolean;

  // Документы
  documentRecognitionEnabled: boolean;
  documentDefaultResponse: string;
  documentSendFromLinks: boolean;

  // Файлы
  fileHandlingMode: FileHandlingMode;
  fileDefaultResponse: string;

  // Отложенная отправка
  delayedMessages: DelayedMessage[];
  delayedScheduleEnabled: boolean;
  delayedScheduleHoursStart: number;
  delayedScheduleHoursEnd: number;
  delayedStopOnConsultation: boolean;

  // Сообщения
  startMessage: string;
  errorMessage: string;

  // Свой API ключ
  customOpenaiApiKey: string | null;

  // Интеграция с консультациями
  consultationIntegrationEnabled: boolean;
  consultationSettings: ConsultationIntegrationSettings;

  // Метаданные
  createdAt: string;
  updatedAt: string;
}

export interface AIBotFunction {
  id: string;
  botId: string;
  name: string;
  description: string;
  parameters: Record<string, any>;
  handlerType: 'webhook' | 'internal' | 'forward_to_manager';
  handlerConfig: Record<string, any>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBotRequest {
  userAccountId: string;
  name?: string;
  systemPrompt?: string;
  temperature?: number;
  model?: AIModel;
}

export type UpdateBotRequest = Partial<Omit<AIBotConfiguration, 'id' | 'userAccountId' | 'createdAt' | 'updatedAt'>>;

export interface CreateFunctionRequest {
  name: string;
  description: string;
  parameters?: Record<string, any>;
  handlerType: 'webhook' | 'internal' | 'forward_to_manager';
  handlerConfig?: Record<string, any>;
  isActive?: boolean;
}

export type UpdateFunctionRequest = Partial<CreateFunctionRequest>;

// Model info for UI
export interface ModelInfo {
  id: AIModel;
  name: string;
  description: string;
  inputCost: string;
  outputCost: string;
}

export const AI_MODELS: ModelInfo[] = [
  { id: 'gpt-5.2', name: 'GPT-5.2', description: 'Самая новая и мощная модель', inputCost: '0.5', outputCost: '2' },
  { id: 'gpt-5.1', name: 'GPT-5.1', description: 'Улучшенная версия GPT-5', inputCost: '0.4', outputCost: '1.6' },
  { id: 'gpt-5', name: 'GPT-5', description: 'Базовая модель пятого поколения', inputCost: '0.35', outputCost: '1.4' },
  { id: 'gpt-5-mini', name: 'GPT-5 Mini', description: 'Быстрая и экономичная', inputCost: '0.15', outputCost: '0.6' },
  { id: 'gpt-5-nano', name: 'GPT-5 Nano', description: 'Самая быстрая', inputCost: '0.05', outputCost: '0.2' },
  { id: 'gpt-4.1', name: 'GPT-4.1', description: 'Версия от 14.04.2025', inputCost: '0.3', outputCost: '1.2' },
  { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', description: 'Версия от 14.04.2025', inputCost: '0.1', outputCost: '0.4' },
  { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', description: 'Версия от 14.04.2025', inputCost: '0.03', outputCost: '0.12' },
  { id: 'gpt-4o', name: 'GPT-4o', description: 'Стабильная, проверенная временем модель', inputCost: '0.25', outputCost: '1' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Версия от 18.07.2024', inputCost: '0.08', outputCost: '0.32' },
  { id: 'gpt-o3', name: 'GPT-o3', description: 'Версия от 16.04.2025', inputCost: '0.6', outputCost: '2.4' },
];

// Timezone options
export const TIMEZONES = [
  { value: 'Europe/Moscow', label: 'Москва (UTC+3)' },
  { value: 'Asia/Yekaterinburg', label: 'Екатеринбург (UTC+5)' },
  { value: 'Asia/Almaty', label: 'Алматы (UTC+6)' },
  { value: 'Asia/Novosibirsk', label: 'Новосибирск (UTC+7)' },
  { value: 'Asia/Vladivostok', label: 'Владивосток (UTC+10)' },
  { value: 'Europe/Kaliningrad', label: 'Калининград (UTC+2)' },
  { value: 'Asia/Tashkent', label: 'Ташкент (UTC+5)' },
  { value: 'Asia/Bishkek', label: 'Бишкек (UTC+6)' },
];

// Days of week for schedule
export const DAYS_OF_WEEK = [
  { value: 1, label: 'Пн' },
  { value: 2, label: 'Вт' },
  { value: 3, label: 'Ср' },
  { value: 4, label: 'Чт' },
  { value: 5, label: 'Пт' },
  { value: 6, label: 'Сб' },
  { value: 7, label: 'Вс' },
];
