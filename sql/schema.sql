-- Strong / Zentra Marketing Agent — Supabase schema
-- Run this once in the Supabase SQL editor (or via psql) against the
-- project referenced by SUPABASE_URL.
--
-- For an existing deployment that already has the original single-
-- company schema, run sql/migrations/0001_multi_company.sql instead —
-- it adds the `company` column, backfills 'strong', and swaps the
-- UNIQUE(month_key) constraint for UNIQUE(company, month_key).

CREATE TABLE IF NOT EXISTS calendars (
  id          SERIAL PRIMARY KEY,
  company     TEXT NOT NULL DEFAULT 'strong',
  month_key   TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'awaiting_images',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_json    JSONB NOT NULL,
  CONSTRAINT calendars_company_month_key_key UNIQUE (company, month_key)
);

CREATE INDEX IF NOT EXISTS idx_calendars_company       ON calendars(company);
CREATE INDEX IF NOT EXISTS idx_calendars_company_month ON calendars(company, month_key);

CREATE TABLE IF NOT EXISTS posts (
  id                      TEXT PRIMARY KEY,
  company                 TEXT NOT NULL DEFAULT 'strong',
  calendar_id             INTEGER REFERENCES calendars(id),
  month_key               TEXT NOT NULL,
  post_number             INTEGER NOT NULL,
  kind                    TEXT NOT NULL DEFAULT 'social',
  blog_id                 INTEGER,
  scheduled_for           TIMESTAMPTZ NOT NULL,
  sector                  TEXT,
  content_type            TEXT,
  topic                   TEXT,
  caption                 TEXT,
  hashtags_json           JSONB,
  image_description       TEXT,
  image_path              TEXT,
  image_url               TEXT,
  image_telegram_file_id  TEXT,
  platforms_json          JSONB,
  status                  TEXT NOT NULL DEFAULT 'awaiting_image',
  zernio_post_id          TEXT,
  schedule_error          TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_posts_month             ON posts(month_key);
CREATE INDEX IF NOT EXISTS idx_posts_status            ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_number            ON posts(month_key, post_number);
CREATE INDEX IF NOT EXISTS idx_posts_company           ON posts(company);
CREATE INDEX IF NOT EXISTS idx_posts_company_month     ON posts(company, month_key);
CREATE INDEX IF NOT EXISTS idx_posts_company_month_num ON posts(company, month_key, post_number);

CREATE TABLE IF NOT EXISTS blogs (
  id                SERIAL PRIMARY KEY,
  company           TEXT NOT NULL DEFAULT 'strong',
  calendar_id       INTEGER REFERENCES calendars(id),
  month_key         TEXT NOT NULL,
  topic             TEXT,
  blog_description  TEXT,
  url               TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blogs_company       ON blogs(company);
CREATE INDEX IF NOT EXISTS idx_blogs_company_month ON blogs(company, month_key);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
