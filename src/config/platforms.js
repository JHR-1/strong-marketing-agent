/**
 * Platform helpers — multi-company aware.
 *
 * Each company exposes its own `platforms` map (internal key ->
 * { zernioPlatform, accountId, label }) and a `zernio.profileId`. The
 * helpers here resolve a list of internal platform keys into the
 * exact `platforms` array the Zernio POST /posts endpoint expects.
 *
 * For backwards compatibility we also export the legacy
 * `PLATFORMS` map and `PROFILE_ID` constant that resolve against the
 * Strong company (the previous default). New code should call
 * `toZernioPlatforms(keys, company, logger, opts)` with an explicit
 * company.
 */

require('dotenv').config();

const TWITTER_MAX_CHARS = 280;

/**
 * Build a Twitter-safe version of a caption (with hashtags) that fits
 * within Twitter's 280-character limit.
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
 * Resolve internal platform keys to Zernio platform objects for a
 * specific company.
 *
 * @param {string[]} keys      internal platform keys (e.g. ['facebook','instagram','twitter'])
 * @param {object}   company   company config object (must have .platforms + .zernio.profileId)
 * @param {object}  [logger]   any console-like logger
 * @param {object}  [opts]
 * @param {string}  [opts.captionBody]
 * @param {string[]}[opts.hashtags]
 */
function toZernioPlatformsForCompany(
  keys,
  company,
  logger = console,
  opts = {}
) {
  if (!company || !company.platforms || !company.zernio?.profileId) {
    throw new Error(
      'toZernioPlatformsForCompany: company config is missing platforms/profileId'
    );
  }
  const profileId = company.zernio.profileId;
  const out = [];
  for (const key of keys || []) {
    const p = company.platforms[key];
    if (!p) {
      logger.warn(
        `[${company.slug}] Unknown platform key: ${key} — skipping`
      );
      continue;
    }
    if (!p.accountId) {
      logger.warn(
        `[${company.slug}] Skipping ${p.label}: missing accountId env var`
      );
      continue;
    }
    const entry = {
      platform: p.zernioPlatform,
      accountId: p.accountId,
      profileId
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

// ------------------------------------------------------------------
// Backwards-compatible exports (default to the Strong company so any
// caller that still imports the legacy API keeps working).
// ------------------------------------------------------------------
const { getCompany, getDefaultCompany } = require('./companies');

function _legacyDefault() {
  return getDefaultCompany() || getCompany('strong');
}

function toZernioPlatforms(keys, loggerOrCompany, optsOrLogger, maybeOpts) {
  // Two supported signatures:
  //   toZernioPlatforms(keys, logger, opts)                     ← legacy
  //   toZernioPlatforms(keys, company, logger, opts)            ← new
  if (
    loggerOrCompany &&
    typeof loggerOrCompany === 'object' &&
    loggerOrCompany.slug &&
    loggerOrCompany.platforms
  ) {
    return toZernioPlatformsForCompany(
      keys,
      loggerOrCompany,
      optsOrLogger || console,
      maybeOpts || {}
    );
  }
  return toZernioPlatformsForCompany(
    keys,
    _legacyDefault(),
    loggerOrCompany || console,
    optsOrLogger || {}
  );
}

const PLATFORMS = new Proxy(
  {},
  {
    get(_t, prop) {
      const c = _legacyDefault();
      return c && c.platforms ? c.platforms[prop] : undefined;
    },
    ownKeys() {
      const c = _legacyDefault();
      return c && c.platforms ? Object.keys(c.platforms) : [];
    },
    getOwnPropertyDescriptor() {
      return { enumerable: true, configurable: true };
    }
  }
);

const ALL_PLATFORM_KEYS = (() => {
  const c = _legacyDefault();
  return c && c.platforms ? Object.keys(c.platforms) : [];
})();

function getProfileId() {
  const c = _legacyDefault();
  return c?.zernio?.profileId || '';
}

// Legacy `PROFILE_ID` constant — resolves to the default company's
// Zernio profile id at module load. New code should read
// `company.zernio.profileId` directly.
const PROFILE_ID = getProfileId();

module.exports = {
  PLATFORMS,
  ALL_PLATFORM_KEYS,
  PROFILE_ID,
  TWITTER_MAX_CHARS,
  toZernioPlatforms,
  toZernioPlatformsForCompany,
  buildTwitterCustomContent
};
