/**
 * Zentra Peptides — company config
 * --------------------------------
 *
 * Pre-launch UK research-compound brand. Strict research-use-only
 * compliance: no health claims, no dosing, no bodybuilding/gym
 * references, no before/after. Every post must carry the disclaimer
 * "For research use only. Not for human or veterinary consumption."
 *
 * Platforms: Facebook, Instagram, X only (no LinkedIn, no Google
 * Business). Zernio profile is the Zentra workspace.
 */

require('dotenv').config();

const PROFILE_ID =
  process.env.ZERNIO_ZENTRA_PROFILE_ID || '6a0215e005cbe2cbf1a929d2';

function accountId(channel) {
  return process.env[`ZERNIO_ZENTRA_ACCOUNT_${channel.toUpperCase()}`] || '';
}

// Only 3 platforms for Zentra — no LinkedIn, no Google Business.
const PLATFORMS = Object.freeze({
  facebook: {
    key: 'facebook',
    label: 'Facebook',
    zernioPlatform: 'facebook',
    accountId: accountId('FACEBOOK')
  },
  instagram: {
    key: 'instagram',
    label: 'Instagram',
    zernioPlatform: 'instagram',
    accountId: accountId('INSTAGRAM')
  },
  twitter: {
    key: 'twitter',
    label: 'Twitter/X',
    zernioPlatform: 'twitter',
    accountId: accountId('TWITTER')
  }
});

// Research categories (used to rotate content the way "sectors" rotate
// for Strong). Keys match the brand brief.
const CATEGORIES = [
  'Metabolic Research',
  'Recovery Research',
  'Performance Research',
  'Longevity / Cellular Research',
  'Cognitive Research',
  'Research Stacks',
  'Pre-Mixed Research Pens',
  'Research Essentials'
];

const CATEGORY_HASHTAGS = {
  'Metabolic Research': ['#MetabolicResearch', '#GLP1Research', '#PeptideResearch'],
  'Recovery Research': ['#RecoveryResearch', '#BPC157', '#TB500'],
  'Performance Research': ['#PerformanceResearch', '#GHResearch', '#PeptideResearch'],
  'Longevity / Cellular Research': [
    '#LongevityResearch',
    '#CellularResearch',
    '#NAD',
    '#MitochondrialResearch'
  ],
  'Cognitive Research': ['#CognitiveResearch', '#Neuropeptides', '#BDNFResearch'],
  'Research Stacks': ['#ResearchStacks', '#PeptideResearch'],
  'Pre-Mixed Research Pens': ['#PreMixedPens', '#ResearchPens', '#PeptideResearch'],
  'Research Essentials': ['#ResearchEssentials', '#LabAccessories', '#BACWater']
};

