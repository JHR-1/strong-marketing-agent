/**
 * Manual / admin trigger endpoints — multi-company aware.
 *
 * Protected by an optional `TRIGGER_SECRET` env var which must be sent
 * as `?secret=...` or in the `x-trigger-secret` header.
 *
 * Every endpoint that operates on per-company data accepts a `company`
 * parameter (query string OR request body) and falls back to the
 * default company (`strong`) when omitted, preserving the original
 * single-company behaviour.
 */

const express = require('express');
const {
  env,
  getCompany,
  getDefaultCompany,
  listCompanies
} = require('../config');
const zernio = require('../services/zernio');
const logger = require('../utils/logger');
const storage = require('../utils/storage');

function resolveCompany(req) {
  const raw =
    (req.query && (req.query.company || req.query.companySlug)) ||
    (req.body && (req.body.company || req.body.companySlug));
  if (!raw) return getDefaultCompany();
  const c = getCompany(raw);
  if (!c) {
    const known = listCompanies()
      .map((x) => x.slug)
      .join(', ');
    const err = new Error(`Unknown company "${raw}". Known: ${known}`);
    err.status = 400;
    throw err;
  }
  return c;
}

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

  // List known companies.
  router.get('/companies', (req, res) => {
    res.json({
      ok: true,
      defaultCompany: env.defaultCompanySlug,
      companies: listCompanies().map((c) => ({
        slug: c.slug,
        displayName: c.displayName,
        platforms: Object.keys(c.platforms),
        zernioProfileId: c.zernio.profileId,
        monthly: c.monthly
      }))
    });
  });

  // Manually generate next month's calendar for one company (or all).
  //   POST /generate-calendar?company=zentra&lookahead=1
  //   POST /generate-calendar?company=all
  router.post('/generate-calendar', async (req, res) => {
    const lookaheadMonths =
      parseInt(req.query.lookahead, 10) || env.calendarLookaheadMonths;

    const rawCompany =
      (req.query && req.query.company) ||
      (req.body && req.body.company) ||
      '';
    const all = rawCompany && rawCompany.toLowerCase() === 'all';

    let targets;
    try {
      targets = all ? listCompanies() : [resolveCompany(req)];
    } catch (err) {
      return res
        .status(err.status || 400)
        .json({ ok: false, error: err.message });
    }

    res.json({
      ok: true,
      accepted: true,
      lookaheadMonths,
      companies: targets.map((c) => c.slug)
    });

    for (const company of targets) {
      try {
        const result = await calendar.generateCalendarForUpcomingMonth({
          lookaheadMonths,
          company
        });
        if (telegram) {
          await telegram.sendInfo(
            `📅 ${company.displayName}'s next calendar (${result.monthName} ${result.year}) is ready.`
          );
          await telegram._sendCalendar(env.telegramChatId, result, company);
        }
      } catch (err) {
        logger.error(
          { err: err.message, company: company.slug },
          'manual generate-calendar failed'
        );
        if (telegram) {
          await telegram.sendInfo(
            `Calendar generation failed for ${company.displayName}: ${err.message}`
          );
        }
      }
    }
  });

  // Restore calendar data without re-running /generate.
  //   POST /seed-calendar  { company, monthKey, posts[], blogs[] }
  router.post('/seed-calendar', async (req, res) => {
    try {
      const company = resolveCompany(req);
      const { monthKey, posts = [], blogs = [] } = req.body;

      if (!monthKey) {
        return res
          .status(400)
          .json({ ok: false, error: 'monthKey is required' });
      }

      await storage.deletePostsForMonth(monthKey, company.slug);
      await storage.deleteBlogsForMonth(monthKey, company.slug);

      const calendarId = await storage.saveCalendar(
        monthKey,
        { monthKey, posts, blogs },
        'awaiting_images',
        company.slug
      );

      let postsInserted = 0;
      for (const post of posts) {
        await storage.insertPost({
          ...post,
          company: company.slug,
          calendar_id: calendarId,
          month_key: monthKey
        });
        postsInserted++;
      }

      let blogsInserted = 0;
      for (const blog of blogs) {
        await storage.insertBlog({
          ...blog,
          company: company.slug,
          calendar_id: calendarId,
          month_key: monthKey
        });
        blogsInserted++;
      }

      await storage.setCompanySetting(
        'last_calendar_month',
        monthKey,
        company.slug
      );

      res.json({
        ok: true,
        company: company.slug,
        calendarId,
        postsInserted,
        blogsInserted
      });
    } catch (err) {
      logger.error({ err: err.message }, 'seed-calendar failed');
      res.status(err.status || 500).json({ ok: false, error: err.message });
    }
  });

  // Schedule all posts that have images attached for a company.
  //   POST /schedule-all?company=zentra
  router.post('/schedule-all', async (req, res) => {
    try {
      const company = resolveCompany(req);
      const monthKey = await storage.getCompanySetting(
        'last_calendar_month',
        company.slug
      );
      if (!monthKey) {
        return res.status(400).json({
          ok: false,
          error: `No active calendar for ${company.displayName}`
        });
      }

      const posts = await storage.listPostsByMonth(monthKey, company.slug);
      const missing = posts.filter((p) => !p.image_url);
      if (missing.length) {
        return res.status(400).json({
          ok: false,
          error: `Missing images for posts: ${missing
            .map((p) => p.post_number)
            .join(', ')}`
        });
      }

      const blogs = await storage.listBlogsByMonth(monthKey, company.slug);
      const blogsById = new Map(blogs.map((b) => [b.id, b]));

      let okCount = 0;
      const failures = [];

      for (const p of posts) {
        if (p.status === 'scheduled') {
          okCount++;
          continue;
        }
        try {
          await storage.updatePost(p.id, {
            status: 'scheduling',
            schedule_error: null
          });

          let body = p.caption || '';
          const hashtags = (p.hashtags || []).join(' ');

          if (p.kind === 'blog_promo' && p.blog_id) {
            const blog = blogsById.get(p.blog_id);
            const url = blog?.url || company.brand.blog?.siteBaseUrl || '';
            body = body.replace(/<BLOG_URL>/g, url);
            if (url && !/https?:\/\//.test(body)) body += `\n\n${url}`;
          }

          const caption = [body, hashtags]
            .filter(Boolean)
            .join('\n\n')
            .trim();

          const result = await zernio.schedulePost({
            caption,
            scheduledForIso: p.scheduled_for,
            platforms:
              p.platforms && p.platforms.length
                ? p.platforms
                : company.brand.defaultPlatforms,
            imageUrl: p.image_url,
            hashtags: p.hashtags || [],
            timezone: env.tz,
            company
          });

          const zernioId =
            result?.id || result?.postId || result?.data?.id || null;
          await storage.updatePost(p.id, {
            status: 'scheduled',
            zernio_post_id: zernioId
          });
          okCount++;
        } catch (err) {
          logger.error(
            { err: err.message, postNumber: p.post_number, company: company.slug },
            'Schedule failed for post'
          );
          await storage.updatePost(p.id, {
            status: 'schedule_failed',
            schedule_error: err.message
          });
          failures.push({ number: p.post_number, error: err.message });
        }
      }

      if (!failures.length) {
        await storage.updateCalendarStatus(monthKey, 'scheduled', company.slug);
        res.json({
          ok: true,
          company: company.slug,
          scheduled: okCount,
          total: posts.length
        });
      } else {
        res.json({
          ok: false,
          company: company.slug,
          scheduled: okCount,
          total: posts.length,
          failures
        });
      }
    } catch (err) {
      logger.error({ err: err.message }, 'schedule-all failed');
      res.status(err.status || 500).json({ ok: false, error: err.message });
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
      return res
        .status(503)
        .json({ ok: false, error: 'telegram disabled' });
    }
    await telegram.sendInfo('Test message from the Marketing Agent.');
    res.json({ ok: true });
  });

  return router;
}

module.exports = makeRouter;
