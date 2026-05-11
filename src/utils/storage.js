/**
 * Lightweight SQLite-backed persistence for the marketing agent.
 *
 * Tables:
 *   posts       - every generated post and its lifecycle state
 *   blogs       - generated blog outlines
 *   calendars   - one row per generated monthly calendar
 *   settings    - misc key/value (e.g. last-run timestamps)
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { env } = require('../config');
const logger = require('./logger');

let db;

function getDb() {
  if (db) return db;
  const file = path.resolve(env.dbFile);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  initSchema(db);
  logger.info({ file }, 'SQLite database opened');
  return db;
}

function initSchema(d) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS calendars (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      month_key    TEXT NOT NULL UNIQUE,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      raw_json     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS posts (
      id              TEXT PRIMARY KEY,
      calendar_id     INTEGER REFERENCES calendars(id),
      month_key       TEXT NOT NULL,
      scheduled_for   TEXT NOT NULL,
      sector          TEXT,
      content_type    TEXT,
      badge_label     TEXT,
      headline        TEXT,
      headline_key_word TEXT,
      body_copy       TEXT,
      body_emphasis_phrase TEXT,
      cta             TEXT,
      caption         TEXT,
      caption_quote   TEXT,
      attribution     TEXT,
      platforms_json  TEXT,
      image_concept   TEXT,
      image_path      TEXT,
      image_url       TEXT,
      status          TEXT NOT NULL DEFAULT 'draft',
      telegram_message_id INTEGER,
      zernio_post_id  TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
    CREATE INDEX IF NOT EXISTS idx_posts_telegram ON posts(telegram_message_id);

    CREATE TABLE IF NOT EXISTS blogs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      calendar_id     INTEGER REFERENCES calendars(id),
      month_key       TEXT NOT NULL,
      title           TEXT,
      tone            TEXT,
      target_word_count INTEGER,
      outline_json    TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

// ------------------------- calendars -----------------------------
function saveCalendar(monthKey, payload) {
  const d = getDb();
  const stmt = d.prepare(`
    INSERT INTO calendars (month_key, raw_json) VALUES (?, ?)
    ON CONFLICT(month_key) DO UPDATE SET
      raw_json   = excluded.raw_json,
      created_at = datetime('now')
    RETURNING id;
  `);
  const row = stmt.get(monthKey, JSON.stringify(payload));
  return row.id;
}

function getCalendar(monthKey) {
  const d = getDb();
  const row = d.prepare('SELECT * FROM calendars WHERE month_key = ?').get(monthKey);
  if (!row) return null;
  return { ...row, raw: JSON.parse(row.raw_json) };
}

// ------------------------- posts ---------------------------------
function insertPost(post) {
  const d = getDb();
  const stmt = d.prepare(`
    INSERT INTO posts (
      id, calendar_id, month_key, scheduled_for, sector, content_type,
      badge_label, headline, headline_key_word, body_copy,
      body_emphasis_phrase, cta, caption, caption_quote, attribution,
      platforms_json, image_concept, status
    ) VALUES (
      @id, @calendar_id, @month_key, @scheduled_for, @sector, @content_type,
      @badge_label, @headline, @headline_key_word, @body_copy,
      @body_emphasis_phrase, @cta, @caption, @caption_quote, @attribution,
      @platforms_json, @image_concept, 'draft'
    )
  `);
  stmt.run({
    badge_label: null,
    headline_key_word: null,
    body_emphasis_phrase: null,
    caption_quote: null,
    attribution: null,
    ...post,
    platforms_json: JSON.stringify(post.platforms || [])
  });
}

function updatePost(id, patch) {
  const d = getDb();
  const fields = [];
  const values = {};
  for (const [k, v] of Object.entries(patch)) {
    fields.push(`${k} = @${k}`);
    values[k] = v;
  }
  if (!fields.length) return;
  values.id = id;
  d.prepare(
    `UPDATE posts SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = @id`
  ).run(values);
}

function getPost(id) {
  const d = getDb();
  const row = d.prepare('SELECT * FROM posts WHERE id = ?').get(id);
  if (!row) return null;
  return hydratePost(row);
}

function getPostByTelegramMessage(messageId) {
  const d = getDb();
  const row = d
    .prepare('SELECT * FROM posts WHERE telegram_message_id = ?')
    .get(messageId);
  if (!row) return null;
  return hydratePost(row);
}

function listPostsByMonth(monthKey) {
  const d = getDb();
  const rows = d
    .prepare('SELECT * FROM posts WHERE month_key = ? ORDER BY scheduled_for ASC')
    .all(monthKey);
  return rows.map(hydratePost);
}

function listPostsByStatus(status) {
  const d = getDb();
  const rows = d
    .prepare('SELECT * FROM posts WHERE status = ? ORDER BY scheduled_for ASC')
    .all(status);
  return rows.map(hydratePost);
}

function countByStatus() {
  const d = getDb();
  return d
    .prepare('SELECT status, COUNT(*) as count FROM posts GROUP BY status')
    .all();
}

function hydratePost(row) {
  return {
    ...row,
    platforms: row.platforms_json ? JSON.parse(row.platforms_json) : []
  };
}

// ------------------------- blogs ---------------------------------
function insertBlog(blog) {
  const d = getDb();
  d.prepare(
    `INSERT INTO blogs (calendar_id, month_key, title, tone, target_word_count, outline_json)
     VALUES (@calendar_id, @month_key, @title, @tone, @target_word_count, @outline_json)`
  ).run({
    ...blog,
    outline_json: JSON.stringify(blog.outline || [])
  });
}

function listBlogsByMonth(monthKey) {
  const d = getDb();
  return d
    .prepare('SELECT * FROM blogs WHERE month_key = ? ORDER BY id ASC')
    .all(monthKey)
    .map((r) => ({ ...r, outline: JSON.parse(r.outline_json || '[]') }));
}

// ------------------------- settings ------------------------------
function setSetting(key, value) {
  const d = getDb();
  d.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}

function getSetting(key) {
  const d = getDb();
  const row = d.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

module.exports = {
  getDb,
  saveCalendar,
  getCalendar,
  insertPost,
  updatePost,
  getPost,
  getPostByTelegramMessage,
  listPostsByMonth,
  listPostsByStatus,
  countByStatus,
  insertBlog,
  listBlogsByMonth,
  setSetting,
  getSetting
};