const BRAND = {
  company: 'Zentra Peptides',
  displayBrand: 'ZENTRA',
  legalName: 'Zentra Peptides',
  phone: '',
  website: 'zentra-peptides.com',
  email: 'info@zentra-peptides.com',
  tagline: 'Precision Research Compounds',
  voice:
    'Premium, clinical, scientific, trustworthy, minimal, modern. ' +
    'Confident and transparent. Never sales-y, never gym/bodybuilding, ' +
    'never medical-treatment claims.',
  hashtagsBase: [
    '#ZENTRA',
    '#ResearchCompounds',
    '#PeptideResearch',
    '#ResearchUseOnly'
  ],

  // Treated as "sectors" in the existing calendar pipeline so we can
  // reuse the rotation / dedupe logic unchanged. Calendar code reads
  // BRAND.sectors generically.
  sectors: CATEGORIES,
  sectorHashtags: CATEGORY_HASHTAGS,

  contentTypes: [
    'brand_launch_teaser',
    'category_preview',
    'trust_transparency',
    'qr_batch_verification',
    'pre_mixed_pens',
    'research_essentials',
    'waiting_list',
    'why_it_takes_time',
    'brand_story',
    'compliance_education'
  ],

  // Same Mon/Wed/Fri 09:00 cadence so Zentra calendar timing matches
  // the agent's existing slot machinery.
  schedule: {
    daysOfWeek: ['Mon', 'Wed', 'Fri'],
    timeUk: '09:00',
    timezone: 'Europe/London',
    blogsPerMonth: 0,
    socialPostsPerWeek: 3
  },

  // 3 platforms only.
  defaultPlatforms: ['facebook', 'instagram', 'twitter'],

  // Zentra is pre-launch and does not run a blog yet. We disable the
  // blog promo posts entirely (the calendar service will see
  // blogPostCount=0 and skip them). If a blog gets added later we can
  // flip this back on without changing code.
  blog: {
    siteBaseUrl: 'https://zentra-peptides.com/'
  },

  // Compliance + creative guardrails
  compliance: {
    disclaimer: 'For research use only. Not for human or veterinary consumption.',
    disclaimerShort: 'For research use only.',
    forbidden: [
      'fat loss',
      'weight loss',
      'muscle building',
      'healing injuries',
      'anti-ageing cure',
      'mood improvement',
      'anxiety relief',
      'sleep improvement claims',
      'human dosing',
      'injection instructions',
      'use weekly',
      'take this',
      'results',
      'transform your body',
      'before and after',
      'safe for use',
      'medical treatment claims',
      'customer testimonials about effects',
      'bodybuilding',
      'gym',
      'workout'
    ],
    preferredLanguage: [
      'research compounds',
      'research models',
      'commonly studied in',
      'research interest includes',
      'batch verified',
      'third-party tested',
      'COA available',
      'laboratory-use accessories',
      'for research use only',
      'not for human or veterinary consumption'
    ]
  },

  // Key CTAs the agent must rotate between (no telephone CTA — Zentra
  // is pre-launch and only collects the waiting list).
  ctas: [
    'Join the mailing list for launch access.',
    'Be the first to know when ZENTRA goes live.',
    'Register for launch updates at zentra-peptides.com.'
  ]
};

// -----------------------------------------------------------------
// Prompts
// -----------------------------------------------------------------

