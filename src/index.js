/**
 * Strong / Zentra Marketing Agent — multi-company entry point.
 *
 * Boots:
 *   - Express (health + status + manual triggers)
 *   - The Telegram bot (polling) with /company switching
 *   - The monthly cron job (default 09:00 on the 20th, Europe/London)
 *     which now iterates over EVERY configured company and sends each
 *     calendar to Telegram in turn.
 */

require('dotenv').config();

const express = require('express');
const cron = require('node-cron');
const path = require('path');

const { env, listCompanies } = require('./config');
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
      service: 'marketing-agent',
      version: require('../package.json').version,
      tz: env.tz,
      cron: env.calendarCron,
      companies: listCompanies().map((c) => ({
        slug: c.slug,
        displayName: c.displayName,
        platforms: Object.keys(c.platforms),
        zernioProfileId: c.zernio.profileId
      })),
      defaultCompany: env.defaultCompanySlug
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

  // Cron: monthly calendar generation for ALL companies.
  if (cron.validate(env.calendarCron)) {
    cron.schedule(
      env.calendarCron,
      async () => {
        const all = listCompanies();
        logger.info(
          { count: all.length, slugs: all.map((c) => c.slug) },
          'Cron fired: generating next month calendars for all companies'
        );
        for (const company of all) {
          try {
            await telegram.sendInfo(
              `📅 Generating <b>${company.displayName}</b>'s calendar for the upcoming month…`
            );
            const result = await calendar.generateCalendarForUpcomingMonth({
              company
            });
            await telegram.sendInfo(
              `${company.displayName} — ${result.monthName} ${result.year} calendar is ready.`
            );
            await telegram._sendCalendar(
              env.telegramChatId,
              result,
              company
            );
          } catch (err) {
            logger.error(
              { err: err.message, company: company.slug },
              'cron generate failed for company'
            );
            await telegram.sendInfo(
              `Calendar generation failed for ${company.displayName}: ${err.message}`
            );
          }
        }
        try {
          await telegram.sendInfo(
            'All company calendars sent. Create each image in ChatGPT 5.5 and send them here. ' +
              'Use /company &lt;slug&gt; to switch between companies, then attach images and run /schedule per company.'
          );
        } catch (_) {
          /* ignore */
        }
      },
      { timezone: env.tz }
    );
    logger.info(
      { cron: env.calendarCron, tz: env.tz },
      'Cron scheduled (multi-company)'
    );
  } else {
    logger.error(
      { cron: env.calendarCron },
      'Invalid CALENDAR_CRON expression'
    );
  }

  // Graceful shutdown
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
  process.on('unhandledRejection', (err) =>
    logger.error({ err }, 'unhandledRejection')
  );
  process.on('uncaughtException', (err) =>
    logger.error(
      { err: err.message, stack: err.stack },
      'uncaughtException'
    )
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err);
  process.exit(1);
});
