/**
 * Supabase-backed persistence for the Strong Group marketing agent.
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
 *
 * Migration note
 * --------------
 * Previously this module used `better-sqlite3` (synchronous). It now
 * uses `@supabase/supabase-js` (asynchronous). Every exported function
 * is therefore an `async` function returning a Promise. All callers
 * have been updated to `await` storage calls.
 *
 * The exported function signatures and return shapes are kept
 * identical to the SQLite version (modulo the async wrapper) so the
 * rest of the codebase continues to work unchanged.
 */

const { createClient } = require('@supabase/supabase-js');
const { env } = require('../config');
const logger = require('./logger');

let client;

function getClient() {
  if (client) return client;
  if (!env.supabaseUrl || !env.supabaseServiceKey) {
    throw new Error(
      'Supabase is not configured: SUPABASE_URL and SUPABASE_SERVICE_KEY env vars are required'
    );
  }
  client = createClient(env.supabaseUrl, env.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  logger.info({ url: env.supabaseUrl }, 'Supabase client initialised');
  return client;
}

/**
 * Lightweight connectivity check used at startup so we fail fast if
 * the Supabase project is unreachable or the service key is wrong.
 * Returns the underlying Supabase client.
 *
 * Kept under the same name (`getDb`) as the SQLite version so callers
 * such as `index.js` don't need to learn a new API.
 */
async function getDb() {
  const c = getClient();
  // A trivial probe — `count` only, no rows transferred.
  const { error } = await c
    .from('settings')
    .select('key', { count: 'exact', head: true });
  if (error) {
    logger.error(
      { err: error.message, code: error.code },
      'Supabase connectivity check failed'
    );
    throw new Error(`Supabase connectivity check failed: ${error.message}`);
  }
  logger.info('Supabase connection OK');
  return c;
}

// ------------------------- calendars -----------------------------
async function saveCalendar(monthKey, payload, status = 'awaiting_images') {
  const c = getClient();
  const { data, error } = await c
    .from('calendars')
    .upsert(
      {
        month_key: monthKey,
        raw_json: payload,
        status,
        created_at: new Date().toISOString()
      },
      { onConflict: 'month_key' }
    )
    .select('id')
    .single();
  if (error) throw new Error(`saveCalendar failed: ${error.message}`);
  return data.id;
}

async function getCalendar(monthKey) {
  const c = getClient();
  const { data, error } = await c
    .from('calendars')
    .select('*')
    .eq('month_key', monthKey)
    .maybeSingle();
  if (error) throw new Error(`getCalendar failed: ${error.message}`);
  if (!data) return null;
  // raw_json is stored as JSONB so it comes back as an object.
  // Preserve the SQLite-era contract: row spread + `raw` parsed.
  return { ...data, raw: data.raw_json };
}

async function updateCalendarStatus(monthKey, status) {
  const c = getClient();
  const { error } = await c
    .from('calendars')
    .update({ status })
    .eq('month_key', monthKey);
  if (error) throw new Error(`updateCalendarStatus failed: ${error.message}`);
}

// ------------------------- posts ---------------------------------
async function insertPost(post) {
  const c = getClient();
  const row = {
    kind: 'social',
    blog_id: null,
    sector: null,
    content_type: null,
    topic: null,
    caption: null,
    image_description: null,
    ...post,
    hashtags_json: post.hashtags || [],
    platforms_json: post.platforms || [],
    status: post.status || 'awaiting_image'
  };
  // Strip the non-column convenience fields.
  delete row.hashtags;
  delete row.platforms;

  const { error } = await c.from('posts').insert(row);
  if (error) throw new Error(`insertPost failed: ${error.message}`);
}

async function updatePost(id, patch) {
  if (!patch || !Object.keys(patch).length) return;
  const c = getClient();
  const updates = { ...patch, updated_at: new Date().toISOString() };
  const { error } = await c.from('posts').update(updates).eq('id', id);
  if (error) throw new Error(`updatePost failed: ${error.message}`);
}

async function getPost(id) {
  const c = getClient();
  const { data, error } = await c
    .from('posts')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`getPost failed: ${error.message}`);
  if (!data) return null;
  return hydratePost(data);
}

async function getPostByNumber(monthKey, postNumber) {
  const c = getClient();
  const { data, error } = await c
    .from('posts')
    .select('*')
    .eq('month_key', monthKey)
    .eq('post_number', postNumber)
    .maybeSingle();
  if (error) throw new Error(`getPostByNumber failed: ${error.message}`);
  if (!data) return null;
  return hydratePost(data);
}

async function listPostsByMonth(monthKey) {
  const c = getClient();
  const { data, error } = await c
    .from('posts')
    .select('*')
    .eq('month_key', monthKey)
    .order('post_number', { ascending: true });
  if (error) throw new Error(`listPostsByMonth failed: ${error.message}`);
  return (data || []).map(hydratePost);
}

