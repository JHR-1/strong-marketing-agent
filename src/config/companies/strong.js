/**
 * Strong Recruitment Group — company config
 * -----------------------------------------
 *
 * This is the original single-company brand object that lived in
 * `src/config/brand.js`, plus the additional fields needed by the
 * multi-company runtime (slug, platforms, prompt builders, Zernio
 * profile, monthly deliverables, etc.).
 *
 * IMPORTANT: every value here is preserved 1:1 from the previous
 * single-company configuration so existing behaviour does NOT change
 * when this company is selected.
 */

require('dotenv').config();

const PROFILE_ID =
  process.env.ZERNIO_STRONG_PROFILE_ID ||
  process.env.ZERNIO_PROFILE_ID ||
  '69c00b0b467c216082612e75';

// Zernio account-id resolution.
//   1. Company-scoped env var  (ZERNIO_STRONG_ACCOUNT_FACEBOOK, ...)
//   2. Legacy single-company env var (ZERNIO_ACCOUNT_FACEBOOK, ...)
// This means existing Railway env vars continue to drive Strong with
// zero changes.
function accountId(channel) {
  const upper = channel.toUpperCase();
  return (
    process.env[`ZERNIO_STRONG_ACCOUNT_${upper}`] ||
    process.env[`ZERNIO_ACCOUNT_${upper}`] ||
    ''
  );
}

const PLATFORMS = Object.freeze({
  facebook: {
    key: 'facebook',
    label: 'Facebook',
    zernioPlatform: 'facebook',
    accountId: accountId('FACEBOOK')
  },
  google: {
    key: 'google',
    label: 'Google Business',
    zernioPlatform: 'googlebusiness',
    accountId: accountId('GOOGLE')
  },
  instagram: {
    key: 'instagram',
    label: 'Instagram',
    zernioPlatform: 'instagram',
    accountId: accountId('INSTAGRAM')
  },
  linkedin: {
    key: 'linkedin',
    label: 'LinkedIn',
    zernioPlatform: 'linkedin',
    accountId: accountId('LINKEDIN')
  },
  twitter: {
    key: 'twitter',
    label: 'Twitter/X',
    zernioPlatform: 'twitter',
    accountId: accountId('TWITTER')
  }
});

const SECTORS = [
  'M&E',
  'Construction',
  'Driving & Transport',
  'Data Centres',
  'Rail & Infrastructure',
  'Fit-Out & Interiors',
  'Residential'
];

const SECTOR_HASHTAGS = {
  'M&E': ['#MandE', '#MEPRecruitment', '#BuildingServices'],
  'Construction': ['#Construction', '#ConstructionJobs', '#UKConstruction'],
  'Driving & Transport': ['#DrivingJobs', '#HGV', '#Logistics'],
  'Data Centres': ['#DataCentres', '#CriticalInfrastructure', '#TechRecruitment'],
  'Rail & Infrastructure': ['#Rail', '#RailJobs', '#Infrastructure'],
  'Fit-Out & Interiors': ['#FitOut', '#Interiors', '#CommercialFitOut'],
  'Residential': ['#Residential', '#Housing', '#UKHousing']
};

const BRAND = {
  company: 'Strong Recruitment Group',
  legalName: 'Strong Recruitment Group Limited',
  phone: '0208 763 6122',
  website: 'strong-group.co.uk',
  email: 'info@strong-group.co.uk',
  tagline: 'Stay Strong.',
  voice:
    'Professional, approachable, UK-focused. Bold, direct CTAs. ' +
    'Empathetic for awareness days, confident for sector promos.',
  hashtagsBase: ['#StrongGroup', '#Recruitment', '#UK'],

  sectors: SECTORS,
  sectorHashtags: SECTOR_HASHTAGS,

  contentTypes: [
    'industry_awareness_day',
    'sector_promo',
    'client_review',
    'staff_spotlight',
    'hiring_tips',
    'workforce_planning'
  ],

  // Posting schedule
  schedule: {
    daysOfWeek: ['Mon', 'Wed', 'Fri'],
    timeUk: '09:00',
    timezone: 'Europe/London',
    blogsPerMonth: 2,
    socialPostsPerWeek: 3
  },

  defaultPlatforms: ['facebook', 'instagram', 'linkedin', 'twitter', 'google'],

  blog: {
    siteBaseUrl: 'https://strong-group.co.uk/news/'
  }
};

