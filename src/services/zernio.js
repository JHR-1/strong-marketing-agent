/**
 * Zernio service — multi-company aware.
 *
 * Schedules posts via Zernio's REST API. Each company has its own
 * Zernio profile id and its own set of channel account ids; the
 * caller passes the company config in so the service knows which
 * profile + accounts to talk to.
 *
 * POST /posts body format (unchanged from the working Python reference):
 *   {
 *     profileKey:          <company.zernio.profileId>,
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

const {
  env,
  toZernioPlatformsForCompany,
  getDefaultCompany,
  getCompany
} = require('../config');
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
 * (UTC, ISO 8601, millisecond precision, trailing Z).
 */
function normaliseScheduledFor(iso) {
  if (!iso) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` +
    `.${pad(d.getUTCMilliseconds(), 3)}Z`
  );
}

function splitCaptionForTwitter(caption, hashtags) {
  if (Array.isArray(hashtags) && hashtags.length) {
    const joined = hashtags.join(' ');
    if (typeof caption === 'string' && caption.endsWith(joined)) {
      const body = caption.slice(0, caption.length - joined.length).trimEnd();
      return { body, hashtags };
    }
    return { body: caption || '', hashtags };
  }
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
 * Resolve `args.company` into a real company config. Accepts a company
 * object, a slug string, or null/undefined (falls back to the default
 * company so legacy callers keep working).
 */
function resolveCompany(arg) {
  if (!arg) return getDefaultCompany();
  if (typeof arg === 'string') return getCompany(arg) || getDefaultCompany();
  if (arg && arg.platforms && arg.zernio?.profileId) return arg;
  return getDefaultCompany();
}

/**
 * Schedule a post.
 *
 * @param {object} args
 * @param {string}        args.caption          - publish-ready text (body + hashtags) used as `content`
 * @param {string}        args.scheduledForIso  - ISO 8601 timestamp (UTC ok)
 * @param {string[]}      args.platforms        - internal platform keys
 * @param {string}        [args.imageUrl]
 * @param {string[]}      [args.hashtags]
 * @param {string}        [args.timezone='Europe/London']
 * @param {boolean}       [args.publishNow=false]
 * @param {object|string} [args.company]        - company config OR slug. Defaults to the default company.
 */
async function schedulePost({
  caption,
  scheduledForIso,
  platforms,
  imageUrl,
  hashtags,
  timezone = 'Europe/London',
  publishNow = false,
  company
}) {
  const companyCfg = resolveCompany(company);

  const { body: twitterBody, hashtags: twitterTags } = splitCaptionForTwitter(
    caption,
    hashtags
  );

  const platformObjects = toZernioPlatformsForCompany(
    platforms,
    companyCfg,
    logger,
    { captionBody: twitterBody, hashtags: twitterTags }
  );
  if (!platformObjects.length) {
    throw new Error(
      `[${companyCfg.slug}] Cannot schedule post: no valid platforms resolved (check ZERNIO_${companyCfg.slug.toUpperCase()}_ACCOUNT_* env vars)`
    );
  }

  const body = {
    profileKey: companyCfg.zernio.profileId,
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
      company: companyCfg.slug,
      scheduledFor: body.scheduledFor,
      platforms: platformObjects.map((p) => p.platform),
      hasImage: !!imageUrl
    },
    'Scheduling Zernio post'
  );

  try {
    const { data } = await http.post('/posts', body);
    logger.info(
      {
        company: companyCfg.slug,
        zernioId: data?.id || data?.postId || data?.data?.id
      },
      'Zernio scheduled'
    );
    return data;
  } catch (err) {
    const status = err.response?.status;
    const detail = err.response?.data;
    logger.error(
      { company: companyCfg.slug, status, detail },
      'Zernio scheduling failed'
    );
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
  normaliseScheduledFor,
  splitCaptionForTwitter
};
