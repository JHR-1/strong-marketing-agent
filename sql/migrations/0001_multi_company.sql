-- ===================================================================
-- Migration 0001 — Multi-company namespacing
--
-- This migration adds a `company` column to `calendars`, `posts`, and
-- `blogs` so the agent can hold data for multiple companies (Strong
-- Recruitment Group, Zentra Peptides, ...) in the same Supabase
-- project without collisions.
--
-- Run once in the Supabase SQL editor (or via psql). It is idempotent:
-- it uses ADD COLUMN IF NOT EXISTS, IF EXISTS / IF NOT EXISTS guards,
-- and only relabels rows that don't already have a company set.
-- ===================================================================

-- 1) Add the `company` column to each table.
ALTER TABLE calendars ADD COLUMN IF NOT EXISTS company TEXT;
ALTER TABLE posts     ADD COLUMN IF NOT EXISTS company TEXT;
ALTER TABLE blogs     ADD COLUMN IF NOT EXISTS company TEXT;

-- 2) Backfill every existing row to the legacy default company.
UPDATE calendars SET company = 'strong' WHERE company IS NULL;
UPDATE posts     SET company = 'strong' WHERE company IS NULL;
UPDATE blogs     SET company = 'strong' WHERE company IS NULL;

-- 3) Replace the old single-column UNIQUE(month_key) on `calendars`
--    with a composite UNIQUE(company, month_key) so the same month_key
--    can exist once per company.
DO $$
BEGIN
  -- Drop the old unique constraint if it still exists.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'calendars_month_key_key'
      AND conrelid = 'calendars'::regclass
  ) THEN
    EXECUTE 'ALTER TABLE calendars DROP CONSTRAINT calendars_month_key_key';
  END IF;
END
$$;

-- Add the new composite unique if it isn't there already.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'calendars_company_month_key_key'
      AND conrelid = 'calendars'::regclass
  ) THEN
    EXECUTE 'ALTER TABLE calendars ADD CONSTRAINT calendars_company_month_key_key UNIQUE (company, month_key)';
  END IF;
END
$$;

-- 4) Helpful indexes for the new lookup pattern.
CREATE INDEX IF NOT EXISTS idx_calendars_company         ON calendars(company);
CREATE INDEX IF NOT EXISTS idx_calendars_company_month   ON calendars(company, month_key);

CREATE INDEX IF NOT EXISTS idx_posts_company             ON posts(company);
CREATE INDEX IF NOT EXISTS idx_posts_company_month       ON posts(company, month_key);
CREATE INDEX IF NOT EXISTS idx_posts_company_month_num   ON posts(company, month_key, post_number);

CREATE INDEX IF NOT EXISTS idx_blogs_company             ON blogs(company);
CREATE INDEX IF NOT EXISTS idx_blogs_company_month       ON blogs(company, month_key);

-- 5) (Optional) Set the default for future inserts so any client that
--    forgets to send `company` keeps writing into the Strong namespace.
ALTER TABLE calendars ALTER COLUMN company SET DEFAULT 'strong';
ALTER TABLE posts     ALTER COLUMN company SET DEFAULT 'strong';
ALTER TABLE blogs     ALTER COLUMN company SET DEFAULT 'strong';
