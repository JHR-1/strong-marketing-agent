require('dotenv').config();

const companies = require('./companies');
const BRAND = require('./brand'); // legacy default-company brand
const PLATFORMS = require('./platforms');
const PROMPTS = require('./prompts'); // legacy default-company prompts

const env = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  tz: process.env.TZ || 'Europe/London',

  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiBaseUrl: process.env.OPENAI_BASE_URL || '',
  openaiTextModel: process.env.OPENAI_TEXT_MODEL || 'gpt-4.1',

  zernioApiKey: process.env.ZERNIO_API_KEY,
  zernioBaseUrl: process.env.ZERNIO_BASE_URL || 'https://zernio.com/api/v1',
  // Legacy single-company Zernio profile id. Kept so any code path
  // that hasn't been migrated yet still has a value, but per-company
  // profile ids are the source of truth now.
  zernioProfileId: process.env.ZERNIO_PROFILE_ID || '69c00b0b467c216082612e75',

  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,

  calendarCron: process.env.CALENDAR_CRON || '0 9 20 * *',
  calendarLookaheadMonths: parseInt(
    process.env.CALENDAR_LOOKAHEAD_MONTHS || '1',
    10
  ),

  dataDir: process.env.DATA_DIR || './data',

  // Supabase (replaces the previous SQLite store).
  // Use the SERVICE ROLE key — this app is server-side only.
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY || '',

  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:3000',
  triggerSecret: process.env.TRIGGER_SECRET || '',

  defaultCompanySlug: companies.DEFAULT_COMPANY_SLUG
};

module.exports = {
  // Legacy single-company aliases (resolve to the DEFAULT company so
  // existing imports keep working).
  BRAND,
  ...PLATFORMS,
  PROMPTS,
  env,

  // Multi-company registry.
  companies,
  getCompany: companies.getCompany,
  getCompanyOrThrow: companies.getCompanyOrThrow,
  getDefaultCompany: companies.getDefaultCompany,
  listCompanies: companies.listCompanies
};
