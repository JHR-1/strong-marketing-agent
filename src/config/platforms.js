/**
 * Mapping between internal platform keys and Zernio account IDs.
 * Account IDs are loaded from environment variables so they can be
 * rotated without a code change.
 */

require('dotenv').config();

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
    zernioPlatform: 'google',
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

/**
 * Resolve a list of platform keys to Zernio platform-objects.
 * Skips any platform whose accountId env var is missing and logs a warning.
 *
 * @param {string[]} keys
 * @param {object} [logger]
 */
function toZernioPlatforms(keys, logger = console) {
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
    out.push({ platform: p.zernioPlatform, accountId: p.accountId });
  }
  return out;
}

module.exports = {
  PLATFORMS,
  ALL_PLATFORM_KEYS,
  toZernioPlatforms
};