// -----------------------------------------------------------------
// Prompts
// -----------------------------------------------------------------

const CALENDAR_SYSTEM_PROMPT = `
You are the in-house marketing strategist for ${BRAND.company}, a UK
specialist recruitment business. You plan one calendar month at a time
and your output is read directly by a Telegram bot and a scheduling
platform (Zernio), so your captions must be ready to publish with no
placeholders.

Sectors Strong Group covers (rotate through these — never the same
sector in two consecutive posts):
${BRAND.sectors.map((s) => `- ${s}`).join('\n')}

Tone:
- Professional, approachable, UK-focused.
- Confident and direct for sector promos and CTAs.
- Empathetic and human for awareness day posts.
- Never use US spelling, never invent statistics, never fabricate
  client names or quotes.

Each calendar must contain exactly:
- 12 social posts (3 per week, Mon / Wed / Fri at 09:00 Europe/London,
  across 4 weeks of the target month).
- 2 blog posts that double as social-media promo posts later in the
  month (these are EXTRA — they are not counted in the 12 social posts
  and they get their own Mon/Wed/Fri slots reserved as promo slots).

Content mix across the 12 social posts (approximate):
- ~50% sector promos (rotated through all 7 sectors)
- ~25% industry / awareness days (only main, well-known UK days, never
  more than 3 per month, tied back to recruitment / construction
  context where possible)
- ~15% hiring tips or workforce planning insights
- ~10% client reviews or staff spotlights

Captions:
- 1-3 short paragraphs, ready to publish.
- Always end with a clear UK-style CTA (e.g. "Contact us today",
  "Apply today", "Get in touch").
- Always include 4-6 hashtags. Always include #StrongGroup.
- Mention the sector with a sector hashtag when relevant.

Suggested image descriptions:
- 1-3 sentences describing exactly what Nick should create in
  ChatGPT 5.5 (subject, mood, lighting, UK context, on-brand colours).
- Reference the topic / sector so the visual matches the caption.
- Photoreal editorial style — never cartoon, never illustration.
- Do NOT describe text/typography overlays; the user is creating the
  graphic in ChatGPT 5.5 and will follow the Strong Group style guide.

Blog posts:
- Topic (clear, SEO-friendly title).
- A 120-200 word description / summary suitable for the news page.
- A short "social promo caption" used when promoting the blog on
  social media (this caption ends with the blog URL placeholder
  "<BLOG_URL>" which the agent will replace at scheduling time).
- A suggested image description for the blog hero / promo image.

Always respond with valid JSON matching the schema you are given.
No prose, no markdown — JSON only.
`.trim();

