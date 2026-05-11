/**
 * Prompt library for OpenAI text and image generation.
 *
 * The image prompt is deliberately exhaustive so that gpt-image-1
 * reliably produces graphics matching Nick's ChatGPT-5.5 reference set
 * (see assets/reference/*.png and assets/style-guide.md).
 *
 * Hard rules (do NOT relax):
 *   - 1080x1350 portrait (4:5) canvas
 *   - Dark navy base, single bold accent colour chosen by topic
 *   - Massive condensed uppercase headline (2-3 lines, ONE key word in accent)
 *   - Pill badge in TOP-LEFT corner with awareness day / sector label
 *   - Photoreal editorial imagery, never stock-looking, never illustration
 *   - Curved wave separator above contact strip, accent-coloured
 *   - Full contact strip at the bottom: STRONG GROUP logo + PHONE / WEBSITE / EMAIL
 *   - Phone 0208 763 6122  ·  Website strong-group.co.uk  ·  Email info@strong-group.co.uk
 *   - Strong Group logo: 3 vertically-stacked blue dots on the left, thin grey
 *     divider, then "STRONG" with the "N" and "G" in blue gradient, and
 *     "GROUP" beneath in lighter grey. Never recoloured or distorted.
 */

const BRAND = require('./brand');

// -------------------------------------------------------------------
// Accent-colour palette, keyed by content_type / sector
// -------------------------------------------------------------------
const ACCENT_BY_THEME = {
  // Awareness days
  environment:        { name: 'green',  hex: '#38A169' },
  health:             { name: 'red',    hex: '#E53E3E' },
  loneliness:         { name: 'purple', hex: '#805AD5' },
  community:          { name: 'gold',   hex: '#F5A623' },
  heritage:           { name: 'gold',   hex: '#F5A623' },
  forces:             { name: 'gold',   hex: '#F5A623' },
  // Sectors
  'driving/transport':{ name: 'cyan',   hex: '#38B2AC' },
  'data centres':     { name: 'cyan',   hex: '#38B2AC' },
  rail:               { name: 'orange', hex: '#E8952E' },
  'fit-out & interiors':{ name: 'red',  hex: '#E53E3E' },
  'm&e':              { name: 'gold',   hex: '#F5A623' },
  construction:       { name: 'gold',   hex: '#F5A623' },
  commercial:         { name: 'gold',   hex: '#F5A623' },
  residential:        { name: 'gold',   hex: '#F5A623' },
  // Generic / fallback
  default:            { name: 'gold',   hex: '#F5A623' }
};

function pickAccent(post) {
  // Try keyword match against headline / body / sector
  const haystack = `${post.headline || ''} ${post.body_copy || ''} ${post.sector || ''} ${post.content_type || ''}`.toLowerCase();
  if (/environment|green|sustainab|climate|eco|earth/.test(haystack)) return ACCENT_BY_THEME.environment;
  if (/health|wellbeing|mental|safety|strength/.test(haystack))       return ACCENT_BY_THEME.health;
  if (/lonel|isolation|alone|connect/.test(haystack))                  return ACCENT_BY_THEME.loneliness;
  if (/volunteer|community|charity/.test(haystack))                    return ACCENT_BY_THEME.community;
  if (/windrush|heritage|diversity|inclusion/.test(haystack))          return ACCENT_BY_THEME.heritage;
  if (/forces|veteran|military|armed/.test(haystack))                  return ACCENT_BY_THEME.forces;

  // Sector match
  const sectorKey = (post.sector || '').toLowerCase();
  if (ACCENT_BY_THEME[sectorKey]) return ACCENT_BY_THEME[sectorKey];

  return ACCENT_BY_THEME.default;
}

// -------------------------------------------------------------------
// System + user prompts for the GPT-4.1 calendar generator
// -------------------------------------------------------------------