const CALENDAR_SYSTEM_PROMPT = `
You are the in-house marketing strategist for ${BRAND.displayBrand}
(${BRAND.company}), a UK-based premium research-compound brand
preparing to launch. You plan one calendar month at a time and your
output is read directly by a Telegram bot and a scheduling platform
(Zernio), so every caption must be ready to publish with no
placeholders.

Brand positioning — premium biotech / clinical / research-led. NOT a
gym brand, NOT a supplement brand, NOT a fitness-influencer brand.
Tagline: "${BRAND.tagline}".

Research categories ZENTRA covers (rotate through these — never the
same category in two consecutive posts):
${BRAND.sectors.map((s) => `- ${s}`).join('\n')}

Tone:
- Premium, clinical, scientific, trustworthy, minimal, modern.
- Confident, transparent, professional.
- UK English. No US spelling.
- Never invent statistics. Never invent COA numbers, batch numbers,
  testimonials, customer names or effects.

COMPLIANCE — THIS IS NON-NEGOTIABLE:
- Every post is research-use-only positioning.
- Every caption must end with the disclaimer:
  "${BRAND.compliance.disclaimer}"
- NEVER make health, medical, treatment, dosing or human-use claims.
- NEVER reference bodybuilding, gym, workouts, transformations or
  before/after.
- NEVER give dosing, scheduling ("use weekly", "take this") or
  injection instructions.
- NEVER promise results, fat loss, weight loss, muscle gain, healing,
  improved sleep, improved mood, anxiety relief or anti-ageing cures.
- NEVER quote fabricated customer testimonials about effects.
- Use research framing: "research compounds", "research models",
  "commonly studied in", "batch verified", "third-party tested",
  "COA available", "laboratory-use accessories".

Each calendar must contain exactly:
- 12 social posts across the target month, scheduled in the Mon / Wed /
  Fri 09:00 Europe/London slots given to you (3 per week × 4 weeks).
- NO blog posts (Zentra is pre-launch and has no blog yet).

Content mix across the 12 posts (approximate):
- ~35% category previews (rotate the 8 research categories listed
  above; group obvious peptides into the right category).
- ~20% trust & transparency content (third-party testing, QR batch
  verification, COA reveal, "Scan. Verify. Trust.", UK fulfilment).
- ~15% pre-mixed research pens / research essentials previews.
- ~15% waiting-list / launch-countdown content
  ("Join the mailing list", "Be the first to know", "Coming soon").
- ~15% brand-story / "why it takes time" / "what we're building".

Captions:
- 4-6 short lines, ready to publish, premium and clinical in tone.
- Open with a strong, on-brand line (e.g. "ZENTRA is coming soon.",
  "Scan. Verify. Trust.", "Precision research compounds.").
- 1-2 short supporting lines that stay within the compliance rules.
- Close with a clear pre-launch CTA from this allowed set:
${BRAND.ctas.map((c) => `  • "${c}"`).join('\n')}
- ALWAYS append the disclaimer line as its own line:
  "${BRAND.compliance.disclaimer}"
- Then include 5-8 hashtags. ALWAYS include #ZENTRA, #ResearchCompounds,
  #ResearchUseOnly, and at least one category-specific hashtag where
  relevant.

Suggested image descriptions:
- 1-3 sentences describing exactly what Nick should create in
  ChatGPT 5.5.
- Visual direction: white / silver / light grey background, navy blue
  and cyan accents, clean laboratory feel, premium product photography,
  branded vials with navy labels and blue caps, subtle molecular
  graphics, QR / COA verification visuals, minimal typography, soft
  shadows.
- Allowed subjects: branded vials, pre-mixed pens, packaging mockups,
  COA / lab-report graphics, QR scan visuals, clean lab/researcher
  imagery (gloved hands handling vials in a lab — never injecting
  into a body), "coming soon" / waiting-list cards.
- NEVER describe: syringes in a body, needles in skin, injection
  scenes, gym / bodybuilding imagery, before / after, transformations,
  medical-treatment scenes, cartoon visuals, neon visuals, cheap
  supplement-banner aesthetics.

Return JSON only — no prose, no markdown.
`.trim();

function buildCalendarUserPrompt({
  year,
  monthName,
  awarenessDays,
  socialSlots,
  blogSlots, // unused for Zentra (blogPostCount = 0)
  history = []
}) {
  // We deliberately ignore most generic awareness days — Zentra is a
  // research brand, not a UK calendar brand. But if the LLM finds a
  // genuinely relevant scientific / research observance it may use it
  // sparingly. Most months it should use category previews instead.
  const awarenessList = awarenessDays && awarenessDays.length
    ? awarenessDays.map((d) => `- ${d.date}: ${d.name}`).join('\n')
    : '- (skip generic awareness days — focus on research category previews and trust/transparency content)';

  const historyBlock = buildHistoryBlock(history);

  return `
Plan the ${BRAND.displayBrand} pre-launch social calendar for ${monthName} ${year}.

${historyBlock}

Available Mon/Wed/Fri 09:00 Europe/London slots for the 12 social posts
(use exactly these 12, in this order — one per slot):
${socialSlots.map((s, i) => `${i + 1}. ${s}`).join('\n')}

UK / international awareness days that fall in this month (use
sparingly — only if they clearly relate to research / science /
longevity; otherwise prefer category previews):
${awarenessList}

Return JSON with EXACTLY this shape (no extra keys):
{
  "month": "${monthName} ${year}",
  "social_posts": [
    {
      "slot_index": 1,
      "scheduled_for": "<one of the social slots above>",
      "sector": "<one of: ${BRAND.sectors.join(' | ')} | General>",
      "content_type": "${BRAND.contentTypes.join('|')}",
      "topic": "Short human-readable topic (e.g. 'Metabolic Research category preview', 'Scan. Verify. Trust.', 'Pre-Mixed Research Pens teaser')",
      "caption": "Full publish-ready caption. End with the disclaimer line 'For research use only. Not for human or veterinary consumption.' Do NOT include hashtags in this field.",
      "hashtags": ["#ZENTRA", "#ResearchCompounds", "#ResearchUseOnly", "#..."],
      "image_description": "1-3 sentences describing the premium clinical visual Nick should create in ChatGPT 5.5 (white/silver background, navy + cyan accents, branded vials or QR/COA graphic — never injection imagery)."
    }
    // ... 12 entries total
  ],
  "blog_posts": []
}

Hard constraints:
- Exactly 12 social posts. Zero blog posts (return an empty blog_posts array).
- "scheduled_for" must be one of the exact slot strings above, in order.
- Rotate through the 8 research categories — never the same category
  in two consecutive posts.
- Every caption MUST end with: "For research use only. Not for human or veterinary consumption."
- Every hashtag list MUST include #ZENTRA and #ResearchUseOnly.
- Pre-launch CTAs only — use the allowed CTAs listed in the system
  prompt. Never "Apply today", "Buy now", "Shop now", "Order now",
  "Contact us today" etc.
- NEVER reference: bodybuilding, gym, fitness, dosing, injection,
  human use, fat loss, weight loss, muscle gain, healing, anti-ageing
  cures, before/after, results, testimonials about effects.
- UK English, no US spelling, no fabricated statistics or batch
  numbers.
- Do NOT repeat any of the past topics, hooks, angles, or captions in
  the POST HISTORY section above. Every topic and caption this month
  must be materially new.
`.trim();
}

