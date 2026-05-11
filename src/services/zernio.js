/**
 * Zernio service
 * --------------
 * Thin wrapper around Zernio's REST API.
 *  - listAccounts()
 *  - listProfiles()
 *  - schedulePost({ caption, scheduledForIso, platforms[], imageUrl, ... })
 *
 * The platform/account-id mapping lives in config/platforms.js so it
 * is rotatable via environment variables.
 *
 * The POST /posts body format matches the working Python reference
 * (schedule-zernio.py) exactly:
 *   {
 *     profileKey:          PROFILE_ID,
 *     content:             "<caption + hashtags>",
 *     platforms:           [{ platform, accountId, profileId, [customContent] }, ...],
 *     scheduledFor:        "<UTC ISO 8601 with .000Z>",
 *     timezone:            "Europe/London",
 *     mediaItems:          [{ url, type: "image" }],
 *     status:              "scheduled",
 *     visibility:          "public",
 *     crosspostingEnabled: true
 *   }
 */

const axios = require('axios');

const { env, toZernioPlatforms, PROFILE_ID } = require('../config');
const logger = require('../utils/logger');

const http = axios.create({
  baseURL: env.zernioBaseUrl,
  timeout: 30_000,
  headers: {
    Authorization: `Bearer ${env.zernioApiKey}`,
    'Content-Type': 'application/json'
  }
});

async function listAccounts() {
  const { data } = await http.get('/accounts');
  return data;
}

async function listProfiles() {
  const { data } = await http.get('/profiles');
  return data;
}

/**
 * Normalise a scheduled-for timestamp to the exact format Zernio expects
 * (UTC, ISO 8601, millisecond precision, trailing Z), matching the
 * Python reference script.
 *
 * @param {string} iso  any parseable ISO 8601 timestamp
 * @returns {string}    e.g. "2026-06-01T08:00:00.000Z"
 */
function normaliseScheduledFor(iso) {
  if (!iso) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Convert to UTC with millisecond precision: 2026-06-01T08:00:00.000Z
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` +
    `.${pad(d.getUTCMilliseconds(), 3)}Z`
  );
}

/**
 * Split a full caption (body + hashtags joined with \n\n) back into the
 * body portion (used to build a Twitter-safe customContent) and the
 * hashtag list. Falls back gracefully if the caption was assembled
 * differently.
 *
 * @param {string}   caption     - the full caption text actually sent as `content`
 * @param {string[]} [hashtags]  - the hashtag list straight from the post record
 * @returns {{ body: string, hashtags: string[] }}
 */
function splitCaptionForTwitter(caption, hashtags) {
  if (Array.isArray(hashtags) && hashtags.length) {
    const joined = hashtags.join(' ');
    if (typeof caption === 'string' && caption.endsWith(joined)) {
      const body = caption.slice(0, caption.length - joined.length).trimEnd();
      return { body, hashtags };
    }
    return { body: caption || '', hashtags };
  }
  // No structured hashtag list available — fall back to a regex split on
  // the first hashtag occurrence so we still produce a sensible Twitter
  // variant.
  if (typeof caption === 'string') {
    const m = caption.match(/(^|\n)#\w/);
    if (m && m.index !== undefined) {
      const splitAt = m.index + (m[1] ? m[1].length : 0);
      const body = caption.slice(0, splitAt).trimEnd();
      const tagPart = caption.slice(splitAt).trim();
      const tags = tagPart.split(/\s+/).filter((t) => t.startsWith('#'));
      return { body, hashtags: tags };
    }
  }
  return { body: caption || '', hashtags: [] };
}

/**
 * Schedule a post.
 *
 * @param {object} args
 * @param {string} args.caption          - publish-ready text (body + hashtags) used as `content`
 * @param {string} args.scheduledForIso  - ISO 8601 timestamp (UTC ok)
 * @param {string[]} args.platforms      - internal platform keys
 *                                         (e.g. ['linkedin','facebook','instagram','twitter','google'])
 * @param {string} [args.imageUrl]       - public URL of the image to attach
 * @param {string[]} [args.hashtags]     - structured hashtag list (used to build Twitter customContent)
 * @param {string} [args.timezone='Europe/London']
 * @param {boolean} [args.publishNow=false]
 */
async function schedulePost({
  caption,
  scheduledForIso,
  platforms,
  imageUrl,
  hashtags,
  timezone = 'Europe/London',
  publishNow = false
}) {
  // Reconstruct body / hashtag list so we can build a Twitter-safe
  // customContent that mirrors the Python reference script.
  const { body: twitterBody, hashtags: twitterTags } = splitCaptionForTwitter(
    caption,
    hashtags
  );

  const platformObjects = toZernioPlatforms(platforms, logger, {
    captionBody: twitterBody,
    hashtags: twitterTags
  });
  if (!platformObjects.length) {
    throw new Error('Cannot schedule post: no valid platforms resolved');
  }

  const body = {
    profileKey: PROFILE_ID,
    content: caption,
    platforms: platformObjects,
    timezone,
    status: 'scheduled',
    visibility: 'public',
    crosspostingEnabled: true
  };

  if (publishNow) {
    body.publishNow = true;
  } else {
    body.scheduledFor = normaliseScheduledFor(scheduledForIso);
  }

  if (imageUrl) {
    body.mediaItems = [{ url: imageUrl, type: 'image' }];
  }

  logger.info(
    {
      scheduledFor: body.scheduledFor,
      platforms: platformObjects.map((p) => p.platform),
      hasImage: !!imageUrl
    },
    'Scheduling Zernio post'
  );

  try {
    const { data } = await http.post('/posts', body);
    logger.info(
      { zernioId: data?.id || data?.postId || data?.data?.id },
      'Zernio scheduled'
    );
    return data;
  } catch (err) {
    const status = err.response?.status;
    const detail = err.response?.data;
    logger.error({ status, detail }, 'Zernio scheduling failed');
    throw new Error(
      `Zernio API error ${status || ''}: ${
        typeof detail === 'string' ? detail : JSON.stringify(detail)
      }`
    );
  }
}

async function deletePost(zernioPostId) {
  const { data } = await http.delete(`/posts/${zernioPostId}`);
  return data;
}

async function getPost(zernioPostId) {
  const { data } = await http.get(`/posts/${zernioPostId}`);
  return data;
}

module.exports = {
  http,
  listAccounts,
  listProfiles,
  schedulePost,
  deletePost,
  getPost,
  // exported for tests / debugging
  normaliseScheduledFor,
  splitCaptionForTwitter
};
