import 'dotenv/config';

export const config = {
  // Telegram Bot
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    webhookUrl: process.env.WEBHOOK_URL || ''
  },

  // OpenAI
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
  },

  // Server
  server: {
    port: parseInt(process.env.PORT || '8086'),
    host: process.env.HOST || '0.0.0.0',
    nodeEnv: process.env.NODE_ENV || 'development'
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info'
  }
};

// Валидация критичных переменных
export function validateConfig(): void {
  const required = [
    { name: 'TELEGRAM_BOT_TOKEN', value: config.telegram.botToken },
    { name: 'OPENAI_API_KEY', value: config.openai.apiKey }
  ];

  const missing = required.filter(({ value }) => !value);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.map(m => m.name).join(', ')}`
    );
  }
}
