const express = require('express');
const storage = require('../utils/storage');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

router.get('/status', (req, res) => {
  const counts = storage.countByStatus();
  const lastRun = storage.getSetting('last_calendar_run_at');
  const lastMonth = storage.getSetting('last_calendar_month');
  res.json({
    ok: true,
    lastCalendarRunAt: lastRun,
    lastCalendarMonth: lastMonth,
    postsByStatus: Object.fromEntries(counts.map((c) => [c.status, c.count]))
  });
});

router.get('/posts/:monthKey', (req, res) => {
  const posts = storage.listPostsByMonth(req.params.monthKey);
  res.json({ ok: true, monthKey: req.params.monthKey, count: posts.length, posts });
});

router.get('/blogs/:monthKey', (req, res) => {
  const blogs = storage.listBlogsByMonth(req.params.monthKey);
  res.json({ ok: true, monthKey: req.params.monthKey, blogs });
});

module.exports = router;
