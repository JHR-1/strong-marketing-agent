const express = require('express');
const storage = require('../utils/storage');
const {
  getCompany,
  getDefaultCompany,
  listCompanies
} = require('../config');

const router = express.Router();

function resolveCompanyFromQuery(req) {
  const raw = req.query.company || req.query.companySlug;
  if (!raw) return getDefaultCompany();
  return getCompany(raw) || null;
}

router.get('/health', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

router.get('/status', async (req, res, next) => {
  try {
    const wantAll = String(req.query.company || '').toLowerCase() === 'all';

    if (wantAll) {
      const out = [];
      for (const company of listCompanies()) {
        const counts = await storage.countByStatus(company.slug);
        const lastRun = await storage.getCompanySetting(
          'last_calendar_run_at',
          company.slug
        );
        const lastMonth = await storage.getCompanySetting(
          'last_calendar_month',
          company.slug
        );
        out.push({
          company: company.slug,
          displayName: company.displayName,
          lastCalendarRunAt: lastRun,
          lastCalendarMonth: lastMonth,
          postsByStatus: Object.fromEntries(counts.map((c) => [c.status, c.count]))
        });
      }
      return res.json({ ok: true, companies: out });
    }

    const company = resolveCompanyFromQuery(req);
    if (!company) {
      return res.status(400).json({ ok: false, error: 'unknown company' });
    }
    const counts = await storage.countByStatus(company.slug);
    const lastRun = await storage.getCompanySetting(
      'last_calendar_run_at',
      company.slug
    );
    const lastMonth = await storage.getCompanySetting(
      'last_calendar_month',
      company.slug
    );
    res.json({
      ok: true,
      company: company.slug,
      displayName: company.displayName,
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
    const company = resolveCompanyFromQuery(req);
    if (!company) {
      return res.status(400).json({ ok: false, error: 'unknown company' });
    }
    const posts = await storage.listPostsByMonth(
      req.params.monthKey,
      company.slug
    );
    res.json({
      ok: true,
      company: company.slug,
      monthKey: req.params.monthKey,
      count: posts.length,
      posts
    });
  } catch (err) {
    next(err);
  }
});

router.get('/blogs/:monthKey', async (req, res, next) => {
  try {
    const company = resolveCompanyFromQuery(req);
    if (!company) {
      return res.status(400).json({ ok: false, error: 'unknown company' });
    }
    const blogs = await storage.listBlogsByMonth(
      req.params.monthKey,
      company.slug
    );
    res.json({
      ok: true,
      company: company.slug,
      monthKey: req.params.monthKey,
      blogs
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
