const express = require('express');
const storage = require('../utils/storage');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

router.get('/status', async (req, res, next) => {
  try {
    const counts = await storage.countByStatus();
    const lastRun = await storage.getSetting('last_calendar_run_at');
    const lastMonth = await storage.getSetting('last_calendar_month');
    res.json({
      ok: true,
      lastCalendarRunAt: lastRun,
      lastCalendarMonth: lastMonth,
      postsByStatus: Object.fromEntries(counts.map((c) => [c.status, c.count]))
    });
  } catch (err) {
    next(err);
  }
});

router.get('/posts/:monthKey', async (req, res, next) => {
  try {
    const posts = await storage.listPostsByMonth(req.params.monthKey);
    res.json({ ok: true, monthKey: req.params.monthKey, count: posts.length, posts });
  } catch (err) {
    next(err);
  }
});

router.get('/blogs/:monthKey', async (req, res, next) => {
  try {
    const blogs = await storage.listBlogsByMonth(req.params.monthKey);
    res.json({ ok: true, monthKey: req.params.monthKey, blogs });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
