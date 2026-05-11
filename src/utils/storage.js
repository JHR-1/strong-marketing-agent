/**
 * SQLite-backed persistence for the Strong Group marketing agent.
 *
 * Tables:
 *   calendars  — one row per generated monthly calendar
 *   posts      — every social post (incl. blog promo posts) and its
 *                lifecycle state, including which user-uploaded image
 *                is attached and where it lives on disk / via the
 *                public /images URL
 *   blogs      — blog post records (topic, description, link to the
 *                promo post that publishes them)
 *   settings   — misc key/value (e.g. last-run timestamps,
 *                current_month, active calendar id)
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
      status       TEXT NOT NULL DEFAULT 'awaiting_images',
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      raw_json     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS posts (
      id              TEXT PRIMARY KEY,
      calendar_id     INTEGER REFERENCES calendars(id),
      month_key       TEXT NOT NULL,
      post_number     INTEGER NOT NULL,
      kind            TEXT NOT NULL DEFAULT 'social',  -- 'social' | 'blog_promo'
      blog_id         INTEGER,                          -- set for kind='blog_promo'
      scheduled_for   TEXT NOT NULL,
      sector          TEXT,
      content_type    TEXT,
      topic           TEXT,
      caption         TEXT,
      hashtags_json   TEXT,
      image_description TEXT,
      image_path      TEXT,
      image_url       TEXT,
      image_telegram_file_id TEXT,
      platforms_json  TEXT,
      status          TEXT NOT NULL DEFAULT 'awaiting_image',
        -- 'awaiting_image' | 'image_attached' | 'scheduling'
        -- | 'scheduled'    | 'schedule_failed' | 'cancelled'
      zernio_post_id  TEXT,
      schedule_error  TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_posts_month ON posts(month_key);
    CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
    CREATE INDEX IF NOT EXISTS idx_posts_number ON posts(month_key, post_number);

    CREATE TABLE IF NOT EXISTS blogs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      calendar_id     INTEGER REFERENCES calendars(id),
      month_key       TEXT NOT NULL,
      topic           TEXT,
      blog_description TEXT,
      url             TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

// ------------------------- calendars -----------------------------
function saveCalendar(monthKey, payload, status = 'awaiting_images') {
  const d = getDb();
  const stmt = d.prepare(`
    INSERT INTO calendars (month_key, raw_json, status) VALUES (?, ?, ?)
    ON CONFLICT(month_key) DO UPDATE SET
      raw_json   = excluded.raw_json,
      status     = excluded.status,
      created_at = datetime('now')
    RETURNING id;
  `);
  const row = stmt.get(monthKey, JSON.stringify(payload), status);
  return row.id;
}

function getCalendar(monthKey) {
  const d = getDb();
  const row = d.prepare('SELECT * FROM calendars WHERE month_key = ?').get(monthKey);
  if (!row) return null;
  return { ...row, raw: JSON.parse(row.raw_json) };
}

function updateCalendarStatus(monthKey, status) {
  const d = getDb();
  d.prepare('UPDATE calendars SET status = ? WHERE month_key = ?').run(status, monthKey);
}

// ------------------------- posts ---------------------------------
function insertPost(post) {
  const d = getDb();
  const stmt = d.prepare(`
    INSERT INTO posts (
      id, calendar_id, month_key, post_number, kind, blog_id,
      scheduled_for, sector, content_type, topic, caption,
      hashtags_json, image_description, platforms_json, status
    ) VALUES (
      @id, @calendar_id, @month_key, @post_number, @kind, @blog_id,
      @scheduled_for, @sector, @content_type, @topic, @caption,
      @hashtags_json, @image_description, @platforms_json,
      'awaiting_image'
    )
  `);
  stmt.run({
    kind: 'social',
    blog_id: null,
    sector: null,
    content_type: null,
    topic: null,
    caption: null,
    image_description: null,
    ...post,
    hashtags_json: JSON.stringify(post.hashtags || []),
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

function getPostByNumber(monthKey, postNumber) {
  const d = getDb();
  const row = d
    .prepare('SELECT * FROM posts WHERE month_key = ? AND post_number = ?')
    .get(monthKey, postNumber);
  if (!row) return null;
  return hydratePost(row);
}

function listPostsByMonth(monthKey) {
  const d = getDb();
  const rows = d
    .prepare('SELECT * FROM posts WHERE month_key = ? ORDER BY post_number ASC')
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

function deletePostsForMonth(monthKey) {
  const d = getDb();
  d.prepare('DELETE FROM posts WHERE month_key = ?').run(monthKey);
}

function hydratePost(row) {
  return {
    ...row,
    hashtags: row.hashtags_json ? JSON.parse(row.hashtags_json) : [],
    platforms: row.platforms_json ? JSON.parse(row.platforms_json) : []
  };
}

// ------------------------- blogs ---------------------------------
function insertBlog(blog) {
  const d = getDb();
  const stmt = d.prepare(
    `INSERT INTO blogs (calendar_id, month_key, topic, blog_description, url)
     VALUES (@calendar_id, @month_key, @topic, @blog_description, @url)
     RETURNING id`
  );
  const row = stmt.get({
    url: null,
    blog_description: null,
    topic: null,
    ...blog
  });
  return row.id;
}

function updateBlog(id, patch) {
  const d = getDb();
  const fields = [];
  const values = {};
  for (const [k, v] of Object.entries(patch)) {
    fields.push(`${k} = @${k}`);
    values[k] = v;
  }
  if (!fields.length) return;
  values.id = id;
  d.prepare(`UPDATE blogs SET ${fields.join(', ')} WHERE id = @id`).run(values);
}

function listBlogsByMonth(monthKey) {
  const d = getDb();
  return d
    .prepare('SELECT * FROM blogs WHERE month_key = ? ORDER BY id ASC')
    .all(monthKey);
}

function deleteBlogsForMonth(monthKey) {
  const d = getDb();
  d.prepare('DELETE FROM blogs WHERE month_key = ?').run(monthKey);
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
  // calendars
  saveCalendar,
  getCalendar,
  updateCalendarStatus,
  // posts
  insertPost,
  updatePost,
  getPost,
  getPostByNumber,
  listPostsByMonth,
  listPostsByStatus,
  countByStatus,
  deletePostsForMonth,
  // blogs
  insertBlog,
  updateBlog,
  listBlogsByMonth,
  deleteBlogsForMonth,
  // settings
  setSetting,
  getSetting
};
