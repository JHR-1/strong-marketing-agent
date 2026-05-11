/**
 * Manual / admin trigger endpoints.
 *
 * Protected by an optional `TRIGGER_SECRET` env var which must be sent
 * as `?secret=...` or in the `x-trigger-secret` header.
 */

const express = require('express');
const { env, BRAND, toZernioPlatforms } = require('../config');
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
  // Posts can include image_url directly (public URL) to skip upload step.
  router.post('/seed-calendar', async (req, res) => {
    try {
      const { monthKey, posts = [], blogs = [] } = req.body;

      if (!monthKey) {
        return res.status(400).json({ ok: false, error: 'monthKey is required' });
      }

      // Delete existing data for this month first
      storage.deletePostsForMonth(monthKey);
      storage.deleteBlogsForMonth(monthKey);

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

      res.json({ ok: true, calendarId, postsInserted, blogsInserted });
    } catch (err) {
      logger.error({ err: err.message }, 'seed-calendar failed');
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Schedule all posts that have images attached.
  // POST /schedule-all
  router.post('/schedule-all', async (req, res) => {
    try {
      const monthKey = storage.getSetting('last_calendar_month');
      if (!monthKey) {
        return res.status(400).json({ ok: false, error: 'No active calendar' });
      }

      const posts = storage.listPostsByMonth(monthKey);
      const missing = posts.filter((p) => !p.image_url);
      if (missing.length) {
        return res.status(400).json({
          ok: false,
          error: `Missing images for posts: ${missing.map((p) => p.post_number).join(', ')}`
        });
      }

      const blogs = storage.listBlogsByMonth(monthKey);
      const blogsById = new Map(blogs.map((b) => [b.id, b]));

      let okCount = 0;
      const failures = [];

      for (const p of posts) {
        if (p.status === 'scheduled') {
          okCount++;
          continue;
        }
        try {
          storage.updatePost(p.id, { status: 'scheduling', schedule_error: null });

          // Build caption
          let body = p.caption || '';
          const hashtags = (p.hashtags || []).join(' ');

          if (p.kind === 'blog_promo' && p.blog_id) {
            const blog = blogsById.get(p.blog_id);
            const url = blog?.url || BRAND.blog.siteBaseUrl;
            body = body.replace(/<BLOG_URL>/g, url);
            if (!/https?:\/\//.test(body)) body += `\n\n${url}`;
          }

          const caption = [body, hashtags].filter(Boolean).join('\n\n').trim();

          const result = await zernio.schedulePost({
            caption,
            scheduledForIso: p.scheduled_for,
            platforms: p.platforms && p.platforms.length
              ? p.platforms
              : BRAND.defaultPlatforms,
            imageUrl: p.image_url,
            timezone: env.tz
          });

          const zernioId =
            result?.id || result?.postId || result?.data?.id || null;
          storage.updatePost(p.id, {
            status: 'scheduled',
            zernio_post_id: zernioId
          });
          okCount++;
        } catch (err) {
          logger.error(
            { err: err.message, postNumber: p.post_number },
            'Schedule failed for post'
          );
          storage.updatePost(p.id, {
            status: 'schedule_failed',
            schedule_error: err.message
          });
          failures.push({ number: p.post_number, error: err.message });
        }
      }

      if (!failures.length) {
        storage.updateCalendarStatus(monthKey, 'scheduled');
        res.json({ ok: true, scheduled: okCount, total: posts.length });
      } else {
        res.json({
          ok: false,
          scheduled: okCount,
          total: posts.length,
          failures
        });
      }
    } catch (err) {
      logger.error({ err: err.message }, 'schedule-all failed');
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
