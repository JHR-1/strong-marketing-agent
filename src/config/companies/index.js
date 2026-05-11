/**
 * Multi-company registry
 * ----------------------
 *
 * Each company is a self-contained module that exposes:
 *   slug, displayName, shortName,
 *   brand, platforms, platformOrderLabel,
 *   zernio: { profileId },
 *   monthly: { socialPostCount, blogPostCount, hasBlogPromos },
 *   prompts: { CALENDAR_SYSTEM_PROMPT,
 *              buildCalendarUserPrompt(ctx),
 *              CAPTION_EDIT_SYSTEM_PROMPT }
 *
 * The rest of the codebase consumes companies via this registry only —
 * it never imports a specific company directly. To add a third
 * company, drop a `./<slug>.js` file in this folder and add it to the
 * COMPANIES array below.
 */

const strong = require('./strong');
const zentra = require('./zentra');

const COMPANIES = Object.freeze([strong, zentra]);

const BY_SLUG = Object.freeze(
  Object.fromEntries(COMPANIES.map((c) => [c.slug, c]))
);

const DEFAULT_COMPANY_SLUG =
  process.env.DEFAULT_COMPANY_SLUG && BY_SLUG[process.env.DEFAULT_COMPANY_SLUG]
    ? process.env.DEFAULT_COMPANY_SLUG
    : 'strong';

function listCompanies() {
  return COMPANIES.slice();
}

function getCompany(slug) {
  if (!slug) return BY_SLUG[DEFAULT_COMPANY_SLUG];
  const key = String(slug).toLowerCase().trim();
  return BY_SLUG[key] || null;
}

function getCompanyOrThrow(slug) {
  const c = getCompany(slug);
  if (!c) {
    throw new Error(
      `Unknown company slug "${slug}". Known: ${COMPANIES.map((x) => x.slug).join(', ')}`
    );
  }
  return c;
}

function getDefaultCompany() {
  return BY_SLUG[DEFAULT_COMPANY_SLUG];
}

function knownSlugs() {
  return COMPANIES.map((c) => c.slug);
}

module.exports = {
  COMPANIES,
  DEFAULT_COMPANY_SLUG,
  listCompanies,
  getCompany,
  getCompanyOrThrow,
  getDefaultCompany,
  knownSlugs
};
