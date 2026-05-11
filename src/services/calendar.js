/**
 * Calendar service
 * ----------------
 * Generates a one-month content calendar (3 posts/wk + 2 blogs) using
 * GPT-4.1, normalises the output, persists it, then enqueues every
 * social post for image generation + Telegram approval.
 */

const { randomUUID } = require('crypto');
const { DateTime } = require('luxon');

const { BRAND, env, PROMPTS } = require('../config');
const openai = require('./openaiClient');
const dates = require('../utils/dates');
const storage = require('../utils/storage');
const logger = require('../utils/logger');

/**
 * Public entry point: generate, persist, and enqueue a calendar for
 * (now + lookaheadMonths). Defaults to next month.
 */
async function generateCalendarForUpcomingMonth({
  lookaheadMonths = env.calendarLookaheadMonths,
  imageGen,
  telegram
} = {}) {
  const now = DateTime.now().setZone(env.tz);
  const { year, month, monthName } = dates.targetMonth(now, lookaheadMonths);
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;

  logger.info({ monthKey, monthName, year }, 'Generating monthly calendar');

  const awarenessDays = dates.awarenessDaysForMonth(year, month);
  const slots = dates.postingSlotsForMonth(year, month, BRAND.schedule.timeUk, env.tz);

  const calendar = await callLlmForCalendar({ year, month, monthName, awarenessDays });

  // Normalise: align planned posts to the actual Mon/Wed/Fri 09:00 slots
  // for the month, in order. If LLM returned more posts than slots, trim.
  const normalisedPosts = normalisePostsToSlots(calendar.social_posts || [], slots);

  // Persist calendar + posts + blogs
  const calendarId = storage.saveCalendar(monthKey, {
    ...calendar,
    social_posts: normalisedPosts
  });

  for (const p of normalisedPosts) {
    storage.insertPost({
      id: p.id,
      calendar_id: calendarId,
      month_key: monthKey,
      scheduled_for: p.scheduled_for,
      sector: p.sector,
      content_type: p.content_type,
      badge_label: p.badge_label,
      headline: p.headline,
      headline_key_word: p.headline_key_word,
      body_copy: p.body_copy,
      body_emphasis_phrase: p.body_emphasis_phrase,
      cta: p.cta,
      caption: p.caption,
      caption_quote: p.caption_quote,
      attribution: p.attribution,
      platforms: p.platforms,
      image_concept: p.image_concept
    });
  }

  for (const b of calendar.blogs || []) {
    storage.insertBlog({
      calendar_id: calendarId,
      month_key: monthKey,
      title: b.title,
      tone: b.tone,
      target_word_count: b.target_word_count || 900,
      outline: b.outline || []
    });
  }

  storage.setSetting('last_calendar_run_at', new Date().toISOString());
  storage.setSetting('last_calendar_month', monthKey);

  // Kick off image generation + Telegram approval per post (sequentially
  // to be polite with rate limits and keep the Telegram feed readable).
  if (imageGen && telegram) {
    for (const p of normalisedPosts) {
      try {
        await processPostForApproval({ post: p, imageGen, telegram });
      } catch (err) {
        logger.error({ err, postId: p.id }, 'Failed to process post for approval');
      }
    }

    // Send blog summary to Telegram for review
    if ((calendar.blogs || []).length) {
      await telegram.sendBlogSummary({ monthName, year, blogs: calendar.blogs });
    }
  } else {
    logger.warn('No imageGen / telegram service supplied — skipping approval flow');
  }

  return { monthKey, monthName, year, calendar, posts: normalisedPosts };
}

/**
 * Generate image, store it, then send to Telegram for approval.
 */
async function processPostForApproval({ post, imageGen, telegram }) {
  logger.info({ postId: post.id, headline: post.headline }, 'Generating image');
  const { localPath, publicUrl } = await imageGen.generatePostImage(post);

  storage.updatePost(post.id, {
    image_path: localPath,
    image_url: publicUrl,
    status: 'awaiting_approval'
  });

  const messageId = await telegram.sendPostForApproval({
    post,
    imagePath: localPath,
    imageUrl: publicUrl
  });

  if (messageId) {
    storage.updatePost(post.id, { telegram_message_id: messageId });
  }
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

async function callLlmForCalendar({ year, month, monthName, awarenessDays }) {
  const userPrompt = PROMPTS.buildCalendarUserPrompt({
    year,
    monthName,
    awarenessDays
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
  return parsed;
}

/**
 * Map LLM-generated posts onto the actual Mon/Wed/Fri 09:00 slots for
 * the month. We trust the LLM's ordering and assign in sequence,
 * trimming or padding as needed.
 */
function normalisePostsToSlots(llmPosts, slots) {
  // Sort posts by their declared date, fall back to insertion order.
  const sorted = [...llmPosts].sort((a, b) =>
    (a.date || '').localeCompare(b.date || '')
  );

  const out = [];
  const limit = Math.min(sorted.length, slots.length);
  for (let i = 0; i < limit; i++) {
    const p = sorted[i];
    const slot = slots[i];
    out.push({
      id: randomUUID(),
      scheduled_for: slot.toISO(),
      weekday: slot.toFormat('ccc'),
      time: slot.toFormat('HH:mm'),
      sector: p.sector || 'General',
      content_type: p.content_type || 'sector_promo',
      badge_label: p.badge_label || (p.sector || 'STRONG GROUP'),
      headline: (p.headline || '').toUpperCase().slice(0, 80),
      headline_key_word: (p.headline_key_word || '').toUpperCase(),
      body_copy: p.body_copy || '',
      body_emphasis_phrase: p.body_emphasis_phrase || '',
      cta: p.cta || 'Contact us today',
      caption: p.caption || '',
      platforms: Array.isArray(p.platforms) && p.platforms.length
        ? p.platforms
        : BRAND.defaultPlatforms,
      image_concept: p.image_concept || '',
      attribution: p.attribution || '',
      caption_quote: p.caption_quote || ''
    });
  }
  return out;
}

module.exports = {
  generateCalendarForUpcomingMonth,
  processPostForApproval
};
