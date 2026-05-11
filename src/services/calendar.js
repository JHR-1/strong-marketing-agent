/**
 * Calendar service — multi-company aware.
 *
 * Generates a one-month content calendar for a specific company using
 * GPT-4.1. Each company supplies its own prompt builders and monthly
 * structure (e.g. Strong = 12 social + 2 blog promos; Zentra = 12
 * social + 0 blogs while pre-launch).
 *
 * Calling without an explicit company falls back to the default
 * company so existing single-company callers keep working unchanged.
 */

const { randomUUID } = require('crypto');
const { DateTime } = require('luxon');

const { env, getCompany, getDefaultCompany } = require('../config');
const openai = require('./openaiClient');
const dates = require('../utils/dates');
const storage = require('../utils/storage');
const logger = require('../utils/logger');

// Default counts for the default company (Strong). Each company can
// override via its `monthly` block.
const DEFAULT_SOCIAL_POST_COUNT = 12;
const DEFAULT_BLOG_POST_COUNT = 2;

function resolveCompany(arg) {
  if (!arg) return getDefaultCompany();
  if (typeof arg === 'string') return getCompany(arg) || getDefaultCompany();
  if (arg && arg.brand && arg.prompts) return arg;
  return getDefaultCompany();
}

/**
 * Generate the calendar for the upcoming month (now + lookaheadMonths)
 * for a specific company.
 */
