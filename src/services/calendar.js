/**
 * Calendar service
 * ----------------
 * Generates a one-month content calendar using GPT-4.1:
 *   - 12 social media posts (3/week × 4 weeks, Mon/Wed/Fri 09:00 UK)
 *   - 2 blog posts that are scheduled on social as blog-promo posts
 *     on dedicated slots later in the month.
 *
 * Each post stores topic / caption / hashtags / suggested image
 * description; the user supplies the actual image via Telegram.
 */

const { randomUUID } = require('crypto');
const { DateTime } = require('luxon');

const { BRAND, env, PROMPTS } = require('../config');
const openai = require('./openaiClient');
const dates = require('../utils/dates');
const storage = require('../utils/storage');
const logger = require('../utils/logger');

const SOCIAL_POST_COUNT = 12;
const BLOG_POST_COUNT = 2;

/**
 * Generate the calendar for the upcoming month (now + lookaheadMonths).
 * Persists the calendar + every post + blog into SQLite and returns a
 * summary used by the Telegram service to render the review message.
 *
 * If a calendar already exists for the target month it is replaced.
 */
async function generateCalendarForUpcomingMonth({
  lookaheadMonths = env.calendarLookaheadMonths
} = {}) {
  const now = DateTime.now().setZone(env.tz);

  // Smart month selection: start from today + lookaheadMonths, but if
  // that month already has a completed/scheduled calendar, skip forward
  // up to 3 months to find the next unplanned month.
  let year, month, monthName, monthKey;
  for (let offset = lookaheadMonths; offset <= lookaheadMonths + 3; offset++) {
    const candidate = dates.targetMonth(now, offset);
    const candidateKey = `${candidate.year}-${String(candidate.month).padStart(2, '0')}`;
    const existing = await storage.getCalendar(candidateKey);
    if (!existing || existing.status === 'awaiting_images') {
      // No calendar yet, or one that was never completed — (re)generate it
      year = candidate.year;
      month = candidate.month;
      monthName = candidate.monthName;
      monthKey = candidateKey;
      break;
    }
    logger.info(
      { monthKey: candidateKey, status: existing.status },
      'Month already has a calendar — skipping ahead'
    );
  }
  if (!monthKey) {
    // Fallback: just use the original target
    const fallback = dates.targetMonth(now, lookaheadMonths);
    year = fallback.year;
    month = fallback.month;
    monthName = fallback.monthName;
    monthKey = `${year}-${String(month).padStart(2, '0')}`;
  }

  logger.info({ monthKey, monthName, year }, 'Generating monthly calendar');

  const awarenessDays = dates.awarenessDaysForMonth(year, month);
  const allSlots = dates.postingSlotsForMonth(
    year,
    month,
    BRAND.schedule.timeUk,
    env.tz
  );

  // Reserve slots: first 12 Mon/Wed/Fri 09:00 slots for social posts.
  // Then 2 additional slots (preferably mid-month and late-month) for
  // the blog promo posts. If the month has fewer than 14 Mon/Wed/Fri
  // slots we fall back to whatever is available.
  const { socialSlotIsos, blogSlotIsos } = splitSlots(allSlots);

  if (socialSlotIsos.length < SOCIAL_POST_COUNT) {
    logger.warn(
      { socialSlots: socialSlotIsos.length },
      'Month has fewer than 12 Mon/Wed/Fri slots — using all available'
    );
  }

  // Pull every previously-generated post (excluding the month we're
  // about to regenerate) so we can tell the LLM what NOT to repeat.
  const history = await storage.listPastPostsHistory({
    excludeMonthKey: monthKey,
    limit: 300
  });
  logger.info(
    { monthKey, historyCount: history.length },
    'Loaded post history for non-repetition prompt'
  );

  const calendar = await callLlmForCalendar({
    year,
    month,
    monthName,
    awarenessDays,
    socialSlotIsos,
    blogSlotIsos,
    history
  });

  // Wipe any previous attempt for this month so the user gets a clean
  // calendar to review.
  await storage.deletePostsForMonth(monthKey);
  await storage.deleteBlogsForMonth(monthKey);

  const calendarId = await storage.saveCalendar(
    monthKey,
    calendar,
    'awaiting_images'
  );

  // ---- 12 social posts ----
  const socialPosts = (calendar.social_posts || []).slice(0, SOCIAL_POST_COUNT);
  for (let i = 0; i < socialPosts.length; i++) {
    const p = socialPosts[i];
    const slotIso = socialSlotIsos[i] || p.scheduled_for;
    const id = randomUUID();
    await storage.insertPost({
      id,
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
      hashtags: dedupeHashtags(p.hashtags, p.sector),
      image_description: p.image_description || '',
      platforms: BRAND.defaultPlatforms
    });
  }

  // ---- 2 blogs + their promo posts ----
  const blogPosts = (calendar.blog_posts || []).slice(0, BLOG_POST_COUNT);
  for (let i = 0; i < blogPosts.length; i++) {
    const b = blogPosts[i];
    const blogId = await storage.insertBlog({
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
      calendar_id: calendarId,
      month_key: monthKey,
      post_number: SOCIAL_POST_COUNT + i + 1, // 13, 14
      kind: 'blog_promo',
      blog_id: blogId,
      scheduled_for: slotIso,
      sector: b.sector || 'General',
      content_type: 'blog_promo',
      topic: b.topic || '',
      caption: b.promo_caption || '',
      hashtags: dedupeHashtags(b.promo_hashtags, b.sector),
      image_description: b.image_description || '',
      platforms: BRAND.defaultPlatforms
    });
  }

  await storage.setSetting('last_calendar_run_at', new Date().toISOString());
  await storage.setSetting('last_calendar_month', monthKey);

  const posts = await storage.listPostsByMonth(monthKey);
  const blogs = await storage.listBlogsByMonth(monthKey);

  return { monthKey, monthName, year, posts, blogs };
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

function splitSlots(allSlots) {
  // Pick the first 12 slots for social posts; choose 2 spread blog
  // slots from the remainder (or fall back to slots 13 & 14 if the
  // month is short).
  const socialSlotIsos = allSlots.slice(0, SOCIAL_POST_COUNT).map((s) => s.toISO());
  const leftover = allSlots.slice(SOCIAL_POST_COUNT);

  let blogSlots = [];
  if (leftover.length >= 2) {
    // First leftover and last leftover, to spread them out.
    blogSlots = [leftover[0], leftover[leftover.length - 1]];
  } else if (leftover.length === 1) {
    blogSlots = [leftover[0]];
  }
  // Pad to 2 if the month is short — re-use a social slot at the end.
  while (blogSlots.length < BLOG_POST_COUNT && allSlots.length) {
    blogSlots.push(allSlots[allSlots.length - 1]);
  }

  return {
    socialSlotIsos,
    blogSlotIsos: blogSlots.map((s) => s.toISO())
  };
}

function dedupeHashtags(provided = [], sector = null) {
  const out = new Set();
  for (const h of provided || []) {
    if (typeof h === 'string' && h.trim()) {
      out.add(h.startsWith('#') ? h : `#${h}`);
    }
  }
  for (const h of BRAND.hashtagsBase) out.add(h);
  if (sector && BRAND.sectorHashtags[sector]) {
    for (const h of BRAND.sectorHashtags[sector]) out.add(h);
  }
  // Cap at 8 to stay clean
  return Array.from(out).slice(0, 8);
}

async function callLlmForCalendar({
  year,
  month,
  monthName,
  awarenessDays,
  socialSlotIsos,
  blogSlotIsos,
  history = []
}) {
  const userPrompt = PROMPTS.buildCalendarUserPrompt({
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
      { role: 'system', content: PROMPTS.CALENDAR_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ]
  });

  const raw = completion.choices?.[0]?.message?.content || '{}';
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    logger.error({ err, raw }, 'Calendar LLM returned invalid JSON');
    throw new Error('Calendar LLM returned invalid JSON');
  }

  // Light validation
  if (!Array.isArray(parsed.social_posts) || parsed.social_posts.length < 1) {
    throw new Error('LLM did not return social_posts');
  }
  if (!Array.isArray(parsed.blog_posts) || parsed.blog_posts.length < 1) {
    throw new Error('LLM did not return blog_posts');
  }
  return parsed;
}

module.exports = {
  generateCalendarForUpcomingMonth,
  SOCIAL_POST_COUNT,
  BLOG_POST_COUNT
};