const CALENDAR_SYSTEM_PROMPT = `
You are the in-house marketing strategist for ${BRAND.company}, a UK
specialist recruitment business covering the following sectors:
${BRAND.sectors.map((s) => `- ${s}`).join('\n')}

Your job is to plan a one-month social media + blog calendar that:
- Posts 3 times a week (Mon, Wed, Fri at 09:00 Europe/London)
- Mixes content types in roughly: 40% sector promos, 20% awareness days,
  20% hiring tips / workforce planning, 20% client reviews / staff spotlights
- Rotates through sectors and never repeats the same sector in two
  consecutive posts
- Uses real, well-known UK / international awareness days that fall in
  the target month
- Adds 2 blog post outlines (not posted to social) per month
- Writes captions in a professional, approachable, UK-focused tone with
  a clear CTA (e.g. "Contact us today", "Are you ready?", "Apply today")
- Captions ready to publish, no placeholder text, 1-3 short paragraphs
- Includes 3-6 relevant hashtags per caption (always include #StrongGroup)

Headlines MUST be 2-5 words, all uppercase, with ONE "key word" the
designer can render in an accent colour. Identify that key word as the
last word in the headline whenever possible (e.g. "STAY ACTIVE, STAY
STRONG" — key word "STRONG"; "DRIVING THE INDUSTRY FORWARD" — key word
"FORWARD"; "BUILDING FOR TOMORROW" — key word "TOMORROW").

Always respond with valid JSON matching the schema you are given.
`.trim();

function buildCalendarUserPrompt({ year, monthName, awarenessDays }) {
  return `
Plan the social media and blog calendar for ${monthName} ${year}.

Known UK/international awareness days that month (use these where they
fit naturally; you may add more if relevant):
${awarenessDays.map((d) => `- ${d.date}: ${d.name}`).join('\n')}

Return JSON with exactly this shape:
{
  "month": "${monthName} ${year}",
  "social_posts": [
    {
      "date": "YYYY-MM-DD",
      "weekday": "Mon|Wed|Fri",
      "time": "09:00",
      "sector": "<one of the sectors, or 'General'>",
      "content_type": "industry_awareness_day|sector_promo|client_review|staff_spotlight|hiring_tips|workforce_planning",
      "badge_label": "Short uppercase label for the top-left pill, e.g. 'BIKE WEEK', 'DRIVING & TRANSPORT'",
      "headline": "BOLD UPPERCASE HEADLINE (2-5 WORDS)",
      "headline_key_word": "Single word from headline to render in accent colour",
      "body_copy": "2-3 short sentences, ready to print on the image",
      "body_emphasis_phrase": "Short fragment from body_copy to render bold in accent colour",
      "cta": "Short CTA button text (max 4 words, uppercase)",
      "caption": "Full publish-ready social caption with hashtags",
      "platforms": ["linkedin","facebook","instagram","twitter"],
      "image_concept": "1-3 sentences describing the photographic scene that should fill the right or background of the canvas"
    }
  ],
  "blogs": [
    {
      "title": "Blog title",
      "target_word_count": 900,
      "tone": "Professional / Empathetic / Insightful",
      "outline": ["Section 1", "Section 2", "..."]
    }
  ]
}

Constraints:
- Social posts on Mon, Wed or Fri only.
- 3 posts per week.
- ${BRAND.schedule.blogsPerMonth} blog outlines.
- Content mix: ~40% sector promos, 20% awareness days, 20% hiring tips/workforce planning, 20% client reviews/staff spotlights.
- Never repeat the same sector in consecutive posts.
`.trim();
}

// -------------------------------------------------------------------
// gpt-image-1 prompt builder
// -------------------------------------------------------------------

/**
 * Decide the post layout family from its content_type. This is what
 * makes a "Client Review" look different from a "Driving & Transport"
 * sector promo even though both share the global style.
 */
function pickLayout(post) {
  const ct = (post.content_type || '').toLowerCase();
  if (ct === 'client_review')      return 'CLIENT_REVIEW';
  if (ct === 'workforce_planning') return 'WORKFORCE_GRID';
  if (ct === 'staff_spotlight')    return 'STAFF_POLAROID';
  if (ct === 'sector_promo')       return 'SECTOR_PROMO';
  if (ct === 'industry_awareness_day') return 'AWARENESS_DAY';
  if (ct === 'hiring_tips')        return 'HIRING_TIP';
  return 'SECTOR_PROMO';
}