async function generateCalendarForUpcomingMonth({
  lookaheadMonths = env.calendarLookaheadMonths,
  company: companyArg
} = {}) {
  const company = resolveCompany(companyArg);
  const { brand, monthly, prompts } = company;
  const socialPostCount = monthly?.socialPostCount ?? DEFAULT_SOCIAL_POST_COUNT;
  const blogPostCount = monthly?.blogPostCount ?? DEFAULT_BLOG_POST_COUNT;

  const now = DateTime.now().setZone(env.tz);

  // Smart month selection: start from today + lookaheadMonths, but if
  // that month already has a completed/scheduled calendar (for this
  // company), skip forward up to 3 months to find the next unplanned
  // month.
  let year, month, monthName, monthKey;
  for (let offset = lookaheadMonths; offset <= lookaheadMonths + 3; offset++) {
    const candidate = dates.targetMonth(now, offset);
    const candidateKey = `${candidate.year}-${String(candidate.month).padStart(2, '0')}`;
    const existing = await storage.getCalendar(candidateKey, company.slug);
    if (!existing || existing.status === 'awaiting_images') {
      year = candidate.year;
      month = candidate.month;
      monthName = candidate.monthName;
      monthKey = candidateKey;
      break;
    }
    logger.info(
      { company: company.slug, monthKey: candidateKey, status: existing.status },
      'Month already has a calendar — skipping ahead'
    );
  }
  if (!monthKey) {
    const fallback = dates.targetMonth(now, lookaheadMonths);
    year = fallback.year;
    month = fallback.month;
    monthName = fallback.monthName;
    monthKey = `${year}-${String(month).padStart(2, '0')}`;
  }

  logger.info(
    { company: company.slug, monthKey, monthName, year },
    'Generating monthly calendar'
  );

  const awarenessDays = dates.awarenessDaysForMonth(year, month);
  const allSlots = dates.postingSlotsForMonth(
    year,
    month,
    brand.schedule.timeUk,
    env.tz
  );

  const { socialSlotIsos, blogSlotIsos } = splitSlots(
    allSlots,
    socialPostCount,
    blogPostCount
  );

  if (socialSlotIsos.length < socialPostCount) {
    logger.warn(
      { company: company.slug, socialSlots: socialSlotIsos.length, want: socialPostCount },
      'Month has fewer slots than the company wants — using all available'
    );
  }

  const history = await storage.listPastPostsHistory({
    excludeMonthKey: monthKey,
    limit: 300,
    company: company.slug
  });
  logger.info(
    { company: company.slug, monthKey, historyCount: history.length },
    'Loaded post history for non-repetition prompt'
  );

  const calendar = await callLlmForCalendar({
    company,
    year,
    month,
    monthName,
    awarenessDays,
    socialSlotIsos,
    blogSlotIsos,
    history
  });

  // Wipe any previous attempt for this (company, month) so the user
  // gets a clean calendar to review.
  await storage.deletePostsForMonth(monthKey, company.slug);
  await storage.deleteBlogsForMonth(monthKey, company.slug);

  const calendarId = await storage.saveCalendar(
    monthKey,
    calendar,
    'awaiting_images',
    company.slug
  );

  // ---- Social posts ----
  const socialPosts = (calendar.social_posts || []).slice(0, socialPostCount);
  for (let i = 0; i < socialPosts.length; i++) {
    const p = socialPosts[i];
    const slotIso = socialSlotIsos[i] || p.scheduled_for;
    const id = randomUUID();
    await storage.insertPost({
      id,
      company: company.slug,
      calendar_id: calendarId,
      month_key: monthKey,
      post_number: i + 1,
      kind: 'social',
      blog_id: null,
      scheduled_for: slotIso,
      sector: p.sector || 'General',
      content_type: p.content_type || 'sector_promo',
      topic: p.topic || '',
      caption: p.caption || '',
      hashtags: dedupeHashtags(brand, p.hashtags, p.sector),
      image_description: p.image_description || '',
      platforms: brand.defaultPlatforms
    });
  }

  // ---- Blog promos (skipped for companies whose blogPostCount is 0) ----
  if (blogPostCount > 0) {
    const blogPosts = (calendar.blog_posts || []).slice(0, blogPostCount);
    for (let i = 0; i < blogPosts.length; i++) {
      const b = blogPosts[i];
      const blogId = await storage.insertBlog({
        company: company.slug,
        calendar_id: calendarId,
        month_key: monthKey,
        topic: b.topic || '',
        blog_description: b.blog_description || '',
        url: null
      });

      const slotIso = blogSlotIsos[i] || b.scheduled_for;
      const id = randomUUID();
      await storage.insertPost({
        id,
        company: company.slug,
        calendar_id: calendarId,
        month_key: monthKey,
        post_number: socialPostCount + i + 1,
        kind: 'blog_promo',
        blog_id: blogId,
        scheduled_for: slotIso,
        sector: b.sector || 'General',
        content_type: 'blog_promo',
        topic: b.topic || '',
        caption: b.promo_caption || '',
        hashtags: dedupeHashtags(brand, b.promo_hashtags, b.sector),
        image_description: b.image_description || '',
        platforms: brand.defaultPlatforms
      });
    }
  }

  await storage.setCompanySetting(
    'last_calendar_run_at',
    new Date().toISOString(),
    company.slug
  );
  await storage.setCompanySetting('last_calendar_month', monthKey, company.slug);

  const posts = await storage.listPostsByMonth(monthKey, company.slug);
  const blogs = await storage.listBlogsByMonth(monthKey, company.slug);

  return {
    company: company.slug,
    companyName: company.displayName,
    monthKey,
    monthName,
    year,
    posts,
    blogs
  };
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

function splitSlots(allSlots, socialCount, blogCount) {
  const socialSlotIsos = allSlots
    .slice(0, socialCount)
    .map((s) => s.toISO());
  if (!blogCount) {
    return { socialSlotIsos, blogSlotIsos: [] };
  }
  const leftover = allSlots.slice(socialCount);
  let blogSlots = [];
  if (leftover.length >= 2) {
    blogSlots = [leftover[0], leftover[leftover.length - 1]];
  } else if (leftover.length === 1) {
    blogSlots = [leftover[0]];
  }
  while (blogSlots.length < blogCount && allSlots.length) {
    blogSlots.push(allSlots[allSlots.length - 1]);
  }
  return {
    socialSlotIsos,
    blogSlotIsos: blogSlots.slice(0, blogCount).map((s) => s.toISO())
  };
}

function dedupeHashtags(brand, provided = [], sector = null) {
  const out = new Set();
  for (const h of provided || []) {
    if (typeof h === 'string' && h.trim()) {
      out.add(h.startsWith('#') ? h : `#${h}`);
    }
  }
  for (const h of brand.hashtagsBase || []) out.add(h);
  if (sector && brand.sectorHashtags && brand.sectorHashtags[sector]) {
    for (const h of brand.sectorHashtags[sector]) out.add(h);
  }
  return Array.from(out).slice(0, 8);
}

async function callLlmForCalendar({
  company,
  year,
  month,
  monthName,
  awarenessDays,
  socialSlotIsos,
  blogSlotIsos,
  history = []
}) {
  const { prompts } = company;
  const userPrompt = prompts.buildCalendarUserPrompt({
    year,
    monthName,
    awarenessDays,
    socialSlots: socialSlotIsos,
    blogSlots: blogSlotIsos,
    history
  });

  const completion = await openai.chat.completions.create({
    model: env.openaiTextModel,
    response_format: { type: 'json_object' },
    temperature: 0.7,
    messages: [
      { role: 'system', content: prompts.CALENDAR_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ]
  });

  const raw = completion.choices?.[0]?.message?.content || '{}';
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    logger.error(
      { company: company.slug, err: err.message, raw },
      'Calendar LLM returned invalid JSON'
    );
    throw new Error('Calendar LLM returned invalid JSON');
  }

  if (!Array.isArray(parsed.social_posts) || parsed.social_posts.length < 1) {
    throw new Error('LLM did not return social_posts');
  }
  if (
    (company.monthly?.blogPostCount ?? DEFAULT_BLOG_POST_COUNT) > 0 &&
    (!Array.isArray(parsed.blog_posts) || parsed.blog_posts.length < 1)
  ) {
    throw new Error('LLM did not return blog_posts');
  }
  if (!Array.isArray(parsed.blog_posts)) parsed.blog_posts = [];
  return parsed;
}

module.exports = {
  generateCalendarForUpcomingMonth,
  // Legacy constants — refer to the default company's monthly structure.
  SOCIAL_POST_COUNT: DEFAULT_SOCIAL_POST_COUNT,
  BLOG_POST_COUNT: DEFAULT_BLOG_POST_COUNT
};