function buildCalendarUserPrompt({
  year,
  monthName,
  awarenessDays,
  socialSlots,
  blogSlots,
  history = []
}) {
  const awarenessList = awarenessDays.length
    ? awarenessDays.map((d) => `- ${d.date}: ${d.name}`).join('\n')
    : '- (no major awareness days fall in this month — use sector promos instead)';

  const historyBlock = buildHistoryBlock(history);

  return `
Plan the social media + blog calendar for ${monthName} ${year}.

${historyBlock}

Available Mon/Wed/Fri 09:00 Europe/London slots for SOCIAL posts (use
exactly these 12, in this order — one per slot):
${socialSlots.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Available Mon/Wed/Fri 09:00 Europe/London slots for the 2 BLOG promo
posts (these are separate from the 12 social posts and run on
different dates):
${blogSlots.map((s, i) => `B${i + 1}. ${s}`).join('\n')}

Main UK / international awareness days that fall in this month
(include only the genuinely relevant ones — do not force every day in):
${awarenessList}

Return JSON with EXACTLY this shape (no extra keys):
{
  "month": "${monthName} ${year}",
  "social_posts": [
    {
      "slot_index": 1,
      "scheduled_for": "<one of the social slots above>",
      "sector": "<one of: ${BRAND.sectors.join(' | ')} | General>",
      "content_type": "industry_awareness_day|sector_promo|client_review|staff_spotlight|hiring_tips|workforce_planning",
      "topic": "Short human-readable topic / theme (e.g. 'Driving & Transport recruitment push', 'World Environment Day — sustainable sites')",
      "caption": "Full publish-ready caption with line breaks, ending in a CTA. Do NOT include the hashtags in this field.",
      "hashtags": ["#StrongGroup", "#..."],
      "image_description": "1-3 sentences describing the photo Nick should create in ChatGPT 5.5 for this post."
    }
    // ... 12 entries total
  ],
  "blog_posts": [
    {
      "slot_index": 1,
      "scheduled_for": "<one of the blog slots above>",
      "sector": "<sector or 'General'>",
      "topic": "Blog title",
      "blog_description": "120-200 word summary suitable for the news page.",
      "promo_caption": "Short caption used when promoting the blog on social. Ends with the blog URL token <BLOG_URL>. Do NOT include hashtags.",
      "promo_hashtags": ["#StrongGroup", "#..."],
      "image_description": "1-3 sentences describing the hero image Nick should create in ChatGPT 5.5."
    }
    // ... 2 entries total
  ]
}

Hard constraints:
- 12 social posts. 2 blog posts. No more, no less.
- "scheduled_for" must be one of the exact slot strings above, in order.
- Sector posts must rotate across all 7 sectors over the month; do not
  repeat the same sector in consecutive posts.
- Include #StrongGroup in every hashtag list.
- Captions must be publish-ready, UK English, no placeholders.
- For blogs, the promo caption MUST contain the literal token
  "<BLOG_URL>" exactly where the link should appear.
- Do NOT repeat any of the past topics, hooks, angles, or captions
  listed in the POST HISTORY section above. Every topic and caption
  this month must be materially new (fresh angle, fresh wording,
  fresh examples). If a sector has already been covered recently,
  approach it from a different angle (e.g. a different role, a
  different challenge, a different time of year, a different stat).
`.trim();
}

function buildHistoryBlock(history) {
  if (!history || !history.length) {
    return [
      'POST HISTORY (previous months) — none yet.',
      'This is the first generated calendar, so there is nothing to avoid repeating yet.',
      ''
    ].join('\n');
  }

  const lines = history.map((h) => {
    const captionSnippet = (h.caption || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160);
    const sector = h.sector || 'General';
    const contentType = h.content_type || h.kind || 'social';
    return `- [${h.month_key} #${h.post_number} | ${sector} | ${contentType}] ${
      h.topic || '(no topic)'
    }${captionSnippet ? ` — ${captionSnippet}${captionSnippet.length === 160 ? '…' : ''}` : ''}`;
  });

  return [
    `POST HISTORY (previous months, ${history.length} entries) — DO NOT REPEAT any of these topics, hooks, angles, or captions:`,
    ...lines,
    '',
    "When you generate this month's calendar, every topic and caption MUST be different from the items above. Do not paraphrase or lightly reword an earlier post — pick a new angle, a new role, a new sector challenge, a new awareness day, a new staff/client spotlight idea, etc.",
    ''
  ].join('\n');
}

const CAPTION_EDIT_SYSTEM_PROMPT = `
You rewrite social media captions for ${BRAND.company} on instruction
from the marketing manager. Keep the tone professional, approachable,
UK-focused, with a clear CTA. Always include 4-6 relevant hashtags
ending with #StrongGroup. Never invent statistics. Never change the
contact details. Return only the new caption text — no commentary.
`.trim();

module.exports = {
  slug: 'strong',
  displayName: 'Strong Recruitment Group',
  shortName: 'Strong',
  brand: BRAND,
  platforms: PLATFORMS,
  platformOrderLabel:
    'Facebook · Instagram · LinkedIn · Twitter/X · Google Business',
  zernio: {
    profileId: PROFILE_ID
  },
  // Monthly structure for Strong is fixed: 12 social + 2 blog promo posts
  // (the existing behaviour). Other companies can override this.
  monthly: {
    socialPostCount: 12,
    blogPostCount: 2,
    hasBlogPromos: true
  },
  prompts: {
    CALENDAR_SYSTEM_PROMPT,
    buildCalendarUserPrompt,
    CAPTION_EDIT_SYSTEM_PROMPT
  }
};
