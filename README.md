# Strong Recruitment Group — Marketing Agent

A persistent Node.js marketing automation service for **Strong Recruitment Group**.
On the 20th of every month it auto-generates next month's social calendar
(3 posts/week + 2 blog outlines), produces on-brand 1080×1080 graphics with
OpenAI's `gpt-image-1`, sends every post to Telegram for human approval,
and on approval schedules across all 5 connected channels via the
[Zernio API](https://zernio.com).

```
GPT-4.1  ─►  monthly calendar JSON
   │
   ▼
gpt-image-1  ─►  1080×1080 PNG (saved + served at /images/<id>.png)
   │
   ▼
Telegram bot  ─►  [Approve] [Reject] [Edit Caption]
   │
   ▼ (Approve)
Zernio API   ─►  Facebook · Instagram · LinkedIn · Twitter/X · Google Business
```

---

## What it does

1. **Cron** (`0 9 20 * *`, Europe/London) — On the 20th of each month at 09:00 UK,
   it generates next month's calendar.
2. **Calendar generation** — `GPT-4.1` plans 3 posts/week (Mon/Wed/Fri 09:00)
   plus 2 blog outlines, rotating sectors and respecting the content mix
   (40% sector promos, 20% awareness days, 20% hiring/workforce, 20% reviews/spotlights).
3. **Image generation** — `gpt-image-1` produces a 1080×1080 PNG per post
   using a heavily-structured brand prompt (dark navy background, sector tag,
   bold headline, body copy, CTA button, curved gold/red wave separator,
   contact strip with logo + phone + website + email).
4. **Approval** — Each post is sent to your Telegram chat with inline buttons:
   **Approve · Reject · Edit Caption**. Edit Caption supports plain new text
   or `!ai <instruction>` to ask GPT to rewrite.
5. **Scheduling** — Approved posts are scheduled on Zernio for their planned
   date/time across the configured account IDs.
6. **Persistence** — All posts, calendars and blog outlines are stored in
   SQLite (`/app/data/agent.db`).

---

## Project structure

```
src/
  config/
    brand.js        — colours, sectors, schedule rules, contact strip
    platforms.js    — internal-key → Zernio account-id mapping
    prompts.js      — system + image prompts
    index.js        — env loader + barrel
  services/
    openaiClient.js — shared OpenAI SDK instance
    calendar.js     — monthly calendar generation + orchestration
    imageGen.js     — gpt-image-1 wrapper, saves PNG to /data/images
    telegram.js     — approval workflow (sendPhoto + inline keyboard)
    zernio.js       — REST wrapper, schedulePost()
  routes/
    status.js       — /health, /status, /posts/:monthKey, /blogs/:monthKey
    trigger.js      — POST /generate-calendar (manual), Zernio + Telegram tests
  utils/
    dates.js        — UK awareness-day lookup, Mon/Wed/Fri slot generator
    storage.js      — SQLite (better-sqlite3) persistence
    logger.js       — pino logger
  index.js          — Express boot, cron, Telegram polling
data/               — SQLite + generated images (mount as Railway volume)
assets/logo.png     — Strong Group logo (reference)
Dockerfile
railway.toml
.env.example
```

---

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `OPENAI_API_KEY` | yes | — | OpenAI key with access to `gpt-4.1` and `gpt-image-1` |
| `OPENAI_TEXT_MODEL` | no | `gpt-4.1` | |
| `OPENAI_IMAGE_MODEL` | no | `gpt-image-1` | |
| `ZERNIO_API_KEY` | yes | — | Bearer token |
| `ZERNIO_BASE_URL` | no | `https://zernio.com/api/v1` | |
| `ZERNIO_ACCOUNT_FACEBOOK` | yes | `69c00c826cb7b8cf4c8e23d9` | |
| `ZERNIO_ACCOUNT_GOOGLE` | yes | `69c014776cb7b8cf4c8e3f49` | Google Business |
| `ZERNIO_ACCOUNT_INSTAGRAM` | yes | `69c00b346cb7b8cf4c8e2090` | |
| `ZERNIO_ACCOUNT_LINKEDIN` | yes | `69c014136cb7b8cf4c8e3dd5` | |
| `ZERNIO_ACCOUNT_TWITTER` | yes | `69c0143b6cb7b8cf4c8e3e69` | Twitter/X |
| `TELEGRAM_BOT_TOKEN` | yes | — | From @BotFather |
| `TELEGRAM_CHAT_ID` | yes | — | Nick's chat id (positive int for DM, negative for group) |
| `CALENDAR_CRON` | no | `0 9 20 * *` | Standard cron, in `TZ` |
| `CALENDAR_LOOKAHEAD_MONTHS` | no | `1` | Plan N months ahead |
| `TZ` | no | `Europe/London` | |
| `PUBLIC_BASE_URL` | yes (in prod) | `http://localhost:3000` | Used in image URLs sent to Zernio |
| `DATA_DIR` | no | `./data` | Where SQLite + images live |
| `DB_FILE` | no | `./data/agent.db` | |
| `TRIGGER_SECRET` | no | — | If set, must be passed to manual trigger endpoints |
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

## Telegram approval flow

1. Agent sends each post as a photo with the formatted caption and three
   inline buttons: **Approve · Reject · Edit Caption**.
2. **Approve** → schedules on Zernio for the planned date/time and edits
   the message to show the Zernio post ID.
3. **Reject** → marks the post `rejected` and skips it.
4. **Edit Caption** → bot waits for your reply.
   - Reply with plain text → that becomes the new caption.
   - Reply with `!ai shorten and add a CTA` → GPT rewrites it on-brand.
   - Reply with `/cancel` → abort.

Bot commands (DM only):
- `/status` — counts of posts by status
- `/generate` — generate next month's calendar now
- `/help` — list commands

---

## Manual trigger endpoints

If `TRIGGER_SECRET` is set, pass it as `?secret=...` or in the
`x-trigger-secret` header.

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/health` | Liveness |
| `GET`  | `/status` | Counts + last run timestamp |
| `GET`  | `/posts/:monthKey` | List posts for a month (e.g. `2026-06`) |
| `GET`  | `/blogs/:monthKey` | List blog outlines for a month |
| `POST` | `/generate-calendar` | Generate next month now (`?lookahead=N` to override) |
| `GET`  | `/zernio/accounts` | Sanity check Zernio connection |
| `POST` | `/telegram/test` | Send a test ping to your Telegram chat |

---

## Deploy to Railway

1. Push this repo to GitHub (`JHR-1/strong-marketing-agent`).
2. In Railway → **New Project → Deploy from GitHub repo** and pick the repo.
3. Railway will auto-detect `railway.toml` + `Dockerfile`.
4. Add a **Volume** mounted at `/app/data` (persists SQLite + generated PNGs).
5. Set environment variables (copy from `.env.example`, fill in real values).
6. After first deploy, copy the Railway-assigned public URL and set:
   ```
   PUBLIC_BASE_URL=https://<your-service>.up.railway.app
   ```
   This is critical — Zernio fetches the image from this URL when posting.
7. Hit `https://<your-service>.up.railway.app/health` to confirm it's live.

The cron (`0 9 20 * *` Europe/London) will fire on the 20th of every month.
For an immediate test, hit `POST /generate-calendar` or send `/generate` to
the Telegram bot.

---

## Brand reference

- **Company:** Strong Recruitment Group Limited
- **Phone:** 0208 763 6122
- **Website:** strong-group.co.uk
- **Email:** info@strong-group.co.uk
- **Sectors:** M&E · Construction · Driving/Transport · Fit-Out & Interiors · Data Centres · Rail · Commercial · Residential
- **Visual style:** Dark navy background · gold/orange + red accents · bold uppercase headlines · curved wave separator · contact strip with logo bottom-left

The full visual rules and image prompt template live in
`src/config/prompts.js` — edit there to tune the look and feel.

---

## License

UNLICENSED — internal use by Strong Recruitment Group / JHR-1.
