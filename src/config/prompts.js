/**
 * Prompt library for OpenAI text and image generation.
 *
 * The image prompt is heavily structured so that gpt-image-1 produces
 * results visually close to ChatGPT's native image generation: 1080x1080,
 * dark navy background, sector tag, bold headline, body copy, CTA button,
 * curved wave separator, and full Strong Group contact strip.
 */

const BRAND = require('./brand');

/**
 * System prompt for the GPT-4.1 calendar generator.
 */
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
  the target month (you may also propose evergreen industry topics)
- Adds 2 blog post outlines (not posted to social) per month
- Writes captions in a professional, approachable, UK-focused tone with
  a clear CTA (e.g. "Contact us today", "Are you ready?")
- Captions ready to publish, no placeholder text, 1-3 short paragraphs
- Includes 3-6 relevant hashtags per caption (always include #StrongGroup)

Always respond with valid JSON matching the schema you are given.
`.trim();

/**
 * Returns a structured user prompt for a given month.
 */
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
      "headline": "BOLD UPPERCASE HEADLINE FOR THE IMAGE",
      "body_copy": "Short on-image body line (max 12 words)",
      "cta": "Short CTA button text (max 4 words)",
      "caption": "Full publish-ready caption with hashtags",
      "platforms": ["linkedin","facebook","instagram","twitter"],
      "image_concept": "1-3 sentences describing the photographic scene"
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
- Social posts must fall on Mon, Wed or Fri only.
- 3 posts per week, every week of the month (a partial first/last week is fine).
- ${BRAND.schedule.blogsPerMonth} blog outlines.
- Content mix: ~40% sector promos, 20% awareness days, 20% hiring tips/workforce planning, 20% client reviews/staff spotlights.
- Never repeat the same sector in consecutive posts.
- Headline must be uppercase and <= 6 words.
`.trim();
}

/**
 * Build the gpt-image-1 prompt for a single post.
 */
function buildImagePrompt(post) {
  const sector = post.sector && post.sector !== 'General' ? post.sector : 'STRONG GROUP';
  const palette = `
Background: dark navy blue (${BRAND.colours.background}).
Accent colours: gold/orange (${BRAND.colours.accentGold} / ${BRAND.colours.accentOrange})
and red/crimson (${BRAND.colours.accentRed}). Occasional cyan (${BRAND.colours.accentCyan}).
All on-image text in clean bold sans-serif, white or gold.
`.trim();

  return `
Create a professional 1080x1080 pixel square social media graphic for
${BRAND.company}, a UK specialist recruitment company.

LAYOUT (top to bottom):
1. Sector tag pill in the TOP-LEFT corner: small uppercase text on a
   thin gold/orange outlined pill, reading "${sector.toUpperCase()}".
2. Hero photographic area filling roughly the top 55% of the canvas.
   Photo subject: ${post.image_concept}
   The photo should look like a high-end editorial construction / M&E /
   transport photograph (workers in PPE, real UK site context where
   appropriate) with a subtle dark navy gradient overlay so text on top
   stays legible.
3. Bold uppercase HEADLINE centered or left-aligned over the lower part
   of the hero image: "${post.headline}". White text with a tasteful
   gold underline accent.
4. One short BODY line beneath the headline: "${post.body_copy}".
   Slightly smaller, white or muted gold.
5. CTA BUTTON below the body: rounded rectangle filled gold/orange
   (${BRAND.colours.accentGold}) with dark navy uppercase text reading
   "${post.cta || 'CONTACT US TODAY'}".
6. CURVED WAVE SEPARATOR: a smooth curved line in gold transitioning to
   red, spanning the full width, sitting just above the contact strip.
7. CONTACT STRIP at the very bottom (full width, dark navy, ~10% of
   canvas height) containing, left to right with comfortable spacing:
   - The Strong Group logo on the far left: 3 blue dots stacked
     vertically, a thin grey vertical divider, then "STRONG" in dark
     grey uppercase with the "NG" in a blue gradient, and "GROUP" in
     lighter grey uppercase beneath it.
   - Phone: "${BRAND.phone}"
   - Website: "${BRAND.website}"
   - Email: "${BRAND.email}"
   Each contact item preceded by a small gold icon (phone, globe, envelope).

STYLE & PALETTE:
${palette}

RULES:
- Square 1080x1080. No borders or frames outside the canvas.
- Absolutely no spelling mistakes; render every letter cleanly.
- Photographic, not cartoon or illustration.
- UK context (UK PPE, UK signage where visible).
- No fake logos other than the Strong Group logo described above.
- Output a single finished poster image, ready for Instagram/LinkedIn.

CONTENT TYPE NOTE: This post is a "${post.content_type}". Adapt the
tone of the imagery accordingly (e.g. testimonial = quote card style
with a 5-star rating instead of a hero photo; staff spotlight =
polaroid-style portrait pinned on navy).
`.trim();
}

/**
 * Build a system prompt used when the user wants to *edit* a caption
 * via Telegram. Keeps the rewrite on-brand.
 */
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
  CAPTION_EDIT_SYSTEM_PROMPT
};
