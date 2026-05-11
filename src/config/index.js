require('dotenv').config();

const BRAND = require('./brand');
const PLATFORMS = require('./platforms');
const PROMPTS = require('./prompts');

const env = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  tz: process.env.TZ || 'Europe/London',

  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiTextModel: process.env.OPENAI_TEXT_MODEL || 'gpt-4.1',
  openaiImageModel: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',

  zernioApiKey: process.env.ZERNIO_API_KEY,
  zernioBaseUrl: process.env.ZERNIO_BASE_URL || 'https://zernio.com/api/v1',

  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,

  calendarCron: process.env.CALENDAR_CRON || '0 9 20 * *',
  calendarLookaheadMonths: parseInt(
    process.env.CALENDAR_LOOKAHEAD_MONTHS || '1',
    10
  ),

  dataDir: process.env.DATA_DIR || './data',
  dbFile: process.env.DB_FILE || './data/agent.db',

  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:3000',
  triggerSecret: process.env.TRIGGER_SECRET || ''
};

module.exports = {
  BRAND,
  ...PLATFORMS,
  PROMPTS,
  env
};