function layoutBlock(layout, post, accent) {
  switch (layout) {
    case 'CLIENT_REVIEW':
      return `
LAYOUT — CLIENT REVIEW CARD:
- Pill badge top-left: "${(post.badge_label || post.sector || 'CLIENT REVIEW').toUpperCase()}",
  filled accent-${accent.name} (${accent.hex}) with white uppercase text.
- HUGE white uppercase wordmark centered near the top: "CLIENT REVIEW".
- Below the wordmark: a row of 5 GOLD 3D star icons (#F5A623), evenly spaced.
- Centered framed quote area with a thin white rounded-rectangle border
  and oversized white opening quotation mark at the top-left and
  closing quotation mark at the bottom-right.
- Quote text inside (large white sans-serif, 4-6 lines):
  "${post.caption_quote || post.body_copy}"
- Attribution line in italic muted gold beneath the quote:
  "– ${post.attribution || 'Project Manager, ' + (post.sector || 'Commercial Interiors')}"
- One-line gold tagline below: "We take pride in the quality of our placements."
- Subtle blurred dark-navy commercial-office interior photo as the
  background, with a strong navy gradient overlay so all text is legible.
      `.trim();

    case 'WORKFORCE_GRID':
      return `
LAYOUT — WORKFORCE PLANNING GRID:
- Pill badge top-left in accent-${accent.name} with white text reading
  "${(post.badge_label || 'WORKFORCE PLANNING').toUpperCase()}".
- Massive headline at the top, white with the key word "${post.headline_key_word || 'YOU'}" in accent-${accent.name}:
  "${post.headline}".
- A 2x2 grid of photographic tiles in the middle of the canvas, each
  showing a different sector with a small uppercase white label
  bottom-left of the tile: RESIDENTIAL, COMMERCIAL FIT-OUTS, RAIL &
  INFRASTRUCTURE, DRIVING & TRANSPORT (or whichever 4 sectors are
  most relevant). Tiles have soft rounded corners and a thin gold
  border.
- Body line beneath the grid in white: "${post.body_copy}".
- CTA pill button centered: filled accent-${accent.name},
  white uppercase text "${(post.cta || 'CONTACT US TODAY').toUpperCase()}".
      `.trim();

    case 'STAFF_POLAROID':
      return `
LAYOUT — STAFF SPOTLIGHT POLAROID:
- Pill badge top-left in accent-${accent.name} reading
  "${(post.badge_label || 'STAFF SPOTLIGHT').toUpperCase()}".
- Massive condensed white uppercase headline on the LEFT half, with the
  key word "${post.headline_key_word || 'STRONG'}" in accent-${accent.name}:
  "${post.headline}".
- A large white polaroid photograph pinned with a gold thumbtack on the
  RIGHT half of the canvas, slightly rotated, showing:
  ${post.image_concept}.
- Handwritten cursive caption inside the polaroid white border:
  "${post.body_emphasis_phrase || 'Building better.'}".
- Short body block under the headline in white with the emphasis phrase
  in accent-${accent.name}: "${post.body_copy}".
- Small gold curved swoosh decoration trailing from the polaroid corner.
      `.trim();

    case 'AWARENESS_DAY':
      return `
LAYOUT — AWARENESS DAY:
- Pill badge top-left with a small line-art icon (e.g. leaf, heart,
  bicycle, hard hat) and uppercase white text:
  "${(post.badge_label || 'AWARENESS DAY').toUpperCase()}",
  pill outlined in accent-${accent.name} with a transparent fill.
- Massive condensed white uppercase headline on the LEFT half, 2-3
  lines, with the key word "${post.headline_key_word || ''}" rendered in
  accent-${accent.name}: "${post.headline}".
- Short body block beneath the headline (3-5 lines of white sans-serif)
  with the phrase "${post.body_emphasis_phrase || ''}" in accent-${accent.name}.
- A photoreal hero image filling the RIGHT half of the canvas:
  ${post.image_concept}.
- Use a navy gradient overlay where text touches the photo to maintain
  contrast. Optional small line-art accent icons (1-3 of them) below
  the body block, all in accent-${accent.name}.
      `.trim();

    case 'HIRING_TIP':
      return `
LAYOUT — HIRING TIP / WORKFORCE INSIGHT:
- Pill badge top-left "${(post.badge_label || 'HIRING TIPS').toUpperCase()}"
  in accent-${accent.name}.
- Bold uppercase headline (white + accent key word "${post.headline_key_word || ''}"):
  "${post.headline}".
- Numbered list of 3 short tips OR a single key insight in large white
  text, derived from: "${post.body_copy}".
- Subtle photoreal background of an office / construction planning
  scene with heavy navy overlay.
- CTA pill button accent-${accent.name}: "${(post.cta || 'CONTACT US TODAY').toUpperCase()}".
      `.trim();

    case 'SECTOR_PROMO':
    default:
      return `
LAYOUT — SECTOR PROMO:
- Pill badge top-left with a small white line-art icon for the sector
  (HGV truck for transport, server rack for data centres, rail track
  for rail, paint roller / sofa for fit-out, gear for M&E, hard hat
  for construction). Label uppercase white:
  "${(post.badge_label || post.sector || 'SECTOR').toUpperCase()}".
  Pill outlined in accent-${accent.name}.
- Massive condensed white uppercase headline on the LEFT half, with the
  final key word "${post.headline_key_word || ''}" in accent-${accent.name}:
  "${post.headline}".
- Photoreal hero image filling the RIGHT half / background:
  ${post.image_concept}.
- Body block on the LEFT in white sans-serif, 3-5 lines, with
  "${post.body_emphasis_phrase || ''}" rendered in accent-${accent.name}.
- CTA pill button bottom-left, filled accent-${accent.name} with white
  uppercase text: "${(post.cta || 'CONTACT US TODAY').toUpperCase()}".
      `.trim();
  }
}