async function listPostsByStatus(status) {
  const c = getClient();
  const { data, error } = await c
    .from('posts')
    .select('*')
    .eq('status', status)
    .order('scheduled_for', { ascending: true });
  if (error) throw new Error(`listPostsByStatus failed: ${error.message}`);
  return (data || []).map(hydratePost);
}

async function countByStatus() {
  const c = getClient();
  // Supabase / PostgREST does not have a direct GROUP BY aggregation
  // helper, so we fetch the small status column and aggregate locally.
  // The posts table is bounded in size (~14 rows / month) so this is
  // cheap and matches the original `[{status, count}, ...]` shape.
  const { data, error } = await c.from('posts').select('status');
  if (error) throw new Error(`countByStatus failed: ${error.message}`);
  const tally = new Map();
  for (const row of data || []) {
    tally.set(row.status, (tally.get(row.status) || 0) + 1);
  }
  return Array.from(tally.entries()).map(([status, count]) => ({
    status,
    count
  }));
}

async function deletePostsForMonth(monthKey) {
  const c = getClient();
  const { error } = await c.from('posts').delete().eq('month_key', monthKey);
  if (error) throw new Error(`deletePostsForMonth failed: ${error.message}`);
}

/**
 * Retrieve a compact history of every previously generated post
 * (optionally excluding the given month). Used by the calendar
 * generator to feed past topics / captions / sectors into the LLM
 * so that next month's calendar does not repeat earlier content.
 *
 * @param {object} [opts]
 * @param {string} [opts.excludeMonthKey] - month_key to exclude (e.g. the one we're regenerating)
 * @param {number} [opts.limit=200]       - cap how many rows are returned (most recent first)
 * @returns {Promise<Array<{month_key:string, post_number:number, kind:string, sector:string|null, content_type:string|null, topic:string|null, caption:string|null, hashtags:string[]}>>}
 */
async function listPastPostsHistory({ excludeMonthKey = null, limit = 200 } = {}) {
  const c = getClient();
  let query = c
    .from('posts')
    .select(
      'month_key, post_number, kind, sector, content_type, topic, caption, hashtags_json'
    )
    .order('month_key', { ascending: false })
    .order('post_number', { ascending: true })
    .limit(limit);
  if (excludeMonthKey) query = query.neq('month_key', excludeMonthKey);
  const { data, error } = await query;
  if (error) throw new Error(`listPastPostsHistory failed: ${error.message}`);
  return (data || []).map((row) => ({
    month_key: row.month_key,
    post_number: row.post_number,
    kind: row.kind,
    sector: row.sector,
    content_type: row.content_type,
    topic: row.topic,
    caption: row.caption,
    hashtags: parseJsonField(row.hashtags_json)
  }));
}

function hydratePost(row) {
  return {
    ...row,
    hashtags: parseJsonField(row.hashtags_json),
    platforms: parseJsonField(row.platforms_json)
  };
}

function parseJsonField(value) {
  if (value == null) return [];
  // JSONB columns come back already-parsed; but be defensive in case
  // an older row stored a TEXT JSON string.
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? value : [];
}

// ------------------------- blogs ---------------------------------
async function insertBlog(blog) {
  const c = getClient();
  const row = {
    url: null,
    blog_description: null,
    topic: null,
    ...blog
  };
  const { data, error } = await c
    .from('blogs')
    .insert(row)
    .select('id')
    .single();
  if (error) throw new Error(`insertBlog failed: ${error.message}`);
  return data.id;
}

async function updateBlog(id, patch) {
  if (!patch || !Object.keys(patch).length) return;
  const c = getClient();
  const { error } = await c.from('blogs').update(patch).eq('id', id);
  if (error) throw new Error(`updateBlog failed: ${error.message}`);
}

async function listBlogsByMonth(monthKey) {
  const c = getClient();
  const { data, error } = await c
    .from('blogs')
    .select('*')
    .eq('month_key', monthKey)
    .order('id', { ascending: true });
  if (error) throw new Error(`listBlogsByMonth failed: ${error.message}`);
  return data || [];
}

async function deleteBlogsForMonth(monthKey) {
  const c = getClient();
  const { error } = await c.from('blogs').delete().eq('month_key', monthKey);
  if (error) throw new Error(`deleteBlogsForMonth failed: ${error.message}`);
}

// ------------------------- settings ------------------------------
async function setSetting(key, value) {
  const c = getClient();
  const { error } = await c
    .from('settings')
    .upsert({ key, value }, { onConflict: 'key' });
  if (error) throw new Error(`setSetting failed: ${error.message}`);
}

async function getSetting(key) {
  const c = getClient();
  const { data, error } = await c
    .from('settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error) throw new Error(`getSetting failed: ${error.message}`);
  return data ? data.value : null;
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
  listPastPostsHistory,
  // blogs
  insertBlog,
  updateBlog,
  listBlogsByMonth,
  deleteBlogsForMonth,
  // settings
  setSetting,
  getSetting
};
