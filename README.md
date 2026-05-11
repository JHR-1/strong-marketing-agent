# Marketing Agent — Strong Recruitment Group & Zentra Peptides

A Node.js marketing agent that generates monthly social-media content calendars, lets a single Telegram operator review them, accepts user-supplied ChatGPT-generated images, and schedules everything across each company's social channels via [Zernio](https://zernio.com/). Storage is backed by Supabase (Postgres).

The agent now supports **multiple companies in a single deployment**. The Telegram operator switches between them with the `/company` command, and the monthly cron generates a calendar for every configured company in turn.

## Configured companies

| Slug | Brand | Platforms | Zernio profile |
|---|---|---|---|
| `strong` | Strong Recruitment Group | Facebook · Instagram · LinkedIn · Twitter/X · Google Business | `69c00b0b467c216082612e75` |
| `zentra` | Zentra Peptides (ZENTRA) | Facebook · Instagram · Twitter/X | `6a0215e005cbe2cbf1a929d2` |

Strong Recruitment Group continues to behave exactly as before. Its prompts, sectors, tone, hashtags, 12-social-plus-2-blog monthly structure, and 5-channel scheduling are unchanged.

Zentra Peptides is a pre-launch UK research-compound brand. Its prompts enforce strict research-use-only compliance, mandate the disclaimer "For research use only. Not for human or veterinary consumption." on every caption, use pre-launch waiting-list CTAs only, and post only to Facebook, Instagram and Twitter/X. Zentra has no blog yet, so its monthly structure is 12 social posts and 0 blog promo posts.

## Workflow

The operator picks a company with `/company strong` or `/company zentra` (the selection persists per chat). `/generate` plans the next month's calendar for the active company and renders it in Telegram. The operator creates each image in ChatGPT 5.5 and sends them as photos or image documents — the bot asks which post number each image belongs to (or accepts the number in the photo caption). `/status` shows which posts still need an image, and `/seturl <post#> <url>` sets a blog URL for blog promo posts (Strong only). `/schedule` publishes the entire calendar to Zernio across the active company's configured channels. The monthly cron at 09:00 on the 20th (Europe/London) runs the generation step for every configured company automatically and posts each calendar into Telegram.

## Telegram commands

| Command | Description |
|---|---|
| `/company` | Show the active company and the list of available companies. |
| `/company <slug>` | Switch the active company (e.g. `/company zentra`). |
| `/generate` | Generate next month's calendar for the active company. |
| `/calendar` | Re-send the current calendar for the active company. |
| `/status` | Show post status for the active company. |
| `/seturl <post#> <url>` | Set a blog URL for a blog promo post (Strong only). |
| `/schedule` | Schedule everything on Zernio for the active company. |
| `/reset` | Wipe the active calendar for the active company. |
| `/cancel` | Cancel a pending image assignment. |
| `/help` | Show available commands. |

## Project structure

```
src/
  index.js                       — entry point + multi-company cron
  config/
    index.js                     — env + company registry exports
    brand.js                     — legacy alias → Strong brand
    platforms.js                 — Zernio platform helpers (company-aware)
    prompts.js                   — legacy alias → Strong prompts
    companies/
      index.js                   — registry: listCompanies(), getCompany(slug)
      strong.js                  — Strong Recruitment Group brand + prompts + Zernio
      zentra.js                  — Zentra Peptides brand + prompts + Zernio
  services/
    calendar.js                  — monthly calendar generator (per company)
    zernio.js                    — Zernio API wrapper (per company)
    telegram.js                  — Telegram bot + /company switching
    openaiClient.js              — shared OpenAI client
  routes/
    status.js                    — /health, /status, /posts/:m, /blogs/:m
    trigger.js                   — admin POST endpoints
  utils/
    storage.js                   — Supabase data access (company-scoped)
    dates.js                     — month / awareness-day helpers
    logger.js                    — pino logger
sql/
  schema.sql                     — fresh-install schema (includes company column)
  migrations/
    0001_multi_company.sql       — additive migration for existing deployments
```

