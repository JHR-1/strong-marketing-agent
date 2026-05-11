/**
 * Manual / admin trigger endpoints.
 *
 * Protected by an optional `TRIGGER_SECRET` env var which must be sent
 * as `?secret=...` or in the `x-trigger-secret` header.
 */

const express = require('express');
const { env } = require('../config');
const zernio = require('../services/zernio');
const logger = require('../utils/logger');
const storage = require('../utils/storage');

function makeRouter({ telegram, calendar }) {
  const router = express.Router();

  router.use((req, res, next) => {
    if (!env.triggerSecret) return next();
    const provided = req.query.secret || req.get('x-trigger-secret') || '';
    if (provided !== env.triggerSecret) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    next();
  });

  // Manually generate next month's calendar (or override with ?lookahead=N).
  // Note: the agent no longer auto-generates images; this only plans the
  // content. The user still needs to send images via Telegram and call
  // /schedule (or POST /schedule-all here).
  router.post('/generate-calendar', async (req, res) => {
    const lookaheadMonths =
      parseInt(req.query.lookahead, 10) || env.calendarLookaheadMonths;
    res.json({ ok: true, accepted: true, lookaheadMonths });
    try {
      const result = await calendar.generateCalendarForUpcomingMonth({
        lookaheadMonths
      });
      if (telegram) {
        await telegram.sendInfo(
          `📅 Next month's calendar (${result.monthName} ${result.year}) is ready.`
        );
        await telegram._sendCalendar(env.telegramChatId, result);
      }
    } catch (err) {
      logger.error({ err: err.message }, 'manual generate-calendar failed');
      if (telegram) {
        await telegram.sendInfo(`Calendar generation failed: ${err.message}`);
      }
    }
  });

  // Restore calendar data without re-running /generate.
  // Body: { monthKey, posts[], blogs[] }
  router.post('/seed-calendar', async (req, res) => {
    try {
      const { monthKey, posts = [], blogs = [] } = req.body;

      if (!monthKey) {
        return res.status(400).json({ ok: false, error: 'monthKey is required' });
      }

      const calendarId = storage.saveCalendar(monthKey, { monthKey, posts, blogs });

      let postsInserted = 0;
      for (const post of posts) {
        storage.insertPost({ ...post, calendar_id: calendarId, month_key: monthKey });
        postsInserted++;
      }

      let blogsInserted = 0;
      for (const blog of blogs) {
        storage.insertBlog({ ...blog, calendar_id: calendarId, month_key: monthKey });
        blogsInserted++;
      }

      storage.setSetting('last_calendar_month', monthKey);

      res.json({ ok: true, postsInserted, blogsInserted });
    } catch (err) {
      logger.error({ err: err.message }, 'seed-calendar failed');
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Sanity check Zernio connection
  router.get('/zernio/accounts', async (req, res) => {
    try {
      const data = await zernio.listAccounts();
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Send a test Telegram message
  router.post('/telegram/test', async (req, res) => {
    if (!telegram) {
      return res.status(503).json({ ok: false, error: 'telegram disabled' });
    }
    await telegram.sendInfo('Test message from Strong Marketing Agent.');
    res.json({ ok: true });
  });

  return router;
}

module.exports = makeRouter;