function buildHistoryBlock(history) {
  if (!history || !history.length) {
    return [
      'POST HISTORY (previous months) — none yet.',
      'This is the first ZENTRA calendar, so there is nothing to avoid repeating yet.',
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
    `POST HISTORY (previous ZENTRA months, ${history.length} entries) — DO NOT REPEAT any of these topics, hooks, angles, or captions:`,
    ...lines,
    '',
    'Every topic and caption this month MUST be different. Pick a new category preview, a new trust/transparency angle, a new waiting-list framing, etc.',
    ''
  ].join('\n');
}

const CAPTION_EDIT_SYSTEM_PROMPT = `
You rewrite social media captions for ${BRAND.displayBrand} on
instruction from the marketing manager.

Hard rules:
- Keep tone premium, clinical, scientific, trustworthy, minimal.
- UK English. No US spelling.
- Research-use-only framing. Never make health, medical, treatment,
  dosing, fat-loss, weight-loss, muscle-gain, bodybuilding, before/
  after or testimonial claims.
- Pre-launch CTA only (mailing-list / launch access / "be the first to
  know"). No "Apply today", "Buy now", "Order now" etc.
- End the caption with the disclaimer line on its own line:
  "For research use only. Not for human or veterinary consumption."
- Include 5-8 hashtags after the disclaimer. Always include #ZENTRA,
  #ResearchCompounds and #ResearchUseOnly.
- Never invent statistics, COAs, batch numbers, customer quotes or
  testimonials. Never change the website or contact details.
- Return only the new caption text — no commentary, no markdown.
`.trim();

module.exports = {
  slug: 'zentra',
  displayName: 'Zentra Peptides',
  shortName: 'ZENTRA',
  brand: BRAND,
  platforms: PLATFORMS,
  platformOrderLabel: 'Facebook · Instagram · Twitter/X',
  zernio: {
    profileId: PROFILE_ID
  },
  monthly: {
    // Brief allows 8-12 posts. We standardise on 12 to match the same
    // Mon/Wed/Fri × 4-week cadence the agent already supports.
    socialPostCount: 12,
    blogPostCount: 0,
    hasBlogPromos: false
  },
  prompts: {
    CALENDAR_SYSTEM_PROMPT,
    buildCalendarUserPrompt,
    CAPTION_EDIT_SYSTEM_PROMPT
  }
};
