/**
 * Mapping between internal platform keys and Zernio account IDs.
 * Account IDs are loaded from environment variables so they can be
 * rotated without a code change.
 */

require('dotenv').config();

const PROFILE_ID = process.env.ZERNIO_PROFILE_ID || '69c00b0b467c216082612e75';

const PLATFORMS = Object.freeze({
  facebook: {
    key: 'facebook',
    label: 'Facebook',
    zernioPlatform: 'facebook',
    accountId: process.env.ZERNIO_ACCOUNT_FACEBOOK
  },
  google: {
    key: 'google',
    label: 'Google Business',
    zernioPlatform: 'googlebusiness',
    accountId: process.env.ZERNIO_ACCOUNT_GOOGLE
  },
  instagram: {
    key: 'instagram',
    label: 'Instagram',
    zernioPlatform: 'instagram',
    accountId: process.env.ZERNIO_ACCOUNT_INSTAGRAM
  },
  linkedin: {
    key: 'linkedin',
    label: 'LinkedIn',
    zernioPlatform: 'linkedin',
    accountId: process.env.ZERNIO_ACCOUNT_LINKEDIN
  },
  twitter: {
    key: 'twitter',
    label: 'Twitter/X',
    zernioPlatform: 'twitter',
    accountId: process.env.ZERNIO_ACCOUNT_TWITTER
  }
});

const ALL_PLATFORM_KEYS = Object.keys(PLATFORMS);

const TWITTER_MAX_CHARS = 280;

/**
 * Build a Twitter-safe version of a caption (with hashtags) that fits
 * within Twitter's 280-character limit.
 *
 * Mirrors the logic in the working schedule-zernio.py reference script:
 *   - Truncate the caption body to 247 chars + "..." if it is over 250
 *   - Append the first 3 hashtags
 *   - Hard-cap the final string at 280 chars
 *
 * @param {string} captionBody  - the post body (without hashtags)
 * @param {string[]} hashtags   - the full hashtag list for the post
 * @returns {string}
 */
function buildTwitterCustomContent(captionBody = '', hashtags = []) {
  let body = (captionBody || '').toString();
  if (body.length > 250) {
    body = body.slice(0, 247) + '...';
  }
  const firstThree = (hashtags || [])
    .filter((h) => typeof h === 'string' && h.trim())
    .slice(0, 3)
    .join(' ');
  let full = firstThree ? `${body}\n\n${firstThree}` : body;
  if (full.length > TWITTER_MAX_CHARS) {
    full = full.slice(0, TWITTER_MAX_CHARS);
  }
  return full;
}

/**
 * Resolve a list of platform keys to Zernio platform-objects.
 * Skips any platform whose accountId env var is missing and logs a warning.
 * Each object includes { platform, accountId, profileId } as required by
 * the Zernio POST /posts endpoint. For the Twitter platform, an extra
 * `customContent` field is added with a 280-char-safe variant of the
 * caption + first 3 hashtags.
 *
 * @param {string[]} keys
 * @param {object}  [logger]
 * @param {object}  [opts]
 * @param {string}  [opts.captionBody] - body text used to build Twitter customContent
 * @param {string[]}[opts.hashtags]    - hashtag list used to build Twitter customContent
 */
function toZernioPlatforms(keys, logger = console, opts = {}) {
  const out = [];
  for (const key of keys) {
    const p = PLATFORMS[key];
    if (!p) {
      logger.warn(`Unknown platform key: ${key}`);
      continue;
    }
    if (!p.accountId) {
      logger.warn(`Skipping ${p.label}: missing accountId env var`);
      continue;
    }
    const entry = {
      platform: p.zernioPlatform,
      accountId: p.accountId,
      profileId: PROFILE_ID
    };
    if (p.zernioPlatform === 'twitter') {
      entry.customContent = buildTwitterCustomContent(
        opts.captionBody,
        opts.hashtags
      );
    }
    out.push(entry);
  }
  return out;
}

module.exports = {
  PLATFORMS,
  ALL_PLATFORM_KEYS,
  PROFILE_ID,
  TWITTER_MAX_CHARS,
  toZernioPlatforms,
  buildTwitterCustomContent
};
