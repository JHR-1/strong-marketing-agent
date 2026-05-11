/**
 * Strong Recruitment Group — Marketing Agent
 *
 * Entry point. Boots:
 *   - Express (health + status + manual triggers)
 *   - The Telegram bot (polling)
 *   - The monthly cron job (default 09:00 on the 20th, Europe/London)
 *
 * Workflow (high-level):
 *   /generate (Telegram or cron) -> calendar planned (12 social + 2 blog)
 *   user uploads images via Telegram, matches to post numbers
 *   /schedule -> all posts scheduled on Zernio across 5 channels
 */

require('dotenv').config();

const express = require('express');
const cron = require('node-cron');
const path = require('path');

const { env } = require('./config');
const logger = require('./utils/logger');
const storage = require('./utils/storage');

const calendar = require('./services/calendar');
const zernio = require('./services/zernio');
const TelegramService = require('./services/telegram');

const statusRoutes = require('./routes/status');
const triggerRoutesFactory = require('./routes/trigger');

async function main() {
  // Probe Supabase connectivity early so misconfiguration fails fast.
  await storage.getDb();

  // Boot Telegram (polling)
  const telegram = new TelegramService({ zernio, calendar });
  telegram.start();

  // Express
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // Serve user-uploaded images so Zernio can fetch them.
  app.use(
    '/images',
    express.static(path.resolve(env.dataDir, 'images'), {
      maxAge: '30d',
      fallthrough: true
    })
  );

  app.use('/', statusRoutes);
  app.use('/', triggerRoutesFactory({ telegram, calendar }));

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

  // Cron: monthly calendar generation (planning only — user still
  // needs to send images and run /schedule).
  if (cron.validate(env.calendarCron)) {
    cron.schedule(
      env.calendarCron,
      async () => {
        logger.info('Cron fired: generating next month calendar');
        try {
          const result = await calendar.generateCalendarForUpcomingMonth();
          await telegram.sendInfo(
            `📅 Next month's calendar (${result.monthName} ${result.year}) is ready — sending it now.`
          );
          // Re-use the same render path the /calendar command uses.
          await telegram._sendCalendar(env.telegramChatId, result);
          await telegram.sendInfo(
            'Create each image in ChatGPT 5.5 and send them here. ' +
              'When all images are attached, run /schedule.'
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