/**
 * Build the full gpt-image-1 prompt for a single post.
 */
function buildImagePrompt(post) {
  const accent = pickAccent(post);
  const layout = pickLayout(post);

  const headline = (post.headline || '').toUpperCase();
  const keyWord  = (post.headline_key_word || '').toUpperCase() ||
                   headline.split(/\s+/).pop();

  return `
Create a premium 1080x1350 pixel portrait (4:5) social media graphic
for ${BRAND.company}, a UK specialist recruitment company. The output
MUST look indistinguishable from a hand-designed graphic produced in
Photoshop by a senior brand designer. NO stock-photo feel, NO clip-art,
NO illustration where photography is specified.

GLOBAL STYLE (applies to every Strong Group post):

Canvas
- 1080x1350 portrait. Full bleed. No borders or frames outside the canvas.
- Background: solid dark navy gradient from #0A1628 (top) to #1A2744
  (bottom), with a faint vignette and a very subtle large "STRONG"
  watermark texture barely visible in the upper-right quadrant.

Accent palette for THIS post
- Primary accent: ${accent.name.toUpperCase()} (${accent.hex})
- Use this single accent consistently for: the top-left badge outline /
  fill, ONE key word in the headline, any emphasised body fragment,
  small line-art icons, the curved wave separator above the contact
  strip, and the CTA pill button.

Typography (use clean modern type, render every letter perfectly,
absolutely no spelling errors, no fake or scrambled glyphs)
- Headline: extra-bold condensed sans-serif (Impact / Anton / Oswald
  Black style), UPPERCASE, very tight line-height (~0.9), tracked
  tight. 2-3 lines. White for most words, ONE key word in accent.
- Body text: clean geometric sans-serif (Inter / Helvetica Neue), white,
  ~28-36px, 1.35 line-height. One short fragment may be bold in accent.
- Badge label: bold uppercase, letter-spaced.
- CTA: bold uppercase inside a rounded pill button.
- Contact strip labels (PHONE / WEBSITE / EMAIL): uppercase, gold-ish
  accent (${accent.hex} or #F5A623), letter-spaced. Values directly
  beneath in white sans-serif.

Contact strip (MANDATORY, identical on every post)
- A solid darker navy bar (#0A1322) occupying the bottom ~12% of the
  canvas, full width.
- Immediately ABOVE the bar: a smooth curved wave separator line in
  accent-${accent.name} (${accent.hex}), spanning the full width,
  optionally crossing a thin gold (#F5A623) parallel wave.
- Inside the bar, four columns, vertically centered, left-to-right:
  1) STRONG GROUP LOGO on the far left:
     - 3 small blue dots stacked vertically (top, middle, bottom) on the
       left
     - a thin vertical light-grey divider line
     - "STRONG" in dark-grey uppercase with the "N" and "G" rendered in
       a blue gradient (light blue to mid blue)
     - "GROUP" in lighter grey uppercase directly below "STRONG"
     The logo must look professional, never recoloured, never distorted.
  2) PHONE block: small gold label "PHONE" stacked over white value
     "0208 763 6122".
  3) WEBSITE block: gold label "WEBSITE" over white value
     "strong-group.co.uk".
  4) EMAIL block: gold label "EMAIL" over white value
     "info@strong-group.co.uk".
- Thin gold vertical divider lines between each column.

POST-SPECIFIC LAYOUT:

${layoutBlock(layout, post, accent)}

CONTENT FOR THIS POST
- badge_label: "${(post.badge_label || post.sector || '').toUpperCase()}"
- headline:    "${headline}"
- key word in headline (render in ${accent.name}): "${keyWord}"
- body_copy:   "${post.body_copy}"
- emphasis phrase in body (render in ${accent.name}, bold):
  "${post.body_emphasis_phrase || ''}"
- cta:         "${(post.cta || 'CONTACT US TODAY').toUpperCase()}"
- image scene: ${post.image_concept || 'Editorial photo relevant to the topic, professional, dramatic lighting, UK context.'}

RENDERING RULES (do not violate)
1. The canvas MUST be portrait 1080x1350 (4:5). Never square, never wide.
2. The contact strip MUST appear at the very bottom exactly as specified.
3. The Strong Group logo MUST appear bottom-left and MUST NOT be
   replaced with another logo.
4. All English text must be spelled correctly and rendered clearly.
   No gibberish letters, no double letters, no AI-text artifacts.
5. The accent colour for this post is ${accent.name} (${accent.hex}) — do
   not introduce other strong accent colours. Gold (#F5A623) is allowed
   for the contact-strip labels and stars only.
6. Photography must be photorealistic, editorial, dramatic, UK context
   where relevant (UK PPE, UK signage, UK skylines). No cartoon, no
   illustration, no obviously AI-generated faces with extra fingers /
   distorted features.
7. No watermarks, no other brand logos, no fictional company names.
8. Output a single finished poster image, ready to publish on
   Instagram / LinkedIn / Facebook.
`.trim();
}

// -------------------------------------------------------------------
// Caption-edit prompt
// -------------------------------------------------------------------

const CAPTION_EDIT_SYSTEM_PROMPT = `
You rewrite social media captions for ${BRAND.company} on instruction
from the marketing manager. Keep the tone professional, approachable,
UK-focused, with a clear CTA. Always include 3-6 relevant hashtags
ending with #StrongGroup. Never invent statistics. Never change the
contact details.
`.trim();

module.exports = {
  CALENDAR_SYSTEM_PROMPT,
  buildCalendarUserPrompt,
  buildImagePrompt,
  CAPTION_EDIT_SYSTEM_PROMPT,
  // exported for tests / future tooling
  pickAccent,
  pickLayout,
  ACCENT_BY_THEME
};
