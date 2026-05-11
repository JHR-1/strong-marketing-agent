/**
 * Strong Recruitment Group — Marketing Agent
 *
 * Entry point: boots Express, starts the Telegram bot, and registers
 * the monthly cron job (default 09:00 on the 20th).
 */

require('dotenv').config();

const express = require('express');
const cron = require('node-cron');
const path = require('path');

const { env } = require('./config');
const logger = require('./utils/logger');
const storage = require('./utils/storage');

const calendar = require('./services/calendar');
const imageGen = require('./services/imageGen');
const zernio = require('./services/zernio');
const TelegramService = require('./services/telegram');

const statusRoutes = require('./routes/status');
const triggerRoutesFactory = require('./routes/trigger');

async function main() {
  // Init DB eagerly (creates tables if needed)
  storage.getDb();

  // Boot Telegram (polling)
  const telegram = new TelegramService({ zernio });
  telegram.start();

  // Express
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // Serve generated images so Zernio can fetch them via PUBLIC_BASE_URL
  app.use(
    '/images',
    express.static(path.resolve(env.dataDir, 'images'), {
      maxAge: '7d',
      fallthrough: true
    })
  );

  app.use('/', statusRoutes);
  app.use('/', triggerRoutesFactory({ telegram }));

  app.get('/', (req, res) => {
    res.json({
      ok: true,
      service: 'strong-marketing-agent',
      version: require('../package.json').version,
      tz: env.tz,
      cron: env.calendarCron
    });
  });

  app.use((err, req, res, _next) => {
    logger.error({ err: err.message, stack: err.stack }, 'unhandled error');
    res.status(500).json({ ok: false, error: err.message });
  });

  app.listen(env.port, () => {
    logger.info(
      { port: env.port, tz: env.tz, cron: env.calendarCron },
      'Marketing agent listening'
    );
  });

  // Cron: monthly calendar generation
  if (cron.validate(env.calendarCron)) {
    cron.schedule(
      env.calendarCron,
      async () => {
        logger.info('Cron fired: generating next month calendar');
        try {
          await calendar.generateCalendarForUpcomingMonth({
            imageGen,
            telegram
          });
          await telegram.sendInfo(
            'Monthly content calendar generated. Approve each post above.'
          );
        } catch (err) {
          logger.error({ err: err.message }, 'cron generate failed');
          await telegram.sendInfo(
            `Calendar generation failed: ${err.message}`
          );
        }
      },
      { timezone: env.tz }
    );
    logger.info({ cron: env.calendarCron, tz: env.tz }, 'Cron scheduled');
  } else {
    logger.error({ cron: env.calendarCron }, 'Invalid CALENDAR_CRON expression');
  }

  // Graceful shutdown
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
  process.on('unhandledRejection', (err) =>
    logger.error({ err }, 'unhandledRejection')
  );
  process.on('uncaughtException', (err) =>
    logger.error({ err: err.message, stack: err.stack }, 'uncaughtException')
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err);
  process.exit(1);
});