## Environment variables

See `.env.example` for the full list. The previous Strong-only variables (`ZERNIO_PROFILE_ID`, `ZERNIO_ACCOUNT_FACEBOOK`, etc.) still work as the Strong company's account IDs. New per-company variables `ZERNIO_ZENTRA_PROFILE_ID` and `ZERNIO_ZENTRA_ACCOUNT_{FACEBOOK,INSTAGRAM,TWITTER}` drive Zentra. Set `DEFAULT_COMPANY_SLUG=strong` (default) to keep new Telegram chats opening on Strong.

## Supabase migration

The data model now namespaces each calendar, post, and blog by company. **Run `sql/migrations/0001_multi_company.sql` once in Supabase before deploying this version.** The migration is idempotent: it adds a `company TEXT` column to `calendars`, `posts`, and `blogs` (default `'strong'`), backfills every existing row to `company='strong'`, drops the old `UNIQUE(month_key)` constraint on `calendars`, replaces it with `UNIQUE(company, month_key)`, and creates supporting per-company indexes.

Existing Strong Recruitment Group data is fully preserved. The agent's storage helpers also treat any row with a NULL `company` value as belonging to the default Strong company, so the migration is forgiving if it has not been run yet — Strong will keep working, and Zentra writes will use `company='zentra'`.

## Settings keys

Settings are now scoped per company using the `<base>:<slug>` convention, for example `last_calendar_month:strong`, `last_calendar_month:zentra`, `last_calendar_run_at:strong`, `last_calendar_run_at:zentra`. For the default Strong company the legacy un-scoped keys (`last_calendar_month`, `last_calendar_run_at`) continue to be read and written for backwards compatibility. The per-chat active company is persisted in `active_company:<chatId>`.

## HTTP endpoints

All admin endpoints accept an optional `?company=<slug>` query string (default `strong`). `/generate-calendar` additionally accepts `?company=all` to run generation for every configured company in one call.

| Method | Path | Description |
|---|---|---|
| GET | `/` | Service banner; lists configured companies. |
| GET | `/health` | Liveness probe. |
| GET | `/status?company=strong\|zentra\|all` | Post status counts. |
| GET | `/posts/:monthKey?company=strong\|zentra` | All posts for a (company, month). |
| GET | `/blogs/:monthKey?company=strong\|zentra` | All blogs for a (company, month). |
| GET | `/companies` | List configured companies and their Zernio profiles. |
| POST | `/generate-calendar?company=strong\|zentra\|all` | Manually run calendar generation. |
| POST | `/seed-calendar` | Restore data without calling the LLM (body `{company, monthKey, posts, blogs}`). |
| POST | `/schedule-all?company=strong\|zentra` | Schedule every image-ready post on Zernio. |
| GET | `/zernio/accounts` | Sanity check the Zernio connection. |
| POST | `/telegram/test` | Send a test message via the Telegram bot. |

## Local development

```bash
cp .env.example .env
npm install
npm run dev
```

## Railway deployment

The project deploys directly to Railway. Push to `main` to trigger the existing deploy pipeline. Before the first multi-company deploy, run `sql/migrations/0001_multi_company.sql` in Supabase and add the `ZERNIO_ZENTRA_*` variables in Railway when you have the Zentra Zernio account IDs.

## Brand reference

The Strong Recruitment Group brand details (company, phone, website, email, sectors, voice) are unchanged — they live in `src/config/companies/strong.js`. The Zentra Peptides brand details (ZENTRA, zentra-peptides.com, research-use-only compliance, premium clinical visual direction, mandatory disclaimer, pre-launch CTAs) live in `src/config/companies/zentra.js`. To add a third company in future, drop a new module in `src/config/companies/` exposing the same shape and add it to the registry in `companies/index.js`.

## License

UNLICENSED — internal use by JHR-1.
