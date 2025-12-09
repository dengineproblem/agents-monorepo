/**
 * Telegram Onboarding Module
 *
 * Модуль для онбординга пользователей через Telegram бота
 *
 * @example
 * import { handleOnboardingMessage, isInOnboarding } from './lib/telegramOnboarding';
 *
 * // В webhook обработчике
 * const result = await handleOnboardingMessage(message);
 * if (result.handled) {
 *   // Сообщение обработано как онбординг
 *   return;
 * }
 * // Иначе обрабатываем как обычное сообщение
 */

// Главный обработчик
export { handleOnboardingMessage, isInOnboarding, type TelegramMessage } from './handlers.js';

// State machine функции (для расширенного использования)
export {
  getSession,
  getOrCreateSession,
  startOnboarding,
  processAnswer,
  skipStep,
  goBack,
  showStatus,
  resetSession,
  type OnboardingSession,
  type TelegramUser,
  type BotResponse,
} from './stateMachine.js';

// Транскрипция голоса
export { transcribeVoiceMessage, type TelegramVoice, type TranscriptionResult } from './voiceHandler.js';

// Генерация credentials
export {
  generateUsername,
  generatePassword,
  generateUniqueUsername,
  createUserFromOnboarding,
  buildFacebookOAuthUrl,
  formatCompletionMessage,
  type OnboardingAnswers,
  type CreateUserResult,
} from './credentialsGenerator.js';

// Шаги онбординга
export {
  ONBOARDING_STEPS,
  WELCOME_MESSAGE,
  getStep,
  getNextStep,
  canSkipStep,
  normalizePriceSegment,
  parseCompetitorInstagrams,
  formatQuestionMessage,
  formatProgressMessage,
  type OnboardingStep,
} from './steps.js';
