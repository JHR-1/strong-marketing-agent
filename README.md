# Strong Recruitment Group — Marketing Agent

A persistent Node.js marketing automation service for **Strong Recruitment Group**.
Once a month it plans the full content calendar for next month
(12 social posts + 2 blog posts), sends it to Telegram for review,
accepts user-uploaded images from ChatGPT 5.5, matches each image to a
post, and then schedules every post across all five connected channels
via the [Zernio](https://zernio.com) API.

```
GPT-4.1            →  monthly content calendar (12 social + 2 blog)
                      → topic / caption / hashtags / image idea
Telegram bot       →  shows you the calendar for review
You (ChatGPT 5.5)  →  create each image, send to the bot
Telegram bot       →  ask "which post number?", attach image
/schedule          →  Zernio schedules everything across
                      Facebook · Instagram · LinkedIn · Twitter/X · Google Business
```

The agent no longer generates images itself — Nick designs them in
ChatGPT 5.5 following the in-house style guide
(`assets/style-guide.md`) and uploads them via Telegram.

---

## What it does

1. **Calendar planning** — On `/generate` (or the monthly cron, default
   `0 9 20 * *` Europe/London) `GPT-4.1` plans:
   - **12 social posts** scheduled Mon / Wed / Fri at 09:00 UK across
     the next 4 weeks.
   - **2 blog posts** scheduled on dedicated Mon/Wed/Fri slots later in
     the month and published as social-media promo posts (blog image +
     promo caption + blog link).
   - Content mix rotates across all 7 sectors (M&E, Construction,
     Driving & Transport, Data Centres, Rail & Infrastructure, Fit-Out
     & Interiors, Residential) and the main UK / international
     awareness days.
2. **Review** — The Telegram bot sends the full calendar as a numbered
   list (1–14). Each entry shows the topic, scheduled date/time,
   caption, hashtags, and a suggested image description.
3. **Image collection** — You create each image in ChatGPT 5.5 and
   send them to the bot. For every photo the bot asks "which post
   number?" — reply with the number, or send the photo with the number
   already in the caption ("3").
4. **Scheduling** — `/schedule` pushes all 14 posts to Zernio for
   their planned date/time across **Facebook, Instagram, LinkedIn,
   Twitter/X and Google Business**. Blog promo posts include the blog
   URL (set with `/seturl <post#> <url>`) appended to the caption.
5. **Persistence** — Calendars, posts, blogs and Zernio post IDs are
   stored in **Supabase** (Postgres) via the `@supabase/supabase-js`
   client, so post history survives container restarts and Railway
   redeploys. User-uploaded images are still stored on disk under
   `/app/data/images/` and served at `${PUBLIC_BASE_URL}/images/<file>`
   so Zernio can fetch them. The schema lives in `sql/schema.sql`.

---

## Telegram commands

| Command | What it does |
|---|---|
| `/generate` | Plan next month's calendar (12 social posts + 2 blog posts) and send it for review |
| `/calendar` | Re-send the active calendar |
| `/status`   | Show which posts already have an image and which still need one |
| `/seturl <post#> <url>` | Set the blog URL for a blog promo post (replaces `<BLOG_URL>` in the caption) |
| `/schedule` | Once every post has an image, schedule all 14 posts on Zernio |
| `/reset`    | Wipe the active calendar and start over |
| `/cancel`   | Cancel a pending image assignment |
| `/help`     | Show the commands list |

When you send a photo without a caption number, the bot replies with a
numbered list of all 14 posts and asks which one the image is for.
You can also reply to the bot's "which post?" question with any
integer, or send the photo with the number already in the caption.

---

## Project structure

```
src/
  config/
    brand.js        — sectors, schedule rules, hashtag packs
    platforms.js    — internal-key → Zernio account-id mapping
    prompts.js      — calendar generator + caption-edit prompts
    index.js        — env loader + barrel
  services/
    openaiClient.js — shared OpenAI SDK instance
    calendar.js     — monthly calendar generation (no image gen)
    telegram.js     — review / upload / match / schedule workflow
    zernio.js       — REST wrapper, schedulePost()
  routes/
    status.js       — /health, /status, /posts/:monthKey, /blogs/:monthKey
    trigger.js      — POST /generate-calendar (manual), Zernio + Telegram tests
  utils/
    dates.js        — UK awareness-day lookup, Mon/Wed/Fri slot generator
    storage.js      — Supabase (Postgres) persistence — async API
    logger.js       — pino logger
  index.js          — Express boot, cron, Telegram polling
sql/
  schema.sql        — Run once in the Supabase SQL editor
data/               — User-uploaded images (Railway volume; no DB files)
assets/
  logo.png          — Strong Group logo (reference for ChatGPT image briefs)
  style-guide.md    — visual style guide Nick follows in ChatGPT 5.5
Dockerfile
railway.toml
.env.example
```

---

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `OPENAI_API_KEY` | yes | — | OpenAI key with access to `gpt-4.1` |
| `OPENAI_TEXT_MODEL` | no | `gpt-4.1` | |
| `OPENAI_BASE_URL` | no | `https://api.openai.com/v1` | |
| `ZERNIO_API_KEY` | yes | — | Bearer token |
| `ZERNIO_BASE_URL` | no | `https://zernio.com/api/v1` | |
| `ZERNIO_ACCOUNT_FACEBOOK` | yes | `69c00c826cb7b8cf4c8e23d9` | |
| `ZERNIO_ACCOUNT_GOOGLE` | yes | `69c014776cb7b8cf4c8e3f49` | Google Business |
| `ZERNIO_ACCOUNT_INSTAGRAM` | yes | `69c00b346cb7b8cf4c8e2090` | |
| `ZERNIO_ACCOUNT_LINKEDIN` | yes | `69c014136cb7b8cf4c8e3dd5` | |
| `ZERNIO_ACCOUNT_TWITTER` | yes | `69c0143b6cb7b8cf4c8e3e69` | Twitter/X |
| `TELEGRAM_BOT_TOKEN` | yes | — | From @BotFather |
| `TELEGRAM_CHAT_ID` | yes | — | Nick's Telegram chat ID |
| `CALENDAR_CRON` | no | `0 9 20 * *` | Standard cron in `TZ` |
| `CALENDAR_LOOKAHEAD_MONTHS` | no | `1` | Plan N months ahead |
| `TZ` | no | `Europe/London` | |
| `PUBLIC_BASE_URL` | **yes (prod)** | `http://localhost:3000` | Used in image URLs sent to Zernio |
| `DATA_DIR` | no | `./data` | Where uploaded images live (mount a Railway volume here) |
| `SUPABASE_URL` | yes | — | e.g. `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_KEY` | yes | — | Service role key (server-side only — never the anon key) |
| `TRIGGER_SECRET` | no | — | Required header / query param for `POST /generate-calendar` |
| `LOG_LEVEL` | no | `info` | `trace`/`debug`/`info`/`warn`/`error` |
| `PORT` | no | `3000` | |

Copy `.env.example` to `.env` and fill in the blanks for local dev.

---

## Local development

```bash
git clone https://github.com/JHR-1/strong-marketing-agent.git
cd strong-marketing-agent
cp .env.example .env        # fill in OPENAI_API_KEY, ZERNIO_*, TELEGRAM_*
npm install
npm run dev
```

The agent will:
- listen on `http://localhost:3000`
- start polling Telegram (if `TELEGRAM_BOT_TOKEN` is set)
- arm the monthly cron job

To trigger a calendar generation right now:

```bash
curl -X POST "http://localhost:3000/generate-calendar"
```

(or send `/generate` to the Telegram bot)

---

## HTTP endpoints

If `TRIGGER_SECRET` is set, pass it as `?secret=...` or in the
`x-trigger-secret` header for the protected routes.

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/health` | Liveness probe |
| `GET`  | `/status` | Counts + last run timestamp |
| `GET`  | `/posts/:monthKey` | List posts for a month (e.g. `2026-06`) |
| `GET`  | `/blogs/:monthKey` | List blog records for a month |
| `POST` | `/generate-calendar` | Generate next month's calendar (`?lookahead=N` to override) |
| `GET`  | `/zernio/accounts` | Sanity check Zernio connection |
| `POST` | `/telegram/test` | Send a test ping to your Telegram chat |
| `GET`  | `/images/<file>` | User-uploaded images, served to Zernio |

---

## Deploy to Railway

1. Push this repo to GitHub (`JHR-1/strong-marketing-agent`).
2. In Railway → **New Project → Deploy from GitHub repo** and pick the repo.
3. Railway will auto-detect `railway.toml` + `Dockerfile`.
4. Create a Supabase project and run `sql/schema.sql` in the SQL
   editor. Grab the **Project URL** and the **service role key** from
   *Project Settings → API*.
5. Add a **Volume** mounted at `/app/data` so user-uploaded images
   survive restarts and remain reachable for Zernio.
6. Set environment variables (copy from `.env.example`), including
   `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`.
7. After first deploy, copy the Railway public URL and set:
   ```
   PUBLIC_BASE_URL=https://strong-marketing-agent-production.up.railway.app
   ```
   This is critical — Zernio fetches every image from this URL when
   it publishes a post.
8. Hit `https://<your-service>.up.railway.app/health` to confirm it's live.

The cron (`0 9 20 * *` Europe/London) fires on the 20th of every month
to plan the upcoming month. For an immediate test, send `/generate` to
the Telegram bot.

---

## Brand reference

- **Company:** Strong Recruitment Group Limited
- **Phone:** 0208 763 6122
- **Website:** strong-group.co.uk
- **Email:** info@strong-group.co.uk
- **Sectors:** M&E · Construction · Driving & Transport · Data Centres · Rail & Infrastructure · Fit-Out & Interiors · Residential
- **Image style:** Nick designs every graphic in ChatGPT 5.5 following
  `assets/style-guide.md` — dark navy gradient background, single
  topic-driven accent colour, massive condensed uppercase headline with
  one accent key word, pill badge top-left, photoreal editorial
  imagery, curved wave separator above the contact strip, and the
  Strong Group contact strip at the bottom.

---

## License

UNLICENSED — internal use by Strong Recruitment Group / JHR-1.
